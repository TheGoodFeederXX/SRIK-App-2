# 04 — Fasa 2: Profil dan academic core

Prasyarat: auth/RLS foundation lulus. Gunakan UUID PK, FK sebenar, timestamps dan migration SQL. Field di bawah ialah **target minimum dicadang** kecuali aturan yang sudah LOCKED.

## Profil

| Entity | Field minimum / aturan |
|---|---|
| SchoolProfile | name, short_name, code?, logo_storage_key?, address, phone, email, website, principal_name, settings; konfigurasi tunggal, bukan tenant |
| Teacher | user_id nullable unique, staff_code, full_name, gender?, phone?, email?, employment dates?, status |
| Student | user_id nullable unique, admission_no, full_name, gender?, birth_date?, birth_place?, nationality?, identity_no?, address?, previous_school?, admission_date, status |
| Guardian | user_id nullable unique, full_name, identity_no?, phone, email?, address?, occupation? |
| StudentGuardian | student_id, guardian_id, relationship, is_primary, is_emergency_contact |

Avatar guna private storage reference sesuai, bukan public URL wajib. Nilai identity/telefon ialah text, jangan integer. Jika diperlukan, bilangan adik-beradik/anak dan turutan kelahiran ialah field berlainan; jangan andaikan maknanya sama. Sahkan keperluan profil penuh sebelum mengumpul data tambahan.

## Akademik — LOCKED relational structure

| Entity | Field |
|---|---|
| AcademicYear | name, start_date, end_date, status |
| AcademicTerm | academic_year_id, name, sequence, start_date, end_date, status |
| Class | academic_year_id, year_level, name, code, status |
| Subject | code, name, short_name, category, status; global, tidak duplicate setiap tahun |
| StudentEnrollment | student_id, class_id, academic_year_id, enrolled_at, ended_at, status |
| ClassSubject | class_id, subject_id, academic_year_id |
| TeachingAssignment | teacher_id, class_id, academic_year_id, subject_id nullable, assignment_type, periods_per_week, effective_from, effective_to, status |

Display kelas gabung year_level dan name, contoh `3 Al-Junaidi`. Tiada current_class string/FK authoritative dalam Student. Subject referenced by ID.

CLASS_TEACHER menggunakan subject_id null; SUBJECT_TEACHER memerlukan subject. Guru kelas bukan homeroom_teacher_id tambahan pada Class. ASSISTANT disokong jika diperlukan; semak semantics sebelum assignment digunakan engine.

## Integriti — PROPOSED defaults

- Year level 1–6; date range valid; term dalam year; sequence term unique per year.
- Satu ACTIVE academic year pada satu masa; kelas tahun berlainan ialah rows berlainan.
- Enrollment/ClassSubject/TeachingAssignment tidak boleh merujuk class daripada academic year lain. Jika simpan academic_year_id yang redundant, enforce dengan composite FK/constraint, bukan UI sahaja.
- Tiada overlapping active enrollment bagi murid dalam academic year yang sama; pertukaran kelas menutup enrollment lama dan membuka yang baru secara atomic.
- ClassSubject unique class + subject. TeachingAssignment subjek mesti sepadan dengan ClassSubject. Period requirement jangan dikira dua kali apabila co-teacher ditambah; tentukan sumber requirement sebelum timetable generation.
- CLASS_TEACHER tidak memerlukan periods_per_week; SUBJECT_TEACHER mempunyai integer positif yang valid.
- Tarikh effective membolehkan pertukaran guru tanpa overwrite sejarah.
- Admission/staff/subject codes unique mengikut aturan yang dipilih; duplicate guardians berdasarkan nama sahaja tidak boleh auto-merge.
- Archive data yang sudah direferensikan; jangan cascade delete sejarah akademik.

## Operasi

CRUD melalui Data API + scope RLS. `bulk_enroll_students`, pertukaran kelas, `promote_students` dan `close_academic_year` melalui RPC atomic, authorized dan diaudit. Promotion memilih mapping kelas sasaran; jangan infer nama kelas atau auto-promote Tahun 6 tanpa aturan tamat sekolah.

## Syarat siap

Guru/murid/penjaga, kelas/subjek dan assignment boleh diurus. Sejarah kelas kekal selepas pertukaran. Constraint year mismatch/overlap menolak data salah. Seed hanya data sintetik; UI, database types, RLS dan RPC tests lulus.
