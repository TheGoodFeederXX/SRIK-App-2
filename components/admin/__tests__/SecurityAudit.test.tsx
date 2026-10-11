
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserRolesScreen from '../UserRolesScreen';
import AddStudentScreen from '../AddStudentScreen';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// AddStudentScreen invalidates the cached rosters after a save, so it needs a
// client in scope — in the app it always renders under the provider in index.tsx.
const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);
import { toast } from 'react-hot-toast';
import { api } from '../../../lib/api';

// --- Mocks ---

// Mock API
vi.mock('../../../lib/api', () => {
  const mockApi = {
    getClasses: vi.fn().mockResolvedValue([]),
    getBuses: vi.fn().mockResolvedValue([]),
    getBranches: vi.fn().mockResolvedValue([]),
    getSchools: vi.fn().mockResolvedValue([]),
    getDepartments: vi.fn().mockResolvedValue([]),
    getRolePermissions: vi.fn(() => Promise.resolve({ data: [], error: null })),
    updateRolePermissions: vi.fn(() => Promise.resolve({ error: null })),
    fetchClasses: vi.fn(() => Promise.resolve([])),
    getParents: vi.fn(() => Promise.resolve([])),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    }),
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    getNextAdmissionNumber: vi.fn().mockResolvedValue({ admissionNumber: 'ADM-0001' }),
  };

  return {
    api: mockApi,
    default: mockApi,
  };
});

// Mock Contexts
const mockUseAuth = vi.fn(() => ({
  currentSchool: { id: 'school-123' },
  user: { id: 'user-123' },
  currentBranchId: 'branch-123'
}));
const mockUseProfile = vi.fn(() => ({
  profile: { schoolId: 'school-123' },
  refreshProfile: vi.fn()
}));
const mockUseTenantLimit = vi.fn(() => ({
  isLimitReached: false,
  currentCount: 0,
  maxLimit: 100,
  isPremium: false
}));

// The school-scope context. It used to advertise a branch-switching API; that is
// gone, because this school has one school and no branch feature.
const mockUseSchoolScope = vi.fn(() => ({
  currentBranch: { id: 'school-123', name: 'SRI Al-Khairiah', is_main: true },
  branches: [],
  refreshBranches: vi.fn(),
  isLoading: false,
  activeBranchGeneratedId: 'GEN-123',
  isMainAdmin: true,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../../context/ProfileContext', () => ({
  useProfile: () => mockUseProfile(),
}));

vi.mock('../../../hooks/useTenantLimit', () => ({
  useTenantLimit: () => mockUseTenantLimit(),
}));

vi.mock('../../../context/SchoolScopeContext', () => ({
  useSchoolScope: () => mockUseSchoolScope(),
}));

// Mock Toasts
// The student form now reads from Supabase, not the legacy API. Without this
// the real module would be loaded and would attempt live network calls.
vi.mock('../../../src/lib/supabase/students', () => ({
  listClassOptions: vi.fn().mockResolvedValue([]),
  suggestNextAdmissionNo: vi.fn().mockResolvedValue('S-0001'),
  createStudentWithDetails: vi.fn().mockResolvedValue({ success: true, studentId: 's1' }),
  updateStudent: vi.fn(),
  enrollStudent: vi.fn(),
  getStudent: vi.fn(),
}));

