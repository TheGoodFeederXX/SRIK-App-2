import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ParentDashboard from '../ParentDashboard';
import { MemoryRouter } from 'react-router';

// Direct Hook Mocks
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({
        user: { id: 'test-user', email: 'parent@demo.com', user_metadata: { role: 'parent' } },
        currentSchool: { id: 'school-123', name: 'Test School' },
        currentBranchId: null
    })
}));

vi.mock('../../../context/ProfileContext', () => ({
    useProfile: () => ({ profile: { role: 'parent' }, loading: false })
}));

vi.mock('../../../context/SchoolScopeContext', () => ({
    useSchoolScope: () => ({ currentBranch: null, branches: [] })
}));

// Mock layout and child components
vi.mock('../../../components/layout/DashboardLayout', () => ({
    default: ({ children, title }: any) => (
        <div data-testid="dashboard-layout">
            <h1>{title}</h1>
            {children}
        </div>
    )
}));

// The dashboard reads the family from Supabase now, not the legacy API. These mocks
// must match, or the real module is loaded and throws for want of a configured client
// — which is exactly what happened in CI, where there is no `.env`.
vi.mock('../../../src/lib/supabase/family', () => ({
    listMyChildren: vi.fn().mockResolvedValue([{
        student: {
            id: 'stu-1', admissionNo: 'S-001', fullName: 'Anak Ujian',
            className: '1 Al-Junaidi', classId: 'cls-1', gender: 'MALE',
            birthDate: null, status: 'ACTIVE',
        },
        relationship: 'Mother',
        isPrimary: true,
    }]),
    getMyGuardianRecord: vi.fn().mockResolvedValue({ id: 'parent-123', fullName: 'Test Parent' }),
    findStudentByCode: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/lib/supabase/attendance', () => ({
    getStudentAttendanceRange: vi.fn().mockResolvedValue({
        summary: {
            studentId: 'stu-1', studentName: 'Anak Ujian', daysRecorded: 0,
            present: 0, absent: 0, late: 0, excused: 0, sick: 0, attendanceRate: 0,
        },
        days: [],
    }),
}));

vi.mock('../../../src/lib/supabase/assessments', () => ({
    getCurrentTerm: vi.fn().mockResolvedValue({ id: 'term-1', name: 'Semester 1' }),
}));

vi.mock('../../../src/lib/supabase/academics', () => ({
    getCurrentAcademicYear: vi.fn().mockResolvedValue({
        id: 'yr-1', name: '2026', startDate: '2026-01-01', endDate: '2026-11-30', status: 'CURRENT',
    }),
}));

vi.mock('../../../src/lib/supabase/announcements', () => ({
    listAnnouncements: vi.fn().mockResolvedValue([]),
    AUDIENCE_LABELS: { ALL: 'Semua', STAFF: 'Guru dan staf', GUARDIANS: 'Ibu bapa', STUDENTS: 'Pelajar' },
}));

describe('ParentDashboard Visibility (Minimal)', () => {
    it('renders the parent dashboard shell', async () => {
        // The dashboard tree reaches useNotifications -> useQuery, so it needs a
        // QueryClient in scope. The context providers are mocked above at the hook
        // level, so we provide only the query client rather than the full app shell.
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ParentDashboard setIsHomePage={vi.fn()} />
                </MemoryRouter>
            </QueryClientProvider>
        );

        expect(await screen.findByText('Parent Dashboard')).toBeInTheDocument();
    });
});
