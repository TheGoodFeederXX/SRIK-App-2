/**
 * Attendance overview — SRIK.
 *
 * The original screen showed charts from a pre-computed summary. This one
 * answers the question the office asks each morning: which classes have NOT
 * handed in their register. The tests below are mostly about that distinction,
 * because treating an unrecorded class as a class of truants would be a serious
 * mistake to make silently.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import AttendanceOverviewScreen from '../AttendanceOverviewScreen';

const { getSchoolDayOverview } = vi.hoisted(() => ({ getSchoolDayOverview: vi.fn() }));

vi.mock('../../../src/lib/supabase/attendance', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/supabase/attendance')>(
        '../../../src/lib/supabase/attendance'
    );
    return { ...actual, getSchoolDayOverview: (...a: unknown[]) => getSchoolDayOverview(...a) };
});

vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'admin-1' }, role: 'ADMIN', loading: false }),
}));

const renderScreen = (navigateTo = vi.fn()) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter><AttendanceOverviewScreen navigateTo={navigateTo} /></MemoryRouter>
        </QueryClientProvider>
    );

const cls = (over: Record<string, unknown> = {}) => ({
    classId: 'c1', classDisplayName: '3 Al-Junaidi', yearLevel: 3,
    expected: 20, recorded: 20, present: 18, absent: 2, unrecorded: false, ...over,
});

describe('AttendanceOverviewScreen — SRIK', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows a recorded class as done, with its absent count', async () => {
        getSchoolDayOverview.mockResolvedValue([cls()]);
        renderScreen();

        expect(await screen.findByText('3 Al-Junaidi')).toBeDefined();
        expect(screen.getByText('Done')).toBeDefined();
        expect(screen.getByText('2 absent')).toBeDefined();
        expect(screen.getByText('18 attended')).toBeDefined();
    });

    it('shows a class with no register as "not recorded", never as absent', async () => {
        // The distinction that matters most on this screen.
        getSchoolDayOverview.mockResolvedValue([
            cls({ classId: 'c2', classDisplayName: "5 Na'im", yearLevel: 5, recorded: 0, present: 0, absent: 0, unrecorded: true }),
        ]);
        renderScreen();

        await screen.findByText("5 Na'im");
        expect(screen.getByText('Not recorded')).toBeDefined();
        expect(screen.queryByText('0 absent')).toBeNull();
        expect(screen.queryByText('Done')).toBeNull();
    });

    it('puts the outstanding registers first', async () => {
        getSchoolDayOverview.mockResolvedValue([
            cls({ classId: 'c1', classDisplayName: '3 Al-Junaidi' }),
            cls({ classId: 'c2', classDisplayName: "5 Na'im", yearLevel: 5, recorded: 0, present: 0, absent: 0, unrecorded: true }),
        ]);
        renderScreen();

        await screen.findByText('3 Al-Junaidi');
        const body = document.body.textContent ?? '';
        // The office works through what is missing, so it belongs at the top.
        expect(body.indexOf("5 Na'im")).toBeLessThan(body.indexOf('3 Al-Junaidi'));
    });

    it('counts how many classes have handed in their register', async () => {
        getSchoolDayOverview.mockResolvedValue([
            cls({ classId: 'c1' }),
            cls({ classId: 'c2', classDisplayName: "5 Na'im", yearLevel: 5, recorded: 0, unrecorded: true }),
        ]);
        renderScreen();

        await screen.findByText('3 Al-Junaidi');
        expect(screen.getByText('Classes')).toBeDefined();
        expect(screen.getByText('1/2')).toBeDefined();
    });

    it('opens a class\'s register when tapped', async () => {
        const navigateTo = vi.fn();
        getSchoolDayOverview.mockResolvedValue([cls()]);
        renderScreen(navigateTo);

        await screen.findByText('3 Al-Junaidi');
        fireEvent.click(screen.getByText('3 Al-Junaidi'));

        expect(navigateTo).toHaveBeenCalledWith('attendanceRegister', 'Attendance', expect.objectContaining({ classId: 'c1' }));
    });

    it('warns that a non-school day is not a school day', async () => {
        getSchoolDayOverview.mockResolvedValue([cls()]);
        renderScreen();

        await screen.findByText('3 Al-Junaidi');
        fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-09' } }); // Friday

        expect(await screen.findByText(/not a school day/i)).toBeDefined();
    });

    it('explains an empty school rather than showing an empty chart', async () => {
        getSchoolDayOverview.mockResolvedValue([]);
        renderScreen();

        expect(await screen.findByText('No Classes With Students')).toBeDefined();
    });

    it('reports a failure to load instead of implying a clean day', async () => {
        getSchoolDayOverview.mockRejectedValue(new Error('offline'));
        renderScreen();

        expect(await screen.findByText('Could not load attendance')).toBeDefined();
    });
});
