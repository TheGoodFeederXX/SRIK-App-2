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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const secretKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !secretKey || !publishableKey) {
    return new Response(
      JSON.stringify({ error: 'Server is not configured to create accounts.' }),
      { status: 500 }
    );
  }

  // Identify the CALLER from their own token, then act with the secret key.
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });
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
    return new Response(
      JSON.stringify({ error: 'Not permitted to create user accounts.' }),
      { status: 403 }
    );
  }

  // Only now, after the caller is known to be allowed, does the secret key come
  // into play — for the privileged work of creating the account itself.
  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

  let body: { teacherId?: string; email?: string; fullName?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  const { teacherId, email, fullName } = body;
  if (!teacherId || !email) {
    return new Response(JSON.stringify({ error: 'teacherId and email are required' }), { status: 400 });
  }

  // Confirm the teacher exists before creating an orphan account.
  const { data: teacher, error: teacherError } = await admin
    .from('teachers')
    .select('id, user_id, full_name')
    .eq('id', teacherId)
    .maybeSingle();

  if (teacherError || !teacher) {
    return new Response(JSON.stringify({ error: 'Teacher not found' }), { status: 404 });
  }

  // Refuse to overwrite an existing link: silently replacing it could detach a
  // person from their own history.
  if (teacher.user_id) {
    return new Response(
      JSON.stringify({ error: 'This teacher already has a login account.' }),
      { status: 409 }
    );
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
    return new Response(
      JSON.stringify({
        error: alreadyExists
          ? 'An account with that email already exists.'
          : createError?.message ?? 'Could not create the account.',
      }),
      { status: 400 }
    );
  }

  // The teacher profile row and TEACHER role are created by the same triggers
  // that Phase 1 relies on; this function only links the account and marks that
  // the password must be changed at first sign-in.
  const { error: linkError } = await admin
    .from('teachers')
    .update({ user_id: created.user.id })
    .eq('id', teacherId);

  if (linkError) {
    // Roll the account back so a half-created state is not left behind: an
    // account nobody is linked to would collide on the next attempt.
    await admin.auth.admin.deleteUser(created.user.id);
    return new Response(
      JSON.stringify({ error: `Could not link the account: ${linkError.message}` }),
      { status: 500 }
    );
  }

  const { error: flagError } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', created.user.id);

  if (flagError) {
    // The account and link are correct; only the forced-change flag is missing.
    // Report it rather than failing, so the owner is not told the whole thing
    // failed when the important part succeeded.
    return new Response(
      JSON.stringify({
        created: true,
        email: created.user.email,
        temporaryPassword,
        warning: 'Account created, but the password-change prompt could not be set.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // The temporary password is returned exactly once and deliberately never
  // stored: the owner passes it on, and the teacher must change it immediately.
  return new Response(
    JSON.stringify({ created: true, email: created.user.email, temporaryPassword }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
