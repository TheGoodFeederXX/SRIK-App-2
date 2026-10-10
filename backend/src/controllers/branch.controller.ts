/**
 * SCHOOL SCOPE — the school record the app scopes its data to.
 *
 * WHAT WAS HERE. A full branch-management API: list branches, create, rename,
 * delete, transfer a user between branches, and a branch picker. It was built for a
 * product where one account could belong to several branches. This school has ONE
 * school and NO `branches` table in its database, so every one of those endpoints
 * could only ever return an empty list or fail — and the screens that called them
 * (branch switcher, transfer, branch curriculum) have been removed.
 *
 * WHAT REMAINS. `getAuthorizedBranches` alone. The school-scope context calls it to
 * resolve the school's own identity record — its name in the header and the id that
 * screens pass to the server as a scope parameter. The name is kept because the
 * server's field, and the client that calls it, are named that way.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import * as BranchTransfer from '../services/branchTransfer.service';
import { sendError } from '../utils/httpError';

export const getAuthorizedBranches = async (req: AuthRequest, res: Response) => {
    try {
        const result = await BranchTransfer.getAuthorizedBranches(req.user);
        res.json(result);
    } catch (error: any) {
        sendError(res, error, 'branch.controller.ts');
    }
};
