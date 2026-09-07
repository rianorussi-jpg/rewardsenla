import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const rank:any={basic:1,pro:2,business:3};
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});try{
 const auth=req.headers.get('Authorization')||''; const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}}); const {data:{user}}=await userClient.auth.getUser(); if(!user)throw new Error('Sesión requerida.');
 const admin=createClient(url,service); const {data:b,error}=await admin.from('rewards_businesses').select('*').eq('owner_id',user.id).single(); if(error)throw error;
 const {plan,publishProgramId}=await req.json(); if(!['basic','pro','business'].includes(plan))throw new Error('Plan inválido.');
 const priceMap:any={basic:Deno.env.get('STRIPE_PRICE_BASIC'),pro:Deno.env.get('STRIPE_PRICE_PRO'),business:Deno.env.get('STRIPE_PRICE_BUSINESS')}; if(!priceMap[plan])throw new Error('Falta configurar el Price ID de Stripe para este plan.');
 const stripe=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
 // Si ya hay suscripción activa, hacemos upgrade de ESA suscripción: nunca creamos una segunda.
 if(b.stripe_subscription_id && ['active','trialing'].includes(b.subscription_status||'')){
   if(rank[plan] <= (rank[b.rewards_plan]||0)) throw new Error('Selecciona un plan superior para hacer upgrade.');
   const sub:any=await stripe.subscriptions.retrieve(b.stripe_subscription_id);
   const item=sub.items?.data?.[0]; if(!item)throw new Error('No se encontró el precio actual de la suscripción.');
   await stripe.subscriptions.update(sub.id,{items:[{id:item.id,price:priceMap[plan]}],proration_behavior:'always_invoice',metadata:{...(sub.metadata||{}),business_id:b.id,plan}});
   await admin.from('rewards_businesses').update({rewards_plan:plan}).eq('id',b.id);
   return Response.json({updated:true,plan},{headers:cors});
 }
 let customer=b.stripe_customer_id;
 if(!customer){const c=await stripe.customers.create({email:user.email,metadata:{business_id:b.id}});customer=c.id;await admin.from('rewards_businesses').update({stripe_customer_id:customer}).eq('id',b.id)}
 const configured=Deno.env.get('APP_URL')||req.headers.get('origin')||'https://rewards.enla.mx';
 let site='https://rewards.enla.mx'; try{site=new URL(configured).origin}catch{};
 const qp=publishProgramId?`&publish=${encodeURIComponent(String(publishProgramId))}`:''; const s=await stripe.checkout.sessions.create({mode:'subscription',customer,line_items:[{price:priceMap[plan],quantity:1}],success_url:`${site}/app/billing.html?success=1${qp}`,cancel_url:`${site}/app/billing.html?canceled=1${qp}`,allow_promotion_codes:true,subscription_data:{metadata:{business_id:b.id,plan}},metadata:{business_id:b.id,plan}});
 return Response.json({url:s.url},{headers:cors});
}catch(e){return Response.json({error:e.message||String(e)},{status:400,headers:cors})}});