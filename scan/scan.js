(() => {
  const CFG = window.ENLA_CONFIG || {};
  const app = document.querySelector('#app');

  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    app.innerHTML = `<div class="boot-screen"><div class="notice error">Supabase no está configurado.</div></div>`;
    return;
  }

  // Sesión persistente específica para scan.enlacards.com.
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'enlacards-scan-auth'
    }
  });

  let session = null;
  let programs = [];
  let selectedProgram = null;
  let scanner = null;
  let activeCustomer = null;
  let searchTimer = null;

  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  const initials = (name='') => name.trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase() || 'EC';
  const money = n => '$' + Number(n || 0).toFixed(2);
  const fmtDate = v => v ? new Date(v).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  function typeName(type) {
    return ({stamps:'Sellos',cashback:'Cashback',visits:'Visitas',access:'Acceso'})[type] || 'Tarjeta';
  }
  function typeIcon(type) {
    return ({stamps:'⭐',cashback:'💵',visits:'🎟️',access:'🪪'})[type] || '💳';
  }

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
  }

  function programPreview(p) {
    const bg = safeColor(p.primary_color, '#4499f7');
    const fg = safeColor(p.text_color, '#ffffff');
    const stamp = esc(p.stamp_icon || '⭐');
    const goal = Math.max(1, Number(p.goal_count || 6));
    const shownStamps = Math.min(goal, 8);

    let middle = '';

    if (p.program_type === 'stamps') {
      middle = `
        <div class="wallet-stamps">
          ${Array.from({length: shownStamps}).map((_, i) => {
            const filled = i < Math.min(2, shownStamps);
            if (p.stamp_filled_image_url) {
              return `<span class="stamp-image-wrap ${filled ? 'filled' : 'empty'}"><img src="${esc(p.stamp_filled_image_url)}" alt=""></span>`;
            }
            return `<span class="${filled ? 'filled' : ''}">${stamp}</span>`;
          }).join('')}
          ${goal > shownStamps ? `<small>+${goal - shownStamps}</small>` : ''}
        </div>`;
    } else if (p.central_image_url) {
      middle = `<img class="wallet-strip" src="${esc(p.central_image_url)}" alt="">`;
    } else if (p.program_type === 'cashback') {
      middle = `<div class="wallet-big-value">$0.00</div>`;
    } else if (p.program_type === 'visits') {
      middle = `<div class="wallet-big-value">${goal} visitas</div>`;
    } else {
      middle = `<div class="wallet-big-value">${esc(p.service_name || 'Acceso')}</div>`;
    }

    const footer =
      p.program_type === 'stamps'
        ? `<span>${esc(p.reward_text || 'Recompensa')}</span><b>2 / ${goal}</b>`
      : p.program_type === 'cashback'
        ? `<span>${esc(p.promo_text || 'Acumula cashback')}</span><b>SALDO</b>`
      : p.program_type === 'visits'
        ? `<span>${esc(p.promo_text || 'Paquete de visitas')}</span><b>${goal}</b>`
      : `<span>${esc(p.promo_text || 'Identificación / acceso')}</span><b>ACTIVA</b>`;

    return `
      <div class="wallet-preview" style="--card-bg:${bg};--card-fg:${fg}">
        <div class="wallet-preview-top">
          ${p.logo_url
            ? `<img src="${esc(p.logo_url)}" alt="">`
            : `<strong>${esc(p.display_name || p.program_name)}</strong>`}
          <span>${typeName(p.program_type)}</span>
        </div>
        <div class="wallet-preview-middle">${middle}</div>
        <div class="wallet-preview-bottom">${footer}</div>
      </div>`;
  }

  function shell(inner) {
    return `
      <div class="scan-shell">
        <header class="scan-top">
          <div class="scan-top-inner">
            <img src="/assets/enla-cards-logo.png" alt="Enla Cards">
            <div class="top-actions">
              <span class="top-user">${esc(session?.user?.email || '')}</span>
              <button class="btn btn-secondary" id="logoutBtn">Cerrar sesión</button>
            </div>
          </div>
        </header>
        <main class="scan-main">${inner}</main>
      </div>`;
  }

  function bindLogout() {
    const b = document.querySelector('#logoutBtn');
    if (b) b.onclick = async () => {
      await stopScanner();
      await sb.auth.signOut();
      session = null; programs = []; selectedProgram = null; activeCustomer = null;
      renderLogin();
    };
  }

  function showInline(id, message, type='error') {
    const el = document.querySelector(id);
    if (!el) return;
    el.className = `notice ${type}`;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function renderLogin(prefillEmail='') {
    app.innerHTML = `
      <div class="scan-login">
        <section class="login-visual">
          <div class="login-brand"><img src="/assets/enla-cards-logo.png" alt="Enla Cards"></div>
          <div class="login-copy">
            <div class="eyebrow">Enla Cards Scan</div>
            <h1>Tu mostrador,<br>más rápido.</h1>
            <p>Escanea clientes, encuentra tarjetas y registra movimientos sin entrar al panel completo.</p>
            <div class="login-pills">
              <span>⌁ Escáner rápido</span>
              <span>◎ Búsqueda de clientes</span>
              <span>✓ Sin contraseñas</span>
            </div>
          </div>
          <div></div>
        </section>
        <main class="login-main">
          <form class="login-card" id="loginForm">
            <div class="login-security-mark">✉</div>
            <h2>Entrar a Scan</h2>
            <p>Escribe tu correo. Te enviaremos un código de acceso para entrar sin contraseña.</p>
            <div id="loginNotice" class="hidden"></div>
            <div class="field">
              <label>Correo</label>
              <input id="loginEmail" type="email" autocomplete="email" required placeholder="tu@negocio.com" value="${esc(prefillEmail)}">
            </div>
            <button class="btn btn-primary btn-block" id="loginBtn" type="submit">Enviar código</button>
            <div class="login-foot">La sesión quedará guardada en este dispositivo hasta que cierres sesión.</div>
          </form>
        </main>
      </div>`;

    document.querySelector('#loginForm').onsubmit = async e => {
      e.preventDefault();
      const email = document.querySelector('#loginEmail').value.trim().toLowerCase();
      const btn = document.querySelector('#loginBtn');
      btn.disabled = true; btn.textContent = 'Enviando código...';
      try {
        const redirect = location.origin + location.pathname + location.search;
        const {error} = await sb.auth.signInWithOtp({
          email,
          options: {shouldCreateUser:true,emailRedirectTo:redirect}
        });
        if (error) throw error;
        renderOtp(email);
      } catch (err) {
        showInline('#loginNotice', err.message || String(err));
        btn.disabled = false; btn.textContent = 'Enviar código';
      }
    };
  }

  function renderOtp(email) {
    app.innerHTML = `
      <div class="scan-login">
        <section class="login-visual">
          <div class="login-brand"><img src="/assets/enla-cards-logo.png" alt="Enla Cards"></div>
          <div class="login-copy">
            <div class="eyebrow">Código enviado</div>
            <h1>Revisa tu<br>correo.</h1>
            <p>Enviamos un código de acceso a ${esc(email)}. También puedes usar el enlace seguro incluido en el correo.</p>
          </div>
          <div></div>
        </section>
        <main class="login-main">
          <form class="login-card" id="otpForm">
            <div class="login-security-mark">✓</div>
            <h2>Escribe tu código</h2>
            <p>Ingresa el código que te enviamos a <b>${esc(email)}</b>.</p>
            <div id="otpNotice" class="hidden"></div>
            <div class="field">
              <label>Código de acceso</label>
              <input id="otpCode" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" minlength="6" pattern="[0-9]{6}" required placeholder="000000">
            </div>
            <button class="btn btn-primary btn-block" id="otpBtn" type="submit">Entrar a Scan</button>
            <div class="otp-actions">
              <button class="link-button" type="button" id="resendOtp">Reenviar código</button>
              <button class="link-button" type="button" id="changeEmail">Usar otro correo</button>
            </div>
          </form>
        </main>
      </div>`;

    const otpInput=document.querySelector('#otpCode');
    otpInput.addEventListener('input',()=>{
      otpInput.value=otpInput.value.replace(/\D/g,'').slice(0,6);
    });

    document.querySelector('#otpForm').onsubmit = async e => {
      e.preventDefault();
      const btn=document.querySelector('#otpBtn');
      btn.disabled=true;btn.textContent='Verificando...';
      try{
        const token=document.querySelector('#otpCode').value.replace(/\D/g,'').slice(0,6);
        if(token.length!==6)throw new Error('El código debe tener 6 dígitos.');
        const {data,error}=await sb.auth.verifyOtp({email,token,type:'email'});
        if(error)throw error;
        session=data.session;
        await loadPrograms();
      }catch(err){
        showInline('#otpNotice',err.message||String(err));
        btn.disabled=false;btn.textContent='Entrar a Scan';
      }
    };

    document.querySelector('#changeEmail').onclick=()=>renderLogin(email);
    document.querySelector('#resendOtp').onclick=async()=>{
      const b=document.querySelector('#resendOtp');
      b.disabled=true;b.textContent='Enviando...';
      try{
        const redirect=location.origin+location.pathname+location.search;
        const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:redirect}});
        if(error)throw error;
        showInline('#otpNotice','Te enviamos un código nuevo.','success');
      }catch(err){
        showInline('#otpNotice',err.message||String(err));
      }finally{
        b.disabled=false;b.textContent='Reenviar código';
      }
    };
  }

  async function acceptInvitation(programId, quiet=false) {
    const {data,error}=await sb.rpc('rewards_accept_staff_invitation',{p_program_id:programId});
    if(error) {
      if(!quiet) alert(error.message);
      throw error;
    }
    return data===true || (Array.isArray(data) && data[0]===true);
  }

  async function loadPendingInvitations() {
    const {data,error}=await sb.rpc('rewards_scan_pending_invitations');
    if(error) throw error;
    return data || [];
  }

  async function loadPrograms() {
    app.innerHTML = shell(`<div class="loading-line">Cargando tarjetas disponibles...</div>`);
    bindLogout();

    try {
      const params = new URLSearchParams(location.search);
      const invitedProgram = params.get('invite');

      if (invitedProgram) {
        try {
          await acceptInvitation(invitedProgram, true);
          params.delete('invite');
          const clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
          history.replaceState({}, '', clean);
        } catch (_) {}
      }

      try { await sb.rpc('rewards_claim_staff_assignments'); } catch (_) {}

      const [{data,error}, pending] = await Promise.all([
        sb.rpc('rewards_scan_programs'),
        loadPendingInvitations()
      ]);
      if (error) throw error;
      programs = data || [];
      renderPrograms(pending);
    } catch (err) {
      app.innerHTML = shell(`
        <div class="notice error">${esc(err.message || err)}</div>
        <button class="btn btn-secondary" id="retryPrograms">Reintentar</button>`);
      bindLogout();
      document.querySelector('#retryPrograms').onclick = loadPrograms;
    }
  }

  function renderPrograms(pending=[]) {
    app.innerHTML = shell(`
      <div class="screen-head">
        <div>
          <div class="screen-eyebrow">Enla Cards Scan</div>
          <h1>¿Qué tarjeta vas a operar?</h1>
          <p>Solo aparecen las tarjetas de las que eres dueño o empleado autorizado.</p>
        </div>
      </div>

      ${pending.length ? `
        <section class="pending-invites">
          <div class="pending-invites-head">
            <div>
              <div class="screen-eyebrow">Invitaciones pendientes</div>
              <h2>Te invitaron a operar ${pending.length===1?'una tarjeta':pending.length+' tarjetas'}</h2>
              <p>Acepta la tarjeta para que aparezca entre tus accesos de Scan.</p>
            </div>
          </div>
          <div class="pending-grid">
            ${pending.map(inv=>`
              <article class="pending-card">
                <div class="pending-card-brand">
                  ${inv.logo_url?`<img src="${esc(inv.logo_url)}" alt="">`:`<div class="program-icon">${typeIcon(inv.program_type)}</div>`}
                  <div><b>${esc(inv.display_name||inv.program_name)}</b><span>${esc(inv.program_name)} · ${typeName(inv.program_type)}</span></div>
                </div>
                <button class="btn btn-primary accept-invite" data-invite="${inv.program_id}">Aceptar tarjeta</button>
              </article>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <div class="program-grid">
        ${programs.map(p => `
          <button class="program-card" data-program="${p.id}">
            ${programPreview(p)}
            <div class="program-meta">
              <div>
                <h3>${esc(p.display_name || p.program_name)}</h3>
                <p>${esc(p.program_name)} · ${typeName(p.program_type)}</p>
              </div>
              <span class="role-chip">${p.access_role === 'owner' ? 'Dueño' : 'Empleado'}</span>
            </div>
            <div class="enter">Abrir para escanear →</div>
          </button>
        `).join('') || `
          <div class="panel" style="grid-column:1/-1;text-align:center;padding:44px">
            <h2>No tienes tarjetas disponibles</h2>
            <p class="panel-sub">Pídele al dueño que agregue tu correo como empleado de una tarjeta.</p>
          </div>`}
      </div>
    `);
    bindLogout();

    document.querySelectorAll('.accept-invite').forEach(btn => {
      btn.onclick = async () => {
        const original=btn.textContent;
        btn.disabled=true;btn.textContent='Aceptando...';
        try{
          await acceptInvitation(btn.dataset.invite);
          await loadPrograms();
        }catch(err){
          btn.disabled=false;btn.textContent=original;
          alert(err.message||String(err));
        }
      };
    });

    document.querySelectorAll('[data-program]').forEach(btn => {
      btn.onclick = () => {
        selectedProgram = programs.find(p => p.id === btn.dataset.program);
        activeCustomer = null;
        renderOperator();
      };
    });
  }

  function renderOperator() {
    const p = selectedProgram;
    app.innerHTML = shell(`
      <div class="operator-head">
        <div class="operator-program">
          ${p.logo_url
            ? `<img class="program-logo" src="${esc(p.logo_url)}" alt="">`
            : `<div class="program-icon">${typeIcon(p.program_type)}</div>`}
          <div>
            <h1>${esc(p.display_name || p.program_name)}</h1>
            <p>${typeName(p.program_type)} · ${p.access_role === 'owner' ? 'Dueño' : 'Empleado'}</p>
          </div>
        </div>
        <button class="btn btn-secondary" id="changeProgram">Cambiar tarjeta</button>
      </div>

      <div class="operator-grid">
        <section class="panel">
          <h2>Encuentra al cliente</h2>
          <p class="panel-sub">Escanea su Wallet o busca por código, correo, teléfono o nombre.</p>

          <div class="search-wrap">
            <span class="search-icon">⌕</span>
            <input class="input search-input" id="customerSearch"
              placeholder="Código, correo, teléfono o nombre..." autocomplete="off">
          </div>
          <div class="search-results" id="searchResults"></div>

          <div class="divider">o escanea</div>

          <div class="camera-box is-off" id="cameraBox">
            <div class="camera-placeholder" id="cameraPlaceholder">
              <div style="font-size:32px">⌗</div>
              <strong>Escáner listo</strong>
              <span style="font-size:9px">Usa la cámara para leer QR o código de Wallet</span>
            </div>
            <div id="reader" class="hidden"></div>
          </div>
          <div class="camera-actions">
            <button class="btn btn-primary" id="startCamera">Abrir cámara</button>
            <button class="btn btn-secondary hidden" id="stopCamera">Cerrar cámara</button>
          </div>
          <p class="scan-note">La búsqueda y el escáner solo muestran clientes de esta tarjeta.</p>
        </section>

        <section class="panel" id="customerPanel">
          ${emptyCustomerHtml()}
        </section>
      </div>
    `);
    bindLogout();

    document.querySelector('#changeProgram').onclick = async () => {
      await stopScanner();
      activeCustomer = null;
      renderPrograms();
    };

    const input = document.querySelector('#customerSearch');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (!q) {
        document.querySelector('#searchResults').innerHTML = '';
        return;
      }
      searchTimer = setTimeout(() => searchCustomers(q), 240);
    });

    document.querySelector('#startCamera').onclick = startScanner;
    document.querySelector('#stopCamera').onclick = stopScanner;
  }

  function emptyCustomerHtml() {
    return `
      <div class="customer-empty">
        <div>
          <div class="customer-empty-icon">◎</div>
          <h3>Selecciona un cliente</h3>
          <p>Su información, progreso y acciones aparecerán aquí después de escanear o buscar.</p>
        </div>
      </div>`;
  }

  async function searchCustomers(query, fromScanner=false) {
    const results = document.querySelector('#searchResults');
    if (results) results.innerHTML = `<div class="loading-line">Buscando...</div>`;

    const {data,error} = await sb.rpc('rewards_scan_search', {
      p_program_id: selectedProgram.id,
      p_query: query
    });
    if (error) {
      if (results) results.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
      return;
    }

    const rows = data || [];

    if (fromScanner) {
      const exact = rows.find(x =>
        String(x.public_code || '').toUpperCase() === String(query).trim().toUpperCase() ||
        String(x.dynamic_code || '').toUpperCase() === String(query).trim().toUpperCase()
      ) || rows[0];

      if (exact) {
        await stopScanner();
        activeCustomer = exact;
        renderCustomer(exact);
        if (results) results.innerHTML = '';
      } else if (results) {
        results.innerHTML = `<div class="notice error">No encontramos este código en la tarjeta seleccionada.</div>`;
      }
      return;
    }

    if (!results) return;
    results.innerHTML = rows.map(c => `
      <button class="search-row" data-customer="${c.id}">
        <span>
          <b>${esc(c.name)}</b>
          <small>${esc(c.email || 'Sin correo')}${c.phone?` · ${esc(c.phone)}`:''}</small>
        </span>
        <span class="search-code">${esc(c.public_code)}</span>
      </button>
    `).join('') || `<div class="loading-line">No encontramos clientes con “${esc(query)}”.</div>`;

    results.querySelectorAll('[data-customer]').forEach(btn => {
      btn.onclick = () => {
        activeCustomer = rows.find(x => x.id === btn.dataset.customer);
        renderCustomer(activeCustomer);
      };
    });
  }

  function renderCustomer(c, success='') {
    activeCustomer = c;
    const p = selectedProgram;
    const type = p.program_type;
    const value = Number(c.current_value || 0);
    const goal = Number(p.goal_count || 0);
    const expired = type === 'access' && (!c.expires_at || new Date(c.expires_at).getTime() < Date.now());
    const inactive = c.status !== 'active';

    let mainStat = '';
    if (type === 'cashback') mainStat = money(value);
    else if (type === 'visits') mainStat = `${value} disponibles`;
    else if (type === 'access') mainStat = expired ? 'Vencida' : 'Activa';
    else mainStat = `${value} / ${goal}`;

    let actions = '';
    if (!inactive) {
      if (type === 'stamps') {
        actions = `
          <div class="action-grid">
            <button class="btn btn-primary" data-action="add_stamp">+ Agregar sello</button>
            <button class="btn btn-secondary" data-action="remove_stamp" ${value<=0?'disabled':''}>− Quitar sello</button>
          </div>
          ${value >= goal ? `<div class="action-grid one" style="margin-top:8px"><button class="btn btn-mint" data-action="redeem">Canjear recompensa</button></div>` : ''}`;
      } else if (type === 'cashback') {
        actions = `
          <div class="amount-row">
            <div class="amount-input"><span>$</span><input class="input" id="actionAmount" type="number" inputmode="decimal" min=".01" step=".01" placeholder="0.00"></div>
          </div>
          <div class="action-grid">
            <button class="btn btn-primary" data-action="add_cashback">Agregar cashback</button>
            <button class="btn btn-secondary" data-action="remove_cashback" ${value<=0?'disabled':''}>Usar / quitar saldo</button>
          </div>`;
      } else if (type === 'visits') {
        actions = `
          <div class="action-grid">
            <button class="btn btn-primary" data-action="use_visit" ${value<=0?'disabled':''}>Usar 1 visita</button>
            <button class="btn btn-secondary" data-action="add_visit">+ Devolver visita</button>
          </div>`;
      } else if (type === 'access') {
        if (expired) {
          actions = `<div class="status-bad">Esta credencial está vencida. La renovación se hace desde el panel principal.</div>`;
        } else if (p.access_mode === 'entry_exit') {
          actions = `
            <div class="action-grid">
              <button class="btn ${c.last_access_state==='in'?'btn-secondary':'btn-primary'}" data-action="access_in">Registrar entrada</button>
              <button class="btn ${c.last_access_state==='in'?'btn-primary':'btn-secondary'}" data-action="access_out">Registrar salida</button>
            </div>`;
        } else {
          actions = `<div class="action-grid one"><button class="btn btn-primary" data-action="access_entry">Registrar acceso</button></div>`;
        }
      }
    }

    const panel = document.querySelector('#customerPanel');
    panel.innerHTML = `
      <article class="customer-card">
        ${success ? `<div class="result-notice">${esc(success)}</div>` : ''}
        <div class="customer-head">
          ${c.photo_url
            ? `<img class="avatar" src="${esc(c.photo_url)}" alt="">`
            : `<div class="avatar">${initials(c.name)}</div>`}
          <div>
            <h2>${esc(c.name)}</h2>
            <p>${esc(c.email || 'Sin correo')}${c.phone?` · ${esc(c.phone)}`:''}</p>
          </div>
          <div class="customer-code"><small>Código</small><b>${esc(c.public_code)}</b></div>
        </div>

        ${inactive ? `<div class="status-bad">Esta tarjeta está suspendida.</div>` : ''}
        ${type==='access' && !expired && !inactive ? `<div class="status-good">Credencial válida para operar.</div>` : ''}

        <div class="stat-grid">
          <div class="stat-box">
            <small>${type==='cashback'?'Saldo':type==='visits'?'Visitas':type==='access'?'Estado':'Sellos'}</small>
            <strong>${esc(mainStat)}</strong>
          </div>
          <div class="stat-box">
            <small>${type==='access'?'Vencimiento':'Programa'}</small>
            <strong style="font-size:13px">${type==='access'?esc(fmtDate(c.expires_at)):esc(p.program_name)}</strong>
          </div>
        </div>

        ${type==='stamps' && value>=goal ? `<div class="reward-box">🎁 Recompensa lista: <b>${esc(p.reward_text || 'Recompensa')}</b></div>` : ''}
        ${type==='access' && p.access_mode==='entry_exit' ? `<div class="stat-box"><small>Estado actual</small><strong>${c.last_access_state==='in'?'Dentro':'Fuera'}</strong></div>` : ''}

        <div class="action-zone">
          <h3>Acciones</h3>
          ${actions || `<div class="scan-note">No hay acciones disponibles para esta tarjeta en este momento.</div>`}
        </div>
      </article>
    `;

    panel.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = () => executeAction(btn.dataset.action, btn);
    });
  }

  async function executeAction(action, btn) {
    let amount = null;
    if (action === 'add_cashback' || action === 'remove_cashback') {
      amount = Number(document.querySelector('#actionAmount')?.value || 0);
      if (!amount || amount <= 0) {
        alert('Escribe un monto mayor a $0.');
        return;
      }
    }

    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Procesando...';

    try {
      const {data,error} = await sb.rpc('rewards_scan_console_action', {
        p_customer_id: activeCustomer.id,
        p_action: action,
        p_amount: amount
      });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;

      activeCustomer.current_value = r.current_value;
      activeCustomer.status = r.status;
      activeCustomer.expires_at = r.expires_at;
      activeCustomer.last_access_state = r.last_access_state;
      if (r.dynamic_code) activeCustomer.dynamic_code = r.dynamic_code;

      // Actualiza Apple/Google Wallet si el cliente tiene una instalada.
      try {
        await sb.functions.invoke('wallet-sync', { body: { public_code: r.public_code } });
      } catch (_) {}

      const labels = {
        add_stamp:'Sello agregado.',
        remove_stamp:'Sello retirado.',
        redeem:'Recompensa canjeada.',
        add_cashback:'Cashback agregado.',
        remove_cashback:'Saldo utilizado.',
        use_visit:'Visita utilizada.',
        add_visit:'Visita devuelta.',
        access_in:'Entrada registrada.',
        access_out:'Salida registrada.',
        access_entry:'Acceso registrado.'
      };
      renderCustomer(activeCustomer, labels[action] || 'Movimiento registrado.');
    } catch (err) {
      alert(err.message || String(err));
      btn.disabled = false; btn.textContent = original;
    }
  }

  async function startScanner() {
    if (scanner) return;
    const reader = document.querySelector('#reader');
    const placeholder = document.querySelector('#cameraPlaceholder');
    const box = document.querySelector('#cameraBox');

    reader.classList.remove('hidden');
    placeholder.classList.add('hidden');
    box.classList.remove('is-off');
    document.querySelector('#startCamera').classList.add('hidden');
    document.querySelector('#stopCamera').classList.remove('hidden');

    scanner = new Html5Qrcode('reader');
    try {
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: (vw, vh) => {
            const width = Math.min(vw * .88, 420);
            const height = Math.min(vh * .50, 190);
            return { width: Math.floor(width), height: Math.floor(height) };
          },
          aspectRatio: 1.5
        },
        async decodedText => {
          if (!decodedText) return;
          const input = document.querySelector('#customerSearch');
          if (input) input.value = decodedText;
          await searchCustomers(decodedText, true);
        }
      );
    } catch (err) {
      scanner = null;
      reader.classList.add('hidden');
      placeholder.classList.remove('hidden');
      box.classList.add('is-off');
      document.querySelector('#startCamera').classList.remove('hidden');
      document.querySelector('#stopCamera').classList.add('hidden');
      alert('No pudimos abrir la cámara. Revisa los permisos del navegador.');
    }
  }

  async function stopScanner() {
    if (!scanner) return;
    try { await scanner.stop(); } catch (_) {}
    try { await scanner.clear(); } catch (_) {}
    scanner = null;

    const reader = document.querySelector('#reader');
    const placeholder = document.querySelector('#cameraPlaceholder');
    const box = document.querySelector('#cameraBox');
    if (reader) reader.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    if (box) box.classList.add('is-off');
    document.querySelector('#startCamera')?.classList.remove('hidden');
    document.querySelector('#stopCamera')?.classList.add('hidden');
  }

  async function boot() {
    const code = new URLSearchParams(location.search).get('code');
    if (code) {
      try { await sb.auth.exchangeCodeForSession(code); } catch (_) {}
    }

    const {data} = await sb.auth.getSession();
    session = data.session;

    if (!session) {
      renderLogin();
      return;
    }
    await loadPrograms();
  }

  sb.auth.onAuthStateChange((event, newSession) => {
    session = newSession;
    if (event === 'SIGNED_OUT') renderLogin();
  });

  boot();
})();
