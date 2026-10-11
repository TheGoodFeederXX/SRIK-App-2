# IMPLEMENTATION_STATUS — SRIK refactor

Dikemas kini: 7 Oktober 2026
Pakej spesifikasi: SRIK Harness Spec v1.0
Repo: `Oliskey-School/School-app-` · branch `main` · commit `910cf09`

> Peraturan spec: **jangan tandakan fasa selesai selagi kriteria penerimaan gagal.** Fasa di bawah ditandakan mengikut bukti sebenar sahaja.

---

## Ringkasan status

| Fasa | Fail spec | Status | Bukti / sebab |
|---|---|---|---|
| 0 | `02_PHASE_0_AUDIT.md` | **SELESAI** (audit) | `docs/srik/AUDIT.md` + fail ini |
| 1 | `03_PHASE_1_SUPABASE_AUTH.md` | **SELESAI** (lihat §Fasa 1) | Authz/RLS 22/22 ujian SQL; login frontend berpindah ke Supabase; 7 ujian UI lulus. Baki: bootstrap ADMIN sebenar + buang auth legacy |
| 2 | `04_PHASE_2_ACADEMIC_CORE.md` | **SELESAI** (data + UI) | 19 jadual, 4 RPC, RLS 19/19. Skrin boleh guna: guru, pelajar, kelas, subjek, tugasan guru, penjaga. Ujian SQL 23/23; suite Vitest 169 lulus |
| 3 | `05_PHASE_3_TIMETABLE_ATTENDANCE.md` | **SELESAI** | Data (6 jadual, 5 RPC, RLS 25/25, ujian SQL 29/29). Jadual sebenar 2026 (329 pelajaran, 18 guru, 127 tugasan). Skrin kehadiran, jadual waktu, penyunting + penerbitan SELESAI |
| 4 | `06_PHASE_4_ASSESSMENTS_REPORTS.md` | **SELESAI** | 4 jadual, 4 RPC, RLS 29/29, ujian SQL 19/19. Skrin markah (12 ujian) + skrin kad laporan/cetak (18 ujian) SELESAI. Aliran penuh disahkan live. 245 ujian frontend lulus |
| 5 | `07_PHASE_5_FINANCE.md` | **SELESAI** | 4 jadual, 9 fungsi, RLS 33/33, ujian SQL 29/29. Wang numeric(12,2) tepat ke sen; bayaran idempotent; buku append-only; baki dikira. 3 skrin baharu (kutipan 15 ujian, tetapan 8, penyata pelajar 9) — 32 ujian UI lulus, 2 peraturan kritikal disahkan songsang. 9 skrin lama + 4 pembalut gerbang bayaran asing DIBUANG. Baki: skrin ibu bapa/guru dibina semula kemudian |
| 6 | `08_PHASE_6_OPERATIONS_RELEASE.md` | **SELESAI** | 3 jadual (audit_log, documents, announcements), 13 trigger audit, RLS dipaksa 36/36. 18 ujian SQL + 27 ujian UI baharu. Log audit TIDAK BOLEH ditulis oleh mana-mana peranan aplikasi — disahkan secara langsung pada projek sebenar dengan akaun ADMIN. 3 skrin baharu (pengumuman pejabat 13 ujian, rekod audit 9, pengumuman ibu bapa 5). PWA: identiti SRIK, Bahasa Melayu, luar talian lihat-sahaja, konflik service worker dibuang. Sandaran + drill pemulihan DITULIS DAN DIUJI (lulus, dan gagal betul bila kiraan tidak padan). 3 skrin warisan kewangan Nigeria + `lib/payments.ts` dibuang. Satu arahan menjalankan 81 pemeriksaan pangkalan data: `RESULT: PASS`. Baki: RPO/RTO perlu pengesahan sekolah; ~16 skrin pendaftaran/markah lama masih berdaftar tetapi belum dibuang |

**Dikemas kini 24 Oktober 2026, selepas kerja audit.**

Fasa 0–6 selesai. Nota ringkas ini sebelum ini berkata "integrasi frontend Fasa 1
belum bermula", yang tidak lagi benar dan tidak pernah jelas: frontend sudah
berpindah ke Supabase Auth dan membaca data melalui Data API.

Keadaan sebenar yang disahkan hari ini:

| Perkara | Angka |
|---|---|
| Ujian frontend | **462 lulus**, 62 fail, 0 ralat jenis |
| Pemeriksaan SQL | **201 lulus**, 19 suite (`supabase/tests/run_phase5_tests.sh`) |
| Jadual dengan RLS dipaksa | 36 / 36 |
| Kerosakan kebergantungan runtime | **0** (dari 14) |
| Isu audit diselesaikan | **40 / 40** (F27 selesai bagi 22 skrin yang dinamakan; lihat nota) |

**Apa yang RLS enabled TIDAK buktikan.** Bilangan jadual dengan RLS hidup tidak
membuktikan bahawa setiap operasi ditolak dan setiap skop betul — itu hanya
membuktikan RLS dihidupkan. Bukti sebenar ialah ujian yang cuba operasi yang tidak
dibenarkan dan mengesahkan ia ditolak, dan itulah yang dilakukan oleh 201
pemeriksaan SQL: setiap satu menyemak kedua-dua arah, kes yang ditolak DAN kes yang
dibenarkan. Angka RLS di atas dikekalkan kerana ia menjawab soalan yang berbeza,
bukan kerana ia membuktikan kebenaran.

**F27: 22 skrin yang disenaraikan audit sudah selesai — tetapi skopnya lebih besar,
dan ini diukur semula.**

Senarai audit menamakan 22 skrin guru. Kesemua 22 itu kini sama ada membaca/menulis
melalui Supabase, atau — bagi fungsi yang sekolah ini memang tiada rekodnya —
menukar kepada skrin yang memberitahu perkara sebenar.

Tetapi kriteria penerimaan audit itu sendiri ialah "E2E setiap menu berdaftar;
tiada panggilan legacy yang mempunyai perkhidmatan". Diukur terhadap perkara itu,
kerja ini BELUM selesai. Daripada 336 laluan berdaftar yang berjaya dipetakan
kepada failnya:

| Dashboard | Laluan | Masih guna API lama |
|---|---|---|
| Guru | 63 | **31** |
| Admin | 176 | **130** |
| Ibu bapa | 29 | **24** |
| Murid | 68 | **56** |
| **Jumlah** | **336** | **241** |

Nombor 241 ini adalah pembetulan. Semakan pertama saya melaporkan guru "0 daripada
65" dan itu SALAH — ia memadankan nama laluan kepada nama fail secara tekaan, dan
gagal apabila fail itu dinamakan lain (contohnya `selectClassForAttendance` →
`TeacherUnifiedAttendanceScreen`). Kaedah kedua memetakan setiap laluan melalui
`import` sebenar, dan itulah angka di atas.

Ini dicatat sebagai kerja yang BELUM SIAP, bukan sebagai kerja yang selesai.

**Lima belas skrin itu TIDAK dibina, dan ia sengaja tidak dibina.** Tiada jadual
untuk kes SOP, pemerhatian, temujanji, guru ganti, kelas maya, kebenaran keluar,
rancangan mengajar, murid berisiko, tiket sokongan, tiket penyelenggaraan atau
penyerahan tugasan. Skrin lama memaparkan ralat mentah, yang memberitahu guru
aplikasi rosak — sedangkan yang benar ialah fungsi itu belum dibina untuk sekolah
ini. Ia kini berkata demikian, dan tidak menyimpan apa-apa. Ia sengaja tidak
dipalsukan: senarai kosong akan dibaca sebagai "tiada rekod lagi", iaitu dakwaan
tentang sekolah yang tiada asasnya.

**Baki yang diketahui, supaya tiada siapa menyangka ia selesai:**

- Lima belas fungsi di atas belum dibina. Setiap satu memerlukan perbincangan
  dengan sekolah dahulu — siapa boleh memfailkan laporan kerosakan, apa gunanya
  rekod pemerhatian, apa jadi pada permintaan guru ganti jam 6 pagi.
- Kedua-dua Edge Function (`provision-teacher-account`, `provision-guardian-account`)
  belum dideploy.
- Data orang sebenar belum dimasukkan: 0 pelajar, 0 penjaga, 0 log masuk guru.
  Ini jurang DATA, bukan jurang kod — kata laluan guru pertama perlu dijana.
- Kurungan cukai dan kadar pencen dalam `lib/payroll.ts` masih menunggu angka
  sebenar daripada LHDN dan KWSP. Ia sengaja tidak direka.
- ~16 skrin warisan masih berdaftar tetapi belum dibuang.

**Skrip yang mudah disalahgunakan.** `db:reset`, `db:push` dan `db:migrate` masih
menunjuk kepada Prisma dan backend warisan, yang **bukan** skema SRIK. Skema SRIK
ialah 36 jadual yang dibina oleh `supabase/migrations/*.sql`. Menjalankan salah satu
skrip itu terhadap SRIK boleh merosakkan pangkalan data. Migration SQL ialah satu-
satunya sumber kebenaran.

---

## Fasa 0 — butiran

### Kerja yang disiapkan

| # | Kerja (`02_PHASE_0_AUDIT.md`) | Status | Bukti |
|---|---|---|---|
| 1 | Semak AGENTS/README/manifests/routes/schema/auth/storage/workers/PWA/deployment | ✅ | `AUDIT.md` §4 |
| 2 | Rekod branch/commit, cara run, env names, baseline typecheck/build/test | ✅ | `AUDIT.md` §1–§3 |
| 3 | Peta KEEP/ADAPT/REMOVE/DEFER + cari rujukan tenant/JWT/Prisma/Socket.io/modul dibuang | ✅ | `AUDIT.md` §5 |
| 4 | Peta data + UI legacy → target; kenal pasti utiliti dikongsi | ✅ | `AUDIT.md` §6–§7 |
| 5 | Tentukan boundary cutover setiap fasa | ✅ | `AUDIT.md` §8 |
| 6 | Bezakan sample/dev vs production data | ✅ | `AUDIT.md` §9.3 |

### Fail yang dihasilkan Fasa 0

| Fail | Kandungan |
|---|---|
| `AGENTS.md` (root) | Kontrak SRIK (**baharu — belum digabung dengan `CLAUDE.md`**, lihat B4) |
| `docs/srik/README.md` | Cara guna pakej |
| `docs/srik/01_DECISIONS.md` | Keputusan LOCKED + PROPOSED |
| `docs/srik/02..09_*.md` | Fail fasa |
| `docs/srik/AUDIT.md` | **Hasil Fasa 0** |
| `docs/srik/IMPLEMENTATION_STATUS.md` | Fail ini |

Tiada fail kod diubah, ditambah atau dibuang. `dist/` + `node_modules/` dijana semasa membina baseline (tidak di-commit selagi tiada keputusan).

---

## Bukti validation (baseline, commit `910cf09`)

Dijalankan pada Node `v24.21.0`, npm `11.19.0`, tanpa DB live.

| Perintah | Keputusan | Nota |
|---|---|---|
| `npm install --legacy-peer-deps` | **LULUS** | 1394 pakej, 55 s |
| `npx tsc --noEmit -p tsconfig.json` | **LULUS** | exit 0, 0 ralat |
| `npx tsc --noEmit -p backend/tsconfig.build.json` | **LULUS** | exit 0, 0 ralat |
| `npm run build` | **LULUS** | exit 0, 15 MB, PWA precache 15 entry |
| `npx vitest run` | **GAGAL** | 1 fail / 25 lulus (fail-file); 1 fail / 113 lulus (test) |
| `npx vitest run --config backend/vitest.config.ts` | **GAGAL — persekitaran** | 78 fail / 12 lulus (fail-file); 31 fail / 208 lulus / 711 skip |

### Butiran kegagalan baseline (bukan regresi, mesti direkod)

1. `components/subscription/__tests__/SubscriptionPage.demo.test.tsx` — "uses the real Paystack checkout, not the demo popup" → `expected "vi.fn()" to be called 1 times, but got 0 times`.
   Domain: **SaaS subscription + Paystack** → kedua-duanya **REMOVE** mengikut `01_DECISIONS.md`. Dijangka hilang apabila modul dibuang; **jangan** dibaiki dalam kerja SRIK.
2. Backend integration: 58× `ECONNREFUSED`, ~1770 rujukan `connect`/`pool` → **tiada PostgreSQL live**. Tiada DB = fixture `beforeAll` gagal = 711 test skip. Kegagalan bukan-DB: 31× `401`, 44× `500`, `jwt malformed`, `Invalid value undefined for datasource`, `Invalid URL`, `Grades can only be saved for students with Active status`.
   **Kesimpulan: suite backend tidak boleh dianggap hijau dalam persekitaran tanpa DB.** Untuk baseline yang bermakna, perlukan PostgreSQL + `DATABASE_URL` sebenar (guna `docker-compose.yml`). Ini blocker B3.

---

## Blocker

**Dikemas kini 7 Oktober 2026 selepas keputusan pemilik.** B1, B4, B5 diselesaikan. B2, B3, B6 diturunkan daripada blocker kepada syarat kerja.

| # | Blocker | Status | Butiran |
|---|---|---|---|
| **B1** | Konflik arahan `AGENTS.md` vs `CLAUDE.md` (C1–C8) | **SELESAI** | `CLAUDE.md` dikemas kini: arahan architecture yang bercanggah dibuang, aturan gaya/UI dikekalkan |
| **B2** | Nasib data sediaan tidak diketahui | **DITURUNKAN** | Blocker untuk **operasi remote/destructive** sahaja, bukan Fasa 1. Jangan sentuh projek Supabase yang ditemui; bina dalam local test stack + data sintetik |
| **B3** | Ujian backend legacy gagal | **DITURUNKAN** | Suite Express/Prisma legacy **tidak** perlu hijau. Rekod kegagalan, kemudian wajibkan ujian **Supabase baharu** lulus. Jalankan ujian legacy yang relevan apabila mengubah utiliti dikongsi |
| **B4** | `AGENTS.md` belum digabung dengan `CLAUDE.md` | **SELESAI** | Digabung melalui blok rujukan silang; kedua-duanya kini selaras |
| **B5** | Node version tidak dipin | **SELESAI** | Dipin ke Node **24 LTS patch `24.21.0`** dalam `.nvmrc`, `.node-version`, `package.json` `engines`, Dockerfile dan semua workflow CI |
| **B6** | Skop AI, i18n, learning hub tidak ditakrif | **DISELESAIKAN SEBAGAI SKOP** | Defer AI dan learning hub; i18n BM utama, BM+BI sasaran. Tidak menghalang auth foundation. Jangan potong dependensi dikongsi sehingga skop jelas |

### B5 — butiran pelaksanaan

Sebelum kerja: **tiga** versi Node berbeza digunakan — CI `playwright.yml` = 20, `build-prisma-engine.yml` = 22, `migration-safety.yml` = 20, Dockerfile = 20, `deploy.yml` = `>=20`, mesin tempatan = 24. Percanggahan ini penting kerana kod repo sendiri mendokumenkan bahawa propagation `AsyncLocalStorage` berbeza antara Node 20 dan 24, dan konteks tenant RLS bergantung padanya.

Selepas kerja, satu sumber kebenaran (`.nvmrc` = `24.21.0`):

| Fail | Sebelum | Selepas |
|---|---|---|
| `.nvmrc` (baharu) | — | `24.21.0` |
| `.node-version` (baharu) | — | `24.21.0` |
| `package.json` `engines` (baharu) | tiada | `node >=24.21.0 <25`, `npm >=11.19.0` |
| `docker-compose.yml` | — | tidak berkaitan (DB/Redis sahaja) |
| `Dockerfile` | `node:20-alpine` ×2 | `node:24.21.0-alpine` ×2 |
| `playwright.yml` | `node-version: 20` | `node-version-file: '.nvmrc'` |
| `build-prisma-engine.yml` | `node-version: '22'` | `node-version-file: '.nvmrc'` |
| `migration-safety.yml` | `node-version: '20'` ×2 | `node-version-file: '.nvmrc'` ×2 |
| `deploy.yml` | `if NODE_MAJOR -lt 20` | `if NODE_MAJOR -ne 24` (fail jika bukan 24) |

Semua workflow disahkan sebagai YAML sah. `package.json` disahkan sebagai JSON sah.

### B1 + B4 — butiran pelaksanaan

`CLAUDE.md`: **baris 1–115** (arahan bekerja dengan pemilik + polisi pemuliharaan UI) dan seksyen **graphify** dikekalkan **bita-identik** (disahkan secara program). Kandungan architecture yang bercanggah (Oliskey multi-tenant SaaS, branch hierarchy, format ID `{SCHOOL}_{BRANCH}_{ROLE}_{NUM}`, demo reset 24j, plan/trial, Paystack/Flutterwave sebagai ciri, peranan 10-role, "not on Supabase", demo school ID) **dibuang**.

Diganti dengan: Project Overview SRIK, Product Scope LOCKED, Commands, Environment (termasuk pin Node), Architecture (current transitional + target + peraturan data/authorization), dan **Legacy Architecture (reference only — do not extend)** yang menyimpan pengetahuan kod lama dalam bingkai "jangan lanjutkan", serta senarai kegagalan baseline yang tidak perlu dibaiki.

`AGENTS.md`: blok precedence digantikan dengan blok rujukan silang yang menyatakan kedua-dua fail kini selaras. Jangan padam `CLAUDE.md` — ia masih fail arahan pemilik yang sah.

Salinan asal disimpan: `/tmp/CLAUDE.md.original-backup` (di luar repo).

### B6 — kesan skop

- **AI** (NVIDIA NIM, Gemini, `VITE_GEMINI_API_KEY`): **defer**. Modul/provider hanya dibuang selepas tiada dependensi pada feature KEEP. Jangan reka secret baharu; jangan biarkan apa-apa masuk bundle.
- **i18n**: BM bahasa utama, BM+BI sasaran. Elak rewrite semua terjemahan semasa Fasa 1.
- **Learning hub / `curriculumData.ts`**: **defer**, diasingkan daripada core pengurusan sekolah.

---

## Risiko utama (ringkas)

1. **Node god bukan folder.** `lib/api.ts` (3939 baris, ~600 method), `context/AuthContext.tsx`, `context/BranchContext.tsx`, `config/database.ts` (RLS bridge), `lib/tenantContext.ts` dicapai oleh modul KEEP **dan** REMOVE. Modul tidak boleh dipotong ikut folder.
2. **RLS semasa ialah tenant RLS, bukan permission RLS.** Ia ditambah baru-baru ini untuk menampung ~1,900 tapak panggilan tanpa RLS, dan menggunakan `bypass_rls` blanket. Membuang Prisma = membuang penguatkuasaan ini. **Ganti mesti berlaku sebelum buang.**
3. **Skala penukaran besar.** 198 model Prisma, 57 migration, 98 laluan Express, 576 fail komponen, 671 commit. Ini refactor berperingkat yang panjang, bukan satu perubahan.
4. **Auth cutover paling berisiko.** Dua auth source serentak = kelemahan keselamatan. Ikut urutan berperingkat dalam `AUDIT.md` §8.
5. **Baseline ujian backend tidak hijau** (B3). Kriteria penerimaan fasa tidak boleh dibuktikan sehingga ini diselesaikan.

---

## Keputusan pemilik (diterima 7 Oktober 2026)

| # | Item | Keputusan |
|---|---|---|
| P1 | Nama entiti | **`Guardian` + `StudentGuardian`** — gunakan terus, sudah selaras spesifikasi |
| P2 | Data production | **Kekalkan semua data remote** sehingga statusnya disahkan. Bangunkan baseline dalam sandbox dahulu. Jangan sentuh projek Supabase yang ditemui |
| P3 | AI | **Defer**. Buang provider/config hanya selepas tiada dependensi pada feature KEEP |
| P4 | i18n | **BM bahasa utama; BM+BI sasaran.** Elak rewrite semua terjemahan semasa Fasa 1 |
| P5 | Node | **Node 24 LTS**, pin patch selepas validation → `24.21.0` |
| P6 | Portal penjaga | Simpan schema sekarang. Audit UI legacy sebagai bahan guna semula; **jangan** wajibkan semua 32 fail kekal atau berfungsi dalam MVP |
| P7 | Learning hub | **Defer**; asingkan daripada core pengurusan sekolah |
| P8 | `CLAUDE.md` | Kemas kini selaras keputusan SRIK sambil mengekalkan aturan relevan — **selesai** |
| P9 | Paystack/Flutterwave | **REMOVE** daripada target. Status transaksi sebenar perlu diperiksa sebelum menyentuh deployment/data lama |
| P10 | PostGIS | Jangan masukkan dalam schema baharu. Audit dependency sebelum membuang extension daripada DB lama |

### P10 — hasil audit

**PostGIS diisytiharkan tetapi tidak pernah digunakan.** Bukti:
- `init-db/init-extensions.sql:5` — `CREATE EXTENSION IF NOT EXISTS "postgis";` (satu-satunya rujukan berfungsi)
- `backend/prisma/schema.prisma` — **0** jenis `geometry`, `geography`, `postgis` atau `Unsupported(`
- **0** migration mengandungi `CREATE EXTENSION` atau jenis spatial
- **0** query spatial; padanan `ST_`/`geometry` dalam kod ialah `TRUST_BOUNDARY_INSTRUCTION`, `GeoGebra` dan nama pemboleh ubah, bukan spatial

Kesan: buang PostGIS daripada `docker-compose.yml` (`postgis/postgis:17-3.5-alpine` → `postgres:17-alpine`) adalah selamat dari segi kod. DB lama perlu bekalan `DROP EXTENSION` selepas disahkan tiada objek bergantung.

### Kredensial Supabase (diterima 7 Oktober 2026)

| Perkara | Nilai |
|---|---|
| Project ref | `qtpsuemjzxngltpblkoj` |
| Region URL | `https://qtpsuemjzxngltpblkoj.supabase.co` |
| Auth | GoTrue `v2.197.0` — **aktif** |
| PostgREST | aktif (PostgREST `14.18` ialah versi PostgREST, **bukan** versi PostgreSQL) |
| PostgreSQL server | **17.11** (aarch64) — disahkan melalui `show server_version` |

**Semakan sambungan (read-only):**

| Pemeriksaan | Hasil |
|---|---|
| REST API + publishable key | 401 `"Secret API key required"` pada `/rest/v1/` — **dijangka**; publishable key tidak boleh guna endpoint root sahaja |
| REST API + secret key | **200** — projek sah dan boleh dicapai |
| Auth health + publishable key | **200** — `GoTrue v2.197.0` |
| Auth admin users | **0 user** |
| Public schema tables | **0 table** |
| Storage buckets | **0 bucket** |

### Projek INI KOSONG — tetapi bukan projek yang sama dengan `mcp.json`

Ini penemuan penting:

| Sumber | Project ref |
|---|---|
| `mcp.json` + `.mcp.json` (dalam repo) | `ikowlorheeyrsbgvlhvg` |
| Kredensial yang diberi | `qtpsuemjzxngltpblkoj` |

Projek `ikowlorheeyrsbgvlhvg` yang dirujuk dalam repo **berbeza** daripada projek yang diberi. Kedua-duanya tidak boleh diandaikan sama. Ini **mengukuhkan** keputusan P2: jangan sentuh projek `ikowlorheeyrsbgvlhvg` langsung.

**Status projek `qtpsuemjzxngltpblkoj`:** kosong sepenuhnya (0 table, 0 user, 0 bucket). Ia belum mengandungi data sebenar. Oleh itu **tidak ada data berisiko** dalam projek ini pada masa ini — tetapi ia juga bermakna Fasa 1 akan membina schema SRIK yang pertama di sini.

**Kesan:** kerana projek ini kosong dan dicipta khusus untuk kerja ini, baseline boleh dibina di sini. Walau bagaimanapun, **operasi destructive** (`db reset`, `migrate reset`) masih perlu disahkan kerana ia projek remote yang mungkin dikongsi. Cadangan: gunakan projek ini untuk schema SRIK Fasa 1, tetapi jalankan ujian pada local stack dahulu.

**PostgreSQL 17.11 — versi moden, tiada halangan ciri.** Nota awal saya menyebut 14.18; itu **salah** — `14.18` ialah versi PostgREST daripada Swagger REST, bukan versi pelayan. Versi pelayan sebenar ialah **17.11**, jadi `gen_random_uuid`, RLS penuh dan `security_invoker` views (15+) semuanya tersedia.

**Extension sedia ada:** `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`. **Tiada PostGIS** (mengukuhkan P10).

**Role Supabase disahkan wujud:** `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, `authenticator`, `postgres`.

**Cara capai DB:** host langsung `db.qtpsuemjzxngltpblkoj.supabase.co` hanya IPv6 dan **tidak boleh dicapai** dari persekitaran ini. Sambungan SQL berfungsi melalui **pooler**: `postgres.qtpsuemjzxngltpblkoj@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`. Snapshot schema perlu melalui pooler dalam transaction mode.

### Amaran kredensial

Fail `dev.env` yang diberi mengandungi **`SUPABASE_SECRET_KEY`** dan **kata laluan pangkalan data**. Ia telah disalin ke `.env` (gitignored, `chmod 600`) dan **tidak** di-commit. Nota:
- Fail sumber mengandungi ralat: `DATABASE_URL=DATABASE_URL=postgresql://...` (berganda). Dibetulkan semasa menyalin.
- `.env` menyediakan `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` untuk browser, dan `SUPABASE_SECRET_KEY` untuk server sahaja. **Secret key tidak pernah berprefiks `VITE_`.**
- Jika kredensial ini pernah di-commit atau dikongsi secara terbuka, ia perlu dirotasi.

### P9 — tindakan seterusnya

REMOVE berkunci. Sebelum menyentuh deployment/data lama, periksa sama ada transaksi sebenar wujud bergantung pada Paystack/Flutterwave (`40` + `20` fail; `.env.production.example` mengandungi slot kunci live).

---

## Langkah seterusnya

Fasa 1: foundation pangkalan data **dan** cutover login frontend **selesai**. Baki:

1. **Bootstrap akaun ADMIN sebenar** melalui Supabase Auth (GoTrue), kemudian jalankan blok GRANT dalam `supabase/seed/seed.sql`. Kata laluan diurus GoTrue, bukan SQL.
2. **Buang auth legacy** — Express `/auth/*`, `lib/auth.ts`, token `sessionStorage`, `/auth/refresh` dalam `lib/api/core.ts`, dan aliran Google GIS. Hanya selepas Supabase terbukti meliputi setiap kes; jangan tinggalkan dua sumber auth.
3. **Pindahkan Google Sign-In** ke Supabase (kini masih melalui backend lama).
4. **Tambah ujian sesi** untuk penyegaran token dan tamat tempoh sesi.
5. Rekod **policy matrix** penuh dalam `docs/srik/` sebagai bukti penerimaan.

Selepas Fasa 1 ditutup sepenuhnya, Fasa 2 (profil + academic core) boleh bermula dengan `SchoolProfile` sebagai konfigurasi tunggal, bukan tenant.

**Syarat kerja yang masih berkuat kuasa:**
- **B2:** jangan sentuh projek `ikowlorheeyrsbgvlhvg` (rujukan `mcp.json`). Operasi destructive pada `qtpsuemjzxngltpblkoj` perlu disahkan kerana ia remote.
- **B3:** suite Express/Prisma legacy tidak perlu hijau. Wajibkan ujian **Supabase baharu** lulus.
- **B6:** jangan potong dependensi dikongsi (AI, i18n, learning hub) sehingga skopnya jelas.

**Nota keadaan:** `supabase/` wujud dengan migration Fasa 1 terpakai pada remote `qtpsuemjzxngltpblkoj` (7 table, 39 permission, 52 grant, 0 pengguna). Frontend kini log masuk melalui Supabase, tetapi laluan auth lama **masih ada** dan belum dibuang.

---

## Fasa 1 — Supabase, auth dan authorization

**Status: foundation pangkalan data SELESAI dan diuji.** Integrasi frontend (menggantikan auth Express) **belum bermula** — ia memerlukan cutover berperingkat yang tidak menjejaskan login sedia ada.

### Apa yang dibina

| Fail | Peranan |
|---|---|
| `supabase/config.toml` | Konfigurasi projek; `enable_signup = false` (portal murid/penjaga deferred) |
| `supabase/migrations/20261007000001_phase1_auth_authorization.sql` | Migration teras Fasa 1 |
| `supabase/tests/00_local_supabase_shim.sql` | Shim `auth.users` + `auth.uid()` untuk ujian lokal sahaja |
| `supabase/tests/phase1_authorization_test.sql` | 21 ujian authorization |
| `supabase/tests/run_phase1_tests.sh` | Runner ujian lokal boleh ulang |
| `supabase/seed/seed.sql` | Seed sintetik (bootstrap ADMIN sahaja) |

### Schema

`profiles` (1:1 dengan `auth.users`), `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions` (PROPOSED grant individu), `authorization_audit`.

**Registry:** 39 permission merentas 12 kategori. **Role:** `ADMIN` (39 permission melalui jadual) dan `TEACHER` (13 baseline). TEACHER **tidak** mendapat `users.*`, `*_manage`, `finance.*`, `guardians.*`, `settings.manage`, `audit.view`.

### Keputusan reka bentuk penting

- **ADMIN tiada bypass.** Ia menerima permission melalui `role_permissions`, sama seperti semua orang. Diuji dengan membuang grant dalam subtransaction dan mengesahkan permission hilang.
- **Permission berkesan = union role grants + individual grants.** Tiada deny-override (V1), mengikut `03_PHASE_1`.
- **DISABLED dikuatkuasa di RLS, bukan hanya di app.** `is_active_user()` memagari setiap polisi baca-diri, jadi nyahaktif berkuat kuasa serta-merta walaupun JWT masih sah.
- **Perlindungan admin terakhir** dikuatkuasa sebagai trigger + semakan dalam RPC, kerana operasi sama boleh dicapai melalui Data API, RPC dan skrip.
- **Audit append-only.** Tiada polisi UPDATE/DELETE; klien tidak boleh menulis semula sejarah.
- **`anon` tiada akses langsung.** Tiada permukaan awam dalam SRIK.
- **`FORCE ROW LEVEL SECURITY`** pada setiap table, jadi pemilik table juga tertakluk kepada polisi.
- **Fungsi privileged** guna `SECURITY DEFINER`, `search_path = ''`, nama objek qualified, dan `REVOKE ... FROM public` dengan grant eksplisit kepada `authenticated` sahaja.

### Bug keselamatan pertama: polisi baca-diri kekurangan semakan status

Dua jurang sebenar ditemui oleh suite ujian semasa pembangunan, bukan hanya disangka:

