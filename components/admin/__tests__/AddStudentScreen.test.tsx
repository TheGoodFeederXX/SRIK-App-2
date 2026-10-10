/**
 * Add-student form — SRIK.
 *
 * The previous tests asserted that the form preserved curriculum subjects and
 * sent `curriculum_type` / `school_bus_id`. Those fields are gone: SRIK has no
 * bus and no curriculum streams, so the form no longer collects them. These
 * tests assert what the form does now — register a student with a guardian and
 * a class, and report a partial failure honestly.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AddStudentScreen from '../AddStudentScreen';

const {
    listClassOptions,
    suggestNextAdmissionNo,
    createStudentWithDetails,
    updateStudent,
    enrollStudent,
    getStudent,
} = vi.hoisted(() => ({
    listClassOptions: vi.fn(),
    suggestNextAdmissionNo: vi.fn(),
    createStudentWithDetails: vi.fn(),
    updateStudent: vi.fn(),
    enrollStudent: vi.fn(),
    getStudent: vi.fn(),
}));

vi.mock('../../../src/lib/supabase/students', () => ({
    listClassOptions: (...a: unknown[]) => listClassOptions(...a),
    suggestNextAdmissionNo: (...a: unknown[]) => suggestNextAdmissionNo(...a),
    createStudentWithDetails: (...a: unknown[]) => createStudentWithDetails(...a),
    updateStudent: (...a: unknown[]) => updateStudent(...a),
    enrollStudent: (...a: unknown[]) => enrollStudent(...a),
    getStudent: (...a: unknown[]) => getStudent(...a),
}));

const { toastError, toastSuccess } = vi.hoisted(() => ({
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));

vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), { error: toastError, success: toastSuccess });
    return { default: fn, toast: fn };
});

// A fresh cache per render: the screen invalidates the student list after a
// save, and a shared cache would let one test's data reach the next.
const renderForm = (props: Record<string, unknown> = {}) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <AddStudentScreen
                handleBack={vi.fn()}
                forceUpdate={vi.fn()}
                {...props}
            />
        </QueryClientProvider>
    );

describe('AddStudentScreen — SRIK fields only', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listClassOptions.mockResolvedValue([{ id: 'c1', label: '3 Al-Junaidi' }]);
        suggestNextAdmissionNo.mockResolvedValue('S-0007');
        createStudentWithDetails.mockResolvedValue({ success: true, studentId: 's1' });
    });

    it('suggests an admission number and offers the real class list', async () => {
        renderForm();

        await waitFor(() =>
            expect((screen.getByLabelText('Admission number') as HTMLInputElement).value).toBe('S-0007')
        );
        expect(screen.getByRole('option', { name: '3 Al-Junaidi' })).toBeDefined();
    });

    it('registers a student with a guardian and a class in one go', async () => {
        const handleBack = vi.fn();
        renderForm({ handleBack });

        await waitFor(() =>
            expect((screen.getByLabelText('Admission number') as HTMLInputElement).value).toBe('S-0007')
        );

        fireEvent.change(screen.getByLabelText("Student's full name"), { target: { value: 'Ahmad Zaki' } });
        fireEvent.change(screen.getByLabelText("Guardian's name"), { target: { value: 'Ali bin Osman' } });
        fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0123456789' } });
        fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'c1' } });

        fireEvent.click(screen.getByRole('button', { name: 'Register student' }));

        await waitFor(() => expect(createStudentWithDetails).toHaveBeenCalledTimes(1));

        const [input, options] = createStudentWithDetails.mock.calls[0];
        expect(input).toMatchObject({ admissionNo: 'S-0007', fullName: 'Ahmad Zaki' });
        expect(options.classId).toBe('c1');
        expect(options.guardian).toMatchObject({
            fullName: 'Ali bin Osman',
            phone: '0123456789',
            isPrimary: true,
        });
        // The form closes only after the student is actually saved.
        expect(handleBack).toHaveBeenCalled();
    });

    it('does not create a guardian when no name and phone were entered', async () => {
        renderForm();
        await waitFor(() => expect(suggestNextAdmissionNo).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText("Student's full name"), { target: { value: 'Tanpa Penjaga' } });
        fireEvent.click(screen.getByRole('button', { name: 'Register student' }));

        await waitFor(() => expect(createStudentWithDetails).toHaveBeenCalledTimes(1));
        expect(createStudentWithDetails.mock.calls[0][1].guardian).toBeNull();
    });

    it('stays on the form and explains when the student cannot be saved', async () => {
        createStudentWithDetails.mockResolvedValue({ success: false, error: 'Admission number "S-0007" is already in use.' });
        const handleBack = vi.fn();
        renderForm({ handleBack });

        await waitFor(() =>
            expect((screen.getByLabelText('Admission number') as HTMLInputElement).value).toBe('S-0007')
        );
        fireEvent.change(screen.getByLabelText("Student's full name"), { target: { value: 'Ahmad Zaki' } });
        fireEvent.click(screen.getByRole('button', { name: 'Register student' }));

        await waitFor(() => expect(toastError).toHaveBeenCalled());
        // A failed save must NOT close the form: the typed details would be lost.
        expect(handleBack).not.toHaveBeenCalled();
    });

    it('says what is missing when a student saves but the class does not', async () => {
        createStudentWithDetails.mockResolvedValue({
            success: true,
            studentId: 's1',
            warning: 'class was not assigned: permission denied',
        });
        renderForm();

        await waitFor(() =>
            expect((screen.getByLabelText('Admission number') as HTMLInputElement).value).toBe('S-0007')
        );
        fireEvent.change(screen.getByLabelText("Student's full name"), { target: { value: 'Ahmad Zaki' } });
        fireEvent.click(screen.getByRole('button', { name: 'Register student' }));

        // The student exists, so the owner is told the record was kept and only
        // the class is outstanding.
        await waitFor(() => expect(toastSuccess).not.toHaveBeenCalled());
        expect(createStudentWithDetails).toHaveBeenCalledTimes(1);
    });

    it('never asks for branch, bus, curriculum or subscription details', async () => {
        renderForm();
        await waitFor(() => expect(suggestNextAdmissionNo).toHaveBeenCalled());

        const body = document.body.textContent ?? '';
        expect(body).not.toMatch(/branch|cawangan/i);
        expect(body).not.toMatch(/\bbus\b|bas sekolah/i);
        expect(body).not.toMatch(/curriculum|nigerian|british/i);
        expect(body).not.toMatch(/subscription|upgrade|paystack/i);
    });
});
