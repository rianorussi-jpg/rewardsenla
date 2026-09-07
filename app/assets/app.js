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
const NAV_ICONS={
  cards:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h10M7 12h6"/></svg>',
  scan:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></svg>',
  history:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>',
  settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>',
  overview:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/></svg>',
  customers:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 19c.5-4 2.5-6 6-6s5.5 2 6 6M17 8a2.5 2.5 0 0 1 0 5M16 14c2.8.2 4.3 1.8 4.8 5"/></svg>',
  activity:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9M10 18V5M16 18v-7M22 18V3"/></svg>',
  edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4.7L8 20l10.5-10.5-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg>',
  back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
};
function navLink(icon,label,href,active=false){return `<a class="nav-item${active?' active':''}" href="${href}"><span class="nav-icon">${NAV_ICONS[icon]||''}</span><span>${label}</span></a>`}
function programContext(){const q=new URLSearchParams(location.search),page=location.pathname.split('/').pop();return q.get('program')||(['card-detail.html','program.html'].includes(page)?q.get('id'):null)||null}
function buildNav(){
  const nav=$('.nav-list'); if(!nav)return;
  const page=location.pathname.split('/').pop(), pid=programContext();
  if(pid){
    nav.innerHTML=`<div class="nav-caption">Tarjeta seleccionada</div>${navLink('overview','Resumen',`/app/card-detail.html?id=${pid}`,page==='card-detail.html')}${navLink('customers','Clientes',`/app/customers.html?program=${pid}`,page==='customers.html')}${navLink('scan','Escanear',`/app/scan.html?program=${pid}`,page==='scan.html')}${navLink('activity','Actividad',`/app/history.html?program=${pid}`,page==='history.html')}${navLink('edit','Ajustes de tarjeta',`/app/program.html?id=${pid}`,page==='program.html')}<div class="nav-divider"></div>${navLink('back','Mis tarjetas','/app/dashboard.html',false)}`;
  }else{
    nav.innerHTML=`${navLink('cards','Mis tarjetas','/app/dashboard.html',page==='dashboard.html')}${navLink('scan','Escanear','/app/scan.html',page==='scan.html')}${navLink('history','Historial','/app/history.html',page==='history.html')}<div class="nav-divider"></div>${navLink('settings','Ajustes de cuenta','/app/settings.html',page==='settings.html')}`;
  }
}
function bindShell(){
  buildNav();
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
  const b=await getBusiness().catch(()=>null);
  if(b){const {data,error}=await sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id).order('created_at',{ascending:false});if(!error)return data||[];}
  const st=await sb.rpc('rewards_staff_programs'); if(st.error)throw st.error; return st.data||[];
}
async function getProgram(id=null){
  ensureConfigured();
  const b=await getBusiness().catch(()=>null);
  if(b){let q=sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id);if(id)q=q.eq('id',id);else q=q.order('created_at',{ascending:false}).limit(1);const {data,error}=await q.maybeSingle();if(!error&&data)return data;}
  const st=await sb.rpc('rewards_staff_programs');if(st.error)throw st.error;const arr=st.data||[];return id?arr.find(x=>x.id===id)||null:arr[0]||null;
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
  if(type==='access')return {singular:'acceso',plural:'accesos',action:'Registrar acceso',history:'Accesos'};
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

async function markAccess(customerId, action='entry'){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_mark_access',{p_customer_id:customerId,p_action:action});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}
async function renewAccess(customerId, days=null){
  ensureConfigured();
  const args={p_customer_id:customerId};
  if(days)args.p_days=Number(days);
  const {data,error}=await sb.rpc('rewards_renew_access',{...args});
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
async function addCashbackAmount(customerId, amount){
  ensureConfigured();
  const value=Number(amount);
  if(!Number.isFinite(value)||value<=0)throw new Error('Escribe una cantidad válida mayor a $0.');
  const {data,error}=await sb.rpc('rewards_add_cashback_amount',{p_customer_id:customerId,p_amount:value});
  if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;
  await syncWallet(row?.public_code);
  return row;
}
async function setCashbackBalance(customerId, amount){
  ensureConfigured();
  const value=Number(amount);
  if(!Number.isFinite(value)||value<0)throw new Error('El saldo no puede ser negativo.');
  const {data,error}=await sb.rpc('rewards_set_cashback_balance',{p_customer_id:customerId,p_amount:value});
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

async function setAccessExpiry(customerId,expiresAt){ensureConfigured();const {data,error}=await sb.rpc('rewards_set_access_expiry',{p_customer_id:customerId,p_expires_at:expiresAt});if(error)throw error;const r=Array.isArray(data)?data[0]:data;await syncWallet(r?.public_code);return r}
async function setAccessStatus(customerId,status){ensureConfigured();const {data,error}=await sb.rpc('rewards_set_access_status',{p_customer_id:customerId,p_status:status});if(error)throw error;const r=Array.isArray(data)?data[0]:data;await syncWallet(r?.public_code);return r}
async function staffScanAction(customerId,action,amount=null){ensureConfigured();const {data,error}=await sb.rpc('rewards_staff_scan_action',{p_customer_id:customerId,p_action:action,p_amount:amount});if(error)throw error;const r=Array.isArray(data)?data[0]:data;await syncWallet(r?.public_code);return r}
async function isProgramStaff(programId){ensureConfigured();const {data,error}=await sb.rpc('rewards_is_program_staff',{p_program:programId});if(error)return false;return !!data}
function navActive(){buildNav()}

window.ENLA={version:'20260906-scope2',sb,configured,configError,ensureConfigured,currentUser,requireAuth,getBusiness,getPrograms,getProgram,saveProgram,uploadLogo,uploadProgramMedia,loyaltyMeta,bindShell,navActive,msg,initials,syncWallet,addStamp,useVisit,renewVisits,deactivateVisitCard,redeemReward,spendCashback,addCashbackAmount,setCashbackBalance,markAccess,renewAccess,setAccessExpiry,setAccessStatus,staffScanAction,isProgramStaff,programContext};
