import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const rank: Record<string, number> = { basic: 1, pro: 2, business: 3 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  let admin: ReturnType<typeof createClient> | null = null;
  let stripe: Stripe | null = null;
  let reservedBusinessId: string | null = null;
  let createdSessionId: string | null = null;

  try {
    const auth = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Sesión requerida.');

    admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: business, error: businessError } = await admin
      .from('rewards_businesses')
      .select('*')
      .eq('owner_id', user.id)
      .single();
    if (businessError) throw businessError;
    if (business.manual_plan) {
      throw new Error('Tu cuenta tiene un plan de cortesía. Contacta a Rewards Enla para contratar una suscripción.');
    }

    const body = await req.json();
    const plan = String(body?.plan || '');
    const publishProgramId = body?.publishProgramId || null;
    const billingInterval = body?.billingInterval === 'annual' ? 'annual' : 'monthly';
    const annualPromo = billingInterval === 'annual';

    if (!['basic', 'pro', 'business'].includes(plan)) throw new Error('Plan inválido.');

    const monthlyPrices: Record<string, string | undefined> = {
      basic: Deno.env.get('STRIPE_PRICE_BASIC'),
      pro: Deno.env.get('STRIPE_PRICE_PRO'),
      business: Deno.env.get('STRIPE_PRICE_BUSINESS')
    };
    const annualPrices: Record<string, string | undefined> = {
      basic: Deno.env.get('STRIPE_PRICE_BASIC_ANNUAL_PROMO'),
      pro: Deno.env.get('STRIPE_PRICE_PRO_ANNUAL_PROMO'),
      business: Deno.env.get('STRIPE_PRICE_BUSINESS_ANNUAL_PROMO')
    };
    const priceId = annualPromo ? annualPrices[plan] : monthlyPrices[plan];
    if (!priceId) {
      throw new Error(annualPromo
        ? 'Falta configurar el Price ID anual promocional de Stripe para este plan.'
        : 'Falta configurar el Price ID mensual de Stripe para este plan.');
    }

    stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

    if (annualPromo) {
      const { data: reservationRows, error: reservationError } = await admin.rpc(
        'rewards_admin_reserve_annual_promo',
        { p_business_id: business.id }
      );
      if (reservationError) throw reservationError;
      const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
      if (!reservation?.ok) {
        throw new Error('La promoción anual de apertura ya alcanzó los 50 negocios. Puedes contratar el plan mensual.');
      }
      reservedBusinessId = business.id;
    }

    // Si ya existe una suscripción activa, actualizamos ESA suscripción para evitar duplicados.
    if (business.stripe_subscription_id && ['active', 'trialing'].includes(business.subscription_status || '')) {
      const subscription: any = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
      const item = subscription.items?.data?.[0];
      if (!item) throw new Error('No se encontró el precio actual de la suscripción.');

      const currentPlan = String(business.rewards_plan || 'trial');
      const currentInterval = String(
        business.billing_interval ||
        (item.price?.recurring?.interval === 'year' ? 'annual' : 'monthly')
      );

      if (currentInterval === 'annual' && billingInterval === 'monthly') {
        throw new Error('Tu suscripción actual es anual. Para cambiarla a mensual, contacta a Rewards Enla.');
      }
      if ((rank[plan] || 0) < (rank[currentPlan] || 0)) {
        throw new Error('Selecciona tu plan actual o uno superior.');
      }
      if (plan === currentPlan && billingInterval === currentInterval) {
        throw new Error('Ese ya es tu plan y periodo de facturación actual.');
      }

      await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'always_invoice',
        metadata: {
          ...(subscription.metadata || {}),
          business_id: business.id,
          plan,
          billing_interval: billingInterval,
          annual_promo: annualPromo ? 'true' : 'false'
        }
      });

      const { error: updateError } = await admin
        .from('rewards_businesses')
        .update({ rewards_plan: plan, billing_interval: billingInterval })
        .eq('id', business.id);
      if (updateError) throw updateError;

      if (annualPromo) {
        const { error: claimError } = await admin.rpc('rewards_admin_claim_annual_promo', {
          p_business_id: business.id,
          p_session_id: null
        });
        if (claimError) throw claimError;
      }

      reservedBusinessId = null;
      return Response.json({ updated: true, plan, billingInterval }, { headers: cors });
    }

    let customer = business.stripe_customer_id;
    if (!customer) {
      const customerObj = await stripe.customers.create({
        email: user.email,
        metadata: { business_id: business.id }
      });
      customer = customerObj.id;
      const { error: customerUpdateError } = await admin
        .from('rewards_businesses')
        .update({ stripe_customer_id: customer })
        .eq('id', business.id);
      if (customerUpdateError) throw customerUpdateError;
    }

    const configured = Deno.env.get('APP_URL') || req.headers.get('origin') || 'https://rewards.enla.mx';
    let site = 'https://rewards.enla.mx';
    try { site = new URL(configured).origin; } catch (_) {}

    const publishQuery = publishProgramId ? `&publish=${encodeURIComponent(String(publishProgramId))}` : '';
    const intervalQuery = `&billing=${billingInterval}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${site}/app/billing.html?success=1${publishQuery}${intervalQuery}`,
      cancel_url: `${site}/app/billing.html?canceled=1${publishQuery}${intervalQuery}`,
      ...(annualPromo ? { expires_at: Math.floor(Date.now() / 1000) + 31 * 60 } : {}),
      ...(annualPromo ? {} : { allow_promotion_codes: true }),
      subscription_data: {
        metadata: {
          business_id: business.id,
          plan,
          billing_interval: billingInterval,
          annual_promo: annualPromo ? 'true' : 'false'
        }
      },
      metadata: {
        business_id: business.id,
        plan,
        billing_interval: billingInterval,
        annual_promo: annualPromo ? 'true' : 'false'
      }
    });

    createdSessionId = session.id;

    if (annualPromo) {
      const { error: attachError } = await admin.rpc('rewards_admin_attach_annual_promo_session', {
        p_business_id: business.id,
        p_session_id: session.id
      });
      if (attachError) {
        try { await stripe.checkout.sessions.expire(session.id); } catch (_) {}
        throw attachError;
      }
    }

    reservedBusinessId = null;
    return Response.json({ url: session.url }, { headers: cors });
  } catch (e) {
    if (admin && reservedBusinessId) {
      try {
        await admin.rpc('rewards_admin_release_annual_promo', {
          p_business_id: reservedBusinessId,
          p_session_id: createdSessionId
        });
      } catch (_) {}
    }
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: cors }
    );
  }
});
