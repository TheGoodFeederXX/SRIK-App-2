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

## 9. Terjemahan menyeluruh: teks yang masih belum diterjemah (0.8.34)

Skop yang dipersetujui pemilik: **Melayu + Inggeris sahaja**, dan kerja itu ialah
**memburu teks yang masih Inggeris**, bukan menulis semula ayat Melayu.

Kaedahnya bukan "cari perkataan AI" tetapi satu pengimbas tiga lapis ke atas kod
yang benar-benar boleh dicapai dari `App.tsx`:

1. teks JSX antara `>` dan `<`;
2. nilai atribut yang dipaparkan (`placeholder`, `title`, `label`, `alt`,
   `emptyText`, `desc`, `explanation`);
3. ayat Melayu keras (yang akan muncul juga kepada pembaca bahasa Inggeris).

**Penemuan penting — mengapa jumlahnya kecil, bukan nol:** graf kebolehan-capai
memisahkan 72 teks sebenar daripada 153 teks dalam **kod mati**. Fail mati
(`lib/invoice-generator.ts`, `lib/receipt-generator.ts`, `lib/emailTemplates.ts`
dan lima belas lagi) mempunyai teks Inggeris keras, tetapi tiada skrin pernah
memaparkannya — kerana `lib/auth.ts` dan penyuntik dokumen itu sendiri tiada
pengimport. Menterjemahnya hanya menambah kunci yang tidak pernah dibaca. Ia
dicatatkan sebagai baki, bukan "dibaiki" secara palsu.

**Dibetulkan:** 72 teks yang benar-benar dipaparkan, termasuk kepala jadual
markah ("Grade", "Remark", "Absent"), pilihan borang ("Male", "Female",
"Father", "Mother", "Other"), menu tepi ("Home", "Exams"), label audit
("User", "Action", "Risk"), dan mesej ralat. Semua melalui `common.*` jika
dikongsi, atau namespace skrin jika khusus — supaya satu pilihan diterjemah
sekali sahaja.

**Pepijat sebenar yang ditemui apabila memeriksa skrin:** `components/shared/ChatScreen.tsx`
menghantar `title="Chat"` sebagai nilai tetapi `explanation` ditulis dengan
`t(...)` — satu daripada dua, bukan kedua-duanya. Dibetulkan kepada corak
`titleKey`/`explanationKey` yang sedia ada pada `ComingSoonScreen`.

**Kecacatan kebolehcapaian yang ditemui dan DIPERBAIKI (dengan kelulusan pemilik):**
skrin "Tetapan Kebolehcapaian" menyimpan pilihan tetapi **tidak pernah membacanya
semula** — `applySettings` berjalan hanya semasa skrin itu dibuka, jadi saiz teks
pilihan pengguna hilang sebaik sahaja dia berpindah skrin. Dua daripada tiga suis
menambah kelas CSS (`high-contrast`, `reduce-motion`) yang **tidak wujud di mana-mana
stylesheet**, jadi ia tidak berkesan walaupun pada skrin itu sendiri. Pilihan bahasa
pula menawarkan Yoruba, Igbo dan Hausa — bahasa yang apl ini tidak ada.

Pembaikan: satu modul `src/lib/accessibility.ts` (baca, simpan, guna) yang dibaca
di peringkat apl; kelas CSS sebenar ditambah pada `index.css`; pemilih bahasa mati
dan suis teks-ke-ucapan mati (yang juga tiada kesan) dibuang. Diuji oleh
`src/lib/__tests__/accessibility-prefs.test.ts` — **12 ujian, disahkan songsang**:
mengembalikan pepijat `applySavedAccessibilitySettings` sebagai no-op → gagal;
membuang blok CSS → gagal.

Pengiraan: `tsc` 0, `tsc` backend 0, **531 ujian lulus** (74 fail),
`vite build` keluar 0, pariti locale **3367 = 3367**, `supabase/` tidak disentuh.

### 9a. Terjemahan babak kedua + penyingkiran kod mati (0.8.35)

Pemilik meminta buruan diteruskan ke **semua** kawasan — skrin utama, dokumen
cetak, mesej ralat/toast, dan notifikasi — dan memilih **"padam terus kod mati"**.

**Diterjemah (bab ini):** 99 mesej ralat/toast dan label, semuanya disahkan
kebolehan-capainya. Yang ketara:

- Skrin **log masuk dan kata laluan** — "Email is required", "The two passwords
  do not match.", "Password must be at least 12 characters." Skrin ini yang
  pertama dilihat pengguna.
- **Dokumen cetak** — kepala jadual kad laporan ("Late", "Exam", "Term", "Live"),
  yang dicetak dan diberi kepada ibu bapa.
