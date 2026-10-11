/**
 * Guards for the exam screens.
 *
 * The exam screens called an Express server that is not deployed, so the office
 * and every teacher saw an empty grid and could not create an exam at all. These
 * checks pin the three things that make the replacement safe: the stored value is
 * the enum the database accepts, a locked exam cannot be edited or deleted, and
 * the two screens share one definition of what an exam looks like.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toExamRow, toAssessmentType } from '../exams';
import type { Assessment } from '../assessments';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TEACHER = read('components/teacher/TeacherExamManagement.tsx');
const ADMIN = read('components/admin/ExamManagement.tsx');
const FORM = read('components/admin/AddExamScreen.tsx');

const base: Assessment = {
    id: 'a1', title: 'Ujian', type: 'TEST', subjectId: 's1', subjectCode: 'MT',
    subjectName: 'Matematik', classId: 'c1', classDisplayName: '3J',
    academicTermId: 't1', termName: 'Penggal 1', maxScore: 100, weight: 100,
    assessmentDate: '2026-03-01', status: 'OPEN', createdBy: 'u1',
};

describe('exams', () => {
    it('writes only values the database enum accepts', () => {
        // Every label the form can produce must land on a real enum member. A
        // free-text value is refused by the column at the last moment, with an
        // error nobody at the school can act on.
        const ACCEPTED = ['MID_YEAR_EXAM', 'FINAL_EXAM', 'SPECIAL_EXAM', 'TEST', 'QUIZ', 'PBD'];
        const labels = ['Mid-term', 'Final', 'Quiz', 'Test', 'Assessment', 'Ujian', 'IGCSE', 'CHECKPOINT', ''];
        for (const label of labels) {
            expect(ACCEPTED, `"${label}" maps outside the enum`).toContain(toAssessmentType(label));
        }
        // And an unknown label does not become free text.
        expect(ACCEPTED).toContain(toAssessmentType('Something New'));
    });

    it('treats a published or closed exam as locked', () => {
        // The screens refuse to edit or delete a published exam. If that flag were
        // read from somewhere other than the status, the two could disagree and an
        // exam already issued to families could be changed.
        expect(toExamRow({ ...base, status: 'PUBLISHED' }).isPublished).toBe(true);
        expect(toExamRow({ ...base, status: 'CLOSED' }).isPublished).toBe(true);
        expect(toExamRow({ ...base, status: 'OPEN' }).isPublished).toBe(false);
        expect(toExamRow({ ...base, status: 'DRAFT' }).isPublished).toBe(false);
    });

    it('reports a missing date as empty rather than as today', () => {
        // An exam with no date set must not be shown as having one. Substituting
        // today would put a scheduled exam on the wrong day on a family's calendar.
        expect(toExamRow({ ...base, assessmentDate: null }).date).toBe('');
    });

    it('both screens read the one definition', () => {
        for (const [name, src] of [['teacher', TEACHER], ['admin', ADMIN]] as const) {
            expect(code(src), `${name} defines its own mapper`).not.toMatch(/function toExam\b/);
            expect(code(src), `${name} does not use the shared mapper`).toMatch(/toExamRow/);
        }
    });

    it('neither screen reaches for the undeployed client', () => {
        for (const [name, src] of [['teacher', TEACHER], ['admin', ADMIN], ['form', FORM]] as const) {
            expect(code(src), `${name} still imports lib/api`).not.toMatch(
                /from\s+['"][^'"]*lib\/api['"]/,
            );
        }
    });

    it('a teacher is not offered a step the database refuses', () => {
        // A teacher holds `assessments.enter_scores` but NOT `assessments.create`,
        // and the database enforces that: an insert as a teacher is refused by row
        // level security. Verified against production. So a teacher's screen must
        // not offer to create, edit or delete an exam — a button that cannot work
        // teaches the teacher that the system is broken.
        const teacher = code(TEACHER);
        expect(teacher, 'the teacher screen still offers to create an exam').not.toMatch(
            /handleAddNew/,
        );
        expect(teacher, 'the teacher screen still offers to edit or delete').not.toMatch(
            /createAssessment|updateAssessment|deleteAssessment/,
        );
        // And it still offers what a teacher CAN do.
        expect(teacher).toMatch(/gradeEntry|Enter Grades/);

        // The office keeps all of it: it holds assessments.create.
        const admin = code(ADMIN);
        expect(admin).toMatch(/createAssessment/);
        expect(admin).toMatch(/deleteAssessment/);
    });

    it('the class picker carries an id, not a name', () => {
        // Two classes can share a label across years and the school renames them.
        // Submitting a name is how an exam lands on last year's class.
        expect(code(FORM)).toMatch(/value=\{c\.id\}/);
        expect(code(FORM)).not.toMatch(/value=\{c\.name\}/);
    });
});
