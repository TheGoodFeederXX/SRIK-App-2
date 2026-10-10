# SRIK — Operasi, Sandaran dan Pemulihan

Rujukan: `docs/srik/08_PHASE_6_OPERATIONS_RELEASE.md`

Dokumen ini untuk sesiapa yang menjaga sistem ini selepas pembinaan selesai.

---

## 1. Sandaran pangkalan data

**Sandaran yang tidak pernah dipulihkan bukan sandaran.** Ia fail yang kelihatan
selamat sehingga hari anda memerlukannya. Skrip di sini membuat kedua-dua
langkah: `backup.sh` menyalin, `restore-drill.sh` membuktikan salinan itu berguna.

```bash
export SRIK_DB_URL='postgresql://...'      # projek sekolah
./scripts/ops/backup.sh
```

Sandaran disimpan dalam `backups/srik-<tarikh>.dump`, bersama fail `.counts.txt`
yang merekod bilangan baris setiap jadual **pada masa sandaran dibuat**.
Fail kiraan itu adalah bahagian terpenting: tanpa nombor untuk dibandingkan,
"pemulihan selesai" tidak bermakna apa-apa.

Sandaran lama (>30 hari) dipadam automatik supaya cakera tidak penuh dan
mengambil sekali sandaran terbaharu.

## 2. Ujian pemulihan — buktikan ia benar-benar boleh pulih

```bash
export SRIK_RESTORE_URL='postgresql://...'  # pangkalan data BERASINGAN
./scripts/ops/restore-drill.sh backups/srik-<tarikh>.dump
```

Skrip ini memulihkan sandaran ke pangkalan data **berasingan**, kemudian
membandingkan bilangan baris dengan yang direkodkan. Empat perkara penting:

- Ia **menolak** untuk berjalan jika sasaran kelihatan sama dengan pangkalan
  data sekolah. Ujian ini untuk menguji salinan, bukan menggadai rekod sebenar.
- Ia mengosongkan keseluruhan skema sasaran (`public`, `auth`, `extensions`)
  sebelum memulihkan, supaya keadaan permulaan sama seperti pangkalan data yang
  diuji.
- Baris yang tidak sepadan menyebabkan ia **GAGAL dengan kod keluar 1**. Amaran
  itu disengajakan: pemulihan yang selesai tanpa ralat tetapi kehilangan separuh
  baris adalah kegagalan yang menyamar sebagai kejayaan.
- Jadual yang tiada dikira sebagai `RALAT`, bukan dilangkau — supaya jurang
  dilaporkan, bukan disembunyikan.

**Hasil ujian sebenar (2026-10-10):** sandaran 304 KB, dipulihkan ke pangkalan
data berasingan, semua kiraan sama termasuk `students=1` dan `audit_log=2`.
Diuji songsang juga: apabila kiraan sengaja diubah, drill GAGAL dengan kod 1.

## 3. Sasaran pemulihan (RPO / RTO)

**DILULUSKAN SEKOLAH pada 2026-10-10.** Nilai di bawah kini menjadi sasaran
rasmi, dan jadual sandaran mesti mematuhinya:

| Sasaran | Nilai | Ertinya |
|---|---|---|
| **RPO** | 24 jam | Paling banyak, kehilangan satu hari kerja. Sandaran harian mencukupi. |
| **RTO** | 4 jam | Sistem boleh berjalan semula dalam masa empat jam. |

**Komitmen yang mengikut nilai ini:**

- **RPO 24 jam** bermakna sandaran **mesti** dijalankan setiap hari. Sekolah harus
  menetapkan satu masa tetap (cadangan: selepas waktu sekolah, sekitar 5 petang)
  supaya ia tidak dilupakan. Satu hari sandaran tertinggal bermakna satu hari
  kerja boleh hilang.
- **RTO 4 jam** bermakna pemulihan mesti selesai dalam empat jam. Langkah 2 dalam
  seksyen 4 (pulih ke pangkalan data berasingan dan sahkan) mesti dilakukan
  serentak dengan pemulihan sebenar, bukan sebelum, atau masa itu akan habis.
- Drill pemulihan harus dijalankan **sekurang-kurangnya sekali setahun**.
  Sandaran yang tidak pernah diuji akan gagal pada hari ia paling diperlukan.

Untuk menukar nilai ini kemudian, rujuk semula ke seksyen 4 dan 5 — RPO lebih
ketat memerlukan jadual sandaran yang lebih kerap, dan RTO lebih ketat
memerlukan latihan pemulihan yang lebih kerap.

## 4. Langkah pemulihan sebenar (bila berlaku kecemasan)

1. **Hentikan perubahan.** Beritahu guru dan pejabat supaya berhenti memasukkan
   markah, kehadiran atau bayaran, supaya kerja selepas titik pemulihan tidak
   hilang tanpa disedari.
2. **Jangan pulih terus ke projek sekolah.** Pulih ke pangkalan data berasingan
   dahulu dan jalankan ujian pemulihan. Sekumpulan data yang betul lebih berguna
   daripada pemulihan yang tergesa-gesa.
3. **Sahkan bilangan baris** seperti yang dibuat oleh drill.
4. **Pulihkan ke sekolah** hanya selepas langkah 3 lulus.
5. **Catat semuanya** dalam `IMPLEMENTATION_STATUS.md`: masa, sebab, fail yang
   digunakan, hasil, dan apa yang hilang.

## 5. Mengundurkan perubahan kod (rollback)

Setiap perubahan pangkalan data adalah satu fail dalam `supabase/migrations/`
yang bernombor mengikut urutan. Untuk mengundur:

- **Kod sahaja:** pulangkan commit sebelum ini dan bina semula. Skrin lama akan
  berjalan atas skema baharu, yang biasanya selamat kerana migrasi hanya menambah.
- **Skema:** tiada migrasi "down" bertulis, dan itu disengajakan — mengundur
  skema dengan menjatuhkan jadual memusnahkan data pelajar. Cara yang betul
  ialah memulihkan sandaran dari titik sebelum perubahan.
- **Peraturan:** jangan sekali-kali membuang lajur atau jadual yang menyimpan
  rekod pelajar, markah atau wang sebagai cara mengundur. Pulihkan sandaran.

## 6. Kebenaran operasi ini

Menjalankan sandaran dan drill memerlukan sambungan pangkalan data, yang
mengandungi kredensial. Peraturan:

- Kredensial hanya melalui pemboleh ubah persekitaran, tidak pernah ditulis
  dalam fail ini, dihantar sebagai argumen baris arahan (ia muncul dalam `ps`),
  atau dicatat dalam log.
- Kunci `sb_secret_` tidak boleh masuk ke pelayar. Sistem secara sengaja menolak
  membina klien jika melihatnya. Jangan lemahkan halangan itu — cipta akaun di
  pihak pelayan.
- **Jangan jalankan deployment atau pemulihan sebenar tanpa kebenaran pemilik.**
