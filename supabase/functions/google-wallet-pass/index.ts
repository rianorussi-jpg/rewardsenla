import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importPrivateKey(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const b64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signJwt(payload: Record<string, unknown>, privateKeyPem: string, headerExtra: Record<string, unknown> = {}) {
  const header = { alg: "RS256", typ: "JWT", ...headerExtra };
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(payload));
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${base64Url(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(email: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({
    iss: email,
    scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }, privateKey);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error(`Google OAuth: ${data.error_description || data.error || r.statusText}`);
  }
  return data.access_token as string;
}

async function googleRequest(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ISSUER_ID = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
    const SERVICE_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const PRIVATE_KEY = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Faltan secretos internos de Supabase.");
    if (!ISSUER_ID || !SERVICE_EMAIL || !PRIVATE_KEY) throw new Error("Faltan secretos de Google Wallet.");

    const { public_code } = await req.json();
    const code = String(public_code || "").trim().toUpperCase();
    if (!code) return json({ error: "Falta el código de la tarjeta." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: customer, error: customerError } = await admin
      .from("rewards_customers")
      .select("id,business_id,program_id,name,public_code,current_value,status,photo_url,expires_at,last_access_state,google_object_id")
      .eq("public_code", code)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return json({ error: "No encontramos esta tarjeta." }, 404);

    const [{ data: business, error: businessError }, { data: program, error: programError }] = await Promise.all([
      admin.from("rewards_businesses").select("id,business_name,slug").eq("id", customer.business_id).single(),
      admin.from("rewards_loyalty_programs").select("*").eq("id", customer.program_id).single(),
    ]);
    if (businessError) throw businessError;
    if (programError) throw programError;
    if (!program.google_enabled) return json({ error: "Este negocio tiene Google Wallet desactivado." }, 403);

    const safeBusinessId = String(business.id).replace(/[^A-Za-z0-9._-]/g, "_");
    const safeCustomerId = String(customer.id).replace(/[^A-Za-z0-9._-]/g, "_");
    const classId = program.program_type === "access" ? `${ISSUER_ID}.access_${safeBusinessId}_${String(program.id).replace(/[^A-Za-z0-9._-]/g, "_")}` : `${ISSUER_ID}.rewards_${safeBusinessId}`;
    const objectId = `${ISSUER_ID}.customer_${safeCustomerId}`;
    const color = /^#[0-9a-fA-F]{6}$/.test(program.primary_color || "") ? program.primary_color : "#4b63f3";
    const issuerName = String(program.display_name || business.business_name || "Enla Rewards").slice(0, 60);
    const programName = String(program.program_name || "Rewards").slice(0, 60);

    const loyaltyClass: any = {
      id: classId,
      issuerName,
      programName,
      reviewStatus: "UNDER_REVIEW",
      hexBackgroundColor: color,
    };
    if (program.logo_url) {
      loyaltyClass.programLogo = {
        sourceUri: { uri: program.logo_url },
        contentDescription: { defaultValue: { language: "es", value: `Logo de ${issuerName}` } },
      };
    }
    if (program.program_type !== "stamps" && program.central_image_url) {
      loyaltyClass.heroImage = {
        sourceUri: { uri: program.central_image_url },
        contentDescription: { defaultValue: { language: "es", value: `Promoción de ${issuerName}` } },
      };
    }

    const rawValue = Math.max(0, Number(customer.current_value || 0));
    const value = program.program_type === 'cashback' ? Math.round(rawValue * 100) / 100 : Math.floor(rawValue);
    const isAccess = program.program_type === "access";
    const expiryText = customer.expires_at ? new Date(customer.expires_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    const loyaltyObject: any = {
      id: objectId,
      classId,
      state: customer.status === "inactive" ? "INACTIVE" : "ACTIVE",
      accountId: customer.public_code,
      accountName: customer.name,
      barcode: {
        type: program.barcode_format === "code128" ? "CODE_128" : "QR_CODE",
        value: customer.public_code,
        alternateText: customer.public_code,
      },
      textModulesData: isAccess ? [
        { id: "service", header: "Servicio", body: String(program.service_name || programName) },
        { id: "expires", header: "Vencimiento", body: expiryText },
        { id: "customer", header: "Cliente", body: customer.name },
      ] : [
        { id: "promo", header: program.program_type === "visits" ? "Paquete" : "Promoción", body: program.promo_text || (program.program_type === "visits" ? `Incluye ${program.goal_count || 8} visitas.` : `Acumula ${program.goal_count || 6} y recibe tu recompensa.`) },
        program.program_type === 'cashback'
          ? { id: 'reward', header: 'Saldo', body: `$${Number(value).toFixed(2)}` }
          : program.program_type === 'visits'
            ? { id: 'visits', header: customer.status === 'inactive' ? 'Estado' : 'Visitas restantes', body: customer.status === 'inactive' ? 'Tarjeta inactiva' : `${value} de ${program.goal_count || 8}` }
            : { id: "reward", header: "Recompensa", body: program.reward_text || "Recompensa especial" },
      ],
      hexBackgroundColor: color,
    };
    if (!isAccess) loyaltyObject.loyaltyPoints = {
      label: program.program_type === "cashback" ? "Saldo" : program.program_type === "visits" ? "Visitas restantes" : "Sellos",
      balance: program.program_type === 'cashback' ? { double: value } : { int: value },
    };

    const token = await getGoogleAccessToken(SERVICE_EMAIL, PRIVATE_KEY);

    // Crea o actualiza la clase para que cambios de logo/color/nombre se reflejen.
    const classGet = await googleRequest(`loyaltyClass/${encodeURIComponent(classId)}`, token);
    if (classGet.status === 404) {
      const created = await googleRequest("loyaltyClass", token, { method: "POST", body: JSON.stringify(loyaltyClass) });
      if (!created.ok) throw new Error(`Google Wallet class: ${created.data?.error?.message || created.status}`);
    } else if (!classGet.ok) {
      throw new Error(`Google Wallet class: ${classGet.data?.error?.message || classGet.status}`);
    } else {
      const patched = await googleRequest(`loyaltyClass/${encodeURIComponent(classId)}`, token, { method: "PATCH", body: JSON.stringify(loyaltyClass) });
      if (!patched.ok) throw new Error(`Google Wallet class update: ${patched.data?.error?.message || patched.status}`);
    }

    const objectGet = await googleRequest(`loyaltyObject/${encodeURIComponent(objectId)}`, token);
    if (objectGet.status === 404) {
      const created = await googleRequest("loyaltyObject", token, { method: "POST", body: JSON.stringify(loyaltyObject) });
      if (!created.ok) throw new Error(`Google Wallet object: ${created.data?.error?.message || created.status}`);
    } else if (!objectGet.ok) {
      throw new Error(`Google Wallet object: ${objectGet.data?.error?.message || objectGet.status}`);
    } else {
      const patched = await googleRequest(`loyaltyObject/${encodeURIComponent(objectId)}`, token, { method: "PATCH", body: JSON.stringify(loyaltyObject) });
      if (!patched.ok) throw new Error(`Google Wallet object update: ${patched.data?.error?.message || patched.status}`);
    }

    await Promise.all([
      admin.from("rewards_loyalty_programs").update({ google_class_id: classId }).eq("id", program.id),
      admin.from("rewards_customers").update({ google_object_id: objectId }).eq("id", customer.id),
    ]);

    const now = Math.floor(Date.now() / 1000);
    const saveJwt = await signJwt({
      iss: SERVICE_EMAIL,
      aud: "google",
      typ: "savetowallet",
      iat: now,
      payload: {
        loyaltyObjects: [loyaltyObject],
      },
    }, PRIVATE_KEY);

    return json({
      url: `https://pay.google.com/gp/v/save/${saveJwt}`,
      class_id: classId,
      object_id: objectId,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
