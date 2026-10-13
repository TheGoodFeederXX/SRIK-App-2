/**
 * The guard that actually proves the objective: the app CHANGES LANGUAGE.
 *
 * Every other i18n test here checks keys — that they exist, that they resolve, that
 * ms and en have parity. All of those can pass while the screen is still frozen in one
 * language, which is exactly what happened: nine module-level label maps held Malay
 * text, and roughly thirty JSX labels were written literally instead of through t().
 * A key count cannot see any of that.
 *
 * So this test reads the source and asserts the two failure shapes are absent:
 *
 *   1. No displayed JSX text may hold a Malay word outside t(). A label written
 *      literally is frozen for every reader, in every language.
 *   2. No module-level constant may hold Malay display text. A module constant is
 *      evaluated once at import, before a language is chosen, so it can never switch.
 *
 * It reads files as text (like the rest of this suite) and is deliberately noisy about
 * where a problem is, because the fix is always local.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const COMPONENTS = path.join(ROOT, 'components');

/** Malay function words and everyday nouns. A narrow list is what let "Kelas" through. */
const MALAY =
    /\b(yang|tidak|belum|sudah|dengan|untuk|adalah|dari|dalam|pada|akan|boleh|sila|kepada|oleh|atau|jika|mana|sebab|murid|pelajar|guru|ibu|bapa|sekolah|kelas|markah|yuran|bayaran|penjaga|anak|ini|itu|juga|hanya|masih|telah|selepas|semua|hari|bulan|tahun|nama|jumlah|baki|tarikh|baru|atas|bawah|sini|sana|jangan|mesti|harus|perlu|dapat|mahu|ada|tiada|cetak|terbitkan|sunting|padam|simpan|tutup|buka|hantar|cari|tambah|ubah|lihat|penyata|kad|penggal)\b/i;

/** Strip comments and every t() call, so only text that renders verbatim is left. */
function displayedText(line: string): string {
    let s = line.replace(/\/\/.*$/, '');
    s = s.replace(/\bt\s*\(/g, '\u0000').replace(/\u0000[^\u0000]*?\)/g, '');
    s = s.replace(/\{[^{}]*\}/g, '');
    return s;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name !== '__tests__') walk(p, out);
        } else if (e.name.endsWith('.tsx')) out.push(p);
    }
    return out;
}

