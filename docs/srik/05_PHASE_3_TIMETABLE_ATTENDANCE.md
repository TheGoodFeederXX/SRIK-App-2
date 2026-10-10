# 05 — Fasa 3: Timetable dan attendance

## Timetable — LOCKED

`Timetable`: academic_year_id, effective_from, status; **PROPOSED** effective_to, version dan publish metadata.

`TimetablePeriod`: timetable_id, day_of_week, period_number, start_time, end_time, type.

Types: TEACHING, ASSEMBLY, BREAK, PRAYER, ACTIVITY.

`TimetableEntry`: period_id, class_id, subject_id, teacher_id, room_id optional. Untuk PdP, validate terhadap assignment aktif. Perhimpunan/Rehat/Zohor/Yasin-Dhuha bukan fake subjects; gunakan period type dan label activity. Schema entry aktiviti boleh dipilih tanpa memaksa subject.

## Aturan SRIK untuk seed template

- Hari Ahad–Khamis; 7:30 pagi–2:30 petang; 12 waktu termasuk Rehat/Zohor.
- Waktu 1, 7:30–8:05: Ahad Perhimpunan; Khamis Yasin/Dhuha; Isnin–Rabu sifir 10 minit kemudian PdP.
- Waktu 5, 9:50–10:25: Rehat.
- Waktu 11, 1:30–1:55: Zohor; Waktu 12, 1:55–2:30: PdP.
- Waktu lain mesti datang daripada template sekolah yang disahkan; jangan mereka boundary yang belum diberikan.
- Sifir dalam waktu PdP ialah segment/metadata, bukan menggandakan period atau memotong tempoh tanpa aturan.

Nama kelas contoh: 1/3/4/5 Al-Junaidi dan Al-Busiri; 2 Al-Junaidi; 6 Naim. Seed demo perlu label jelas, bukan dakwaan roster terkini.

## PROPOSED aturan jadual

Mula dengan manual editor dan validation; automatic scheduling engine ialah tahap kemudian. Validate teacher/class/room clashes, year consistency, effective dates dan weekly period requirements. Jangan benarkan edit jadual published secara senyap; revise/version secara explicit. Aktiviti bersama bukan teacher clash palsu. Jika satu guru mengajar dua kelas gabungan dalam slot sama, modelkan combined session/class membership secara explicit sebelum membenarkannya; jangan disable clash checks secara global.

## Attendance — LOCKED daily scope

StudentAttendance: student_id, class_id, date, status, remark, recorded_by. Status PRESENT/ABSENT/LATE/EXCUSED/SICK. **PROPOSED:** enrollment_id untuk trace dan UNIQUE(student_id, date); class mesti sepadan enrollment pada tarikh tersebut. Period attendance tidak termasuk v1.

TeacherAttendance: teacher_id, date, check_in, check_out, status, remark. Manual/admin dahulu; biometric/geofencing deferred. **PROPOSED:** satu row per guru per date, timestamp timezone-aware, check_out tidak lebih awal daripada check_in; catalog status guru disahkan berasingan.

Hari persekolahan menggunakan Asia/Kuala_Lumpur; timestamps simpan timestamptz. Ketiadaan attendance row tidak boleh dilapor sebagai ABSENT secara automatik. Pembetulan diaudit, tanpa overwrite siapa merekod/membetulkan tanpa trace.

## Syarat siap

Template sekolah valid; editor menghalang conflicts; daily attendance unique dan scoped; bulk record atomic/idempotent; date boundary Malaysia diuji; report membezakan belum direkod dan tidak hadir. Offline writes belum dibina.
