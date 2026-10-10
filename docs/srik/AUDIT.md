# AUDIT — Fasa 0: Audit sumber dan pelan refactor

Tarikh audit: 7 Oktober 2026
Auditor: coding agent (Fasa 0 sahaja)
Skop: audit sahaja — **tiada** perubahan architecture, feature atau penghapusan kod dilakukan dalam fasa ini.

Rujukan: `01_DECISIONS.md`, `02_PHASE_0_AUDIT.md`, `AGENTS.md`.

---

## 1. Identiti sumber (source revision)

| Perkara | Nilai sebenar (disahkan) |
|---|---|
| Remote | `https://github.com/Oliskey-School/School-app-` |
| Branch | `main` (default; `origin/HEAD -> origin/main`) |
| Commit | `910cf09ffff48c8f226a1af600cde1be01e30736` (short `910cf09`) |
| Commit date | 2026-10-07 15:21:34 +0100 |
| Commit subject | `version 0.8.2 — production API no longer crashes at boot without GOOGLE_CLIENT_ID` |
| Total commits | 671 |
| `package.json` version | `0.8.0` (tidak sepadan dengan subject commit `0.8.2` — jangan percaya nombor versi sahaja) |
| `package-lock.json` version | `0.7.56` sebelum audit — **tidak sepadan dengan `package.json` `0.8.0`**. `npm install` membetulkannya kepada `0.8.0` secara automatik. Ini satu-satunya perubahan fail yang berlaku semasa audit (2 baris, bukan kod) |
| Working tree | bersih sebelum audit; `dist/` + `node_modules/` dijana semasa audit, tidak di-commit |
| Tags | `0.5.15`, `v0.5.24`, `v0.5.43`, `v0.5.44`, `v0.7.20`, `v0.7.22`, `v0.7.23`, `v8.3`, `v8.3A`, `v8.3B` |

**Nota `01_DECISIONS.md`:** spesifikasi mengingatkan nama repo dieja berbeza (Oliskey/Othiskey) dan source belum diperiksa. Audit ini mengesahkan repo sebenar ialah `Oliskey-School/School-app-` pada commit di atas. Kod dalam repo ini secara konsisten menggunakan jenama **"Oliskey"**.

**Reality check penting:** `CLAUDE.md` (root) mendakwa "This app is not on Supabase — it's a self-hosted PostgreSQL database". Ini **bertentangan** dengan `01_DECISIONS.md` yang mengunci Supabase sebagai production backend. Lihat §9 (Konflik arahan).

---

## 2. Cara run + konfigurasi

### Skrip sebenar (`package.json`)

| Skrip | Perintah | Nota audit |
|---|---|---|
| `dev` | `vite` | Frontend sahaja, port 3000 (CLAUDE.md), proxy `/api` → `:5000` |
| `build` | `node scripts/generate-dark-theme.mjs && vite build` | **Lulus** (lihat §3) |
| `start` | `npx tsx backend/src/server.ts` | Backend Express, port 5000 |
| `server` | `nodemon` | Dev backend |
| `test` / `test:run` | `vitest` / `vitest run` | Frontend unit sahaja (`vite.config.mts` exclude `backend/**`, `tests/e2e/**`) |
| `db:migrate` / `db:deploy` / `db:push` / `db:reset` / `db:seed` / `db:studio` | Prisma | Memerlukan DB live |
| `build:backend` | `prisma generate && tsc -p backend/tsconfig.build.json && node scripts/link-prisma-dist.js` | Output CommonJS ke `backend/dist/` |
| `build:vercel` | `scripts/vercel-migrate.mjs` → build FE → build backend → copy Prisma client | Deploy Vercel |
| `postinstall` | `prisma generate` + `node scripts/patch-otplib.js` | Patch `otplib` diperlukan |
| `start:all` | `concurrently dev + server` | Dev penuh |
| `db:backup` / `db:restore` | `docker exec school-app-db pg_dump/psql` | Bergantung container Docker |

**Runtime yang diuji:** Node `v24.21.0`, npm `11.19.0`. Tiada `engines` field, tiada `.nvmrc` — versi Node tidak dipin. Dockerfile guna `node:20-alpine`; `backend/vitest.config.ts` mengandungi nota eksplisit tentang perbezaan tingkah laku Node 20 vs Node 24 dalam propagation async-context (perkaitan RLS). **Ini risiko cutover yang perlu diputuskan.**

### Env — nama sahaja (tiada nilai secret dibaca)

Daripada `.env.example`, `.env.production.example`, `backend/src/config/env.ts`:

**Browser (VITE_ — terdedah kepada bundle):**
`VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_AI_PROVIDER`, `VITE_GEMINI_API_KEY` (legacy/bahaya), `VITE_PAYSTACK_PUBLIC_KEY`, `VITE_FLUTTERWAVE_PUBLIC_KEY`, `VITE_FIREBASE_VAPID_KEY`, `VITE_APP_NAME`, `VITE_APP_VERSION`, `VITE_SENTRY_DSN`, `VITE_SENTRY_TRACES_SAMPLE_RATE`

**Server-only (backend/src/config/env.ts):**
`BACKEND_PORT`/`PORT`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `NODE_ENV`, `DEMO_SCHOOL_ID`/`DEFAULT_SCHOOL_ID`, `DEMO_BRANCH_ID`/`DEFAULT_BRANCH_ID`, `GOOGLE_TRANSLATE_API_KEY`/`GOOGLE_API_KEY`/`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `NVIDIA_NIM_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_GENAI_BASE_URL`, `GOOGLE_CLIENT_ID`, `DAILY_API_KEY`, `SMTP_USER`, `SMTP_PASS`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `REDIS_URL` (dirujuk `config/redis.ts`)

**Pemerhatian env (bukan secret, isu konfigurasi):**
- Tiada `.env` sebenar dalam repo (baik — tidak ada secret bocor dalam git).
- `IS_PRODUCTION` fail-fast jika `JWT_SECRET`/`REFRESH_TOKEN_SECRET`/`DATABASE_URL`/`SMTP_*`/`DIRECT_URL` hilang atau menggunakan fallback dev. Ini kawalan yang **baik dan perlu dikekalkan semangatnya** dalam Supabase.
- `.env.example` mengaku `VITE_GEMINI_API_KEY` boleh terdedah dalam bundle ("the key WILL be visible in the built JS") — bertentangan dengan `AGENTS.md` (Supabase secret keys must never enter frontend source).
- Fallback dev hardcoded: `postgresql://postgres:password123@127.0.0.1:5432/school_app`, `fallback-dev-secret-do-not-use-in-prod`.
- `DEMO_SCHOOL_ID`/`DEMO_BRANCH_ID` ialah **konsep tenant** yang wajib di-REMOVE mengikut `01_DECISIONS.md`.

