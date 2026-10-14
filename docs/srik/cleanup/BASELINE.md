# C0 — Baseline dan Peta Pergantungan

Penugasan: `SRIK_DEEPSEEK_HARNESS_SAFE_CLEANUP.md` v1.0
Commit rujukan: `4fc7f9bffde713f29a8fcb22c3f992ef64746793` (0.8.30)

## 1. Keadaan awalan

| Perkara | Nilai |
|---|---|
| Branch kerja | `cleanup/safe-removal-c1-c2` (dicipta daripada `main`) |
| HEAD baseline | `4fc7f9bffde713f29a8fcb22c3f992ef64746793` |
| `git status --short` | kosong (pokok bersih) |
| Node | v24.21.0 (sepadan `.nvmrc` dan `engines`) |
| npm | 11.19.0 |
| Versi aplikasi | 0.8.30 |

## 2. Baseline pemeriksaan (sebelum sebarang perubahan)

| Perintah | Keputusan |
|---|---|
| `npx tsc --noEmit` | **0 ralat** |
| `npx vite build` | **exit 0** |
| `npx vitest run` | **537 lulus / 75 fail** (direkod sebelum tugas ini, commit 4fc7f9b) |

Tiada kegagalan sedia ada yang perlu dikecualikan. Baseline adalah hijau sepenuhnya,
jadi sebarang kegagalan selepas perubahan ini adalah regresi.

## 3. Peta sasaran C1 (lapan komponen)

Kaedah: carian seluruh repo bagi nama fail, nama eksport, laluan relatif dan import,
mengecualikan `node_modules`, `.git/` dan output binaan (`dist/`, `backend/dist/`).

| Sasaran | Rujukan ditemui | Keputusan |
|---|---|---|
| `components/rewards/RewardsSystem.tsx` | tiada | REMOVE |
| `components/rewards/Leaderboard.tsx` | tiada | REMOVE |
| `components/shop/EnhancedShop.tsx` | tiada | REMOVE |
| `components/learning/LearningPathsDashboard.tsx` | tiada | REMOVE |
| `components/messaging/ChannelMessaging.tsx` | tiada | REMOVE |
| `components/video/LiveClassRoom.tsx` | diimport oleh tiada sesiapa; ia mengimport `DailyClassRoom` dan `./jitsiUrl` | REMOVE |
| `components/video/DailyClassRoom.tsx` | diimport hanya oleh `LiveClassRoom` (baris 5, 201) | REMOVE |
| `components/shared/XSSDemo.tsx` | tiada | REMOVE |

Tiada fail ujian merujuk mana-mana daripada lapan sasaran ini.

### 3.1 Fail yang DIKEKALKAN dalam folder yang sama

Ini penting dan disahkan secara langsung, bukan diandaikan:

| Fail | Sebab dikekalkan |
|---|---|
| `components/video/VirtualClassroom.tsx` | **DIGUNAKAN AKTIF** oleh `components/student/StudentDashboard.tsx` baris 50 (lazy import) dan baris 765 (`liveClass: VirtualClassroom`), dan butangnya muncul pada baris 427. Ia sendiri memaparkan `ComingSoonScreen`, tetapi ia dicapai dari portal murid, jadi ia kekal. |

**Pembetulan rekod.** Dalam draf pertama jadual ini, saya menulis bahawa
`components/video/jitsiUrl.ts` "masih diimport oleh `VirtualClassroom`/`LiveClassRoom`".
Itu andaian awal, bukan pemeriksaan. Selepas pembuangan C1 dijalankan, carian semula
menunjukkan `jitsiUrl.ts` **tiada pengguna langsung** (lihat C1 untuk keputusan dan
sebab ia tidak dibuang dalam fasa ini). Rekod asal dikekalkan di sini sebagai pembetulan,
bukan dipadam secara senyap.
| `components/messaging/*` yang lain | komunikasi dan pengumuman aktif |

Folder `components/video/` **tidak** dipadam; hanya pasangan Daily/Live dibuang.

## 4. Peta sasaran C2 (lima UI modul)

Kelima-limanya disahkan sebagai placeholder `ComingSoonScreen` pada HEAD:

| Fail | Route key | Baris | DashboardOverview | Keputusan |
|---|---|---|---|---|
| `components/admin/HostelManagementScreen.tsx` | `hostelManagement` | 27 | baris 550 | REMOVE |
| `components/admin/TransportManagementScreen.tsx` | `transportManagement` | 28 | baris 551 | REMOVE |
| `components/admin/ComplianceOnboardingPage.tsx` | `complianceOnboarding` | 35 | baris 513 | REMOVE |
| `components/admin/CustomGamesListScreen.tsx` | `customGamesList` | 28 | tiada kad dijumpai | REMOVE fail + entri registry |
| `components/admin/SalaryConfiguration.tsx` | `salaryConfiguration` | 30 | tiada kad dijumpai | REMOVE fail + entri registry |

Registry: `components/admin/AdminDashboard.tsx` baris 450, 473, 474, 488, 496.

`scripts/test-admin-all-dynamic.ts` dan `scripts/test-admin-e2e.ts` menyebut key ini,
tetapi kedua-duanya adalah skrip ujian endpoint backend legasi (memanggil laluan HTTP
seperti `/hostels`, `/transport/routes`) yang tidak digunakan oleh aplikasi Supabase.
Status: perlu dinilai semasa C3; tidak disunting dalam C1/C2.

## 5. Peta dependency (C1.2)

Carian mengecualikan `node_modules`, `.git/` dan output binaan.

| Dependency | Rujukan aktif | Keputusan |
|---|---|---|
| `react-paystack` | tiada | BOLEH BUANG |
| `nativewind` | tiada (tiada config nativewind/babel/metro) | BOLEH BUANG |
| `@reduxjs/toolkit` | tiada | BOLEH BUANG |
| `react-redux` | tiada | BOLEH BUANG |
| `@google/genai` | tiada | BOLEH BUANG |
| `@hcaptcha/react-hcaptcha` | tiada | BOLEH BUANG |
| `@daily-co/daily-js` | hanya `components/video/DailyClassRoom.tsx` | BOLEH BUANG selepas C1 |

Nota: `backend/dist/package.json` mengandungi salinan manifest lama dengan kesemua
dependency ini. Ia fail output binaan backend legasi, bukan punca kebenaran, dan tidak
diambil kira sebagai rujukan aktif. Skop C3.

## 6. Percanggahan dan pengisytiharan had

1. **Folder `components/messaging/`** bukan satu fail. `ChannelMessaging.tsx` dibuang
   sahaja; `MessagesLayout.tsx` dan yang lain kekal dan aktif.
2. **`components/learning/`** bukan arahan membuang semua learning.
   `LearningPathsDashboard.tsx` dibuang sahaja.
3. **`components/rewards/`** kedua-duanya dibuang, jadi folder menjadi kosong dan
   akan turut hilang; `components/shop/` juga menjadi kosong.
4. **Pengesahan UI belum dijalankan.** Tiada pelayar dalam persekitaran ini. Gate UI
   C2 dilaporkan sebagai `BELUM DISAHKAN`, bukan LULUS.
5. **Bundle size tidak diukur** pada baseline. Perbandingan saiz hanya akan dilaporkan
   jika benar-benar diukur, mengikut arahan §5.3.
