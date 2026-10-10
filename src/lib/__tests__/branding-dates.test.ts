/**
 * Dates a Malaysian school would recognise.
 *
 * The point of these helpers is that the answer does not depend on the phone. A
 * test that ran with the machine's own locale would pass on a Malaysian machine
 * and fail on a teacher's, which is the bug being prevented — so every
 * expectation below is an explicit string, never the device's output.
 */
import { describe, it, expect } from 'vitest';
import {
    formatDate, formatDateTime, formatMonthYear, formatDayMonth,
    formatTime, toIsoDay, todayInSchoolTime, formatWeekday,
    SCHOOL_DAY_NAMES_MS, SCHOOL_DAY_SHORT_MS, SCHOOL_TIME_ZONE,
} from '../branding';

describe('Malay dates', () => {
    it('writes the month in Malay, not English', () => {
        // 2 March 2026. The English form is "Mar 2, 2026" or "2 Mar 2026"; the
        // Malay month name is what a parent reads on a receipt.
        expect(formatDate('2026-03-02T04:00:00Z')).toBe('2 Mac 2026');
    });

    it('names every month in Malay', () => {
        const months = [
            '2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15',
            '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15',
            '2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15',
        ].map(d => formatDate(d + 'T04:00:00Z'));

        // Januari, Februari, Mac, April, Mei, Jun, Julai, Ogos, September,
        // Oktober, November, Disember — the Malay names, in order.
        expect(months).toEqual([
            '15 Jan 2026', '15 Feb 2026', '15 Mac 2026', '15 Apr 2026',
            '15 Mei 2026', '15 Jun 2026', '15 Jul 2026', '15 Ogo 2026',
            '15 Sep 2026', '15 Okt 2026', '15 Nov 2026', '15 Dis 2026',
        ]);
    });

    it('THE RULE: a late-evening payment belongs to the day it was made', () => {
        // 11:30pm on 2 March in Kuala Lumpur is 15:30 UTC on the 2nd. A formatter
        // pinned to UTC would be right here and wrong for a payment made after
        // midnight — so the timezone is the school's, not UTC's.
        expect(formatDate('2026-03-02T15:30:00Z')).toBe('2 Mac 2026');
        // 00:30 on 3 March in Kuala Lumpur is still 2 March in UTC. UTC would
        // print the wrong day; the school's timezone does not.
        expect(formatDate('2026-03-02T16:30:00Z')).toBe('3 Mac 2026');
    });

    it('uses a 24-hour clock, as Malaysian school writing does', () => {
        // 3:45pm in Kuala Lumpur.
        expect(formatDateTime('2026-03-02T07:45:00Z')).toContain('15:45');
    });

    it('writes a whole month in Malay', () => {
        expect(formatMonthYear('2026-01-20T04:00:00Z')).toBe('Januari 2026');
    });

    it('writes a short day and month for a badge', () => {
        expect(formatDayMonth('2026-03-02T04:00:00Z')).toBe('2 Mac');
    });

    it('writes a time', () => {
        expect(formatTime('2026-03-02T07:45:00Z')).toBe('15:45');
    });

    it('THE RULE: an unreadable value shows nothing, not "Invalid Date"', () => {
        // A blank cell is better than a word a parent cannot act on.
        expect(formatDate(null)).toBe('—');
        expect(formatDate(undefined)).toBe('—');
        expect(formatDate('bukan tarikh')).toBe('—');
    });

    it('THE RULE: today is a MALAYSIAN today, not a UTC one', () => {
        // Between midnight and 8am Malaysian time, UTC is still yesterday.
        // `toISOString().slice(0,10)` would mark yesterday's register.
        const iso = todayInSchoolTime();
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        const expected = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: SCHOOL_TIME_ZONE,
        }).format(new Date());
        expect(iso).toBe(expected);
    });

    it('writes the machine day as YYYY-MM-DD', () => {
        expect(toIsoDay('2026-03-02T04:00:00Z')).toBe('2026-03-02');
        expect(toIsoDay(null)).toBe('');
    });

    it('writes Malay day names', () => {
        // 2026-03-01 is a Sunday.
        expect(formatWeekday('2026-03-01T04:00:00Z', true)).toBe('Ahad');
        expect(formatWeekday('2026-03-02T04:00:00Z', true)).toBe('Isnin');
    });

    it('THE RULE: the school week starts on Sunday, in Malay', () => {
        // Indexed directly by `getDay()`, so Sunday is index 0 and no arithmetic
        // is needed — which is exactly the off-by-one that put Monday's lessons
        // on a Sunday in the old timetable.
        expect(SCHOOL_DAY_NAMES_MS[0]).toBe('Ahad');
        expect(SCHOOL_DAY_NAMES_MS[4]).toBe('Khamis');
        expect(SCHOOL_DAY_NAMES_MS[5]).toBe('Jumaat');
        expect(SCHOOL_DAY_SHORT_MS[0]).toBe('Ah');
        // Friday and Saturday are the weekend here, so they are named but not
        // part of the teaching week.
        expect(SCHOOL_DAY_SHORT_MS[6]).toBe('Sa');
    });
});
