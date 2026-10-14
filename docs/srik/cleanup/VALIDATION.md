# Validation

Rujukan: `SRIK_DEEPSEEK_HARNESS_SAFE_CLEANUP.md`
Baseline: `4fc7f9bffde713f29a8fcb22c3f992ef64746793` (0.8.30)
Dijalankan pada branch `cleanup/safe-removal-c1-c2`

## 1. Ringkasan keputusan

| Fasa | tsc | build | ujian | Pariti BM/BI | Keputusan |
|---|---|---|---|---|---|
| C0 baseline | 0 ralat | exit 0 | 537/537 | 3306/3306 | LULUS |
| C1 | 0 ralat | exit 0 | 537/537 | 3306/3306 | LULUS |
| C2 | 0 ralat | exit 0 | 537/537 | 3295/3295 | LULUS |
| Selepas C3 dinilai | 0 ralat | exit 0 | 537/537 | 3295/3295 | LULUS (C3 tidak dilaksanakan) |

Tiada regresi. Bilangan ujian kekal 537 dan semua fail ujian lulus pada setiap peringkat.

## 2. Perintah sebenar yang dijalankan

| Perintah | Keputusan |
|---|---|
| `git status --short` | bersih pada baseline |
| `git rev-parse HEAD` | `4fc7f9bffde713f29a8fcb22c3f992ef64746793` |
| `node --version` | v24.21.0 (sepadan `.nvmrc` dan `engines`) |
| `npm --version` | 11.19.0 |
| `npx tsc --noEmit` | 0 ralat |
| `npx vitest run` | 537 lulus / 75 fail ujian |
| `npx vite build` | exit 0 |
| `git diff --check` | tiada isu whitespace |
| `npm ls --all` | hanya `UNMET OPTIONAL DEPENDENCY` |

Backend typecheck (`npx tsc --noEmit -p backend/tsconfig.json`) **tidak** dijalankan
sebagai gate penerimaan. Ia masih dirujuk oleh CI (§7.1) dan dirancang untuk dipersarakan
dalam C3, yang kini TERHALANG. Ia tidak dilaporkan sebagai lulus.

## 3. Gate yang LULUS

- Tiada import/export/config aktif merujuk 13 fail yang dipadam (carian kod mengesahkan).
- Tiada `navigateTo` menuju kelima-lima view C2.
- Tiada lazy import menuju kelima-lima fail C2.
- tsc, build dan suite penuh lulus pada setiap fasa.
- Pariti terjemahan BM/BI tepat selepas pembuangan kunci.
- `supabase/`, `AGENTS.md`, `CLAUDE.md` dan `.github/` **tidak disentuh**.
- Commit dipisahkan mengikut fasa, boleh dibalikkan secara berasingan.

## 4. Gate yang BELUM DISAHKAN

Diisytiharkan sebagai `BELUM DISAHKAN`, bukan LULUS:

| Gate | Sebab |
|---|---|
| Semakan UI visual C2 (desktop, mudah alih) | Tiada pelayar dalam persekitaran ini |
| Grid kad dashboard mengalir semula dengan betul | Tidak dapat dilihat secara visual |
| Smoke test login/logout, portal penjaga, kehadiran, kewangan, PWA | Memerlukan pelayar dan akaun ujian |
| Route lama / Back / Forward | Memerlukan pelayar |
| Saiz bundle sebelum/selepas | Baseline tidak diukur; tiada perbandingan dibuat |

## 5. Pemeriksaan khusus: kekangan import tersembunyi

Pelajaran daripada C1 (§4.1 status) — dependency peer boleh hadir hanya secara
kebetulan. Selepas semua pembuangan, pokok dependency disemak:

- `npm ls @testing-library/dom` → ada (ditambah eksplisit)
- `npm ls @sentry/browser @sentry/react` → ada
- Setiap `UNMET` yang tinggal ialah `OPTIONAL DEPENDENCY` sahaja

## 6. Semakan perlindungan

| Perlindungan | Semakan | Keputusan |
|---|---|---|
| `supabase/` | `git diff --stat -- supabase/` | kosong — tidak disentuh |
| Arahan repo | `git diff --stat -- AGENTS.md CLAUDE.md` | kosong — tidak disentuh |
| CI | `git diff --stat -- .github/` | kosong — tidak disentuh |
| UI dikekalkan | Hanya entri 5 modul dibuang; tiada CSS/spacing/typography diubah | disemak secara diff |
| Stub/bypass | Tiada stub, data palsu atau fallback ditambah | disemak secara diff |
| Ujian | Tiada ujian dilangkau, dilonggarkan atau dipadam | 537 kekal lulus |