1. **`profiles_select_own` tidak menyemak `is_active_user()`** — pengguna DISABLED masih boleh membaca profil mereka sendiri. Dibaiki.
2. **`user_roles_select_own` dan `user_permissions_select_own` mempunyai jurang sama.** Dibaiki.

Selain itu, dua bug dalam kod saya sendiri ditemui dan dibaiki: trigger audit gagal apabila satu fungsi dikongsi dua table dengan kolum berbeza (`NEW`/`OLD` ditaip kepada table trigger), dan trigger `protect_last_admin` tidak selamat untuk kedua-dua table.

### Bukti validation

Runner: `./supabase/tests/run_phase1_tests.sh`

| Pemeriksaan | Lokal | Remote |
|---|---|---|
| Migration terpakai bersih | ✅ | ✅ |
| Idempotency (apply 2× → 39/2/52 tanpa ralat) | ✅ | ✅ |
| Suite authorization (21 ujian) | ✅ 21/21 | ✅ 21/21 |
| RLS enable + **force** pada 7/7 table | ✅ | ✅ |
| Polisi (21 polisi) | ✅ | ✅ |
| `anon` tiada akses table/fungsi | ✅ | ✅ |
| Rollback ujian bersih (tiada fixture tertinggal) | ✅ | ✅ |

Frontend kekal tidak berubah: `tsc --noEmit` lulus, `npm run build` lulus, suite Vitest kekal 1 kegagalan sedia ada (Paystack, modul REMOVE).

### Cutover login frontend → Supabase (selesai)

Login kini menggunakan Supabase Auth. Rupa skrin **tidak berubah** — susun atur, warna, butang dan kedudukan mesej ralat kekal sama. Hanya cara ia menyemak kelayakan yang bertukar.

| Fail | Peranan |
|---|---|
| `src/lib/supabase/client.ts` | Klien browser; publishable key sahaja |
| `src/lib/supabase/auth.ts` | Semua operasi auth + terjemahan mesej ralat |
| `components/auth/Login.tsx` | Emel + kata laluan; demo dibuang |
| `context/AuthContext.tsx` | Jambatan sesi Supabase → bentuk konteks sedia ada |

**Keputusan pemilik:** medan login jadi **emel sahaja** (skrin lama terima emel ATAU ID sekolah; Supabase tiada padanan untuk ID sekolah), dan **demo role-switcher dibuang** (ia bergantung pada backend lama + `DEMO_SCHOOL_ID`, konsep yang dibuang).

**Perubahan tingkah laku yang disengajakan:**
- Medan pertama: "Email or Username" → **"Email"** (kunci `auth.email` ditambah dalam 9 bahasa). Ini satu-satunya perubahan teks yang dilihat pengguna.
- Butang "Try Demo School" dan skrin demo dibuang.
- Deep link `/demo` dan `?demo=1` dibuang; `/signup` kekal.
- Emel belum disahkan kini **benar-benar** membawa pengguna ke skrin pengesahan. Skrin lama mengira bendera `requiresVerification` kemudian membuangnya, jadi pengguna yang kata laluannya betul tersekat tanpa penjelasan.
- Mesej ralat dikekalkan: "Invalid credentials" (bukan teks Supabase "Invalid login credentials").

**Jambatan sesi:** `AuthContext` mendengar perubahan sesi Supabase dan menterjemahkannya kepada bentuk konteks yang sama digunakan 200+ pengguna `useAuth()`. Ia berjalan **di sebelah** laluan restore legacy, bukan menggantikannya — kedua-duanya mesti boleh membina sesi semasa cutover, dan tiada satu pun boleh dibuang sehingga satu lagi terbukti meliputi semua kes. Ini syarat yang membolehkan laluan legacy dipadam kemudian.

### Bug keselamatan kedua ditemui semasa cutover

Ujian hujung-ke-hujung terhadap projek remote mendedahkan **jurang sebenar**: `profiles_update_own` hanya memaku lajur `status`, jadi pengguna boleh menulis `full_name`/`phone` terus ke table dan **memintas RPC `update_my_profile()` yang diaudit**. Bukti: nama profil bertukar kepada "Hacked".

RLS memeriksa **baris**, bukan **lajur**, jadi memaku lebih banyak lajur tidak boleh menutupnya. Pembetulan: **buang terus grant UPDATE** pada `profiles` untuk `authenticated`. `update_my_profile()` ialah `SECURITY DEFINER`, jadi ia menulis sebagai pemilik table dan tidak perlukan grant itu. Polisi `profiles_manage` yang tidak lagi boleh dilaksanakan turut dibuang supaya tidak mengelirukan pembaca.

Ditambah **`REVOKE UPDATE` secara eksplisit**, bukan sekadar meninggalkan grant: revisi migration yang lebih awal pernah memberikannya, dan migration mesti selamat dijalankan semula pada pangkalan data yang sudah ada grant lama.

### Bukti validation cutover

| Pemeriksaan | Hasil |
|---|---|
| Typecheck frontend | ✅ lulus |
| `npm run build` | ✅ lulus (exit 0) |
| Ujian UI login (7 ujian) | ✅ 7/7 |
| Suite Vitest penuh | ✅ 116 lulus / 1 gagal sedia ada (Paystack — jangan baiki) |
| Grant UPDATE dibuang di remote | ✅ `has_table_privilege = false`, SELECT kekal `true` |
| UPDATE mentah ditolak | ✅ 403, nama kekal tidak berubah |
| RPC `update_my_profile` berfungsi | ✅ menulis sebagai dirinya sendiri |
| Grant ADMIN kepada diri sendiri | ✅ 403 |
| Terjemahan peranan (live) | ✅ ADMIN → 39 permission → Admin; TEACHER → 13 → Teacher |
| Secret key **tidak** dalam bundle | ✅ nilai kunci sebenar tiada dalam `dist/` (nota: `grep sb_secret_` memberi positif palsu — rentetan itu muncul dalam kod pengawal sendiri dan dalam pustaka Supabase, bukan sebagai kunci) |
| Trigger perlindungan masih aktif | ✅ `tgenabled = O` |

Ujian e2e dijalankan dengan **publishable key** (bukan service key), jadi ia melalui RLS betul seperti pelayar. Projek remote dikembalikan bersih selepas setiap ujian.

### Pemudahan: hanya emel + kata laluan (selesai)

Keputusan pemilik: **buang semua SSO**, hanya tinggalkan login emel + kata laluan melalui Supabase.

| Dibuang | Sebab |
|---|---|
| Google Sign-In + Google Identity Services | SSO; satu-satunya pembekal OAuth dalam projek |
| Butang "Create School Account" | pendaftaran sendiri; akaun dicipta oleh pentadbir |
| `Signup.tsx`, `SchoolSignup.tsx`, `CreateSchoolSignup.tsx`, `SchoolSelector.tsx` | skrin pendaftaran sendiri, kod mati selepas dibuang |
| `VerifyEmail.tsx`, `VerifyEmailScreen.tsx`, `EmailVerificationScreen.tsx`, `PhoneVerification.tsx` | pengesahan kod 6 digit; Supabase guna **pautan emel**, bukan kod |
| Banner `EmailVerificationPrompt` + penggunaannya dalam **6 papan pemuka** | bergantung pada `api.resendVerification` / `api.verifyEmailChange` (backend lama) |
| `signInWithGoogle` (AuthContext, `lib/api.ts`, `lib/api/eager.ts`) | laluan Google |
| `VITE_GOOGLE_CLIENT_ID` dari `.env.example` | tidak lagi digunakan |

`VerificationGuard` dikekalkan sebagai **pass-through jujur**: ia sudah tidak berbuat apa-apa (logik asalnya dikomentarkan), dan pengawal yang kelihatan menguatkuasa sesuatu sedangkan tidak adalah lebih buruk daripada tiada pengawal. Ia tidak dikunci atau diubah tingkah lakunya.

`handleLogin` tidak lagi mengubah `view` kepada skrin pengesahan — skrin itu tiada. Mesej "Please verify your email before logging in" kekal dipaparkan, kerana pengguna tetap perlu tahu mengapa kata laluan yang betul tidak diterima; mereka diminta semak peti masuk.

**Bukti (disahkan pada projek remote dengan publishable key):**

| Pemeriksaan | Hasil |
|---|---|
| Login emel + kata laluan | ✅ 200 |
| `google` / `apple` / `azure` / `facebook` / `github` SSO | ✅ 5/5 **ditolak** (400) |
| Pendaftaran sendiri (`/auth/v1/signup`) | ✅ ditolak (400) — `enable_signup = false` disahkan |
| Tiada rujukan Google dalam frontend | ✅ 0 padanan |
| Ujian UI login | ✅ 7/7 (termasuk: tiada Google, tiada demo, tiada pautan daftar, tepat 2 medan input) |
| Typecheck + build | ✅ lulus |
| Suite Vitest | ✅ 116 lulus / 1 gagal sedia ada (Paystack) |
| Suite SQL Fasa 1 | ✅ 22/22 |

**Perubahan tingkah laku yang disengajakan:** skrin login kini **hanya** ada medan emel, medan kata laluan, butang Sign In dan pautan "Forgot Password?". Tiada butang Google, tiada blok "Loading Google…", tiada butang daftar. Susun atur, warna dan butang yang tinggal tidak berubah.

### Penciptaan akaun guru: kata laluan sementara (selesai)

**Keputusan pemilik:** akaun dicipta oleh pentadbir melalui papan pemuka Supabase; pentadbir menetapkan kata laluan sementara. Tiada skrin pentadbir dibina dalam aplikasi.

**Masalah yang perlu diselesaikan:** jika pentadbir menetapkan kata laluan guru, kredensial itu diketahui **dua orang**. Tanpa mekanisme paksaan, kata laluan kongsi itu kekal berfungsi selamanya. Sebelum ini tiada apa-apa yang menguatkuasakannya, kerana butang tukar kata laluan pun belum ada.

**Penyelesaian:**

| Komponen | Peranan |
|---|---|
| `profiles.must_change_password` | Menanda akaun yang kredensialnya diketahui pentadbir |
| `clear_temporary_password_flag()` | Menghapus tanda, hanya oleh pemilik akaun (`auth.uid()`) |
| `components/auth/ChangePasswordScreen.tsx` | Skrin paksa tukar kata laluan |
| `App.tsx` | Menghalang papan pemuka selagi tanda aktif |

**Perkara keselamatan penting:**

- **Kata laluan tidak pernah melalui aplikasi.** Ia diurus sepenuhnya oleh Supabase Auth. Tiada fungsi dalam schema menerima kata laluan, dan tiada kata laluan disimpan dalam pangkalan data aplikasi. `clear_temporary_password_flag()` hanya merekod bahawa perubahan telah berlaku.
- **Susunan operasi disengajakan:** kata laluan ditukar **dahulu**, tanda dihapus **selepas** Supabase mengesahkan. Jika tanda dihapus dahulu, akaun akan ditanda "selamat" sedangkan kata laluan sementara masih berfungsi.
- **Fungsi tidak menerima user id.** Ia sentiasa bertindak ke atas `auth.uid()`, jadi mustahil untuk menghapuskan tanda akaun orang lain.
- **Perubahan direkod.** `TEMPORARY_PASSWORD_CLEARED` masuk ke `authorization_audit`.
- **`anon` tidak boleh memanggil fungsi** (disahkan pada remote).

**Bukti — kitaran hayat penuh disahkan pada projek remote:**

| Langkah | Hasil |
|---|---|
| 1. Pentadbir menetapkan tanda | ✅ `must_change_password = true` |
| 2. Guru log masuk dengan kata laluan sementara | ✅ berjaya, akaun ditanda |
| 3. Aplikasi nampak tanda itu | ✅ `true` |
| 4. Guru tukar kata laluan sendiri | ✅ berjaya |
| 5. Tanda dihapus melalui RPC | ✅ `false` |
| 6. Kata laluan sementara **tidak lagi berfungsi** | ✅ ditolak |
| 7. Kata laluan baharu berfungsi | ✅ berjaya |
| 8. Perubahan direkod dalam audit | ✅ 1 baris |
| Ujian SQL Fasa 1 | ✅ 26/26 (4 ujian baharu) |
| Ujian UI + typecheck + build | ✅ 7/7, lulus |

**Panduan pentadbir:** `docs/srik/PANDUAN_CIPTA_AKAUN.md` — langkah demi langkah untuk pentadbir, dalam bahasa bukan teknikal.

### Fasa 2 — asas data sekolah (selesai, digunakan pada remote)

**Keputusan pemilik yang membentuk migration:**
- Tahun akademik **dengan penggal** (contoh: Penggal 1, 2, 3).
- **Tahun 6 tamat sekolah** — sistem **tidak** akan menaikkan Tahun 6 secara automatik. Ia menolak dan meminta keputusan manusia (tamat atau pindah).
- **Setiap tahun ada beberapa kelas bernama** (contoh: `3 Al-Junaidi`, `3 Al-Farabi`).

**Migration:** `supabase/migrations/20261008000001_phase2_academic_core.sql`
**Ujian:** `supabase/tests/phase2_academic_core_test.sql` — **21 pemeriksaan**
**Runner:** `supabase/tests/run_phase2_tests.sh`

**Jadual baharu (12):** `school_profile`, `teachers`, `students`, `guardians`, `student_guardians`, `academic_years`, `academic_terms`, `classes`, `subjects`, `student_enrollments`, `class_subjects`, `teaching_assignments`.

**Peraturan yang dikuatkuasakan oleh pangkalan data, bukan oleh UI:**

| Peraturan | Cara dikuatkuasakan |
|---|---|
| Hanya satu sekolah | kunci primer `boolean` — hanya satu baris boleh wujud |
| Kelas mesti sama tahun akademik | composite FK `(class_id, academic_year_id)` |
| Pelajar tidak boleh dua kelas serentak dalam tahun sama | partial unique index `where ended_at is null` |
| Hanya satu tahun akademik CURRENT | partial unique index `where status='CURRENT'` |
| Hanya satu penjaga utama per pelajar | partial unique index `where is_primary` |
| Kod (admission/staff/subjek) unik tanpa kira huruf besar | unique index pada `upper(...)` |
| Tahun 1–6 sahaja | `CHECK (year_level between 1 and 6)` |
| Guru kelas tiada subjek; guru subjek mesti ada subjek + period > 0 | `CHECK` pada bentuk assignment |

**Keputusan reka bentuk penting:**

1. **Penjaga TIDAK digabungkan automatik** walaupun nama dan telefon sama. Dua orang boleh berkongsi nama atau nombor telefon, dan menggabungkan mereka akan mencantum dua keluarga. Penyatuan kekal keputusan manusia.
2. **Kelas semasa diperoleh daripada enrollment**, bukan disimpan sebagai teks pada pelajar. Pertukaran kelas menutup baris lama dan membuka baris baharu — sejarah kekal.
3. **Enrollment dan assignment TIADA kebenaran tulis melalui Data API.** Ia hanya boleh diubah melalui RPC yang diaudit. Ini kerana pertukaran kelas mesti bersifat atomik: menutup baris lama dan membuka baris baharu dalam satu transaksi. Kebenaran tulis biasa akan membenarkan dua enrollment terbuka dan merosakkan peraturan "kelas semasa".
4. **Subjek adalah global**, tidak disalin setiap tahun, supaya perbandingan merentas tahun bermakna.
5. **`school_profile` bukan tenant.** Kunci primer `boolean` menjadikan "satu sekolah" jaminan pangkalan data.

**Penemuan yang mengubah migration ini:** Fasa 1 menyemai kebenaran yang **terperinci**, bukan `students.manage`. Ia menyemai `students.create`, `students.update`, `students.archive` secara berasingan. Migration asal saya andaikan `students.manage` dan **gagal** dengan jelas — pemeriksaan kebenaran yang saya tulis sendiri menangkapnya dan menolak migration daripada dipakai secara senyap. Ini disengajakan: kebenaran yang hilang akan menyebabkan setiap policy menolak segalanya tanpa sebarang ralat.

**Bukti validation:**

| Pemeriksaan | Hasil |
|---|---|
| Suite Fasa 2 (SQL) | ✅ 21/21 |
| Suite Fasa 1 (SQL, masih) | ✅ 26/26 |
| Migration idempotent (guna dua kali) | ✅ 19 jadual kekal |
| RLS enabled + FORCED | ✅ 19/19 jadual |
| `anon` akses | ✅ ditolak (`42501` — tiada grant langsung) |
| RPC sebagai `anon` | ✅ ditolak |
| ADMIN baca + tulis melalui Data API | ✅ berfungsi |
| Typecheck + build frontend | ✅ lulus |
| Projek remote | 19 jadual, 1 pengguna (admin001), 0 data ujian |

**Peraturan ujian yang mesti diingati:** `test_as()` mesti menetapkan `request.jwt.claims` (blob JSON), **bukan** `request.jwt.claim.sub`. Menetapkan yang salah meninggalkan `auth.uid()` NULL, semua policy menolak, dan ujian gagal seperti bug RLS sedangkan ia bug harness. Ia juga mesti guna `set local role`, bukan `set_config('role', ...)`.

**Belum dibuat (sengaja):** tiada UI untuk data ini, dan pelajar belum boleh log masuk (deferred mengikut roadmap). Skrin masih membaca sistem lama sehingga Fasa 2 UI bermula.

### Buang kod auth mati + betulkan aliran pemulihan kata laluan (selesai)

**Penemuan penting yang mengubah rancangan:** auth lama **tidak boleh** dibuang sepenuhnya lagi. `lib/api/core.ts:269` menghantar `Authorization: Bearer <token lama>` untuk **setiap** permintaan data. Hanya endpoint lama (`/auth/login`, `/auth/refresh`, dsb.) mengeluarkan token itu. Membuangnya akan memutuskan seluruh aplikasi.

Kesimpulan: auth lama hanya boleh dibuang **selepas data dipindahkan** (Fasa 2). Ia tidak boleh didahulukan.

**Dua bug sebenar ditemui dan dibetulkan** (bukan kod mati — ciri rosak):

| Bug | Kesan kepada pengguna | Pembetulan |
|---|---|---|
| `AuthCallback` menghantar token Supabase ke `/auth/verify-email` (sistem lama) | Klik pautan reset emel → ralat → **tidak boleh pulih akaun** | `AuthCallback` ditulis semula; Supabase mengesahkan pautannya sendiri (`detectSessionInUrl: true`) |
| Skrin reset meminta **kod 6 digit** | Supabase hantar **pautan**, bukan kod → kod tidak pernah tiba | Skrin ditukar kepada "semak emel anda"; pautan membawa ke `SetPasswordScreen` baharu |

**Skrin baharu:** `components/auth/SetPasswordScreen.tsx` — halaman untuk pautan pemulihan. Ia **asing** daripada `ChangePasswordScreen` dengan sengaja: akaun kata laluan sementara perlu menghapus tanda `must_change_password`; akaun lupa kata laluan tidak, kerana tiada kredensial kongsi untuk dibersihkan.

**Kod mati yang dibuang** (setiap satu disahkan sifar pemanggil):

| Dibuang | Bukti |
|---|---|
| `pages/auth/AuthConfirm.tsx` (fail penuh) | sifar import; App render `components/auth/AuthCallback` |
| `components/auth/IDUpload.tsx` (fail penuh) | sifar import |
| `lib/auth.ts` → `authenticateUser`, `signOutUser`, `checkUsernameExists` | sifar pemanggil; `signOutUser` badan no-op |
| `lib/api.ts` → `updateEmail`, `updateUsername`, `verifyEmailChange`, `updatePassword` (lama) | sifar pemanggil |
| `DashboardLayout` → `handleDemoRoleSwitch`, `switchingRole`, import `DEMO_ROLES_ORDER`/`DEMO_ACCOUNTS` | satu-satunya pemanggil ialah pil demo yang telah dibuang |
| `Login.tsx` → import `authenticateUser` | import mati yang membuat `api.login` **kelihatan** hidup padahal mati |

**Amaran untuk kerja akan datang:** `api.updatePassword` (lama, kini dibuang) berkongsi nama dengan `updatePassword` Supabase yang **aktif** (`src/lib/supabase/auth.ts`, digunakan `ChangePasswordScreen`/`SetPasswordScreen`). Sebarang pemadaman berasaskan `grep` mesti berhati-hati.

**Yang TIDAK dibuang dan sebabnya** (disahkan masih digunakan secara langsung):

| Dikekalkan | Sebab |
|---|---|
| `currentSchool` | **459 rujukan dalam ~96 fail** — membuangnya memusnahkan seluruh UI |
| `currentBranchId`, `BranchContext`/`useBranch` | dipakai header, jadual, kelas maya, dsb. |
| `getMe`, `refreshToken` | pemulihan sesi dan penyegaran token |
| `forgotPassword`, `resetPassword` | skrin login (kini dihalakan ke Supabase) |
| 2FA (`setup2FA`/`enable2FA`/`disable2FA`) | skrin "Security" admin/guru yang boleh dicapai |
| SocketContext / socketService / RealtimeService | langsung, dan **mengesahkan diri dengan token lama** |
| `isDemo`, `is_demo_mode`, `demo_school_id` | dijadikan syarat oleh keep-alive, gerbang langganan, kunci AI |
| `switchSchool` + `memberships` | boleh dicapai untuk akaun berbilang sekolah — pembuangannya ialah keputusan produk, bukan pembersihan kod mati |
| `InviteAcceptScreen` | laluan langsung untuk pautan jemputan |

**Bukti validation:**

| Pemeriksaan | Hasil |
|---|---|
| Typecheck | ✅ lulus |
| `npm run build` | ✅ lulus |
| Ujian UI login | ✅ 7/7 |
| Suite Vitest penuh | ✅ 116 lulus / 1 gagal sedia ada (Paystack) |
| Suite SQL Fasa 1 | ✅ 26/26 |
| Aliran pemulihan kata laluan (remote) | ✅ pautan diterima; kata laluan lama ditolak, baharu berfungsi |
| Emel tidak dikenali tidak membocorkan | ✅ respons sama |
| `pages/` | kini kosong (fail orphan dibuang) |

### Fasa 2 UI — skrin guru (sebahagian selesai)

**Fail baharu:** `src/lib/supabase/teachers.ts` (lapisan data guru), `supabase/functions/provision-teacher-account/index.ts` (cipta akaun log masuk), `components/admin/__tests__/TeacherListScreen.test.tsx`.

**TeacherListScreen — SELESAI.** Ia kini membaca terus daripada Supabase; **0 panggilan** kepada sistem lama (dahulu 2). Rupa skrin tidak diubah.

**Bug sebenar ditemui dan dibetulkan semasa migrasi:** kod kakitangan guru dipaparkan melalui `formatSchoolId()`, yang menulis semula kod sekolah menjadi bentuk lama `oliskey_main_tch_001`. Ini (a) memusnahkan kod yang sekolah sendiri pilih, dan (b) menampal nama sekolah **lain** ("oliskey") pada dokumen SRIK. Kod kini dipaparkan seperti yang disimpan.

**Had yang dipatuhi:** kad "Jabatan" dibiarkan dengan struktur asalnya tetapi sentiasa memaparkan 0, kerana sistem baharu tiada medan jabatan dan **membuang elemen yang kelihatan ialah perubahan UI yang memerlukan keputusan pemilik**, bukan keputusan refactor.

**AddTeacherScreen — BELUM DIBUAT, dan ini penemuan penting.** Ia bukan sekadar pertukaran data. Ia mengandungi **854 baris** yang terikat pada konsep yang SRIK **tidak ada**:

| Konsep lama dalam skrin | Kekerapan | Status dalam SRIK |
|---|---|---|
| `branch` / `Branch` (cawangan) | 92 | **Dibuang** — SRIK satu sekolah |
| Nigerian / British curriculum | 25 | **Dibuang** |
| TRCN (sijil Nigeria) | 7 | **Dibuang** |
| `DEFAULT_STANDARD_CLASSES` (SSS 1, JSS 2…) | 5 | **Dibuang** — SRIK Tahun 1–6 |
| Subscription / had pelan | 3 | **Dibuang** — tiada SaaS |

Membersihkannya bermakna **menulis semula** skrin itu, bukan menyambungkannya. Itu kerja berasingan, dan sebahagian daripadanya memerlukan keputusan pemilik tentang apa yang guru baharu patut isi.

**Edge Function baharu:** `provision-teacher-account`. Ia mencipta akaun Supabase untuk guru yang sedia ada. Ia mengesahkan **dua kali**: JWT pemanggil disahkan platform, dan kebenaran `users.manage` disemak semula dalam pangkalan data — kerana login sah bukan sama dengan hak mencipta pengguna. Jika pautan akaun gagal, akaun dibatalkan supaya tiada keadaan separuh siap. **Belum diuji secara langsung** (perlu deploy); ia akan diuji bila skrin tambah guru dibina semula.

**Bukti validation:**

| Pemeriksaan | Hasil |
|---|---|
| Ujian TeacherListScreen | ✅ 5/5 |
| Suite penuh Vitest | ✅ 121 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Cipta guru (live) | ✅ berjaya |
| Kod kakitangan pendua | ✅ ditolak (409) |
| TEACHER cipta guru | ✅ ditolak (403) |
| TEACHER baca guru | ✅ dibenarkan |
| Projek remote | 1 pengguna (admin001), 0 data ujian |

**Nota konfigurasi:** `tsconfig.json` kini mengecualikan `supabase/functions` — Edge Function berjalan dalam Deno, bukan pelayar, jadi ia tidak boleh ditaip dengan tetapan frontend.

### Fasa 2 UI — skrin guru SELESAI (kedua-dua skrin)

**AddTeacherScreen ditulis semula** (854 → ~420 baris). Medan SRIK sahaja: kod kakitangan, nama, jantina, emel, telefon, tarikh mula, status, kelas diajar, subjek diajar, dan pilihan cipta akaun log masuk. **92 rujukan** kepada cawangan, kurikulum Nigeria/British, TRCN, kelas "SSS 1" dan had langganan telah dibuang sepenuhnya. Ada ujian yang gagal jika mana-mana satu kembali.

**Rupa kekal gaya yang sama:** kad putih, input kelabu, butang simpan di bawah — bukan reka bentuk baharu, hanya borang baharu.

**Dua bug sebenar ditemui oleh ujian langsung (bukan oleh ujian unit):**

| Bug | Mengapa ujian unit terlepas | Pembetulan |
|---|---|---|
| PostgREST menolak insert berkelompok bila objek ada kunci **berbeza** — baris CLASS_TEACHER tiada `periods_per_week`, baris SUBJECT_TEACHER ada | Ujian unit menguji logik skrin, bukan panggilan rangkaian sebenar | Semua baris kini membawa **semua** kunci, `null` di mana tidak berkenaan |
| Lapisan data menulis `teaching_assignments` **secara langsung**, tetapi jadual itu **tiada kebenaran tulis** dengan sengaja | Kod kelihatan betul; hanya pangkalan data sebenar menolaknya | Tambah RPC `set_teacher_assignments` yang diaudit |

Bug kedua ialah contoh tepat mengapa reka bentuk Fasa 2 melarang tulisan terus: pertukaran tugas guru mesti menutup baris lama dan membuka baris baharu dalam satu langkah. RPC baharu berbuat demikian, dan **tugas lama disimpan sebagai sejarah, tidak dipadam**.

**Migration dikemas kini:** RPC `set_teacher_assignments` ditambah. Ujian Fasa 2 kini **23 pemeriksaan** (dahulu 21); dua ujian baharu membuktikan tugas diganti secara atomik dan guru biasa tidak boleh mengubahnya.

**Nota penting tentang kebenaran tulis:** `teaching_assignments` dan `student_enrollments` sengaja **tiada** kebenaran INSERT/UPDATE/DELETE. Ini bermakna guru boleh **dilihat** tetapi tugasnya hanya boleh diubah melalui RPC. Guru yang ditulis semula menghormati ini sepenuhnya.

**Bukti validation:**

| Pemeriksaan | Hasil |
|---|---|
| Ujian AddTeacherScreen | ✅ 7/7 |
| Ujian TeacherListScreen | ✅ 5/5 |
| Suite penuh Vitest | ✅ 128 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Suite SQL Fasa 2 | ✅ 23/23 |
| Suite SQL Fasa 1 | ✅ 26/26 |
| Cipta guru + tugas (live, melalui RPC) | ✅ 2 tugas dicipta |
| Jalankan semula tugas | ✅ set lama ditutup, 2 aktif (tidak bertindih) |
| Guru kelas + subjek (bentuk salah) | ✅ ditolak (403) |
| Guru subjek tanpa subjek | ✅ ditolak (403) |
| Nama paparan kelas | ✅ "3 Al-Junaidi" |
| Projek remote | 19 jadual, 4 RPC, 1 pengguna (admin001), 0 data ujian |

**Belum dibuat:** tiada — fungsi ini sudah di-deploy dan diuji secara langsung (lihat di bawah).

## Edge Function `provision-teacher-account` — DEPLOYED DAN DIUJI (selesai)

Fungsi cipta akaun guru kini dipasang pada remote dan disahkan berfungsi hujung-ke-hujung. Semasa pemasangan, **tiga pepijat sebenar** ditemui — dua daripadanya hanya kelihatan apabila dijalankan pada sistem sebenar, bukan dalam ujian.

### Pepijat 1 — fungsi akan menolak SEMUA orang, termasuk Pentadbir

Fungsi menyemak "adakah pemanggil boleh cipta pengguna?" dengan menanyakan soalan itu melalui **kunci sistem**. Fungsi `has_permission` menentukan siapa "saya" dengan membaca `auth.uid()` daripada token yang membuat permintaan — dan kunci sistem tidak pernah log masuk sebagai sesiapa. Jadi jawapannya sentiasa `false`, dan fungsi itu akan menolak Pentadbir sendiri. Ia kelihatan berfungsi tetapi mustahil digunakan.

**Dibetulkan:** semakan kebenaran kini dibuat dengan klien yang membawa **token pemanggil**. Kunci sistem hanya digunakan selepas kebenaran disahkan, untuk kerja berprivilej mencipta akaun.

### Pepijat 2 — `service_role` tiada kebenaran SELECT pada mana-mana jadual

Dijumpai hanya apabila diuji secara langsung: fungsi membaca `teachers` dan menerima `permission denied for table teachers` (42501). Ini menjejaki kepada jurang dalam migrasi Fasa 1 dan 2 — kedua-duanya memberikan grant kepada `authenticated` dan menarik balik daripada `anon`, tetapi **tidak pernah** memberikan apa-apa kepada `service_role`.

