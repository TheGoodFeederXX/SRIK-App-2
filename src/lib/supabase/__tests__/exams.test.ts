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

/**
 * The mark-entry path, and the gradebook that reads it.
 *
 * SRIK records marks against REAL assessments, and a report card is a snapshot the
 * database builds and freezes. The gradebook used to be an editable grid of
 * `test1 (20) + test2 (20) + exam (60)` typed straight into a report card, which
 * contradicted both: its columns could not represent an assessment the school
 * schedules, and a hand-typed report card has no frozen version to show later.
 */
describe('marks entry and the gradebook', () => {
    const ENTRY = read('components/teacher/GradeEntryScreen.tsx');
    const GRADEBOOK = read('components/teacher/ClassGradebookScreen.tsx');

    it('marks are written against a real assessment', () => {
        // `saveMarks(assessmentId, rows)` is the only path. A call that named a
        // subject-and-term instead would be writing marks to nothing.
        expect(code(ENTRY)).toMatch(/saveMarks\(/);
        expect(code(ENTRY)).toMatch(/getMarkRegister\(/);
        expect(code(ENTRY), 'mark entry still writes the old report-card shape').not.toMatch(
            /test1|test2/,
        );
    });

    it('an empty box clears a mark instead of scoring zero', () => {
        // "Nobody has said anything yet" and "this child scored nothing" are
        // different facts, and only one of them belongs on a report card.
        expect(code(ENTRY)).toMatch(/NOT_ENTERED/);
        expect(code(ENTRY)).toMatch(/GRADED/);
    });

    it('a missing mark is never averaged as zero', () => {
        const gb = code(GRADEBOOK);

        // THE ASSERTION THAT MATTERS is the branch itself, not that a null check
        // exists somewhere. Writing `0` into an unmarked cell would still pass a
        // test that only looked for `=== null`, and it is the exact mistake that
        // makes a whole class look like it is failing — so the branch is pinned.
        expect(gb, 'an unmarked cell is not left empty').toMatch(
            /entry\.marks\[assessment\.title\] = null;/,
        );
        expect(gb, 'an unmarked cell is given a zero').not.toMatch(
            /entry\.marks\[assessment\.title\] = 0;/,
        );

        // The average is computed from the values that EXIST, so a null is dropped
        // rather than counted. `v !== null` is the filter that does it.
        expect(gb, 'the average does not filter out missing marks').toMatch(
            /filter\(\s*\(?v\)?:?\s*[\s\S]{0,20}v !== null/,
        );

        // And an unknown average is shown as a dash, not as a number. Several such
        // cells, hence a ternary rather than `??`.
        expect(gb).toMatch(/=== null \? '—'/);

        // The entry screen has no average at all: it writes one mark per child, and
        // an empty box clears rather than scores.
        expect(ENTRY).toMatch(/value === '' \? 'NOT_ENTERED'/);
    });

    it('the gradebook is a summary, not a second place to type marks', () => {
        // Two places that write marks is two answers to "what did this child
        // score". The gradebook displays; the entry screen writes.
        const gb = code(GRADEBOOK);
        expect(gb, 'the gradebook writes marks again').not.toMatch(
            /saveMarks|upsertReportCard|\.insert\(|\.update\(|\.upsert\(/,
        );
        expect(gb, 'the gradebook has an editable score box').not.toMatch(
            /onChange=\{.*handleScoreChange|<input[^>]+type="number"/,
        );
        // And it still reads, so it is a summary rather than a blank page.
        expect(gb).toMatch(/getMarkRegister/);
    });

    it('neither screen guesses the roster from a class name', () => {
        // The entry screen used to derive a grade and section by regex from
        // "Grade 3B". The exam carries the real class id, and guessing which
        // children sat an exam is not something to do quietly.
        const entry = code(ENTRY);
        expect(entry, 'the roster is guessed from a class name').not.toMatch(/className\.match/);
        expect(entry, 'the roster is guessed from a class name').not.toMatch(/gradeSection/);
    });
});
