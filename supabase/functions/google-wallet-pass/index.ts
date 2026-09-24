import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Jimp from "npm:jimp@0.22.12";
import { Buffer } from "node:buffer";

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

async function fetchImage(url?: string | null) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || bytes.length > 5_000_000) return null;
    return bytes;
  } catch { return null; }
}

// Imagen para el HERO de Google Wallet (ancho completo), no para la pequeña
// ranura de 20 dp situada encima del QR. La promoción se muestra en un campo
// independiente arriba de esta imagen para mantenerla legible y sin duplicarla.
async function makeGoogleStampStrip(
  filledBytes: Uint8Array, emptyBytes: Uint8Array, value: number, goal: number,
) {
  const count = Math.min(Math.max(Math.floor(goal), 1), 10);
  const rows = count > 5 ? 2 : 1;
  const cols = Math.min(count, 5);
  const width = 1032, height = rows === 2 ? 540 : 360;
  const side = 76, paddingY = 24, gap = 28, rowGap = 20;
  const canvas = new Jimp(width, height, 0x00000000);
  const filled = await Jimp.read(Buffer.from(filledBytes));
  const empty = await Jimp.read(Buffer.from(emptyBytes));
  const availableW = width - 2 * side;
  const cellW = (availableW - gap * (cols - 1)) / cols;
  const cellH = (height - paddingY * 2 - rowGap * (rows - 1)) / rows;
  const iconSize = Math.floor(Math.min(204, cellW * 0.94, cellH * 0.92));

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 5);
    const rowCount = rows === 1 ? count : Math.min(5, count - row * 5);
    const rowWidth = rowCount * cellW + Math.max(0, rowCount - 1) * gap;
    const rowStart = (width - rowWidth) / 2;
    const col = rows === 1 ? i : i % 5;
    const x = Math.round(rowStart + col * (cellW + gap) + (cellW - iconSize) / 2);
    const y = Math.round(paddingY + row * (cellH + rowGap) + (cellH - iconSize) / 2);
    const src = (i < value ? filled : empty).clone();
    src.contain(iconSize, iconSize, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    canvas.composite(src, x, y);
  }
  return new Uint8Array(await canvas.getBufferAsync(Jimp.MIME_PNG));
}

