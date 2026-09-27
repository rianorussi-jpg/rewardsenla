import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      throw new Error("Faltan secretos internos de Supabase.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Debes iniciar sesión." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // La función se despliega con Verify JWT OFF, pero NO queda pública:
    // validamos aquí explícitamente el access token del usuario.
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Sesión no válida o expirada." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const programId = String(body.program_id || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!programId) throw new Error("Falta la tarjeta.");
    if (!email || !email.includes("@")) throw new Error("Escribe un correo válido.");

    const { data: program, error: programError } = await admin
      .from("rewards_loyalty_programs")
      .select("id,business_id,program_name,display_name,rewards_businesses!inner(owner_id,business_name)")
      .eq("id", programId)
      .single();

    if (programError || !program) throw new Error("Tarjeta no encontrada.");

    const businessRel = Array.isArray((program as any).rewards_businesses)
      ? (program as any).rewards_businesses[0]
      : (program as any).rewards_businesses;

    if (!businessRel || businessRel.owner_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: "No tienes permiso para invitar empleados a esta tarjeta." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: currentStaff } = await admin
      .from("rewards_program_staff")
      .select("*")
      .eq("program_id", programId)
      .ilike("email", email)
      .maybeSingle();

    if (currentStaff?.status === "active") {
      return new Response(JSON.stringify({
        ok: true,
        status: "active",
        invite_sent: false,
        already_active: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let staffRow: any = null;
    if (currentStaff) {
      const { data, error } = await admin
        .from("rewards_program_staff")
        .update({ status: "pending", user_id: null })
        .eq("id", currentStaff.id)
        .select("*")
        .single();
      if (error) throw error;
      staffRow = data;
    } else {
      const { data, error } = await admin
        .from("rewards_program_staff")
        .insert({
          program_id: programId,
          business_id: program.business_id,
          email,
          user_id: null,
          status: "pending",
        })
        .select("*")
        .single();
      if (error) throw error;
      staffRow = data;
    }

    const redirectTo = `https://scan.enlacards.com/?invite=${encodeURIComponent(programId)}`;

    // Busca si Auth ya tiene ese correo. Esto permite distinguir:
    // - usuario confirmado: no se vuelve a enviar Invite user;
    // - usuario NO confirmado creado por una invitación previa: se elimina y reintenta,
    //   evitando quedar atrapado en "User already registered" después de un envío fallido.
    let authUser: any = null;
    let page = 1;
    const perPage = 1000;

    while (!authUser && page <= 10) {
      const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (usersError) throw usersError;

      authUser = (usersPage.users || []).find(
        (u: any) => String(u.email || "").toLowerCase() === email
      ) || null;

      if (!usersPage.users || usersPage.users.length < perPage) break;
      page++;
    }

    if (authUser?.confirmed_at) {
      return new Response(JSON.stringify({
        ok: true,
        status: staffRow.status,
        invite_sent: false,
        existing_user: true,
        confirmed_user: true,
        message: "Ese correo ya tiene una cuenta confirmada. La tarjeta quedó pendiente y podrá aceptarla al entrar a Scan.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Si el usuario existe pero nunca confirmó y fue creado por una invitación anterior,
    // limpiamos ese registro antes de reenviar. No tocamos usuarios confirmados.
    if (authUser && !authUser.confirmed_at && authUser.invited_at) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(authUser.id);
      if (deleteError) throw new Error(`No se pudo preparar el reenvío de la invitación: ${deleteError.message}`);
      authUser = null;
    }

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        enla_invitation: true,
        program_id: programId,
        program_name: program.program_name,
        display_name: program.display_name || businessRel.business_name,
        business_name: businessRel.business_name,
      },
    });

    if (inviteError) {
      throw new Error(`Supabase no pudo enviar Invite user: ${inviteError.message}`);
    }

    const invitedUser = inviteData.user || null;
    const confirmationSentAt = invitedUser?.confirmation_sent_at || null;
    const invitedAt = invitedUser?.invited_at || null;

    console.log("Invite user result", {
      email,
      programId,
      invited_user_id: invitedUser?.id || null,
      confirmation_sent_at: confirmationSentAt,
      invited_at: invitedAt,
    });

    return new Response(JSON.stringify({
      ok: true,
      status: staffRow.status,
      invite_sent: true,
      invited_user_id: invitedUser?.id || null,
      confirmation_sent_at: confirmationSentAt,
      invited_at: invitedAt,
      message: confirmationSentAt
        ? "Supabase registró el envío del correo de invitación."
        : "Supabase creó la invitación, pero no reportó confirmation_sent_at.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