- **Lapisan data** (`src/lib/supabase/*.ts`) — 51 mesej "Could not load …" yang
  muncul dalam toast. Corak `i18n.t()` sedia ada daripada `auditTrail.ts`
  digunakan; 31 kunci baharu di bawah `dataErrors.*`, disemak wujud dalam kedua-dua
  fail bahasa. Nota: laluan import perlu `../../../lib/i18n`, bukan `../../` —
  kesilapan pertama dikesan oleh `tsc`, bukan oleh mata.

**Kod mati dipadam: 121 fail.** Graf kebolehan-capai dibina semula dengan fail
ujian sebagai titik permulaan juga (versi pertama terlepas ini, dan menandakan
dua fail ujian hidup sebagai mati).

**Tiga fail SENGAJA TIDAK DIPADAM**, walaupun tiada kod mengimportnya, kerana
ujian hidup mengesahkan kewujudannya:

| Fail | Sebab |
| --- | --- |
| `components/admin/CalendarManager.tsx` | `no-legacy-api.test.ts` menyenaraikannya dalam `MIGRATED`, dan ujian "the list is a real list of files" gagal jika ia hilang |
| `components/parent/AlertsScreen.tsx` | `family.test.ts` **membaca teks sumbernya** untuk memastikan ia tidak kembali ke API lama |
| `lib/paymentGateways.ts` | `tests/branding/no-legacy-branding.test.ts` menyenaraikannya dalam `ALLOWED` dan mengesahkan setiap entri masih wujud |

Dua yang pertama ialah pengawal regresi: memadamnya akan menghapuskan ujian yang
menghalang ciri itu dibina semula. Yang ketiga ialah pengecualian penjenamaan
yang masih dinyatakan sebabnya.

**Perangkap yang hampir menyebabkan kesilapan:** terdapat berbilang fail dengan
**nama asas yang sama** dalam direktori berbeza — `components/admin/Header.tsx`
lwn `components/ui/Header.tsx`, `components/shared/NewChatScreen.tsx` lwn
`components/teacher/NewChatScreen.tsx`, `hooks/useNotifications.ts` lwn
`lib/hooks/useNotifications.ts`, `hooks/useOnlineStatus.ts` lwn
`components/shared/OfflineIndicator.tsx`. Carian mengikut nama asas memberi
amaran palsu dan, lebih bahaya, boleh memberi **keyakinan palsu**. Semakan
dijalankan semula oleh pemeriksa bebas yang menyelesaikan setiap specifier
import kepada fail sebenar; ia menemui tiga fail selamat di atas.

**Dibetulkan dalam ujian:** `family.test.ts` menuntut penjelasan
`ComingSoonScreen` ditulis sebagai literal (`explanation=`). Skrin yang sudah
diterjemah menggunakan `explanationKey=`, jadi peraturan itu memaksa teks
Inggeris kekal hidup semata-mata untuk memenuhi jenis — teks yang tiada pembaca
boleh capai, kerana kunci sentiasa menang. Pengawal itu diperkuat: ia menerima
kedua-dua bentuk DAN mengesahkan teks yang dirujuk kunci itu wujud serta melebihi
120 aksara **dalam kedua-dua fail bahasa**. Disahkan songsang: memendekkan
`quizzesScreen.explanation` kepada "Too short." menjadikan ujian gagal dengan
mesej tepat; dipulihkan → lulus.

`ComingSoonScreen` kini menerima `title`/`explanation` sebagai **pilihan** apabila
kunci diberikan; jenis itu masih memaksa satu daripadanya hadir.

Pengiraan babak ini: `tsc` 0, `tsc` backend 0, **531 ujian lulus** (74 fail),
`vite build` keluar 0 (308 cebisan JS), pariti locale **3484 = 3484**,
`supabase/`, `AGENTS.md`, `CLAUDE.md`, `.github/` tidak disentuh.

### 9b. Terjemahan babak ketiga: teks yang lari daripada pengimbas (0.8.36)

Pemilik mahu buruan "lebih dalam". Pengimbas terdahulu hanya mengenal teks JSX
kasar. Lapisan baharu mencari tiga bentuk yang lari daripadanya: kunci objek
(`label:`/`title:`/`name:`), literal templat, dan teks paparan yang dibina dalam
kod. Untuk mesej ralat sistem luar, pemilik memilih **ayat mudah di hadapan,
butiran teknikal di belakang**.

**Penemuan terbesar: menu navigasi.** `DashboardBottomNav.tsx` dan
`DashboardSidebar.tsx` — bar bawah dan sisi yang ada pada **hampir setiap
skrin** — menyimpan 17 label sebagai teks keras Inggeris: "Home", "Fees",
"Forum", "More", "Games", "People", "Audit". Hanya sebahagian jiran mereka sudah
memakai `t()`, jadi fail itu kelihatan diterjemah. Seorang pengguna Melayu
melihat menu Inggeris sepanjang masa.

