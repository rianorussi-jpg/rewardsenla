import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };
const PASS_AUTH_PREFIX = "ApplePass ";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function authToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith(PASS_AUTH_PREFIX) ? h.slice(PASS_AUTH_PREFIX.length).trim() : "";
}

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PASS_TYPE_ID = Deno.env.get("APPLE_PASS_TYPE_ID");
    if (!SUPABASE_URL || !SERVICE_ROLE || !PASS_TYPE_ID) throw new Error("Faltan secretos del backend.");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const url = new URL(req.url);
    const marker = "/apple-wallet-webservice";
    const pos = url.pathname.indexOf(marker);
    const path = pos >= 0 ? url.pathname.slice(pos + marker.length) : url.pathname;
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);

    // POST /v1/log
    if (req.method === "POST" && parts[0] === "v1" && parts[1] === "log") {
      try { console.log("Wallet log", await req.json()); } catch (_) {}
      return new Response(null, { status: 200 });
    }

    // /v1/devices/{device}/registrations/{passType}/{serial?}
    if (parts[0] === "v1" && parts[1] === "devices" && parts[3] === "registrations") {
      const deviceId = parts[2] || "";
      const passType = parts[4] || "";
      const serial = parts[5] || "";
      if (passType !== PASS_TYPE_ID) return new Response(null, { status: 404 });

      if (req.method === "GET" && !serial) {
        const sinceRaw = url.searchParams.get("passesUpdatedSince") || url.searchParams.get("previousLastUpdated") || "0";
        const since = Number(sinceRaw) || 0;
        const { data: regs, error: regError } = await admin.from("rewards_apple_registrations")
          .select("customer_id,serial_number")
          .eq("device_library_identifier", deviceId)
          .eq("pass_type_id", passType);
        if (regError) throw regError;
        if (!regs?.length) return new Response(null, { status: 204 });
        const ids = regs.map(r => r.customer_id);
        const { data: customers, error: cError } = await admin.from("rewards_customers")
          .select("id,apple_serial_number,apple_updated_at")
          .in("id", ids);
        if (cError) throw cError;
        const map = new Map((customers || []).map(c => [c.id, c]));
        const changed = regs.filter(r => Number(map.get(r.customer_id)?.apple_updated_at || 0) > since);
        if (!changed.length) return new Response(null, { status: 204 });
        const lastUpdated = Math.max(...changed.map(r => Number(map.get(r.customer_id)?.apple_updated_at || Date.now())));
        return json({ serialNumbers: changed.map(r => r.serial_number), lastUpdated: String(lastUpdated) });
      }

      if (!serial) return new Response(null, { status: 400 });
      const token = authToken(req);
      const { data: customer, error: cError } = await admin.from("rewards_customers")
        .select("id,apple_auth_token,apple_serial_number")
        .eq("apple_serial_number", serial)
        .maybeSingle();
      if (cError) throw cError;
      if (!customer || !token || token !== customer.apple_auth_token) return new Response(null, { status: 401 });

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pushToken = String(body?.pushToken || "").trim();
        if (!pushToken) return new Response(null, { status: 400 });
        const { data: existing } = await admin.from("rewards_apple_registrations")
          .select("id")
          .eq("device_library_identifier", deviceId)
          .eq("pass_type_id", passType)
          .eq("serial_number", serial)
          .maybeSingle();
        const { error } = await admin.from("rewards_apple_registrations").upsert({
          device_library_identifier: deviceId,
          push_token: pushToken,
          pass_type_id: passType,
          serial_number: serial,
          customer_id: customer.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "device_library_identifier,pass_type_id,serial_number" });
        if (error) throw error;
        return new Response(null, { status: existing ? 200 : 201 });
      }

      if (req.method === "DELETE") {
        const { error } = await admin.from("rewards_apple_registrations")
          .delete()
          .eq("device_library_identifier", deviceId)
          .eq("pass_type_id", passType)
          .eq("serial_number", serial);
        if (error) throw error;
        return new Response(null, { status: 200 });
      }
    }

    // GET /v1/passes/{passType}/{serial}
    if (req.method === "GET" && parts[0] === "v1" && parts[1] === "passes") {
      const passType = parts[2] || "";
      const serial = parts[3] || "";
      if (passType !== PASS_TYPE_ID || !serial) return new Response(null, { status: 404 });
      const token = authToken(req);
      const { data: customer, error: cError } = await admin.from("rewards_customers")
        .select("public_code,apple_auth_token,apple_updated_at")
        .eq("apple_serial_number", serial)
        .maybeSingle();
      if (cError) throw cError;
      if (!customer || !token || token !== customer.apple_auth_token) return new Response(null, { status: 401 });
      const passResp = await fetch(`${SUPABASE_URL}/functions/v1/apple-wallet-pass?c=${encodeURIComponent(customer.public_code)}`, {
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      });
      if (!passResp.ok) return new Response(await passResp.text(), { status: passResp.status });
      const bytes = await passResp.arrayBuffer();
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.pkpass",
          "Cache-Control": "no-store",
          "Last-Modified": new Date(Number(customer.apple_updated_at || Date.now())).toUTCString(),
        },
      });
    }

    return new Response(null, { status: 404 });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
