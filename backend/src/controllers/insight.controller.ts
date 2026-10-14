import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { InsightService } from '../services/insight.service';
import prisma from '../config/database';
import { getEffectiveBranchId } from '../utils/branchScope';
import { sendError } from '../utils/httpError';

const ADMIN_ROLES = ['admin', 'proprietor', 'superadmin', 'super_admin'];

export const getMyInsights = async (req: AuthRequest, res: Response) => {
    try {
        const role = (req.user.role || '').toLowerCase();
        const branchId = getEffectiveBranchId(req.user, (req.query.branchId || req.query.branch_id) as string);

        if (ADMIN_ROLES.includes(role)) {
            return res.json(await InsightService.getAdminInsights(req.user.school_id, branchId));
        }
        if (role === 'teacher') {
            const teacher = await prisma.teacher.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
            if (!teacher) return res.json({ role: 'teacher', recommendations: [] });
            return res.json(await InsightService.getTeacherInsights(req.user.school_id, teacher.id));
        }
        if (role === 'parent') {
            const parent = await prisma.parent.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
            if (!parent) return res.json({ role: 'parent', children: [], recommendations: [] });
            return res.json(await InsightService.getParentInsights(req.user.school_id, parent.id));
        }
        if (role === 'student') {
            const student = await prisma.student.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
            if (!student) return res.json({ role: 'student', recommendations: [] });
            return res.json(await InsightService.getStudentInsights(req.user.school_id, student.id));
        }
        return res.json({ role, recommendations: [] });
    } catch (error: any) {
        sendError(res, error, 'insight.controller.ts');
    }
};