**Penemuan kedua: kunci yang sebenarnya ayat.** `UserRolesScreen` menyimpan
`descriptionKey: 'A parent or guardian. Sees only their own children.'` — ayat
Inggeris penuh diletakkan di tempat yang sepatutnya mengandungi kunci. Kerana
`t()` bagi kunci yang tidak wujud memulangkan kunci itu sendiri, kad penjaga
memaparkan ayat Inggeris itu pada skrin Melayu, dan kelihatan seperti sudah
diterjemah. Ini kelas pepijat yang **tiada pengawal lain dapat melihat**: `tsc`
gembira, skrin berjalan, dan ujian lama lulus.

Pengawal baharu ditambah dalam `screen-keys-resolve.test.ts`: sebarang nilai
yang diberikan kepada apa-apa `*Key` **tidak boleh mengandungi ruang**. Kunci
sebenar tidak pernah ada ruang. Disahkan songsang: mengembalikan ayat itu
menjadikan ujian gagal dengan nama fail dan ayat tepat; dipulihkan, lulus.

**Juga dibetulkan:**

- Layar kurikulum (`CurriculumScreen`) — mesej kosong
  "Could not find subjects for the selected level (…)" dipaparkan kepada
  **setiap** murid, kerana `getCurriculum` hanya mengenal tahap Nigeria
  ("Primary 1", "JSS 2", "SSS 1") dan sekolah ini menghantar "Grade 4", jadi ia
  sentiasa memulangkan senarai kosong.
- Lencana kategori kurikulum ("Core", "Compulsory", "Elective") — data dari
  pangkalan data, jadi diterjemah semasa dipaparkan, bukan semasa disimpan.
- 11 dialog pengesahan tindakan merbahaya ("Remove …? This cannot be undone.",
  "Remove all duties for …?", "Are you sure you want to delete …?") — teks yang
  dibaca sebelum sesuatu dipadam.
- Label tindakan pantas admin dan guru ("Marks", "System", "Roles", "Exams",
  "Absent").
- Kategori direktori sumber ibu bapa. Nilai `name` **dikekalkan** sebagai penapis
  dan `labelKey` ditambah untuk paparan: menterjemah `name` sendiri akan
  mematikan penapisan secara senyap.
- Ayat kongsi Math Sprint, dan mesej kemas kini versi.

**Kesilapan saya sendiri.** Satu skrip penggantian global memusnahkan lapan fail
— seluruh huruf `t` bertukar menjadi `(`. `tsc` melaporkan 5130 ralat serta-merta
dan fail dipulihkan daripada git. Semua suntingan seterusnya menggunakan pembantu
yang **menolak** melainkan padanan tepat satu; ia menolak tiga suntingan yang
salah teka, bukan merosakkan fail.

Pengiraan babak ini: `tsc` 0, `tsc` backend 0, **532 ujian lulus** (74 fail),
`vite build` keluar 0, pariti locale **3544 = 3544**, `supabase/`,
`AGENTS.md`, `CLAUDE.md`, `.github/` tidak disentuh.

### 9c. Istilah kurikulum asing dibuang, KSSR dikekalkan (0.8.36)

Pemilik meminta dua perkara: buang kurikulum British dan kekalkan KSSR sahaja;
dan gantikan istilah kolej/universiti/sekolah menengah dengan istilah sekolah
rendah. Pemilik memilih pembetulan penuh — bukan menyembunyikan pilihan, tetapi
membuangnya.

**Apa yang sebenarnya rosak.** Kod ini berasal daripada projek Nigeria. Sisa
sistem itu masih hidup di tempat yang paling mudah terlepas pandang: **nilai yang
dipaparkan** kelihatan sudah bersih kerana teks Inggerisnya sudah ada
terjemahan Melayu, tetapi **pilihan yang boleh disimpan** masih menawarkan
kurikulum sekolah tidak ajar.

- `AcademicSettingsScreen` — senarai jatuh menawarkan `KSSR` / `British` / `Both`,
  dan satu ketika dahulu lalainya ialah 'Nigerian'. Tetapan ini memberi suapan
  kepada senarai subjek dan struktur penggal di seluruh aplikasi, jadi memilih
  'British' bukan sekadar label salah — ia mengubah tingkah laku.
- `CurriculumManagementScreen` — tiga senarai berasingan. `BRANCH_FOCUS_OPTIONS`
  menawarkan `american` walaupun **tiada siapa membacanya**; `STUDENT_TRACK_OPTIONS`
  membenarkan admin menanda seorang anak sebagai trek British.
