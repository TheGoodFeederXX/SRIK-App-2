# Panduan: Mencipta Akaun Guru (Pentadbir)

Panduan ini untuk pentadbir SRIK. Ia menerangkan cara mencipta akaun untuk guru
dan staf, langkah demi langkah.

Tiada kod perlu ditulis. Semua kerja dilakukan melalui papan pemuka Supabase.

---

## Sebelum bermula

Anda perlukan:

- Akses kepada papan pemuka Supabase projek SRIK
- Emel setiap guru yang anda mahu daftarkan
- Kata laluan sementara untuk diberi kepada mereka

**Penting:** Kata laluan sementara ini akan diketahui oleh **anda** dan
**guru**. Atas sebab itu, sistem akan **memaksa** guru menukarnya sendiri pada
kali pertama mereka log masuk. Selepas itu, anda tidak lagi tahu kata laluan
mereka.

---

## Langkah 1 — Cipta akaun

1. Buka papan pemuka Supabase projek SRIK
2. Pergi ke **Authentication** → **Users**
3. Tekan **Add user** → **Create new user**
4. Isi:
   - **Email** — emel guru (contoh: `ahmad@srik.edu.my`)
   - **Password** — kata laluan sementara, sekurang-kurangnya **12 aksara**
   - Tandakan **Auto Confirm User** supaya guru boleh log masuk terus
5. Tekan **Create user**

Selepas ini, satu baris profil akan tercipta secara automatik untuk guru itu.

---

## Langkah 2 — Tetapkan nama guru

1. Pergi ke **Table Editor** → **profiles**
2. Cari baris dengan emel guru (atau salin **User UID** dari langkah 1)
3. Sunting lajur berikut:
   - `full_name` — nama penuh guru (contoh: `Ahmad bin Ali`)
   - `display_name` — nama panggilan, jika ada (pilihan)
   - `phone` — nombor telefon, jika ada (pilihan)
4. **Tandakan** lajur `must_change_password` supaya guru dipaksa menukar kata
   laluan pada log masuk pertama
5. Simpan

---

## Langkah 3 — Berikan peranan

Setiap guru perlu peranan **TEACHER**. Tanpa peranan, mereka boleh log masuk
tetapi tidak boleh melihat apa-apa.

1. Pergi ke **Table Editor** → **user_roles**
2. Tekan **Insert row**
3. Isi:
   - `user_id` — salin **User UID** guru dari langkah 1
   - `role_code` — taip `TEACHER`
4. Simpan

Untuk memberi tugas tambahan (contoh: Guru Data atau Guru Jadual), jangan cipta
peranan baharu. Sebaliknya berikan **kebenaran tambahan** melalui jadual
`user_permissions`:

1. Pergi ke **Table Editor** → **user_permissions**
2. **Insert row**
3. Isi `user_id` (UID guru), `permission_code` (contoh: `students.manage`) dan
   `reason` (sebab ringkas)
4. Simpan

Untuk melihat senarai penuh kebenaran yang tersedia, buka jadual
`permissions`. Lajur `code` ialah nilai yang anda taip.

---

## Langkah 4 — Beritahu guru

Beritahu guru:

- Laman log masuk
- Emel yang anda gunakan
- Kata laluan sementara

Beritahu mereka bahawa sistem akan meminta mereka menetapkan kata laluan
sendiri sebaik sahaja mereka log masuk. Itu memang sepatutnya berlaku.

---

## Apa yang guru lalui

1. Guru membuka aplikasi dan taip emel serta kata laluan sementara
2. Sistem membawa mereka terus ke skrin "Set Your Password"
3. Guru taip kata laluan baharu mereka **dua kali**
   - Sekurang-kurangnya 12 aksara
   - Kedua-duanya mesti sama
4. Guru tekan **Save Password**
5. Sistem membawa mereka ke papan pemuka guru

Selepas ini, kata laluan sementara **tidak lagi berfungsi**. Hanya kata laluan
baharu guru itu boleh digunakan.

---

## Perkara penting yang perlu anda tahu

**Anda tidak boleh menetapkan kata laluan untuk guru selepas ini.** Jika guru
terlupa kata laluan, mereka gunakan pautan "Forgot Password?" pada skrin log
masuk. Kata laluan baharu akan dihantar ke emel mereka.

**Untuk menutup akses guru**, jangan padam akaun mereka. Pergi ke jadual
`profiles` dan tukar lajur `status` kepada `DISABLED`. Guru itu akan terus
terkunci daripada sistem, walaupun masih memegang akses lama yang belum tamat
tempoh. Ini lebih selamat daripada memadam, kerana rekod kerja mereka kekal.

**Anda tidak boleh melumpuhkan pentadbir terakhir.** Sistem akan menolak
cubaan itu, supaya sekolah tidak terkunci daripada sistemnya sendiri. Pastikan
ada sekurang-kurangnya dua pentadbir aktif.

**Semua perubahan peranan dan kebenaran direkodkan.** Jika anda perlu tahu
siapa memberi kebenaran kepada sesiapa dan bila, buka jadual
`authorization_audit`. Rekod ini tidak boleh diubah atau dipadam sesiapa.

---

## Jika berlaku masalah

| Masalah | Punca biasa | Penyelesaian |
|---|---|---|
| Guru tidak boleh log masuk | Emel salah, atau kata laluan kurang 12 aksara | Semak emel; cipta semula dengan kata laluan lebih panjang |
| Guru log masuk tetapi tidak nampak apa-apa | Tiada peranan diberikan | Tambah baris dalam `user_roles` dengan `role_code = 'TEACHER'` |
| Guru tidak dipaksa tukar kata laluan | Lajur `must_change_password` tidak ditanda | Sunting `profiles`, tandakan lajur itu, dan minta guru log masuk semula |
| Guru tersekat pada skrin "Set Your Password" | Kata laluan baharu terlalu pendek, atau dua kata laluan tidak sama | Minta guru semak kedua-dua medan |
| "This account has been disabled" | `status` bukan `ACTIVE` | Tukar `status` kembali kepada `ACTIVE` dalam jadual `profiles` |

---

## Nota teknikal (untuk rujukan kemudian)

Dokumen ini menerangkan kerja melalui papan pemuka Supabase. Ia sengaja tiada
skrin pentadbir dalam aplikasi, kerana:

- Kata laluan diurus oleh Supabase Auth, bukan disimpan dalam sistem
- Papan pemuka Supabase sudah selamat dan memerlukan log masuk
- Tiada kunci rahsia perlu disimpan dalam aplikasi

Jika skrin pentadbir dibina kemudian, ia mesti menggunakan **Edge Function**
yang diautentikasi — bukan terus dari pelayar — supaya kunci rahsia kekal di
pelayan dan tidak pernah sampai ke pelayar.

Rujukan: `supabase/migrations/20261007000001_phase1_auth_authorization.sql`
(lihat `clear_temporary_password_flag()` dan `profiles.must_change_password`).
