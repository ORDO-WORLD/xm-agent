# Desain: Log Aktivitas (siapa melakukan apa)

Tanggal: 9 Oktober 2026. Status: **disetujui dan diimplementasikan secara lokal** (9 Oktober 2026). Belum ada perubahan produksi.

## 1. Tujuan

Administrator platform dapat membaca, dalam kalimat biasa, siapa melakukan apa di semua company: perubahan data, urusan akun, unduhan, dan apa saja yang dilihat orang.

Pembandingnya di AutoAudit (`../sales-audit-2`) ada dua: *inspector* (rekaman tiap permintaan HTTP, sangat teknis) dan *company activity log* (kejadian bernama, per modul). Yang dibangun di sini adalah jenis kedua, tanpa tabel definisi aktivitas, dan tanpa rekaman mentah ala inspector.

Tanda berhasil:

- Tiap baris terbaca tanpa pengetahuan teknis: waktu, pelaku, company, kalimat.
- Kalau sebuah data berubah, administrator bisa menemukan siapa pelakunya dan nilai sebelum serta sesudahnya.
- Company (anggota maupun admin company) tidak bisa melihat log ini dengan cara apa pun.
- Tidak ada password, API key, token, atau isi chat di dalam log.

## 2. Keputusan yang sudah dikunci

| Hal | Keputusan |
|---|---|
| Pembaca | Hanya administrator platform (`admin`). Company tidak melihat apa pun terkait ini. |
| Yang dicatat | Empat lapis: perubahan, akun, unduhan, dan sekadar melihat. |
| Tampilan bawaan | Lapis 1 sampai 3. Lapis 4 baru tampil bila dinyalakan, lalu menyatu urut waktu. |
| Rincian lapis 4 | Buka halaman, pencarian dan saringan, buka rincian. Pengulangan digabung. |
| Masa simpan | Lapis 1 sampai 3 selamanya. Lapis 4 dihapus setelah 90 hari (`ACTIVITY_VIEW_RETENTION_DAYS`). |
| Aksi administrator | Ikut dicatat, ditandai bila dilakukan di dalam company lain. |
| Membuka halaman Aktivitas | Tidak dicatat. |
| Sebelum dan sesudah | Dicatat bila masuk akal. |
| Gagal masuk | Dicatat beserta email yang dicoba. Password tidak pernah dicatat. |
| Sifat log | Hanya bisa dibaca. Tidak ada ubah atau hapus dari layar. |
| Cara membangun | Dicatat di tiap aksi lewat satu fungsi, bukan penyadap otomatis di pintu masuk. |
| Git | Tanpa Git apa pun. |

## 3. Gambaran alur

```text
 Orang menekan sesuatu           Worker / webhook
        |                               |
        v                               v
   Aksi di server  ------------->  catat(...)  ------>  tabel xm.activity_log
   (ubah status, unggah, dst.)                                  |
                                                                v
                                              Halaman "Aktivitas" (administrator saja)
```

Pintu masuk server (`require_login` di `api/app.py`) sudah tahu siapa yang masuk dan sedang berada di company mana. Informasi itu disimpan untuk lama permintaan, sehingga tiap aksi cukup menyebut **apa** yang terjadi; **siapa** dan **di mana** diisi otomatis.

## 4. Penyimpanan

Satu tabel baru, `xm.activity_log`:

| Kolom | Isi |
|---|---|
| `id` | Nomor urut. |
| `happened_at` | Waktu kejadian. |
| `layer` | `change`, `account`, `export`, atau `view`. |
| `action` | Kode pendek, mis. `entity.status`, `auth.login_failed`, `page.open`. Dipakai untuk saringan "Jenis". |
| `actor_id` | Akun pelaku, kosong untuk Sistem. |
| `actor_name`, `actor_email` | Disalin saat kejadian. `Sistem` untuk worker dan webhook. |
| `actor_role` | Peran pelaku saat kejadian. |
| `company_id`, `company_name` | Company tempat kejadian, nama disalin saat kejadian. Kosong untuk aksi tingkat platform. |
| `as_admin` | Benar bila pelakunya administrator yang sedang masuk ke company orang lain. |
| `failed` | Benar untuk kejadian gagal (gagal masuk, impor gagal, tarikan gagal). |
| `summary` | Kalimat jadi dalam bahasa Indonesia, paling panjang 300 huruf. |
| `details` | JSON pendukung: sebelum, sesudah, jumlah, nama file, alasan gagal. Daftar dipotong pada 50 butir. |
| `repeat_count`, `last_at` | Untuk penggabungan pengulangan. |

Indeks pada waktu, pada company + waktu, dan pada pelaku + waktu.

Tiga aturan:

