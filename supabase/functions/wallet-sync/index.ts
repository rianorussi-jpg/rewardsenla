import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function base64Url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function encodeJson(v: unknown) { return base64Url(new TextEncoder().encode(JSON.stringify(v))); }

async function importApnsKey(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const b64 = normalized.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function apnsJwt(teamId: string, keyId: string, privateKey: string) {
  const header = encodeJson({ alg: "ES256", kid: keyId });
  const payload = encodeJson({ iss: teamId, iat: Math.floor(Date.now() / 1000) });
  const key = await importApnsKey(privateKey);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(sig))}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    if (!SUPABASE_URL || !ANON || !SERVICE_ROLE || !auth) return json({ error: "No autorizado." }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sesión inválida." }, 401);

    const { public_code } = await req.json();
    const code = String(public_code || "").trim().toUpperCase();
    if (!code) return json({ error: "Falta public_code." }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: business, error: bError } = await admin.from("rewards_businesses").select("id").eq("owner_id", userData.user.id).maybeSingle();
    if (bError) throw bError;
    if (!business) return json({ error: "No se encontró tu negocio." }, 403);
    const { data: customer, error: cError } = await admin.from("rewards_customers")
      .select("id,public_code,apple_serial_number")
      .eq("business_id", business.id).eq("public_code", code).maybeSingle();
    if (cError) throw cError;
    if (!customer) return json({ error: "El cliente no pertenece a tu negocio." }, 404);

    const result: any = { google: null, apple: { pushed: 0, failed: 0, configured: false, registrations: 0, errors: [] as any[] } };

    // Google Wallet: la función existente hace PATCH del LoyaltyObject.
    try {
      const g = await fetch(`${SUPABASE_URL}/functions/v1/google-wallet-pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ public_code: code }),
      });
      const gt = await g.text();
      result.google = { ok: g.ok, status: g.status, body: gt ? JSON.parse(gt) : null };
    } catch (e) { result.google = { ok: false, error: String(e) }; }

    const KEY_ID = Deno.env.get("APPLE_APNS_KEY_ID");
    const APNS_KEY = Deno.env.get("APPLE_APNS_PRIVATE_KEY");
    const TEAM_ID = Deno.env.get("APPLE_TEAM_ID");
    const PASS_TYPE_ID = Deno.env.get("APPLE_PASS_TYPE_ID");
    if (KEY_ID && APNS_KEY && TEAM_ID && PASS_TYPE_ID && customer.apple_serial_number) {
      result.apple.configured = true;
      const { data: regs, error: regError } = await admin.from("rewards_apple_registrations")
        .select("id,push_token").eq("customer_id", customer.id);
      if (regError) throw regError;
      result.apple.registrations = regs?.length || 0;
      if (regs?.length) {
        const jwt = await apnsJwt(TEAM_ID, KEY_ID, APNS_KEY);
        for (const reg of regs) {
          try {
            const push = await fetch(`https://api.push.apple.com/3/device/${encodeURIComponent(reg.push_token)}`, {
              method: "POST",
              headers: {
                Authorization: `bearer ${jwt}`,
                "apns-topic": PASS_TYPE_ID,
                "apns-priority": "10",
                "Content-Type": "application/json",
              },
              body: "{}",
            });
            if (push.ok) result.apple.pushed++;
            else {
              result.apple.failed++;
              const body = await push.text();
              result.apple.errors.push({ status: push.status, body });
              if (push.status === 410 || body.includes("BadDeviceToken") || body.includes("Unregistered")) {
                await admin.from("rewards_apple_registrations").delete().eq("id", reg.id);
              }
            }
          } catch (_) { result.apple.failed++; }
        }
      }
    }

    return json(result);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