---

## 3. Baseline validation (dijalankan dalam audit ini)

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| `npm install --legacy-peer-deps` | **LULUS** — 1394 pakej, 55s | Warnings: deprecated `glob@11.1.0`; 11 pakej ada install scripts belum dibenarkan (termasuk `@prisma/client`, `@prisma/engines`, `@google/genai`, `agent-browser`) |
| `npx tsc --noEmit -p tsconfig.json` (frontend) | **LULUS**, exit 0, tiada ralat | — |
| `npx tsc --noEmit -p backend/tsconfig.build.json` | **LULUS**, exit 0, tiada ralat | — |
| `npm run build` (frontend, 2×) | **LULUS**, exit 0 | 15 MB output; PWA `generateSW`, precache 15 entries (423.32 KiB); chunk terbesar `html2pdf` 961 kB (228 kB brotli) |
| `npx vitest run` (frontend unit) | **GAGAL 1/26 fail** | `Test Files 1 failed \| 25 passed (26)`; `Tests 1 failed \| 113 passed (114)`; 52s |
| `npx vitest run --config backend/vitest.config.ts` | **GAGAL 78/90 fail** | `Test Files 78 failed \| 12 passed (90)`; `Tests 31 failed \| 208 passed \| 711 skipped (950)`; 280s |

### Kegagalan sedia ada yang mesti direkod (baseline, bukan regresi)

**(a) Frontend unit — 1 kegagalan:**
```
FAIL components/subscription/__tests__/SubscriptionPage.demo.test.tsx
  > SubscriptionPage — live school copy
  > uses the real Paystack checkout, not the demo popup
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
```
Kegagalan ini berada dalam domain **SaaS subscription + Paystack**, iaitu modul yang `01_DECISIONS.md` kunci sebagai **REMOVE**. Ia akan hilang apabila modul dibuang, bukan dibaiki.

**(b) Backend integration — 78/90 fail fail-file (711 test skipped):**
Punca dominan **bukan logik kod** tetapi persekitaran:
- `ECONNREFUSED` × 58, rujukan `connect`/`pool` × ~1770 — **tiada PostgreSQL live** dalam persekitaran audit. `backend/vitest.config.ts` memerlukan `DATABASE_URL` sebenar + DB sebenar.
- 711 test **skipped** kerana `beforeAll` fixture setup gagal (gagal sambung DB), lalu suite skip diri.
- Kegagalan sebenar bukan-DB yang kelihatan: `401` × 31 (auth/tenant middleware menolak request ujian), `500` × 44, `jwt malformed`, `Invalid value undefined for datasource`, `Invalid URL`, `Grades can only be saved for students with Active status`.

**Kesimpulan baseline:** frontend typecheck/build bersih. Ujian memerlukan DB live; **baseline ujian backend tidak boleh dianggap "hijau"** dan mesti direkod sebagai keadaan semasa, bukan disalahkan pada perubahan SRIK. Kegagalan `subscription` + `payment-security` + `multi-tenant-security` semuanya berada dalam domain yang akan di-REMOVE atau di-REPLACE.

---

## 4. Peta architecture sebenar

### 4.1 Frontend (React + Vite + TypeScript)

- `App.tsx` (18 KB) — root: offline init, service worker, PWA, `runMigrations()` (IndexedDB), `syncEngine`, `cacheCleanupScheduler`, `ErrorBoundary`, banyak `lazyWithRetry`.
- `components/DashboardRouter.tsx` — lazy-load dashboard ikut role.
- `components/` — **576 fail** dalam 23 subfolder: `admin` (178), `teacher` (82), `student` (33), `parent` (32), `ui` (32), `inspector`, `proprietor`, `subscription`, `shop`, `rewards`, `alumni`, `payments`, `video`, `messaging`, `learning`, `settings`, `mobile`, `layout`, `shared`, `reports`, `attendance`, `auth`.
- `context/` — `AuthContext`, `BranchContext`, `ProfileContext`, `SocketContext`, `GamificationContext`.
- `contexts/SaaSContext.tsx` — konteks SaaS (REMOVE).
- `lib/` — 131 fail. Termasuk `api.ts` (**3939 baris**, "HybridApiClient" ~600 domain method), `lib/api/core.ts` (628 baris), `lib/api/eager.ts`, `database.ts`, `apiHelpers.ts`, `dexie-db.ts`, `cacheManager.ts`, `migrationManager.ts`, `demoFallback.ts`, `demoRealtime.ts`, `ai*.ts` (7 fail), `grading-utils.ts`, `pwaBranding.ts`.
- `services/` — 12 fail (`PaymentService.ts`, `RealtimeService.ts`, `financeService.ts`, dll).
- `hooks/` — 28 fail; majoriti `useRealtime*` (8 fail): `useRealtime`, `useRealtimeListener`, `useRealtimeNotifications`, `useRealtimeRefresh`, `useRealtimeResource`, `useRealtimeSubscription`, `useRealtimeSync`, `useDemoRealtime`.
- `api/index.js` — entry serverless Vercel.
- **TanStack Query:** 26 fail guna `@tanstack/react-query` (KEEP).
- **Redux:** `@reduxjs/toolkit` + `react-redux` dalam `package.json`, tetapi **0 fail** menggunakan `useSelector`/`createSlice`. → Pakej boleh di-REMOVE; tiada kod bergantung.

### 4.2 Backend (Express + Prisma + custom JWT + Socket.io + Redis/BullMQ)

