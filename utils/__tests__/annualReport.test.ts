/**
 * The annual report gathers the three term report cards into one.
 *
 * WHY THIS IS TESTED NOW. It finds a term's report card by matching the term's
 * NAME. So when a school calls its terms "Penggal 1/2/3" and the lookup is
 * looking for "First Term", the match finds nothing and the annual report comes
 * back EMPTY. That reads on screen as "this student has no results", which is a
 * plausible thing to see and sends the office looking in the wrong place.
 *
 * The same marks also have to produce the same LETTER as the term card it
 * summarises, so the grade bands are asserted against the school's agreed scale.
 */
import { describe, it, expect } from 'vitest';
import { CANONICAL_TERMS, gradeFromTotal, buildAnnualReportCard } from '../annualReport';
import type { ReportCard } from '../../types';

const card = (term: string, marks: Record<string, number>): ReportCard => ({
  term,
  session: '2026',
  academicRecords: Object.entries(marks).map(([subject, total]) => ({ subject, total })) as any,
  skills: {}, psychomotor: {},
  attendance: { total: 100, present: 95, absent: 3, late: 2 },
  teacherComment: '', principalComment: '',
  status: 'Published',
});

describe('annual report', () => {
  it('THE RULE: the school\u2019s terms are the keys it looks for', () => {
    // If this list and the strings on the report cards disagree, the annual
    // report silently comes back empty.
    expect(CANONICAL_TERMS).toEqual(['Penggal 1', 'Penggal 2', 'Penggal 3']);
  });

  it('THE RULE: three Malay terms combine into an annual result', () => {
    const annual = buildAnnualReportCard([
      card('Penggal 1', { 'Matematik': 60 }),
      card('Penggal 2', { 'Matematik': 70 }),
      card('Penggal 3', { 'Matematik': 80 }),
    ]);
    expect(annual).not.toBeNull();
    // The average of the terms that have a score: (60+70+80)/3 = 70.
    const maths = annual!.academicRecords.find(r => r.subject === 'Matematik');
    expect(Number(maths!.total)).toBe(70);
  });

  it('THE RULE: an OLD English term name no longer matches', () => {
    // This is the bug, stated as a test. Cards filed as "First Term" belonged to
    // the old naming; the school's terms are Malay now.
    const annual = buildAnnualReportCard([card('First Term', { 'Matematik': 90 })]);
    expect(annual).toBeNull();
  });

  it('THE RULE: a subject missing a term is averaged from the terms it has', () => {
    // Not blocked, and not treated as a zero. A zero would be a mark nobody gave.
    const annual = buildAnnualReportCard([
      card('Penggal 1', { 'Sains': 40 }),
      card('Penggal 2', { 'Sains': 60 }),
    ]);
    const sains = annual!.academicRecords.find(r => r.subject === 'Sains');
    expect(Number(sains!.total)).toBe(50);
  });

  it('THE RULE: the annual grade agrees with the school\u2019s agreed bands', () => {
    // A 80, B 65, C 50, D 35, E below.
    expect(gradeFromTotal(80)).toBe('A');
    expect(gradeFromTotal(79)).toBe('B');
    expect(gradeFromTotal(65)).toBe('B');
    expect(gradeFromTotal(64)).toBe('C');
    expect(gradeFromTotal(50)).toBe('C');
    expect(gradeFromTotal(49)).toBe('D');
    expect(gradeFromTotal(35)).toBe('D');
    expect(gradeFromTotal(34)).toBe('E');
    expect(gradeFromTotal(0)).toBe('E');
  });

  it('THE RULE: there is no F on this school\u2019s scale', () => {
    // A sixth letter would be a grade the school never issues.
    for (const mark of [0, 10, 20, 30, 34]) {
      expect(gradeFromTotal(mark)).not.toBe('F');
    }
  });

  it('THE RULE: a 70 is a B on BOTH the annual and the ordinary scale', () => {
    // 70 was an A here and a B in the settings service — two scales inside one
    // codebase, both looking plausible alone.
    expect(gradeFromTotal(70)).toBe('B');
  });
});