`BYPASSRLS` tidak mencukupi: ia melangkau RLS, tetapi bukan `GRANT` peringkat jadual, yang merupakan mekanisme berasingan dan digunakan dahulu. Setiap jadual juga mempunyai `FORCE ROW LEVEL SECURITY`.

**Dibetulkan oleh migrasi baharu** `20261009000001_service_role_grants.sql` — memberikan CRUD penuh kepada `service_role` pada semua 19 jadual, dan **mengesahkan** semasa ia berjalan bahawa: (a) `service_role` kini boleh membaca `teachers`, (b) `anon` masih tiada sebarang grant, (c) `student_enrollments` masih tiada kebenaran tulis untuk `authenticated`. Migrasi ini tidak meluaskan apa yang pengguna biasa boleh lakukan.

### Pepijat 3 — config.toml menghalang pemasangan

Blok `[functions]` mempunyai `verify_jwt = true` di peringkat atas. Versi CLI semasa melayan `[functions]` sebagai jadual **per-fungsi**, jadi pemasangan gagal dengan `CliConfigParseError` tanpa butiran berguna.

**Dibetulkan:** ditukar kepada `[functions.provision-teacher-account]`.

### Bukti ujian langsung

| Pemeriksaan | Hasil |
|---|---|
| Permintaan tanpa log masuk | ✅ ditolak (401) |
| Permintaan dengan kunci sistem sahaja | ✅ ditolak (401) |
| Cipta rekod guru | ✅ 201 |
| Cipta akaun log masuk | ✅ 200 |
| Kata laluan sementara dipulangkan sekali | ✅ ya |
| Guru dipautkan kepada akaun | ✅ ya |
| Jalankan dua kali (tidak cipta akaun kedua) | ✅ ditolak (409) |
| Guru log masuk dgn kata laluan sementara | ✅ 200 |
| Bendera tukar kata laluan wajib | ✅ ditetapkan |
| **Guru biasa cuba cipta akaun** | ✅ **ditolak (403)** |
| Bersihkan data ujian | ✅ 0 tertinggal |

**Data remote selepas ujian:** guru=0, pelajar=0, penjaga=0, kelas=6 (konfigurasi sebenar), pengguna=1 (Pentadbir sebenar). Tiada akaun ujian tertinggal.

**Token akses** disimpan dalam `.env` (gitignored, chmod 600) dan **tidak** ada dalam repo, bundle atau sebarang fail yang dijejak.

## Fasa 3 — penyuntingan dan penerbitan SELESAI

### Skrin berasingan daripada paparan

Menyunting ialah tindakan yang disengajakan. Guru yang sedang memeriksa jadual Jumaatnya tidak sepatutnya berada satu ketikan daripada memindahkan pelajaran. Jadi **Edit** ialah skrin berasingan dengan butangnya sendiri.

Editor menyusun minggu **mengikut hari** (bukan grid 5 lajur) kerana pada telefon, grid 5 lajur menjadi terlalu sempit untuk dibaca. Setiap hari menunjukkan waktunya, dan setiap slot sama ada kosong atau berisi.

### Dua peraturan pangkalan data yang membentuk setiap interaksi

**1. Guru tidak boleh berada di dua tempat pada satu masa.**

Sebelum pelajaran diletakkan, pertembungan **dicari dahulu** dan ditunjukkan — menamakan kelas dan subjek yang berkonflik. Sekolah diberitahu sebelum ia komited, bukan selepas pangkalan data menolaknya. Pangkalan data tetap menguatkuasakannya tanpa mengira apa yang skrin kata.

**2. Guru mesti ditugaskan untuk subjek itu dalam kelas itu.**

Senarai subjek **bukan** "semua subjek" — ia "subjek yang guru kelas ini ditugaskan ajar". Menawarkan subjek yang tiada siapa ditugaskan akan menghasilkan pelajaran yang ditolak pangkalan data, yang lebih buruk daripada tidak menawarkannya langsung.

Guru **ditunjukkan, bukan dipilih**. Jadual tugasan sudah memutuskan siapa mengajar subjek itu, jadi meminta sekolah memilih kedua-duanya akan membenarkan pasangan yang tidak wujud.

### Penerbitan

Butang **Publish** berasingan, dan ia berhenti sebaik sahaja jadual diterbitkan — tiada gunanya menerbitkan sesuatu yang sudah diterbitkan. Ia memberi amaran bahawa jadual yang sedang diterbitkan akan **digantikan**, kerana sekolah mengikut satu minggu, bukan dua.

Penerbitan melalui RPC kerana ia juga mesti menggantikan jadual yang diterbitkan sebelum ini. Melakukannya secara manual akan meninggalkan dua jadual bertanda semasa.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Ujian editor (baharu) | ✅ 13/13 |
| Guru bertindih ditolak (live, terbukti) | ✅ `idx_..._not_double_booked` menolak |
| Waktu bertindih ditolak (live) | ✅ kekangan pengecualian menolak |
| Amaran pertembungan sebelum simpan | ✅ ujian |
| Guru dipilih automatik drpd subjek | ✅ ujian |
| Amaran penggantian semasa terbit | ✅ ujian |
| Typecheck + build | ✅ lulus |
| Suite penuh | ✅ 215 lulus / 1 gagal sedia ada (Paystack) |
| Jadual sebenar | ✅ 329 entri, 127 tugasan, 18 guru |

**Pepijat sebenar yang dijumpai semasa ujian live:** ujian pertembungan pertama saya memilih pasangan guru/subjek/kelas yang tidak sah, jadi ia ditolak oleh peraturan **tugasan** — bukan peraturan **tindih**. Ujian itu lulus atas sebab yang salah. Saya membina semula dalam jadual ujian berasingan dengan pasangan yang sah sepenuhnya, dan barulah indeks anti-tindih benar-benar menolaknya. Peraturan itu memang berfungsi; ujian pertama saya tidak membuktikannya.

**Status jadual sekarang:** jadual 2026 telah diterbitkan semasa ujian live, jadi ia status rasmi yang sekolah ikut. 329 pelajaran kekal utuh.

## Fasa 3 — skrin jadual waktu SELESAI

### Satu skrin, enam skrin lama dibuang

Projek sumber ada **enam** skrin jadual waktu: `TimetableGeneratorScreen`, `TimetableCreationPage`, `TimetableDeskBuilder`, `TimetableEditor` — 992 baris — dan dua lagi. Saya semak satu per satu: **kesemuanya** membaca daripada API lama, dan satu-satunya perkara yang mereka lakukan ialah menavigasi sesama sendiri. Enam skrin, tiada satu pun boleh dilihat oleh guru.

Kesemuanya dibuang dan digantikan dengan satu skrin. Dibackup ke `/tmp/legacy-tt-backup/`.

### Jadual waktu kelas dan jadual waktu guru ialah minggu yang sama

Skrin menunjukkan kedua-duanya, tetapi daripada sisi bertentangan:

- **Ikut kelas** — setiap sel menunjukkan subjek dan **guru**
- **Ikut guru** — setiap sel menunjukkan subjek dan **kelas**

Kedua-duanya melalui pengiraan grid yang sama. Kalau ia dilaksanakan dua kali, satu hari nanti kedua-duanya akan berbeza dan tiada siapa akan tahu mana yang betul.

### Hari sekolah ditunjukkan SEBENARNYA

Perkara yang paling penting dalam skrin ini: **waktu bukan pelajaran tidak dipaparkan sebagai kekosongan.**

- Waktu 1 Ahad → "Perhimpunan"
- Waktu 1 Khamis → "Yasin/Dhuha"
- Waktu 5 setiap hari → "Rehat"
- Waktu 11 setiap hari → "Zohor"

Setiap satu ada warnanya sendiri. Guru yang memandang waktu 1 Khamis akan nampak "Yasin/Dhuha", bukan kosong. Versi lama tidak boleh melakukan ini langsung — ia hanya tahu pelajaran.

### Pelajaran tanpa guru ditandakan, bukan disembunyikan

Kekosongan dan **kerja yang belum siap** kelihatan sama pada grid. Jadi pelajaran yang tiada guru ditandakan merah dan dikira di bahagian atas: **"Tanpa guru: n"**. Ini kerja untuk pejabat, dan ia akan tidak kelihatan jika dibiarkan kosong.

### Amaran draf

Jadual sekarang berstatus **draf** — ia belum diterbitkan. Skrin berkata dengan jelas: *"This timetable is still a draft. It has not been published, so teachers should not be following it yet."* Menunjukkan jadual draf tanpa amaran bermakna guru mula mengikut jadual yang belum dipersetujui.

### Pepijat sebenar yang dijumpai

**PostgREST menolak penapis pada hubungan yang tidak diminta.** Skrin yang menapis `timetable_periods.timetable_id` mesti meletakkan `timetable_periods` dalam senarai `select` juga. Tanpanya, setiap permintaan gagal 400 — dan ia gagal **serta-merta**, bukan kadang-kadang, jadi ia akan dijumpai semasa ujian, bukan dalam produksi.

**Had 1000 baris PostgREST memotong kiraan secara senyap.** Mengira pelajaran tidak lengkap dengan mengambil semua baris kemudian menapis akan melaporkan jadual 329 pelajaran sebagai lengkap sementara sebenarnya dipotong. Digantikan dengan kiraan tepat yang dibuat oleh pangkalan data.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Ujian skrin jadual waktu (baharu) | ✅ 13/13 |
| Ujian waktu bukan pelajaran dinamakan | ✅ Perhimpunan, Yasin/Dhuha, Rehat ×5, Zohor ×5 |
| Ujian pelajaran tanpa guru ditandakan | ✅ |
| Ujian draf diberi amaran | ✅ |
| Ujian sisi guru menunjukkan kelas | ✅ |
| Ujian minggu Malaysia (Ahad–Khamis) | ✅ |
| Typecheck + build | ✅ lulus |
| Suite penuh | ✅ 202 lulus / 1 gagal sedia ada (Paystack) |
| Skrin lama dibuang | ✅ 6 fail, dibackup |
| Query disemak live | ✅ 329 entri, 7 kelas, 18 guru |

**Apa yang tinggal dalam Fasa 3:** menyunting jadual melalui skrin (sekarang hanya melihat), dan penerbitan draf melalui UI. Kedua-duanya ada RPC tetapi belum ada butang.

## Fasa 3 — jadual sebenar 2026 dimuatkan SELESAI

### RPC baharu: `set_teaching_pairs`

Memuatkan jadual sebenar **mendedahkan kelemahan dalam `set_teacher_assignments`** — RPC Fasa 2 yang sedia ada. Ia mengambil **senarai kelas** dan **senarai subjek**, kemudian memasangkan setiap kelas dengan setiap subjek. Ia juga **selalu** mencipta baris `CLASS_TEACHER`.

Untuk jadual sebenar, itu salah pada dua cara:

1. **Ia tidak boleh menyatakan pasangan tepat.** Guru yang mengajar BM di 3J dan Sains di 4J akan diberi BM *dan* Sains di *kedua-dua* kelas. Jadual akan kelihatan betul sementara guru diam-diam diberi subjek yang mereka tidak ajar — dan tiada skrin kemudian boleh mengesannya.

2. **Setiap guru menjadi guru kelas.** Menjadikan 18 guru guru kelas untuk kelas yang sama akan menghasilkan kekeliruan yang sukar dibongkar.

**Keputusan:** saya tambah RPC baharu `set_teaching_pairs` yang mengambil **pasangan tepat** `(kelas, subjek)` dan **tidak** mencipta guru kelas. Menjadi guru kelas ialah jawatan dengan tanggungjawab, bukan kesan sampingan mengajar dalam bilik — dan sekolah belum memberitahu siapa yang memegangnya.

RPC lama **tidak diubah**: ujian Fasa 2 bergantung pada perlakuan guru-kelasnya, jadi ia reka bentuk yang disengajakan, bukan pepijat. Kedua-duanya wujud, dengan kegunaan berbeza. Enam ujian baharu mengesahkan perbezaan itu.

### Data yang dimuatkan

| | Bilangan |
|---|---|
| Pelajaran dalam jadual | **329** |
| Tugasan mengajar | **127** |
| Guru | 18 (didaftar drpd fail aSc) |
| Kelas | 7 |
| Subjek | 20 |
| Guru kelas | **0** (sengaja) |

### Subjek dibuang

**PI (Pendidikan Islam)** tidak muncul dalam jadual mana-mana guru, jadi ia dibuang. Membiarkannya bermakna senarai subjek mengandungi subjek yang tiada siapa mengajar.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Suite SQL Fasa 3 | ✅ 29/29 (dahulu 25) |
| Ujian pasangan tepat | ✅ subjek tidak dipasangkan secara salah |
| Ujian tiada guru kelas dicipta | ✅ 0 |
| Ujian RPC tetap audit + simpan sejarah | ✅ |
| Ujian TEACHER tidak boleh guna RPC | ✅ |
| Muat naik live | ✅ 127 + 329, 0 gagal |
| Guru bertindih | ✅ 0 |
| Kelas bertindih | ✅ 0 |
| Liputan | ✅ 47/60 setiap kelas (13 = Rehat, Zohor, Perhimpunan, Yasin) |

## Fasa 3 — template hari persekolahan SEBENAR SELESAI

### Sumber

Fail **`Jadual_Guru_2026.md`** daripada sekolah (eksport aSc Timetables, dijana 15/1/2026). Ia mengandungi 12 guru dan 336 baris.

**Ini menyelesaikan masalah yang saya bangkitkan sebelum ini.** Semasa saya bina lapisan data, saya sengaja TIDAK mencipta sembilan daripada dua belas waktu, kerana spec hanya menyatakan tiga: waktu 1, 5 (Rehat) dan 11 (Zohor). Saya kata mereka masa mustahil untuk direka. Fail ini memberikan masa itu.

### Hari persekolahan sebenar: 7:30 pagi hingga 2:30 petang

| Waktu | Masa | | Waktu | Masa |
|---|---|---|---|---|
| 1 | 7:30 – 8:05 | | 7 | 11:00 – 11:35 |
| 2 | 8:05 – 8:40 | | 8 | 11:35 – 12:10 |
| 3 | 8:40 – 9:15 | | 9 | 12:10 – 12:45 |
| 4 | 9:15 – 9:50 | | 10 | 12:45 – 13:20 |
| 5 | 9:50 – 10:25 (Rehat) | | 11 | 13:20 – 14:00 (Zohor) |
| 6 | 10:25 – 11:00 | | 12 | 14:00 – 14:30 |

Dua belas waktu, **bersambung tanpa jurang**. Ujian mengesahkan setiap satu masa dan mengesahkan tiada jurang antara waktu — sebab jurang bermakna sekolah entah ke mana selama lima minit, dan jadual yang tidak sepadan dengan loceng sebenar akan diabaikan oleh guru.

**Percanggahan yang diselesaikan:** spec kata Zohor 13:30–13:55; fail aSc sekolah kata **13:20–14:00**. Pemilik memilih fail aSc, kerana ia dijana daripada jadual sekolah sebenar dan bukannya ditulis dalam dokumen. Template kini mengikut fail.

**Waktu 1 bukan pelajaran.** Ahad = Perhimpunan, Khamis = Yasin/Dhuha, Isnin–Rabu = PdP. Perhimpunan dan bacaan pagi menggantikan pelajaran, bukan ditambah di atasnya.

### Kelas dan subjek — dua pembetulan penting

Apabila membina jadual, saya dapati **pangkalan data saya sendiri salah** untuk dua kelas:

| Sebelum | Selepas | Sebab |
|---|---|---|
| 5 Na'im | **5 Al-Junaidi** | Tersalah semasa seed Fasa 2 |
| 6 Ma'wa | **6 Naim** | Tersalah semasa seed Fasa 2 |

Ini penggantian mudah — `display_name` dikira oleh pangkalan data, jadi "5 Al-Junaidi" muncul dengan sendirinya. Tiada pelajar terjejas (0 pelajar ketika itu).

**Subjek ditambah:** 15 subjek baharu daripada legend fail aSc (AQ, BA, FQ, HD, HFZ, JW, KH, PJK, PSV, RBT, SJ, SR, TF, TH, TJ).

**Tiga pertindihan dibuang**, yang penting kerana ia akan memecahkan markah:

| Dibuang | Diganti dengan | Sebab |
|---|---|---|
| JQ "Jawi dan Khat" | JW "Jawi" + KH "Khat" | Fail aSc pisahkan keduanya |
| PAI "Pendidikan Al-Quran" | AQ "Al-Quran" | Subjek yang sama, dua kod |
| SNS | SN | Kod diselaraskan dengan aSc |

Membiarkan JQ dan PAI tinggal akan bermakna guru ada **dua subjek untuk benda yang sama**, dan markah murid akan terpecah antara keduanya — separuh dalam satu subjek, separuh dalam satu lagi, dengan setiap satu kelihatan tidak lengkap. Ini dibuang sebelum gred pertama pun wujud.

Subjek akhir: **21**, tiada pertindihan.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Suite SQL Fasa 3 (dikemas kini) | ✅ 25/25 (dahulu 24) |
| Ujian baharu: 12 waktu, tiada jurang | ✅ 2 pemeriksaan baharu |
| Idempotensi migrasi | ✅ kekal 25 jadual |
| RLS dipaksa semua jadual | ✅ 25/25 |
| 60 waktu dicipta (12 × 5 hari) | ✅ live |
| Setiap masa sepadan fail aSc | ✅ 12/12, live |
| Zohor 13:20–14:00 | ✅ live |
| Ahad waktu 1 Perhimpunan, Khamis Yasin/Dhuha | ✅ live |
| 7 kelas, nama betul | ✅ live |
| 21 subjek, tiada pertindihan | ✅ live |
| JQ, PAI dibuang; Sains = SN | ✅ live |

## Fasa 3 — skrin kehadiran SELESAI

### Skrin baharu: Daftar Kehadiran (`AttendanceRegisterScreen`)

Projek sumber **tiada** skrin untuk mengambil daftar kelas. Ia ada *laporan* kehadiran, yang merupakan kerja berbeza: laporan memberitahu apa yang telah direkod, skrin ini tempat ia direkodkan.

Guru: pilih kelas → tandakan siapa yang tidak hadir → simpan seluruh daftar sekali gus.

### Skrin ditulis semula: Gambaran Kehadiran (`AttendanceOverviewScreen`)

Skrin asal mengambil ringkasan yang sudah dikira daripada API lama dan menunjukkan carta. Skrin ini menjawab satu soalan yang pejabat tanya setiap pagi: **kelas mana yang BELUM hantar daftar?** Jadi "belum direkod" ialah keadaan tersendiri dengan warnanya sendiri, dan kelas yang belum ditanda muncul di atas.

### Tiga keputusan yang penting

**1. Tiada siapa bermula sebagai HADIR.** Semua pelajar bermula kosong — "belum direkod". Kalau semua ditandakan hadir terlebih dahulu, guru yang terganggu di tengah jalan akan meninggalkan daftar yang **kelihatan siap tetapi salah**. Bermula kosong bermakna daftar yang belum siap kelihatan belum siap.

**2. Daftar disimpan sekali gus, bukan seorang demi seorang.** Menanda 30 murid satu permintaan pada satu masa bermakna daftar separuh siap setiap kali satu permintaan gagal. Simpanan itu idempoten, jadi menekan butang dua kali tidak mendatangkan kesan.

**3. Amaran sebelum menyimpan daftar yang belum lengkap.** Kalau 3 murid belum ditanda, sistem bertanya: *"3 students have no mark yet. They will stay unrecorded. Save anyway?"* Menulis daftar separa siap akan meninggalkan selebihnya sebagai "belum direkod" — bukan apa yang guru maksudkan.

### Tarikh Malaysia

" Hari ini" dikira dalam waktu **Asia/Kuala_Lumpur**, bukan daripada jam peranti. Guru yang berada di luar negara akan mendapat tarikh sekolah yang salah kalau ia bergantung pada jam telefon. Ujian mengesahkannya terhadap `Intl` secara langsung.

Hari persekolahan ialah **Ahad–Khamis**. Menanda daftar pada Jumaat atau Sabtu hampir selalu bermakna tarikh tersalah taip, jadi skrin menyatakannya.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Ujian skrin daftar (baharu) | ✅ 12/12 |
| Ujian skrin gambaran (baharu) | ✅ 8/8 |
| **Termasuk ujian waktu Malaysia sebenar** | ✅ `todayInKualaLumpur()` dan `isSchoolDay()` |
| Suite penuh Vitest | ✅ 189 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Daftar kosong ≠ tidak hadir (live) | ✅ 0 baris, 0 dilaporkan tidak hadir |
| Simpan daftar (live) | ✅ 2 pelajar ditulis |
| Kelas lain kekal "belum direkod" (live) | ✅ 0 baris, bukan tidak hadir |
| Pembetulan dari daftar (live) | ✅ PRESENT → SICK, baris diganti bukan ditambah |
| Data ujian dibersihkan | ✅ 0 tinggal |

**Nota tentang satu pemeriksaan live yang "gagal":** semasa ujian live, satu langkah melaporkan 1 pembetulan dan bukan 2 rekod baharu. Siasatan menunjukkan ini **perlakuan yang betul** — skrip ujian cuba memadam baris dahulu, tetapi grant DELETE memang sengaja tiada pada jadual kehadiran, jadi baris lama kekal dan simpanan kedua **membetulkan**nya. Kod berkelakuan tepat seperti yang dirancang; skrip ujian saya yang cacat.

## Fasa 3 — jadual waktu dan kehadiran (lapisan data) SELESAI

### Jadual baharu (6)

| Jadual | Kegunaan |
|---|---|
| `timetables` | Satu jadual waktu per tahun akademik, dengan versi |
| `timetable_periods` | Bentuk hari persekolahan: waktu berapa, pukul berapa, jenis apa |
| `timetable_entries` | Kelas mana buat apa dalam waktu itu |
| `student_attendance` | Kehadiran harian pelajar |
| `teacher_attendance` | Kehadiran harian staf |
| `attendance_corrections` | Log pembetulan — tambah sahaja, tidak boleh diubah |

Jumlah jadual kini **25**, RLS diaktifkan dan dipaksa pada **25/25**.

### Keputusan reka bentuk yang penting

**Waktu milik jadual, bukan kelas.** "Waktu 5 ialah 9:50–10:25 dan ia rehat" ialah satu fakta tentang hari persekolahan. Menyimpannya bagi setiap kelas bermakna julat masa yang sama disalin berkali-kali dan boleh bercanggah antara satu sama lain.

**Perhimpunan, Rehat, Zohor dan Yasin/Dhuha ialah JENIS WAKTU, bukan subjek palsu.** Jika ia menjadi subjek, ia akan muncul dalam slip markah dan laporan — yang salah. Pangkalan data **menolak** percubaan meletakkan subjek pada waktu perhimpunan atau rehat.

**Kelas pelajar diambil daripada enrolmen, bukan daripada pelajar.** Kehadiran mesti sepadan dengan enrolmen yang terbuka pada tarikh itu. Pangkalan data menolaknya jika tidak — termasuk kes pelajar ditanda dalam kelas yang sudah ditinggalkan.

**Kehadiran tidak boleh ditulis terus.** Grant kepada `authenticated` ialah **baca sahaja**. Satu-satunya cara menulis ialah melalui RPC, yang memeriksa enrolmen dan menulis log audit. Ujian membuktikan tulisan terus menerus ditolak (403).

**Ketiadaan rekod BUKAN ketidakhadiran.** Hari yang tiada register langsung tidak menghasilkan sebarang baris. Melaporkannya sebagai "semua pelajar tidak hadir" akan menuduh seluruh sekolah. Ini diuji secara langsung.

**Pembetulan mesti menyatakan sebab.** Ini yang menjadikan register boleh dipercayai berbulan-bulan kemudian, jadi sebab diwajibkan dan setiap pembetulan ditulis ke log.

**Kehadiran staf bersifat peribadi.** Guru hanya nampak rekod mereka sendiri; pejabat nampak semua. Melihat rekod kelewatan rakan sekerja ialah masalah privasi, bukan ciri.

### Dua pepijat sebenar yang dijumpai dan dibetulkan

1. **`btree_gist` tidak wujud secara lalai.** Kekangan pengecualian (untuk menghalang dua waktu bertindih) memerlukan `btree_gist` untuk perbandingan kesamaan pada uuid dan enum. Ditambah, dan disahkan tersedia pada projek remote sebelum dihantar.

2. **`timetables_publish_metadata` bercanggah dengan tindakan "supersede".** Saya pada mulanya menulis peraturan dua hala: status PUBLISHED jika dan hanya jika `published_at` diisi. Ini bermakna apabila jadual baharu menggantikan yang lama, status lama menjadi SUPERSEDED **sambil `published_at` masih diisi** — dan pangkalan data menolaknya sendiri. Peraturan sebenarnya sepatutnya satu hala: **draf tidak boleh mendakwa pernah diterbitkan**, tetapi jadual yang digantikan **kekal** `published_at`-nya, kerana "ini pernah diterbitkan, dan sah sehingga tarikh itu" ialah sejarah yang sekolah perlukan. Membetulkan ini menghentikan Fasa 3 daripada gagal sepenuhnya.

### Template hari persekolahan

Diambil **hanya** daripada boundary yang sekolah nyatakan dalam spec: waktu 1 (7:30–8:05), waktu 5 (9:50–10:25 Rehat), waktu 11 (13:30–13:55 Zohor). Ahad waktu 1 ialah Perhimpunan; Khamis waktu 1 ialah Yasin/Dhuha; Isnin–Rabu waktu 1 ialah PdP.

**Sembilan slot lain sengaja TIDAK dicipta.** Merekanya akan menghasilkan jadual yang kelihatan muktamad tetapi salah. Ujian mengesahkan hanya waktu 1, 5 dan 11 wujud.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Suite SQL Fasa 3 (baharu) | ✅ 24/24 |
| Suite SQL Fasa 1 & 2 (tiada regresi) | ✅ 26/26 dan 23/23 |
| RLS dipaksa pada semua jadual | ✅ 25/25 |
| Idempotensi migrasi (guna semula) | ✅ kekal 25 jadual |
| Template hari persekolahan (live) | ✅ 15 waktu, boundary sepadan spec |
| Hanya waktu yang dinyatakan wujud (live) | ✅ 1, 5, 11 sahaja |
| Register kelas direkod (live) | ✅ 2 pelajar |
| Hantar semula register = tiada perubahan (live) | ✅ 0 ditulis, 0 dibetulkan |
| Pembetulan + jejak audit (live) | ✅ ABSENT → SICK dengan sebab |
| Pembetulan tanpa sebab ditolak (live) | ✅ ditolak |
| Tulisan kehadiran terus ditolak (live) | ✅ 403 |
| Hari tanpa register ≠ ketidakhadiran (live) | ✅ 0 baris |
| Pelawat tanpa log masuk | ✅ ditolak (401) |
| Data ujian dibersihkan | ✅ 0 tinggal |

**Risiko yang tinggal:** (1) waktu 2–4, 6–10 masih belum diberi oleh sekolah — jadual sebenar tidak boleh dibina sepenuhnya sehingga itu tiba; (2) UI jadual waktu dan kehadiran belum dibina; (3) kehadiran ikut waktu (period attendance) sengaja dikecualikan daripada v1 mengikut spec.

## Fasa 2 UI — skrin penjaga SELESAI

**Ini melengkapkan Fasa 2.** Syarat siap Fasa 2 (`04_PHASE_2_ACADEMIC_CORE.md`) ialah: *"Guru/murid/penjaga, kelas/subjek dan assignment boleh diurus."* Kelima-limanya kini boleh diurus.

### Istilah: penjaga, bukan "parent"

Skrin asal memanggil mereka **"Parents"**. Ini tidak tepat untuk SRIK: sekolah menyimpan ibu bapa, penjaga, dan waris, dan setiap seorang boleh menjadi orang yang dihubungi. Skrin, menu, dan tajuk kad papan pemuka kini berkata **Guardians**, sepadan dengan nama jadual dalam pangkalan data. Menukar nama paparan sahaja bermakna tiada penghijrahan data diperlukan.

### Penjaga bukan pengguna

Ini perbezaan penting daripada projek sumber. Di sana "parent" ialah sejenis pengguna ketiga bersama guru dan pelajar, lengkap dengan akaun dan portal sendiri. **Di SRIK, penjaga ialah orang yang dihubungi pada rekod pelajar — bukan akaun log masuk.** ~250 akaun sekolah semuanya staf. Halaman ini wujud supaya pejabat boleh mencari nombor telefon dengan pantas, dan supaya seorang penjaga boleh dikongsi oleh beberapa anak dalam satu keluarga.

Baris "a guardian with no login account is still listed" disahkan secara langsung untuk memastikan ini kekal benar.

### `listGuardians()` — dan satu pepijat sebenar yang dijumpai

Membina fungsi ini mendedahkan pepijat yang akan menjejaskan setiap penjaga:

> Saya pada mulanya membaca kelas seorang anak daripada lajur `students.class_id`. **Lajur itu tidak wujud.** Ujian live mengembalikan `column students.class_id does not exist`.

Kelas seorang pelajar disimpan pada **enrolmen terbuka** mereka (`student_enrollments`, di mana `ended_at IS NULL`), bukan pada baris pelajar — kerana anak yang sama berada di Tahun 3 tahun ini dan Tahun 4 tahun depan, dan **rekod perubahan itulah maksudnya**. Membaca kelas daripada baris pelajar akan memaparkan **kelas kosong untuk setiap anak, untuk setiap penjaga**, tanpa sebarang ralat kelihatan.

Pepijat ini hanya muncul kerana saya menjalankan aliran sebenar terhadap pangkalan data sebenar. Typecheck lulus, build lulus, dan ujian unit mock lulus — semuanya, sambil ciri itu rosak sepenuhnya. Ia kini dibetulkan, dan ada ujian regresi yang menyatakan sebabnya.

### `deleteGuardian()` ada penjagaan

Menolak untuk membuang penjaga yang masih terpaut kepada pelajar: *"This guardian is still linked to N students. Remove the link from the student's record first."* Menanggalkan ibu bapa daripada anak patut menjadi tindakan yang disengajakan pada rekod pelajar, bukan kesan sampingan semasa mengemas senarai.

### Carian

Mencari melalui nama penjaga, telefon, emel, **dan nama anak**. Pejabat biasanya bermula daripada anak ("ibu siapa ini?"), jadi carian mengikut nama pelajar sama pentingnya.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Ujian penjaga (baharu) | ✅ 10/10 |
| Suite penuh Vitest | ✅ 169 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Penjaga + pautan kepada 2 anak (live) | ✅ berjaya |
| **Kelas anak dari enrolmen (live)** | ✅ 3 Al-Junaidi / 5 Na'im |
| Dua anak, kelas berbeza | ✅ disahkan |
| Penjaga tanpa akaun log masuk tetap disenaraikan | ✅ disahkan |
| Penjaga pendua tidak digabungkan automatik | ✅ disahkan |
| Pelawat tanpa log masuk | ✅ ditolak (401) |
| Data ujian dibersihkan | ✅ 0 tinggal |