- `backend/src/app.ts` (17.6 KB), `server.ts` (13.4 KB), `cluster.ts`.
- **93 fail `*.routes.ts`**, **94 fail `*.controller.ts`**, **~115 fail `*.service.ts`**. `routes/index.ts` me-mount **98 laluan**.
- Middleware: `auth.middleware.ts` (custom JWT HS256 + demo bypass), `tenant.middleware.ts`, `authorization.middleware.ts`, `csrf.middleware.ts`, `rateLimiters.ts`, `plan.middleware.ts`, `aiGate.middleware.ts`, `upload.middleware.ts`, `security.middleware.ts`, `materializeImages.middleware.ts`.
- `lib/tenantContext.ts` — `AsyncLocalStorage` membawa `{schoolId, branchId, userId, allowedBranchIds, platform}`; `runAsPlatform()` = RLS bypass terkawal.
- `config/` — `database.ts` (Prisma + set Postgres session vars + strip sensitive fields), `env.ts`, `redis.ts`, `rlsGate.ts`, `instrument.ts`.
- `generated/prisma-client/` (3 fail) + `backend/prisma/schema.prisma` (**167.8 KB, 198 model**).
- `.bak`/`_fix_tmp` fail wujud: `server.ts.bak`, `schema.prisma.bak`, `schema.prisma_fix_tmp` (kotoran yang perlu dibersihkan akhirnya).

### 4.3 Database

- **57 migration Prisma** dalam `backend/prisma/migrations/` (2026-03-29 → 2026-08-22).
- **RLS sudah wujud dan serius**, dua lapisan:
  - `20260822000000_row_level_security` — school-level `tenant_isolation` pada banyak table, guna `app.current_school_id` + `app.bypass_rls`.
  - `20260822010000_branch_level_rls` — branch-level, `app.current_branch_ids` (CSV), carve-out `branch_id IS NULL` untuk row school-wide, dan empty list = tiada sekatan branch (admin peringkat sekolah + PARENT).
  - Nota migration mengaku: "Until now isolation rested entirely on ~1,900 Prisma call sites each remembering its own school_id filter... the database had 0 policies." → **RLS ditambah baru-baru ini untuk menampung ~1,900 tapak panggilan.**
- `prisma/rls_policies.sql`, `backend/prisma/app_role.sql`, `backend/prisma/backfill_isolation.sql`.
- SQL legacy di root: `ddl.sql` (64.5 KB), `create_verification_table.sql`.
- DB Docker: **`postgis/postgis:17-3.5-alpine`** (PostGIS — `01_DECISIONS.md` kunci REMOVE).

### 4.4 Storage, workers, realtime, PWA, deploy

| Subsystem | Keadaan sebenar | Keputusan spec |
|---|---|---|
| Storage | AWS S3 SDK (`@aws-sdk/client-s3`, `s3-request-presigner`) + `fileStorage.service.ts`; ada `uploads/` tempatan | REMOVE → Supabase Storage |
| Realtime | Socket.io + `@socket.io/redis-adapter` + `SocketContext` + 8 hook `useRealtime*` | REMOVE → Supabase Realtime |
| Queue/worker | BullMQ + `ioredis` + `queue.service.ts`, crons (`notificationDigestCron`, `parentWatchdogCron`, `riskScanCron`, `subscriptionCron`) | REMOVE → RPC/Edge/Cron bila perlu |
| Cache/rate-limit | Redis + fallback in-memory | REMOVE untuk production target |
| Process mgr | PM2 (`ecosystem.config.cjs`/`.js`), `cluster.ts` | REMOVE daripada production target |
| PWA | `vite-plugin-pwa` `generateSW`, `public/sw.ts` (NetworkFirst, skip `/api/` + `supabase.co`), `manifest.json`, `offline.html`, `sync.worker.ts`, `dexie`/`idb-keyval` | ADAPT — v1 app shell + read-only cache sahaja |
| Deploy | `Dockerfile` (Express+Prisma runtime), `docker-compose.yml` (postgis + pgadmin + redis), `nginx.conf` + `nginx-api-proxy.conf` + `nginx-load-balancer.conf`, `modsec-oliskey-exclusions.conf`, Vercel (`vercel.json` + `api/index.js` serverless), Netlify (`netlify.toml`) | REMOVE backend Docker production stack |
| Native | Capacitor 8 (`android/` 53 fail, `ios/` 15 fail), `capacitor.config.ts` | DEFER, kekalkan compatibility jika murah |
| AI | NVIDIA NIM (default, melalui backend proxy), Gemini (fallback + `VITE_GEMINI_API_KEY` legacy), `aiGateway.service.ts`, `aiKnowledge`, `askAI`, `freeLearningResourcesCatalog` | Tidak disebut dalam KEEP/REMOVE core SRIK |
| Payments | Paystack (`react-paystack`) + Flutterwave (`FlutterwaveWrapper.tsx`) + `PaymentService.ts` | REMOVE (Paystack, Flutterwave) |
| Auth | Custom: `bcrypt` (10 rounds) + `jsonwebtoken` HS256 + refresh token + MFA (`otplib`) + Google Sign-In + CSRF (`csrf-csrf`) | REPLACE → Supabase Auth |
| FE session | `sessionStorage`: `auth_token`, `auth_refresh_token`, `active_dashboard_role`; `localStorage` fallback refresh token. **67 fail** sentuh `localStorage` | REPLACE |
| i18n | `i18next` + `react-i18next` + `lib/i18n` (banyak locale termasuk `zh`) | ADAPT |
| Vision/OCR/QR | `html5-qrcode`, `qrcode`, `sharp`, `tesseract`-like paths, `idVerification` | Semak semasa fasa berkenaan |
| Video | `@daily-co/daily-js`, `jitsi/` deploy, `virtual-class`, `conference` | Bukan core SRIK |
| Excel/PDF | `read-excel-file`, `jspdf`, `jspdf-autotable`, `html2canvas`, `html2pdf.js` | KEEP untuk report card (PDF) |

### 4.5 Ujian

- Frontend: `vite.config.mts` → `happy-dom`, exclude `backend/**` + `tests/e2e/**` + `*.spec.ts`.
- Backend: `backend/vitest.config.ts` → node env, `pool: forks`, `fileParallelism: false`, `isolate: true`, `setupFiles: tests/setup/platformScope.ts`, perlukan **DB live**.
- E2E: `tests/e2e/**` — 30+ spec Playwright (Playwright di devDeps; runner tidak dijalankan dalam audit ini).
- Lain: `tests/quality`, `tests/security`, `tests/seo`, `tests/*.test.tsx`, `test-utils.tsx`, `setupTests.ts`.
- `backend/tests/unit/` — 6 fail termasuk `rls-gate.test.ts`, `fileStorage.service.test.ts`.

