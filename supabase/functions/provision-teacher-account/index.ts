// =============================================================================
// provision-teacher-account — SRIK
// =============================================================================
// Creates a Supabase Auth account for an existing teacher record, then links the
// two. Runs server-side because creating an account needs the SECRET key, which
// bypasses Row Level Security and must never reach the browser.
//
// Authorization is checked twice, deliberately:
//   1. The platform verifies the caller's JWT (`verify_jwt = true`), so an
//      anonymous request never reaches this code.
//   2. This function re-checks the caller's PERMISSION in the database. A valid
//      login is not the same as the right to create users — a teacher holds a
//      valid token too, and must not be able to call this.
//
// Deploy:  supabase functions deploy provision-teacher-account
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
// Cross-origin access.
//
// The previous version rejected OPTIONS with 405 and attached no CORS headers, so
// a browser calling this from the app's own origin failed at the preflight before
// the request was ever sent — audit finding F13. The allow-list is explicit rather
// than `*` because this endpoint creates accounts; `*` would let any page a
// signed-in administrator visits call it.
// -----------------------------------------------------------------------------
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
  // An empty allow-list means "same-origin only", which needs no CORS header at
  // all. Falling back to `*` would silently widen the endpoint.
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
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(req),
      ...extra,
    },
  });
}

Deno.serve(async (req: Request) => {
  // The preflight must be answered before any authorization: the browser sends it
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
  // This check MUST run with the CALLER's token. `has_permission` reads
  // `auth.uid()` from the JWT that made the request, so calling it with the
  // secret key would ask "does the secret key have users.manage?" — the answer
  // is always no, and the function would refuse everyone, including the admin.
  // Using the caller's client makes the question be about the person asking.
  const { data: permitted, error: permissionError } = await callerClient.rpc('has_permission', {
    permission_code: 'users.manage',
  });

  if (permissionError || permitted !== true) {
    return json({ error: 'Not permitted to create user accounts.' }, 403, req);
  }

  // Only now, after the caller is known to be allowed, does the secret key come
  // into play — for the privileged work of creating the account itself.
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

  let body: { teacherId?: string; email?: string; fullName?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, req);
  }

  const { teacherId, email, fullName } = body;
  if (!teacherId || !email) {
    return json({ error: 'teacherId and email are required' }, 400, req);
  }

  // Confirm the teacher exists before creating an orphan account.
  const { data: teacher, error: teacherError } = await admin
    .from('teachers')
    .select('id, user_id, full_name')
    .eq('id', teacherId)
    .maybeSingle();

  if (teacherError || !teacher) {
    return json({ error: 'Teacher not found' }, 404, req);
  }

  // Refuse to overwrite an existing link: silently replacing it could detach a
  // person from their own history.
  if (teacher.user_id) {
    return json({ error: 'This teacher already has a login account.' }, 409, req);
  }

  const temporaryPassword = generateTemporaryPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: temporaryPassword,
    // The owner is handing over these credentials in person, so the email is
    // treated as confirmed; otherwise the teacher could not sign in at all.
    email_confirm: true,
    user_metadata: { full_name: fullName ?? teacher.full_name, must_change_password: true },
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

  // Everything AFTER the credential is created is database work, and it is one
  // transactional RPC.
  //
  // This comment used to claim "The teacher profile row and TEACHER role are
  // created by the same triggers that Phase 1 relies on". `handle_new_user`
  // inserts a `profiles` row and NOTHING else — so this function linked the account
  // and granted no role, and the teacher could sign in and see an empty
  // application with no error to explain it (audit F13). Measured before the fix:
  // 1 profile, 0 roles, 0 permissions.
  //
  // The RPC grants the role, sets the temporary-password flag, and does the link as
  // a compare-and-set so two simultaneous requests cannot both succeed. It runs
  // with the CALLER's token — not the secret key — because it authorizes against
  // `auth.uid()`, which is the person asking, not the server.
  const { data: linked, error: linkError } = await callerClient.rpc('link_teacher_account', {
    p_teacher_id: teacherId,
    p_user_id: created.user.id,
  });

  if (linkError) {
    // Roll the account back. A half-provisioned account is exactly the failure
    // being fixed: it can sign in, holds no role, and looks like a broken system
    // rather than an incomplete one. Leaving it would also collide on the retry.
    await admin.auth.admin.deleteUser(created.user.id);
    return json(
      { error: `Could not finish setting up the account: ${linkError.message}` },
      500,
      req
    );
  }

  // The temporary password is returned exactly once and deliberately never
  // stored: the owner passes it on, and the teacher must change it immediately.
  // Until they do, the account can sign in but holds no authority.
  return json(
    {
      created: true,
      email: created.user.email,
      temporaryPassword,
      role: linked?.role_code ?? 'TEACHER',
    },
    200,
    req
  );
});
