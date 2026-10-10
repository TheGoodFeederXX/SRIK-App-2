import { Router } from 'express';
import { getAuthorizedBranches } from '../controllers/branch.controller';
import { authenticate } from '../middleware/auth.middleware';

/**
 * SCHOOL SCOPE routes.
 *
 * WHAT WAS HERE. A full branch-management API — list, create, rename, delete, and
 * transfer users between branches — behind an admin-only role gate. It belonged to a
 * product where one account could span several branches of a school group.
 *
 * This school is ONE school, and its database has no `branches` table. Every one of
 * those endpoints could therefore only return an empty list, and their screens
 * (branch switcher, transfer, branch curriculum) have been removed.
 *
 * ONE ROUTE REMAINS. `/authorized` resolves the school's identity record: the name
 * shown in the header, and the id that screens pass to the server as a scope
 * parameter. The path and function name keep the word "branch" because the client
 * that calls them does; renaming across that boundary is a separate job.
 *
 * `requireRole` was dropped along with the write endpoints — it existed only to
 * restrict branch creation and deletion to administrators.
 */
const router = Router();

router.get('/authorized', authenticate, getAuthorizedBranches);

export default router;