---

## 5. Peta KEEP / ADAPT / REMOVE / DEFER

### 5.1 REMOVE — kod, route, menu, seed, package, konfigurasi

Bilangan fail yang menyentuh setiap istilah (indikatif, bukan senarai fail akhir):

| Modul | Fail | Bukti route/artifak |
|---|---|---|
| SaaS subscription / plan / billing | 171 (istilah `store`), + `subscription`, `plan`, `saas-analytics` | `routes/subscription.routes.ts`, `plan.routes.ts`, `saas-analytics.routes.ts`, `paymentPlan.routes.ts`, `components/subscription/`, `contexts/SaaSContext.tsx`, `plan.middleware.ts`, `prisma Plan` (skema:2343) |
| Paystack | 40 | `VITE_PAYSTACK_PUBLIC_KEY` (live dalam `.env.production.example`), `react-paystack` |
| Flutterwave | 20 | `components/payments/FlutterwaveWrapper.tsx` |
| Hostel | 15 | `routes/hostel.routes.ts`, `hostel.service.ts`, `prisma Hostel` |
| Scholarship | 10 | `scholarship.routes.ts`, `services/scholarship.service.ts`, 3 route mount |
| Sponsorship | 7 | `sponsorship.routes.ts` |
| Alumni | 15 | `alumni.routes.ts`, `components/alumni/` |
| Inspector | 45 | `routes/inspection.routes.ts`, `components/inspector/`, role `INSPECTOR` (6 fail) |
| Transport / bus | 35 | `transport.routes.ts`, `bus.routes.ts`, `transport.service.ts`, `TransportRoute` |
| Behavior | 67 | `behavior.routes.ts`, `behavior.service.ts`, `lib/behavior.ts` |
| Counseling | 23 | `counseling.routes.ts`, `CounselorDashboard` |
| Gamification | 30 | `games`, `gamification` routes, `game*.service.ts`, `rewards/`, `GamificationContext`, `classBattle*`, `canvas-confetti` |
| Governance/inspector/proprietor workflows | — | `governance.routes.ts`, `ProprietorDashboard`, `policy.routes.ts`, `sop.routes.ts` |
| Tempoh/tenant | — | `school_id` 498 fail, `schoolId` 377, `branch_id` 345, `branchId` 267, `tenant` 166 fail; `models School`(14), `Branch`(166), `SchoolMembership`(605), `BranchUserIdentity`(4025); `middleware/tenant.middleware.ts`, `lib/tenantContext.ts`, header `x-school-id`/`x-branch-id` |
| PostGIS | — | `docker-compose.yml` image postgis |
| Demo reset infra | — | `demoReset.service.ts`, `demoSeeder.service.ts`, `demoFallback.ts`, `demoRealtime.ts`, `useDemoRealtime`, `DEMO_SCHOOL_ID`/`DEMO_BRANCH_ID` |
| AI translation crawler | — | `translate.routes.ts`, `translate.service.ts`, `pretranslate.mjs`, `freeLearningResourcesCatalog.ts` |
| Student marketplace / shop / vendor | — | `store.routes.ts`, `vendor.routes.ts`, `components/shop/` |
| Nigerian compliance / TRCN / British curriculum | — | `compliance.controller`, `ComplianceOfficerDashboard`, `curricula_config @default(["NIGERIAN"])`, `curriculum_type` |
| Redux (pakej sahaja) | 0 guna | `@reduxjs/toolkit`, `react-redux`, `react-is` |
| Legacy backend stack | — | Express, Prisma, custom JWT, Socket.io, Redis, BullMQ, S3 SDK, PM2, `cluster.ts` |

### 5.2 KEEP (modul/domain)

Auth (dijadual semula atas Supabase), user/role/permission, guru, murid, penjaga, academic year/term, kelas/enrollment, subject/ClassSubject, teaching assignment, timetable, attendance guru/murid, assessment, report card, finance, announcements, documents, audit log.

Aset KEEP yang **sudah wujud** dalam repo: `components/admin` (178), `components/teacher` (82), `components/student` (33), `components/parent` (32), `components/attendance`, `components/reports`, `routes/academic.routes.ts`, `class.routes.ts`, `student.routes.ts`, `teacher.routes.ts`, `subject.routes.ts`, `attendance.routes.ts`, `timetable.routes.ts`, `teacherAssignment.routes.ts`, `exam.routes.ts`, `reportCard.routes.ts`, `fee.routes.ts`, `audit.routes.ts`, `notice.routes.ts`, `exam.service.ts`, `reportCard.service.ts`, `fee.service.ts`, `audit.service.ts`, `term.service.ts`.

### 5.3 ADAPT

- React/Vite/TS frontend — **kekalkan**, jangan rewrite framework.
- TanStack Query (26 fail) — kekalkan sebagai lapisan query.
- PWA — perkecil kepada app shell + reference-data read-only.
- i18n — kekalkan, tetapi semak keperluan BI/BM.
- `components/ui` (32) + `tailwind` + `lucide-react` + `framer-motion` + `clsx`/`cva`/`tailwind-merge` — kekalkan design system.
- Formik (5 fail) / Yup (6 fail) — boleh retain sementara; RHF+Zod untuk kod **baru**.
- Capacitor — kekalkan compatibility jika murah, defer native release.
- E2E harness (`tests/e2e`) — nilai tinggi untuk acceptance evidence; jangan buang.
- `lib/grading-utils.ts` — semak terhadap `06_PHASE_4` (grade boundaries = PROPOSED konfigurasi).

### 5.4 DEFER

PBD penuh (LearningStandard/PBDRecord/evidence), portal penjaga (PARENT role), login murid (STUDENT role), offline attendance/marks writes, discipline, SEGAK, transport, native app, timetable solver, heavy background worker. Rujuk `09_DEFERRED_ROADMAP.md`.

---

