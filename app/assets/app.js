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
async function getProgram(){
  ensureConfigured();
  const b=await getBusiness();
  if(!b)return null;
  const {data,error}=await sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id).maybeSingle();
  if(error)throw error;
  return data;
}
async function saveProgram(p){
  ensureConfigured();
  const b=await getBusiness();
  if(!b)throw new Error('No se encontró el negocio asociado a esta cuenta. Revisa el trigger rewards_on_auth_user_created.');
  const payload={...p,business_id:b.id};
  delete payload.id;
  const existing=await getProgram();
  if(existing){
    const {data,error}=await sb.from('rewards_loyalty_programs').update(payload).eq('id',existing.id).select().single();
    if(error)throw error;
    return data;
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
function navActive(){const p=location.pathname.split('/').pop();$$('.nav-item').forEach(a=>{if(a.getAttribute('href')?.endsWith(p))a.classList.add('active')})}

window.ENLA={sb,configured,configError,ensureConfigured,currentUser,requireAuth,getBusiness,getProgram,saveProgram,uploadLogo,bindShell,navActive,msg,initials};
