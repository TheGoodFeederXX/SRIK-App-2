# 06 — Fasa 4: Assessment dan report card

## LOCKED model

Assessment: subject_id, class_id, academic_term_id, max_score, type. Jenis merangkumi UASA/UJIAN/QUIZ/ASSESSMENT/PBD/PROJECT; taxonomy akhir boleh disahkan. Tambah title/status/creator/publish metadata sebagai PROPOSED implementation fields.

AssessmentResult: assessment_id, student_id, score, grade, tp, comment. Unique assessment + student. TP nullable 1–6, bukan gred peperiksaan. PBDRecord/LearningStandard full module deferred; keputusan TP memerlukan pertimbangan guru dan evidence, bukan auto-map markah.

## Integriti

- Score exact numeric, 0 hingga max_score apabila hadir; null score bukan sifar. **PROPOSED:** result_status untuk NOT_ENTERED/ABSENT/EXEMPT/GRADED supaya tidak hadir tidak dikira gagal secara senyap.
- Class, subject, term dan enrollment mesti konsisten. Guru hanya mengisi result dalam scope assignment dan permission yang dibenarkan.
- Grade boundaries/rounding/class rank ialah PROPOSED konfigurasi, bukan aturan Malaysia yang dianggap seragam. Rank optional.
- Finalization/publishing guna RPC atomic dengan permission, validation dan audit. Published source results tidak boleh diubah melalui direct update yang memintas workflow.

## ReportCard — LOCKED snapshot

Sumber ialah AssessmentResult. Ketika publish, snapshot keputusan, attendance, comments, nama/kelas/subject display dan rank jika digunakan. **PROPOSED:** report period/student/version, published_at/by, snapshot_schema_version, status dan supersedes_id.

Snapshot published tidak berubah apabila profil atau markah sumber berubah. Pembetulan menghasilkan revision baru dengan audit trail; report lama kekal traceable. Bezakan draft preview daripada published report.

PDF ialah rendering snapshot yang sama. Pilih client rendering atau compute server berdasarkan workload sebenar; jangan assume Edge Functions sesuai untuk headless browser/bulk PDF tanpa menguji had runtime. Muat turun memerlukan authorization.

## Syarat siap

Mark entry dan finalization berfungsi; null/absent/max score/TP checks diuji; guru tidak boleh mengisi kelas luar scope; snapshot kekal selepas source edit; revision jelas; layout PDF disemak jika PDF dibina dalam fasa ini.