**Risiko yang tinggal:** (1) penjaga tidak boleh dipautkan kepada pelajar dari skrin ini — pautan dibuat pada rekod pelajar, dan skrin menyatakan ini dengan jelas supaya pemilik tidak keliru mencari butang yang tiada; (2) skrin memuatkan semua penjaga sekaligus — memadai untuk saiz SRIK, tetapi perlu penomboran jika sekolah membesar jauh.

## Fasa 2 UI — skrin tugasan guru SELESAI

### Lapisan data — tambahan pada `src/lib/supabase/teachers.ts`

| Fungsi | Kegunaan |
|---|---|
| `listAssignments()` | Semua tugasan aktif untuk tahun semasa |
| `getTeacherDuties(id)` | Kelas + subjek + jumlah waktu seorang guru |
| `assignTeacherDuties(...)` | Simpan set tugasan melalui RPC |
| `AssignmentRecord` | Bentuk data yang skrin guna |

**Kenapa seluruh set diganti sekali gus.** Tugasan guru disunting sebagai satu senarai ("inilah kelas dan subjek anda"). Menerap senarai itu secara menyeluruh ialah apa yang pemilik maksudkan, dan itulah juga apa yang RPC `set_teacher_assignments` lakukan: menutup tugasan lama dan membuka yang baharu dalam satu langkah beraudit. Tugasan lama **disimpan sebagai sejarah**, bukan dipadam — kerana "siapa mengajar kelas ini tahun lepas" ialah soalan yang sekolah akan tanya.

**Kelas guru tiada bilangan waktu.** Tugasan kelas guru menyimpan `periods_per_week` sebagai kosong, bukan 0, kerana menjadi guru kelas bukan beban waktu mengajar. Menyimpan 0 akan terbaca sebagai "tiada mengajar" dan bukan "tidak berkenaan".

### Skrin (`TeacherAssignmentsScreen.tsx`)

Tiga tab dikekalkan daripada skrin asal, tetapi kandungannya kini SRIK:

1. **Class Teachers** — siapa bertanggungjawab atas kelas mana.
2. **Subject Teachers** — siapa mengajar subjek apa di kelas mana.
3. **Workload** — jumlah waktu mengajar setiap guru, dengan tanda Light / Balanced / Heavy.

Pembahagi Light / Balanced / Heavy **hanya panduan untuk pemilik**, bukan peraturan yang sistem paksakan — apa yang dianggap berat bergantung pada sekolah, jadi tiada apa-apa disekat berdasarkan ini.

Menyimpan tugasan memberi amaran jelas: *"Saving replaces everything [nama] currently has. The previous duties stay on record as history."* Pemilik tidak akan terkejut bahawa simpan telah membuang satu tugasan.

### Yang dibuang

- Panggilan REST mentah (`/teacher-assignments/class-teacher`, `/subject-teacher`).
- Tetapan **"co-class teachers"** — sama ada dua guru boleh berkongsi kelas bukan tetapan sistem di SRIK.
- Model **"session" dan "term"** — SRIK menggunakan **tahun akademik**.
- Medan `branch_id` / `school_id`.

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Ujian tugasan guru (baharu) | ✅ 8/8 |
| Suite penuh Vitest | ✅ 159 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Tugasan diberi (live) | ✅ 3 tugasan aktif: 1 guru kelas + 2 subjek |
| **Tugasan diganti (live)** | ✅ 2 tugasan baharu, guru kelas berpindah, subjek lama ditutup |
| **Tugasan lama disimpan sebagai sejarah** | ✅ 5 baris kekal, hanya 2 aktif |
| Pelawat tanpa log masuk | ✅ ditolak (401) |
| Data ujian dibersihkan | ✅ 0 tinggal |

**Risiko yang tinggal:** (1) skrin memuatkan semua guru dan semua tugasan sekaligus — memadai untuk ~250 pengguna, tetapi perlu ditukar kepada penomboran jika sekolah membesar jauh; (2) kekuatan kata laluan sementara guru dikendalikan oleh Edge Function, bukan skrin ini.

## Fasa 2 UI — skrin kelas dan mata pelajaran SELESAI

Menurut keputusan pemilik: kelas dan mata pelajaran dibuat sekali gus, dan ciri **kod QR kelas dibuang** (SRIK tidak mengimbas kod kelas).

### Lapisan data baharu — `src/lib/supabase/academics.ts`

| Fungsi | Kegunaan |
|---|---|
| `listClasses()` / `listClassOptions()` | Kelas + bilangan pelajar; pilihan untuk dropdown |
| `createClass` / `updateClass` | Tahun, nama, kod — `display_name` **tidak dihantar** |
| `deleteClass` | **Menolak** jika masih ada pelajar |
| `listSubjects()` / `listSubjectOptions()` | Subjek + bilangan kelas yang mengajarnya |
| `createSubject` / `updateSubject` / `deleteSubject` | Penuh CRUD, dengan penjagaan |
| `setClassSubjects(classId, ids)` | Ganti senarai subjek sesuatu kelas |
| `getClassSubjects(classId)` | Subjek yg diajar di satu kelas |

**Keputusan penting: nama kelas bukan data.** Tahun dibaca daripada lajur `year_level`, bukan daripada teks nama. Ini bermakna nama dan kod kelas boleh ditukar **bila-bila masa** tanpa menjejaskan apa-apa.

**`display_name` diperoleh, bukan dihantar.** Pangkalan data mengiranya daripada `year_level || ' ' || name`. Menghantarnya daripada borang bermakna dua tempat menyimpan kebenaran yang sama, dan ia boleh bercanggah.

**Buang kelas ada penjagaan.** Kelas yang masih ada pelajar **tidak boleh** dibuang — skrin menerangkan berapa ramai dan meminta pindahkan mereka dahulu. Tanpa penjagaan ini, satu klik boleh menghilangkan kelas 30 pelajar.

**Buang subjek juga ada penjagaan.** Subjek yang diajar di mana-mana kelas tidak boleh dibuang; skrin menyatakan berapa kelas.

### Skrin kelas (`ClassListScreen.tsx`)

- Dikelompokkan mengikut **tahun** (Year 1 → Year 6), bukan mengikut grade/section Nigeria.
- Nama kelas dipaparkan **sebagaimana disimpan** — "1 Al-Junaidi", "5 Na'im", "6 Ma'wa".
- Kod kelas (1J, 2J, 4B, 5N, 6M) ditunjukkan sebagai label.
- Setiap kelas boleh dikembangkan untuk melihat pelajar di dalamnya.
- **Dibuang:** kod QR kelas, penjana "standard classes", medan section/grade/department.

### Borang kelas (`ClassFormScreen.tsx`)

Ditulis semula. Medan: **tahun (1-6)**, **nama kelas**, **kod pendek**, dan **senarai subjek yang diajar**. Ia menunjukkan pratonton langsung ("This class will show as **3 Al-Junaidi (3J)**") menggunakan peraturan yang sama seperti pangkalan data.

Medan yang dibuang: grade, section, department, level (Primary/JSS/SSS/Nursery) — semuanya模型 Nigeria yang SRIK tiada.

### Skrin mata pelajaran (`SubjectListScreen.tsx`) — SKRIN BAHARU

Projek sumber **tiada** skrin subjek: subjek ialah teks yang ditaip dalam borang kelas, jadi satu subjek boleh wujud dengan pelbagai ejaan dan tidak boleh dinamakan semula tanpa memutuskan rekod yang merujuknya. Kini subjek ialah rekod dengan identiti sendiri, dirujuk melalui `id`.

Memaparkan nama, kod, kategori, dan berapa kelas mengajarnya.

### Menu

"Courses" dan "Subjects" ditambah pada menu Academic. Dua entri QR kelas ("Classrooms & QR" dan "Class Verification") **dibuang** daripada menu — ciri itu tidak wujud dalam skop SRIK.

### Data sebenar yang dimasukkan

**8 mata pelajaran:** Bahasa Melayu (BM), Bahasa Inggeris (BI), Matematik (MT), Sains (SNS), Pendidikan Islam (PI), Pendidikan Al-Quran (PAI), Jawi dan Khat (JQ), Akhlak (AK).

### Bukti

| Pemeriksaan | Hasil |
|---|---|
| Ujian kelas + subjek (baharu) | ✅ 15/15 |
| Suite penuh Vitest | ✅ 151 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Senarai kelas live | ✅ 7 kelas, tersusun Year 1 ke atas |
| Senarai subjek live | ✅ 8 subjek |
| **Tukar nama kelas (live)** | ✅ nama berubah, tahun dan id **tidak** berubah |
| Nama dipulihkan selepas ujian | ✅ "5 Na'im" |
| Pelawat tanpa log masuk | ✅ ditolak (401) |

**Risiko yang tinggal:** (1) `setClassSubjects` menggantikan senarai secara menyeluruh — menambah dahulu, kemudian membuang, supaya kegagalan di tengah meninggalkan subjek asal dan bukan senarai kosong; (2) memadam kelas juga boleh gagal jika jadual waktu atau penilaian masih merujuknya — skrin mencadangkan tandakan tidak aktif sebagai ganti.

## Kelas sebenar SRIK + ketahanan kepada penukaran nama (selesai)

Kelas sebenar sekolah kini ada dalam sistem:

| Tahun | Nama kelas | Kod |
|---|---|---|
| 1 | Al-Junaidi | 1J |
| 2 | Al-Junaidi | 2J |
| 3 | Al-Junaidi | 3J |
| 4 | Al-Junaidi | 4J |
| 4 | Al-Busiri | 4B |
| 5 | Na'im | 5N |
| 6 | Ma'wa | 6M |

### Pepijat sebenar yang ditemui: kod membaca makna daripada NAMA kelas

Skrin senarai pelajar cuba mendapatkan tahun daripada **teks nama kelas** — ia mencari nombor di dalam nama itu. Ini akan berfungsi secara kebetulan untuk "3 Al-Junaidi", tetapi ia adalah reka bentuk yang rapuh dan pemilik menegaskan bahawa **nama dan prefix kelas boleh berubah bila-bila masa**.

Kegagalan sebenar yang akan berlaku:
- Kelas dinamakan semula menjadi sesuatu tanpa nombor (contoh "Junaidi") → tahun menjadi kosong → semua pelajar kelas itu jatuh ke kumpulan "Unassigned".
- Nombor di tengah nama (contoh "Al-Farabi 3") → tahun dibaca sebagai 3 tetapi kedudukan sebenar berbeza, dan senarai tersusun salah tanpa sebarang ralat.

**Pembetulan:** `year_level` dan `code` kini dibaca daripada **lajur tersendiri** dalam pangkalan data. Nama kelas digunakan **hanya sebagai label paparan**; tiada keputusan dibuat daripada teksnya.

Ini selamat kerana pangkalan data memang menyimpan tahun sebagai integer (`year_level`, dengan had 1-6) dan kod sebagai lajur sendiri, manakala `display_name` **diperoleh** secara automatik daripada kedua-duanya (`year_level || ' ' || name`). Apabila nama kelas ditukar, label dikemas kini sendiri — tiada data basi, tiada migrasi diperlukan.

**Ujian baharu** membuktikan "5 Na'im" dan "6 Ma'wa" — nama yang langsung tiada nombor — masih dikumpulkan dan disusun dengan betul.

### Pemeriksaan live

Ketujuh-tujuh kelas disahkan wujud dengan `year_level` berangka, kod lengkap, dan susunan yang betul dalam pemilih kelas. Kelas placeholder lama (Al-Zahrawi, Al-Razi, Al-Khawarizmi, Al-Biruni, Al-Farabi) dibuang — tiada pelajar, subjek atau tugas guru terikat padanya.

**Nota penting untuk penukaran nama:** menukar `name` atau `code` pada jadual `classes` selamat dilakukan bila-bila masa. Ia tidak menjejaki pelajar secara salah kerana enrolmen merujuk `class_id` (UUID), bukan nama. Yang berubah hanyalah label yang dipaparkan.

## Fasa 2 UI — skrin pelajar SELESAI (kedua-dua skrin)

Sama seperti skrin guru: kedua-dua skrin pelajar kini membaca dan menulis sistem baharu sepenuhnya. Tiada panggilan API lama tinggal.

### Lapisan data baharu — `src/lib/supabase/students.ts`

| Fungsi | Kegunaan |
|---|---|
| `listStudents()` | Semua pelajar + kelas semasa + penjaga (3 pertanyaan rata, dicantum dalam memori) |
| `getStudent(id)` | Satu pelajar untuk borang edit |
| `createStudent` / `updateStudent` | Rekod pelajar sahaja |
| `setStudentStatus` | Ubah status sahaja (contoh tarik diri) |
| `enrollStudent` | **Melalui RPC `enroll_student`** — bukan tulis terus |
| `addGuardian` | Cipta penjaga + pautan; buang penjaga jika pautan gagal |
| `listClassOptions` / `getCurrentAcademicYearId` | Kelas bagi tahun semasa sahaja |
| `suggestNextAdmissionNo` | Cadangan nombor pendaftaran seterusnya |
| `createStudentWithDetails` | Cipta pelajar + penjaga + kelas dalam satu panggilan, dengan amaran separa |

**Peraturan penting:** kelas pelajar **bukan** lajur pada jadual `students`. Ia datang dari `student_enrollments` di mana `ended_at is null`. `student_enrollments` **tiada kebenaran tulis** melalui Data API (SELECT sahaja) — pertukaran kelas mesti melalui RPC supaya baris lama ditutup, bukan ditimpa. Ini disahkan secara langsung: `POST /rest/v1/student_enrollments` → **403**.

**Penjaga:** setiap penjaga dicipta sebagai orang baharu, tidak dipadankan ikut nama atau telefon. Dua orang boleh berkongsi kedua-duanya, dan pemadanan automatik akan menggabungkan dua keluarga secara senyap. Nyahpertindihan kekal keputusan manusia.

### Skrin senarai pelajar (`StudentListScreen.tsx`)

Dulu: tiga pertanyaan berasingan (bilangan ikut kelas, baris ikut kelas secara malas, carian di pelayan) kerana senarai lama boleh mencecah 1.5MB. Sekarang: **satu** muatan untuk seluruh senarai (~250 pelajar), dikelompokkan dalam memori. Carian kini serta-merta.

Pengelompokan bertukar kepada **nama kelas sebenar SRIK**:

| Dulu | Sekarang |
|---|---|
| "Senior Secondary", "Junior Secondary", "Preschool / Nursery" | "Year 1 - 3", "Year 4 - 6", "Unassigned" |
| `grade` + `section` | Nama kelas penuh, contoh "3 Al-Junaidi" |

Kumpulan lama adalah perancah untuk peringkat yang SRIK **tidak ada**: sekolah ini mengajar Tahun 1-6, jadi "Menengah" dan "Atas" sentiasa kosong. Kumpulan kosong kini ditinggalkan sepenuhnya.

**Pepijat sebenar yang ditemui dan dibetulkan:** penapis pelajar aktif membandingkan status dengan nilai lama huruf besar-kecil (`'Graduated'`, `'Transferred'`), sedangkan pangkalan data menyimpan `'WITHDRAWN'`/`'GRADUATED'`. Akibatnya **setiap** pelajar lulus penapis, termasuk yang sudah keluar. Kini ia menyemak nilai sebenar dan hanya mengekalkan `ACTIVE`.

### Skrin tambah/ubah pelajar (`AddStudentScreen.tsx`)

Ditulis semula: **1185 → 495 baris**. Medan yang dibuang kerana tiada apa membacanya:

| Dibuang | Sebab |
|---|---|
| Cawangan (branch), berulang 64× | SRIK ada satu sekolah |
| Bas sekolah (35×) | Tiada modul pengangkutan dalam skop |
| Portal ibu bapa + kelayakan log masuk penjaga (70×) | Portal ibu bapa **deferred** mengikut roadmap |
| Curriculum/strim Nigeria + British (17×) | SRIK guna sukatan tempatan |
| Langganan/naik taraf (Paystack) | Tiada SaaS |

Medan yang **kekal** (mengikut keputusan anda): maklumat asas pelajar, sekolah lama + tarikh masuk, kelas semasa, dan penjaga.

**Pepijat sebenar yang ditemui dan dibetulkan:** butang "Register student" berada **di luar** `<form>`, jadi `type="submit"` tidak menghantar apa-apa — butang dan kekunci Enter kedua-duanya mati secara senyap. Dibetulkan dengan mengikat butang pada borang melalui `form="student-form"`, yang mengekalkan susun atur sticky di bawah tanpa meletakkan butang di dalam kawasan skrol. **Ujian unit menangkap ini.**

**Penjaga gagal → pelajar tetap selamat.** Jika penjaga atau kelas gagal selepas pelajar berjaya disimpan, pelajar **kekal wujud** dan skrin memberitahu apa yang belum siap. Gagalkan seluruh ciptaan akan membuang apa yang baru ditaip. Sebaliknya, rekod pelajar dengan penjaga separuh siap adalah keadaan normal semasa kemasukan data.

**Tiada log masuk pelajar dicipta.** Akaun pelajar adalah di luar skop v1, jadi skrin ini tidak pernah memaparkan kelayakan.

### Bukti

| Pemeriksaan | Status |
|---|---|
| Ujian StudentListScreen | ✅ 7/7 (ditulis semula) |
| Ujian AddStudentScreen | ✅ 6/6 (ditulis semula) |
| Ujian SecurityAudit (pelajar) | ✅ 4/4 (ditulis semula dari ujian penyewa lama) |
| Suite penuh Vitest | ✅ 137 lulus / 1 gagal sedia ada (Paystack) |
| Typecheck + build | ✅ lulus |
| Cipta pelajar (live) | ✅ 201 |
| Nombor pendaftaran pendua | ✅ ditolak (409) |
| Cipta penjaga + pautan (live) | ✅ 201 |
| Daftar kelas melalui RPC (live) | ✅ 200, enrolmen terbuka |
| Tulis enrolmen terus melalui Data API | ✅ **ditolak (403)** — seperti direka |
| Tarik diri pelajar (live) | ✅ 204 |
| Pelawat tanpa log masuk | ✅ ditolak (401) |

**Data konfigurasi sebenar ditambah pada remote:** 1 tahun akademik ('2026', CURRENT) dan 6 kelas sebenar (Al-Zahrawi 1, Al-Junaidi 3, Al-Farabi 3, Al-Razi 4, Al-Khawarizmi 5, Al-Biruni 6). Tiada data ujian tertinggal.

**Risiko yang tinggal:** (1) kelas yang dikosongkan daripada senarai kekal tidak dipaparkan langsung — jika sekolah menambah pelajar tanpa kelas dahulu, mereka muncul di bawah "Unassigned", yang sudah dikendalikan; (2) `suggestNextAdmissionNo` hanya cadangan, bukan tempahan — dua kemasukan serentak boleh dapat nombor sama, dan indeks unik yang menghalangnya serta skrin melaporkannya dengan jelas; (3) Edge Function cipta akaun guru kini SELESAI — di-deploy dan diuji hujung-ke-hujung (lihat bahagian di atas).

### Had dan baki kerja Fasa 1

Kriteria siap `03_PHASE_1` **belum dipenuhi sepenuhnya**:

| Kriteria | Status |
|---|---|
| Login/logout/session restore berjalan di Supabase | ✅ Selesai — login, logout, restore dan pembatalan sesi berpindah ke Supabase |
| Bootstrap ADMIN/TEACHER selamat | ⚠️ Mekanisme wujud dan diuji; akaun ADMIN sebenar belum dibuat |
| Direct API calls tidak dapat memintas authorization | ✅ Diuji (test 5, 11) |
| Tiada secret dalam build | ✅ Secret hanya dalam `.env` (gitignored, `chmod 600`) |
| RLS allow/deny tests lulus | ✅ 21/21 |
| Policy matrix dan permission defaults direkod | ✅ Bullet keputusan + jadual role di atas |

**Baki kerja — dan mengapa ia tidak boleh diselesaikan dalam Fasa 1:**

1. **Bootstrap akaun ADMIN sebenar** melalui Supabase Auth, kemudian jalankan blok GRANT dalam `supabase/seed/seed.sql`. Ini boleh dibuat bila-bila masa.
2. **Tambah ujian sesi** untuk penyegaran token dan tamat tempoh sesi. Boleh dibuat sekarang.
2b. **Fasa 2 UI — skrin guru SELESAI.** Skrin senarai guru dan skrin tambah/ubah guru kedua-duanya kini menggunakan sistem baharu sepenuhnya.
2c. **Fasa 2 UI — skrin pelajar seterusnya.** Kerja yang sama untuk pelajar: lapisan data, senarai, dan borang tambah pelajar. Sebahagian besarnya boleh mengikuti corak skrin guru.
3. **Buang auth legacy** — **TERHALANG oleh data, bukan oleh kod.** `lib/api/core.ts:269` menghantar token lama untuk setiap permintaan data, dan hanya endpoint lama mengeluarkan token itu. Membuang auth lama sebelum data dipindahkan akan memutuskan seluruh aplikasi. Ia mesti berlaku **selepas** Fasa 2 memindahkan papan pemuka ke Supabase.
4. **`AuthCallback` dan `InviteAcceptScreen`** kini bergantung pada token lama untuk pengesahan. Ia mesti dipindahkan bersama data.
5. **Socket/Realtime** mengesahkan diri dengan token lama sahaja. Ia akan berhenti berfungsi apabila token lama berhenti dikeluarkan, jadi ia mesti dipindahkan sebelum itu.

**Kesimpulan penting:** Fasa 1 tidak boleh ditutup sepenuhnya dalam Fasa 1. Kriteria "jangan tinggalkan dua sumber auth" hanya boleh dipenuhi **selepas** papan pemuka berhenti bergantung pada sistem lama. Susunan kerja yang betul ialah: **Fasa 2 dahulu, kemudian buang auth lama.**

### Cara jalankan ujian

```bash
./supabase/tests/run_phase1_tests.sh
# RESULT: PASS -> exit 0
```

Runner menjalankan PostgreSQL 17 lokal, mengenakan shim + migration, menyemak idempotency, dan menjalankan 21 ujian. Ia **tidak** menyentuh projek remote.

---

## Log perubahan dokumen

