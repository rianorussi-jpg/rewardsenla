const CFG = window.ENLA_CONFIG || {};
const configured = Boolean(
  CFG.SUPABASE_URL &&
  !CFG.SUPABASE_URL.includes('YOUR-PROJECT') &&
  CFG.SUPABASE_ANON_KEY &&
  !CFG.SUPABASE_ANON_KEY.includes('YOUR_')
);

let sb = null;
let configError = null;

if (!configured) {
  configError = new Error('Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_ANON_KEY en /app/assets/config.js.');
} else if (!window.supabase) {
  configError = new Error('No se pudo cargar la librería de Supabase. Revisa tu conexión a internet o el CDN de Supabase.');
} else {
  try {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  } catch (error) {
    configError = new Error('No se pudo inicializar Supabase: ' + (error?.message || error));
  }
}

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

function msg(el,text,type='error'){
  if(!el)return;
  el.className=type;
  el.textContent=text;
  el.classList.remove('hidden');
}
function initials(name='N'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function ensureConfigured(){
  if(configError) throw configError;
  if(!sb) throw new Error('Supabase no está disponible.');
  return sb;
}
async function currentUser(){
  ensureConfigured();
  const {data,error}=await sb.auth.getUser();
  if(error) throw error;
  return data.user||null;
}
async function requireAuth(){
  const u=await currentUser();
  if(!u){location.href='/app/login.html';return null}
  return u;
}
async function signOut(){
  ensureConfigured();
  const {error}=await sb.auth.signOut();
  if(error) throw error;
  location.href='/app/login.html';
}
function bindShell(){
  const menu=$('#mobileMenu'),side=$('.sidebar'),ov=$('.overlay');
  if(menu)menu.onclick=()=>{side.classList.add('open');ov.classList.add('show')};
  if(ov)ov.onclick=()=>{side.classList.remove('open');ov.classList.remove('show')};
  const so=$('#signOut');
  if(so)so.onclick=async()=>{try{await signOut()}catch(e){alert(e.message)}};
}
async function getBusiness(){
  ensureConfigured();
  const u=await currentUser();
  if(!u)return null;
  const {data,error}=await sb.from('rewards_businesses').select('*').eq('owner_id',u.id).maybeSingle();
  if(error)throw error;
  return data;
}
async function getPrograms(){
  ensureConfigured();
  const b=await getBusiness();
  if(!b)return [];
  const {data,error}=await sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id).order('created_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
async function getProgram(id=null){
  ensureConfigured();
  const b=await getBusiness();
  if(!b)return null;
  let q=sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id);
  if(id) q=q.eq('id',id);
  else q=q.order('created_at',{ascending:false}).limit(1);
  const {data,error}=await q.maybeSingle();
  if(error)throw error;
  return data;
}
async function saveProgram(p, programId=null){
  ensureConfigured();
  const b=await getBusiness();
  if(!b)throw new Error('No se encontró el negocio asociado a esta cuenta.');
  const payload={...p,business_id:b.id};
  delete payload.id;
  if(programId){
    // El tipo queda bloqueado después de crear la tarjeta.
    delete payload.program_type;
    const {data,error}=await sb.from('rewards_loyalty_programs').update(payload).eq('id',programId).eq('business_id',b.id).select().single();
    if(error)throw error;
    return data;
  }
  // Cada tarjeta necesita un public_slug único para su QR público.
  // Lo generamos en cliente y la base también tiene un default como respaldo.
  if(!payload.public_slug){
    const raw=(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
      .replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
    payload.public_slug=raw.slice(0,16);
  }
  const {data,error}=await sb.from('rewards_loyalty_programs').insert(payload).select().single();
  if(error)throw error;
  return data;
}
async function uploadLogo(file){
  if(!file)return null;
  ensureConfigured();
  const u=await currentUser();
  if(!u) throw new Error('No hay una sesión activa.');
  const ext=file.name.split('.').pop();
  const path=`${u.id}/logo-${Date.now()}.${ext}`;
  const {error}=await sb.storage.from('reward-logos').upload(path,file,{upsert:true});
  if(error)throw error;
  const {data}=sb.storage.from('reward-logos').getPublicUrl(path);
  return data.publicUrl;
}

async function uploadProgramMedia(file, kind='media'){
  if(!file)return null;
  ensureConfigured();
  const u=await currentUser();
  if(!u) throw new Error('No hay una sesión activa.');
  const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
  const safeKind=String(kind||'media').replace(/[^a-z0-9_-]/gi,'-');
  const path=`${u.id}/${safeKind}-${Date.now()}.${ext}`;
  const {error}=await sb.storage.from('reward-logos').upload(path,file,{upsert:true,contentType:file.type||undefined});
  if(error)throw error;
  const {data}=sb.storage.from('reward-logos').getPublicUrl(path);
  return data.publicUrl;
}
function loyaltyMeta(type='stamps'){
  if(type==='cashback')return {singular:'saldo',plural:'cashback',action:'Agregar cashback',history:'Cashback',currency:true};
  if(type==='visits')return {singular:'visita',plural:'visitas restantes',action:'Usar visita',history:'Uso de visita'};
  return {singular:'sello',plural:'sellos',action:'Agregar sello',history:'Sellos'};
}

async function syncWallet(public_code){
  if(!public_code)return;
  try{const {error}=await sb.functions.invoke('wallet-sync',{body:{public_code}});if(error)console.warn('Wallet sync:',error)}catch(e){console.warn('Wallet sync:',e)}
}
async function addStamp(customerId){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_add_stamp',{p_customer_id:customerId});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}

async function useVisit(customerId){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_use_visit',{p_customer_id:customerId});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}
async function renewVisits(customerId){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_renew_visits',{p_customer_id:customerId});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}
async function deactivateVisitCard(customerId){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_deactivate_visit_card',{p_customer_id:customerId});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}
async function spendCashback(customerId, amount){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_spend_cashback',{p_customer_id:customerId,p_amount:Number(amount)});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}
async function redeemReward(customerId){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_redeem_reward',{p_customer_id:customerId});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}

function navActive(){const p=location.pathname.split('/').pop();$$('.nav-item').forEach(a=>{if(a.getAttribute('href')?.endsWith(p))a.classList.add('active')})}

window.ENLA={version:'20260906-visits2',sb,configured,configError,ensureConfigured,currentUser,requireAuth,getBusiness,getPrograms,getProgram,saveProgram,uploadLogo,uploadProgramMedia,loyaltyMeta,bindShell,navActive,msg,initials,syncWallet,addStamp,useVisit,renewVisits,deactivateVisitCard,redeemReward,spendCashback};
