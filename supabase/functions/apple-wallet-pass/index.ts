import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ICON_1X = "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAAc0lEQVR42mP0Tv78n4HOgIlhAMCopaOWDl1LWcjRtGUOD5ztk/KF9j5FthAbfzROkQEjvrKXnKAjJq5xWorLQmyGkaKW5ODFZQipKXjoxCmyz0gNWoKWkpKwSAnikROnQ8NS9KAkp8BnHG0Njlo6aikpAAA0rTGH3PwtygAAAABJRU5ErkJggg==";
const ICON_2X = "iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAA7UlEQVR42u3awRmDIAyGYeHpsZvVLepYHaOb1Xs7gEVL4E9BPo4cNC/yJEENt/vrPQ0w4jTIAAoUKFCgQIECBQoUaOfj4nmz5+O6mZuX9VxP9Btyb75L6BHGAxv/jfTCknWBAh0YmptglAkplLzXTTUApQGnrlHSXJihXoW+FtYEtSD3Asy9ngUb1ch5WQ8Dyw3cstCxlW2mbu4pL0A7yMxVoB6Jo4msq8L+uiCudVTdGSkyc1B92rdiVWVGlowsAStraTMNA3UUKFCgTRyUT3F6qX0ebXrrpjBeJSjw0yNQoECBAgUKFChQoH2PDyo6YWC5fEPFAAAAAElFTkSuQmCC";

function b64ToU8(s: string) {
  const clean = s.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function u8ToBinary(bytes: Uint8Array) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

function binaryToU8(bin: string) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sha1Hex(bytes: Uint8Array) {
  const md = forge.md.sha1.create();
  md.update(u8ToBinary(bytes));
  return md.digest().toHex();
}

function rgb(hex?: string) {
  const h = /^#[0-9a-fA-F]{6}$/.test(hex || "") ? String(hex) : "#4b63f3";
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function parseP12(base64: string, password: string) {
  const der = forge.util.createBuffer(u8ToBinary(b64ToU8(base64)));
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const key = keyBags.find((b: any) => b.key)?.key;
  const certs = certBags.map((b: any) => b.cert).filter(Boolean);
  const leaf = certs.find((c: any) => String(c.subject.getField("CN")?.value || "").includes("Pass Type ID")) || certs[0];
  if (!key || !leaf) throw new Error("No se pudo extraer la clave privada o el certificado del P12. Revisa APPLE_PASS_CERTIFICATE_BASE64 y su contraseña.");
  return { key, leaf };
}

async function fetchWWDRG4() {
  const r = await fetch("https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer");
  if (!r.ok) throw new Error(`No se pudo descargar el certificado WWDR G4 de Apple (${r.status}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const asn1 = forge.asn1.fromDer(u8ToBinary(bytes));
  return forge.pki.certificateFromAsn1(asn1);
}

async function optionalPng(url?: string | null) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("image/png")) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > 2_000_000) return null;
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Método no permitido." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PASS_TYPE_ID = Deno.env.get("APPLE_PASS_TYPE_ID");
    const TEAM_ID = Deno.env.get("APPLE_TEAM_ID");
    const P12_BASE64 = Deno.env.get("APPLE_PASS_CERTIFICATE_BASE64");
    const P12_PASSWORD = Deno.env.get("APPLE_PASS_CERTIFICATE_PASSWORD") || "";
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Faltan secretos internos de Supabase.");
    if (!PASS_TYPE_ID || !TEAM_ID || !P12_BASE64) throw new Error("Faltan secretos de Apple Wallet.");

    const url = new URL(req.url);
    const code = String(url.searchParams.get("c") || "").trim().toUpperCase();
    if (!code) throw new Error("Falta el código de la tarjeta.");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: customer, error: customerError } = await admin
      .from("rewards_customers")
      .select("id,business_id,program_id,name,public_code,current_value,apple_serial_number")
      .eq("public_code", code)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return new Response(JSON.stringify({ error: "No encontramos esta tarjeta." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const [{ data: business, error: businessError }, { data: program, error: programError }] = await Promise.all([
      admin.from("rewards_businesses").select("id,business_name,slug").eq("id", customer.business_id).single(),
      admin.from("rewards_loyalty_programs").select("*").eq("id", customer.program_id).single(),
    ]);
    if (businessError) throw businessError;
    if (programError) throw programError;
    if (!program.apple_enabled) return new Response(JSON.stringify({ error: "Este negocio tiene Apple Wallet desactivado." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const serial = customer.apple_serial_number || String(customer.id);
    const issuerName = String(program.display_name || business.business_name || "Enla Rewards").slice(0, 60);
    const programName = String(program.program_name || "Rewards").slice(0, 60);
    const value = Math.max(0, Math.floor(Number(customer.current_value || 0)));
    const goal = Math.max(1, Math.floor(Number(program.goal_count || 6)));
    const isPoints = program.program_type === "points";
    const progressValue = isPoints ? String(value) : `${value} / ${goal}`;
    const progressLabel = isPoints ? "PUNTOS" : "SELLOS";

    const passJson: Record<string, unknown> = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      serialNumber: serial,
      teamIdentifier: TEAM_ID,
      organizationName: issuerName,
      description: `${programName} de ${issuerName}`,
      logoText: issuerName,
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(255, 255, 255)",
      backgroundColor: rgb(program.primary_color),
      barcodes: [{
        format: "PKBarcodeFormatQR",
        message: customer.public_code,
        messageEncoding: "iso-8859-1",
        altText: customer.public_code,
      }],
      storeCard: {
        headerFields: [{ key: "program", label: "PROGRAMA", value: programName }],
        primaryFields: [{ key: "progress", label: progressLabel, value: progressValue }],
        secondaryFields: [{ key: "customer", label: "CLIENTE", value: customer.name }],
        auxiliaryFields: [{ key: "reward", label: "RECOMPENSA", value: String(program.reward_text || "Recompensa especial") }],
        backFields: [
          { key: "promo", label: "Promoción", value: String(program.promo_text || `Acumula ${goal} y recibe tu recompensa.`) },
          { key: "code", label: "Código de cliente", value: customer.public_code },
          { key: "powered", label: "Tecnología", value: "Powered by rewards.enla.mx" },
        ],
      },
    };

    const files: Record<string, Uint8Array> = {
      "pass.json": strToU8(JSON.stringify(passJson)),
      "icon.png": b64ToU8(ICON_1X),
      "icon@2x.png": b64ToU8(ICON_2X),
    };

    const logo = await optionalPng(program.logo_url);
    if (logo) files["logo.png"] = logo;

    const manifest: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) manifest[name] = sha1Hex(bytes);
    const manifestBytes = strToU8(JSON.stringify(manifest));
    files["manifest.json"] = manifestBytes;

    const { key, leaf } = parseP12(P12_BASE64, P12_PASSWORD);
    const wwdr = await fetchWWDRG4();
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(u8ToBinary(manifestBytes));
    p7.addCertificate(leaf);
    p7.addCertificate(wwdr);
    p7.addSigner({
      key,
      certificate: leaf,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });
    p7.sign({ detached: true });
    files["signature"] = binaryToU8(forge.asn1.toDer(p7.toAsn1()).getBytes());

    const pkpass = zipSync(files, { level: 6 });
    if (!customer.apple_serial_number) {
      await admin.from("rewards_customers").update({ apple_serial_number: serial }).eq("id", customer.id);
    }

    const safeName = `${issuerName}-${customer.name}`.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "enla-rewards";
    return new Response(pkpass, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename=\"${safeName}.pkpass\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
