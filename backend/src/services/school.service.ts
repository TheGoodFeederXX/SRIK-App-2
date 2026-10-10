import prisma from '../config/database';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { Role } from '../../generated/prisma-client';
import { EmailService } from './email.service';
import { OnboardingService } from './onboarding.service';
import { SocketService } from './socket.service';

export class SchoolService {
    static async onboard(data: any) {
        // Use the new OnboardingService which handles OTP verification
        const result = await OnboardingService.createSchoolWithSetup({
            schoolName: data.schoolName,
            schoolCode: data.schoolCode || data.schoolName.substring(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, ''),
            schoolEmail: data.adminEmail || data.contact_email,
            phone: data.phone || '',
            address: data.address,
            state: data.state,
            logoUrl: data.logoUrl,
            mainBranchName: data.branchNames?.[0] || 'Main Campus',
            mainBranchCode: data.mainBranchCode || 'MAIN',
            additionalBranches: data.branchNames?.slice(1)?.map((name: string) => ({
                name,
                code: name.substring(0, 4).toUpperCase()
            })) || [],
            adminName: data.adminName,
            adminEmail: data.adminEmail,
            adminPassword: data.adminPassword,
            planType: data.planType || 'free'
        });

        const response = {
            success: true,
            message: result.message,
            data: result.data
        };

        if (result.data?.schoolId) {
            SocketService.emitToSchool(result.data.schoolId, 'school:updated', { action: 'onboard' });
        }
        return response;
    }

    static async createSchool(data: any) {
        const school = await prisma.school.create({
            data: data
        });
        SocketService.emitToSchool(school.id, 'school:updated', { action: 'create' });
        return school;
    }

    static async getAllSchools() {
        return await prisma.school.findMany();
    }

    // Used by the unauthenticated /public route — must NEVER include payment
    // provider credentials, contact info, or billing data, since anyone on the
    // internet can call this without logging in.
    static async getPublicSchoolDirectory() {
        return await prisma.school.findMany({
            where: { is_active: true },
            select: {
                id: true,
                name: true,
                code: true,
                slug: true,
                logo_url: true,
                curriculum_type: true,
            },
        });
    }

    static async getSchoolById(schoolId: string, id: string) {
        // RELIABILITY: Support 'current' or empty ID to refer to the authenticated tenant.
        // If the ID passed is the school_generated_id of an admin (OLISKEY_MAIN_ADM_0001),
        // we strictly fall back to the schoolId carried in the verified JWT.
        const targetId = (!id || id === 'current' || id === 'me' || id.includes('_ADM_')) ? schoolId : id;

        return await prisma.school.findFirst({
            where: {
                id: targetId,
                // SECURITY: Multi-tenant isolation. A user can only ever read their own school.
                AND: { id: schoolId }
            }
        });
    }

    static async getPilotOnboardingData(schoolId: string) {
        return await prisma.school.findUnique({
            where: { id: schoolId },
            select: {
                id: true,
                name: true,
                state: true,
                curriculum_type: true,
                onboarding_step: true,
                is_onboarded: true
            }
        });
    }

    static async savePilotProgress(schoolId: string, payload: {
        name?: string;
        curriculum_type?: string;
        onboarding_step?: number;
        is_onboarded?: boolean;
    }) {
        const result = await prisma.school.update({
            where: { id: schoolId },
            data: {
                ...payload,
                updated_at: new Date()
            },
            select: {
                id: true,
                name: true,
                state: true,
                curriculum_type: true,
                onboarding_step: true,
                is_onboarded: true
            }
        });

        SocketService.emitToSchool(schoolId, 'school:updated', { action: 'pilot_progress' });
        return result;
    }

