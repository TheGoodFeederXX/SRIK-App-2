/**
 * What each role is allowed to do.
 *
 * WHY THIS EXISTS. The roles screen read and wrote role permissions through an
 * Express endpoint that is not deployed, so the switches showed the code's built-in
 * defaults and saving did nothing. An office that turns a permission ON and sees it
 * stick, then finds the teacher still cannot do it, has been told something false
 * about who can see what.
 *
 * THE DATABASE IS THE AUTHORITY. `has_permission(code)` reads `role_permissions` and
 * `user_permissions` and is what every policy calls. This module only edits the rows
 * that function reads; it never decides anything itself.
 */
import { requireSupabase } from './client';

export type RoleCode = 'ADMIN' | 'TEACHER' | 'GUARDIAN';

export interface RolePermissionRow {
    roleCode: RoleCode;
    permissionCode: string;
}

export interface PermissionRow {
    code: string;
    description: string | null;
}

/** Every permission the system knows about. */
export async function listPermissions(): Promise<PermissionRow[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('permissions')
        .select('code, description')
        .order('code')
        // The permission list is fixed and small — 42 codes on this schema. The limit
        // is stated rather than implied so the reader is not at the mercy of the
        // 1,000-row response cap (audit F28): if permissions ever grew past this,
        // the number would be visibly wrong instead of silently truncated.
        .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as PermissionRow[];
}

/**
 * Which permissions each role currently holds.
 *
 * A permission a role does NOT hold is simply absent, rather than present with
 * `false` — the table records grants, not decisions. The caller renders absence as
 * "off", and removing a row is how a permission is taken away.
 */
export async function listRolePermissions(): Promise<RolePermissionRow[]> {
    const db = requireSupabase();
    const { data, error } = await db
        .from('role_permissions')
        .select('role_code, permission_code')
        // Three roles times the permission list is far under a thousand; the bound is
        // stated so a silent truncation at the response cap cannot masquerade as
        // "this role holds fewer permissions".
        .limit(1000);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { role_code: string; permission_code: string }[]).map(r => ({
        roleCode: r.role_code as RoleCode,
        permissionCode: r.permission_code,
    }));
}

/**
 * Turn one permission on or off for one role.
 *
 * WHY ADMIN IS REFUSED IN THE DATABASE RATHER THAN BY THIS FUNCTION. If the office
 * could remove `settings.manage` from ADMIN, it could lock EVERY admin out of the
 * settings screen that would put it back — including whoever did it. The check lives
 * in a `security definer` function so a caller cannot skip it by writing the table
 * directly.
 */
export async function setRolePermission(
    roleCode: RoleCode,
    permissionCode: string,
    enabled: boolean,
): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.rpc('set_role_permission', {
        p_role_code: roleCode,
        p_permission_code: permissionCode,
        p_enabled: enabled,
    });
    if (error) throw new Error(error.message);
}

/** Apply several changes, so a screen's Save is one call rather than N round trips. */
export async function setRolePermissions(
    changes: { roleCode: RoleCode; permissionCode: string; enabled: boolean }[],
): Promise<void> {
    const db = requireSupabase();
    const { error } = await db.rpc('set_role_permissions', {
        p_changes: changes.map(c => ({
            role_code: c.roleCode,
            permission_code: c.permissionCode,
            enabled: c.enabled,
        })),
    });
    if (error) throw new Error(error.message);
}
