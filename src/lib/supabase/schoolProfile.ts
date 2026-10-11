/**
 * The school's own settings.
 *
 * SRIK is ONE school, so this reads and writes a single row. There is no id to
 * pass: the old API took a `schoolId` argument and the screens threaded it down
 * from everywhere, which is how "which school am I editing?" became a question the
 * frontend had to answer for a product with exactly one answer.
 */
import { requireSupabase } from './client';

export interface SchoolProfile {
    id: string;
    name: string;
    shortName: string;
    code: string | null;
    logoStorageKey: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    principalName: string | null;
    /** Everything that is not a fixed column: branding, policies, toggles. */
    settings: Record<string, unknown>;
}

interface RawProfile {
    id: string;
    name: string;
    short_name: string;
    code: string | null;
    logo_storage_key: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    principal_name: string | null;
    settings: Record<string, unknown> | null;
}

const SELECT =
    'id,name,short_name,code,logo_storage_key,address,phone,email,website,principal_name,settings';

function toProfile(r: RawProfile): SchoolProfile {
    return {
        id: r.id,
        name: r.name,
        shortName: r.short_name,
        code: r.code,
        logoStorageKey: r.logo_storage_key,
        address: r.address,
        phone: r.phone,
        email: r.email,
        website: r.website,
        principalName: r.principal_name,
        // Absent settings are an empty object, never null: every caller reads
        // `settings.something` and a null here is a crash rather than a default.
        settings: r.settings ?? {},
    };
}

/** The school's details. There is one row, so there is nothing to filter by. */
export async function getSchoolProfile(): Promise<SchoolProfile> {
    const db = requireSupabase();
    const { data, error } = await db.from('school_profile').select(SELECT).single();
    if (error) throw new Error(error.message);
    return toProfile(data as unknown as RawProfile);
}

/** The details that live in their own columns. */
export interface SchoolDetailsPatch {
    name?: string;
    shortName?: string;
    code?: string | null;
    logoStorageKey?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    principalName?: string | null;
}

const COLUMN: Record<keyof SchoolDetailsPatch, string> = {
    name: 'name',
    shortName: 'short_name',
    code: 'code',
    logoStorageKey: 'logo_storage_key',
    address: 'address',
    phone: 'phone',
    email: 'email',
    website: 'website',
    principalName: 'principal_name',
};

export async function updateSchoolDetails(patch: SchoolDetailsPatch): Promise<void> {
    const db = requireSupabase();
    const row: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMN)) {
        const value = patch[key as keyof SchoolDetailsPatch];
        if (value !== undefined) row[column] = value;
    }
    if (Object.keys(row).length === 0) return;
    const { error } = await db.from('school_profile').update(row).not('id', 'is', null);
    if (error) throw new Error(error.message);
}

/**
 * Merge keys into `settings`.
 *
 * A MERGE, NOT A REPLACE, and the merge happens in the database. Two screens writing
 * different keys used to race: each read the whole settings object, changed its own
 * key, and wrote it all back, so the later save silently discarded the other's
 * change. The database function makes it one statement.
 */
export async function updateSchoolSettings(
    patch: Record<string, unknown>,
): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.rpc('merge_school_settings', { p_patch: patch });
    if (error) throw new Error(error.message);
}