async function uploadGoogleStampStrip(admin: any, program: any, customer: any, value: number, goal: number) {
  const [filled, empty] = await Promise.all([fetchImage(program.stamp_filled_image_url), fetchImage(program.stamp_empty_image_url)]);
  if (!filled || !empty) return null;
  try {
    const png = await makeGoogleStampStrip(filled, empty, value, goal);
    const path = `google-stamps/${program.id}/${customer.id}-${value}-${goal}-hero-v2.png`;
    const { error } = await admin.storage.from("reward-logos").upload(path, png, { upsert: true, contentType: "image/png", cacheControl: "60" });
    if (error) throw error;
    const { data } = admin.storage.from("reward-logos").getPublicUrl(path);
    // Cache-buster ensures Google fetches the new visual immediately after a stamp changes.
    return `${data.publicUrl}?v=${Date.now()}`;
  } catch (e) {
    console.warn("Google Wallet stamp strip:", e);
    return null;
  }
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
      .select("id,business_id,program_id,name,public_code,current_value,status,photo_url,expires_at,last_access_state,google_object_id,wallet_notification_message,wallet_notification_nonce,wallet_notification_sent_at,google_notification_sent_nonce")
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
    // Antes se compartía una clase por negocio para sellos/cashback/visitas.
    // Las clases nuevas son por tarjeta: así un logo no altera tarjetas hermanas.
    const preferredClassId = `${ISSUER_ID}.rewards_${safeBusinessId}_${String(program.id).replace(/[^A-Za-z0-9._-]/g, "_")}`;
    let classId = preferredClassId;
    const objectId = `${ISSUER_ID}.customer_${safeCustomerId}`;
    const color = /^#[0-9a-fA-F]{6}$/.test(program.primary_color || "") ? program.primary_color : "#4b63f3";
    const issuerName = String(program.display_name || business.business_name || "Enla Rewards").slice(0, 60);
    const programName = String(program.program_name || "Rewards").slice(0, 60);
    // Google muestra el emisor y el nombre del programa en líneas diferentes.
    // Evita repetir "Waffela" encima de "Waffela Rewards" si coinciden.
    const visibleProgramName = program.program_type === "stamps" &&
      programName.toLocaleLowerCase("es").startsWith(`${issuerName.toLocaleLowerCase("es")} `)
      ? programName.slice(issuerName.length).trim() || programName
      : programName;

    const token = await getGoogleAccessToken(SERVICE_EMAIL, PRIVATE_KEY);
    const existingObject = await googleRequest(`loyaltyObject/${encodeURIComponent(objectId)}`, token);
    if (existingObject.status !== 404 && !existingObject.ok) throw new Error(`Google Wallet object: ${existingObject.data?.error?.message || existingObject.status}`);
    // Los pases ya emitidos deben conservar su clase original para no romperlos.
    // En clases compartidas antiguas no cambiamos la plantilla ni el logo:
    // afectaría también a otras tarjetas del mismo negocio.
    const isLegacySharedClass = existingObject.ok && existingObject.data?.classId === `${ISSUER_ID}.rewards_${safeBusinessId}`;
    if (existingObject.ok && existingObject.data?.classId) classId = existingObject.data.classId;
    const canUpdateClassBrand = !isLegacySharedClass;
    const loyaltyClass: any = {
      id: classId,
      issuerName,
      programName: visibleProgramName,
      reviewStatus: "UNDER_REVIEW",
      hexBackgroundColor: color,
    };
    // El logo cuadrado es opcional para los iconos/avisos: NO sustituye al
    // logo original del encabezado de la tarjeta (igual que Apple Wallet).
    if (program.logo_url || program.square_logo_url) {
      loyaltyClass.programLogo = {
        sourceUri: { uri: program.logo_url || program.square_logo_url },
        contentDescription: { defaultValue: { language: "es", value: `Logo de ${issuerName}` } },
      };
    }
    // Google permite un logo horizontal sin máscara circular cuando la imagen
    // original es suficientemente ancha. No transformamos el logo del negocio.
    if (program.logo_url) {
      const brandImage = await fetchImage(program.logo_url);
      if (brandImage) {
        try {
          const brand = await Jimp.read(Buffer.from(brandImage));
          if (brand.bitmap.width / brand.bitmap.height >= 1.65) {
            loyaltyClass.wideProgramLogo = {
              sourceUri: { uri: program.logo_url },
              contentDescription: { defaultValue: { language: "es", value: `Logo horizontal de ${issuerName}` } },
            };
          }
        } catch (e) { console.warn("Google Wallet wide logo:", e); }
      }
    }
    if (program.program_type !== "stamps" && program.central_image_url) {
      loyaltyClass.heroImage = {
        sourceUri: { uri: program.central_image_url },
        contentDescription: { defaultValue: { language: "es", value: `Promoción de ${issuerName}` } },
      };
    }
    if (program.program_type === "stamps") {
      // Las imágenes que van justo sobre el QR tienen un límite visual de 20 dp:
      // ahí los 5 sellos se veían minúsculos. Usamos el hero del OBJETO, que
      // puede mostrar una franja grande distinta para cada cliente.
      // Con dos filas Google coloca el hero DESPUÉS de la primera, conservando:
      // promoción -> sellos -> recompensa -> código.
      const promoRow = {
        oneItem: {
          item: { firstValue: { fields: [{ fieldPath: "object.textModulesData['promo']" }] } },
        },
      };
      const rewardRow = {
        oneItem: {
          item: { firstValue: { fields: [{ fieldPath: "object.textModulesData['reward']" }] } },
        },
      };
      loyaltyClass.classTemplateInfo = {
        cardTemplateOverride: {
          cardRowTemplateInfos: String(program.promo_text || "").trim()
            ? [promoRow, rewardRow]
            : [rewardRow],
        },
      };
    }

    const rawValue = Math.max(0, Number(customer.current_value || 0));
    const value = program.program_type === 'cashback' ? Math.round(rawValue * 100) / 100 : Math.floor(rawValue);
    const isAccess = program.program_type === "access";
    const goal = Math.min(Math.max(Number(program.goal_count || 5), 1), 10);
    const googleStampStripUrl = program.program_type === "stamps"
      ? await uploadGoogleStampStrip(admin, program, customer, Math.min(value, goal), goal)
      : null;
    const promoText = String(program.promo_text || "").trim().slice(0, 180);
    const promoModule = promoText ? { id: "promo", header: "Promoción", body: promoText } : null;
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
      // El hero se muestra grande en el frente; la miniatura en firstTopDetail
      // anterior se elimina para no repetir los sellos encima del QR.
      ...(googleStampStripUrl ? {
        heroImage: {
          sourceUri: { uri: googleStampStripUrl },
          contentDescription: { defaultValue: { language: "es", value: `Progreso de sellos de ${issuerName}` } },
        },
        imageModulesData: [], // limpia la imagen antigua en objetos ya emitidos
      } : {}),
      textModulesData: isAccess ? [
        { id: "service", header: "Servicio", body: String(program.service_name || programName) },
        { id: "expires", header: "Vencimiento", body: expiryText },
        { id: "customer", header: "Cliente", body: customer.name },
        ...(promoModule ? [promoModule] : []),
      ] : [
        ...(promoModule ? [promoModule] : []),
        program.program_type === 'cashback'
          ? { id: 'reward', header: 'Saldo', body: `$${Number(value).toFixed(2)}` }
          : program.program_type === 'visits'
            ? { id: 'visits', header: customer.status === 'inactive' ? 'Estado' : 'Visitas restantes', body: customer.status === 'inactive' ? 'Tarjeta inactiva' : `${value} de ${program.goal_count || 8}` }
            : { id: "reward", header: "Recompensa", body: program.reward_text || "Recompensa especial" },
      ],
      hexBackgroundColor: color,
    };
    loyaltyObject.merchantLocations = []; // Vaciar ubicaciones al desactivar proximidad.
    if (program.geo_enabled && Number.isFinite(Number(program.geo_latitude)) && Number.isFinite(Number(program.geo_longitude))) {
      loyaltyObject.merchantLocations = [{
        latitude: Number(program.geo_latitude),
        longitude: Number(program.geo_longitude),
      }];
    }
    if (program.geo_enabled && String(program.geo_message || "").trim()) {
      loyaltyObject.textModulesData = [
        ...(loyaltyObject.textModulesData || []),
        { id: "nearby_message", header: "CERCA DEL NEGOCIO", body: String(program.geo_message).slice(0, 180) },
      ];
    }
    const walletNotice = String(customer.wallet_notification_message || "").trim();
    const walletNoticeNonce = String(customer.wallet_notification_nonce || "").trim();

    if (!isAccess) loyaltyObject.loyaltyPoints = {
      label: program.program_type === "cashback" ? "Saldo" : program.program_type === "visits" ? "Visitas restantes" : "Sellos",
      balance: program.program_type === 'cashback' ? { double: value } : { int: value },
    };

    // Crea/actualiza clase propia; evita actualizar clases legadas compartidas.
    const classGet = canUpdateClassBrand ? await googleRequest(`loyaltyClass/${encodeURIComponent(classId)}`, token) : { ok:true, status:200 };
    if (classGet.status === 404) {
      const created = await googleRequest("loyaltyClass", token, { method: "POST", body: JSON.stringify(loyaltyClass) });
      if (!created.ok) throw new Error(`Google Wallet class: ${created.data?.error?.message || created.status}`);
    } else if (!classGet.ok) {
      throw new Error(`Google Wallet class: ${classGet.data?.error?.message || classGet.status}`);
    } else if (canUpdateClassBrand) {
      const patched = await googleRequest(`loyaltyClass/${encodeURIComponent(classId)}`, token, { method: "PATCH", body: JSON.stringify(loyaltyClass) });
      if (!patched.ok) throw new Error(`Google Wallet class update: ${patched.data?.error?.message || patched.status}`);
    } else if (isLegacySharedClass && program.program_type === "stamps") {
      // Los pases antiguos aún usan una clase compartida por negocio; tocar
      // aquí logo/título/plantilla cambiaría otros programas (cashback, visitas).
      // El objeto sí recibe su hero de sellos de tamaño grande y se actualiza.
      console.info("Google Wallet: pase antiguo con clase compartida; preservamos su branding global.");
    }

    const objectGet = existingObject;
    if (objectGet.status === 404) {
      const created = await googleRequest("loyaltyObject", token, { method: "POST", body: JSON.stringify(loyaltyObject) });
      if (!created.ok) throw new Error(`Google Wallet object: ${created.data?.error?.message || created.status}`);
    } else if (!objectGet.ok) {
      throw new Error(`Google Wallet object: ${objectGet.data?.error?.message || objectGet.status}`);
    } else {
      const patched = await googleRequest(`loyaltyObject/${encodeURIComponent(objectId)}`, token, { method: "PATCH", body: JSON.stringify(loyaltyObject) });
      if (!patched.ok) throw new Error(`Google Wallet object update: ${patched.data?.error?.message || patched.status}`);
    }

    let notifiedNonce: string | null = null;
    if (walletNotice && walletNoticeNonce && customer.google_notification_sent_nonce !== walletNoticeNonce) {
      const messageId = `msg_${walletNoticeNonce.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}`;
      const notified = await googleRequest(`loyaltyObject/${encodeURIComponent(objectId)}/addMessage`, token, {
        method: "POST",
        body: JSON.stringify({
          message: {
            header: programName,
            body: walletNotice.slice(0, 180),
            id: messageId,
            messageType: "TEXT_AND_NOTIFY",
          },
        }),
      });
      if (!notified.ok) {
        console.warn("Google Wallet notification:", notified.data?.error?.message || notified.status);
      } else {
        notifiedNonce = walletNoticeNonce;
      }
    }

    await Promise.all([
      admin.from("rewards_loyalty_programs").update({ google_class_id: preferredClassId }).eq("id", program.id),
      admin.from("rewards_customers").update({
        google_object_id: objectId,
        ...(notifiedNonce ? { google_notification_sent_nonce: notifiedNonce } : {}),
      }).eq("id", customer.id),
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
