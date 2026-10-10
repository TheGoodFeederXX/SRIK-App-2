/**
 * Add-teacher screen — behaviour tests.
 *
 * These assert what the form does, not how it looks: that it reads its pickers
 * from Supabase, that it no longer asks anything about the multi-tenant model
 * it was built for, and that it reports a saved teacher honestly when the login
 * account step fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AddTeacherScreen from '../AddTeacherScreen';

const listSubjectOptions = vi.fn();
const listClassOptions = vi.fn();
const getCurrentAcademicYearId = vi.fn();
const createTeacherWithAccount = vi.fn();
const provisionTeacherAccount = vi.fn();

vi.mock('../../../src/lib/supabase/teachers', () => ({
    listSubjectOptions: (...a: unknown[]) => listSubjectOptions(...a),
    listClassOptions: (...a: unknown[]) => listClassOptions(...a),
    getCurrentAcademicYearId: (...a: unknown[]) => getCurrentAcademicYearId(...a),
    createTeacherWithAccount: (...a: unknown[]) => createTeacherWithAccount(...a),
    provisionTeacherAccount: (...a: unknown[]) => provisionTeacherAccount(...a),
    updateTeacher: vi.fn(),
    getTeacher: vi.fn(),
    setTeacherAssignments: vi.fn(),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
    toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

vi.mock('framer-motion', () => ({
    motion: new Proxy({}, {
        get: () => ({ children, ...rest }: any) => {
            const { initial, animate, transition, whileHover, whileTap, ...safe } = rest;
            return <button {...safe}>{children}</button>;
        },
    }),
}));

vi.mock('../../ui/CredentialsModal', () => ({
    default: ({ username, password }: any) => (
        <div data-testid="credentials">
            <span>{username}</span>
            <span>{password}</span>
        </div>
    ),
}));

const handleBack = vi.fn();
const forceUpdate = vi.fn();

const renderScreen = () =>
    render(<AddTeacherScreen forceUpdate={forceUpdate} handleBack={handleBack} />);

describe('AddTeacherScreen — SRIK fields only', () => {
    beforeEach(() => {
        listSubjectOptions.mockReset().mockResolvedValue([{ id: 's1', label: 'Bahasa Melayu' }]);
        listClassOptions.mockReset().mockResolvedValue([{ id: 'c1', label: '3 Al-Junaidi' }]);
        getCurrentAcademicYearId.mockReset().mockResolvedValue('y1');
        createTeacherWithAccount.mockReset();
        provisionTeacherAccount.mockReset();
        handleBack.mockReset();
        forceUpdate.mockReset();
        toastError.mockReset();
        toastSuccess.mockReset();
    });

    it('offers the school\'s own classes and subjects', async () => {
        renderScreen();
        expect(await screen.findByText('3 Al-Junaidi')).toBeDefined();
        expect(screen.getByText('Bahasa Melayu')).toBeDefined();
    });

    it('asks nothing about branches, curriculum or TRCN', async () => {
        // The point of the rewrite. If any of these reappear, this test fails.
        renderScreen();
        await screen.findByText('3 Al-Junaidi');

        const body = document.body.textContent ?? '';
        expect(body).not.toMatch(/branch/i);
        expect(body).not.toMatch(/nigerian|british/i);
        expect(body).not.toMatch(/trcn/i);
        expect(body).not.toMatch(/subscription|upgrade/i);
    });

    it('saves a teacher and reports success', async () => {
        createTeacherWithAccount.mockResolvedValue({ success: true, teacherId: 't1' });
        renderScreen();
        await screen.findByText('3 Al-Junaidi');

        fireEvent.change(screen.getByPlaceholderText('Staff Code'), { target: { value: 'TCH001' } });
        fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ustazah Aminah' } });
        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'aminah@srik-example.com' } });
        fireEvent.click(screen.getByText('Save Teacher'));

        await waitFor(() => expect(createTeacherWithAccount).toHaveBeenCalled());
        expect(toastSuccess).toHaveBeenCalled();
        expect(handleBack).toHaveBeenCalled();
    });

    it('passes the chosen class and subject ids to the save', async () => {
        createTeacherWithAccount.mockResolvedValue({ success: true, teacherId: 't1' });
        renderScreen();
        await screen.findByText('3 Al-Junaidi');

        fireEvent.change(screen.getByPlaceholderText('Staff Code'), { target: { value: 'TCH001' } });
        fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ustazah Aminah' } });
        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@srik-example.com' } });
        fireEvent.click(screen.getByText('3 Al-Junaidi'));
        fireEvent.click(screen.getByText('Bahasa Melayu'));
        fireEvent.click(screen.getByText('Save Teacher'));

        await waitFor(() => expect(createTeacherWithAccount).toHaveBeenCalled());
        const options = createTeacherWithAccount.mock.calls[0][1];
        expect(options.classIds).toEqual(['c1']);
        expect(options.subjectIds).toEqual(['s1']);
    });

    it('shows the temporary password once when an account is created', async () => {
        createTeacherWithAccount.mockResolvedValue({
            success: true, teacherId: 't1', temporaryPassword: 'Temp1234Pass',
        });
        renderScreen();
        await screen.findByText('3 Al-Junaidi');

        fireEvent.change(screen.getByPlaceholderText('Staff Code'), { target: { value: 'TCH001' } });
        fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ustazah Aminah' } });
        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@srik-example.com' } });
        fireEvent.click(screen.getByText('Save Teacher'));

        const creds = await screen.findByTestId('credentials');
        expect(creds.textContent).toContain('Temp1234Pass');
    });

    it('reports a saved teacher whose account failed, instead of claiming success', async () => {
        createTeacherWithAccount.mockResolvedValue({
            success: true, teacherId: 't1',
            accountWarning: 'Teacher saved, but the login account could not be created: duplicate',
        });
        renderScreen();
        await screen.findByText('3 Al-Junaidi');

        fireEvent.change(screen.getByPlaceholderText('Staff Code'), { target: { value: 'TCH001' } });
        fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ustazah Aminah' } });
        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@srik-example.com' } });
        fireEvent.click(screen.getByText('Save Teacher'));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(String(toastError.mock.calls[0][0])).toMatch(/account/i);
    });

    it('refuses to save without a staff code or name', async () => {
        renderScreen();
        await screen.findByText('3 Al-Junaidi');

        // The fields are marked required in the markup, which is what stops the
        // save first. The JavaScript guard behind it is the second line of
        // defence, so this asserts the required attributes are present rather
        // than driving a submit the browser would block anyway.
        expect((screen.getByPlaceholderText('Staff Code') as HTMLInputElement).required).toBe(true);
        expect((screen.getByPlaceholderText('Full Name') as HTMLInputElement).required).toBe(true);

        const form = document.querySelector('form')!;
        fireEvent.submit(form);

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        expect(createTeacherWithAccount).not.toHaveBeenCalled();
    });
});