    static async updateSchool(schoolId: string, id: string, updates: any) {
        // `settings` is a single JSON column shared by several independent screens
        // (academic settings, security policy, branding, etc). A plain Prisma
        // `update` with a partial `settings` object REPLACES the whole column,
        // silently wiping every key the caller didn't send. Merge it server-side
        // so any caller can safely send just the keys it owns.
        if (updates && typeof updates.settings === 'object' && updates.settings !== null && !Array.isArray(updates.settings)) {
            const existing = await prisma.school.findUnique({ where: { id }, select: { settings: true } });
            const existingSettings = (existing?.settings && typeof existing.settings === 'object') ? existing.settings as any : {};
            const merged: any = { ...existingSettings, ...updates.settings };
            // Explicit `null` on a key is the caller's way to delete that key
            // (a merge alone can only add/overwrite, never remove).
            for (const [k, v] of Object.entries(updates.settings)) {
                if (v === null) delete merged[k];
            }
            updates = { ...updates, settings: merged };
        }

        const result = await prisma.school.update({
            where: { id: id },
            data: updates
        });

        SocketService.emitToSchool(id, 'school:updated', { action: 'update' });
        return result;
    }

    static async updateSchoolSubscription(schoolId: string, id: string, updates: any) {
        // Defence in depth: the target row must be the caller's own tenant. The
        // controller also checks this, but scoping the write here means a future
        // caller cannot reintroduce a cross-tenant update by passing a foreign id.
        if (!schoolId || schoolId !== id) {
            throw new Error('School not found or permission denied');
        }

        const result = await prisma.school.updateMany({
            where: {
                id: id,
            },
            data: updates
        });

        if (result.count > 0) {
            SocketService.emitToSchool(id, 'school:updated', { action: 'subscription_update', updates });
            return await prisma.school.findUnique({ where: { id: id } });
        }

        throw new Error('School not found or permission denied');
    }

    static async updateSchoolStatusBulk(schoolId: string, ids: string[], status: string) {
        const data: any = {};
        if (status === 'active') data.is_active = true;
        else if (status === 'suspended') data.is_active = false;
        
        // Also update subscription_status if it's a known value or if we want to sync it
        const subStatuses = ['active', 'trial', 'past_due', 'canceled', 'suspended'];
        if (subStatuses.includes(status)) {
            data.subscription_status = status;
        }

        const result = await prisma.school.updateMany({
            where: { id: { in: ids } },
            data
        });

        ids.forEach(id => SocketService.emitToSchool(id, 'school:updated', { action: 'status_update', status }));
        return result;
    }

    static async deleteSchoolsBulk(schoolId: string, ids: string[]) {
        const demoSchoolId = config.demoSchoolId;

        if (demoSchoolId && ids.includes(demoSchoolId)) {
            throw new Error('Deletion protection: the demo school cannot be deleted as it is the default school.');
        }

        const result = await prisma.school.deleteMany({
            where: { id: { in: ids } }
        });

        ids.forEach(id => SocketService.emitToSchool(id, 'school:deleted', { action: 'delete' }));
        return result;
    }

    static async deleteSchool(schoolId: string) {
        // Perform deletion in a transaction to ensure integrity
        return await prisma.$transaction(async (tx) => {
            // Delete related records in reverse dependency order
            // Note: This assumes standard relational structure. 
            // If prisma schema has `onDelete: Cascade` defined, many of these 
            // might be handled automatically, but explicit deletion is safer.
            
            await tx.auditLog.deleteMany({ where: { school_id: schoolId } });
            await tx.schoolMembership.deleteMany({ where: { school_id: schoolId } });
            await tx.branch.deleteMany({ where: { school_id: schoolId } });
            await tx.user.deleteMany({ where: { school_id: schoolId } });
            await tx.student.deleteMany({ where: { school_id: schoolId } });
            await tx.teacher.deleteMany({ where: { school_id: schoolId } });
            await tx.parent.deleteMany({ where: { school_id: schoolId } });
            await tx.class.deleteMany({ where: { school_id: schoolId } });
            
            // Finally delete the school
            const result = await tx.school.delete({
                where: { id: schoolId }
            });

            SocketService.emitToSchool(schoolId, 'school:deleted', { action: 'delete' });
            return result;
        });
    }

    static async getSchoolPolicies(schoolId: string) {
        return await prisma.schoolPolicy.findMany({
            where: { school_id: schoolId },
            orderBy: { created_at: 'desc' }
        });
    }

    static async getSchoolPhotos(schoolId: string) {
        return await prisma.schoolGallery.findMany({
            where: { school_id: schoolId },
            orderBy: { created_at: 'desc' }
        });
    }
}
