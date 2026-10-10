/**
 * Classes and subjects — SRIK.
 *
 * The previous class tests asserted the legacy model: classes grouped by
 * "grade"/"section", a "standard class set" generator, and a per-class QR code.
 * All three are gone. These tests assert what the screens do now, and in
 * particular that class NAMES are treated as renameable labels rather than as
 * data the app reads meaning from.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ClassListScreen from '../ClassListScreen';
import ClassFormScreen from '../ClassFormScreen';
import SubjectListScreen from '../SubjectListScreen';


const {
    listClasses, deleteClass, listStudents,
    listSubjects, createSubject, updateSubject, deleteSubject,
    createClass, updateClass, setClassSubjects, listSubjectOptions, getClassSubjects,
} = vi.hoisted(() => ({
    listClasses: vi.fn(), deleteClass: vi.fn(), listStudents: vi.fn(),
    listSubjects: vi.fn(), createSubject: vi.fn(), updateSubject: vi.fn(), deleteSubject: vi.fn(),
    createClass: vi.fn(), updateClass: vi.fn(), setClassSubjects: vi.fn(),
    listSubjectOptions: vi.fn(), getClassSubjects: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/academics', () => ({
    listClasses: (...a: unknown[]) => listClasses(...a),
    deleteClass: (...a: unknown[]) => deleteClass(...a),
    listSubjects: (...a: unknown[]) => listSubjects(...a),
    createSubject: (...a: unknown[]) => createSubject(...a),
    updateSubject: (...a: unknown[]) => updateSubject(...a),
    deleteSubject: (...a: unknown[]) => deleteSubject(...a),
    createClass: (...a: unknown[]) => createClass(...a),
    updateClass: (...a: unknown[]) => updateClass(...a),
    setClassSubjects: (...a: unknown[]) => setClassSubjects(...a),
    listSubjectOptions: (...a: unknown[]) => listSubjectOptions(...a),
    getClassSubjects: (...a: unknown[]) => getClassSubjects(...a),
}));

vi.mock('../../../src/lib/supabase/students', () => ({
    listStudents: (...a: unknown[]) => listStudents(...a),
}));

// The screens read data only once someone is signed in (`enabled: Boolean(user)`).
// The real provider starts signed out, so the query would never run and every
// assertion would see an empty screen. A signed-in admin is what these screens
// are for.
vi.mock('../../../context/AuthContext', () => ({
    // `user` is what gates the queries these screens run.
    useAuth: () => ({ user: { id: 'admin-1', email: 'admin001@srialkhairiah.my' }, role: 'ADMIN', loading: false }),
    AuthProvider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
}));
vi.mock('../../../context/ProfileContext', () => ({
    useProfile: () => ({ profile: { schoolId: '' }, refreshProfile: vi.fn(), loading: false }),
    ProfileProvider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
}));
vi.mock('../../../context/SchoolScopeContext', () => ({
    useSchoolScope: () => ({ currentBranch: null, branches: [], refreshBranches: vi.fn(), isLoading: false, activeBranchGeneratedId: null, isMainAdmin: null }),
    SchoolScopeProvider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
}));

const { toastError, toastSuccess } = vi.hoisted(() => ({
    toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), { error: toastError, success: toastSuccess });
    return { default: fn, toast: fn };
});

/** A fresh cache per render, inside the app's real providers. */
const renderScreen = (ui: React.ReactElement) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
    );

const cls = (over: Record<string, unknown> = {}) => ({
    id: 'c1', yearLevel: 3, name: 'Al-Junaidi', code: '3J',
    displayName: '3 Al-Junaidi', status: 'ACTIVE', academicYearId: 'y1',
    studentCount: 0, ...over,
});

