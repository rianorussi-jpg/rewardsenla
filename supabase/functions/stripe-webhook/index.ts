import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

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
      const businessId = subscription.metadata?.business_id;
      const plan = subscription.metadata?.plan;
      if (!businessId) return;

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
        .select('manual_plan')
        .eq('id', businessId)
        .single();
      if (businessError) throw businessError;

      const changes: Record<string, unknown> = {
        stripe_customer_id: String(subscription.customer),
        stripe_subscription_id: subscription.id,
        subscription_current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        subscription_cancel_at_period_end: !!subscription.cancel_at_period_end,
        billing_interval: billingInterval
      };

      if (!business.manual_plan) {
        changes.rewards_plan = active ? (plan || 'basic') : 'trial';
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
      if (session.metadata?.annual_promo === 'true' && session.metadata?.business_id) {
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
      if (session.metadata?.annual_promo === 'true' && session.metadata?.business_id) {
        const { error: releaseError } = await admin.rpc('rewards_admin_release_annual_promo', {
          p_business_id: session.metadata.business_id,
          p_session_id: session.id
        });
        if (releaseError) throw releaseError;
      }
    }

    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      await syncSubscription(event.data.object as any);
    }

    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response(e instanceof Error ? e.message : String(e), { status: 400 });
  }
});
