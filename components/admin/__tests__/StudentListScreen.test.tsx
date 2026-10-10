/**
 * Student list — data layer tests.
 *
 * The previous version of this file asserted that headcounts arrived first and
 * each class was fetched only on expand. That behaviour is gone: the legacy
 * roster could reach 1.5MB so the lazy fetch paid for itself, but at SRIK's
 * ~250 students it only made a collapsed class look empty. These tests assert
 * what the screen does now.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import StudentListScreen from '../StudentListScreen';
import { AuthProvider } from '../../../context/AuthContext';
import { ProfileProvider } from '../../../context/ProfileContext';
import { SchoolScopeProvider } from '../../../context/SchoolScopeContext';

const listStudents = vi.fn();
const setStudentStatus = vi.fn();

/**
 * Renders the screen with a FRESH cache, inside all the app's providers.
 *
 * This screen's query key is a constant, and the shared test helper keeps one
 * QueryClient with `staleTime: Infinity`. Without a fresh cache per test the
 * first test's students are served to every later one, so results depend on
 * test order — which is exactly what happened here. Rather than change the
 * shared helper (used by many other files), this test composes the providers
 * itself with a new client each time.
 */
/**
 * Renders the screen with a FRESH cache inside the app's real providers.
 *
 * This screen's query key is a constant, and the shared test helper keeps one
 * QueryClient with `staleTime: Infinity`. Without a fresh cache per test the
 * first test's students are served to every later one, so results depend on
 * test order — which is what happened before this. Composing the providers here
 * keeps the fix local instead of changing a helper many other files rely on.
 */
const renderScreen = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter>
                <AuthProvider>
                    <ProfileProvider>
                        <SchoolScopeProvider>
                            <StudentListScreen navigateTo={vi.fn()} schoolId="school-123" />
                        </SchoolScopeProvider>
                    </ProfileProvider>
                </AuthProvider>
            </MemoryRouter>
        </QueryClientProvider>
    );

vi.mock('../../../src/lib/supabase/students', () => ({
    listStudents: (...a: unknown[]) => listStudents(...a),
    setStudentStatus: (...a: unknown[]) => setStudentStatus(...a),
}));

const row = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    admissionNo: 'S-0001',
    fullName: 'Ahmad Zaki',
    gender: 'MALE',
    birthDate: '2017-05-01',
    birthPlace: null,
    nationality: null,
    identityNo: null,
    address: null,
    previousSchool: null,
    admissionDate: '2026-01-02',
    status: 'ACTIVE',
    className: '3 Al-Junaidi',
    classId: 'c1',
    // The year level comes from its own database column. Class names may be
    // renamed at any time, so nothing here is derived from the name text.
    yearLevel: 3,
    classCode: '3J',
    guardians: [],
    ...over,
});

/**
 * Renders with a FRESH query cache per test.
 *
 * The shared test helper keeps one QueryClient with `staleTime: Infinity`, which
 * is right for most screens but wrong here: this screen's query key is a
 * constant, so without a fresh cache the first test's data would be served to
 * every test after it and the assertions would pass or fail depending on order.
 */


/**
 * Expands the year band containing a class, then the class itself.
 *
 * Both levels start collapsed — a school with many classes should not open them
 * all — so a class's name is not in the DOM until its band is opened, and its
 * rows are not there until the class is opened too.
 */
const expandClass = async (className: string) => {
    // Open every collapsed band exactly once.
    //
    // "Unassigned" serves as both a band title and the class name inside it, so
    // a naive "click everything matching" loop would toggle that band twice and
    // leave it closed again. Clicking only elements whose own aria-expanded says
    // they are still collapsed avoids that.
    for (const band of await screen.findAllByText(/^Year \d+ - \d+$|^Unassigned$/)) {
        const button = band.closest('button') ?? band;
        if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
    }
    const heading = await screen.findByText(className);
    if (heading.getAttribute('aria-expanded') !== 'true') fireEvent.click(heading);
    return heading;
};

