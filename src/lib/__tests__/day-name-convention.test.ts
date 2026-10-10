import { describe, it, expect } from 'vitest';
import { SCHOOL_DAY_ENUM, toSchoolDayEnum, SCHOOL_DAY_NAMES_MS } from '../branding';
import { DAY_NAMES } from '../../../lib/timetableSchedule';

describe('the day-name convention the timetable stores', () => {
  it('THE RULE: the enum matches the database values exactly', () => {
    // These strings are written into timetable_periods.day_of_week. The live
    // values are SUNDAY…THURSDAY; a rename here silently breaks every lookup.
    expect([...SCHOOL_DAY_ENUM].slice(0, 5)).toEqual(['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY']);
  });
  it('THE RULE: toSchoolDayEnum returns the stored name for a real date', () => {
    // 2026-03-02 is a Monday.
    expect(toSchoolDayEnum(new Date('2026-03-02T12:00:00Z'))).toBe('MONDAY');
    // 2026-03-01 is a Sunday.
    expect(toSchoolDayEnum(new Date('2026-03-01T12:00:00Z'))).toBe('SUNDAY');
    expect(toSchoolDayEnum(null)).toBeNull();
    expect(toSchoolDayEnum('not a date')).toBeNull();
  });
  it('THE RULE: the Malay and English lists agree on order', () => {
    // Both are Sunday-first and indexed by getDay(), so index 0 is Sunday in
    // both. If one is reordered the other must be too.
    expect(SCHOOL_DAY_NAMES_MS[0]).toBe('Ahad');
    expect(SCHOOL_DAY_ENUM[0]).toBe('SUNDAY');
    expect(SCHOOL_DAY_NAMES_MS.length).toBe(7);
    expect(SCHOOL_DAY_ENUM.length).toBe(7);
  });
  it('THE RULE: timetable DAY_NAMES is Sunday-first too, so they cannot drift', () => {
    expect(DAY_NAMES[0].toUpperCase()).toBe('SUNDAY');
    expect(DAY_NAMES.length).toBe(5);
  });
});
