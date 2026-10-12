# F39 — Perlindungan kata laluan bocor: keputusan risiko bertulis

**Tarikh:** 12 Oktober 2026
**Penemuan audit:** F39 (P2) — "Leaked-password protection Auth live dimatikan"

## Apa yang audit minta

Kriteria penerimaan F39 ada dua cabang, dan mana-mana satu memadai:

1. Hidupkan perlindungan kata laluan bocor jika konfigurasi/pelan projek menyokongnya; **atau**
2. Ada **keputusan risiko bertulis** jika ciri itu tidak tersedia.

Dokumen ini ialah cabang kedua, dan juga merekod apa yang sudah dilakukan bagi bahagian pertama
yang memang boleh dilakukan.

## Percubaan untuk menghidupkannya

Saya cuba menghidupkan perlindungan HaveIBeenPwned melalui API pengurusan Supabase:

```http
PATCH /v1/projects/qtpsuemjzxngltpblkoj/config/auth
{"password_hibp_enabled": true}
```

Jawapan pelayan, apa adanya:

```json
HTTP 402
{"message":"Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up."}
```

Ini bukan tekaan atau inferens daripada fail konfigurasi. Pelayan menolak permintaan itu sendiri.
Projek SRIK berada pada pelan percuma. **Ciri ini tidak boleh dihidupkan dari sini**, dan tiada
perubahan kod boleh mengubahnya.

## Keputusan risiko

**Diterima sementara, dengan mitigasi dan tarikh semakan.**

| | |
|---|---|
| Risiko | Pengguna boleh memilih kata laluan yang pernah bocor dalam insiden awam. |
| Kesan | Akaun boleh diambil alih melalui *credential stuffing* — kata laluan yang sama digunakan semula di tempat lain. |
| Pendedahan | Terhad: satu sekolah, kira-kira 250 pengguna, tiada data kewangan awam. Laman tidak boleh didaftarkan sendiri; akaun hanya dicipta oleh pihak sekolah. |
| Kebarangkalian | Sederhana. *Credential stuffing* automatik dan meluas. |
| Mitigasi yang ADA | Lihat di bawah. |
| Mitigasi yang TIADA | Semakan senarai kata laluan bocor. |
| Pemilik keputusan | Pemilik projek (pihak sekolah) |
| Semakan semula | Bila pelan dinaikkan ke Pro, atau bila bilangan akaun melebihi 500 |

## Mitigasi yang sudah dipasang

1. **Panjang minimum 10 aksara — dikuatkuasa pelayan.** `password_min_length = 10`.
2. **Tiga kelas aksara wajib** — huruf kecil, huruf besar, dan nombor.
3. **Klien dan pelayan kini sepadan.** Perisian sekolah sebelum ini menyemak "sekurang-kurangnya
   8 aksara" sahaja, jadi kata laluan 8 atau 9 aksara **lulus semakan aplikasi** dan kemudian
   **ditolak pelayan** dengan mesej yang tidak boleh difahami pengguna. Sekarang kedua-duanya
   membaca satu peraturan yang sama (`PASSWORD_MIN_LENGTH`, `describePasswordProblem`), dan satu
   ujian membandingkannya dengan tetapan pelayan yang sebenar supaya ia tidak boleh berpisah lagi.
4. **Perubahan kata laluan memerlukan pengesahan semula.** 
   `security_update_password_require_reauthentication` kini `true` (sebelum ini `false`). Sesi yang
   dicuri tidak lagi cukup untuk menukar kata laluan akaun.
5. **Tiada pendaftaran sendiri.** Akaun hanya wujud melalui jemputan sekolah, jadi penyerang tidak
   boleh memilih kata laluan mangsa.
6. **Perlindungan pentadbir terakhir** dan jejak audit yang tidak boleh dipalsukan (F11/F12).

## Bila keputusan ini mesti disemak semula

Keputusan ini menjadi **tidak boleh diterima** dan mesti dinaikkan ke Pro jika mana-mana satu
berlaku:

- Bilangan akaun aktif melebihi **500**.
- Sekolah menyimpan data kewangan atau perubatan yang lebih sensitif daripada sekarang.
- Laman menjadi boleh diakses awam untuk pendaftaran sendiri.
- Berlaku satu insiden pengambilalihan akaun.

## Rujukan

- Penemuan: `SRIK-App-2_AUDIT_2026-10-10.md` F39
- Bukti penolakan pelayan: jawapan HTTP 402 di atas
- Tetapan semasa: `password_min_length = 10`, `password_required_characters = a-z:A-Z:0-9`,
  `password_hibp_enabled = false`, `security_update_password_require_reauthentication = true`
