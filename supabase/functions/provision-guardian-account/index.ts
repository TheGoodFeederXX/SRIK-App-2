// =============================================================================
// provision-guardian-account — SRIK
// =============================================================================
// Creates a Supabase Auth account for an existing guardian record, then links the
// two and links the family.
//
// WHY THIS EXISTS. Guardian accounts used to be created by a database function
// that wrote `auth.users` and `auth.identities` rows directly, generating its own
// bcrypt hash. That approach enforced a minimum password length of 8 while the
// project's own configuration says 12, and it bypassed the authentication service
// entirely — so email confirmation, password recovery, identity linking, session
// invalidation and the sign-in audit trail did not run for those accounts. A test
// of that function could pass without the authentication service being involved at
// all, so a green test said nothing about whether the person could sign in
// (audit F16).
//
// Creating a credential needs the secret key, which must never reach the browser.
// That is the whole reason this is a Function rather than an RPC.
//
// Authorization is checked twice, deliberately:
//   1. The platform verifies the caller's JWT (`verify_jwt = true`), so an
//      anonymous request never reaches this code.
//   2. This function re-checks the caller's permission in the database. A valid
//      login is not the same as the right to create users.
//
// Deploy:  supabase functions deploy provision-guardian-account
// Set:     ALLOWED_ORIGINS (comma-separated), e.g. https://srik-app-2.vercel.app
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Characters chosen to avoid 0/O/1/l, which are misread when read aloud. */
function generateTemporaryPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// -----------------------------------------------------------------------------
// Cross-origin access, on an explicit allow-list.
//
// The teacher Function rejected OPTIONS with 405 and sent no CORS headers, so a
// browser calling it from the app's own origin failed at the preflight before the
// request was sent (audit F13). `*` is not used because this endpoint creates
// accounts; it would let any page a signed-in administrator visits call it.
// -----------------------------------------------------------------------------
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
  // An empty allow-list means "same-origin only", which needs no CORS header.
  // Falling back to `*` would silently widen the endpoint.
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(
  body: unknown,
  status: number,
  req: Request,
  extra?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req), ...extra },
  });
}

Deno.serve(async (req: Request) => {
  // The preflight is answered before any authorization: the browser sends it
  // without credentials, so requiring a token here would reject every real call.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, req);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !secretKey || !publishableKey) {
    return json({ error: 'Server is not configured to create accounts.' }, 500, req);
  }

  // Identify the CALLER from their own token, then act with the secret key.
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Not signed in' }, 401, req);
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return json({ error: 'Not signed in' }, 401, req);
  }

  // Authorize against the database, not the request body.
  //
  // This MUST run with the CALLER's token: `has_permission` reads `auth.uid()`
  // from the JWT that made the request. Calling it with the secret key would ask
  // "does the secret key have users.manage?", which is always no.
  const { data: permitted, error: permissionError } = await callerClient.rpc('has_permission', {
    permission_code: 'users.manage',
  });

  if (permissionError || permitted !== true) {
    return json({ error: 'Not permitted to create user accounts.' }, 403, req);
  }

  // Only now does the secret key come into play, for the privileged work of
  // creating the account itself.
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

  let body: { guardianId?: string; email?: string; fullName?: string; studentIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, req);
  }

  const { guardianId, email, fullName, studentIds } = body;
  if (!guardianId || !email) {
    return json({ error: 'guardianId and email are required' }, 400, req);
  }

  // Confirm the guardian exists before creating an orphan account.
  const { data: guardian, error: guardianError } = await admin
    .from('guardians')
    .select('id, user_id, full_name')
    .eq('id', guardianId)
    .maybeSingle();

  if (guardianError || !guardian) {
    return json({ error: 'Guardian not found' }, 404, req);
  }

  // Refuse to overwrite an existing link: silently replacing it could detach a
  // parent from their own children's records.
  if (guardian.user_id) {
    return json({ error: 'This guardian already has a login account.' }, 409, req);
  }

  const temporaryPassword = generateTemporaryPassword();

  // The account is created by the authentication service itself, so the system's
  // real password policy, confirmation, recovery and audit all apply to it.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: temporaryPassword,
    // The clerk is handing over these credentials in person, so the email is
    // treated as confirmed; otherwise the parent could not sign in at all.
    email_confirm: true,
    user_metadata: { full_name: fullName ?? guardian.full_name, must_change_password: true },
  });

  if (createError || !created.user) {
    const alreadyExists = createError?.message?.toLowerCase().includes('already');
    return json(
      {
        error: alreadyExists
          ? 'An account with that email already exists.'
          : createError?.message ?? 'Could not create the account.',
      },
      400,
      req
    );
  }

  // The database half, run with the CALLER's token so it authorizes the person
  // asking rather than the server: link the guardian, grant GUARDIAN, link the
  // children, set the temporary-password flag — atomically.
  const { data: linked, error: linkError } = await callerClient.rpc('link_guardian_account', {
    p_guardian_id: guardianId,
    p_user_id: created.user.id,
    p_student_ids: studentIds ?? null,
  });

  if (linkError) {
    // Roll the account back. A half-provisioned account is the failure mode being
    // fixed: it can sign in, holds no role, and looks like a broken system rather
    // than an incomplete one. Leaving it would also collide on the retry.
    await admin.auth.admin.deleteUser(created.user.id);
    return json(
      { error: `Could not finish setting up the account: ${linkError.message}` },
      500,
      req
    );
  }

  // The temporary password is returned exactly once and deliberately never
  // stored: the clerk passes it on, and the parent must change it immediately.
  return json(
    {
      created: true,
      email: created.user.email,
      temporaryPassword,
      role: linked?.role_code ?? 'GUARDIAN',
      childrenLinked: linked?.children_linked ?? 0,
    },
    200,
    req
  );
});
