# Inventori Pembuangan

Rujukan: `SRIK_DEEPSEEK_HARNESS_SAFE_CLEANUP.md`
Baseline: `4fc7f9bffde713f29a8fcb22c3f992ef64746793` (0.8.30)

Setiap baris menunjukkan pemanggil yang dijumpai pada HEAD sebenar, bukan andaian.

## C1 — Lapan komponen kod mati

| Sasaran | Pemanggil/rujukan | Penggunaan runtime | Tindakan | Fail bersama | Bukti penerimaan |
|---|---|---|---|---|---|
| `components/rewards/RewardsSystem.tsx` | tiada (carian nama fail, eksport, laluan) | tiada | REMOVE | — | tsc 0, build 0, 537 ujian lulus |
| `components/rewards/Leaderboard.tsx` | tiada | tiada | REMOVE | — | idem |
| `components/shop/EnhancedShop.tsx` | tiada | tiada | REMOVE | — | idem |
| `components/learning/LearningPathsDashboard.tsx` | tiada | tiada | REMOVE | — | idem |
| `components/messaging/ChannelMessaging.tsx` | tiada | tiada | REMOVE | — | idem |
| `components/video/LiveClassRoom.tsx` | tiada pengimport; ia mengimport `DailyClassRoom` + `./jitsiUrl` | tiada | REMOVE | — | idem |
| `components/video/DailyClassRoom.tsx` | diimport hanya oleh `LiveClassRoom` (baris 5, 201) | tiada | REMOVE | — | idem |
| `components/shared/XSSDemo.tsx` | tiada | tiada | REMOVE | — | idem |

Folder `components/rewards/`, `components/shop/`, `components/learning/` dan
`components/messaging/` menjadi kosong dan hilang. `components/video/` kekal.

## C1 — Sasaran yang DIKEKALKAN (bukti, bukan andaian)

| Sasaran | Sebab |
|---|---|
| `components/video/VirtualClassroom.tsx` | Dicecah dari `StudentDashboard.tsx` baris 50 (lazy) dan baris 765; butang pada baris 427. Ia memaparkan `ComingSoonScreen`, tetapi ia dicapai pengguna. **Kekal** |
| `components/video/jitsiUrl.ts` | Tiada pengguna selepas `LiveClassRoom` dibuang. **HOLD** — lihat nota di bawah |
| `lib/videoConfig.ts` | Digunakan hanya oleh `jitsiUrl.ts`. Di luar allowlist C1. **HOLD** |
| `components/messaging/*` lain | Komunikasi/pengumuman aktif. **Kekal** |

### Nota HOLD — `jitsiUrl.ts` dan `lib/videoConfig.ts`

Sebelum C1, `jitsiUrl.ts` diimport oleh `LiveClassRoom.tsx`. Selepas C1, carian semula
menunjukkan ia **tiada pengguna langsung**. Ia tidak dibuang dalam fasa ini kerana:

1. Ia berada di luar allowlist C1 (allowlist menyenaraikan `LiveClassRoom` dan
   `DailyClassRoom`, bukan pembantu Jitsi).
2. Membuangnya menyeret `lib/videoConfig.ts`, yang turut di luar allowlist.
3. `components/video/VirtualClassroom.tsx` masih dicapai dan merupakan calon pengguna
   masa depan untuk pembantu ini.

Ini dilaporkan sebagai sasaran yang dikekalkan dengan sebab, mengikut §12.

## C1 — Dependency dibuang

| Dependency | Rujukan aktif sebelum buang | Keputusan |
|---|---|---|
| `react-paystack` | tiada | DIBUANG |
| `nativewind` | tiada (tiada config nativewind/babel/metro) | DIBUANG |
| `@reduxjs/toolkit` | tiada | DIBUANG |
| `react-redux` | tiada | DIBUANG |
| `@google/genai` | tiada | DIBUANG |
| `@hcaptcha/react-hcaptcha` | tiada | DIBUANG |
| `@daily-co/daily-js` | hanya `components/video/DailyClassRoom.tsx` | DIBUANG |

### Kecacatan tersembunyi yang ditemui semasa pembuangan dependency

Membuang tujuh pakej itu **memecahkan suite ujian**. `@testing-library/react` menyatakan
`@testing-library/dom` sebagai dependency peer; peer itu sebelum ini hanya hadir secara
kebetulan melalui salah satu pakej yang dibuang. Selepas pembuangan, `@testing-library/dom`
hilang dari pokok dan setiap ujian gagal dengan `Cannot find module '@testing-library/dom'`.

Pembetulan: tambah `@testing-library/dom@10.4.1` sebagai `devDependency` **eksplisit**.
Ini menjadikan pergantungan nyata itu jelas dalam manifest, bukannya bergantung pada
pakej yang tidak berkaitan.

Kesan sampingan yang disemak: `npm ls --all` menunjukkan hanya `UNMET OPTIONAL DEPENDENCY`
(binari khusus platform seperti `fsevents`, `@msgpackr-extract/*`, dan peer pilihan
`redis`, `bufferutil`). Ini normal dan bukan regresi.

## C2 — Lima UI modul

| Sasaran | Route key | Pemanggil | Tindakan |
|---|---|---|---|
| `components/admin/HostelManagementScreen.tsx` | `hostelManagement` | `AdminDashboard.tsx:473`, `DashboardOverview.tsx:550` | BELUM DILAKSANAKAN |
| `components/admin/TransportManagementScreen.tsx` | `transportManagement` | `AdminDashboard.tsx:474`, `DashboardOverview.tsx:551` | BELUM DILAKSANAKAN |
| `components/admin/ComplianceOnboardingPage.tsx` | `complianceOnboarding` | `AdminDashboard.tsx:450`, `DashboardOverview.tsx:513` | BELUM DILAKSANAKAN |
| `components/admin/CustomGamesListScreen.tsx` | `customGamesList` | `AdminDashboard.tsx:488` | BELUM DILAKSANAKAN |
| `components/admin/SalaryConfiguration.tsx` | `salaryConfiguration` | `AdminDashboard.tsx:496` | BELUM DILAKSANAKAN |
