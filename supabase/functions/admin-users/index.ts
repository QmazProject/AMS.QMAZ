import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  action?: "list" | "create" | "update" | "send_recovery";
  userId?: string;
  email?: string;
  password?: string;
  fullName?: string;
  username?: string;
  role?: string;
  isActive?: boolean;
  allCompanies?: boolean;
  allAssetGroups?: boolean;
  companyIds?: string[];
  assetGroupIds?: string[];
  permissionOverrides?: Record<string, boolean>;
};

type ProfileRow = {
  user_id: string;
  full_name: string;
  username: string | null;
  role_id: string;
  is_active: boolean;
  all_companies: boolean;
  all_asset_groups: boolean;
  created_at: string;
  updated_at: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const requireEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required Edge Function secret: ${name}`);
  return value;
};

const cleanText = (value: unknown) => String(value ?? "").trim();
const cleanIds = (value: unknown) =>
  Array.isArray(value) ? [...new Set(value.map(cleanText).filter(Boolean))] : [];

async function assertSuperAdmin(service: SupabaseClient, bearerToken: string) {
  const { data: authData, error: authError } = await service.auth.getUser(bearerToken);
  if (authError || !authData.user) throw new Response("Invalid or expired session", { status: 401 });

  const { data: profile, error: profileError } = await service
    .from("user_profiles")
    .select("is_active, system_roles!inner(code)")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  const role = Array.isArray(profile?.system_roles)
    ? profile?.system_roles[0]
    : profile?.system_roles;
  if (profileError || !profile?.is_active || role?.code !== "super_admin") {
    throw new Response("Only an active Super Admin can manage user accounts", { status: 403 });
  }
  return authData.user;
}

async function listAllAuthUsers(service: SupabaseClient) {
  const users: User[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function listUsers(service: SupabaseClient) {
  const [authUsers, profilesResult, rolesResult, companiesResult, groupsResult, companyAccessResult, groupAccessResult] =
    await Promise.all([
      listAllAuthUsers(service),
      service.from("user_profiles").select("*"),
      service.from("system_roles").select("id, code, name, description").order("name"),
      service.from("companies").select("id, name").order("name"),
      service.from("asset_categories").select("id, name").order("name"),
      service.from("user_company_access").select("user_id, company_id"),
      service.from("user_asset_group_access").select("user_id, asset_category_id"),
    ]);

  for (const result of [profilesResult, rolesResult, companiesResult, groupsResult, companyAccessResult, groupAccessResult]) {
    if (result.error) throw result.error;
  }

  const roles = rolesResult.data ?? [];
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const companiesByUser = new Map<string, string[]>();
  const groupsByUser = new Map<string, string[]>();

  for (const row of companyAccessResult.data ?? []) {
    companiesByUser.set(row.user_id, [...(companiesByUser.get(row.user_id) ?? []), row.company_id]);
  }
  for (const row of groupAccessResult.data ?? []) {
    groupsByUser.set(row.user_id, [...(groupsByUser.get(row.user_id) ?? []), row.asset_category_id]);
  }

  const users = (profilesResult.data as ProfileRow[] ?? []).map((profile) => {
    const authUser = authById.get(profile.user_id);
    const role = roleById.get(profile.role_id);
    return {
      id: profile.user_id,
      fullName: profile.full_name,
      username: profile.username ?? "",
      email: authUser?.email ?? "",
      role: role?.code ?? "",
      roleName: role?.name ?? "Unknown role",
      isActive: profile.is_active,
      allCompanies: profile.all_companies || role?.code === "super_admin",
      allAssetGroups: profile.all_asset_groups || role?.code === "super_admin",
      companyIds: companiesByUser.get(profile.user_id) ?? [],
      assetGroupIds: groupsByUser.get(profile.user_id) ?? [],
      createdAt: authUser?.created_at ?? profile.created_at,
      lastSignInAt: authUser?.last_sign_in_at ?? null,
    };
  });

  users.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return {
    users,
    roles,
    companies: companiesResult.data ?? [],
    assetGroups: groupsResult.data ?? [],
  };
}

function accessRpcPayload(actorId: string, userId: string, body: RequestBody) {
  return {
    p_actor_id: actorId,
    p_user_id: userId,
    p_full_name: cleanText(body.fullName),
    p_username: cleanText(body.username) || null,
    p_role_code: cleanText(body.role),
    p_is_active: body.isActive !== false,
    p_all_companies: body.allCompanies === true,
    p_all_asset_groups: body.allAssetGroups === true,
    p_company_ids: cleanIds(body.companyIds),
    p_asset_group_ids: cleanIds(body.assetGroupIds),
    p_permission_overrides: body.permissionOverrides ?? {},
  };
}

async function recordAuthEvent(
  service: SupabaseClient,
  actorId: string,
  targetUser: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
) {
  const { error } = await service.rpc("admin_record_asset_auth_event", {
    p_actor_id: actorId,
    p_target_user: targetUser,
    p_action: action,
    p_old_value: oldValue,
    p_new_value: newValue,
  });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const authorization = request.headers.get("Authorization") ?? "";
    const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!bearerToken) return json({ error: "Missing Authorization header" }, 401);

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const caller = await assertSuperAdmin(service, bearerToken);
    const body = (await request.json()) as RequestBody;

    if (body.action === "list") return json(await listUsers(service));

    if (body.action === "create") {
      const email = cleanText(body.email).toLowerCase();
      const password = cleanText(body.password);
      const fullName = cleanText(body.fullName);
      if (!email || !fullName || password.length < 8) {
        return json({ error: "Email, full name, and a password of at least 8 characters are required" }, 400);
      }

      const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, username: cleanText(body.username) || null },
      });
      if (createError || !created.user) throw createError ?? new Error("Auth account was not created");

      const { error: accessError } = await service.rpc(
        "admin_set_asset_user_access",
        accessRpcPayload(caller.id, created.user.id, body),
      );
      if (accessError) {
        await service.auth.admin.deleteUser(created.user.id);
        throw accessError;
      }
      await recordAuthEvent(service, caller.id, created.user.id, "auth_account_created", null, { email });
      return json({ userId: created.user.id }, 201);
    }

    if (body.action === "update") {
      const userId = cleanText(body.userId);
      if (!userId) return json({ error: "User id is required" }, 400);

      const { data: previous, error: previousError } = await service.auth.admin.getUserById(userId);
      if (previousError || !previous.user) throw previousError ?? new Error("User not found");
      const email = cleanText(body.email).toLowerCase() || previous.user.email;
      const fullName = cleanText(body.fullName);
      const isActive = body.role === "super_admin" ? true : body.isActive !== false;

      const { error: authUpdateError } = await service.auth.admin.updateUserById(userId, {
        email,
        email_confirm: email !== previous.user.email ? true : undefined,
        ban_duration: isActive ? "none" : "876000h",
        user_metadata: {
          ...previous.user.user_metadata,
          full_name: fullName,
          username: cleanText(body.username) || null,
        },
      });
      if (authUpdateError) throw authUpdateError;

      const { error: accessError } = await service.rpc(
        "admin_set_asset_user_access",
        accessRpcPayload(caller.id, userId, { ...body, isActive }),
      );
      if (accessError) {
        await service.auth.admin.updateUserById(userId, {
          email: previous.user.email,
          ban_duration: previous.user.banned_until ? "876000h" : "none",
          user_metadata: previous.user.user_metadata,
        });
        throw accessError;
      }

      if (email !== previous.user.email || fullName !== previous.user.user_metadata?.full_name) {
        await recordAuthEvent(
          service,
          caller.id,
          userId,
          "auth_identity_updated",
          { email: previous.user.email, fullName: previous.user.user_metadata?.full_name ?? null },
          { email, fullName },
        );
      }
      return json({ userId });
    }

    if (body.action === "send_recovery") {
      const userId = cleanText(body.userId);
      const email = cleanText(body.email).toLowerCase();
      if (!userId || !email) return json({ error: "User id and email are required" }, 400);

      const publicAuth = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const redirectTo = Deno.env.get("PASSWORD_RECOVERY_REDIRECT_URL") || undefined;
      const { error } = await publicAuth.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      await recordAuthEvent(service, caller.id, userId, "password_recovery_requested", null, { email });
      return json({ sent: true });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return json({ error: await error.text() }, error.status);
    }
    const message = error instanceof Error ? error.message : "Unexpected account-management error";
    return json({ error: message }, 400);
  }
});