- `StudentEnrollmentPage` — tiga kad pilihan (KSSR / BRITISH / DUAL) semasa
  mendaftar murid baharu. **Nilai itu tidak pernah dihantar ke pelayan**, jadi
  memilih 'British' langsung tiada kesan — hanya kelihatan seolah-olah ada.
- `ExamManagement` dan `AddExamScreen` — menawarkan peperiksaan IGCSE/CHECKPOINT
  (Cambridge) dan nama pilihan 'British'.
- `PersonnelFileView` — baris 'British Qualification'. Tiada jenis data
  mengisytiharkan medan itu dan tiada apa-apa mengisinya, jadi baris itu
  **sentiasa kosong**: satu baris kelayakan yang menyebut negara asing dan tidak
  membawa maklumat.
- `PersonnelFileView` juga memakai istilah kolej/universiti: 'Degree
  Certificate' untuk sijil ijazah guru — kini 'Sijil Ijazah'.
- `DEFAULT_STANDARD_CLASSES` dan `SUBJECTS_LIST` dalam `constants.tsx` —
  senarai kelas sampai JSS/SSS dan senarai 64 subjek bertag `Nigerian` /
  `British` / `Both`.

**Istilah tingkatan: bahagian yang paling berisiko.** Empat skrin menyimpan
**salinan berasingan** fungsi yang sama, dan setiap salinan menukar gred 7 kepada
"JSS 1" dan gred 10 kepada "SSS 1" — sekolah menengah rendah dan atas Nigeria.
Dua daripadanya turut meneka daripada teks kelas ("SENIOR"/"JUNIOR"). Empat
salinan bermakna satu pembetulan boleh tersasar dan tiga yang lain tertinggal —
itulah sebabnya ia mula bercanggah. Kesemuanya digantikan dengan **satu pembantu
kongsi** (`lib/gradeLevel.ts`).

Bahagian "berisiko" itu bukan hiasan: gred di luar 1–6 **tidak** dinamakan
"Tahun 7". Sekolah ini tidak ada Tahun 7, jadi pembantu memulangkan `null` dan
skrin memutuskan sendiri — menamakannya akan menyatakan sesuatu yang tidak benar
pada kad laporan yang dibaca ibu bapa.

`getFormattedClassName` turut membetulkan gred ≥7: ia dahulunya menghasilkan "JSS
1", dan nilai itu mengalir sebagai `student.level`.

**Keselamatan data lama.** Nilai yang sudah tersimpan boleh berbunyi 'British'.
Pada tetapan kurikulum, pembacaan nilai selain KSSR kini **dibaca sebagai KSSR**
— kalau tidak, senarai jatuh itu akan kosong, dan simpanan seterusnya akan
menulis kekosongan itu menimpa nilai sebenar.

**Pengawal baharu, disahkan songsang.** 16 ujian dalam
`lib/__tests__/grade-level.test.ts`. Setiap satu dibuktikan gagal apabila
kecacatan diperkenalkan semula, dengan nama fail yang betul:

- memasukkan semula `{ name: 'SSS 1', level: 'Secondary' }` → gagal;
- memasukkan semula pilihan `<option value="British">` → gagal;
- memasukkan semula kad `BRITISH` dalam pendaftaran murid → gagal.

Ujian ini membaca **kata sebenar** yang dihasilkan, bukan sekadar "ia
memulangkan rentetan" — ujian yang lemah akan lulus pada kod yang rosak.
Komen dikecualikan semasa mengimbas, kerana penjelasan tentang apa yang dibuang
bukan pengenalan semula.

**Dibuang, bukan disimpan sebagai perangkap.** Kunci terjemahan untuk kurikulum
asing turut dibuang, supaya nama itu tidak boleh muncul semula dalam UI.

Pengiraan babak ini: `tsc` 0, `tsc` backend 0, **548 ujian lulus** (75 fail),
`vite build` keluar 0, pariti locale **3542 = 3542**. Dalam bundle aplikasi,
istilah `British`, `IGCSE`, `Cambridge`, `Edexcel`, `Common Core`, `Nigerian`,
`Yoruba` dan `JSS`/`SSS` kesemuanya **0 kemunculan**; `Kurikulum KSSR` hadir.
`supabase/`, `AGENTS.md`, `CLAUDE.md`, `.github/` tidak disentuh.

## 10. Penyingkiran AI penuh (0.8.33)

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

## 11. Rollback

Setiap fasa ialah commit berasingan dan boleh dibalikkan secara berasingan:

```bash
git revert 056ea6f   # C2 sahaja
git revert e2e07f5   # C1 sahaja
git revert <sha 0.8.33>   # penyingkiran AI sahaja
```

Tiada `git reset --hard`, tiada force push, dan tiada mutasi data dijalankan.
Tiada perubahan pada `supabase/` dalam mana-mana commit.
