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
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
      throw new Error("Faltan secretos internos de Supabase.");
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Debes iniciar sesión." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Sesión no válida." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const programId = String(body.program_id || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!programId) throw new Error("Falta la tarjeta.");
    if (!email || !email.includes("@")) throw new Error("Escribe un correo válido.");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

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

    // Supabase Auth usa aquí específicamente el template "Invite user".
    // Importante: Supabase no permite volver a invitar con este endpoint
    // a un correo que ya pertenece a un usuario Auth confirmado.
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
      const message = String(inviteError.message || inviteError).toLowerCase();
      const existing =
        message.includes("already") ||
        message.includes("registered") ||
        message.includes("exists") ||
        message.includes("confirmed");

      if (!existing) throw inviteError;

      // La asignación sigue Pendiente. Un empleado que ya tiene cuenta la verá
      // al entrar a Scan con OTP y podrá aceptarla desde ahí.
      return new Response(JSON.stringify({
        ok: true,
        status: staffRow.status,
        invite_sent: false,
        existing_user: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      status: staffRow.status,
      invite_sent: true,
      invited_user_id: inviteData.user?.id || null,
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
