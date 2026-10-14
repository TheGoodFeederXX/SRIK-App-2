# Status Perlaksanaan

Rujukan: `SRIK_DEEPSEEK_HARNESS_SAFE_CLEANUP.md`
Baseline: `4fc7f9bffde713f29a8fcb22c3f992ef64746793` (0.8.30)
Branch: `cleanup/safe-removal-c1-c2`

| Fasa | Status | Fail dipadam/diubah | Dependency dibuang | Validation | Blocker |
|---|---|---|---|---|---|
| C0 | **SELESAI** | — (rekod sahaja) | — | Baseline hijau direkod | — |
| C1 | **SELESAI** | 8 fail dipadam, 2 manifest + 1 manifest-dev diubah | 7 dibuang | tsc 0, build 0, 537 ujian, + 1 pembetulan peer | — |
| C2 | **SELESAI** | 5 fail dipadam, 6 fail diubah | — | tsc 0, build 0, 537 ujian, pariti 3295 | Gate UI visual: BELUM DISAHKAN |
| C3 | **TERHALANG** | tiada | tiada | — | Lihat §7 di bawah |
| C4 | **TANGGUH** | tiada | tiada | Di luar skop | Keputusan produk native |
| C5 | **TANGGUH** | tiada | tiada | Di luar skop | Cutover berasingan |

## 1. Commit

| Commit | Fasa | Versi |
|---|---|---|
| `e2e07f5` | C1 | 0.8.31 |
| `056ea6f` | C2 | 0.8.32 |

Tiada push, tiada merge, tiada deployment dijalankan.

## 2. Bilangan perubahan

- Fail kod dipadam: **13** (8 dalam C1, 5 dalam C2)
- Dependency dibuang: **7**
- Dependency ditambah: **1** (`@testing-library/dom`, dependency peer yang hilang)
- Fail dikemas kini dalam C2: **6**

Saiz bundle **tidak diukur** pada baseline, jadi tiada perbandingan dilaporkan.
Kod mati mungkin sudah pun dibuang oleh bundler; tiada pengurangan dijanjikan.

## 3. Perintah pengesahan dan keputusan

| Perintah | Keputusan |
|---|---|
| `npx tsc --noEmit` | **0 ralat** |
| `npx vite build` | **exit 0** |
| `npx vitest run` | **537 lulus / 75 fail** |
| Pariti locale BM/BI | **3295 / 3295, beza 0** |
| Carian `navigateTo` lima view | **tiada** |
| Carian lazy import lima fail | **tiada** |
| `npm ls --all` | hanya `UNMET OPTIONAL DEPENDENCY` (normal) |

Baseline dan selepas adalah sama: 537 lulus. Tiada regresi.

## 4. Kecacatan yang saya temui sendiri semasa melaksanakan

Rekod ini penting kerana setiap satu daripadanya akan menjadi kegagalan senyap
jika saya hanya bergantung pada pemeriksaan statik atau menganggapnya selesai.

### 4.1 `@testing-library/dom` hilang (C1)

Membuang tujuh dependency memecahkan **setiap** ujian dengan
`Cannot find module '@testing-library/dom'`. Sebabnya: `@testing-library/react`
memerlukan `@testing-library/dom` sebagai dependency **peer**, dan peer itu hanya
hadir secara kebetulan melalui salah satu pakej yang dibuang.

Ditemui kerana suite dijalankan **selepas** pembuangan dependency, bukan hanya
selepas pembuangan fail. Dibetulkan dengan menambah `@testing-library/dom@10.4.1`
sebagai `devDependency` eksplisit.

### 4.2 Dua senarai ujian merujuk fail yang dipadam (C2)

- `src/lib/supabase/__tests__/no-legacy-api.test.ts` — senarai laluan fail
- `src/lib/supabase/__tests__/family.test.ts` — senarai laluan fail, membaca fail itu

Yang pertama gagal dengan mesej senarai; yang kedua gagal dengan
`ENOENT: no such file or directory`. Yang kedua hanya muncul apabila **seluruh**
suite dijalankan — ia tidak akan kelihatan jika saya hanya menjalankan ujian yang
saya sangka berkaitan.

