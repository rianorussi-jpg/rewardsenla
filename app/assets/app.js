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
  billing:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
  settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>',
  overview:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/></svg>',
  customers:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 19c.5-4 2.5-6 6-6s5.5 2 6 6M17 8a2.5 2.5 0 0 1 0 5M16 14c2.8.2 4.3 1.8 4.8 5"/></svg>',
  activity:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9M10 18V5M16 18v-7M22 18V3"/></svg>',
  edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4.7L8 20l10.5-10.5-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/></svg>',
  back:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>'
};
function navLink(icon,label,href,active=false){return `<a class="nav-item${active?' active':''}" href="${href}"><span class="nav-icon">${NAV_ICONS[icon]||''}</span><span>${label}</span></a>`}
function programContext(){const q=new URLSearchParams(location.search),page=location.pathname.split('/').pop();return q.get('program')||(['card-detail.html','program.html'].includes(page)?q.get('id'):null)||null}
function buildNav(){
  const nav=$('.nav-list'); if(!nav)return;
  const page=location.pathname.split('/').pop(), pid=programContext();
  if(pid){
    nav.innerHTML=`<div class="nav-caption">Tarjeta seleccionada</div>${navLink('overview','Resumen',`/app/card-detail.html?id=${pid}`,page==='card-detail.html')}${navLink('customers','Clientes',`/app/customers.html?program=${pid}`,page==='customers.html')}${navLink('scan','Escanear',`/app/scan.html?program=${pid}`,page==='scan.html')}${navLink('bell','Notificaciones',`/app/notifications.html?program=${pid}`,page==='notifications.html')}${navLink('activity','Actividad',`/app/history.html?program=${pid}`,page==='history.html')}${navLink('edit','Ajustes de tarjeta',`/app/program.html?id=${pid}`,page==='program.html')}<div class="nav-divider"></div>${navLink('back','Mis tarjetas','/app/dashboard.html',false)}`;
  }else{
    nav.innerHTML=`${navLink('cards','Mis tarjetas','/app/dashboard.html',page==='dashboard.html')}${navLink('scan','Escanear','/app/scan.html',page==='scan.html')}${navLink('history','Historial','/app/history.html',page==='history.html')}<div class="nav-divider"></div>${navLink('billing','Plan y facturación','/app/billing.html',page==='billing.html')}${navLink('settings','Ajustes de cuenta','/app/settings.html',page==='settings.html')}`;
  }
}
function bindShell(){
  buildNav();
  // Si la cuenta solo es empleado invitado, simplifica el menú a las funciones operativas.
  (async()=>{try{
    const u=await currentUser(); if(!u)return;
    const profile=await getAccessProfile();
    if(profile.isStaffOnly){
      const nav=$('.nav-list'); if(nav){
        const page=location.pathname.split('/').pop(),pid=programContext();
        nav.innerHTML=`${navLink('cards','Mis tarjetas','/app/dashboard.html',page==='dashboard.html')}${navLink('scan','Escanear',pid?`/app/scan.html?program=${pid}`:'/app/scan.html',page==='scan.html')}`;
      }
    }
  }catch(_e){}})();
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
async function getOwnedPrograms(){
  ensureConfigured();
  const b=await getBusiness().catch(()=>null);
  if(!b)return [];
  const {data,error}=await sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id).order('created_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
async function getStaffPrograms(){
  ensureConfigured();
  // Vincula invitaciones hechas por email con la cuenta autenticada, incluso si la cuenta se creó después de la invitación.
  try{await sb.rpc('rewards_claim_staff_assignments')}catch(_e){}
  const {data,error}=await sb.rpc('rewards_staff_programs');
  if(error)throw error;
  return data||[];
}
async function getPrograms(){
  ensureConfigured();
  const [owned,staff]=await Promise.all([getOwnedPrograms().catch(()=>[]),getStaffPrograms().catch(e=>{throw e})]);
  const map=new Map();
  for(const p of owned)map.set(p.id,{...p,_access_role:'owner'});
  for(const p of staff)if(!map.has(p.id))map.set(p.id,{...p,_access_role:'staff'});
  return [...map.values()];
}
async function getProgram(id=null){
  ensureConfigured();
  const programs=await getPrograms();
  return id?programs.find(x=>x.id===id)||null:programs[0]||null;
}
async function getAccessProfile(){
  const [owned,staff]=await Promise.all([getOwnedPrograms().catch(()=>[]),getStaffPrograms().catch(()=>[])]);
  return {owned,staff,isStaffOnly:owned.length===0&&staff.length>0,isOwner:owned.length>0};
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
  if(!public_code)return {ok:false,error:'Falta código de cliente.'};
  try{
    const {data,error}=await sb.functions.invoke('wallet-sync',{body:{public_code}});
    if(error){console.warn('Wallet sync:',error);return {ok:false,error:error.message||String(error)}}
    return {ok:true,data};
  }catch(e){console.warn('Wallet sync:',e);return {ok:false,error:e?.message||String(e)}}
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

async function sendWalletNotification(programId,message,customerId=null){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_send_wallet_notification',{
    p_program_id:programId,
    p_message:String(message||'').trim(),
    p_customer_id:customerId||null
  });
  if(error)throw error;
  const codes=(data||[]).map(x=>x.public_code).filter(Boolean);
  const results=[];
  const batchSize=6;
  for(let i=0;i<codes.length;i+=batchSize){
    const batch=codes.slice(i,i+batchSize);
    const settled=await Promise.allSettled(batch.map(async code=>{
      const sync=await syncWallet(code);
      return {code,sync};
    }));
    results.push(...settled);
  }
  let applePushed=0,appleFailed=0,appleConfigured=0,appleRegistered=0;
  for(const item of results){
    if(item.status!=='fulfilled')continue;
    const a=item.value?.sync?.data?.apple;
    if(a?.configured)appleConfigured++;
    applePushed+=Number(a?.pushed||0);
    appleFailed+=Number(a?.failed||0);
    if(Number(a?.registrations||0)>0)appleRegistered++;
  }
  return {count:codes.length,results,applePushed,appleFailed,appleConfigured,appleRegistered};
}
async function syncProgramWallets(programId){
  ensureConfigured();
  const {data,error}=await sb.rpc('rewards_program_customer_codes',{p_program_id:programId});
  if(error)throw error;
  const codes=(data||[]).map(x=>x.public_code).filter(Boolean);
  const batchSize=6;
  for(let i=0;i<codes.length;i+=batchSize){
    await Promise.allSettled(codes.slice(i,i+batchSize).map(code=>syncWallet(code)));
  }
  return codes.length;
}


async function getBilling(){ensureConfigured();const {data,error}=await sb.rpc('rewards_my_billing');if(error)throw error;return Array.isArray(data)?data[0]:data}
async function startCheckout(plan,publishProgramId=null){ensureConfigured();const {data,error}=await sb.functions.invoke('create-checkout-session',{body:{plan,publishProgramId}});if(error)throw error;if(data?.error)throw new Error(data.error);if(data?.updated)return data;if(!data?.url)throw new Error('Stripe no devolvió la página de pago.');location.href=data.url;return data}
async function openBillingPortal(){ensureConfigured();const {data,error}=await sb.functions.invoke('create-customer-portal',{body:{}});if(error)throw error;if(data?.error)throw new Error(data.error);location.href=data.url}
async function getPublicationOverview(programId=null){ensureConfigured();const {data,error}=await sb.rpc('rewards_publication_overview',{p_program_id:programId||null});if(error)throw error;return Array.isArray(data)?data[0]:data}
async function publishProgram(programId){ensureConfigured();const {data,error}=await sb.rpc('rewards_publish_program',{p_program_id:programId});if(error)throw error;return data}
async function unpublishProgram(programId){ensureConfigured();const {data,error}=await sb.rpc('rewards_unpublish_program',{p_program_id:programId});if(error)throw error;return data}
async function smartPublish(programId){
  const o=await getPublicationOverview(programId);
  if(o?.can_publish){await publishProgram(programId);return {published:true,overview:o}}
  const reason=encodeURIComponent(o?.reason||'plan_required');
  location.href=`/app/billing.html?publish=${encodeURIComponent(programId)}&reason=${reason}`;
  return {published:false,overview:o};
}

function navActive(){buildNav()}

window.ENLA={version:'20260907-publish2',sb,configured,configError,ensureConfigured,currentUser,requireAuth,getBusiness,getOwnedPrograms,getStaffPrograms,getPrograms,getProgram,getAccessProfile,saveProgram,uploadLogo,uploadProgramMedia,loyaltyMeta,bindShell,navActive,msg,initials,syncWallet,addStamp,useVisit,renewVisits,deactivateVisitCard,redeemReward,spendCashback,addCashbackAmount,setCashbackBalance,markAccess,renewAccess,setAccessExpiry,setAccessStatus,staffScanAction,isProgramStaff,sendWalletNotification,syncProgramWallets,programContext,getBilling,startCheckout,openBillingPortal,getPublicationOverview,publishProgram,unpublishProgram,smartPublish};
