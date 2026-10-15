/**
 * The class-name helper, and the Nigerian terms it exists to keep out.
 *
 * The risk this guards is specific: a grade of 7 used to print "JSS 1" and a grade
 * of 10 used to print "SSS 1" — secondary-school levels from another country — on a
 * *report card a parent reads*. A test that only checked "it returns a string" would
 * have passed on the broken code. These check the actual words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    classLevelName,
    isPrimaryGrade,
    HIGHEST_PRIMARY_GRADE,
} from '../gradeLevel';

describe('classLevelName names a primary class the way the school does', () => {
    it('names every grade the school actually teaches', () => {
        // The school's own word, as used elsewhere in the app.
        expect(classLevelName(1, 'Tahun')).toBe('Tahun 1');
        expect(classLevelName(4, 'Tahun')).toBe('Tahun 4');
        expect(classLevelName(6, 'Tahun')).toBe('Tahun 6');
    });

    it('uses the English word when English is selected', () => {
        expect(classLevelName(4, 'Year')).toBe('Year 4');
    });

    it('never produces a Nigerian secondary-school level', () => {
        // These are the exact strings the old duplicated functions produced.
        for (let grade = 1; grade <= 12; grade++) {
            const name = classLevelName(grade, 'Tahun');
            expect(name ?? '', `grade ${grade} produced a secondary level`)
                .not.toMatch(/JSS|SSS|SENIOR|JUNIOR|FORM/i);
        }
    });

    it('refuses a grade the school does not have, rather than inventing one', () => {
        // A grade of 7 is not "Tahun 7" here — there is no such class. Returning
        // null lets the screen decide; returning "Tahun 7" would state a falsehood.
        expect(classLevelName(7, 'Tahun')).toBeNull();
        expect(classLevelName(10, 'Tahun')).toBeNull();
        expect(classLevelName(12, 'Tahun')).toBeNull();
        expect(classLevelName(0, 'Tahun')).toBeNull();
        expect(classLevelName(-1, 'Tahun')).toBeNull();
    });

    it('handles a missing grade without printing something untrue', () => {
        expect(classLevelName(null, 'Tahun')).toBeNull();
        expect(classLevelName(undefined, 'Tahun')).toBeNull();
        expect(classLevelName(NaN, 'Tahun')).toBeNull();
    });

    it('treats grades 1 to 6 as the school\'s range and nothing beyond', () => {
        expect(HIGHEST_PRIMARY_GRADE).toBe(6);
        for (let g = 1; g <= 6; g++) expect(isPrimaryGrade(g), `grade ${g}`).toBe(true);
        for (const g of [0, 7, 8, 9, 10, 11, 12, 13]) {
            expect(isPrimaryGrade(g), `grade ${g} is not a class here`).toBe(false);
        }
    });
});

describe('the old duplicated Nigerian logic is gone from the screens', () => {
    // The four files that each carried their own copy. If a copy returns, this
    // fails with the file that brought it back.
    const SCREENS = [
        'components/shared/SelectReportTermScreen.tsx',
        'components/teacher/SelectTermForReportScreen.tsx',
        'components/teacher/StudentProfileScreen.tsx',
        'components/shared/learningHubConstants.ts',
    ];

    for (const file of SCREENS) {
        it(`${file} no longer names a secondary level`, () => {
            const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
            // Strip comments: the removal is *documented* in some of these files,
            // and an explanation of what was removed is not a re-introduction.
            const code = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            expect(code, 'names a JSS/SSS level again').not.toMatch(/`JSS |`SSS |'JSS |'SSS /);
        });
    }
});

describe('the school cannot be recorded as following a curriculum it does not teach', () => {
    // These screens let an admin choose the curriculum. Each offered 'British',
    // 'American' or a dual stream — syllabuses SRIK is not accredited for and does
    // not follow. A choice that can be saved is worse than a wrong label: it feeds
    // subject lists and term structures elsewhere.
    const SCREENS = [
        'components/admin/AcademicSettingsScreen.tsx',
        'components/admin/CurriculumManagementScreen.tsx',
        'components/admin/ExamManagement.tsx',
        'components/admin/StudentEnrollmentPage.tsx',
        'components/admin/AddExamScreen.tsx',
    ];

    for (const file of SCREENS) {
        it(`${file} offers no foreign curriculum`, () => {
            const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
            const code = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            // An <option>, a value, or a list entry. A mention inside a comment (the
            // removal is documented) is stripped above and therefore allowed.
            expect(code, 'offers British/American/Dual again')
                .not.toMatch(/value=["'](British|American|Both|Dual)["']/i);
            expect(code, 'offers a Cambridge/IGCSE track again')
                .not.toMatch(/Cambridge|IGCSE|Common Core/i);
        });
    }

    it('the class list stops at the last year the school teaches', () => {
        const src = readFileSync(resolve(__dirname, '../../constants.tsx'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        // A class named JSS/SSS, or levelled 'Secondary', would be a year the school
        // does not run appearing in the list a teacher picks a class from.
        expect(code, 'lists a secondary class again').not.toMatch(/name: '(JSS|SSS) /);
        expect(code, "levels a class as 'Secondary' again").not.toMatch(/level: 'Secondary'/);
    });
});
