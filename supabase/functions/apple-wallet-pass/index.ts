import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import Jimp from "npm:jimp@0.22.12";
import { Buffer } from "node:buffer";

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
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
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
  if (!key || !leaf) throw new Error("No se pudo extraer la clave privada o el certificado del P12. Revisa los secretos de Apple.");
  return { key, leaf };
}

async function fetchWWDRG4() {
  const r = await fetch("https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer");
  if (!r.ok) throw new Error(`No se pudo descargar el certificado WWDR G4 de Apple (${r.status}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const asn1 = forge.asn1.fromDer(u8ToBinary(bytes));
  return forge.pki.certificateFromAsn1(asn1);
}

async function fetchImage(url?: string | null) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || bytes.length > 5_000_000) return null;
    return bytes;
  } catch {
    return null;
  }
}


async function makeStripPng(source: Uint8Array, width: number, height: number) {
  try {
    const src = await Jimp.read(Buffer.from(source));
    // La web ya guarda la imagen recortada en la proporción exacta del strip de Wallet.
    // Aquí usamos COVER para llenar el ancho completo y evitar márgenes blancos.
    src.cover(width, height, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    const out = await src.getBufferAsync(Jimp.MIME_PNG);
    return new Uint8Array(out);
  } catch (e) {
    console.warn("No se pudo preparar la imagen promocional para Apple Wallet", e);
    return null;
  }
}
function blendHex(a?: string, b?: string, t = 0.35) {
  const valid = (x?: string) => /^#[0-9a-fA-F]{6}$/.test(x || "") ? String(x) : "#4b63f3";
  const aa=valid(a), bb=valid(b || a); const an=parseInt(aa.slice(1),16), bn=parseInt(bb.slice(1),16);
  const ar=(an>>16)&255, ag=(an>>8)&255, ab=an&255, br=(bn>>16)&255, bg=(bn>>8)&255, bbv=bn&255;
  const mix=(x:number,y:number)=>Math.round(x+(y-x)*t);
  return `#${mix(ar,br).toString(16).padStart(2,'0')}${mix(ag,bg).toString(16).padStart(2,'0')}${mix(ab,bbv).toString(16).padStart(2,'0')}`;
}
async function makeStampStripPng(filled: Uint8Array, empty: Uint8Array, value: number, goal: number, width: number, height: number) {
  try {
    const canvas = new Jimp(width, height, 0x00000000);
    const count = Math.min(Math.max(Math.floor(goal), 1), 10);
    // Apple Wallet ofrece una franja baja y ancha. Con 6-10 sellos se ve mucho mejor
    // en dos renglones (máximo 5 por fila) que encoger los 10 en una sola línea.
    const rows = count > 5 ? 2 : 1;
    const cols = rows === 2 ? 5 : count;
    const outerX = Math.round(width * 0.12);
    const outerY = Math.round(height * (rows === 2 ? 0.08 : 0.18));
    const cellW = (width - outerX * 2) / cols;
    const cellH = (height - outerY * 2) / rows;
    const iconSize = Math.max(14, Math.floor(Math.min(cellW * 0.60, cellH * 0.68)));
    const filledImg = await Jimp.read(Buffer.from(filled));
    const emptyImg = await Jimp.read(Buffer.from(empty));
    filledImg.contain(iconSize, iconSize); emptyImg.contain(iconSize, iconSize);
    for (let i = 0; i < count; i++) {
      const row = rows === 2 ? Math.floor(i / 5) : 0;
      const col = rows === 2 ? i % 5 : i;
      const itemsThisRow = rows === 2 && row === 1 ? count - 5 : cols;
      const rowOffset = rows === 2 && row === 1 && itemsThisRow < 5 ? ((5 - itemsThisRow) * cellW) / 2 : 0;
      const x = Math.round(outerX + rowOffset + col * cellW + (cellW - iconSize) / 2);
      const y = Math.round(outerY + row * cellH + (cellH - iconSize) / 2);
      const src = i < value ? filledImg : emptyImg;
      canvas.composite(src.clone(), x, y);
    }
    return new Uint8Array(await canvas.getBufferAsync(Jimp.MIME_PNG));
  } catch (e) {
    console.warn("No se pudo generar la cuadrícula de sellos personalizada", e);
    return null;
  }
}

async function makeLogoPng(source: Uint8Array, width: number, height: number) {
  try {
    const img = await Jimp.read(Buffer.from(source));
    img.contain(width, height, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    const out = await img.getBufferAsync(Jimp.MIME_PNG);
    return new Uint8Array(out);
  } catch (e) {
    console.warn("No se pudo convertir el logo a PNG", e);
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
      .select("id,business_id,program_id,name,public_code,current_value,status,apple_serial_number,apple_auth_token,apple_updated_at")
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
    let authToken = customer.apple_auth_token as string | null;
    if (!authToken) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      authToken = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
      const nowTag = Date.now();
      const { error: tokenError } = await admin.from("rewards_customers")
        .update({ apple_auth_token: authToken, apple_updated_at: nowTag, apple_serial_number: serial })
        .eq("id", customer.id);
      if (tokenError) throw tokenError;
    }
    const issuerName = String(program.display_name || business.business_name || "Enla Rewards").slice(0, 60);
    const programName = String(program.program_name || "Rewards").slice(0, 60);
    const rawValue = Math.max(0, Number(customer.current_value || 0));
    const value = program.program_type === 'cashback' ? Math.round(rawValue * 100) / 100 : Math.floor(rawValue);
    const goal = Math.max(1, Math.floor(Number(program.goal_count || 6)));
    const isCashback = program.program_type === "cashback";
    const isVisits = program.program_type === "visits";
    const reward = String(program.reward_text || "Recompensa especial").slice(0, 90);

    const sourceLogo = await fetchImage(program.logo_url);
    const logo1x = sourceLogo ? await makeLogoPng(sourceLogo, 160, 50) : null;
    const logo2x = sourceLogo ? await makeLogoPng(sourceLogo, 320, 100) : null;

    // Imagen central/promocional configurada por el negocio.
    // Se genera en los tamaños nativos del strip de Store Card para evitar el crop agresivo
    // que se producía al enviar imágenes con proporciones arbitrarias.
    const sourcePromo = program.program_type === "stamps" ? null : await fetchImage(program.central_image_url);
    const strip1x = sourcePromo ? await makeStripPng(sourcePromo, 375, 123) : null;
    const strip2x = sourcePromo ? await makeStripPng(sourcePromo, 750, 246) : null;
    const strip3x = sourcePromo ? await makeStripPng(sourcePromo, 1125, 369) : null;

    const sourceStampFilled = program.program_type === "stamps" ? await fetchImage(program.stamp_filled_image_url) : null;
    const sourceStampEmpty = program.program_type === "stamps" ? await fetchImage(program.stamp_empty_image_url) : null;
    const customStampStrip1x = sourceStampFilled && sourceStampEmpty ? await makeStampStripPng(sourceStampFilled, sourceStampEmpty, value, goal, 375, 123) : null;
    const customStampStrip2x = sourceStampFilled && sourceStampEmpty ? await makeStampStripPng(sourceStampFilled, sourceStampEmpty, value, goal, 750, 246) : null;
    const customStampStrip3x = sourceStampFilled && sourceStampEmpty ? await makeStampStripPng(sourceStampFilled, sourceStampEmpty, value, goal, 1125, 369) : null;

    const stampIcon = String(program.stamp_icon || "⭐");
    const visibleGoal = Math.min(goal, 10);
    const stampRow = Array.from({ length: visibleGoal }, (_, i) => i < value ? stampIcon : "○").join("  ") + (goal > 10 ? `  ···  ${value}/${goal}` : "");

    const inactive = customer.status === "inactive";
    const storeCard: Record<string, unknown> = {
      headerFields: [{
        key: "progress",
        label: isCashback ? "SALDO" : isVisits ? "VISITAS RESTANTES" : "SELLOS",
        value: isCashback ? `$${Number(value).toFixed(2)}` : isVisits ? `${value}` : `${value} / ${goal}`,
      }],
      primaryFields: isCashback
        ? []
        : isVisits
          ? (strip1x ? [] : [{ key: "visits", label: inactive ? "ESTADO" : "PAQUETE", value: inactive ? "INACTIVA" : `${goal} visitas incluidas` }])
          : customStampStrip1x ? [] : [{ key: "stamps", label: "TUS SELLOS", value: stampRow }],
      secondaryFields: isCashback
        ? (String(program.promo_text || "").trim() ? [{ key: "promoFront", label: "PROMOCIÓN", value: String(program.promo_text).slice(0, 90) }] : [])
        : isVisits
          ? [{ key: "visitInfo", label: "USO", value: inactive ? "Esta tarjeta está desactivada" : "Cada acceso descuenta 1 visita" }]
          : [{ key: "reward", label: "RECOMPENSA", value: reward }],
      backFields: [
        { key: "program", label: "Programa", value: programName },
        ...(isVisits ? [{ key: "visitsPackage", label: "Paquete", value: inactive ? "Tarjeta inactiva" : `${goal} visitas incluidas` }] : []),
        { key: "promo", label: "Información", value: String(program.promo_text || (isVisits ? `Incluye ${goal} visitas por ciclo.` : isCashback ? "Acumula saldo y úsalo en futuras compras." : `Acumula ${goal} sellos y recibe tu recompensa.`)) },
        { key: "code", label: "Código de cliente", value: customer.public_code },
        { key: "powered", label: "Tecnología", value: "Powered by rewards.enla.mx" },
      ],
    };

    const passJson: Record<string, unknown> = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      serialNumber: serial,
      teamIdentifier: TEAM_ID,
      organizationName: issuerName,
      description: `${programName} de ${issuerName}`,
      logoText: logo1x ? "" : issuerName,
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(255, 255, 255)",
      backgroundColor: rgb(program.card_style === "classic" ? program.primary_color : blendHex(program.primary_color, program.secondary_color, 0.38)),
      webServiceURL: `${SUPABASE_URL}/functions/v1/apple-wallet-webservice`,
      authenticationToken: authToken,
      barcodes: [{
        format: program.barcode_format === "code128" ? "PKBarcodeFormatCode128" : "PKBarcodeFormatQR",
        message: customer.public_code,
        messageEncoding: "iso-8859-1",
        altText: customer.public_code,
      }],
      storeCard,
    };

    const files: Record<string, Uint8Array> = {
      "pass.json": strToU8(JSON.stringify(passJson)),
      "icon.png": b64ToU8(ICON_1X),
      "icon@2x.png": b64ToU8(ICON_2X),
    };
    if (logo1x) files["logo.png"] = logo1x;
    if (logo2x) files["logo@2x.png"] = logo2x;
    if (customStampStrip1x) files["strip.png"] = customStampStrip1x; else if (strip1x) files["strip.png"] = strip1x;
    if (customStampStrip2x) files["strip@2x.png"] = customStampStrip2x; else if (strip2x) files["strip@2x.png"] = strip2x;
    if (customStampStrip3x) files["strip@3x.png"] = customStampStrip3x; else if (strip3x) files["strip@3x.png"] = strip3x;

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
    if (!customer.apple_serial_number) await admin.from("rewards_customers").update({ apple_serial_number: serial }).eq("id", customer.id);

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
