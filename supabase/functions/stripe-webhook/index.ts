import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function stripeDateToIso(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const d = new Date(numeric * 1000);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

function getSubscriptionPeriodEnd(subscription: any): string | null {
  const items = Array.isArray(subscription?.items?.data)
    ? subscription.items.data
    : [];

  for (const item of items) {
    const iso = stripeDateToIso(item?.current_period_end);
    if (iso) return iso;
  }

  return stripeDateToIso(subscription?.current_period_end);
}

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return new Response('missing signature', { status: 400 });
  }

  try {
    const body = await req.text();

    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    );

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const syncSubscription = async (subscription: any) => {
      let businessId = subscription.metadata?.business_id;
      const plan = subscription.metadata?.plan;

      // Fallback por si alguna suscripción antigua no tiene business_id
      // en metadata, pero ya tenemos asociado el Stripe Customer.
      if (!businessId && subscription.customer) {
        const { data: businessByCustomer, error: lookupError } = await admin
          .from('rewards_businesses')
          .select('id')
          .eq('stripe_customer_id', String(subscription.customer))
          .maybeSingle();

        if (lookupError) throw lookupError;
        businessId = businessByCustomer?.id || null;
      }

      if (!businessId) {
        throw new Error(`No se encontró business_id para la suscripción ${subscription.id}`);
      }

      const active = ['active', 'trialing'].includes(subscription.status);
      const itemInterval = subscription.items?.data?.[0]?.price?.recurring?.interval;
      const billingInterval = subscription.metadata?.billing_interval === 'annual'
        ? 'annual'
        : subscription.metadata?.billing_interval === 'monthly'
        ? 'monthly'
        : itemInterval === 'year'
        ? 'annual'
        : 'monthly';

      const { data: business, error: businessError } = await admin
        .from('rewards_businesses')
        .select(
          'manual_plan,stripe_subscription_id,subscription_status,rewards_plan'
        )
        .eq('id', businessId)
        .single();
      if (businessError) throw businessError;

      const changes: Record<string, unknown> = {
        stripe_customer_id: String(subscription.customer),
        stripe_subscription_id: subscription.id,
        subscription_current_period_end: getSubscriptionPeriodEnd(subscription),
        subscription_cancel_at_period_end: !!subscription.cancel_at_period_end,
        billing_interval: billingInterval
      };

      if (!business.manual_plan) {
        changes.rewards_plan = active ? (plan || business.rewards_plan || 'basic') : 'trial';
        changes.subscription_status = subscription.status;
      }

      const { error: updateError } = await admin
        .from('rewards_businesses')
        .update(changes)
        .eq('id', businessId);
      if (updateError) throw updateError;
    };

    if (event.type === 'checkout.session.completed') {
      const session: any = event.data.object;
      const openingPromoClaimable = session.metadata?.opening_promo_claimable === 'true' || (session.metadata?.opening_promo_claimable == null && session.metadata?.annual_promo === 'true');

      if (openingPromoClaimable && session.metadata?.business_id) {
        const { error: claimError } = await admin.rpc('rewards_admin_claim_annual_promo', {
          p_business_id: session.metadata.business_id,
          p_session_id: session.id
        });
        if (claimError) throw claimError;
      }

      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
        await syncSubscription(subscription);
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session: any = event.data.object;
      const openingPromoClaimable = session.metadata?.opening_promo_claimable === 'true' || (session.metadata?.opening_promo_claimable == null && session.metadata?.annual_promo === 'true');

      if (openingPromoClaimable && session.metadata?.business_id) {
        const { error: releaseError } = await admin.rpc('rewards_admin_release_annual_promo', {
          p_business_id: session.metadata.business_id,
          p_session_id: session.id
        });
        if (releaseError) throw releaseError;
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const eventSubscription: any = event.data.object;

      // IMPORTANTE:
      // No confiamos en el snapshot del evento, porque puede ser viejo
      // o haberse reenviado manualmente días después.
      // Consultamos a Stripe el estado ACTUAL de esa suscripción.
      const currentSubscription = await stripe.subscriptions.retrieve(
        String(eventSubscription.id)
      );

      await syncSubscription(currentSubscription);
    }

    if (event.type === 'customer.subscription.deleted') {
      // Para deleted usamos el objeto del propio evento.
      await syncSubscription(event.data.object as any);
    }

    return new Response('ok');
  } catch (e) {
    console.error(e);

    return new Response(
      e instanceof Error ? e.message : String(e),
      { status: 400 }
    );
  }
});