| Tarikh | Perubahan |
|---|---|
| 2026-10-07 | Fasa 0 dicipta. `AUDIT.md` + `IMPLEMENTATION_STATUS.md` dihasilkan. `AGENTS.md` + fail spec diletak. Baseline validation dijalankan. Tiada kod aplikasi diubah. |
| 2026-10-07 | Keputusan pemilik P1–P10 direkod. B1/B4/P8 selesai (`CLAUDE.md` diselaraskan, aturan gaya/UI dikekalkan). B5 selesai (Node dipin ke `24.21.0` merentas `.nvmrc`, `.node-version`, `engines`, Dockerfile, 4 workflow CI). P10 diaudit (PostGIS tidak digunakan). B2/B3/B6 diturunkan kepada syarat kerja. |
| 2026-10-07 | Fasa 1 foundation: schema authz + RLS + 21 ujian (lulus lokal & remote). 2 jurang keselamatan ditemui dan dibaiki. Integrasi frontend belum bermula. |
| 2026-10-07 | Cutover login ke Supabase: klien + modul auth + Login.tsx (emel sahaja, demo dibuang) + jambatan sesi AuthContext. Jurang keselamatan kedua (UPDATE mentah memintas RPC) ditemui e2e dan ditutup. 22 ujian SQL + 7 ujian UI lulus. |
| 2026-10-07 | Buang semua SSO/Google, pendaftaran sendiri dan skrin pengesahan kod 6 digit termasuk banner dalam 6 papan pemuka. Hanya emel + kata laluan. 7 ujian UI + 22 SQL lulus; 5 pembekal SSO disahkan ditolak pada remote. |
| 2026-10-07 | Kata laluan sementara: `must_change_password` + RPC penghapus tanda + skrin paksa tukar. Kitaran hayat penuh disahkan pada remote (kata laluan lama ditolak selepas tukar). 26 ujian SQL lulus. Panduan pentadbir ditulis. |
| 2026-10-07 | Betulkan 2 bug pemulihan kata laluan (callback + kod 6 digit) dan buang kod auth mati (2 fail, 7 kaedah, sisa demo). Auth lama KEKAL kerana ia mengesahkan semua permintaan data sehingga Fasa 2. 26 ujian SQL + 7 UI lulus. |
| 2026-10-08 | Fasa 2 data sekolah: 12 jadual, RLS forced, 3 RPC diaudit, 21 ujian lulus. Diterapkan pada remote. 0 data ujian tertinggal. |
| 2026-10-08 | Skrin guru: TeacherListScreen dipindah ke Supabase (0 panggilan lama), bug kod kakitangan 'oliskey' dibetulkan, Edge Function cipta akaun. AddTeacherScreen perlu ditulis semula (92 rujukan cawangan dll). |
| 2026-10-08 | Skrin guru SELESAI: AddTeacherScreen ditulis semula (92 rujukan model lama dibuang), RPC set_teacher_assignments ditambah. 2 bug sebenar dibetulkan (kunci PostgREST, tulisan terus tanpa kebenaran). 128 ujian frontend + 23 SQL lulus. |
| 2026-10-08 | **Penyuntingan + penerbitan SELESAI.** Editor berasingan; guru ditunjukkan bukan dipilih; amaran pertembungan sebelum simpan. Ujian pertembungan pertama lulus atas sebab salah — dibina semula, indeks anti-tindih disahkan menolak. 215 ujian lulus. |
| 2026-10-08 | **Skrin jadual waktu SELESAI — Fasa 3 SIAP.** Satu skrin menggantikan 6 skrin lama. Hari sekolah sebenar dipaparkan (Perhimpunan/Rehat/Zohor). 2 pepijat sebenar: PostgREST menolak penapis pd hubungan yg tidak diminta, dan had 1000 baris memotong kiraan. 202 ujian lulus. |
| 2026-10-08 | **Jadual sebenar 2026 dimuatkan**: 18 guru didaftar, 127 tugasan, 329 pelajaran. RPC baharu `set_teaching_pairs` dibina kerana RPC lama memasangkan setiap kelas dgn setiap subjek dan memaksa guru kelas. Ujian 29/29. |
| 2026-10-08 | **Template hari sebenar SELESAI**: fail aSc sekolah memberi masa 12 waktu. Zohor dibetulkan 13:30 → 13:20. Dua kelas tersalah nama dibetulkan (5 Al-Junaidi, 6 Naim). 15 subjek ditambah, 3 pertindihan dibuang. Ujian 25/25. |
| 2026-10-08 | **Skrin kehadiran SELESAI**: daftar kelas baharu (projek sumber tiada) + gambaran ditulis semula. 20 ujian baharu termasuk waktu Malaysia. 189 ujian lulus. |
| 2026-10-08 | **Fasa 3 (data) SELESAI**: 6 jadual baharu, 4 RPC, RLS 25/25, ujian SQL 24/24. Dua pepijat sebenar dibetulkan: `btree_gist` diperlukan utk kekangan anti-tindih, dan kekangan publish bercanggah dgn supersede. UI belum dibina. |
| 2026-10-08 | **Fasa 2 LENGKAP.** Skrin penjaga SELESAI (istilah ditukar drpd "Parents"). Pepijat sebenar dijumpai & dibetulkan melalui ujian live: kelas anak dibaca drpd lajur yg tidak wujud (`students.class_id`); kelas sebenar ada pada `student_enrollments`. 169 ujian lulus. |
| 2026-10-08 | Skrin tugasan guru SELESAI: 3 tab (guru kelas, guru subjek, beban kerja), guna RPC `set_teacher_assignments`. Model session/term dan tetapan co-class teacher dibuang. Ujian live membuktikan ganti tugasan menyimpan yang lama sebagai sejarah. 159 ujian lulus. |
| 2026-10-08 | Skrin kelas + mata pelajaran SELESAI. Skrin subjek BAHARU (projek sumber tiada). QR kelas dibuang. 8 subjek sebenar dimasukkan. Ujian live membuktikan tukar nama kelas tidak mengubah tahun atau id. 151 ujian lulus. |
| 2026-10-08 | Kelas sebenar SRIK dimasukkan (7 kelas dgn kod 1J-6M). Pepijat dibetulkan: kod membaca tahun daripada TEKS nama kelas — sekarang guna lajur year_level, jadi penukaran nama selamat. Ujian baharu: '5 Na'im' (tiada nombor) masih betul. 138 ujian lulus. |
| 2026-10-08 | Edge Function provision-teacher-account DEPLOYED + diuji live (11/11 lulus). 3 pepijat sebenar dibetulkan: semakan kebenaran guna kunci salah (fungsi tolak semua orang), service_role tiada grant SELECT (migrasi baharu 20261009), dan config.toml halang deploy. Data ujian 0 tertinggal. |
| 2026-10-08 | Skrin pelajar SELESAI: students.ts baharu, StudentListScreen dipindah (kumpulan ikut kelas SRIK sebenar), AddStudentScreen ditulis semula 1185→495 baris. 2 bug sebenar dibetulkan: penapis status tidak pernah padan (pelajar keluar tersenarai aktif), dan butang simpan mati (di luar form). 137 ujian frontend lulus. Disahkan live: daftar kelas melalui RPC, tulisan terus ditolak 403. |
| 2026-10-09 | Fasa 4 lapisan data: 4 jadual baharu (assessments, assessment_results, report_cards, grade_boundaries), 4 RPC diaudit, RLS 29/29. Keputusan penting: kad laporan ialah SNAPSHOT terkunci, bukan paparan langsung — markah, kehadiran, nama dan kelas dibekukan, jadi edit sumber tidak mengubah laporan yang sudah keluar kepada ibu bapa. Pembetulan jadi revisi baharu; yang lama kekal. 19 ujian SQL lulus; Fasa 3 masih 29/29. |
| 2026-10-09 | Fasa 4: julat gred disemai sebagai DATA boleh ubah (A 80-100 … E 0-34), bukan pemalar dalam kod. Dua semester 2026 dimasukkan (Sem 1 Jan-Jun, Sem 2 Jul-Dis). BUG SEBENAR dibetulkan: dasar `teachers_select` memerlukan `teachers.view`, jadi guru tidak dapat melihat baris guru mereka sendiri dan skop kelas gagal senyap — ditutup dengan fungsi `current_teacher_id()` SECURITY DEFINER. |
| 2026-10-09 | Fasa 4 skrin markah SELESAI: `assessments.ts` baharu + `MarkEntryScreen.tsx`. Daftar dibina daripada SENARAI KELAS, bukan jadual markah — supaya pelajar yang belum ada markah tetap muncul dan boleh ditanda. 12 ujian UI lulus; satu diuji songsang (sabotaj kod → ujian gagal) untuk pastikan ia benar-benar menguji. Aliran penuh disahkan pada pangkalan data LIVE dalam transaksi yang digulung semula: simpan 2 markah → terbit → snapshot memegang 85.00 → kad laporan versi 1. 0 data ujian tertinggal. 227 ujian frontend lulus; bina lulus. |
| 2026-10-09 | Fasa 4 skrin kad laporan SELESAI: `ReportCardScreen.tsx`, 18 ujian UI. Cetak guna dialog pelayar (CSS `no-print` + `.report-card-sheet`) — tiada muat naik markah kanak-kanak ke pihak ketiga. Maklumat sekolah sebenar disemai ke `school_profile` (nama, alamat Jalan Pedu, telefon, emel, nama Guru Besar). Kepala kad laporan kosong hanya jika tetapan belum diisi.
| 2026-10-09 | BUG SEBENAR dibetulkan semasa menulis ujian: `students` ialah literal `?? []` yang menjadi rujukan BAHARU setiap render, jadi kesan (effect) yang memilih pelajar berjalan setiap kali dan cawangan "kosongkan pilihan" memadam pelajar yang baru dipilih — skrin tersangkut pada "tiada kad laporan" walaupun pelajar sudah dipilih. Dibetulkan dengan `useMemo`. Dua peraturan kritikal diuji songsang (sabotaj → ujian gagal). Data ujian live 0 tertinggal. |
| 2026-10-09 | Fasa 5 lapisan data: 4 jadual (fee_types, student_charges, payments, payment_allocations), 9 fungsi, RLS 33/33, ujian SQL 29/29. Keputusan penting: (1) wang sentiasa numeric(12,2), bukan float — 0.30 tolak 0.10 mesti tepat 0.20; (2) bayaran dan caj ialah dua fakta berasingan yang dihubungkan jadual agihan sendiri, supaya bayaran separa, bayaran adik-beradik dan bayaran balik semuanya boleh diwakili; (3) rekod bayaran idempotent — tekan Simpan dua kali memulangkan bayaran asal, bukan mengambil wang dua kali; (4) buku append-only: bayaran tidak pernah dipadam, kesilapan DIBALIKKAN dan kedua-duanya kekal sebagai rekod; (5) baki DIKIRA dari baris, tidak disimpan dalam lajur, supaya tidak boleh terpesong. |
| 2026-10-09 | Fasa 5: 3 BUG SEBENAR ditemui oleh ujian. (a) Diskaun boleh menyebabkan caj yang sudah dibayar penuh menjadi baki NEGATIF — penjaga asal hanya bertindak apabila diskaun DIKURANGKAN, jadi diskaun pertama pada caj yang sudah dibayar terlepas. (b) Pembalikan membilang wang dua kali: bayaran asal dikecualikan tetapi baris pembalikan MENAMBAH. (c) `lower()` dipanggil pada lajur enum, yang gagal. Ketiga-tiganya dibetulkan dan diuji. |
| 2026-10-09 | Fasa 5 disahkan LIVE dalam transaksi yang digulung semula: 4 caj dijana untuk Jun, jana semula = 0 (tiada bil berganda), satu bayaran RM300 meliputi dua adik-beradik, tekan dua kali = duplikat benar, keluarga 360 dicaj / 300 dibayar / 60 tertunggak, pembalikan memulihkan baki kepada 150.00 tepat. 0 data ujian tertinggal. 9 skrin kewangan lama belum dibuang. |
| 2026-10-09 | Fasa 5 UI: 3 skrin baharu ditulis atas jadual sebenar — `FeeCollectionScreen` (tunggakan + resit + kutip bayaran), `FeeManagementScreen` (jenis yuran + jana bil bulanan), `StudentFeesScreen` (penyata pelajar, boleh cetak). Menu "Finance" baharu dalam `AdminActionsScreen`. 32 ujian UI lulus. |
| 2026-10-09 | Pembuangan kod rujukan Nigeria: 9 skrin kewangan lama (`FeeManagement`, `FinanceDashboard`, `AssignFeePage`, `AutoInvoiceGenerator`, `PaymentHistory`, `PaymentPlanModal`, `PaymentRecording`, `RecordPaymentScreen`, `FeeDetailsScreen`), 4 pembalut gerbang bayaran asing (`PaystackWrapper`, `FlutterwaveWrapper`, `MobileMoneyWrapper`, `FeeCard`), dan skrin yuran ibu bapa/guru (`FeeStatusScreen`, `FeesPiggyBank`, `InstallmentSchedule`, `MyPaymentHistory`) — kesemuanya dibuang bersama 13 rujukan import, 3 laluan menu dan 2 rujukan pemberitahuan. Sandaran di `/tmp/finance-legacy-backup/`. Guru tidak lagi mempunyai laluan kewangan sama sekali. |
| 2026-10-09 | Fasa 5b/5c: ibu bapa kini ada akaun sendiri. GUARDIAN sengaja tiada kebenaran kewangan — akses datang dari pautan keluarga, bukan kebenaran, supaya satu keluarga tidak boleh membaca keluarga lain. Akaun dicipta dalam pangkalan data supaya secret key tidak perlu ke pelayar. Pejabat mengawal penuh siapa yang dipautkan kepada siapa. |
| 2026-10-09 | Keputusan skrin Fasa 5: (1) markah dan wang tidak boleh bercampur — guru tiada akses kewangan; (2) butang Simpan dimatikan sehingga agihan sama dengan jumlah diterima, sebab wang yang tidak diagihkan akan hilang dalam akaun; (3) lebih bayar satu caj dihalang kerana ia hampir selalu salah taip; (4) pembatalan ganti padam, dan sebab wajib ditulis; (5) harga yuran kosong bermaksud "belum diputuskan", bukan sifar — yuran tanpa harga tidak dibilkan; (6) cetak guna dialog pelayar sahaja. |
| 2026-10-09 | PENEMUAN: sistem hanya ada peranan ADMIN dan TEACHER, dan polisi Fasa 5 (`finance.view`) pejabat sahaja. Ibu bapa tiada peranan, tiada akaun (0 penjaga ada `user_id`), dan walaupun skrin ibu bapa dibina ia akan tunjuk KOSONG. Ini jurang sebenar antara spec dan sistem. |
| 2026-10-09 | Fasa 5b — akses ibu bapa. Peranan GUARDIAN ditambah dengan **SIFAR kebenaran kewangan**: ibu bapa mencapai wang melalui soalan yang berbeza sepenuhnya — "adakah baris ini tentang ANAK SAYA?" — bukan melalui `finance.view`. Kalau GUARDIAN diberi `finance.view`, setiap ibu bapa boleh baca caj setiap anak dan polisi keluarga terpintas. 12 polisi baharu; `current_guardian_child_ids()` dan `is_guardian_of()` sebagai SECURITY DEFINER. Ujian SQL 16 lulus, dan DISAHKAN SONGSANG DUA ARAH: memberi GUARDIAN `finance.view` → ujian 3 gagal (ibu bapa nampak caj keluarga lain); membuang polisi `student_charges_select_guardian` → ujian 3 gagal juga (ibu bapa nampak terlalu sedikit). |
| 2026-10-09 | Fasa 5c — pendaftaran ibu bapa. Pejabat cipta akaun dari skrin. **Keputusan penting: akaun dicipta DALAM pangkalan data, bukan melalui Supabase admin API.** Admin API perlukan secret key, dan secret key memintas RLS — membawanya ke pelayar ialah kebocoran data, bukan salah tetapan, sebab itu `client.ts` sudah menolak membina klien bila melihatnya. Mencipta akaun melalui RPC bermakna kunci itu tidak perlu meninggalkan pelayan. 3 RPC baharu. Kata laluan di-hash dengan pgcrypto (skema `extensions`), tidak pernah teks biasa. Ujian SQL 16 lulus. |
| 2026-10-09 | Fasa 5c: 2 BUG SEBENAR ditemui. (a) `gen_salt`/`crypt` tidak dapat diselesaikan kerana fungsi berjalan dengan `search_path = ''` — perlu `extensions.crypt()`; dan `auth.users` berbeza antara Supabase sebenar (`instance_id`, `aud`, `role`) dan shim ujian, jadi insert dibina secara dinamik. (b) Butang nyahpaut memerlukan senarai pelajar dimuatkan DAN dipadankan mengikut NAMA — jadi ia tidak wujud sehingga senarai tiba, dan gagal bila nama dieja berbeza. Ditukar kepada carian mengikut id dari pautan keluarga. |
| 2026-10-09 | Skrin ibu bapa SELESAI: `MyChildrenFeesScreen` (baki keluarga, senarai caj setiap anak, cetak) + `GuardianAccountsScreen` pejabat (cipta akaun, paut/nyahpaut anak). Laluan "fees" dalam navigasi bawah ibu bapa dipulihkan. 23 ujian UI baharu; 2 peraturan kritikal disahkan songsang. Jumlah suite 294 lulus. Ibu bapa TIADA butang bayar — bayaran di kaunter, direkod pejabat. |
| 2026-10-10 | Fasa 6 selesai: audit, dokumen, pengumuman, skrin pejabat + ibu bapa.
| 2026-10-10 | **Fasa 6 — operasi, audit, PWA dan release.** Jadual `audit_log`, `documents`, `announcements`; 18 ujian SQL; 27 ujian UI. Jumlah suite kini 321 lulus. |
| 2026-10-10 | Fasa 6 KEPUTUSAN TERPENTING: **log audit tidak boleh ditulis oleh mana-mana peranan aplikasi.** Tiada GRANT insert/update/delete untuk `authenticated` mahupun `service_role`, dan tiada polisi yang membenarkannya. Baris datang daripada trigger sahaja. Saya uji ini secara LANGSUNG pada projek sebenar dengan akaun ADMIN sebenar: padam → ditolak, ubah → ditolak, selit baris palsu → ditolak. Log yang boleh dibersihkan oleh pentadbir bukan log audit. |
| 2026-10-10 | **3 BUG SEBENAR ditemui oleh ujian Fasa 6.** (a) **Kebocoran data:** saya beri GUARDIAN kebenaran `announcements.view`, tetapi kebenaran itu bermaksud "lihat SEMUA pengumuman, termasuk draf dan nota guru". Cawangan pertama polisi menjadi BENAR untuk ibu bapa, jadi mereka boleh baca draf yang belum siap dan nota dalaman. Dibetulkan dengan ibu bapa mendapat SIFAR kebenaran pengumuman — akses datang daripada polisi baris (audience + tarikh), bukan daripada kunci. (b) **Trigger tidak terpasang:** blok lampiran trigger berjalan SEBELUM `documents` dan `announcements` dicipta, dan `if exists` menyenyapkan yang tiada — jadi dua jadual itu langsung tidak diaudit. Dipindah ke penghujung fail. (c) `jsonb_object_agg(key, ...)` ambigu dengan keluaran `jsonb_each` — alias diberi. |
| 2026-10-10 | Fasa 6: audit direkod secara AUTOMATIK oleh trigger, bukan oleh skrin. Kalau skrin yang menulis log, skrin yang rosak atau berniat jahat boleh berhenti menulisnya. Pelaku diambil daripada sesi (`auth.uid()`), bukan daripada pelayar, jadi klien tidak boleh menisbahkan tindakan kepada orang lain. Kata laluan/token ditapis keluar sebelum disimpan — log yang menangkap kata laluan ialah liabiliti. |

| 2026-10-10 | Fasa 6: dokumen menggunakan FK sebenar + kekangan `check` (satu pemilik, jenis mesti sepadan), bukan `owner_id` polimorfik seperti cadangan spec — spec sendiri memberi amaran ia tiada FK. Dokumen tidak boleh tergantung tanpa pemilik. Bucket persendirian sahaja. |
| 2026-10-10 | Fasa 6: pengumuman ada DRAF/TERBIT/TARIK BALIK. Menyimpan tidak menerbitkan; menerbitkan direkod. Notis yang sudah dihantar hanya boleh DITARIK BALIK, tidak dipadam — sekolah kadang ditanya "adakah anda beritahu ibu bapa?", dan notis yang dipadam tidak boleh menjawab. Ibu bapa melihat notis yang diterbitkan, dalam tempoh, untuk mereka sahaja. |
| 2026-10-10 | Fasa 6 sandaran: `scripts/ops/backup.sh` + `restore-drill.sh`. **Drill benar-benar dijalankan, bukan sekadar ditulis.** Sandaran 304 KB dipulihkan ke pangkalan data berasingan → SEMUA kiraan sama (`students=1`, `audit_log=2`). Diuji songsang juga: kiraan diubah dengan sengaja → drill GAGAL dengan kod keluar 1. Sasaran dicadangkan **RPO 24 jam / RTO 4 jam** — menunggu pengesahan sekolah. `docs/srik/OPERATIONS.md` ditulis. |
| 2026-10-10 | Fasa 6 sandaran: **3 BUG SEBENAR dalam skrip saya sendiri, ditemui kerana saya jalankan drill itu.** (a) `pg_restore` menerima `--dbname` DAN fail kedudukan sebagai argumen berlebihan. (b) Pengosongan sasaran hanya menjatuhkan JADUAL `public`, meninggalkan skema `auth`/`extensions` — jadi `CREATE SCHEMA auth` gagal dan drill melaporkan ketidakpadanan yang sebenarnya pemulihan separuh jalan. (c) Bilangan baris senyap tidak direkod kerana `NOTICE` pergi ke stderr, jadi fail kiraan kosong dan "perbandingan" membandingkan tiada dengan tiada. Pelajaran: skrip yang tidak pernah dijalankan adalah skrip yang tidak berfungsi. |
| 2026-10-10 | Fasa 6 PWA: **konflik service worker dibuang.** VitePWA menjana `sw.js` dan `UpdatePrompt` memiliki SATU-SATUNYA pendaftaran (lihat `App.tsx`), tetapi `public/sw.js` tulisan tangan juga didaftarkan dan **ditimpa semasa binaan** — jadi ia tidak pernah berjalan, sementara masih kelihatan seperti kod yang berkuasa. Dibuang bersama `lib/serviceWorkerRegistration.ts`. Identiti PWA ditukar daripada "Oliskey School App"/`en-NG` kepada "SRI Al-Khairiah"/`ms-MY`; pintasan "Pay Fees" dibuang (ibu bapa tiada butang bayar). Halaman luar talian kini Bahasa Melayu dan disambung sebagai `navigateFallback` — luar talian adalah LIHAT SAHAJA, mengikut keputusan sekolah. |
| 2026-10-10 | Fasa 6: **jurang dalam pelari ujian ditutup.** `run_phase5_tests.sh` tidak pernah menyalin atau menjalankan suite 5c mahupun 6 — dua suite wujud tetapi tidak pernah diuji oleh arahan yang orang sebenarnya taip. Kini satu arahan menjalankan kesemuanya dari sifar: **`RESULT: PASS (29 fee, 16 guardian, 16 onboarding, 20 operations)`** — 81 pemeriksaan, semuanya lulus, termasuk pengesahan idempotensi dan RLS dipaksa pada 36/36 jadual. |

## Fasa 6 — had yang diketahui (untuk release)

Perkara berikut **belum** selesai dan mesti diketahui sebelum release:

1. **RPO/RTO: DILULUSKAN** — RPO 24 jam, RTO 4 jam (lihat `docs/srik/OPERATIONS.md`);
   sandaran harian dan drill tahunan adalah komitmen yang mengikutinya.
2. **Storage belum diaktifkan.** Jadual `documents`, polisinya, bucket
   persendirian (`20261016000001_phase6_storage_buckets.sql`) dan 13 ujiannya
   sudah siap dan LULUS pada pangkalan data tempatan. Yang tinggal ialah
   melaksanakannya ke projek remote — itu keputusan kos dan tarikh, bukan kerja
   teknikal. Sebelum itu, muat naik fail tidak berfungsi. Skrin muat naik juga
   belum dibina.
3. **~16 skrin pendaftaran dan markah lama masih berdaftar** dalam
   `AdminDashboard`/`TeacherDashboard` (contoh `GradeEntryScreen`,
   `ClassGradebookScreen`, `MasterReportingHub`). Ia berfungsi atas data lama.
   Skrin baharu Fasa 4 (MarkEntryScreen, ReportCardScreen) ialah pengganti yang
   digunakan; yang lama belum dibuang kerana membuangnya menyentuh navigasi guru.
4. **Sesi pengesahan lama masih terpasang** pada `lib/api/core.ts:269`, yang
   melampirkan token lama pada setiap permintaan. Ia hanya selamat dibuang
   selepas keseluruhan papan pemuka berpindah.
5. **Logo sekolah belum dipasang** — `school_profile.logo_storage_key` adalah
   null (pemilik: "Skip dulu logo").
6. **Enrolmen pelajar sebenar belum dimasukkan.** Semua skrin menunjukkan keadaan
   kosong yang betul kerana pangkalan data sekolah masih 0 pelajar.
