/**
 * A person's own application settings.
 *
 * WHY THIS IS NOT THE SCHOOL'S SETTINGS. Notification choices belong to the person,
 * not the school: whether a teacher wants an email digest is not the office's
 * business, and no screen needs to know. So this reads and writes the caller's own
 * row, and the database enforces that — there is one policy, and it pins the row to
 * `auth.uid()`, so not even an admin can read someone else's.
 *
 * All three screens that used this called an Express endpoint that is not deployed,
 * so the switches moved and nothing was saved, with no error shown.
 */
import { requireSupabase } from './client';

export type Preferences = Record<string, unknown>;

/** The caller's own preferences. An empty object when nothing is saved yet. */
export async function getMyPreferences(): Promise<Preferences> {
    const db = requireSupabase();
    const { data, error } = await db.rpc('my_preferences');
    if (error) throw new Error(error.message);
    return (data ?? {}) as Preferences;
}

/**
 * Save some of the caller's preferences.
 *
 * A MERGE, not a replacement, and it happens in the database. Sending the whole
 * object back would reintroduce the lost update: two screens open at once, each
 * holding the object from when it loaded, and the second save erases the first.
 */
export async function saveMyPreferences(patch: Preferences): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.rpc('merge_my_preferences', { p_patch: patch });
    if (error) throw new Error(error.message);
}