- **Nama disalin ke baris log.** Akun yang dihapus atau company yang berganti nama tidak membuat log lama tak terbaca.
- **Perubahan dan catatannya satu transaksi** (lapis 1 sampai 3). Bila perubahan batal, catatannya ikut batal; bila pencatatan gagal, perubahan ikut batal dan orang diminta mencoba lagi.
- **Lapis 4 tidak boleh menghalangi orang.** Bila pencatatan gagal, data tetap tampil dan kegagalannya hanya masuk log server.

Tabel ini tidak mengikuti cakupan per company seperti tabel lain: `company_id` diisi eksplisit, dan hanya rute administrator yang membacanya.

## 5. Yang dicatat

Tiap baris tampil sebagai **waktu · pelaku · company · kalimat**. Di bawah ini kalimatnya.

### Lapis 1: perubahan data dan pengaturan

| Aksi | Contoh kalimat |
|---|---|
| Unggah file | mengunggah "caesar-sept.json" sebagai sumber XM Darmo Caesar |
| Impor selesai / gagal (Sistem) | selesai memproses "caesar-sept.json": 63.188 pesan, 412 listing baru |
| Status listing / buyer | mengubah status L-AB908 dari Ready ke Sold, catatan: "deal 3 Okt" |
| Kata kunci | mengubah kata kunci: menambah "darmo", menghapus "citraland"; mengunci kata kunci |
| Pengaturan, toleransi, bobot | mengubah toleransi harga dari 10% ke 15% |
| Glosarium, indeks lokasi | mengimpor indeks lokasi: 1.204 baris |
| Nomor sales dipantau | menambah nomor sales 62812…; menghapus 62813… |
| Hitung ulang / proses ulang | meminta hitung ulang semua match |
| Sambungan AutoAudit | menyambungkan sales Caesar sebagai "XM Darmo Caesar"; memutus; meminta sinkronisasi |
| Tarikan AutoAudit (Sistem) | menarik data Caesar 18 Apr sampai 9 Okt, 6 berkas; atau gagal beserta alasannya |
| Company AutoAudit | menghubungkan company XM Darmo ke company AutoAudit "XM Darmo" |

### Lapis 2: akun dan akses

| Aksi | Contoh kalimat |
|---|---|
| Masuk, keluar | masuk; keluar |
| Gagal masuk | gagal masuk dengan email sari@… (password salah) |
| Password | mengganti password sendiri; mereset password akun sari@… |
| Akun anggota | menambah akun sari@… sebagai anggota; mengunci akun sari@…; mengubah peran menjadi admin company |
| Company | membuat company "XM Darmo"; mengubah nama company |
| Masuk ke company (administrator) | masuk ke company XM Darmo |

### Lapis 3: mengambil data keluar

| Aksi | Contoh kalimat |
|---|---|
| PDF | mengunduh PDF 12 pasangan dari Cocokkan |
| Ekspor semua match | mengunduh semua match: 37 PDF, 1.420 pasangan |
| Excel stok | mengekspor stok sales ke Excel: semua sales, atau sales 62812… |

### Lapis 4: sekadar melihat

| Aksi | Contoh kalimat |
|---|---|
| Buka halaman | membuka Beranda, Cocokkan, Match Terbaru, Stok Sales, Unggah Data, Pengaturan, Tim |
| Pencarian dan saringan | mencari "darmo 2 lantai" di Cocokkan (Buyer ke Properti, bulan ini, Hot dan Warm) |
| Buka rincian | membuka rekomendasi untuk B-AB908; melihat listing sales 62812… |

"Buka halaman" disimpulkan di server dari permintaan data utama tiap halaman. Layar tidak mengirim permintaan baru, sehingga dari sisi company tidak ada yang berubah.

### Yang tidak dicatat

- Pengecekan otomatis dari layar: status akun, status impor, status sambungan, status indeks.
- Permintaan pendukung: daftar tanggal, pilihan dropdown, pratinjau, halaman berikutnya dari daftar yang sama.
- Halaman Aktivitas itu sendiri.
- Kiriman webhook yang tokennya salah (tidak ada pelaku yang bisa dikenali, dan bisa dipakai membanjiri tabel).

### Yang tidak pernah masuk log

Password (lama maupun baru), API key, token sesi, token webhook, dan isi chat. Untuk pencarian, kata yang dicari dicatat; hasilnya tidak.

## 6. Penggabungan pengulangan

Baris baru digabung ke baris sebelumnya, dengan menaikkan `repeat_count` dan memperbarui `last_at`, bila pelaku, company, kode aksi, dan kalimatnya sama dalam 10 menit terakhir. Berlaku untuk:

- semua aksi lapis 4, dan
- gagal masuk dengan email yang sama.