## 6. Peta data + UI legacy → target

### 6.1 Pemetaan entity (legacy → SRIK target)

| Legacy (Prisma) | SRIK target | Tindakan |
|---|---|---|
| `School` (subscription fields, `plan_id`, `paystack_*`, `curricula_config`, `term_amount` Naira) | `SchoolProfile` (singleton, konfigurasi sahaja) | ADAPT + buang semua field billing/tenant |
| `Branch` | — | REMOVE (single-school) |
| `SchoolMembership`, `BranchUserIdentity` | — | REMOVE |
| `Plan` + `subscription*` | — | REMOVE |
| `User` (custom password/JWT/MFA) | `auth.users` → `profiles` | REPLACE |
| role strings `SUPER_ADMIN / PROPRIETOR / INSPECTOR / COMPLIANCE_OFFICER / EXAM_OFFICER / COUNSELOR / BRANCH_ADMIN` | `ADMIN`, `TEACHER` + permission table | REPLACE |
| `Teacher` | `Teacher` (tambah `user_id` nullable unique, `staff_code`) | ADAPT |
| `Student` (+ `current_class`-like) | `Student` + `StudentEnrollment`; tiada current_class authoritative | ADAPT + normalisasi |
| `Parent` (istilah legacy) | `Guardian` + `StudentGuardian` | RENAME/ADAPT — **semak** sama ada `Parent` sudah jadi penjaga atau pendua |
| `Class`, `Subject` | `Class` (per academic_year), `Subject` global | ADAPT |
| `Timetable` | `Timetable` + `TimetablePeriod` + `TimetableEntry` | ADAPT + tambah period `type` |
| attendance legacy | `StudentAttendance` (daily) + `TeacherAttendance` | ADAPT |
| `Exam`/`ExamResult`/`ReportCard` | `Assessment` + `AssessmentResult` + `ReportCard` snapshot | ADAPT + tambah TP + snapshot |
| fee/transaction legacy | `FeeType` → `StudentCharge` → `PaymentAllocation` ← `Payment` | REPLACE model |
| `AuditLog` | `AuditLog` (DB-authoritative, append-only) | ADAPT |
| `Announcement` | `Announcement` | KEEP |
| documents/uploads (S3) | `Document` + Supabase Storage private bucket | REPLACE |