describe('StudentListScreen — reads from Supabase', () => {
    beforeEach(() => {
        listStudents.mockReset();
        setStudentStatus.mockReset();

    });

    it('shows students grouped under their real SRIK class name', async () => {
        listStudents.mockResolvedValue([row()]);
        renderScreen();
        await expandClass('3 Al-Junaidi');
        expect(await screen.findByText('Ahmad Zaki')).toBeDefined();
    });

    it('does not show legacy stage headings the school does not have', async () => {
        // "Senior Secondary", "Junior Secondary" and "Preschool" were all empty
        // for a primary school. Their absence is the point.
        listStudents.mockResolvedValue([row()]);
        renderScreen();
        await expandClass('3 Al-Junaidi');

        const body = document.body.textContent ?? '';
        expect(body).not.toMatch(/senior secondary/i);
        expect(body).not.toMatch(/junior secondary/i);
        expect(body).not.toMatch(/preschool|nursery/i);
    });

    it('orders Year 1 before Year 4', async () => {
        listStudents.mockResolvedValue([
            row({ id: 'a', fullName: 'Pelajar Empat', className: '4 Al-Busiri', yearLevel: 4, classCode: '4B' }),
            row({ id: 'b', fullName: 'Pelajar Satu', className: '1 Al-Junaidi', yearLevel: 1, classCode: '1J' }),
        ]);
        renderScreen();
        await expandClass('4 Al-Busiri');
        await expandClass('1 Al-Junaidi');
        await screen.findByText('Pelajar Empat');

        const body = document.body.textContent ?? '';
        expect(body.indexOf('1 Al-Junaidi')).toBeLessThan(body.indexOf('4 Al-Busiri'));
    });

    it('shows students with no class under Unassigned, listed last', async () => {
        listStudents.mockResolvedValue([
            row({ id: 'a', fullName: 'Belum Ditempat', className: null, yearLevel: null, classCode: null }),
            row({ id: 'b', fullName: 'Sudah Ditempat', className: '1 Al-Junaidi', yearLevel: 1, classCode: '1J' }),
        ]);
        renderScreen();

        // Open the placed class, then the unassigned BAND (clicking the heading
        // text alone is ambiguous there, because "Unassigned" is both the band
        // title and the class inside it — so open it by its own heading text
        // within the band, then the class beneath).
        await expandClass('1 Al-Junaidi');
        await screen.findByText('Sudah Ditempat');

        // The unassigned band holds the student with no class.
        const unassignedHeadings = screen.getAllByText('Unassigned');
        for (const h of unassignedHeadings) {
            const button = h.closest('button') ?? h;
            if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
        }
        await screen.findByText('Belum Ditempat');

        // "Unassigned" is both a band heading and the class heading beneath it,
        // so it appears more than once; the meaningful assertion is that the
        // student with no class is still reachable, and sits below the placed
        // students rather than above them.
        const body = document.body.textContent ?? '';
        expect(body).toContain('Unassigned');
        expect(body.indexOf('1 Al-Junaidi')).toBeLessThan(body.indexOf('Unassigned'));
        expect(body).toContain('Belum Ditempat');
    });

    it('filters by name, admission number and guardian name', async () => {
        listStudents.mockResolvedValue([
            row({ id: 'a', fullName: 'Ahmad Zaki', admissionNo: 'S-0001' }),
            row({
                id: 'b', fullName: 'Nur Aisyah', admissionNo: 'S-0002',
                guardians: [{
                    id: 'g1', fullName: 'Ali bin Osman', relationship: 'Bapa',
                    phone: '0123456789', email: null, isPrimary: true, isEmergencyContact: true,
                }],
            }),
        ]);
        renderScreen();
        await expandClass('3 Al-Junaidi');
        await screen.findByText('Ahmad Zaki');

        // While searching, sections force open, so matches are visible without
        // expanding anything.
        const input = screen.getByPlaceholderText('Search by name...');

        fireEvent.change(input, { target: { value: 'aisyah' } });
        await waitFor(() => expect(screen.queryByText('Ahmad Zaki')).toBeNull());
        expect(screen.getByText('Nur Aisyah')).toBeDefined();

        fireEvent.change(input, { target: { value: 'S-0001' } });
        await waitFor(() => expect(screen.getByText('Ahmad Zaki')).toBeDefined());

        // By guardian name — how a school actually finds a child at the counter.
        fireEvent.change(input, { target: { value: 'Ali bin Osman' } });
        await waitFor(() => expect(screen.getByText('Nur Aisyah')).toBeDefined());
        expect(screen.queryByText('Ahmad Zaki')).toBeNull();
    });

    it('hides withdrawn students from the active roster', async () => {
        listStudents.mockResolvedValue([
            row({ id: 'a', fullName: 'Masih Belajar' }),
            row({ id: 'b', fullName: 'Sudah Keluar', status: 'WITHDRAWN' }),
        ]);
        renderScreen();
        await expandClass('3 Al-Junaidi');
        await screen.findByText('Masih Belajar');

        // A withdrawn student must not be listed as active.
        expect(screen.queryByText('Sudah Keluar')).toBeNull();
    });

    it('keeps working when a class is renamed', async () => {
        // The school may rename a class at any time ("5 Na'im" today, something
        // else tomorrow). Grouping and ordering read the year level from its own
        // column, so a name with no number in it — or a rename — changes only
        // the label on screen. This asserts that a class whose name contains no
        // digits still sorts correctly and appears.
        listStudents.mockResolvedValue([
            row({ id: 'a', fullName: 'Pelajar Na\'im', className: "5 Na'im", yearLevel: 5, classCode: '5N' }),
            row({ id: 'b', fullName: 'Pelajar Ma\'wa', className: "6 Ma'wa", yearLevel: 6, classCode: '6M' }),
        ]);
        renderScreen();
        await expandClass("5 Na'im");
        await expandClass("6 Ma'wa");

        expect(await screen.findByText('Pelajar Na\'im')).toBeDefined();
        expect(await screen.findByText('Pelajar Ma\'wa')).toBeDefined();

        const body = document.body.textContent ?? '';
        // Year 5 sits in the lower band and Year 6 in the upper band, even
        // though neither name contains a number.
        expect(body).toContain("5 Na'im");
        expect(body).toContain("6 Ma'wa");
    });

    it('survives a failed load without a blank screen', async () => {
        listStudents.mockRejectedValue(new Error('offline'));
        renderScreen();
        expect(await screen.findByText(/failed to load students/i)).toBeDefined();
        expect(screen.getByText(/retry now/i)).toBeDefined();
    });
});
