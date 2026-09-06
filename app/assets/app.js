
const CFG=window.ENLA_CONFIG||{};
const configured=CFG.SUPABASE_URL&&!CFG.SUPABASE_URL.includes('YOUR-PROJECT')&&CFG.SUPABASE_ANON_KEY&&!CFG.SUPABASE_ANON_KEY.includes('YOUR_');
const sb=configured&&window.supabase?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY):null;
const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
function msg(el,text,type='error'){if(!el)return;el.className=type;el.textContent=text;el.classList.remove('hidden')}
function initials(name='N'){return name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()}
function demoStore(){return JSON.parse(localStorage.getItem('enla_demo')||'{}')}
function saveDemo(v){localStorage.setItem('enla_demo',JSON.stringify(v))}
async function currentUser(){if(!sb)return demoStore().user||null;const {data}=await sb.auth.getUser();return data.user||null}
async function requireAuth(){const u=await currentUser();if(!u){location.href='/app/login.html';return null}return u}
async function signOut(){if(sb)await sb.auth.signOut();else{const d=demoStore();delete d.user;saveDemo(d)}location.href='/app/login.html'}
function bindShell(){const menu=$('#mobileMenu'),side=$('.sidebar'),ov=$('.overlay');if(menu)menu.onclick=()=>{side.classList.add('open');ov.classList.add('show')};if(ov)ov.onclick=()=>{side.classList.remove('open');ov.classList.remove('show')};const so=$('#signOut');if(so)so.onclick=signOut}
async function getBusiness(){if(!sb){const d=demoStore();return d.business||{id:'demo-business',name:'Mi negocio'}}const u=await currentUser();if(!u)return null;const {data,error}=await sb.from('rewards_businesses').select('*').eq('owner_id',u.id).maybeSingle();if(error)throw error;return data}
async function getProgram(){if(!sb){const d=demoStore();return d.program||null}const b=await getBusiness();if(!b)return null;const {data,error}=await sb.from('rewards_loyalty_programs').select('*').eq('business_id',b.id).maybeSingle();if(error)throw error;return data}
async function saveProgram(p){if(!sb){const d=demoStore();d.program={...(d.program||{}),...p,id:d.program?.id||'demo-program'};saveDemo(d);return d.program}const b=await getBusiness();const payload={...p,business_id:b.id};delete payload.id;const existing=await getProgram();if(existing){const {data,error}=await sb.from('rewards_loyalty_programs').update(payload).eq('id',existing.id).select().single();if(error)throw error;return data}else{const {data,error}=await sb.from('rewards_loyalty_programs').insert(payload).select().single();if(error)throw error;return data}}
async function uploadLogo(file){if(!file)return null;if(!sb){return URL.createObjectURL(file)}const u=await currentUser();const ext=file.name.split('.').pop();const path=`${u.id}/logo-${Date.now()}.${ext}`;const {error}=await sb.storage.from('reward-logos').upload(path,file,{upsert:true});if(error)throw error;const {data}=sb.storage.from('reward-logos').getPublicUrl(path);return data.publicUrl}
function navActive(){const p=location.pathname.split('/').pop();$$('.nav-item').forEach(a=>{if(a.getAttribute('href')?.endsWith(p))a.classList.add('active')})}
window.ENLA={sb,configured,currentUser,requireAuth,getBusiness,getProgram,saveProgram,uploadLogo,bindShell,navActive,msg,initials,demoStore,saveDemo};