**Amaran konsistensi naming:** schema legacy sudah menggunakan `Parent`, bukan `Guardian`. `01_DECISIONS.md` mengunci istilah **Guardian** + `StudentGuardian`. Ini perlu diputuskan sebagai rename atau mapping, dan **mesti disahkan sebelum Fasa 2** (PROPOSED decision #1 di §8).

### 6.2 Pemetaan RLS

| Legacy | SRIK target |
|---|---|
| `app.current_school_id` + `app.bypass_rls` | tiada — single school, jadi tiada school predicate |
| `app.current_branch_ids` CSV | tiada |
| `tenant_isolation` policy setiap table | `has_permission()` / scope RLS berasaskan `auth.uid()` → `profiles` → `user_roles`/`role_permissions`/`user_permissions` |
| `runAsPlatform()` bypass luas | tiada bypass blanket; SECURITY DEFINER terhad + EXECUTE minima |
| Prisma query extension yang set session var setiap query | Supabase client `auth.uid()` + RLS |

### 6.3 Pemetaan UI → struktur target

| Legacy | Target (`02_PHASE_0_AUDIT.md`) |
|---|---|
| `components/admin/*`, `teacher/*`, `student/*`, `parent/*` | `src/features/{students,teachers,guardians,classes,subjects,timetable,attendance,assessments,reports,finance,auth}/` |
| `components/ui`, `components/shared`, `components/layout` | `src/components/` |
| `components/mobile`, `settings`, `reports` | serap ke feature yang berkaitan |
| `components/{inspector,proprietor,subscription,shop,rewards,alumni,payments,learning,video,messaging}` | REMOVE |
| `App.tsx` 1 fail besar + `DashboardRouter` | `src/app/` |
| `lib/api.ts` (3939 baris, ~600 method) | `src/lib/supabase/` + query per feature |
| `lib/database.ts`, `apiHelpers.ts`, `cacheManager.ts`, `migrationManager.ts`, `demoFallback.ts`, `demoRealtime.ts` | REMOVE/REPLACE |
| `types.ts`, `types-additional.ts`, `types-saas.ts` | `src/types/` + generated DB types (buang `types-saas.ts`) |
| `backend/**` | `supabase/migrations` + `supabase/functions` |
| `prisma/seed.ts`, `demoSeeder.service.ts` | `supabase/seed.sql` (sintetik sahaja) |

---

## 7. Fungsi utiliti yang dikongsi (risiko penghapusan)

Ini fail yang **dicapai oleh kedua-dua modul KEEP dan REMOVE**. Buang satu tanpa semak akan mematahkan KEEP:

| Fail | Kenapa berisiko |
|---|---|
| `lib/api.ts` (3939 baris) | `HybridApiClient` — satu client untuk **semua** domain. Mengalih satu modul sahaja tidak boleh tanpa memecah kongsi ini. Perlu dipecahkan ikut feature, bukan dipotong sekali. |
| `lib/api/core.ts` (628 baris) | token lifecycle (`sessionStorage`/`localStorage`, refresh) dikongsi semua domain. Ini teras cutover Fasa 1. |
| `context/AuthContext.tsx` | `role`, `currentSchool`, `switchDemoRole`, `switchDashboardRole`, `DashboardType`. Demo role-switch + multi-role bercampur dengan auth sebenar. |
| `context/BranchContext.tsx` | branch = tenant concept; tetapi dipakai oleh hampir setiap skrin KEEP. |
| `hooks/useRealtime*.ts` (8 fail) | Socket.io dikongsi attendance/timetable/live class. |
| `lib/cacheManager.ts`, `lib/migrationManager.ts`, `lib/dexie-db.ts` | IndexedDB + cache dikongsi PWA shell dan offline query. |
| `lib/config.ts` | `APP_VERSION`, auto-detect URL `/api`; dipakai App + build. |
| `lib/ai*.ts` (7 fail) | dikongsi banyak skrin; sempadan tidak jelas dengan modul REMOVE. |
| `middleware/authorization.middleware.ts` vs `tenant.middleware.ts` | dua lapisan authz; membuang tenant mesti kekalkan authorization. |
| `config/database.ts` | Prisma extension + RLS session vars + `stripSensitiveFields`. Membuang Prisma = membuang penguatkuasaan RLS semasa → wajib ganti **sebelum** buang. |
| `lib/tenantContext.ts` | dibaca oleh `database.ts` dan auth middleware. |
| `shared/` (4 fail), `utils/` (7 fail), `config/` (2 fail) | utiliti silang domain. |
| `types.ts` (besar) | menggabungkan `DashboardType`, School, Student, Teacher, dsb. |

**Kesimpulan risiko:** ini **bukan** repo di mana modul boleh dipotong ikut folder. `lib/api.ts`, `AuthContext`, `BranchContext` dan Prisma/RLS adalah **node god** yang mesti dipecah/diganti secara berperingkat dengan parity disahkan sebelum penghapusan.

---

## 8. Sempadan cutover setiap fasa

Prinsip: **elakkan dua auth source atau dua write path bagi feature yang sudah dipindah.**

| Fasa | Masuk | Keluar (REMOVE) | Sempadan keselamatan |
|---|---|---|---|
| 0 | Audit (fail ini) + status | tiada | Tiada kod diubah. Tiada data dipadam. |
| 1 | Supabase Auth + `profiles`/`roles`/`permissions`/`user_roles`/`role_permissions`/`user_permissions` + RLS helper | Hanya selepas parity: custom JWT auth path (`auth.middleware.ts`, `auth.service.ts` JWT/bcrypt/MFA), `csrf`, `tenant.middleware.ts`, `lib/tenantContext.ts`, `config/database.ts` RLS bridge | **Auth hanya satu sumber.** Jangan keluarkan JWT semasa Supabase Auth belum mengesahkan login/logout/restore + deny tests. Jangan matikan RLS lama sebelum RLS baharu menguji allow/deny. |
| 2 | Profil + academic core atas Supabase | Tenant core: `School`(billing)/`Branch`/`SchoolMembership`/`BranchUserIdentity`/`Plan`, `branch.routes.ts`, `BranchContext` | History kelas mesti kekal; tiada cascade delete sejarah. Tiada `academic_year` mismatch. |
| 3 | Timetable + attendance daily | `substitute`, `lessonPlan`, `qr lesson attendance`, `virtual-class` yang bergantung tenant | Clash checks aktif. Tiada offline write. Tiada row = belum direkod, bukan ABSENT. |
| 4 | Assessment + report snapshot | `externalExam`, `exam`/`ExamBody` legacy berlebihan | Snapshot immutable; published result tak boleh diubah direct. |
| 5 | Finance (charges/payment/allocation) | **Paystack + Flutterwave + `PaymentService.ts` + `paymentPlan` + `transaction` legacy** | NUMERIC sahaja; tiada Float; idempotency + locking. |
| 6 | Documents/announcements/audit + PWA shell + backup | S3 SDK+`fileStorage.service.ts`, Redis, BullMQ, queue/cron, PM2, `cluster.ts`, Socket.io, Express, Prisma, Docker backend, Vercel serverless entry, Capacitor native (defer, bukan remove), translate, gameplay, AI legacy | Fresh DB dari migrations + synthetic seed. Backup DB **dan** Storage berasingan + restore drill. |

**Urutan `02_PHASE_0_AUDIT.md` §5 "Elakkan dua auth sources":** cutover auth adalah langkah paling berisiko. Cadangan cutover berperingkat (PROPOSED, sahkan dalam Fasa 1):
1. Bina Supabase Auth + RLS baharu **selari** tanpa mengganggu Express.
2. Bootstrap ADMIN/TEACHER + ujian deny.
3. Alihkan login frontend → Supabase; kekalkan Express hanya sebagai pembaca buat sementara.
4. Sahkan parity, **kemudian** matikan Express auth.

**Risiko Node version:** Dockerfile `node:20`, audit `node:24`; `backend/vitest.config.ts` mendokumenkan percanggahan propagation async-context antara Node 20/24 yang menyebabkan kegagalan RLS. Pin versi sebelum Fasa 1.

---

## 9. Konflik arahan dan PROPOSED decisions

### 9.1 Konflik yang ditemui (mesti diselesaikan, bukan diabaikan)

| # | Konflik | Sumber A | Sumber B | Kesan jika tidak diselesaikan |
|---|---|---|---|---|
| C1 | Backend production | `01_DECISIONS.md` (LOCKED): Supabase | `CLAUDE.md`: "This app is not on Supabase — it's a self-hosted PostgreSQL" | Fasa 1 boleh dibina atas andaian salah. **Arahan spec menang** (precedence eksplisit), tetapi CLAUDE.md mesti dikemas kini. |
| C2 | Model data | `01_DECISIONS.md`: single-school, buang `school_id`/`branch_id` | `CLAUDE.md`: "Every record is scoped by `school_id` and often `branch_id`" + `MULTITENANT_IMPLEMENTATION_SUMMARY.md` (20.7 KB) + `PLANETARY_SCALE_ARCHITECTURE.md` + `ISOLATION_GUIDE.md` | Kerja refactor boleh disalahtafsir sebagai regresi. |
| C3 | Peranan | `01_DECISIONS.md`: ADMIN + TEACHER sahaja | `CLAUDE.md` + `DashboardType`: 10 role (superadmin, proprietor, inspector, examofficer, complianceofficer, counselor...) | Skop melambung. |
| C4 | Auth mekanisme | `01_DECISIONS.md`: Supabase Auth, tiada custom JWT | `CLAUDE.md`: PKCE + `sessionStorage` + demo token bypass + refresh token | Dua auth source. |
| C5 | Versi/identiti produk | `01_DECISIONS.md`: SRIK, sekolah rendah Islam Al-Khairiah, ~250 pengguna | Repo: "Oliskey School Management System — multi-tenant SaaS platform for Nigerian schools", Naira, NIGERIAN curriculum | Target berbeza sepenuhnya daripada kod sedia ada. |
| C6 | Secret | `AGENTS.md`: "Supabase secret keys must never enter frontend source, VITE variables, bundles" | `.env.example`: `VITE_GEMINI_API_KEY` (dokumen sendiri: "the key WILL be visible in the built JS") | Corak secret-bocor boleh dikekalkan secara tidak sengaja. |
| C7 | RLS | `AGENTS.md`: setiap exposed table kena RLS + grants eksplisit + tested policies | Repo: RLS wujud tetapi (a) berasaskan tenant, (b) `bypass_rls` blanket, (c) ditambah baru-baru ini selepas ~1,900 tapak panggilan tanpa RLS. `CLAUDE.md` mendakwa RLS dikuatkuasa oleh Prisma. | Rasa "selamat" palsu. RLS legacy mesti diganti, bukan dianggap siap. |
| C8 | `AGENTS.md` vs repo | Spec suruh letak `AGENTS.md`; jangan timpa arahan projek lain secara membuta tuli | Repo tiada `AGENTS.md`, tetapi ada `CLAUDE.md` (20.4 KB, 9 seksyen arahan yang sah + `.claude/`, `.kilo/`, `.opencode/`, `skills/`) | Arahan bercanggah mengelirukan agent akan datang. |

### 9.2 PROPOSED decisions — **diputuskan oleh pemilik 7 Oktober 2026**

Status keputusan penuh dan kesan pelaksanaan: `IMPLEMENTATION_STATUS.md` §"Keputusan pemilik". Ringkasan:

| # | Perkara | Keputusan pemilik | Status kerja |
|---|---|---|---|
| P1 | Nama entiti penjaga | **`Guardian` + `StudentGuardian`** — terus guna | Dikunci untuk Fasa 2 |
| P2 | Data sedia ada | **Kekalkan semua data remote** sehingga disahkan; bina baseline dalam sandbox | Blocker untuk operasi remote sahaja |
| P3 | AI | **Defer**; buang provider hanya selepas tiada dependensi KEEP | Tidak menyekat Fasa 1 |
| P4 | i18n | **BM utama; BM+BI sasaran**; elak rewrite semasa Fasa 1 | Tidak menyekat Fasa 1 |
| P5 | Node version | **Node 24 LTS**, pin patch selepas validation | **SELESAI** → `24.21.0` |
| P6 | Portal penjaga | Simpan schema; audit UI legacy sebagai bahan guna semula; jangan wajibkan 32 fail kekal | Dikunci |
| P7 | Learning hub | **Defer**; asingkan daripada core | Dikunci |
| P8 | `CLAUDE.md` | Kemas kini selaras sambil mengekalkan aturan relevan | **SELESAI** |
| P9 | Paystack/Flutterwave | **REMOVE**; periksa transaksi sebenar sebelum sentuh deployment/data lama | Dikunci |
| P10 | PostGIS | Jangan masukkan dalam schema baharu; audit dependency sebelum buang dari DB lama | **DIAUDIT** — tidak digunakan (§9.4) |

#### Rekod cadangan asal (untuk konteks)

| # | Perkara | Cadangan asal | Kenapa perlu disahkan |
|---|---|---|---|
| P1 | Nama entiti penjaga | Adopt `Guardian` + `StudentGuardian`; legacy `Parent` di-rename/migrate | `01_DECISIONS.md` kunci "Penjaga / Guardian"; repo guna `Parent` |
| P2 | Nasib data sedia ada | **Sahkan ada/tidak data production sebenar.** Default audit: repositori ini nampak seperti deployment **satu sekolah Nigeria (Oliskey)** dengan demo school + branch. Jika tiada data production bernilai → clean baseline. Jika ada → perlu pelan migrasi, bukan rehat | Spec: "Bezakan sample/dev data daripada data production... jangan reset database live" |
| P3 | Skop AI | Adakah NVIDIA NIM / AI features in-scope SRIK sama sekali? Ia tidak disenaraikan KEEP atau REMOVE | AI menyentuh banyak fail KEEP + bergantung secret server |
| P4 | i18n | Bahasa: BM sahaja, BM+BI, atau kekalkan semua locale? | `lib/i18n` ada banyak locale termasuk `zh` |
| P5 | Node version | Pin satu versi (20 atau 24) sebelum Fasa 1 | Percanggahan async-context RLS antara Node 20/24 |
| P6 | `Parent` vs `Guardian` portal | Portal penjaga DEFERRED, tetapi `parent.routes.ts` + `components/parent` (32 fail) wujud dan berkemungkinan besar berfungsi | Jangan buang UI penjaga yang berguna semasa REMOVE tenant |
| P7 | Skop `learning`/`learningHub`/`curriculumData.ts` | KEEP, ADAPT atau REMOVE? Tidak dalam mana-mana senarai | 47 fail `tests/`, `data/`, `freeLearningResourcesCatalog.ts` |
| P8 | Nasib `CLAUDE.md` (fail ini) | Kemas kini `CLAUDE.md` supaya selaras dengan `AGENTS.md`/`01_DECISIONS.md` — **jangan padam** tanpa kelulusan pemilik | Arahan pemilik eksplisit + C8 |
| P9 | Paystack/Flutterwave | Kunci REMOVE mengikut `01_DECISIONS.md`. Sahkan tiada pembayaran production aktif bergantung padanya | 40+20 fail; `.env.production.example` ada key live |
| P10 | DB engine | Legacy guna PostGIS container; Supabase = PostgreSQL. Sahkan tiada query bergantung PostGIS | `init-extensions.sql`, `postgis` image |

### 9.3 Data sample/dev vs production

**Penemuan audit:**
- Tiada `.env` sebenar, tiada credential production, tiada dump DB dalam repo.
- `prisma/seed.ts` + `demoSeeder.service.ts` + `demoReset.service.ts` → **seed sintetik + demo reset infra** wujud.
- `database/archive/sample_data.sql.bak` → data sampel.
- `.mcp.json` + `mcp.json`: `https://mcp.supabase.com/mcp?project_ref=ikowlorheeyrsbgvlhvg` — **ada rujukan projek Supabase sebenar** (`ikowlorheeyrsbgvlhvg`). Ini **bukan** secret (project ref bersifat awam), tetapi bermakna seorang manusia sudah ada projek Supabase yang dikaitkan dengan repo ini. **Sahkan sama ada projek ini mengandungi data sebenar sebelum sebarang langkah `reset`/`migrate`/`push`.**
- `backups/` folder wujud (2 fail) — semak kandungan sebelum apa-apa operasi DB.

**Kesimpulan:** repositori ini **kelihatan** seperti projek SaaS Nigeria dengan demo school + branch, **bukan** data SRIK production. Tetapi kerana `mcp.json` merujuk projek Supabase sebenar, **jangan** reset/migrate/push apa-apa tanpa pengesahan pengguna. **Keputusan pemilik (P2): kekalkan semua data remote sehingga statusnya disahkan; bina baseline dalam sandbox.**

### 9.4 P10 — audit dependency PostGIS

**Keputusan: PostGIS diisytiharkan tetapi TIDAK PERNAH digunakan.**

| Pemeriksaan | Hasil |
|---|---|
| `init-db/init-extensions.sql` | `CREATE EXTENSION IF NOT EXISTS "postgis";` pada baris 5 — satu-satunya rujukan berfungsi |
| `backend/prisma/schema.prisma` | **0** padanan `postgis` / `geometry` / `geography` / `Unsupported(` |
| `backend/prisma/migrations/**` (57 fail) | **0** `CREATE EXTENSION`, **0** jenis spatial |
| Query spatial dalam kod | **0**. Padanan `ST_*`/`geometry` ialah `TRUST_BOUNDARY_INSTRUCTION` (`lib/ai.ts`), `GeoGebra` (katalog resource), dan nama pemboleh ubah — bukan spatial |
| `docker-compose.yml` | image `postgis/postgis:17-3.5-alpine` (DB dev sahaja) |

**Kesan:** membuang PostGIS daripada `docker-compose.yml` (→ `postgres:17-alpine`) adalah selamat dari segi kod; tiada migration atau model bergantung padanya. Extension lain dalam fail yang sama (`uuid-ossp`, `pgcrypto`, `pg_trgm`, `ltree`, `citext`, `hstore`, `pg_stat_statements`) **belum** diaudit secara berasingan — jangan andaikan ia juga tidak digunakan.

**Keputusan pemilik:** jangan masukkan PostGIS ke schema baharu. Untuk DB lama, bekalkan `DROP EXTENSION` hanya **selepas** disahkan tiada objek bergantung.

---

### 9.5 Status konflik C1–C8 selepas keputusan

| # | Konflik | Status |
|---|---|---|
| C1 | Backend production (Supabase vs "not on Supabase") | **SELESAI** — `CLAUDE.md` dikemas kini; Supabase ialah autoriti |
| C2 | Model data (single-school vs multi-tenant) | **SELESAI** — seksyen multi-tenant dipindah ke "Legacy (reference only)" |
| C3 | Peranan (ADMIN+TEACHER vs 10 role) | **SELESAI** — `CLAUDE.md` nyatakan skop 2 role + permission |
| C4 | Auth (Supabase vs custom JWT) | **SELESAI** — auth legacy dilabel "being replaced" |
| C5 | Identiti produk (SRIK vs Oliskey Nigeria) | **SELESAI** — `CLAUDE.md` nyatakan Oliskey = kod rujukan |
| C6 | Secret (`VITE_GEMINI_API_KEY` dalam .env.example) | **SEBAHAGIAN** — `CLAUDE.md` kini melarang; pengalihan fail `.env.example` berlaku semasa modul AI dibuang (P3, deferred) |
| C7 | RLS (tenant RLS vs permission RLS) | **DIREKOD** — dinyatakan eksplisit sebagai bukan baseline untuk dipelihara |
| C8 | `AGENTS.md` vs `CLAUDE.md` | **SELESAI** — dirujuk silang, selaras |

---

## 10. Syarat siap Fasa 0 — semakan

| Syarat (`02_PHASE_0_AUDIT.md`) | Status |
|---|---|
| `docs/srik/AUDIT.md` menyatakan findings sebenar dan dependency map | ✅ fail ini (§1–§7) |
| `docs/srik/IMPLEMENTATION_STATUS.md` memuatkan fasa, status, blocker dan bukti validation | ✅ lihat fail berkenaan |
| Pelan migrasi/cutover boleh diikuti tanpa memadam data sebenar | ✅ §8 + §9.3 (PROPOSED P2 sebagai gate) |
| Proposed decisions disenarai; tiada claim source feature telah dibuang sebelum kod diperiksa | ✅ §9.2; **tiada** kod dibuang dalam fasa ini |
| Tiada perubahan architecture dibuat | ✅ tiada perubahan kod sama sekali |

**Fasa 0 tidak menutup mana-mana fasa lain.** Fasa 1 kekal terhalang sehingga P2 (status data) dan P5 (Node version) disahkan, dan sehingga konflik C1–C8 diselesaikan secara dokumentasi.

---

## 11. Perubahan fail dalam Fasa 0 (rekod ketat)

| Fail | Jenis | Sebab |
|---|---|---|
| `AGENTS.md` | **BAHARU** | Spec `README.md` §1. Digabung secara sedar dengan `CLAUDE.md` (blok precedence di atas), bukan tindihan membuta tuli. Lihat B4 |
| `docs/srik/README.md`, `01_DECISIONS.md`, `02..09_*.md`, `AGENTS.md` | **BAHARU** | Salinan spec sendiri (`README.md` §2: letak fail lain dalam `docs/srik/`) |
| `docs/srik/AUDIT.md` | **BAHARU** | Hasil Fasa 0 |
| `docs/srik/IMPLEMENTATION_STATUS.md` | **BAHARU** | Hasil Fasa 0 |
| `package-lock.json` | **DIUBAH (2 baris)** | Kesan sampingan `npm install` — membetulkan `version` `0.7.56` → `0.8.0` supaya sepadan dengan `package.json`. **Bukan perubahan kod** |
| `dist/`, `node_modules/` | **DIJANA** | Kesan `npm install` / `npm run build` untuk baseline. Tidak di-commit |

**Tiada fail kod aplikasi diubah, ditambah atau dibuang.** Tiada route, schema, migration, komponen atau konfigurasi disentuh. Kriteria `02_PHASE_0_AUDIT.md` "Belum bina feature baru" dipatuhi.