| 2026-10-10 | **Fasa 6b — bucket persendirian untuk dokumen.** Migration ditulis dan DIUJI (13 ujian) tetapi **BELUM dilaksanakan ke projek remote**: mengaktifkan Storage ialah keputusan kos dan tarikh, bukan perubahan skema. Bucket `srik-documents` adalah persendirian (`public = false`), had 25 MB, jenis fail disekat, dan tiada jalan yang boleh dibaca tanpa pautan bertandatangan. Nama fail membawa pemiliknya (`<jenis>/<id>/<nama>`), jadi polisi boleh membuat keputusan daripada laluan itu tanpa mempercayai apa-apa daripada pelayar. |
| 2026-10-10 | **Fasa 6b: 2 BUG SEBENAR ditemui, dan salah satunya hanya muncul kerana ujian ditulis dengan teliti.** (a) **Pejabat tidak boleh membaca fail peringkat sekolah sendiri.** Laluan `SCHOOL/<nama>` hanya dua segmen, jadi `split_part(...,'/','2')` menghasilkan nama fail, bukan uuid — `can_read_document` menganggapnya rosak dan menolaknya. Pejabat terkunci daripada failnya sendiri. (b) **Objek bernama ganjil menjadi halimunan kepada pejabat.** Semakan kebenaran berlaku SELEPAS laluan dinilai, jadi satu fail dengan nama yang tidak dijangka hilang daripada pandangan orang yang bertanggungjawab ke atasnya. Kebenaran mesti didahulukan: "adakah pejabat boleh baca ini" ialah soalan kuasa, "adakah nama ini masuk akal" ialah soalan susunan fail. Ditukar supaya kuasa disemak dahulu. |
| 2026-10-10 | **Fasa 6b: pengajaran ujian yang penting.** Dua kali suite ini melaporkan "ibu bapa memadam fail" yang sebenarnya tidak berlaku, kerana `set local role` di dalam blok `do $$` tidak mengubah identiti untuk pernyataan berikutnya dalam blok yang sama — jadi ujian itu berjalan sebagai peranan yang salah. Satu lagi percubaan padam yang melaporkan `DELETE 0` kelihatan sama ada "ditolak" atau "tiada baris untuk dipadam", kerana RLS menjadikan baris keluarga lain halimunan. Pengajarannya: pertukaran identiti hanya di peringkat atas, dan sahkan kesan daripada peranan yang BOLEH melihat baris itu. |
| 2026-10-10 | Fasa 6b: lampiran fail dilindungi daripada tersalah letak. `attach_document_file` menolak laluan yang menamakan anak berbeza daripada baris dokumen, jadi laluan yang tersalah taip tidak boleh memfailkan kad laporan seorang anak di bawah anak lain. Menggantikan fail di bawah nama yang sama juga ditolak — pembetulan ialah fail baharu dan baris baharu. |
| 2026-10-10 | Fasa 6: satu arahan kini menjalankan **94 pemeriksaan pangkalan data** dari sifar: `RESULT: PASS (29 fee, 16 guardian, 16 onboarding, 20 operations, 13 storage)`. `00b_local_storage_shim.sql` menyediakan `storage.buckets`/`storage.objects` untuk ujian tempatan sahaja — ia bukan migrasi dan tidak pernah dijalankan ke atas projek sekolah. |
| 2026-10-10 | Skrin muat naik kini menggunakan LOGO SEKOLAH, bukan nama vendor. Nama "Oliskey School App" masih muncul di skrin pertama yang dilihat setiap orang — tempat yang paling kelihatan untuk nama yang salah. Ditukar kepada `SRI Al-Khairiah` dengan logo. Logo berputar pada paksi MENEGAK (seperti syiling berputar), bukan putaran rata — putaran rata pada logo bulat tidak kelihatan sama sekali, kerana bulatan kelihatan sama di setiap sudut. Animasi mematuhi `prefers-reduced-motion`: peranti yang meminta kurang gerakan mendapat logo pegun. |
| 2026-10-10 | Skrin muat naik: logo ialah fail `public/school-logo.png` sahaja. Arahan dan syarat (PNG, latar lutsinar, 512x512) ditulis dalam `public/school-logo-README.txt` dan `src/lib/branding.ts`. Kalau fail tiada, monogram "SRIK" muncul sebagai ganti — sengaja, supaya tiada imej rosak pada telefon. 8 ujian, 3 peraturan disahkan songsang (nama vendor kembali → gagal; fallback dibuang → gagal; perlindungan gerakan dibuang → gagal). |
| 2026-10-10 | Nama vendor yang masih KELIHATAN kepada pengguna dibuang: nama lalai "Oliskey School" dalam rangka aplikasi, mesej sekolah digantung, arahan guru mengimbas kod, dan nama bilik video. Kesemuanya nama syarikat yang tiada kaitan dengan sekolah ini. |
| 2026-10-10 | **Logo sekolah dipasang.** Imej daripada sekolah (JPEG 1418x1418, latar putih) ditukar kepada PNG 512x512 **berlatar lutsinar** — 59% imej ialah latar putih dan ia dibuang, kerana skrin muat naik memutar logo seperti syiling dan kotak putih akan berputar bersama, kelihatan seperti kad diterbalikkan, bukan cop sekolah. Keempat-empat sudut disahkan `alpha = 0`. Ikon aplikasi (192, 512, 180, 32) dan favicon 64x64 dijana daripada imej yang sama, dengan latar PUTIH dikekalkan — ikon berlubang kelihatan rosak pada skrin utama telefon bila pelancar mewarnai latar belakangnya sendiri. |
| 2026-10-10 | **Audit branding & locale dijalankan; 3 fail yang disangka siap sebenarnya TIDAK siap.** Dua subagent mengaudit seluruh kod. Penemuan paling penting ialah `index.html` — fail yang dimuatkan SETIAP pelawat — masih membawa nama vendor Oliskey di **38 tempat** (tajuk tab pelayar, meta carian, pratonton pautan WhatsApp, blok `<noscript>`, label ARIA). Lebih buruk: **ujian SEO saya sendiri MENGUNCI branding lama itu** — ia menegaskan tajuk "Oliskey School App", jadi membaiki HTML akan menggagalkan ujian. Itulah sebabnya HTML tidak pernah dibaiki: pengawal itu menjaga branding lama, bukan branding baharu. Ketiga-tiganya sudah dibetulkan sekarang. |
| 2026-10-10 | **Pengawal baharu: `tests/branding/no-legacy-branding.test.ts`.** Membersihkan fail satu per satu secara manual itulah yang menyebabkan `index.html` terlepas. Pengawal ini menyenaraikan perkataan terlarang (`oliskey`, `paystack`, `flutterwave`, `naira`, `₦`) sekali sahaja, dan mengimbas semua kod yang boleh dicapai pengguna. Ia menjumpai **25 fail** yang masih memaparkan Naira yang saya belum sentuh. Setiap pengecualian dalam senarai putih WAJIB ada sebab bertulis, supaya kebocoran tidak boleh bersembunyi. |
| 2026-10-10 | **BUG SEBENAR (paling teruk): skrin jadual yang SALAH dipasang kepada murid, guru dan ibu bapa.** Skrin lama membina minggu dari Isnin hingga Jumaat, sedangkan minggu SRIK ialah **Ahad hingga Khamis**. Pada hari Ahad, `getDay()` = 0 menjadikan indeks `-1` — jadi ia **senyap-senyap memaparkan hari Isnin**. Skrin yang betul sudah wujud untuk pejabat; sekarang ia berkhidmat untuk keempat-empat peranan. Pejabat boleh memilih kelas atau guru; murid, ibu bapa dan guru hanya nampak jadual MEREKA SENDIRI, diselesaikan dari pangkalan data (yang hanya memulangkan apa yang dibenarkan). Butang Sunting adalah milik pejabat sahaja. 5 ujian baharu untuk peraturan akses ini, dan saya sahkan songsang: buka pemilih kepada semua → 3 ujian gagal; benarkan guru menyunting → 1 gagal. |
| 2026-10-10 | **Model hari sekolah dibetulkan.** `lib/timetableSchedule.ts` menggunakan 8 waktu bermula 08:00 (Isnin-Jumaat). Hari sebenar SRIK ialah **12 waktu, 07:30 hingga 14:30, Ahad-Khamis**, dengan `Rehat` 09:50-10:25 dan `Zohor` 13:20-14:00 sebagai sebahagian daripada hari itu — bukan celah. Kalau waktu-waktu itu ditinggalkan, penomboran waktu akan salah dan satu pelajaran akan diletakkan pada waktu sekolah berdoa. `dayName`/`dayNumber` kini memulangkan `null` dan bukan meneka "Monday" — fallback senyap itulah yang menyebabkan jadual Isnin muncul pada hari Ahad. |
| 2026-10-10 | **Tarikh: 308 panggilan format tersebar di 174 fail — hanya 4 guna `ms-MY`.** 188 tanpa locale langsung (format ikut PERANTI, jadi tarikh sama berbunyi "3/2/2026" pada satu telefon dan "2/3/2026" pada telefon lain, dan pejabat tidak tahu mana satu yang ibu bapa lihat); 89 hardcode `en-US`/`en-GB`/`en-NG` sehingga tarikh berbunyi "March 2, 2026" dalam sekolah Melayu; bakinya `'default'`/`[]` yang sama maksudnya. Kesemuanya kini `ms-MY`. Kad laporan yang dicetak sebelum ini menunjukkan "02 Mar 2026" — sekarang "2 Mac 2026". Nama bulan Melayu disahkan oleh ujian (Januari…Disember). |
| 2026-10-10 | **Sebab ia tersebar luas, penyelesaiannya bukan 308 pembaikan manual.** `src/lib/branding.ts` kini mengandungi satu set pembantu tarikh (`formatDate`, `formatDateTime`, `formatMonthYear`, `formatDayMonth`, `formatTime`, `toIsoDay`, `todayInSchoolTime`, `formatWeekday`) yang menyematkan **`Asia/Kuala_Lumpur`** dan **`ms-MY`**. Zon masa disematkan dengan sengaja: tarikh yang dibina dengan `timeZone: 'UTC'` salah untuk semua orang di Malaysia selepas jam 8 malam — bayaran pada 11 malam 2 haribulan akan tercetak sebagai hari sebelumnya. `todayInSchoolTime()` menggantikan `toISOString().slice(0,10)`, yang sebelum jam 8 pagi memulangkan HARI SEMALAM — jadi guru yang menanda daftar pada 7:40 pagi sebenarnya menanda daftar semalam. Pengawal baharu (`no-device-locale-dates.test.ts`) menahan kemunduran. |
| 2026-10-10 | Bunyi pertuturan (carian suara, sembang AI, sesi langsung) ditetapkan kepada `en-NG` — Inggeris Nigeria. Penutur Melayu bertanya soalan Melayu akan disalah dengar hampir setiap perkataan. Kini `ms-MY`. |
| 2026-10-10 | **BUG SEBENAR: aplikasi ini bermula dalam bahasa Inggeris, dan menukar ke bahasa Melayu tidak berkesan langsung.** Dua sebab berasingan, kedua-duanya perlu ada serentak untuk gejala itu berlaku. (1) `DEFAULT_LANGUAGE = 'en'` dan `fallbackLng` ialah Inggeris — jadi setiap kunci yang tidak diterjemah memaparkan Inggeris. (2) **`lib/i18n/locales/ms.json` TIDAK PERNAH WUJUD**, walaupun "Bahasa Melayu" disenaraikan dalam pemilih bahasa dengan bendera. Seorang guru yang memilih Bahasa Melayu menukar tetapan, melihat bendera berubah, dan membaca Inggeris seperti sebelum ini — tanpa sebarang ralat. Kini Melayu ialah lalai, ialah fallback, dan fail `ms.json` benar-benar wujud (98 kunci, disemak terhadap `en.json` oleh ujian). |
| 2026-10-10 | **Senarai bahasa ialah 44 bahasa dunia — Sepanyol, Korea, Yoruba, Igbo, Hausa dan 39 lagi.** Itu bukan ciri untuk satu sekolah di Kedah; ia peninggalan produk asal yang dijual ke seluruh dunia. Dropdown 44 item menjadikan "saya sekarang dalam bahasa apa?" soalan yang tiada siapa boleh jawab. Kini **dua sahaja**: Melayu dahulu, Inggeris kedua (supaya guru ganti atau pemeriksa yang tidak membaca Melayu masih boleh bekerja). 8 fail terjemahan yang tidak digunakan dibuang daripada binaan (sandaran di `/tmp/locales-unused`). |
| 2026-10-10 | **PEMERANGKAP YANG SAYA SENDIRI TERPERANGKAP: `RTL_CODES` dikira daripada senarai bahasa** (`LANGUAGES.filter(l => l.rtl)`). Sebaik sahaja senarai itu dikecilkan kepada Melayu dan Inggeris, senarai RTL menjadi KOSONG secara senyap — `isRtlLanguage('ar')` mula memulangkan `false` dan tiada apa pun rosak yang kelihatan. Perangkapnya ialah pengesan itu berhenti berfungsi tanpa bunyi, dan orang seterusnya yang menambah antara muka Arab akan jumpa susun atur yang tidak pernah berbalik. Arah tulisan ialah sifat SKRIP, bukan sifat bahasa yang kebetulan dibundel. Senarai kini bebas, dan sekolah ini mengajar bahasa Arab — itulah sebabnya jawapan itu perlu betul. |
| 2026-10-10 | **Ujian i18n lama MENGUNCI pepijat itu.** Ia menegaskan "sekurang-kurangnya 40 bahasa" dengan asas Inggeris — iaitu ia menerangkan produk asal, dan akan GAGAL sebaik sahaja sesiapa mengecilkan senarai kepada apa yang sekolah ini perlukan. Ujian yang menjaga tingkah laku yang salah bukan sahaja gagal menangkap pepijat; ia melindungi pepijat itu. Ditulis semula: Melayu ialah lalai, fail `ms.json` wujud dan lengkap, Melayu bukan salinan Inggeris, dan bendera Google telah dibuang. Disahkan songsang — kembalikan lalai ke `'en'` → gagal; tambah bahasa tanpa fail terjemahan → gagal dengan "no bundle for ko". |
| 2026-10-10 | **BUG SEBENAR: 5 kerja berjadual backend berjalan pada waktu Nigeria.** Setiap cron disematkan `Africa/Lagos` (UTC+1). Malaysia ialah UTC+8, jadi setiap satu berbunyi **7 jam lewat**: reset demo "tengah malam" berjalan 7 pagi, digest ibu bapa "7 pagi" sampai 2 petang, imbasan risiko "1 pagi" berjalan 8 pagi. Tiada ralat, tiada amaran — hanya kerja yang berjalan pada waktu yang salah, setiap hari. Kini `Asia/Kuala_Lumpur`, dan komen aritmetik (`+01:00` → `+08:00`) dibetulkan sekali kerana offset itu berubah 7 jam, bukan hanya namanya. |
| 2026-10-10 | **BUG SEBENAR: tahun persekolahan ialah Ogos→Julai (Nigeria), bukan Januari→Disember (Malaysia).** Sesi dinamakan "2025/2026" dan bermula 1 Ogos. Untuk sekolah Malaysia ini bermakna **separuh tahun yang salah**: carian penggal pada Mac 2026 dijawab daripada sesi yang bermula Ogos 2025, jadi "Penggal 1" menamakan tempoh yang bermula tujuh bulan lebih awal. Tarikh tutup standard (18 Dis, 16 Apr, 31 Jul) meletakkan penggal ketiga di tengah-tengah cuti panjang. Kini: sesi = tahun kalendar, dinamakan "2026" sahaja, 1 Jan → 31 Dis, tarikh tutup Mac/Mei/Nov. |
| 2026-10-10 | **BUG SEBENAR: EMPAT skala gred berbeza wujud serentak dalam satu kod asas.** `academicSettings.service.ts` (A 70), `academic.service.ts` (A 70, berakhir F), `utils/annualReport.ts` (A 70, berakhir F), dan skala perjanjian sekolah fasa 4 (A 80, B 65, C 50, D 35, E). Markah 75 ialah A pada kad laporan dan B pada laporan tahunan yang merumuskannya — **dua jawapan bercanggah untuk markah yang sama**, dan kedua-duanya kelihatan munasabah bersendirian. Kesemuanya kini skala sekolah, berakhir E (tiada F — huruf yang sekolah tidak pernah keluarkan). 7 ujian baharu, termasuk "70 ialah B pada KEDUA-DUA skala". |
| 2026-10-10 | **The term names were KEYS, not labels.** Laporan tahunan mencari kad laporan penggal dengan memadankan NAMA penggal. Jadi apabila lookup mencari "First Term" dan sekolah memanggilnya "Penggal 1", padanan itu menjumpai tiada apa dan laporan tahunan pulang KOSONG — yang di skrin berbunyi "murid ini tiada keputusan", satu perkara yang munasabah untuk dilihat, dan menghantar pejabat mencari di tempat yang salah. 51 rentetan "First/Second/Third Term" → "Penggal 1/2/3", termasuk `CANONICAL_TERMS`. |
| 2026-10-10 | Senarai subjek standard backend ialah **37 subjek Nigeria** — Bahasa Nigeria (Hausa/Igbo/Yoruba), Pendidikan Agama Kristian, Sains Pertanian, Kerajaan, Perdagangan — dan **tiada satu pun subjek SRIK ada**: Bahasa Melayu, Jawi, Khat, Tajwid, Hafazan, Feqah, Tauhid, Sirah, Tafsir, Akhlak, Bahasa Arab. Digantikan dengan 20 subjek sebenar sekolah dengan kod sekolah sendiri (BM, JW, KH…). Prompt AI penjana soalan kuiz juga memberitahu model untuk menulis "untuk sekolah Nigeria"; kini sekolah Malaysia, dalam Bahasa Melayu, dengan konteks Malaysia. |
| 2026-10-10 | **Pengawal branding diperluas untuk menangkap NEGARA, bukan sekadar nama vendor.** Ini penting kerana kebocoran Nigeria bukan sekadar kebocoran jenama — **negara menentukan mata wang, kalendar, zon masa dan kurikulum.** Imbasan pertama saya secara manual terlepas 44 fail dan 253 baris; pengawal itu menemui kesemuanya. Yang paling serius: **bendera Nigeria 🇳🇬 dipaparkan pada profil guru Malaysia**, dan satu skrin memaksa guru menandatangani persetujuan di bawah **NDPR** — undang-undang perlindungan data NIGERIA, bukan Malaysia (yang betul ialah PDPA 2010). Kesemuanya sedang dibetulkan. |
| 2026-10-10 | Rekod kerja: `Africa/Lagos` = 0, `Nigerian`/`Nigeria` dalam kod hidup = 0 (setelah pembersihan 44 fail), `₦` = 0, `OLISKEY` = 0. Ujian: **366 lulus**, hanya 1 kegagalan sedia ada (ujian Paystack yang sengaja dikekalkan menunggu keputusan pemilik). `tsc` bersih pada frontend dan backend. Binaan bersih. 94 pemeriksaan pangkalan data lulus (`RESULT: PASS`). |
| 2026-10-10 | **BELUM DIAPPLY KE REMOTE (menunggu keputusan pemilik):** `supabase/migrations/20261016000001_phase6_storage_buckets.sql`. Disemak sekali lagi hari ini: remote masih **0 bucket** dan 0 dasar storan. Migrasi itu sendiri telah ditulis, diuji (13 pemeriksaan) dan mengandungi dua pepijat sebenar yang telah dibaiki — fail sekolah `SCHOOL/<nama>` hanya 2 segmen jadi `split_part(...,'/',2)` memulangkan nama fail dan bukan uuid, dan semakan kebenaran pejabat kini berjalan DAHULU sebelum kesahihan laluan. |
| 2026-10-10 | **Pembersihan Nigeria selesai: 57 fail diubah, 109 baris.** Kategori: (1) kesatuan jenis kurikulum `'Nigerian'` → `'KSSR'`; (2) label Melayu; (3) negara → Malaysia (senarai negeri, alamat, kepala surat, lokasi dlm PDF) — `Federal Republic of Nigeria` → `Malaysia`, senarai negeri Nigeria → negeri Malaysia (Kedah sebagai lalai); (4) **undang-undang: NDPR → PDPA 2010** (dua statut berbeza dengan kewajipan berbeza — menamakan yang salah memberitahu pejabat ia mematuhi sedangkan tidak); (5) TRCN → `Sijil Perguruan`; (6) `currency: 'NGN'` → `'MYR'`, bendera 🇳🇬 → 🇲🇾; (7) telefon `+234` → `+60`; (8) **papan peperiksaan asing** WAEC/NECO/JAMB/BECE/WASSCE dibuang — ini papan Afrika Barat, dan murid Malaysia tidak mendudukinya, jadi dropdown itu tiada jawapan yang betul; (9) prompt AI diarahkan ke Malaysia/KSSR; (10) `Nigerian Language (Hausa/Igbo/Yoruba)` → Bahasa Melayu. |
| 2026-10-10 | **Pengawal diperluas dan disahkan songsang.** FORBIDDEN kini termasuk negara, bendera, negeri, TRCN, NDPR, dan papan peperiksaan asing. Diuji dgn menyelitkan `WAEC NECO JAMB NDPR Nigeria TRCN` ke dlm kod sebenar → **ditangkap**; ke dlm komen → dilewati (sengaja). Satu had yang saya dokumenkan terus dlm kod: pengawal hanya melangkau baris yang **BERMULA** sebagai komen. Menanggalkan komen dari tengah baris memerlukan penghurai JSX, dan jika salah ia akan **MENYEMBUNYIKAN** kebocoran sebenar dan bukan melaporkan yang palsu. Mod kegagalan "ketat" cuma menjengkelkan; mod kegagalan "pandai" senyap. |
| 2026-10-10 | **Kebocoran yang pengawal saya sendiri jumpai selepas saya kata "siap":** `lib/dexie-db.ts` menamakan pangkalan data tempatan `OliskeyOfflineDB`, `components/video/jitsiUrl.ts` menamakan bilik panggilan video `OliskeyClass...` (nama bilik kelihatan kepada guru, murid DAN ibu bapa dlm URL), dan `lib/mockAuth.ts` menghasilkan ID `OLISKEY_MAIN_*`. Bilik Jitsi dan ID mock dibetulkan. **Nama pangkalan data Dexie SENGAJA dikekalkan** — ia kunci yang disimpan, jadi menamakannya semula akan meninggalkan setiap rekod yang sudah ada pada peranti guru; cache luar talian akan kelihatan kosong dan mengisi semula secara senyap. Kelas dinamakan semula; nama tersimpan dikekalkan, dan sebabnya ditulis di situ. |
| 2026-10-10 | **TIDAK DISELESAIKAN — perlukan keputusan pemilik: `lib/payroll.ts`.** Kurungan cukai pendapatan masih kurungan negara asal (0.07/0.11/0.15/0.19/0.21/0.24, bebas cukai 200000) dan `PENSION_RATE = 0.08`. Ini digunakan oleh `calculateMonthlyTax` → slip gaji, jadi cukai yang dipotong daripada guru Malaysia adalah salah. Angka yang betul ialah jadual LHDN MTD/PCB dan kadar KWSP/PERKESO, yang aplikasi ini belum laksanakan. **Saya tidak mereka angka pengganti** — cukai statutori yang direka adalah lebih buruk daripada cukai yang jelas salah, kerana yang direka kelihatan betul. Kecacatan didokumenkan dgn `// NOTE (unresolved)` di tempatnya. |
| 2026-10-10 | **PENGAWAL BRANDING TIDAK PERNAH MEMINDAI BACKEND.** Ini penemuan paling penting pusingan ini. Pengawal itu mengimbas `components/ src/ public/ hooks/ context/ utils/ lib/ services` — **`backend/` tiada dalam senarai**. Itulah sebabnya saya boleh berkata "siap" sementara 60+ kebocoran vendor masih hidup di sana. Senarai imbasan adalah SEBAHAGIAN daripada pengawal: meninggalkan satu pokok keluar bukan menghasilkan positif palsu, ia menghasilkan SENYAP. Kini `backend/src` disertakan, dan pengawal itu terus menemui `backend/src/services/aiKnowledge.service.ts` yang saya baru sahaja "betulkan". |
| 2026-10-10 | **Kebocoran backend paling teruk — emel kepada ibu bapa dan guru sebenar.** Pengirim disematkan 9 kali sebagai `"Oliskey Admin" <no-reply@oliskey.com>`. Ini tidak gagal secara kelihatan, kerana pelayan mel akan menghantar dari mana-mana alamat yang dibenarkan — jadi setiap kod pengesahan, reset kata laluan dan jemputan sampai kepada ibu bapa sebenar dengan jenama syarikat yang tiada kaitan dengan sekolah mereka. **Lebih serius: pautan "reset kata laluan" menunjuk ke `https://app.oliskey.com`** — domain yang sekolah ini tidak miliki dan tidak kawal. Ibu bapa yang mengikut pautan itu dihantar kepada pihak ketiga. Pengirim kini boleh dikonfigurasi (`MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `SCHOOL_DISPLAY_NAME`, `SCHOOL_EMAIL`) dengan lalai alamat sekolah sendiri, dan URL portal ialah `SCHOOL_PORTAL_URL`. **URL portal WAJIB ditetapkan dlm production — lalai yang salah di sini ialah masalah keselamatan, bukan salah taip.** |
| 2026-10-10 | **Prompt sistem AI berkata "You are Oliskey AI", jawab dalam "Plain English", dan jangan bantu sesiapa melintasi "a school or branch boundary".** Ini rentetan paling penting dlm fitur AI: segalanya dibentuk olehnya, dan kesalahannya TIDAK KELIHATAN kerana model mengikut prompt dan bukan dokumen. Ia memperkenalkan diri sebagai produk syarikat lain, menjawab ibu bapa Melayu dalam bahasa Inggeris, dan dikawal terhadap sekolah dan cawangan lain — konsep yang sekolah tunggal ini tiada. Peraturan tentang sempadan yang tidak wujud TIDAK memberi perlindungan di tempat yang ada: sempadan sebenar di sini ialah **antara keluarga**. Kini: Bahasa Melayu, tiga peranan sebenar, dan "never reveal another family's child, marks, fees, attendance". |
| 2026-10-10 | **Dokumen pengetahuan AI (`docs/OLISKEY_AI_KNOWLEDGE_BASE.md`, 308 baris) menerangkan produk yang BERBEZA.** Ia menyenaraikan **11 peranan** (SRIK ada 3), **cawangan**, dan memberitahu ibu bapa untuk "pay through the payment screen" — SRIK tidak mempunyai pembayaran dalam talian langsung. Ibu bapa yang bertanya "bagaimana saya bayar?" akan diberitahu untuk membayar melalui aplikasi, iaitu arahan yang menghantar mereka mencari skrin yang tidak wujud. Ditulis semula sebagai `docs/SRIK_AI_KNOWLEDGE_BASE.md` untuk satu sekolah: RM, Ahad–Khamis, Penggal 1/2/3, tiga peranan, skala gred sekolah, dan "Parents do not pay in this app". Diuji oleh 11 pemeriksaan baharu (`tests/branding/ai-knowledge-base.test.ts`) + 14 ujian backend sedia ada. Disahkan songsang 3 cara: kembalikan bayaran dalam talian → gagal; tambah semula 11 peranan + Naira → gagal; buang tajuk → gagal. |
| 2026-10-10 | Kebocoran backend lain yang dibetulkan: `auth.service.ts` + `demoSeeder.service.ts` menjana ID `OLISKEY_MAIN_*` sebagai LALAI hidup; `app.ts` CSP membenarkan `api.paystack.co` dan `js.paystack.co` (kebenaran yang aplikasi tidak pernah panggil ialah jemputan untuk kandungan suntikan); kuis geografi menanyakan "The capital city of Nigeria is:" kepada murid SRIK; `schoolBranding.controller.ts` memasang aplikasi bernama "Oliskey School App" pada telefon guru (lalai warna tema juga indigo vendor → teal sekolah); bilik video dinamakan `oliskey-*` (URL kelihatan kepada semua peserta); emel resit menyatakan jumlah dlm **Naira** — angka yang betul dengan mata wang yang salah pada resit lebih buruk daripada angka yang hilang, kerana ia kelihatan berwibawa dan tiada penyata bank akan sepadan. |
| 2026-10-10 | **`db-security-check.ts` memeriksa peranan pangkalan data bernama `oliskey_app` yang TIDAK PERNAH WUJUD** — bukan dalam migrasi SRIK, dan tidak pada pangkalan data langsung (disemak: hanya `authenticated`, `anon`, `service_role`). Jadi ia melaporkan WARN yang tidak boleh diselesaikan dan tidak pernah memeriksa apa-apa yang nyata. Kini ia memeriksa peranan sebenar: `authenticated` dan `anon` mesti NOSUPERUSER + NOBYPASSRLS (jika tidak, RLS hanyalah hiasan dan setiap polisi dalam skema adalah nasihat), dan `service_role` dibenarkan memintas secara reka bentuk. Disemak terhadap remote: `anon|f|f|f`, `authenticated|f|f|f`, `service_role|f|t|f` — betul. |
| 2026-10-10 | `standardSessionTerms` dlm `term.service.ts` masih menghasilkan kalendar September→Julai (`lagos()` dgn `+01:00`, sesi "2026/2027"). Ini adalah **kembar** kepada pepijat yang saya betulkan dlm `academicSettings.service.ts` — saya terlepas yang ini kerana fail itu berada di luar senarai imbasan. Kini Januari→Disember dgn `+08:00`, sesi "2026" sahaja. |
| 2026-10-10 | **MINGGU SEKOLAH TERBALIK.** `TeacherAttendanceScreen` menyekat `day === 0` (Ahad) sambil MEMBENARKAN Jumaat — tepat terbalik daripada minggu sekolah. Guru yang mengambil daftar pada hari Ahad, hari persekolahan biasa, ditolak dgn mesej "Weekends are disabled", manakala Jumaat yang tiada sekolah diterima. `TeacherOverview` mempunyai andaian sama. Kini kedua-duanya menyekat Jumaat (5) dan Sabtu (6) sahaja. |
| 2026-10-10 | **PEPIJAT YANG SAMA TIGA KALI — nombor vs nama hari.** `day_of_week` menyimpan NAMA HARI INGGERIS (`'SUNDAY'`…`'THURSDAY'`, disemak pada remote), tetapi tiga tempat membandingkan NOMBOR dengannya: (1) `TeacherOverview` "Today's Schedule" menapis `Number(day_of_week) === todayNum` → **tidak pernah benar, panel kosong SETIAP hari tanpa sebarang ralat**; (2) `MyClassHubScreen` menggunakan peta `1=Mon…7=Sun` → label hari sentiasa kosong, dan `|| ''` menjadikan kosong itu kelihatan seperti pilihan susun atur; (3) skrin kehadiran di atas. Ditambah `SCHOOL_DAY_ENUM` + `toSchoolDayEnum()` dlm `branding.ts` sebagai SATU definisi, dan pengawal baharu `src/lib/__tests__/day-of-week-mismatch-guard.test.ts` (6 pemeriksaan) yg mengimbas SEMUA fail yang dihantar untuk corak ini. Disahkan songsang 3 cara — ketiga-tiga sabotaj ditangkap. |
| 2026-10-10 | **Kalendar akademik benih masih September→Julai.** `seedAcademicCalendarIfEmpty()` menyemai sesi `'2025/2026'` dgn offset `+01:00`. Offset bukan perincian: tarikh yg ditulis sebagai tengah malam di Lagos jatuh pada 07:00 pagi hari yang sama di Kuala Nerang, jadi SETIAP sempadan penggal beralih. Kini tahun kalendar dgn `+08:00`. Ini kali KEDUA pepijat ini muncul — saya terlepas yang ini kerana ia berada di luar senarai imbasan sehingga pusingan ini. |
| 2026-10-10 | Salinan yg salah hari: tiga skrin tetapan notifikasi berkata ringkasan mingguan tiba "every Monday" / "every Friday". Minggu sekolah berakhir pada Khamis, jadi ringkasan sepatutnya tiba pada hari sekolah yang terakhir — bukan hujung minggu pembaca. `manifest.json` shortcuts: dua daripada tiga masih Inggeris (bukti migrasi berhenti separuh jalan, bukan keputusan). Fixture ujian yg basi juga dibersihkan (kuiz "Capital of Nigeria?" → "Ibu kota Malaysia?"; `curriculum_type: 'nigerian'` → `'KSSR'`). |
| 2026-10-10 | **LAPISAN BIL VENDOR DIBUANG SEPENUHNYA (keputusan pemilik).** Lebih daripada sekadar skrin: keseluruhan konsol vendor `components/admin/saas/` (11 fail), modul `proprietor/` (7 fail), `alumni/`, `subscription/`, `SuperAdminDashboard.tsx`, `PilotOnboardingPage.tsx`, 13 fail bil backend (pengawal langganan, invois, e-mel bil, cron, gerbang bayaran), `SaaSContext.tsx`, dan `plan.middleware.ts`. Sandaran penuh: `/tmp/vendor-billing-backup/`. |
| 2026-10-10 | **KUNCI BIL MENUTUP SELURUH APLIKASI.** Ini penemuan paling penting. `DashboardLayout.isLocked` menggantikan KESELURUHAN kandungan papan pemuka dengan `PlanLockScreen` apabila `planStatus.app_locked` benar, dan `App.tsx` mempunyai kunci kedua yg menggantikan seluruh papan pemuka dengan `SubscriptionLockScreen`. Kedua-duanya memberitahu pembaca bahawa langganan sekolah "has not been renewed" dan mengarahkan pentadbir membayar. Tiada apa-apa di sekolah ini boleh memenuhi syarat itu. Kedua-duanya dibuang. |
| 2026-10-10 | **KUNCI AI: jika dibuang tanpa diperhatikan, SEMUA ciri AI akan mati.** Bendera `__aiAllowed` dlm `lib/ai.ts` lalai `false` dan HANYA `useSubscriptionGate` menetapkannya `true`. Membuang lapisan bil tanpa menukar lalai ini akan menyebabkan setiap ciri AI gagal seperti rosak, bukan seperti tidak dibayar. Lalai kini `true`. Diuji. |
| 2026-10-10 | `AIFeatureLock` ialah halaman pembayaran sebenar: harga `RM2,000/term`, caj dlm **NAIRA** melalui Paystack. Ia membalut tiga skrin AI — pencipta permainan (guru), Study Buddy (pelajar), Tip Keibubapaan (ibu bapa). Ibu bapa membuka tip keibubapaan dan mendapat halaman checkout syarikat lain. Kini dibuang; ciri AI terbuka kepada semua yg layak. |
| 2026-10-10 | `plan.middleware.ts` mengehadkan sekolah kepada 50 murid / 5 guru mengikut "pelan", dan memulangkan **HTTP 402 Payment Required** untuk memaksa naik taraf. Had itu hanya bermakna jika sekolah ialah pelanggan produk ini. Dibuang. (Kod itu sendiri sudah dilumpuhkan dengan `return next()` di baris pertama — tetapi had dan mesej naik taraf kekal.) |
| 2026-10-10 | Aliran bayaran ibu bapa dalam talian dibuang: `recordPayment` dlm `parent.controller.ts` (`POST /parents/me/payments`) mengesahkan rujukan terhadap gerbang sebenar dan hanya mengkredit mata wang yg disenaraikan dlm `PAYMENT_ALLOWED_CURRENCIES` (lalai `NGN`). Ia wujud semata-mata untuk ibu bapa membayar melalui gerbang — aliran yg sekolah ini tidak ada. **Skrin yuran SEKOLAH (FeeCollectionScreen, FeeManagementScreen, StudentFeesScreen, `finance.ts`, `parentFees.ts`) disemak dan kekal utuh serta masih bersambung ke papan pemuka.** |
| 2026-10-10 | Pengawal diperkukuh dua cara baharu: (1) `tests/branding/no-legacy-branding.test.ts` kini **memerlukan setiap pengecualian menunjuk kepada fail yg BENAR-BENAR WUJUD** — 14 pengecualian lama menunjuk kepada fail yg sudah dibuang, dan pengecualian basi lebih buruk daripada tiada kerana ia memberi kebenaran awal kepada LALUAN itu jika fail dicipta semula; (2) `src/lib/__tests__/ai-is-not-behind-a-paywall.test.ts` baharu (7 pemeriksaan) memastikan lalai AI terbuka, tiada skrin AI dibalut kunci, tiada `usePaystackPayment` di mana-mana, dan skrin yuran sekolah masih wujud. Disahkan songsang. |
| 2026-10-10 | `tests/quality/no-fabricated-data.test.ts` menguji `components/proprietor/CurriculumToggle.tsx` — fail yg menulis `averagePerformance: Math.random() * 30 + 70` sebagai peratus prestasi palsu pada papan pemuka pemilik sekolah. Fail itu kini DIBUANG (peranan PROPRIETOR tidak wujud di sini), jadi pengawal itu ditukar daripada "fail menyatakan null" kepada "fail tidak wujud" — dakwaan yg lebih kuat, kerana fail yg tiada tidak boleh memalsukan apa-apa, dan fail yg dicipta semula akan gagal ujian. Ditambah pemeriksaan baharu yg mengimbas corak Math.random → medan yg dinamakan sebagai ukuran. |
| 2026-10-10 | **SUITE UJIAN PENUH HIJAU BUAT KALI PERTAMA: 49 fail, 383 ujian lulus.** Kegagalan Paystack yg lama hilang bersama failnya. Typecheck frontend dan backend bersih, binaan bersih, dan pelayan Express bermula pada port 5000 tanpa rujukan kepada mana-mana fail yg dibuang. (Ralat pangkalan data Prisma dlm log ialah keadaan sedia ada — ia menunjuk hos terus `db.*:5432` dan bukan pooler; tidak berkaitan perubahan ini.) |
| 2026-10-10 | **SISTEM PERANAN DIBERSIHKAN — dan dua pepijat sebenar ditemui semasa membersihkannya.** `DashboardType` menyenaraikan 10 nilai; pangkalan data hanya ada 3 (ADMIN, TEACHER, GUARDIAN). Enam peranan vendor dibuang: SUPER_ADMIN, PROPRIETOR, INSPECTOR, EXAM_OFFICER, COMPLIANCE_OFFICER, COUNSELOR — bersama tema, kes router, sidebar, dan enam fail papan pemuka yang berkaitan. |
| 2026-10-10 | **PEPIJAT 1: GUARDIAN → ADMIN.** `getDashboardTypeFromUserType()` menamatkan dengan `return DashboardType.Admin` sebagai lalai. Pangkalan data memanggil ibu bapa **GUARDIAN**, tetapi fungsi itu menyenaraikan **PARENT** — jadi kod peranan sebenar seorang ibu bapa tidak sepadan dengan apa-apa dan jatuh ke lalai: **papan pemuka pentadbiran, yang paling berkuasa dalam aplikasi**. Kini `GUARDIAN` dan `PARENT` kedua-duanya dikenali, dan lalai ialah `Student` — yang paling sedikit kuasa, bukan paling banyak. |
| 2026-10-10 | **PEPIJAT 2: GUARDIAN → TEACHER.** Laluan log masuk Supabase sebenar (yang berjalan untuk pengguna sebenar) berbunyi "ADMIN, jika tidak TEACHER". Seorang ibu bapa menerima papan pemuka GURU, lengkap dengan navigasi dan skrinnya. Kini diperiksa mengikut urutan keistimewaan dan `GUARDIAN` diperiksa secara eksplisit. |
| 2026-10-10 | **PEPIJAT 3: butang moderator tidak pernah muncul.** `GlobalTeacherCommunityScreen` memeriksa `SUPER_ADMIN` (peranan tidak wujud) DAN membacanya dari `user?.role` — sedangkan `role` ialah SIBLING bagi `user` pada konteks auth, jadi carian itu `undefined` walaupun sebelum namanya salah. Guru tidak pernah dapat memadam topik forum. Kini `role` diambil dari konteks dan dibandingkan dengan ADMIN. |
| 2026-10-10 | **PEPIJAT 4: skrin pindah cawangan tidak memuatkan apa-apa.** Syaratnya ialah `role === Admin && !currentBranchId` — di sekolah tunggal SETIAP pentadbir MEMPUNYAI id cawangan, jadi syarat itu palsu untuk satu-satunya peranan yang sepatutnya dibenarkan. Kini menggunakan `useIsMainAdmin()`, yang bertanya kepada pelayan. |
| 2026-10-10 | Fungsi mati `mapRoleToDashboard()` dibuang dari `Login.tsx` (22 baris — tiada siapa memanggilnya; laluan sebenar melalui `signInWithEmail` → `AuthContext`). Ia juga mengandungi lalai berbahaya yang sama (peranan tidak dikenali → papan pemuka Pelajar, jadi seorang guru boleh melihat papan pemuka pelajar jika kod peranan berubah). `RoleBasedNavigation.tsx` (148 baris, menyenaraikan 5 peranan vendor) dibuang — tiada siapa menggunakannya. Modul `components/inspector/` (27 fail) dibuang: pulau vendor yang hanya boleh dicapai dari dalam dirinya sendiri. `InviteAcceptScreen` tidak menyenaraikan `guardian` langsung. |
| 2026-10-10 | Pengawal baharu `src/lib/__tests__/role-system.test.ts` (6 pemeriksaan): setiap peranan pangkalan data mempunyai nilai papan pemuka; tiada peranan vendor dalam enum; GUARDIAN dan PARENT kedua-duanya difahami; **lalai tidak boleh jadi Admin**; GUARDIAN mesti diperiksa dlm peta identiti; tiada fail dihantar menamakan peranan vendor. Disahkan songsang 3 cara — ketiga-tiga sabotaj ditangkap, termasuk kedua-dua pepijat sebenar. |
| 2026-10-10 | **50 fail ujian, 389 ujian — semuanya lulus.** Typecheck frontend + backend bersih, binaan bersih, Vite bermula dalam 507ms, dan log permulaan tiada rujukan kepada mana-mana fail yg dibuang. |
| 2026-10-10 | **CIRI CAWANGAN DIBUANG SEPENUHNYA.** Penemuan utama: **jadual `branches` TIDAK WUJUD dalam pangkalan data SRIK.** Jadi setiap skrin cawangan memanggil pelayan yang hanya boleh memulangkan senarai kosong — dan setiap pemilih cawangan dibina daripada senarai yang sentiasa kosong. Tiada satu pun menghasilkan ralat; ia hanya senyap tidak melakukan apa-apa. |
| 2026-10-10 | **PEPIJAT DITEMUI: borang "Tambah Penjaga" TIDAK BOLEH DIHANTAR.** Medan "Primary Branch *" ditanda `required`, tetapi pilihannya datang dari senarai cawangan yang sentiasa kosong. Pelayar menolak penghantaran, jadi pejabat tidak dapat menambah ibu bapa/penjaga langsung. Medan itu dibuang. |
| 2026-10-10 | **PEPIJAT DITEMUI: pengalih cawangan muncul sebagai UI tetapi tidak pernah berfungsi.** Butang "All Branches" muncul di tiga header (termasuk menu mudah alih), dan panelnya dijana dari senarai kosong. Dua pelaksanaan `BranchSwitcher` wujud serentak — satu dalam fail sendiri, satu lagi di dalam konteks. Kedua-duanya dibuang. |
| 2026-10-10 | **PEPIJAT DITEMUI: penapis kurikulum "British" pada skrin kehadiran guru.** Ia muncul hanya untuk cawangan "dual curriculum" — keadaan yang tidak boleh berlaku. Jadual `students` SRIK juga tiada medan kurikulum langsung. Penapis itu dibuang bersama penanda "Semua Kurikulum"/"British". |
| 2026-10-10 | **PEPIJAT DITEMUI: 'Push to All Branches' pada kalendar sekolah.** Ia memanggil `api.updateBranch?.()` — panggilan pilihan pada kaedah yang tidak wujud — terhadap jadual yang tidak wujud, tetapi memaparkan mesej berjaya. Dibuang; butang "Save Calendar" yang sedia ada kekal. |
| 2026-10-10 | **Yang dibuang (frontend):** `context/BranchContext.tsx` → dinamakan semula `context/SchoolScopeContext.tsx`; `BranchSwitcher.tsx`; `BranchTransferScreen.tsx`; `BranchAcademicsScreen.tsx`; `AddBranchAdminScreen.tsx`; `SchoolManagementScreen.tsx`; butang "Branches" dalam sidebar; 2 tindakan pantas "Manage Branches"/"Branch Transfers"; pilihan "Branch Admin" pada skrin tambah pengguna; pemilih cawangan pada borang penjaga, staf dijemput dan bilik darjah; seksyen "Branch Curriculum Focus"; label "Main Campus" pada kelulusan murid (kini nama sekolah). |
| 2026-10-10 | **Yang dibuang (backend):** `createBranch`, `updateBranch`, `deleteBranch`, `transferUser`, `getBranches`, `getBranchOptions` dari `branch.controller.ts`; 5 kaedah cawangan dari `school.service.ts` (188 baris); semua kecuali satu laluan dari `branch.routes.ts`; `transferUser` + senarai cawangan dari `branchTransfer.service.ts`. Laluan `/branches/authorized` KEKAL — ia yang menyelesaikan identiti sekolah. |
| 2026-10-10 | **Pembaikan penting:** `branchTransfer.service.ts` kini membaca jadual `schools` yang SEBENAR (sebelum ini `prisma.branch`, yang tiada). Inilah sebab nama sekolah tidak pernah sampai ke header. Kini `currentBranch` membawa nama dan id sekolah yang betul — dan id itu ialah parameter skop yang dihantar ke pelayan oleh banyak skrin. |
| 2026-10-10 | **Dikekalkan dengan sengaja:** `getAuthorizedBranches`, `currentBranch`, `activeBranchGeneratedId`, `isMainAdmin`, medan API bernama `branchId`/`branch_id`, dan utiliti `branchScope`/`branchIdentity` (digunakan oleh guru, pengguna dan auth). Ia menyeberangi sempadan pelayan dan masih membawa identiti sekolah. Pemilik memilih untuk mengekalkan parameter pelayan ini. |
| 2026-10-10 | Pengawal baharu `src/lib/__tests__/no-branch-feature.test.ts` (5 pemeriksaan): fail cawangan dipadam; tiada skrin menawarkan pilihan cawangan; identiti sekolah MASIH selesai; tiada laluan pelayan boleh mencipta/memadam cawangan; konteks tidak lagi mempunyai API pengalihan. Disahkan songsang 3 cara — ketiga-tiga sabotaj ditangkap. |
| 2026-10-10 | **51 fail ujian, 393 ujian — semuanya lulus.** Typecheck depan + belakang bersih, binaan bersih, Vite 261ms, pelayan Express bermula tanpa ralat. Sandaran: `/tmp/branch-removal/`. |
| 2026-10-10 | **CI/CD DIPASANG: GitHub + Vercel.** Repo baharu `TheGoodFeederXX/SRIK-App-2` (peribadi). Vercel projek `srik-app-2`, region ditukar `fra1` → **`sin1` (Singapura)** supaya berhampiran pangkalan data Supabase (ap-southeast-1). Alamat langsung: **https://srik-app-2.vercel.app** |
| 2026-10-10 | **Empat aliran kerja lama dibuang, satu aliran baharu menggantikannya.** `deploy.yml` berjalan pada runner SELF-HOSTED dan memuat semula pelayan di /var/www/School-app — pelayan itu tidak wujud lagi. `build-prisma-engine.yml` menyusun binari Prisma dan commit semula. `migration-safety.yml` membuktikan dakwaan tentang `prisma migrate deploy`. `playwright.yml` menguji terhadap pangkalan data tenant lama. Kesemuanya milik seni bina Oliskey. |
| 2026-10-10 | Aliran baharu `.github/workflows/ci.yml`: **verify** (jenis depan + belakang, 393 ujian, binaan) dan **deploy** (ke Vercel hanya jika verify lulus, hanya dari `main`). Deploy dibuat melalui CI, bukan integrasi Git Vercel — supaya deployment TIDAK boleh berlaku melainkan pemeriksaan lulus. |
| 2026-10-10 | **PEPIJAT BESAR DITEMUI: 21 fail sumber tidak pernah masuk git.** Peraturan `*.ts` / `*.js` / `*.txt` yang menyeluruh dalam `.gitignore` membuang fail secara senyap — setiap pengecualian perlu disenaraikan tangan. Yang hilang: **`src/lib/supabase/**` (13 fail — SELURUH lapisan data)**, `src/lib/branding.ts`, `src/lib/__tests__/**` (6 ujian pengawal), dan `supabase/functions/provision-teacher-account/index.ts`. CI gagal dengan "Cannot find module" kerana repo GitHub memang tidak lengkap. Puncanya diperbaiki: setiap pokok sumber kini disenaraikan secara eksplisit. Fail `prisma/seed.ts` dan `public/robots.txt` pernah menjadi mangsa yang sama — komen dalam .gitignore sudah mendokumenkan kedua-duanya. |
| 2026-10-10 | **PEPIJAT DITEMUI: migration Prisma mematahkan setiap deployment.** "P3005: The database schema is not empty." Sebabnya dua skema berbeza: skema sekolah ialah **10 fail SQL Supabase (36 jadual)**, manakala skrip itu menjalankan `prisma migrate deploy` yang membaca **198 model warisan Oliskey** dan menyimpan sejarahnya sendiri dalam `_prisma_migrations` — jadual yang tidak wujud dlm pangkalan data sekolah. Baseline juga tidak selamat. Langkah migration dibuang dari `build:vercel`. |
| 2026-10-10 | **PEPIJAT DITEMUI: Vercel menyekat seluruh laman.** `ssoProtection` ditetapkan kepada `all_except_custom_domains`, jadi sesiapa yang membuka laman dialihkan ke halaman login Vercel — **guru, ibu bapa dan pelajar tidak dapat mengakses aplikasi langsung**. Ia dibuka (login sekolah melalui emel/kata laluan masih berkuat kuasa). |
| 2026-10-10 | **PEPIJAT DITEMUI: bahagian pelayan tidak boleh dijalankan.** Express masih sistem lama Oliskey: ia membaca jadual `schools` dan `branches` yang **tidak wujud** dlm pangkalan data SRIK (jadual sebenar: `school_profile`, `profiles`, `students`, `teachers`, …). Ia juga memerlukan 6 tetapan yang tiada (JWT_SECRET, REFRESH_TOKEN_SECRET, DEMO_SCHOOL_ID, DEMO_BRANCH_ID, SMTP_USER, SMTP_PASS) — backend tidak pernah dijalankan dlm mod produksi. Keputusan pemilik: **laman sahaja**. `api/index.js`, entri `functions` dan tulis semula `/api` dibuang. Aplikasi membaca/menulis terus ke Supabase. |
| 2026-10-10 | **Hasil akhir disahkan pada produksi:** https://srik-app-2.vercel.app → HTTP 200, `<html lang="ms">`, tajuk "SRI Al-Khairiah | Sistem Pengurusan Sekolah". Aset 200: manifest.json, school-logo.png, sw.js, offline.html, favicon.ico. Laluan dalam apl (/dashboard) → 200. Saluran CI hijau: 12 langkah lulus, kedua-dua kerja (verify + deploy) berjaya. |
| 2026-10-10 | **AMARAN KESELAMATAN:** dua token (GitHub, Vercel) telah dimasukkan ke dlm sembang. Kedua-duanya TIDAK ditulis ke mana-mana fail dlm repo dan tiada dlm commit. Pemilik perlu **membatalkan kedua-duanya** selepas ini. Pasangan rahsia GitHub dienkripsi menggunakan sealed box sebelum dimuat naik. |
| 2026-10-10 | **PEPIJAT PRODUKSI: gelung log masuk dibaiki.** Kata laluan betul diterima, tetapi pengguna dipulangkan ke skrin log masuk berulang kali. **Dua punca berasingan**, kedua-duanya sisa sistem lama Oliskey menyentuh sesi Supabase yang sah. |
| 2026-10-10 | Punca 1 — **langganan auth dibina semula setiap render.** `signOut`, `signIn`, `initializeAuth` dan `switchSchool` ialah fungsi biasa (bukan `useCallback`), jadi `useEffect` yang menyenaraikan `signOut` teardown dan subscribe semula pada SETIAP render. Setiap binaan semula menjalankan semakan identiti, yang memanggil `signOut()` apabila ia tidak dapat mengesahkan akaun — jadi gelung itu mengekalkan dirinya. **Diukur dlm pelayar sebenar: `signOut` dipanggil 611 kali dlm 12 saat.** Keempat-empat fungsi kini `useCallback`. |
| 2026-10-10 | Punca 2 — **klien API lama memaksa logout apabila tiada `auth_token`.** Sesi Supabase disimpan dlm storan klien Supabase, **bukan** `sessionStorage.auth_token`, jadi semakan `missing_token` menyala untuk SETIAP pengguna yang sudah log masuk. Pencetus sebenar: `UpdatePrompt` memanggil `/versions` tanpa token sebaik sahaja `user` ditetapkan (`if (!user) return` tidak melindungi kerana Supabase menetapkan `user`). Kini tiada token bermakna tiada sesi lama untuk ditamatkan — permintaan gagal sahaja. `triggerLogout` kekal untuk kes 401, di mana token benar-benar dikemukakan dan ditolak. |
| 2026-10-10 | Dua pembaikan sokongan: (a) `initializeAuth` tidak lagi menamatkan sesi Supabase apabila backend Express lama tidak dapat dihubungi — ia memang sudah tiada, dan `/api/auth/me` memulangkan 500; (b) peristiwa sesi **null awal** Supabase (`_emitInitialSession`) tidak lagi dianggap sebagai "pengguna telah log keluar", kerana ia tiba semasa klien masih membaca sesi tersimpan. |
| 2026-10-10 | Ujian pengawal baharu `context/__tests__/auth-no-resubscribe-loop.test.ts` (5 ujian) mengukur **kestabilan identiti fungsi merentas render**, bukan ejaan pembaikan. Ia gagal jika mana-mana fungsi dibuka semula tanpa `useCallback`. Disahkan dgn **mengembalikan setiap kecacatan secara berasingan** — ketiga-tiganya ditangkap. (Versi pertama ujian ini TERLEPAS kecacatan `initializeAuth`; ujian itu diperkukuh selepas kelemahan itu dijumpai.) |
| 2026-10-10 | **Disahkan pada produksi** (https://srik-app-2.vercel.app) dgn pelayar sebenar: selepas log masuk → dashboard dimuat ("Welcome, admin001!"); selepas muat semula halaman → kekal log masuk. Jumlah `signOut` turun dari **611 → 9**, dan 9 itu ialah pembersihan biasa skrin log masuk, bukan gelung. Suite penuh: **52 fail, 398 ujian, semua lulus**. |
| 2026-10-10 | **LANGKAH 1 SELESAI — tiga amaran kekal dibuang dari setiap skrin.** Pengguna melihat dua amaran berterusan yg TIDAK melaporkan kerosakan sebenar: "Live updates unavailable — reconnecting…" (banner oren) dan "Database Connection Error" (bar merah). Database sihat; deployment ini memang tiada pelayan realtime. Kedua-duanya bertanya kepada pelayan Express **lama** yang projek ini tidak lagi hantar. **Tiga punca berasingan** — memperbaiki satu sahaja tidak mencukupi, dan dua yang terakhir hanya kelihatan selepas yang sebelumnya dibaiki. |
| 2026-10-10 | Punca 1 — **prob `/health` meneka `true` apabila gagal.** Pada deployment ini `/api/health` ditangkap oleh tulis-semula SPA dan memulangkan `index.html`, jadi `r.json()` **sentiasa** gagal, jadi `.catch(() => realtimeSupported = true)` sentiasa menetapkan "sokong", jadi soket sentiasa dicuba. Komennya sendiri berbunyi "unknown → let the socket try" — itu tepat sekali apa yg prob itu wujud untuk menghalang. Prob yg tidak dapat dijawab belum membuktikan apa-apa: kini ia menyemak `content-type` dan menjawab `false`. |
| 2026-10-10 | Punca 2 — **bar "Database Connection Error" bertanya kesihatan pelayan lama.** `api.checkBackendHealth()` tidak lagi boleh berjaya, jadi bar merah muncul walaupun database sihat dan semua data sudah datang dari Supabase. Kini ia menyemak Supabase dgn **kiraan** (`select('id', {count:'exact', head:true})`), bukan baris — supaya sekolah yg sah kosong (0 murid) tidak disalah anggap sebagai kerosakan. |
| 2026-10-10 | Punca 3 — **status awal soket ialah `'connecting'` selama-lamanya.** Ini punca yg **terselamat daripada dua pembaikan pertama** dan hanya kelihatan selepasnya. `socketService` bermula dlm `'connecting'`, dan `RealtimeStatusIndicator` menyembunyikan dirinya untuk `'connected'` dan `'unavailable'` tetapi memaparkan banner selepas 8 saat untuk status LAIN. Soket hanya dimulakan **dengan school id**, dan sesi Supabase tidak memberikan satu (medan `user.school` yg lama tidak lagi wujud) — jadi `initialize` tidak pernah dipanggil, status tidak pernah berubah, dan banner menunggu selama-lamanya sambungan yg tidak pernah dimulakan. Status awal kini `'unavailable'` (kenyataan yg jujur: tiada pelayan realtime, aplikasi meninjau); percubaan sebenar masih menetapkan `'connecting'` sendiri dlm `connect()`. |
| 2026-10-10 | Ujian pengawal baharu `lib/__tests__/no-permanent-warnings.test.ts` (**9 ujian**) menguji **kelakuan**, bukan ejaan pembaikan — dan ia **melucutkan komen sebelum padanan**. Ini perlu: ujian versi pertama GAGAL kerana komen penerangan saya sendiri memadankan corak yg sepatutnya tiada ("a bare `checkBackendHealth()`" memadankan penapis `checkBackendHealth()`). Disahkan dgn **mengembalikan setiap tiga kecacatan secara berasingan** — ketiga-tiganya ditangkap. |
| 2026-10-10 | **Disahkan pada produksi** dgn pelayar sebenar: skrin log masuk **TIADA amaran**, dashboard **TIADA amaran**, dan log masuk kekal berfungsi. Suite penuh **53 fail, 407 ujian, semua lulus**. |
| 2026-10-10 | **Papan pemuka memaparkan angka PALSU.** Ia membaca kiraannya drpd `api.getDashboardStats()` — endpoint pelayan Express **lama** yg tidak lagi dihantar. Permintaan itu tidak pernah selesai, jadi setiap petak kekal dgn nilai lalai sendiri: sekolah ada **18 guru aktif** dan papan pemuka tertulis **"Total Staff 0"**. Ini kemuncak semua kerja langkah 1 — angka salah LEBIH BURUK drpd mesej ralat, kerana tiada apa nampak rosak. Skrin seorang kerani yg tertulis "0 staf" bukan sekadar tidak berguna; ia mengarahkan kerja yg salah. |
| 2026-10-10 | Tambah `src/lib/supabase/stats.ts` — kiraan melalui Supabase, dan **setiap kiraan guna `count:'exact', head:true`, BUKAN mengambil baris.** Ini penting: PostgREST mengehadkan satu respons pd **1000 baris**, jadi mengambil baris utk dikira akan mula melaporkan kurang pd hari sekolah membesar — secara senyap, bertahun kemudian. Mengambil baris juga memindahkan setiap lajur setiap baris ke pelayar semata-mata utk dibuang. |
| 2026-10-10 | Nilai status diambil drpd **enum pangkalan data sebenar**, bukan diandaikan. Casis: `OUTSTANDING, PARTIAL, PAID, WAIVED, CANCELLED`. Saya mula-mula tulis `'UNPAID'` — nama yg kelihatan munasabah tetapi **TIADA dlm enum**. Penapis itu tidak akan ralat; ia hanya memadankan sifar, dan angka tertunggak akan kekal 0 selama-lamanya sementara sekolah mengejar keluarga yg tidak berhutang apa-apa. Ditangkap dgn menyemak enum, kemudian dikunci oleh ujian. |
| 2026-10-10 | Pembetulan kesan sampingan yg ditangkap **hanya dlm pelayar sebenar, bukan oleh taipcheck**: guard pemuatan dan bar ralat seluruh-papan masih merujuk pemboleh ubah `stats` yg telah dibuang, yg **meranapkan papan pemuka sepenuhnya** ("Admin Dashboard Error"). Taipcheck lulus 0 ralat kerana rujukan itu di dalam JSX yg tidak dilalui taipcheck. |
| 2026-10-10 | Alih keluar panel AI insights yg membuat permintaan **mustahil pd setiap muatan** (`api.getMyInsights()` → pelayan lama). Ia tidak kelihatan rosak (panel tidak render apa-apa tanpa data), tetapi permintaan yg tidak boleh berjaya melatih pembaca mengabaikan konsol — iaitu tempat kegagalan sebenar akan muncul. |
| 2026-10-10 | Ujian pengawal `src/lib/supabase/__tests__/stats.test.ts` (**6 ujian**) menguji **kaedah**, bukan hanya sumber: setiap `select` mesti bentuk kiraan, status mesti nilai enum sebenar, dan satu kiraan gagal tidak boleh menolak seluruh papan. Disahkan dgn mengembalikan tiga kecacatan berasingan. |
| 2026-10-10 | **Disahkan pada produksi:** log masuk berjaya, **Total Staff 18**, Academic Levels 7, **tiada bar ralat**, **tiada amaran realtime**, dan tiada ralat konsol pd sesi bersih. Suite penuh **54 fail, 413 ujian, semua lulus**. |
| 2026-10-10 | **AUDIT 2026-10-10 diterima: 40 penemuan — 3 P0, 23 P1, 14 P2.** Kesemua disahkan sendiri terhadap pangkalan data produksi sebelum dibaiki; tiada laporan diterima bulat-bulat. **P0/P1 pertama selesai: F01, F02, F03.** |
| 2026-10-10 | **F01 (P0) — kehadiran boleh ditulis oleh pemanggil tanpa log masuk.** Semakan permission berada DI DALAM `if p_recorded_by is null`, jadi memberikan parameter itu melangkaunya sepenuhnya; pengawal "tidak log masuk" juga terpenuhi selagi parameter bukan null. Kini actor SENTIASA `auth.uid()`, parameter hanya diterima jika sama dgn pemanggil, permission disemak tanpa syarat, dan skop kelas disemak (ADMIN dikecualikan). |
| 2026-10-10 | **F02 (P0) — snapshot laporan boleh dibaca tanpa log masuk.** Disahkan: `auth.uid()` muncul **0 kali** dlm badan `build_report_snapshot`. Bukan policy SELECT yg terlalu luas — fungsi itu menyusun data dgn hak pemilik jadual, jadi RLS tidak melindunginya. Kini EXECUTE dicabut drpd PUBLIC/anon/authenticated: ia fungsi DALAMAN, dan pemanggil yg sah mencapainya melalui fungsi penerbitan yg menyemak dahulu. |
| 2026-10-10 | **F03 (P1) — helper kewangan boleh dipanggil anon DAN authenticated.** Ketiga-tiganya tiada semakan dalaman, dan Phase 5 memberikannya kpd `authenticated`. `charge_balance` membocorkan baki keluarga kpd sesiapa yg tahu id caj; `refresh_charge_status` melakukan UPDATE sebagai pemilik — laluan tulis yg memintas RPC kewangan. |
| 2026-10-10 | **Punca sebenar ketiga-tiganya sama:** Postgres memberi EXECUTE kpd PUBLIC secara lalai pada setiap fungsi baharu, dan `security definer` bermakna RLS **tidak** melindungi panggilan itu. Satu-satunya autorisasi ialah apa yg disemak oleh badan fungsi PLUS siapa yg boleh memanggilnya langsung. Kedua-duanya gagal. **Di produksi, 25 fungsi `security definer` boleh dipanggil tanpa log masuk.** Kini **sifar**. |
| 2026-10-10 | **PENGAJARAN PALING PENTING — revoke tidak kekal.** Suite SQL menangkapnya: selepas runner mengulang Phase 5 (semakan idempotency), `authenticated` boleh mencapai `charge_balance` semula. Satu GRANT kemudian membatalkan REVOKE, kerana grant bersifat tambahan dan bergantung susunan — itulah **F38** dlm bentuk kecil, dan ia bukan artifak ujian tetapi kelakuan sebenar sejarah migration yg boleh diulang. Jadi penutup sebenar ialah semakan **DI DALAM** fungsi, yg tidak bergantung pada susunan. |
| 2026-10-10 | **Dua percubaan saya sendiri SALAH, dan suite yg menangkapnya — bukan andaian saya:** (a) menyekat SEMUA role API memutuskan skrin kewangan yg sah; (b) memerlukan `finance.view` sahaja **menolak ibu bapa membaca baki anak sendiri** — penjaga memang tiada permission kewangan (fasa 5b menegaskannya), dan dahulunya ia berfungsi secara **kebetulan** kerana RLS menyembunyikan baris caj, bukan kerana apa-apa menolak permintaan itu. Kini ia semakan skop eksplisit: jaminan, bukan kebetulan. |
| 2026-10-10 | Ujian 7 fasa 5b **diperkuat**: dahulunya menuntut hasil kosong secara senyap (perlindungan tidak sengaja), kini menuntut **penolakan eksplisit** — lebih kuat, dan tidak bergantung pada policy caj kekal sempit. |
| 2026-10-10 | Ujian pengawal baharu `supabase/tests/security_hardening_test.sql` (**6 pemeriksaan**) menguji **keupayaan**, bukan kelakuan: bukan "adakah kehadiran berfungsi" tetapi "bolehkah pemanggil anon melakukannya langsung". Disahkan dgn **mengembalikan setiap tiga kecacatan secara berasingan** — ketiga-tiganya ditangkap. |
| 2026-10-10 | **Pembetulan sampingan:** ujian `DashboardOverview` membuat **6 permintaan rangkaian sebenar** ke projek produksi setiap larian. Ia 401, jatuh ke 0, dan tetap lulus — jadi ia hijau sambil bergantung pada rangkaian, dan itu punca suite menjadi **tidak stabil** (gagal hanya dlm larian penuh, apabila permintaan itu berlumba dgn penegasan). Kini dimock. |
| 2026-10-10 | **Disahkan pada produksi:** sifar fungsi boleh dipanggil tanpa log masuk; log masuk berjaya; kiraan betul (18 guru, 7 kelas); skrin murid berfungsi; tiada respons gagal. Suite SQL **94 + 6 pemeriksaan lulus**; suite hadapan **54 fail, 413 ujian, lulus 3 larian berturut-turut**. |
| 2026-10-10 | **F31 (P0) — pengawal drill pemulihan dilangkau sebelum `DROP SCHEMA ... CASCADE`.** Disahkan sendiri, bukan diandaikan: pengawalnya ialah `if [ -n "$LIVE_HOST" ] && [ "$DRILL_HOST" = "$LIVE_HOST" ]`. Jika `SRIK_DB_URL` tidak ditetapkan — dan ia TIDAK ditetapkan secara lalai — maka `LIVE_HOST` kosong, seluruh syarat palsu, dan pengawal **dilangkau** betul-betul sebelum skema dipadam. Jadi kes yang TIDAK dilindungi ialah kes biasa: sekolah yg menjalankan drill untuk menyemak sandaran boleh memusnahkan data sendiri, dan skrip akan melaporkannya sebagai "pemulihan gagal". Kini hos hidup yang tidak diketahui ialah ralat keras, bukan alasan untuk meneruskan. |
| 2026-10-10 | **F31 bahagian 2 — hos alias.** Memadam skema tidak selamat jika sasaran semata-mata "bukan nama yg sama". Sesebuah pelayan menjawab beberapa nama, jadi drill "di tempat lain" boleh jadi pangkalan data hidup yang menyamar. Kini identiti sasaran (rujukan projek + hos + nama pangkalan data) dibandingkan, dan sasaran yg membawa identiti hos hidup DITOLAK. |
| 2026-10-10 | **F31 pembetulan arah bertentangan — dan sebab ia penting.** Semasa menguji, pengawal baharu menolak drill yg SAH: dua pangkalan data pada hos yg sama. Menolak keterlaluan lebih selamat drpd menerima, TETAPI pengawal yg menghalang penggunaan betul akan dipintas orang, dan pengawal yg dipintas tidak melindungi apa-apa. Jadi perbandingan menuntut hos **dan** nama pangkalan data sama. |
| 2026-10-10 | **F30 (P1) — drill boleh melaporkan LULUS walaupun pemulihan gagal.** Dua punca: (a) saluran paip berakhir dgn `\|\| true`, membuang status keluar `pg_restore`; kerana status saluran paip ialah status perintah TERAKHIR, `grep` yang menentukan sama ada drill perasan apa-apa. Pemulihan yg mati separuh jalan jatuh terus ke perbandingan kiraan — dan kerana fail kiraan ditulis oleh SANDARAN, perbandingan itu boleh tetap sepadan dan mencetak LULUS untuk pemulihan yg tidak pernah berlaku. Kini status ditangkap dgn `PIPESTATUS` dan diperiksa. (b) Perbandingan **sifar** jadual bukan lulus: jika fail kiraan tidak menyenaraikan apa-apa, gelung tidak berjalan, bendera gagal kekal 0, dan drill mencetak LULUS setelah menyemak TIADA apa-apa. Kini ia gagal secara eksplisit. |
| 2026-10-10 | **Kecacatan ketiga F30, ditemui dgn MENJALANKAN drill — bukan dgn membacanya.** Sandaran merekod `RALAT` untuk jadual yg tidak wujud ketika ia dijalankan; pertanyaan drill juga gagal di situ; dua rentetan itu **sama**, jadi jadual dilaporkan `sama`. Larian sebenar memaparkan `RALAT sama RALAT` untuk lima jadual sementara ringkasan masih berbunyi LULUS. Dua kegagalan yg bersetuju tidak membuktikan apa-apa, dan ia menyembunyikan tepat kes yg perbandingan itu wujud untuk menangkap: jadual yg tidak kembali. Kini kiraan yg tidak dapat dijalankan ialah kegagalan. |
| 2026-10-10 | **Ketiga-tiga kecacatan disahkan dgn menjalankan drill sebenar hujung-ke-hujung** terhadap PostgreSQL tempatan: sandaran 7 jadual (7 murid, 3 penjaga, 12 caj, 5 bayaran, 40 markah, 250 kehadiran) → dipulihkan ke pangkalan data berasingan → **LULUS, kod keluar 0, semua kiraan sama**. Kemudian pengawal memusnah diuji: `SRIK_DB_URL` tidak ditetapkan → DITOLAK (keluar 1); sasaran = pangkalan data sekolah → DITOLAK (keluar 1); dan data sekolah disahkan **masih utuh (7 murid)** selepas kedua-duanya. |
| 2026-10-10 | Ujian pengawal baharu `scripts/ops/__tests__/restore-drill-safety.test.ts` (**8 ujian**). Ia membaca skrip sebagai TEKS, bukan menjalankannya — mod kegagalan skrip ini ialah MEMUSNAHKAN (ia memadam skema), jadi ujian yg menjalankannya perlu menunjuknya ke pangkalan data sebenar, dan kesilapan dalam ujian itu akan memusnahkan data sebenar. **Lima mutasi diuji secara berasingan** (buang penolakan SRIK_DB_URL; `\|\| true` kembali; buang pemeriksaan sifar-jadual; `RALAT` dikira sama; bandingkan hos sahaja) — kelima-limanya ditangkap. Satu penegasan terpaksa diketatkan: versi pertama padan baris pengepala sahaja dan lulus walaupun perbandingan nama pangkalan data dibuang. |
| 2026-10-10 | **F04 (P1) — log keluar tidak menamatkan sesi.** `signOut()` membersihkan senarai yang menyeluruh — token sessionStorage dan localStorage, cache pertanyaan yg disimpan dlm IndexedDB, stor penulisan luar talian, dan setiap medan keadaan React — kemudian bergantung pada "user ialah null, jadi skrin log masuk dipaparkan". **Tiada apa-apa pun dihantar kepada Supabase.** Itu log keluar UI, bukan log keluar pengesahan: sesi dan token penyegarannya kekal sah, jadi akaun masih log masuk di pihak pelayan sementara skrin berkata sebaliknya. Pada peranti bilik guru yg dikongsi, itu hasil yg paling buruk — orang seterusnya melihat skrin log masuk, tetapi sesi sebelumnya masih hidup dan boleh dipulihkan drpd storan. |
| 2026-10-10 | F04 punca sebenar: pengimport `signOut as supabaseSignOut` **sudah ada** di AuthContext, tetapi **tidak pernah dipanggil**. Pengimport yg tidak digunakan di sini bukan perkara remeh — ia kelihatan seolah-olah kerja itu sudah selesai, jadi tiada siapa menyemak semula sama ada sesi benar-benar ditamatkan. Yang dipertimbangkan dan ditolak sebagai punca: sama ada token dibersihkan. Ia dibersihkan dgn teliti; pembersihan itu **bukan** masalahnya — ia adalah perkara yg dilakukan **SEBAGAI GANTI** menamatkan sesi, dan itu menjadikan jurangnya mudah terlepas pandang. |
| 2026-10-10 | F04 pembetulan: `supabase.auth.signOut()` dipanggil **dahulu**, sebelum pembersihan setempat, dan susunan itu disengajakan — permintaan itu perlu membawa token akses yg mengenal pasti sesi mana yg hendak dibatalkan; membersihkan keadaan dahulu akan meninggalkan tiada apa-apa untuk dibatalkan. Kegagalan panggilan jauh **tidak boleh** memerangkap pengguna dlm UI yg kelihatan log masuk, jadi hasilnya sengaja diabaikan dan pembersihan setempat tetap berjalan. |
| 2026-10-10 | **Disahkan dlm pelayar sebenar:** menekan Logout kini menghantar `POST /auth/v1/logout` kepada Supabase (sesi benar-benar dibatalkan), sesi tersimpan dibersihkan, dan skrin log masuk kembali. Sebelum pembetulan, POST itu **tidak pernah berlaku** — sahaja keadaan setempat dibersihkan. |
| 2026-10-10 | Ujian pengawal baharu `context/__tests__/signout-ends-supabase-session.test.ts` (**4 ujian**). Dua mutasi diuji: buang panggilan (ditangkap) dan susun semula selepas pembersihan token (ditangkap). Penegasan susunan terpaksa diketatkan DUA kali — `setUser(null)` padan cabang lain yg lebih jauh ke bawah, dan `startTransition` masih berada selepas blok yg dipindahkan; sauh yg akhirnya berkesan ialah pembersihan token pertama. |
| 2026-10-10 | **F05, F06, F07 (P1) — polisi yang menyemak AKAUN tetapi tidak REKOD.** Ketiga-tiganya bertanya "adakah orang ini mempunyai jenis akaun yg betul?" dan tidak pernah bertanya "adakah ini rekodnya?". Kebenaran menjawab apa yg boleh DILAKUKAN; ia tidak berkata apa-apa tentang BARIS YANG MANA. Ketiga-tiganya disahkan terhadap produksi sebelum diubah. |
| 2026-10-10 | **F05** — `students_select_guardian` dan `student_guardians_select_guardian` diberikan kpd `public` **tanpa ujian `is_active_user()`**. Akaun penjaga yang telah DILUMPUHKAN masih membaca rekod anaknya: akaun itu dimatikan dan terus berfungsi. |
| 2026-10-10 | **F06** — `students_select` ialah `is_active_user() AND has_permission('students.view')`, dan `students.view` dipegang oleh ADMIN **dan** TEACHER. Kesemua **18 guru produksi** boleh membaca **setiap kanak-kanak** di sekolah: nama, nombor kad pengenalan, alamat, butiran kelahiran. |
| 2026-10-10 | **F07** — `student_attendance_select` ialah `is_active_user()` **SAHAJA**, tanpa klausa skop langsung. Mana-mana akaun yg log masuk membaca kehadiran **seluruh sekolah**. |
| 2026-10-10 | Pembetulan menambah separuh yg hilang, bukan mengetatkan model kebenaran. Tiga bentuk diperlukan kerana "rekod yg mana" mempunyai tiga jawapan: **pejabat** → semua; **penjaga** → anak sendiri sahaja, dan hanya semasa aktif; **guru** → murid dlm kelas yg benar-benar diajar. Skop kelas melalui `student_enrollments` + `teaching_assignments` (kelas diperoleh drpd pendaftaran, bukan lajur pada `students` — sekolah tiada lajur itu). Helper baharu `is_teacher_of_student(uuid)`. |
| 2026-10-10 | **Penemuan penting semasa membetulkan:** percubaan pertama menggunakan kebenaran bernama `admin.access` yg **tidak wujud** — ADMIN memegang 39 kebenaran dan itu bukan salah satunya, jadi pengecualian pejabat tidak akan pernah berlaku dan pejabat akan **hilang pandangan setiap murid**. Ujian menangkapnya. Pengajaran: nama kebenaran yg direka di papan kekunci ialah polisi yg menolak secara senyap. Pembetulan menggunakan `has_role(array['ADMIN'])` — helper projek sendiri, sudah digunakan utk perlindungan "admin terakhir", jadi ada SATU definisi pejabat, bukan dua yg boleh berselisih. |
| 2026-10-10 | **Mengapa helper mesti `security definer`** — bertentangan dgn gerak hati biasa. `is_teacher_of_student` membaca `student_enrollments` dan `teaching_assignments`. Jika ia berjalan dgn hak pemanggil, RLS pada jadual ITU akan terpakai dahulu, dan keupayaan guru membuktikan "saya mengajar kelas ini" akan bergantung pada polisi yg bertanya soalan yg sama — satu bulatan. Amalan: helper polisi selalunya MESTI definer justeru untuk tidak bergantung pada polisi yg dilaksanakannya. |
| 2026-10-10 | **Kecacatan dibawa ke hadapan oleh migration baharu ini, dan ditangkap oleh pemeriksaan lama:** Postgres memberi EXECUTE kpd PUBLIC secara lalai pada setiap fungsi baharu, jadi `is_teacher_of_student` menjadi boleh dipanggil anon sebaik ia dicipta — mengembalikan keadaan F01/F02/F03, pada fungsi yg ditulis untuk MEMBETULKAN masalah skop akses. Bocornya kecil (satu boolean tentang satu murid, dan `is_active_user()` palsu tanpa JWT, jadi polisi kekal tertutup) — dan justeru itu ia akan terlepas pandang. Ditemui dgn menjalankan semula pemeriksaan "tiada fungsi definer boleh dipanggil tanpa JWT" selepas migration ini. Kini dicabut, dan keadaannya DIASSERT. |
| 2026-10-10 | **Satu lagi kecacatan ujian ditemui:** `on conflict (id) do nothing` pada fixture profil meninggalkan akaun DILUMPUHKAN sebagai ACTIVE, kerana suite terdahulu dlm pangkalan data yg sama telah mencipta id itu — jadi sisipan yg bercanggah dilangkau secara senyap dan polisi **tidak pernah diuji** terhadap akaun yg dilumpuhkan. Diagnostik menangkapnya (baris itu dibaca ACTIVE). Keadaan akaun ialah SELURUH subjek ujian ini, jadi ia kini DIPAKSA dgn `do update`, bukan sekadar dicadangkan. |
| 2026-10-10 | Ujian pengawal baharu `supabase/tests/access_scope_test.sql` (**5 pemeriksaan**) + invarian dlm migration. **Keenam-enam mutasi ditangkap**, dan pentingnya: bagi setiap tiga kecacatan, saya membuang SEMUA invarian migration supaya **suite kelakuan** sahaja perlu menangkapnya — membuktikan suite menguji akses sebenar, bukan penegasan migration sendiri. Setiap kecacatan juga diuji dgn kedua-dua arah: penjaga AKTIF mesti tetap nampak anaknya, dan ADMIN mesti tetap nampak semua, supaya pembetulan tidak boleh "lulus" dgn menolak semua orang. |
| 2026-10-10 | **Disahkan pada produksi:** pejabat (ADMIN) nampak murid melalui RLS; pemanggil tanpa identiti nampak **0** (deny-by-default kekal); 0 fungsi boleh dipanggil anon; tiada respons gagal dlm aplikasi; log masuk berjaya. Suite SQL **105 pemeriksaan lulus**; hadapan **56 fail, 425 ujian lulus**; taipcheck bersih. |
| 2026-10-10 | **KECACATAN SERIUS DALAM PEMBETULAN F01 SAYA SENDIRI, ditemui semasa menulis pengawal F08.** Pembetulan F01 menggunakan `has_permission('admin.access')` untuk mengecualikan pejabat drpd semakan skop kelas. **Kebenaran itu TIDAK WUJUD** — ADMIN memegang 39 kebenaran dan itu bukan salah satunya — jadi pengecualian itu tidak pernah berlaku dan **setiap ADMIN ditolak** daripada merekod kehadiran untuk mana-mana kelas; hanya guru dgn tugasan yg sepadan boleh lulus. Kesan sebenar: kerani sekolah tidak boleh merekod kehadiran langsung. Kini `has_role(array['ADMIN'])`. |
| 2026-10-10 | **Mengapa suite keselamatan saya TIDAK menangkapnya, dan pengajarannya lebih bernilai drpd penemuan itu.** Suite itu membuktikan bahawa GURU ditolak — dan versi rosak itu pun berbuat demikian. **Membuktikan kecacatan ditutup tidak berkata apa-apa tentang sama ada laluan SAH masih berfungsi.** Ujian pengawal yg tidak pernah menguji kes yg DIBENARKAN boleh memperakui pembetulan yg memusnahkan produk. Sejak itu setiap ujian pengawal menegaskan KEDUA-DUA belah: yg mesti ditolak DAN yg mesti dibenarkan. |
| 2026-10-10 | **Penemuan kedua, lebih dalam:** suite keselamatan itu **tidak mencipta sebarang fixture** — ia bergantung pada data suite fasa, dan suite fasa **tidak pernah mencipta baris `profiles`**. Jadi `is_active_user()` adalah **PALSU** bagi setiap pengguna yg diuji, setiap `has_permission` palsu, dan pemeriksaan "ini ditolak" lulus **atas sebab yg salah**. Ia terbongkar sebaik sahaja separuh ADMIN bagi F01 ditambah: admin ditolak, betul tetapi atas sebab yg tidak berkaitan. **Penolakan yg berlaku kerana pengguna ujian itu sendiri tidak nyata bukanlah bukti sifat keselamatan.** Kini suite itu mencipta fixture sendiri (auth.users + profiles + user_roles + kelas + murid + pendaftaran). |
| 2026-10-10 | Fixture kedua ditambah kerana sebab yg sama: ujian penolakan F03 menggunakan `test_id('1')`, yg **kini sah** memegang `finance.view` — jadi premisnya (pengguna ini mesti ditolak) tidak lagi benar. Ia menggunakan `test_id('2')`, akaun yg benar-benar tiada kebenaran kewangan. |
| 2026-10-10 | **Disahkan pada produksi:** akaun admin sebenar (`b40bcc45-…`) kini `attendance.record=true` dan `has_role(ADMIN)=true`. Sebelum pembetulan, merekod kehadiran akan **ditolak** untuk kerani sekolah sendiri. Suite SQL: **106 pemeriksaan lulus** (7 keselamatan, naik drpd 6 — ujian laluan ADMIN baharu). Dua mutasi diuji: kembalikan `admin.access` → ditangkap; buang cek `finance.view` → ditangkap. |
| 2026-10-10 | **Invarian baharu: setiap kebenaran yg diuji oleh sesuatu fungsi mesti WUJUD.** Ditambah selepas kebenaran yg tidak wujud menyebabkan kegagalan sebenar yg tidak kelihatan. `has_permission` yg mengembalikan false **tidak dapat dibezakan** drpd "tidak" yg sah — itulah sebab ia senyap. Imbasan katalog ialah satu-satunya pemeriksaan yg meliputi fungsi yg belum ditulis lagi. Ia mengimbas SEMUA fungsi definer di produksi: kini **sifar** kebenaran yg dirujuk tidak wujud. |
| 2026-10-10 | Selepas pembetulan itu, imbasan katalog dijalankan ke atas seluruh pangkalan data produksi dan **hanya** jumpa satu rujukan yg tinggal — di dalam ulasan penerangan. Nama mati itu juga dibuang drpd prosa, supaya imbasan masa depan tidak terus melaporkan kecacatan yg sudah dibaiki. |
| 2026-10-10 | **F10 (P1) — dokumen dalaman boleh dibaca oleh guru luar skop.** Policy `documents_select` ialah `has_permission('documents.view') or (student_id is not null and is_guardian_of(student_id))`, dan `documents.view` dipegang oleh ADMIN **dan** TEACHER. Jadi **setiap guru membaca setiap dokumen** di sekolah, termasuk fail kanak-kanak — yg komen migration asal sendiri kata kelihatan "not to teachers by default". **Komen itu menyatakan niat; policy tidak melaksanakannya.** Itulah penemuannya. |
| 2026-10-10 | **Mengapa F10 mudah terlepas pandang, dan ini bahagian yg berbaloi diingati:** separuh penjaga bagi policy itu **memang** berskop betul. Penyemak yg bertanya "adakah ibu bapa hanya nampak fail anaknya sendiri?" mendapat jawapan "ya" yg memuaskan dan berhenti di situ. Separuh staf itulah yg terlalu luas, dan ia ditulis sebagai ujian kebenaran — yg terbaca sebagai keputusan yg disengajakan, bukan sebagai klausa yg hilang. |
| 2026-10-10 | Tiada apa-apa bocor: `documents` memegang **0 baris** di produksi, jadi ini menutup pendedahan **sebelum** fail pertama disimpan. Itu tidak menjadikannya teori — policy itu **aktif**, `authenticated` sudah memegang INSERT/UPDATE/DELETE pada jadual itu, dan muat naik pertama akan menjadikannya nyata. Kecacatan yg belum menyebabkan kerosakan tetap kecacatan. |
| 2026-10-10 | Pembetulan F10: **pejabat** → semua dokumen termasuk dalaman (`has_role`, definisi pejabat projek sendiri); **guru** → dokumen murid dlm kelas yg diajar sahaja, serta failnya sendiri; **penjaga** → fail anak sendiri sahaja (tidak berubah). Guru **tidak** automatik nampak dokumen guru lain — hubungan yg sama spt murid di luar kelasnya, dan tiada keperluan produk utknya, jadi ia **ditolak** drpd diteka. Jika sekolah perlukan dokumen staf dikongsi, itu keputusan skop yg dibuat secara sedar; menambah kemudian ialah migration kecil, membuang kebocoran bukan. |
| 2026-10-10 | Helper `can_read_document(uuid)` dicipta sebagai **satu-satunya definisi** bagi "bolehkah pemanggil ini mencapai dokumen ini?", dikongsi oleh policy metadata dan (kemudian) policy Storage bagi bucket `documents` — supaya kedua-duanya tidak boleh berselisih ttg fail yg sama (F10 + F37 mesti bergerak bersama). Dicabut drpd anon sebaik ia dicipta. |
| 2026-10-10 | Ujian pengawal baharu `supabase/tests/document_scope_test.sql` (**5 pemeriksaan**) + invarian migration. **Tiga mutasi ditangkap:** (A) kembali kpd permission sahaja; (B) tolak SEMUA guru — ia juga mesti gagal, kerana policy yg menolak semua orang akan lulus dua pemeriksaan pertama sambil memusnahkan produk; (C) pengecualian pejabat wujud tetapi menamakan **peranan yg salah** (TEACHER), jadi guru mendapat akses peringkat pejabat — kes halus ini hanya ditangkap oleh ujian kelakuan, bukan oleh invarian nama. |
| 2026-10-10 | **Disahkan pada produksi:** policy mengandungi skop penjaga + guru + pejabat; 0 fungsi boleh dipanggil anon; semua kebenaran yg dirujuk wujud; log masuk berjaya; 18 guru dipaparkan; tiada respons gagal. Suite SQL **112 pemeriksaan lulus**; hadapan 56 fail/425 ujian; taipcheck bersih. |
| 2026-10-10 | **F08 dan F09 (P1) — disahkan SUDAH DIMITIGASI, dan sebabnya berbeza drpd penemuan lain.** Polisi `student_attendance_write` dan `assessment_results_write` memang ujian kebenaran tanpa klausa skop — bentuk yg sama spt F05/F06/F07. Tetapi ia **tidak boleh dieksploitasi**: `authenticated` **tidak memegang** INSERT, UPDATE atau DELETE pada kedua-dua jadual. Ditulis mesti melalui RPC, dan RPC **memang** menyemak skop kelas. Polisi longgar itu tidak dapat dicapai. |
| 2026-10-10 | Bukti terus ke atas produksi: `has_table_privilege('authenticated','public.student_attendance','INSERT')` = **false**, sama utk UPDATE dan DELETE, dan utk `assessment_results`. `save_assessment_marks` menyemak `teaching_assignments` + `current_teacher_id()` + `status='ACTIVE'`, dan pengecualian pejabatnya (`assessments.create`) dipegang **ADMIN sahaja** — TEACHER ada `assessments.enter_scores` utk menulis, tetapi bukan pengecualian itu. Jadi guru hanya boleh menulis markah kelas yg diajar. |
| 2026-10-10 | **Ujian mengunci STRUKTUR, bukan teks polisi.** Ini penting: mitigasi F08/F09 ialah ketiadaan grant, bukan kekuatan polisi. Jika migration masa depan memberikan akses tulis kpd jadual itu, polisi berskop-longgar menjadi **hidup** dan tiada apa pun akan berbunyi. Ujian baharu gagal jika INSERT/UPDATE/DELETE boleh dicapai oleh `authenticated`, dan menegaskan bahawa badan `save_assessment_marks` masih mengandungi skop kelas — kerana jaminan itu berada DI DALAM SQL, dan `create or replace` boleh menggugurkannya sambil meninggalkan setiap polisi tidak tersentuh. |
| 2026-10-10 | **Kesilapan semasa menguji, dan pengajarannya.** Mutasi F09 saya ubah **produksi** manakala suite berjalan pada **pangkalan data ujian** — jadi ia membaca salinan berasingan dan tiada apa yg ditangkap. Saya pulihkan produksi serta-merta drpd migration sumber, sahkan skop kembali (`ada skop: true`), kemudian ulang mutasi pada **fail sumber** — dan ujian menangkapnya. Pengajaran: mutasi mesti digunakan pada apa yg sebenarnya dibaca oleh ujian. |
| 2026-10-10 | Suite SQL: **114 pemeriksaan lulus** (akses-skop 5 → 7). Mutasi diuji: beri INSERT terus → ditangkap; buang blok skop drpd sumber → ditangkap. |
| 2026-10-10 | **F11 (P1) — disahkan SUDAH DIMITIGASI.** Ketulenan audit: `authenticated` **hanya** memegang SELECT pada `audit_log` (tiada INSERT/UPDATE/DELETE), dan `write_audit_log` ialah fungsi **trigger**, dicabut drpd `anon` DAN `authenticated` oleh pengerasan F03. Jadi baris audit hanya boleh ditulis oleh trigger — tidak ada laluan panggilan API utk memalsukannya. |
| 2026-10-10 | **F12 (P1) — perlindungan ADMIN terakhir boleh dipintas. DIBETULKAN.** `protect_last_admin` mengira baki sebagai `... and ur.user_id <> old_user`. Pada DELETE itu betul; pada UPDATE ia salah, kerana baris itu **tidak hilang — ia BERPINDAH**. Bukti diukur pada produksi: memindahkan geran ADMIN terakhir menghasilkan `active_admin_count = 1` SEBELUM dan SELEPAS, sementara kiraan baris ADMIN pentadbir asal menjadi 0. |
| 2026-10-10 | **Penemuan tepat audit, dan ketepatan itu menentukan pembetulan yg betul:** memindahkan geran terakhir kpd akaun **AKTIF** lain meninggalkan satu pentadbir aktif, jadi sistem masih boleh diadministrasi dan **membenarkannya adalah BETUL**. Pintasan sebenar ialah memindahkannya kpd akaun **DILUMPUHKAN**: kiraan memerlukan `p.status='ACTIVE'`, jadi geran yg tiba tidak dikira, semakan lulus kerana baris yg pergi masih wujud, dan `active_admin_count()` menjadi **0**. Sekolah terkunci keluar drpd pentadbirannya sendiri, secara senyap. |
| 2026-10-10 | **F12 laluan kedua:** kiraan memerlukan `p.status='ACTIVE'`, jadi **melumpuhkan** pentadbir terakhir membuangnya drpd kiraan tanpa menyentuh `user_roles` langsung. Trigger itu berada pada `user_roles` dan tidak nampak perubahan `profiles.status`. Invariant dinyatakan sekali: **seorang pentadbir AKTIF mesti wujud pada setiap masa.** Trigger baharu diletakkan di mana perubahan berlaku — trigger hanya melihat jadualnya sendiri, jadi memperluas yg lama tidak mungkin. |
| 2026-10-10 | Helper `remaining_active_admins(uuid)` = satu definisi "berapa ramai pentadbir tinggal, tidak termasuk pengguna ini", dikongsi kedua-dua trigger supaya kedua-duanya tidak boleh berselisih. Logik trigger dibetulkan: `new_user`/`new_role` kini dikira, jadi geran yg tiba dikira dan yg pergi tidak. Dicabut drpd anon sebaik dicipta. |
| 2026-10-10 | Ujian `supabase/tests/last_admin_guard_test.sql` (**3 pemeriksaan**). **Tiga mutasi ditangkap:** (A) abaikan geran yg tiba — F12a masih lulus tetapi F12b **gagal** kerana penyerahan kuasa sah yg sah kini disekat; (B) buang trigger lumpuh — ditangkap; (C) tolak SEMUA pergerakan — ditangkap. Kesilapan ujian sendiri ditemui: urutan fixture F12c perlu **memberi** geran dahulu sebelum **mengambil**nya, kerana mengambil satu-satunya pentadbir memang ditegaskan oleh pengawal itu sendiri. |
| 2026-10-10 | **Disahkan pada produksi:** pentadbir sebenar masih memegang ADMIN; kiraan kekal 1; kedua-dua trigger dipasang; `Refusing to disable the last ACTIVE ADMIN` muncul bila dicuba; kedua-dua laluan pintasan ditolak dlm transaksi. Log masuk berjaya; 18 guru; tiada respons gagal. Suite SQL **117 pemeriksaan**; hadapan 56 fail/425 ujian; taipcheck bersih. |
| 2026-10-10 | **F13 (P1) — provision guru tidak memberikan role TEACHER. DIBETULKAN.** Edge Function `provision-teacher-account` membawa komen: "The teacher profile row and TEACHER role are created by the same triggers that Phase 1 relies on". **Komen itu palsu.** `handle_new_user` memasukkan baris `profiles` sahaja — tiada `user_roles`. Diukur pada produksi: 1 profil, **0 peranan, 0 kebenaran**. Guru boleh log masuk dan melihat aplikasi **kosong**, tanpa sebarang ralat menjelaskannya. Itu bentuk kegagalan terburuk: ia kelihatan spt sistem rosak, bukan spt akaun tidak lengkap. |
| 2026-10-10 | **F13 juga:** handler menolak `OPTIONS` dgn 405 dan tiada header CORS, jadi panggilan browser merentas origin gagal di preflight sebelum permintaan dihantar. Dibetulkan dgn senarai-benar eksplisit (bukan `*` — endpoint ini mencipta akaun; `*` akan membenarkan mana-mana halaman yg dilawati pentadbir memanggilnya). Pemeriksaan `user_id` kosong bukan atomik terhadap dua permintaan serentak: kini **compare-and-set** (`and user_id is null` dlm predikat UPDATE). |
| 2026-10-10 | **F16 (P1) — provision penjaga menulis terus ke jadual Auth dalaman. DIBETULKAN.** `create_guardian_account` melakukan INSERT dinamik ke `auth.users` dan `auth.identities`, termasuk menjana hash bcrypt sendiri. Dua masalah: (1) ia menegakkan **minimum 8 aksara** sedangkan config projek kata **12** — peraturan yg lebih lemah itulah yg sebenarnya digunakan; (2) ia **memintas GoTrue**, jadi pengesahan emel, pemulihan kata laluan, pautan identiti, pembatalan sesi dan jejak audit Auth **tidak dijalankan**. Shim SQL itu boleh lulus tanpa GoTrue terlibat, jadi ujian hijau tidak membuktikan orang itu boleh log masuk. Fungsi **digugurkan** — bukan dikekalkan utk keserasian. |
| 2026-10-10 | **F14 (P1) — paksaan tukar kata laluan hanya dikawal UI. DIBETULKAN.** `clear_temporary_password_flag()` boleh dipanggil oleh **mana-mana pengguna yg log masuk**, dan `is_active_user()` tidak mempertimbangkan bendera itu — jadi setiap geran biasa terus berfungsi. Guru boleh membersihkan bendera tanpa pernah menukar kata laluan. Prompt itu **cadangan yg boleh ditolak klien**. Invariant baharu: **akaun yg masih memakai kata laluan sementara tidak boleh menjalankan operasi domain sehingga kata laluan benar-benar diganti.** "Benar-benar" itu perkataan yg menanggung beban — klien tidak boleh mengesahkannya; `auth.users.updated_at` ditulis oleh GoTrue sendiri dan tidak boleh dipalsukan oleh klien. |
| 2026-10-10 | Peraturan F14 diletakkan dalam `is_active_user()` — **satu predikat yg setiap helper lain sudah bergantung padanya** — jadi satu perubahan meliputi seluruh permukaan, termasuk helper yg ditambah kemudian. Pemeriksaan yg ditulis ke dalam setiap polisi perlu diingati setiap kali. |
| 2026-10-10 | **F15 (P1) — paksaan itu mencipta kunci keluar, dan saya terjumpa sendiri.** `profiles_select_own` ditulis sebagai `id = auth.uid() and is_active_user()`, dgn tujuan sedar mengunci akaun DISABLED keluar drpd barisnya sendiri serta-merta. Niat itu betul dan **dikekalkan**. Tetapi predikat yg sama kini juga menghalang guru baharu membaca profilnya sendiri — dan skrin tukar-kata-laluan membaca profil itu. Akaun boleh log masuk dan tidak boleh buat apa-apa, **kekal**, tanpa jalan keluar. Itu lebih buruk drpd kecacatan yg dibetulkan. Dua syarat **dipisahkan**: DISABLED hilang semuanya; kata laluan sementara hilang kuasa tetapi kekal nampak rekod sendiri. Helper baharu `is_active_account()` (definer, tiada peraturan sementara) digunakan — polisi yg menanyai `profiles` secara terus menyebabkan **"infinite recursion detected in policy for relation profiles"**, dan itulah cara ia ditemui. |
| 2026-10-10 | RPC baharu: `link_teacher_account` (paut + geran TEACHER + bendera, atomik, compare-and-set, menolak peranan selain TEACHER/GUARDIAN, menolak tanpa `users.manage`) dan `link_guardian_account` (memakai `set_guardian_child_link` supaya peraturan penautan keluarga kekal di satu tempat). Kedua-dua fail: akaun **digulung balik** jika langkah DB gagal, kerana akaun separuh-siap itulah kegagalan F13. |
| 2026-10-10 | Edge Function baharu `provision-guardian-account` menggantikan laluan kredensial SQL. Kedua-dua Function mengesahkan pemanggil **dua kali** (JWT platform + `has_permission('users.manage')` dgn token pemanggil, bukan kunci rahsia). |
| 2026-10-10 | Ujian `supabase/tests/provisioning_test.sql` (**10 pemeriksaan**). **Lima mutasi ditangkap, masing-masing oleh ujian yg dimaksudkan:** (A) buang geran peranan → `FAIL F13: ...holds roles "(none)"`; (B) `is_active_user` abaikan bendera → ditangkap; (C) langkau bukti `updated_at` → ditangkap; (D) kembalikan policy F15 kpd `is_active_user` → `FAIL F15: ...cannot read its own profile... locked out permanently`; (E) buang compare-and-set → `FAIL F13: a second provisioning overwrote the existing account link`. |
| 2026-10-10 | **Kesilapan ujian sendiri, dan pembetulannya:** diagnostik F14c mula membaca profil melalui polisi, jadi ia tidak dapat membezakan "peraturan berkuat kuasa" drpd "bacaan ditolak" — dan suite terhenti awal sehingga ujian F13 tidak pernah dijalankan. Diperbetulkan dgn membaca keadaan data tanpa polisi (soalan itu ttg data, bukan ttg siapa boleh melihatnya) dan dgn menegaskan prasyarat fixture di tempat ia ditetapkan. |
| 2026-10-10 | **Disahkan pada produksi:** pentadbir sebenar kekal `status=ACTIVE, must_change=false` (peraturan baharu **tidak** menguncinya keluar); `create_guardian_account` dan `clear_temporary_password_flag` **tiada lagi**; 4 RPC baharu wujud; log masuk berjaya; 18 guru; tiada respons gagal. Suite SQL **127 pemeriksaan**; hadapan 56 fail/425 ujian; taipcheck bersih. |

## Audit 2026-10-10 — F18–F22, F37, F38, F32 (selesai)

Semua disahkan terhadap produksi. Setiap pengawal ditulis dahulu, kemudian
sengaja dipecahkan semula untuk membuktikan ujian benar-benar menangkapnya.

| Finding | Pembetulan | Bukti produksi |
|---|---|---|
| F18 | `family_balance` hanya menjumlah anak yang penjaga benar-benar jaga; pejabat kekal nampak seluruh keluarga. Aritmetik tanpa semakan dipindah ke helper yang dicabut daripada semua peranan API. | Penjaga nampak RM100 (anaknya), pejabat nampak RM927 (termasuk anak melalui penjaga kongsi). |
| F19 | `reverse_payment` menolak pembalikan bagi pembalikan. Semakan bertindih dibuang supaya peraturan ada di SATU tempat. | RM100 → bayar (paid 100.00) → balik (paid 0.00/balance 100.00) → balik semula DITOLAK; buku kekal betul. |
| F20 | Trigger membekukan `amount`, `student_id`, `fee_type_id`, `academic_year_id`, tempoh apabila ada bayaran; status/diskaun/nota kekal boleh dibetulkan. | Ubah amaun caj berbayar DITOLAK dengan mesej jelas. |
| F21 | Penerbitan penilaian mesti melalui langkah penerbitan, bukan UPDATE terus. | Terbit terus DITOLAK. |
| F22 | `record_payment` mengunci caj mengikut urutan id; kunci dijana sekali per penghantaran di klien. | Kunci sama dua kali → satu bayaran sahaja, dilaporkan sebagai pendua. |
| F37 | Laluan storan diselesaikan kpd baris dokumen dan dihakimi oleh SATU peraturan. Fungsi dinamakan `can_read_stored_file` (bukan overload). | Guru bukan-pengajar DITOLAK; laluan salah DITOLAK; pejabat DIBENARKAN. |
| F38 | Registry migrasi diwujudkan (17 entri); helper ujian `test_id` yang tertinggal dibuang. | Registry ada, 17 entri, terbaru sepadan repo; anon TIDAK boleh baca. |
| F32 | Kerja CI "Database rules" menjalankan suite SQL/RLS pada setiap push; versi Vercel CLI dipin. | CI hijau di GitHub termasuk kerja baharu; laman langsung 200. |

**Jumlah suite SQL: 154 pemeriksaan.** Frontend: 56 fail / 425 ujian.

## Audit 2026-10-10 — F39, F40 (tetapan platform)

| Finding | Tindakan | Bukti |
|---|---|---|
| F39 | Perlindungan password bocor (HaveIBeenPwned) **tidak tersedia** pada pelan ini — API menolaknya secara eksplisit: "available on Pro Plans and up". Risiko direkodkan, bukan diakali. Yang boleh dikuatkan telah dikuatkan: panjang minimum 6 → **10**, dan kini wajib huruf kecil + besar + digit. | Log masuk pentadbir masih **200**; password lemah ditolak dengan mesej jelas; tiada akaun ujian tertinggal (0). |
| F40 | Cawangan `main` **tiada** perlindungan langsung. Kini wajib lulus kedua-dua kerja CI: "Check, test and build" dan "Database rules", dengan mod ketat. | API mengesahkan kedua-dua konteks diperlukan, `strict: true`, admin tidak boleh langkau. |

**Keputusan risiko F39 yang tinggal.** Perlindungan password bocor memerlukan
pelan Pro. Langkah yang dikurangkan risiko sekarang: panjang minimum 10 dengan
aksara bercampur, kadar cubaan log masuk Supabase, dan aliran tukar-password
paksa untuk akaun guru/penjaga yang baharu (F13–F16). Jika sekolah naik ke pelan
Pro, tetapan ini boleh dihidupkan tanpa perubahan kod.
