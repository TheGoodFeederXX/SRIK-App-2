/**
 * The end-to-end companion to language-actually-switches.test.ts.
 *
 * That file reads the SOURCE and is cheap and broad. This one renders two real screens with the
 * app set to English and asserts no Malay word appears in what actually rendered. Source reading
 * can miss a string that reaches the DOM through a variable; rendering cannot.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18n from '../../../lib/i18n';
import AnnouncementsScreen from '../../../components/admin/AnnouncementsScreen';
import ReportCardScreen from '../../../components/admin/ReportCardScreen';

vi.mock('../../../src/lib/supabase/announcements', async () => {
    const a = await vi.importActual<Record<string, unknown>>('../../../src/lib/supabase/announcements');
    return { ...a, listAnnouncements: vi.fn().mockResolvedValue([]) };
});
vi.mock('../../../src/lib/supabase/reportCards', async () => {
    const a = await vi.importActual<Record<string, unknown>>('../../../src/lib/supabase/reportCards');
    return {
        ...a,
        listClasses: vi.fn().mockResolvedValue([]),
        listGradeBoundaries: vi.fn().mockResolvedValue([]),
        getSchoolDetails: vi.fn().mockResolvedValue({}),
        listClassStudents: vi.fn().mockResolvedValue([]),
        listTerms: vi.fn().mockResolvedValue([]),
        listReportCards: vi.fn().mockResolvedValue([]),
    };
});
vi.mock('../../../src/lib/supabase/academics', async () => {
    const a = await vi.importActual<Record<string, unknown>>('../../../src/lib/supabase/academics');
    return { ...a, listAcademicYears: vi.fn().mockResolvedValue([]), listTerms: vi.fn().mockResolvedValue([]) };
});
vi.mock('../../../src/lib/supabase/assessments', async () => {
    const a = await vi.importActual<Record<string, unknown>>('../../../src/lib/supabase/assessments');
    return { ...a, listAssessments: vi.fn().mockResolvedValue([]), listAssessmentResults: vi.fn().mockResolvedValue([]) };
});
vi.mock('react-hot-toast', () => {
    const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
    return { default: fn, toast: fn };
});
vi.mock('../../../context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'a1' }, role: 'ADMIN', loading: false }),
}));

const MALAY_WORDS = [
    'Ibu bapa', 'Pelajar', 'Guru', 'Kelas', 'Markah', 'Yuran', 'Bayaran', 'Penjaga',
    'Sekolah', 'Penggal', 'Cetak', 'Sunting', 'Padam', 'Simpan', 'Batal', 'Tutup',
    'Kembali', 'Hantar', 'Cari', 'Tambah', 'Lihat', 'Jumlah', 'Baki', 'Tarikh',
    'Tidak', 'Belum', 'Sudah', 'Semua', 'Tiada', 'Draf', 'Terbitkan',
];

const wrap = (el: React.ReactElement) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
            <MemoryRouter>{el}</MemoryRouter>
        </QueryClientProvider>
    );

describe('paparan bahasa Inggeris bebas Melayu', () => {
    it('AnnouncementsScreen', async () => {
        await i18n.changeLanguage('en');
        const v = wrap(<AnnouncementsScreen />);
        await new Promise((r) => setTimeout(r, 150));
        const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
        v.unmount();
        const leaked = MALAY_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
        expect(leaked, `Melayu bocor: ${leaked.join(', ')}`).toEqual([]);
    });

    it('ReportCardScreen', async () => {
        await i18n.changeLanguage('en');
        const v = wrap(<ReportCardScreen />);
        await new Promise((r) => setTimeout(r, 200));
        const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
        v.unmount();
        const leaked = MALAY_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
        expect(leaked, `Melayu bocor: ${leaked.join(', ')}`).toEqual([]);
    });
});
