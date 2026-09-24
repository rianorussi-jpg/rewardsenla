import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
const json=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json"}});
Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),secret=Deno.env.get("BIRTHDAY_CRON_SECRET");
  if(!url||!key||!secret||secret.length<32)return json({error:"Falta configuración del servidor"},500);
  if(req.headers.get("Authorization")!==`Bearer ${key}`||req.headers.get("x-enla-birthday-secret")!==secret)return json({error:"No autorizado"},401);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  // La RPC se encarga del calendario de Ciudad de México, licencia y deduplicación anual.
  const {data,error}=await admin.rpc("rewards_claim_birthday_notifications",{p_limit:100});
  if(error)return json({error:error.message},500);
  const jobs=Array.isArray(data)?data:[];
  let processed=0,failed=0,applePushed=0,googleUpdated=0;
  for(let i=0;i<jobs.length;i+=5){
    await Promise.all(jobs.slice(i,i+5).map(async job=>{
      try{
        const r=await fetch(`${url}/functions/v1/wallet-sync`,{
          method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`,"apikey":key,"x-enla-birthday-secret":secret},
          body:JSON.stringify({public_code:job.public_code}),
        });
        const result=await r.json();
        if(!r.ok||result?.error||result?.google?.ok===false)throw new Error(JSON.stringify(result));
        processed++;
        applePushed+=Number(result?.apple?.pushed||0);
        if(result?.google?.ok)googleUpdated++;
      }catch(e){failed++;console.error("Birthday sync failed",job.customer_id,String(e));}
    }));
  }
  return json({claimed:jobs.length,processed,failed,applePushed,googleUpdated,notice:"Los avisos finales dependen de que el cliente tenga su pase instalado y de las restricciones del sistema operativo."});
});
