/**
 * Uploading a file to the school's own storage.
 *
 * WHY THIS EXISTS RATHER THAN AN `api.uploadFile`. Eight screens called an Express
 * upload endpoint that is not deployed, so every file upload in the app failed —
 * a school logo, a document, a resource. None of them had a working path.
 *
 * THE PATH IS NOT FREE-FORM. `can_read_stored_file` resolves a stored object to the
 * row it belongs to and decides from that row, so the prefix carries meaning:
 * `STUDENT/<student id>/<filename>`, `TEACHER/<teacher id>/<filename>`, and
 * `SCHOOL/<filename>` for school-level files, which have no row and are therefore
 * readable by the office only. A caller does not get to choose an arbitrary path,
 * because a path that does not match a row is a file nobody can ever read back.
 */
import { requireSupabase } from './client';

const BUCKET = 'srik-documents';

/** Who a file belongs to. Determines the path prefix, and so who can read it. */
export type StorageOwner =
    | { type: 'SCHOOL' }
    | { type: 'STUDENT'; id: string }
    | { type: 'TEACHER'; id: string };

export interface UploadedFile {
    /** The object key, to be stored on a row. */
    storageKey: string;
    /** A URL that works for a signed-in user, valid for an hour. */
    signedUrl: string;
}

/** A name that cannot collide and cannot escape its folder. */
function safeName(original: string): string {
    const dot = original.lastIndexOf('.');
    const ext = dot > 0 ? original.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
    // The original name is never used. Two families uploading "surat.pdf" must not
    // overwrite each other, and a name containing `../` must not climb out of its
    // folder — so the object gets a generated name and only the extension is kept.
    const unique =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${unique}${ext}`;
}

function pathFor(owner: StorageOwner, filename: string): string {
    switch (owner.type) {
        case 'SCHOOL':
            return `SCHOOL/${filename}`;
        case 'STUDENT':
            if (!owner.id) throw new Error('A student file needs the student');
            return `STUDENT/${owner.id}/${filename}`;
        case 'TEACHER':
            if (!owner.id) throw new Error('A teacher file needs the teacher');
            return `TEACHER/${owner.id}/${filename}`;
    }
}

/**
 * Upload a file and return its object key.
 *
 * The file is stored under a generated name; the caller keeps the returned key on
 * the row that owns it, which is also what makes it readable back.
 */
export async function uploadFile(
    owner: StorageOwner,
    file: File,
): Promise<UploadedFile> {
    const db = requireSupabase();
    const storageKey = pathFor(owner, safeName(file.name));

    const { error } = await db.storage
        .from(BUCKET)
        .upload(storageKey, file, {
            cacheControl: '3600',
            // Never overwrite: a generated name should not collide, and if it did,
            // silently replacing an existing file would lose it.
            upsert: false,
            contentType: file.type || undefined,
        });
    if (error) throw new Error(error.message);

    return { storageKey, signedUrl: await signedUrlFor(storageKey) };
}

/**
 * A temporary URL for a stored file.
 *
 * The bucket is PRIVATE, so there is no permanent link — which is the point: a
 * document about a child must not be a URL that keeps working after the person who
 * shared it has left. An hour is long enough to open a file and short enough that a
 * leaked link expires.
 */
export async function signedUrlFor(storageKey: string, seconds = 3600): Promise<string> {
    const db = requireSupabase();
    const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrl(storageKey, seconds);
    if (error) throw new Error(error.message);
    if (!data?.signedUrl) throw new Error('No file address was returned');
    return data.signedUrl;
}

/** Remove a stored file. */
export async function deleteFile(storageKey: string): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.storage.from(BUCKET).remove([storageKey]);
    if (error) throw new Error(error.message);
}