describe('ClassListScreen — SRIK classes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listStudents.mockResolvedValue([]);
    });

    it('groups classes by year level, ordered Year 1 upward', async () => {
        listClasses.mockResolvedValue([
            cls({ id: 'a', yearLevel: 5, name: "Na'im", code: '5N', displayName: "5 Na'im" }),
            cls({ id: 'b', yearLevel: 1, name: 'Al-Junaidi', code: '1J', displayName: '1 Al-Junaidi' }),
        ]);
        renderScreen(<ClassListScreen navigateTo={vi.fn()} />);

        await screen.findByText('1 Al-Junaidi');
        const body = document.body.textContent ?? '';
        expect(body.indexOf('Year 1')).toBeLessThan(body.indexOf('Year 5'));
        // Class names are labels; the year comes from its own column.
        expect(screen.getByText('1 Al-Junaidi')).toBeDefined();
        expect(screen.getByText("5 Na'im")).toBeDefined();
    });

    it('shows two classes under the same year without merging them', async () => {
        // Year 4 genuinely has two classes at SRIK.
        listClasses.mockResolvedValue([
            cls({ id: 'a', yearLevel: 4, name: 'Al-Junaidi', code: '4J', displayName: '4 Al-Junaidi' }),
            cls({ id: 'b', yearLevel: 4, name: 'Al-Busiri', code: '4B', displayName: '4 Al-Busiri' }),
        ]);
        renderScreen(<ClassListScreen navigateTo={vi.fn()} />);

        await screen.findByText('4 Al-Junaidi');
        expect(screen.getByText('4 Al-Busiri')).toBeDefined();
        expect(screen.getAllByText(/Year 4/).length).toBe(1);
    });

    it('shows the year, class name and code as stored', async () => {
        listClasses.mockResolvedValue([cls()]);
        renderScreen(<ClassListScreen navigateTo={vi.fn()} />);
        await screen.findByText('3 Al-Junaidi');
        expect(screen.getByText('3J')).toBeDefined();
        expect(screen.getByText(/Year 3/)).toBeDefined();
    });

    it('offers no QR code, standard class set, or section controls', async () => {
        // SRIK does not scan classroom codes, and does not generate a
        // pre-made class set — the school names its own classes.
        listClasses.mockResolvedValue([cls()]);
        renderScreen(<ClassListScreen navigateTo={vi.fn()} />);
        await screen.findByText('3 Al-Junaidi');

        const body = document.body.textContent ?? '';
        expect(body).not.toMatch(/qr/i);
        expect(body).not.toMatch(/standard classes/i);
        expect(body).not.toMatch(/section/i);
        expect(body).not.toMatch(/grade/i);
        expect(body).not.toMatch(/department/i);
    });

    it('explains why a class with students cannot be removed', async () => {
        listClasses.mockResolvedValue([cls({ studentCount: 3 })]);
        deleteClass.mockResolvedValue({
            success: false,
            error: 'This class still has 3 students. Move them to another class first.',
        });
        window.confirm = vi.fn(() => true);

        renderScreen(<ClassListScreen navigateTo={vi.fn()} />);
        await screen.findByText('3 Al-Junaidi');
        fireEvent.click(screen.getByLabelText('Remove 3 Al-Junaidi'));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(String(toastError.mock.calls[0][0])).toMatch(/move them to another class/i);
    });
});

