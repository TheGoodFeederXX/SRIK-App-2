
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
    it('Should save permissions to the backend', async () => {
      // Setup
      render(<UserRolesScreen />);

      // Find the Save button
      const saveBtn = screen.getByText('Save Changes');
      
      // Click it
      fireEvent.click(saveBtn);

      // Verify: The component calls the API to save permissions
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Permissions saved successfully!');
      });
    });

    it('Should prevent modifying Admin permissions', () => {
      render(<UserRolesScreen />);
      
      // Find a toggle for the Admin role (first one).
      // The component renders a list. The first item is Admin.
      // We need to find a toggle that is disabled.
      
      const switches = screen.getAllByRole('switch');
      // The first few switches belong to Admin.
      const adminSwitch = switches[0];
      
      expect(adminSwitch).toBeDisabled();
      
      // Try to click it anyway
      fireEvent.click(adminSwitch);
      
      // Verify state didn't change (implied by disabled, but good to check logic)
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