Aksi lapis 1 sampai 3 lainnya tidak pernah digabung: dua perubahan berarti dua baris.

## 7. Halaman Aktivitas

Menu baru **Aktivitas** di samping **Perusahaan**, hanya untuk administrator.

```text
Aktivitas
[ Company: Semua v ] [ Orang: Semua v ] [ Jenis: Semua v ] [ 9 Okt - 9 Okt ] [ Cari kalimat... ]
[x] Perubahan  [x] Akun  [x] Unduhan  [ ] Sekadar melihat

Hari ini, Jumat 9 Okt
  14.02  Budi           XM Darmo   mengubah status L-AB908 dari Ready ke Sold        >
  13.28  Sistem         Property   menarik data Caesar 18 Apr-9 Okt, 6 berkas        >
  13.10  Okta (admin)   XM Darmo   menyambungkan sales Caesar sebagai "XM Darmo..."  >
  11.47  Sari           XM Darmo   mengunduh PDF 12 pasangan dari Cocokkan           >
Kemarin, Kamis 8 Okt
  16.30  Budi           XM Darmo   mengunci akun sari@...                            >
                         [ Muat lebih lama ]
```

- Dikelompokkan per hari (waktu Jakarta), terbaru di atas, 50 baris per muatan.
- Tanda `>` membuka rincian: sebelum dan sesudah, catatan, nama file, alasan gagal.
- Baris gagal berwarna merah. Baris lapis 4 lebih pudar. Pengulangan tampil sebagai "×5".
- Di ponsel tiap baris menjadi kartu dua baris: pelaku dan waktu di atas, kalimat di bawah.
- Kartu company di menu Perusahaan mendapat tautan **Lihat aktivitas** yang membuka halaman ini dengan saringan company itu.

Rute server, keduanya di bawah `/admin` sehingga otomatis hanya untuk administrator:

- `GET /admin/activity` dengan saringan company, orang, jenis, lapis, rentang tanggal, kata, dan penanda halaman.
- `GET /admin/activity/filters` untuk isi dropdown company, orang, dan jenis.

Tidak ada rute tulis.

## 8. Kegagalan dan batas

| Keadaan | Yang terjadi |
|---|---|
| Pencatatan lapis 1 sampai 3 gagal | Aksi ikut batal; orang melihat pesan untuk mencoba lagi. |
| Pencatatan lapis 4 gagal | Data tetap tampil; kegagalan hanya masuk log server. |
| Gagal masuk berulang | Digabung per 10 menit per email. |
| Pelaku atau company sudah dihapus | Baris lama tetap tampil dengan nama yang disalin. |
| Kalimat atau rincian terlalu panjang | Dipotong (300 huruf; 50 butir, lalu "dan N lainnya"). |
| Pembersihan lapis 4 | Worker, sekali sehari, bertahap supaya tidak mengganggu impor. |

Log mulai terisi sejak fitur dipasang. Kejadian sebelumnya tidak direkonstruksi.

## 9. Pengujian

- **Kelengkapan:** semua rute tulis di server harus ada di daftar "dicatat" atau daftar "sengaja dikecualikan". Rute baru yang tidak ada di keduanya membuat tes gagal.
- **Akses:** anggota dan admin company ditolak di `/admin/activity*`; administrator melihat lintas company.
- **Rahasia:** setelah masuk, ganti password, dan sambung AutoAudit, isi tabel diperiksa bebas dari password, API key, dan token.
- **Kalimat:** tiap jenis aksi diperiksa kalimat dan rinciannya, termasuk sebelum dan sesudah.
- **Penggabungan dan pembersihan:** lima kali buka halaman menjadi satu baris "×5"; lapis 4 berumur 91 hari terhapus, lapis lain tidak.
- **Batal bersama:** aksi yang gagal di tengah tidak meninggalkan baris log.

## 10. Urutan pengerjaan

1. Tabel, fungsi `catat`, rute baca, tes akses dan tes rahasia.
2. Lapis 2 (akun).
3. Lapis 1 (perubahan), termasuk kejadian Sistem dari worker dan AutoAudit.
4. Lapis 3 (unduhan).
5. Lapis 4 (melihat), penggabungan, dan pembersihan 90 hari.
6. Halaman Aktivitas dan tautan dari kartu company.
7. Tes kelengkapan, lalu seluruh tes lama dijalankan ulang.

## 11. Di luar cakupan

- Rekaman permintaan mentah ala inspector (header, query, isi jawaban).
- Pemberitahuan (Telegram, email) saat kejadian tertentu.
- Ekspor log ke file.
- Tampilan log untuk company.
- Infrastruktur baru: tidak ada layanan, antrean, atau database tambahan.