describe('ClassFormScreen — SRIK fields', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listSubjectOptions.mockResolvedValue([]);
        getClassSubjects.mockResolvedValue([]);
    });

    it('asks for a year level and a class name, and previews the result', async () => {
        renderScreen(<ClassFormScreen handleBack={vi.fn()} />);
        await waitFor(() => expect(listSubjectOptions).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Year level'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Class name'), { target: { value: 'Al-Junaidi' } });
        fireEvent.change(screen.getByLabelText('Short code (optional)'), { target: { value: '3J' } });

        // The preview uses the same rule the database uses for display_name.
        expect(await screen.findByText(/3 Al-Junaidi/)).toBeDefined();
    });

    it('creates a class and then saves its subjects', async () => {
        listSubjectOptions.mockResolvedValue([{ id: 's1', label: 'Bahasa Melayu' }]);
        createClass.mockResolvedValue({ success: true, id: 'new-class' });
        setClassSubjects.mockResolvedValue({ success: true });

        const handleBack = vi.fn();
        renderScreen(<ClassFormScreen handleBack={handleBack} />);
        await screen.findByText('Bahasa Melayu');

        fireEvent.change(screen.getByLabelText('Year level'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Class name'), { target: { value: 'Al-Junaidi' } });
        fireEvent.click(screen.getByText('Bahasa Melayu'));
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(createClass).toHaveBeenCalledTimes(1));
        expect(createClass.mock.calls[0][0]).toMatchObject({ yearLevel: 3, name: 'Al-Junaidi' });
        // Subjects are saved against the class that was just created.
        await waitFor(() => expect(setClassSubjects).toHaveBeenCalledWith('new-class', ['s1']));
        expect(handleBack).toHaveBeenCalled();
    });

    it('refuses a year level outside 1 to 6', async () => {
        renderScreen(<ClassFormScreen handleBack={vi.fn()} />);
        await waitFor(() => expect(listSubjectOptions).toHaveBeenCalled());

        const form = screen.getByLabelText('Class name').closest('form')!;
        fireEvent.change(screen.getByLabelText('Year level'), { target: { value: '9' } });
        fireEvent.change(screen.getByLabelText('Class name'), { target: { value: 'Tidak Sah' } });
        fireEvent.submit(form);

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(createClass).not.toHaveBeenCalled();
    });

    it('keeps the class when only the subjects fail to save', async () => {
        listSubjectOptions.mockResolvedValue([{ id: 's1', label: 'Matematik' }]);
        createClass.mockResolvedValue({ success: true, id: 'new-class' });
        setClassSubjects.mockResolvedValue({ success: false, error: 'offline' });

        const handleBack = vi.fn();
        renderScreen(<ClassFormScreen handleBack={handleBack} />);
        await screen.findByText('Matematik');

        fireEvent.change(screen.getByLabelText('Year level'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Class name'), { target: { value: 'Al-Junaidi' } });
        fireEvent.click(screen.getByText('Matematik'));
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        // The class exists, so the owner is told what is outstanding rather than
        // being led to believe nothing was saved.
        await waitFor(() => expect(setClassSubjects).toHaveBeenCalled());
        expect(handleBack).toHaveBeenCalled();
        expect(createClass).toHaveBeenCalledTimes(1);
    });
});

describe('SubjectListScreen — new screen', () => {
    beforeEach(() => vi.clearAllMocks());

    const subject = (over: Record<string, unknown> = {}) => ({
        id: 's1', code: 'BM', name: 'Bahasa Melayu', shortName: 'BM',
        category: 'Teras', status: 'ACTIVE', classCount: 0, ...over,
    });

    it('lists subjects with how many classes teach them', async () => {
        listSubjects.mockResolvedValue([subject({ classCount: 4 })]);
        renderScreen(<SubjectListScreen />);

        expect(await screen.findByText('Bahasa Melayu')).toBeDefined();
        expect(screen.getByText(/Taught in 4 classes/)).toBeDefined();
        expect(screen.getByText('BM')).toBeDefined();
    });

    it('says when a subject is not taught anywhere yet', async () => {
        listSubjects.mockResolvedValue([subject({ name: 'Jawi dan Khat', code: 'JQ', classCount: 0 })]);
        renderScreen(<SubjectListScreen />);

        await screen.findByText('Jawi dan Khat');
        expect(screen.getByText(/Not taught in any class yet/)).toBeDefined();
    });

    it('adds a subject with a code and a name', async () => {
        listSubjects.mockResolvedValue([]);
        createSubject.mockResolvedValue({ success: true, id: 's2' });
        renderScreen(<SubjectListScreen />);

        await screen.findByText('No Subjects Yet');
        fireEvent.click(screen.getByRole('button', { name: /add first subject/i }));

        fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Pendidikan Islam' } });
        fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'PI' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(createSubject).toHaveBeenCalledTimes(1));
        expect(createSubject.mock.calls[0][0]).toMatchObject({ code: 'PI', name: 'Pendidikan Islam' });
    });

    it('refuses a subject with no code or name', async () => {
        listSubjects.mockResolvedValue([]);
        renderScreen(<SubjectListScreen />);

        await screen.findByText('No Subjects Yet');
        fireEvent.click(screen.getByRole('button', { name: /add first subject/i }));

        const form = screen.getByLabelText('Subject name').closest('form')!;
        fireEvent.submit(form);

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(createSubject).not.toHaveBeenCalled();
    });

    it('reports a duplicate code rather than failing silently', async () => {
        listSubjects.mockResolvedValue([]);
        createSubject.mockResolvedValue({ success: false, error: 'Subject code "BM" is already in use.' });
        renderScreen(<SubjectListScreen />);

        await screen.findByText('No Subjects Yet');
        fireEvent.click(screen.getByRole('button', { name: /add first subject/i }));
        fireEvent.change(screen.getByLabelText('Subject name'), { target: { value: 'Bahasa Melayu' } });
        fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'BM' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(String(toastError.mock.calls[0][0])).toMatch(/already in use/i);
    });

    it('explains why a subject taught in classes cannot be removed', async () => {
        listSubjects.mockResolvedValue([subject({ classCount: 7 })]);
        deleteSubject.mockResolvedValue({
            success: false,
            error: 'This subject is taught in 7 classes. Remove it from those classes first, or mark it inactive instead.',
        });
        window.confirm = vi.fn(() => true);

        renderScreen(<SubjectListScreen />);
        await screen.findByText('Bahasa Melayu');
        fireEvent.click(screen.getByLabelText('Remove Bahasa Melayu'));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(String(toastError.mock.calls[0][0])).toMatch(/taught in 7 classes/i);
    });
});