Dibetulkan dengan membuang lima entri daripada setiap senarai, mengekalkan
pemeriksaan anti-legacy untuk semua fail yang masih ada.

### 4.3 Rekod saya sendiri yang salah (dokumen)

Dalam draf pertama `BASELINE.md`, saya menulis bahawa `jitsiUrl.ts` "masih diimport
oleh `VirtualClassroom`/`LiveClassRoom`". Itu andaian, bukan pemeriksaan. Semakan
selepas C1 menunjukkan `VirtualClassroom` hanya mengeksport `ComingSoonScreen` dan
`jitsiUrl.ts` tiada pengguna. Rekod itu dibetulkan secara terbuka dalam `BASELINE.md`,
bukan dipadam senyap.

## 5. Sasaran dikekalkan kerana masih ada pengguna

| Sasaran | Sebab |
|---|---|
| `components/video/VirtualClassroom.tsx` | Dicecah dari `StudentDashboard.tsx` baris 50 dan 765; butang pada baris 427 |
| `components/video/jitsiUrl.ts` | Tiada pengguna, tetapi di luar allowlist C1, dan membuangnya menyeret `lib/videoConfig.ts` yang juga di luar allowlist |
| `lib/videoConfig.ts` | Digunakan hanya oleh `jitsiUrl.ts`; di luar allowlist C1 |
| `components/messaging/*` selain ChannelMessaging | Komunikasi/pengumuman aktif |
| `components/learning/*` | Arahan hanya menyasarkan `LearningPathsDashboard.tsx` |
| 15 laluan fail dalam senarai ujian | Sedia ada sebelum tugas; ujian menguji ketiadaan mereka |

## 6. Gate belum disahkan

- **Semakan UI visual (Gate C2):** `BELUM DISAHKAN`. Tiada pelayar dalam
  persekitaran ini. Grid kad dashboard sepatutnya mengalir semula dengan
  sendirinya kerana tiada CSS diubah, tetapi ini **tidak** disahkan secara visual.
- **Smoke test aliran (§10.3):** `BELUM DISAHKAN` untuk semua baris yang
  memerlukan pelayar atau akaun ujian.

## 7. C3 — TERHALANG (sebab khusus)

Gate §7.1 **tidak** dipenuhi. Bukti:

| Gate | Keadaan | Bukti |
|---|---|---|
| Semua operasi guna Supabase | **GAGAL** | 5 komponen masih mengimport `lib/api`: `VerifiedAdminRoute` (2 pengimport), `LeaveBalanceTracker` (2), `ReferralSystem` (2), `UpdatePrompt` (4), `CounselingAppointments` (0) |
| Tiada deployment aktif guna Express | Tidak dapat disahkan | `Dockerfile`, `docker-compose.yml`, `ecosystem.config.cjs/js`, `nginx-load-balancer.conf` masih ada |
| Skrip CI tidak perlukan Prisma | **GAGAL** | `.github/workflows/ci.yml` baris 73 menjalankan `npm run prisma:generate`; baris 104 menjalankan `npx tsc --noEmit -p backend/tsconfig.json` |
| Skrip tidak perlukan backend lama | **GAGAL** | `postinstall` menjalankan `prisma generate` |
| `build:vercel` | **MATI** | Vercel memakai `npm run build` → `dist` (frontend sahaja); `api/` tiada; `build:vercel` tiada perujuk aktif |

**Kesimpulan:** membuang `backend/` sekarang akan mematahkan CI pada setiap commit dan
melanggar larangan §7.1. C3 tidak dilaksanakan. Ini dilaporkan sebagai TERHALANG,
bukan dilaksanakan secara separa.

**Laluan keluar yang dicadangkan (memerlukan penugasan berasingan):**
1. Gantikan setiap penggunaan `lib/api` dalam 5 komponen dengan adapter Supabase aktif
   (atau buang komponen yang tidak dicapai seperti `CounselingAppointments`).
2. Keluarkan `prisma:generate` dan langkah typecheck backend daripada `ci.yml`.
3. Buang bahagian Prisma daripada `postinstall`.
4. Kemudian ulang penilaian gate §7.1 sebelum menyentuh `backend/`.