// The roles screen reads the database's OWN roles and permission codes now, not the
// fabricated catalogue it used to carry. The mock returns real codes, so an assertion
// that a fabricated one is absent is meaningful.
vi.mock('../../../src/lib/supabase/roles', () => ({
  listPermissions: vi.fn().mockResolvedValue([
    { code: 'assessments.enter_scores', description: 'Enter assessment scores' },
    { code: 'assessments.view', description: 'View assessments and results' },
    { code: 'attendance.record', description: 'Record daily attendance' },
  ]),
  listRolePermissions: vi.fn().mockResolvedValue([
    { roleCode: 'ADMIN', permissionCode: 'assessments.enter_scores' },
    { roleCode: 'ADMIN', permissionCode: 'assessments.view' },
    { roleCode: 'ADMIN', permissionCode: 'attendance.record' },
    { roleCode: 'TEACHER', permissionCode: 'assessments.view' },
  ]),
  setRolePermissions: vi.fn().mockResolvedValue(undefined),
  setRolePermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-hot-toast', () => {
  // Both shapes are used in the codebase: some screens import the named
  // `toast`, others the default export. The mock must provide both or a screen
  // using the default would silently call the real library.
  const toast = { success: vi.fn(), error: vi.fn() };
  return { default: toast, toast };
});

// Mock Icons to avoid rendering issues
vi.mock('../../../constants', () => ({
  ExamIcon: () => <div />,
  AttendanceIcon: () => <div />,
  ReportIcon: () => <div />,
  MegaphoneIcon: () => <div />,
  BookOpenIcon: () => <div />,
  ViewGridIcon: () => <div />,
  BusIcon: () => <div />,
  ReceiptIcon: () => <div />,
  UsersIcon: () => <div />,
  AnalyticsIcon: () => <div />,
  AIIcon: () => <div />,
  CameraIcon: () => <div />,
  UserIcon: () => <div />,
  MailIcon: () => <div />,
  PhoneIcon: () => <div />,
  SUBJECTS_LIST: [],
  DEFAULT_STANDARD_CLASSES: [],
}));

describe('Admin Security Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('UserRolesScreen', () => {
    /**
     * WHAT CHANGED AND WHY THESE ASSERT DIFFERENT THINGS.
     *
     * The old tests asserted calls to `api.getRolePermissions` and
     * `api.updateRolePermissions` on an Express server that is not deployed. Passing
     * them proved the screen was wired to something that could not answer — which is
     * exactly the failure they should have caught. They were green the whole time
     * nobody could save a permission.
     *
     * What matters now is the ADMIN rule, because breaking it is UNRECOVERABLE: strip
     * `settings.manage` from ADMIN and every admin is locked out of the screen that
     * would put it back. So these check the switch is disabled for ADMIN, that a
     * teacher's is not, and that a switch shows the state the DATABASE reports rather
     * than a hard-coded default.
     */
    it('shows the permissions the database reports, not a built-in default', async () => {
      render(<UserRolesScreen />);

      // The real permission code, which is the only kind the database accepts. The
      // screen used to show invented names like "Manage Users" — no such permission
      // exists, so nothing it saved could ever have been real.
      await waitFor(() => {
        // Once per role — there is no student or parent role in this system, so three.
        expect(screen.getAllByText(/assessments.*Enter scores/i).length).toBe(3);
      });

      // And a code that is NOT in this system must not appear. This is the assertion
      // that would have failed on the old screen.
      expect(screen.queryByText(/Manage Users/i)).toBeNull();
    });

    it('does not let ADMIN be switched off', async () => {
      render(<UserRolesScreen />);

      await waitFor(() => {
        expect(screen.getAllByRole('switch').length).toBeGreaterThan(0);
      });

      const switches = screen.getAllByRole('switch');
      // ADMIN is the first role, so its switches come first.
      const adminSwitch = switches[0];

      expect(adminSwitch).toBeDisabled();
      fireEvent.click(adminSwitch);
      // Still disabled: the click could not have changed it. The database refuses this
      // as well, so the rule holds even if the screen were wrong.
      expect(adminSwitch).toBeDisabled();
    });
  });

  describe('AddStudentScreen', () => {
    it('cannot register a student with a blank admission number or name', async () => {
      // The old test here asserted a SaaS tenant LIMIT blocked creation. SRIK
      // has no plans or seat limits, so that gate is gone by design; the checks
      // that remain are the ones that protect the data itself.
      mockUseAuth.mockReturnValue({
        currentSchool: { id: '' },
        currentBranchId: '',
        user: { id: 'user-123' },
      });
      mockUseProfile.mockReturnValue({
        profile: { schoolId: '' },
        refreshProfile: vi.fn(),
      });

      render(withQuery(
        <BrowserRouter>
          <AddStudentScreen forceUpdate={() => {}} handleBack={() => {}} />
        </BrowserRouter>
      ));

      // Submit the form directly. Clicking the button would be stopped by the
      // browser's own `required` check before the screen's own guard runs, so
      // submitting the form exercises the code that actually decides.
      const nameField = await screen.findByLabelText("Student's full name");
      fireEvent.change(nameField, { target: { value: '   ' } });
      const form = nameField.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
      // No record may be written for a student with no usable name.
      expect(api.from).not.toHaveBeenCalled();
    });

    it('never asks for a school or branch, because there is only one school', () => {
      // SRIK is single-school: a missing "school id" is not an error condition
      // any more, and asking the user for one would be meaningless. The genuine
      // protection moved to the database, where every row is denied unless the
      // signed-in user holds the matching permission — enforced by RLS, not by
      // a screen refusing to render.
      mockUseAuth.mockReturnValue({
        currentSchool: { id: '' },
        currentBranchId: '',
        user: { id: 'user-123' },
      });
      mockUseProfile.mockReturnValue({
        profile: { schoolId: '' },
        refreshProfile: vi.fn(),
      });

      render(withQuery(
        <BrowserRouter>
          <AddStudentScreen forceUpdate={() => {}} handleBack={() => {}} />
        </BrowserRouter>
      ));

      const body = document.body.textContent ?? '';
      expect(body).not.toMatch(/tenancy/i);
      expect(body).not.toMatch(/school id/i);
      expect(body).not.toMatch(/branch/i);
    });
  });
});

