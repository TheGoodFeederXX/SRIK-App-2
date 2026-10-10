import prisma from '../config/database';

/**
 * SCHOOL SCOPE — resolving the school record the app scopes its data to.
 *
 * WHAT WAS HERE. A branch-transfer service: moving a user between branches of a
 * school group, changing their primary branch (which regenerated their school ID),
 * and granting a teacher extra authorized branches. It also listed "all branches"
 * for administrators and "this visitor's sandbox" for demo sessions.
 *
 * This school is ONE school and its database has NO `branches` table. Every one of
 * those lookups therefore returned an empty list — which is why the school's name
 * never reached the header, and why a `currentBranch.id` passed to the server as a
 * scope parameter was always empty. `isMainAdmin` used to live here as well; it is
 * now in `utils/permissions`, beside the rest of the role logic.
 *
 * WHAT REMAINS. One function, whose real job is to answer "which school is this?".
 * There is exactly one school, so the answer is the school the signed-in account
 * belongs to.
 *
 * THE NAME. This file is still called `branchTransfer.service` and the field it
 * reads is still `branch_id`, because those names cross the client/server boundary
 * and are used by the API layer. Renaming them is a separate, larger job; doing it
 * here alone would break the contract without changing anything the user sees.
 */

/**
 * The school record(s) the signed-in account belongs to.
 *
 * Returns a list for compatibility with the caller, which reads `[0]`. In practice
 * it holds the single school. An empty array means the account is not attached to a
 * school yet — the caller then keeps whatever it already had on screen rather than
 * blanking the header.
 */
export async function getAuthorizedBranches(user: any) {
    const schoolId = user?.school_id;
    if (!schoolId) return [];

    // The school's OWN record. `schools` is a real table in this database, unlike
    // `branches`. This is the row that carries the school's name and address.
    const school = await (prisma as any).school?.findUnique?.({
        where: { id: schoolId },
        select: { id: true, name: true, code: true, logo_url: true },
    });

    if (!school) return [];

    // The shape mirrors what the client expects of a "branch": an id to scope by and
    // a name to display. `is_main` is true so any caller asking "is this the main
    // one?" gets the right answer for a single school.
    return [{
        id: school.id,
        name: school.name,
        code: school.code ?? null,
        is_main: true,
    }];
}