describe('bahasa benar-benar bertukar', () => {
    it('tiada teks Melayu dipaparkan secara literal di dalam JSX', () => {
        const offenders: string[] = [];
        for (const file of walk(COMPONENTS)) {
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            let inBlock = false;
            lines.forEach((raw, i) => {
                let line = raw;
                if (inBlock) {
                    const c = line.indexOf('*/');
                    if (c === -1) return;
                    line = line.slice(c + 2);
                    inBlock = false;
                }
                while (line.includes('/*')) {
                    const a = line.indexOf('/*');
                    const b = line.indexOf('*/', a + 2);
                    if (b === -1) {
                        line = line.slice(0, a);
                        inBlock = true;
                        break;
                    }
                    line = line.slice(0, a) + line.slice(b + 2);
                }
                let stripped = displayedText(line);
                // A sentence split across lines leaves a quoted tail after the t() on the
                // same line; drop quoted remnants so only bare JSX text is judged.
                if (/\bt\s*\(/.test(raw)) stripped = stripped.replace(/["'][^"']*["']/g, '');
                for (const m of stripped.matchAll(/>([^<>]{2,200})</g)) {
                    const text = m[1].trim();
                    if (!text || !MALAY.test(text)) continue;
                    if (/^[a-z-]+$/.test(text)) continue;
                    offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${JSON.stringify(text.slice(0, 80))}`);
                }
            });
        }
        expect(offenders, `teks ini tidak akan bertukar bahasa:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('tiada pemalar peringkat modul menyimpan teks Melayu yang dipaparkan', () => {
        const offenders: string[] = [];
        const files = [
            ...fs.readdirSync(path.join(ROOT, 'src/lib/supabase')).map((f) => path.join(ROOT, 'src/lib/supabase', f)),
            ...walk(COMPONENTS),
        ].filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'));

        for (const file of files) {
            const src = fs.readFileSync(file, 'utf8');
            // `export const NAME: Record<...> = { ... }` — a lookup table read at render time.
            for (const m of src.matchAll(/export const \w+(?:LABELS|NAMES|MAP)[^=]*=\s*\{([^}]*)\}/g)) {
                for (const line of m[1].split('\n')) {
                    const v = line.match(/:\s*'([^']{3,})'/);
                    if (v && MALAY.test(v[1])) {
                        offenders.push(`${path.relative(ROOT, file)} ${JSON.stringify(v[1])}`);
                    }
                }
            }
        }
        expect(
            offenders,
            `pemalar modul membekukan bahasa (nilainya dikira sekali semasa import):\n${offenders.join('\n')}`
        ).toEqual([]);
    });

    it('tiada nilai Melayu di dalam fail bahasa Inggeris', () => {
        const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/i18n/locales/en.json'), 'utf8'));
        // Names that are the same in both languages by design.
        const SAME_BY_DESIGN = new Set([
            'Status', 'Forum', 'Audit', 'STEM', 'GeoGuesser', 'Smart Chat', 'Liquid Glass',
            'WhatsApp', 'Indigo', 'Amber', 'Teal', 'British (UK NC)', 'British (Cambridge/IGCSE)',
            'USD ($)', 'GBP (£)', 'PBD', 'UASA', 'British', 'TP',
        ]);
        const offenders: string[] = [];
        const visit = (o: Record<string, unknown>, prefix = '') => {
            for (const [k, v] of Object.entries(o)) {
                if (v && typeof v === 'object') visit(v as Record<string, unknown>, `${prefix}${k}.`);
                else if (typeof v === 'string' && !SAME_BY_DESIGN.has(v) && MALAY.test(v)) {
                    // "Hari Raya" is the name of the holiday, not a translation of one, so an
                    // English example sentence legitimately contains it.
                    if (/Hari Raya/.test(v.replace(/Hari Raya/g, '')) === false && /Hari Raya/.test(v)) continue;
                    offenders.push(`${prefix}${k} = ${JSON.stringify(v.slice(0, 80))}`);
                }
            }
        };
        visit(en);
        expect(offenders, `pembaca bahasa Inggeris akan melihat Melayu:\n${offenders.join('\n')}`).toEqual([]);
    });
    it('tiada teks Melayu antara tag, termasuk ayat berbilang baris', () => {
        // The per-line scan above cannot see a sentence split across lines, nor text sitting
        // inside a multi-line JSX block. This scan joins the whole file first, which is how
        // "Cetak penyata" and "Jumlah tertunggak keluarga" were finally caught.
        const offenders: string[] = [];
        const files = [...walk(COMPONENTS), ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.tsx')).map((f) => path.join(ROOT, f))];
        for (const file of files) {
            let src = fs.readFileSync(file, 'utf8');
            src = src.replace(/\/\*[\s\S]*?\*\//g, '');
            src = src.replace(/^\s*\/\/.*$/gm, '');
            for (const m of src.matchAll(/>([^<>{}]{3,300}?)</g)) {
                const text = m[1].trim();
                // A `t(` inside the captured run means this is a translated expression split
                // over lines, not literal text.
                if (!text || text.includes('t(') || !MALAY.test(text)) continue;
                const line = src.slice(0, m.index).split('\n').length;
                offenders.push(`${path.relative(ROOT, file)}:${line} ${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 80))}`);
            }
        }
        expect(offenders, `teks ini tidak akan bertukar bahasa:\n${offenders.join('\n')}`).toEqual([]);
    });
});