## 8. Penyingkiran AI penuh (0.8.33)

Atas permintaan pemilik, **semua** fungsi AI dibuang — paparan dan kod.

| Lapisan | Dibuang |
|---|---|
| Komponen UI | `AIChatScreen`, `AIChatWidget`, `AskAIWidget`, `AIInsightsPanel`, `MediaGenerator`, `AILoadingOverlay`, `AIPerformanceSummaryScreen`, `AIGameCreatorScreen`, `StudyBuddy`, `AIParentingTips`, seluruh `components/student/adventure/`, `LiveSession` |
| Pustaka | `lib/ai.ts`, `lib/ai-assistant.ts`, `lib/ai-secure.ts`, `lib/ai-grading.ts`, `lib/ai-educator-service.ts`, `lib/ai-lesson-planner.ts`, `lib/gemini.ts` |
| Backend | `ai/aiGateway/aiKnowledge/askAI/geminiAI/nvidiaAI/gameQuestion` service, `ai.controller`, `ai.routes`, `aiGate.middleware`, laluan `/ai`, `/insights/ask*`, `/games/ai-questions` |
| Konfigurasi | `VITE_AI_PROVIDER`, `VITE_GEMINI_API_KEY`, `NVIDIA_API_KEY`, `geminiApiKey`, `nvidiaApiKey/nvidiaBaseUrl/nvidiaGenaiBaseUrl` |
| Dependensi | `@google/generative-ai` (dibuang bersama `scripts/generate-translations.ts`) |
| Ujian AI | `ai-is-not-behind-a-paywall`, `ai-knowledge-base` (branding), `aiGateway.service`, `geminiAI.service`, `insights_askai`, `ai-knowledge` (backend) |
| Terjemahan | 13 kunci bernama AI dibuang; 2 tajuk dibersihkan (`dashboardOverview.aiTimetable` → "Jadual Waktu", `teacherOverview.aiLessonPlanner` → "Perancang Pelajaran") |

Tingkah laku yang berubah, disebut terus:
- Kuis permainan kini **sentiasa** menjana soalan daripada bank luar talian — laluan Gemini dibuang, bukan disekat.
- Kertas soalan `aiTimetable`/`aiLessonPlanner` dan lawatan pelancongan (onboarding) tidak lagi
  menjanjikan AI yang tiada.
- Butang "Jana Ringkasan Kelas AI" di skrin Laporan Guru dibuang (skrin tujuannya sudah tiada).

**Pepijat pengawal yang ditemui semasa kerja ini (dan diperbaiki):** ujian
`no-legacy-api` mengira skrin terjejak dengan regex `import X from '...'`. Baris
`import LessonPlanDetailScreen, { AIActivitySuggester } from '...'` **gagal** dipadankan,
jadi `LessonPlanDetailScreen` tersembunyi daripada pemeriksaan itu sejak dulu. Selepas
AI dibuang, sintaks import menjadi padan, dan barulah skrin itu muncul — bersama satu
pelanggaran **sebenar** yang sudah lama wujud: skrin itu memanggil `lib/api` (pelayan yang
tidak wujud) untuk "menerbitkan" rancangan pelajaran, jadi butang itu senyap-senyap tidak
berbuat apa-apa. Diputuskan dengan pemilik untuk **membaiki skrin itu** (bukan melaporkan
sahaja): muat naik kini ke baldi peribadi `srik-documents` dan baris ke jadual `documents`.

Pengiraan **tiada** ujian hijau tanpa asas: `tsc` frontend 0 ralat, `tsc` backend 0 ralat,
**519 ujian frontend lulus** (73 fail), `vite build` keluar 0, pariti locale
**3286 = 3286** kunci, tiada perubahan pada `supabase/`.

## 9. Rollback

Setiap fasa ialah commit berasingan dan boleh dibalikkan secara berasingan:

```bash
git revert 056ea6f   # C2 sahaja
git revert e2e07f5   # C1 sahaja
git revert <sha 0.8.33>   # penyingkiran AI sahaja
```

Tiada `git reset --hard`, tiada force push, dan tiada mutasi data dijalankan.
Tiada perubahan pada `supabase/` dalam mana-mana commit.
