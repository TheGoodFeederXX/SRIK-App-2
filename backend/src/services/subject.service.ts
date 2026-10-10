import prisma from '../config/database';
import { SocketService } from './socket.service';

// Standard Nigerian school subjects — seeded ONCE for a school that has no
// subjects of its own yet. From then on the school's Subject rows are the
// single source of truth everywhere (palette, class form, student form,
// gradebook); admin adds/deletes change those rows for their school only.
/**
 * The subjects this school actually teaches.
 *
 * WHAT WAS HERE: a 37-subject list from the original product — Nigerian Language
 * (Hausa/Igbo/Yoruba), Christian Religious Studies, Agricultural Science,
 * Government, Commerce, Further Mathematics. Not one of those is taught at SRIK,
 * and the subjects SRIK DOES teach were all absent: Bahasa Melayu, Jawi, Khat,
 * Tajwid, Hafazan, Feqah, Tauhid, Sirah, Tafsir, Akhlak, Bahasa Arab.
 *
 * The codes are the school's own (BM, JW, KH, ...), because a teacher reads them
 * on the timetable and the office uses them on report cards — they are the
 * school's shorthand, not ours.
 */
const STANDARD_SUBJECTS = [
    'Bahasa Melayu (BM)', 'Bahasa Inggeris (BI)', 'Matematik (MT)', 'Sains (SN)',
    'Sejarah (SJ)', 'Bahasa Arab (BA)', 'Al-Quran (AQ)', 'Tajwid (TJ)',
    'Hafazan (HFZ)', 'Tafsir (TF)', 'Hadis (HD)', 'Feqah (FQ)', 'Tauhid (TH)',
    'Sirah (SR)', 'Akhlak (AK)', 'Jawi (JW)', 'Khat (KH)',
    'Pendidikan Jasmani dan Kesihatan (PJK)', 'Pendidikan Seni Visual (PSV)',
    'Reka Bentuk dan Teknologi (RBT)',
];

export class SubjectService {
    static async getSubjects(schoolId: string, branchId?: string) {
        const where: any = { school_id: schoolId };
        // Branch isolation: this branch's own subjects, PLUS untagged ones
        // (branch_id null) — those are shared/legacy rows a class in this
        // branch can still be linked to (Class.subjects), so excluding them
        // here silently dropped real subjects (e.g. CCA, PHE, French) from
        // pickers like the student edit form while the class-subject picker,
        // which doesn't filter by the subject's own branch_id, kept showing them.
        if (branchId && branchId !== 'all') {
            where.OR = [{ branch_id: branchId }, { branch_id: null }];
        }
        const existing = await prisma.subject.findMany({
            where,
            orderBy: { name: 'asc' }
        });
        if (existing.length > 0) return existing;

        // Brand-new school (or branch) with no subjects yet — seed the standard
        // catalog once so every screen has a real, school-owned list to work
        // with. Deletions stick because this only runs when the list is EMPTY.
        const effectiveBranch = branchId && branchId !== 'all' ? branchId : null;
        await prisma.subject.createMany({
            data: STANDARD_SUBJECTS.map(name => ({
                school_id: schoolId,
                branch_id: effectiveBranch,
                name,
            })),
            skipDuplicates: true,
        });
        return await prisma.subject.findMany({ where, orderBy: { name: 'asc' } });
    }

    static async createSubject(schoolId: string, branchId: string | undefined, name: string, color?: string) {
        const subject = await prisma.subject.create({
            data: {
                school_id: schoolId,
                branch_id: branchId && branchId !== 'all' ? branchId : null,
                name: name,
                color: color || null
            }
        });

        SocketService.emitToSchool(schoolId, 'academic:updated', { action: 'create_subject', subjectId: subject.id });
        SocketService.emitToSchool(schoolId, 'subject:updated', { action: 'create', subjectId: subject.id, name: subject.name });
        return subject;
    }

    static async updateSubjectColor(schoolId: string, id: string, color: string | null) {
        const subject = await prisma.subject.findFirst({ where: { id, school_id: schoolId }, select: { id: true } });
        if (!subject) throw new Error('Subject not found');
        const updated = await prisma.subject.update({ where: { id }, data: { color } });
        SocketService.emitToSchool(schoolId, 'subject:updated', { action: 'update', subjectId: id });
        return updated;
    }

    static async deleteSubject(schoolId: string, id: string) {
        // Tenant check — never delete another school's subject.
        const subject = await prisma.subject.findFirst({
            where: { id, school_id: schoolId },
            select: { id: true, name: true }
        });
        if (!subject) {
            throw new Error('Subject not found');
        }

        // Hard delete. Relations resolve safely: class links (m2m) detach,
        // ClassTeacher.subject_id nulls out, quizzes/curriculum topics for the
        // subject cascade. Timetable and report card rows store the subject
        // NAME as text, so historical data is untouched.
        await prisma.subject.delete({ where: { id } });

        SocketService.emitToSchool(schoolId, 'academic:updated', { action: 'delete_subject', subjectId: id });
        SocketService.emitToSchool(schoolId, 'subject:updated', { action: 'delete', subjectId: id, name: subject.name });
        return { success: true };
    }

    static async getCurriculumTopics(schoolId: string, branchId: string | undefined, subjectId: string, term?: string) {
        // Confirm the subject actually belongs to this caller's tenant before
        // returning its curriculum topics.
        const subject = await prisma.subject.findFirst({
            where: { id: subjectId, school_id: schoolId, ...(branchId && branchId !== 'all' ? { branch_id: branchId } : {}) },
            select: { id: true },
        });
        if (!subject) return [];

        return await prisma.curriculumTopic.findMany({
            where: {
                subject_id: subjectId,
                term: term
            },
            orderBy: { week_number: 'asc' }
        });
    }
}
