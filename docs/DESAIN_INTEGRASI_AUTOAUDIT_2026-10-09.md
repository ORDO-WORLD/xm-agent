# Desain: Sambungan Otomatis AutoAudit → XM Property

Tanggal: 9 Oktober 2026. Status: **menunggu persetujuan**. Belum ada kode, migrasi, atau perubahan produksi.

Dokumen ini melanjutkan [handoff](HANDOFF_AUTOAUDIT_PROPERTY_2026-10-09.md) dan mengunci keputusan diskusi sesi ini. Yang dibahas hanya **sambungan data**. Analytics per properti, history pencarian/ekspor, Telegram, dan otomatisasi lokasi dikerjakan terpisah setelahnya.

## 1. Tujuan

Chat dari AutoAudit masuk ke company XM tanpa download/upload JSON manual, segera setelah sync selesai.

Tanda berhasil:

- Data terbaru muncul di XM tanpa ada yang mengunggah.
- Stok tidak dobel terhadap data yang dulu diunggah manual.
- Status Ready/Hold/Sold/Hapus dan ID listing yang sudah ada tidak berubah.
- Kegagalan terlihat di layar dan dicoba lagi sendiri.

## 2. Keputusan yang sudah dikunci

| Hal | Keputusan |
|---|---|
| API key | Dari `.env` backend. Tidak ada form key di UI. |
| Sambungan | Per company XM, memilih sales AutoAudit. Satu company boleh punya beberapa sales. |
| Sumber percobaan pertama | Satu sales per company. Nama sumber lama: `XM Darmo Caesar`. |
| Periode tarikan pertama | Company sudah berisi: lanjut dari data terakhir. Company kosong: seluruh riwayat. |
| Cakupan chat | Semua percakapan, sama seperti file unggahan manual. |
| Pemicu | Dua jalur: webhook dari AutoAudit **dan** cek berkala tiap 10 menit. |
| Sebelum menarik | Keduanya mengecek dulu apakah dataset memang lebih baru. |
| Sync manual | Tombol **Sinkronkan sekarang**: langsung mengambil data yang tersedia saat itu lewat jalur tarik yang sama, tanpa menunggu tanda "lebih baru". |
| Pengunduhan | Dicoba sampai 10 kali, jeda 15 detik. |
| Keyword, pengelompokan pengirim/nomor, matching | Tidak diubah. |

## 3. Gambaran alur

```text
JALUR 1: Webhook                       JALUR 2: Cek tiap 10 menit
AutoAudit: "sync sales 57 selesai"     semua sales yang tersambung
        |                                      |
        v                                      |
  tandai sales 57 "minta dicek"                |
        \                                     /
         v                                   v
   CEK   baca ringkasan dataset sales itu lewat API (pakai key)
         bandingkan last_updated_at dengan yang terakhir ditarik
                 |
         sama ---+--- lebih baru
          |              |
       selesai      TARIK
                    unduh per potongan waktu
                    tiap unduhan dicoba 10x, jeda 15 detik
                         |
               gagal ----+---- berhasil
                 |               |
          status "gagal"    simpan sebagai impor baru
          + pesan error     dengan nama sumber yang sama
          dicoba lagi di         |
          cek berikutnya    pipeline lama berjalan:
                            baca pesan -> buyer/listing -> matching -> stok
                                 |
                            catat last_updated_at yang baru
```

Webhook hanya "colekan". Isinya tidak dipakai sebagai data; Property selalu bertanya balik ke API.

### Jalur 3: sync manual

```text
Tombol "Sinkronkan sekarang" pada satu sambungan
        |
        v
  tandai "minta dicek" + "paksa"
        |
        v
  langkah CEK dilewati --> langsung TARIK (aturan rentang, potongan,
                           dan 10 percobaan yang sama)
```

- Mengambil data **seadanya**: apa pun yang sudah ada di AutoAudit saat itu. Tidak memicu sync WhatsApp baru.
- Aman diklik berulang, karena pesan yang sama dikenali sebagai lama dan file yang identik dilewati.
- Tetap menunggu kalau masih ada impor dari sambungan itu yang belum selesai diproses, dan tetap berstatus Menunggu data kalau AutoAudit belum punya dataset.
- Dijalankan oleh worker seperti dua jalur lain, jadi mulainya beberapa detik setelah diklik.

## 4. Bagian-bagian yang dibangun

Semua di repository `xm-agent`. **Tidak ada perubahan kode di AutoAudit.**

| Bagian | Tugas | Letak |
|---|---|---|
| Klien AutoAudit | Satu-satunya tempat yang berbicara ke API AutoAudit: daftar sales, ringkasan dataset, unduh rentang tanggal. Menangani key, batas waktu, dan percobaan ulang. | file baru di `api/` |
| Penyimpanan sambungan | Tabel hubungan company → sales beserta statusnya. | `api/schema.sql` |
| Sinkronisasi | Langkah "cek lalu tarik" untuk satu sambungan. Dipanggil oleh kedua jalur. | file baru di `api/` |
| Putaran worker | Menjalankan sinkronisasi untuk sambungan yang dicolek webhook atau sudah 10 menit tidak dicek. | `api/worker.py` |
| Penerima webhook | Alamat publik bertoken yang menandai sales "minta dicek". | `api/app.py`, `api/access.py` |
| Rute sambungan | Daftar sales, sambungkan, putuskan, lihat status. | `api/` |
| Tampilan | Kartu "Sambungan AutoAudit" di halaman Unggah Data. | `components/pages/upload-page.tsx` |

Pipeline impor (`api/ingest.py`), parser, dan matcher **dipakai apa adanya**. Sinkronisasi hanya menaruh file dan baris impor baru berstatus antre, persis seperti yang dilakukan unggahan manual.

## 5. Data yang disimpan

Satu tabel baru, `xm.autoaudit_sources`:

| Kolom | Isi |
|---|---|
| `company_id` | Company XM pemilik sambungan. |
| `sales_id` | ID sales AutoAudit (stabil; bukan nama). Unik per company. |
| `sales_name` | Nama untuk ditampilkan, disalin saat menyambungkan. |
| `agent_name` | Nama sumber yang dipakai impor. Menentukan pengenalan pesan lama. |
| `status` | `menunggu`, `menarik`, `terbaru`, `gagal`. |
| `dataset_updated_at` | `last_updated_at` dataset yang terakhir berhasil ditarik. |
| `check_requested_at` | Diisi webhook atau sync manual; dikosongkan setelah dicek. |
| `force_requested` | Diisi sync manual; membuat langkah cek dilewati satu kali. |
| `last_checked_at`, `last_error` | Untuk jadwal 10 menit dan pesan di layar. |

Satu kolom tambahan di `xm.imports`: `source` (`upload` atau `autoaudit`), supaya riwayat impor bisa membedakan asalnya.

## 6. Aturan menarik data

### Satu aturan untuk tarikan pertama dan berikutnya

```text
mulai  = tanggal pesan terakhir sumber itu di XM, dikurangi 2 hari
         (kalau belum ada pesan sama sekali: tanggal pesan pertama di AutoAudit)
sampai = hari ini
```

- **Company sudah berisi** (Caesar XM Darmo, data terakhir 16 September 2026): mulai 14 September 2026.
- **Company kosong**: mulai dari awal riwayat.
- **Tarikan rutin**: otomatis hanya beberapa hari terakhir.

Titik mulai dihitung dari pesan yang **benar-benar sudah masuk**, bukan dari catatan terpisah. Kalau sebuah impor gagal diproses, tarikan berikutnya otomatis mengulang rentang itu.

### Dipotong per rentang waktu

Rentang panjang dipecah menjadi potongan (bawaan 1 bulan), diunduh dan diantrekan berurutan dari yang tertua. Alasannya: impor membaca seluruh file ke memori, dan AutoAudit juga menyusun hasil saringan di memori.

Semua unduhan memakai `start_date`/`end_date`. Dengan begitu jawabannya selalu JSON terbungkus dan jalur ZIP tidak pernah terpakai. Ini menyederhanakan rencana sebelumnya yang memakai arsip per tahun.

### Bentuk jawaban API

```text
GET /api/v1/integrations/sales/:id
    -> data.dataset.has_cleaned_data, first_message_date,
       last_message_date, last_updated_at

GET /api/v1/integrations/sales/:id/artifacts/download?start_date=..&end_date=..
    -> { success, download_format: "json",
         data: { sales_id, sales_name, filters, summary, dataset } }
                                                         ^
                                       isi chat ada di sini, bukan di paling atas
```

Sinkronisasi membuka bungkus `data.dataset`, lalu menyimpannya dalam bentuk yang sudah dikenal impor (`chats` di paling atas).

### Tidak dobel

XM mengenali pesan lama dari gabungan company + nama sumber + sidik pesan (chat, waktu, pengirim, isi). Karena itu:

- Saat menyambungkan, nama sumber diisi otomatis dengan nama sumber lama company itu (`XM Darmo Caesar`) dan bisa diubah. Untuk company kosong diisi nama sales AutoAudit.
- Tumpang-tindih 2 hari dan tarikan ulang dikenali sebagai pesan lama, sehingga tidak membuat listing baru.
- File yang isinya persis sama dengan impor sebelumnya dilewati oleh pemeriksaan SHA-256 yang sudah ada.

### Percobaan ulang

| Kejadian saat mengunduh | Tindakan |
|---|---|
| Jaringan putus, batas waktu, 5xx, berkas belum ada (404), masih disiapkan (202) | Coba lagi, maksimal 10 kali, jeda 15 detik. |
| Key ditolak (401/403) | Langsung gagal tanpa mengulang; ini salah konfigurasi. |
| Habis 10 kali | Status `gagal` + pesan. `dataset_updated_at` tidak diubah, sehingga cek 10 menit berikutnya mencoba lagi. |

`dataset_updated_at` baru dicatat setelah **semua** potongan berhasil diantrekan.

## 7. Webhook

```text
Di AutoAudit (oleh admin, tanpa perubahan kode):
  tambah langganan webhook
    link   : https://<alamat Property>/api/hooks/autoaudit/<token>
    grup   : sync
    company: company AutoAudit yang relevan

Di Property:
  POST /hooks/autoaudit/<token>
    token salah            -> 404
    event bukan "completed"-> 200, diabaikan
    sales tidak tersambung -> 200, diabaikan
    sales tersambung       -> isi check_requested_at, jawab 200
```

- Kiriman AutoAudit **tidak bertanda tangan**, jadi token panjang acak di dalam link (dari `.env`) menjadi pengamannya.
- Penerima hanya menulis satu penanda lalu langsung menjawab. Pekerjaan berat dilakukan worker.
- Langganan disaring per grup, sehingga kabar "antre", "mulai", dan "gagal" ikut datang dan diabaikan.
- Untuk lokal, link diarahkan ke tunnel HTTPS.
- AutoAudit mengirim ulang 5 kali dalam sekitar 1 jam 20 menit lalu berhenti. Kabar yang hilang tertangkap oleh cek 10 menit.

## 8. Tampilan

Kartu di halaman Unggah Data, di atas form unggah:

```text
Sambungan AutoAudit
+------------------------------------------------------------+
| Sales sumber : [ pilih sales              v ]              |
| Nama sumber  : [ XM Darmo Caesar            ]              |
|                                          [ Sambungkan ]    |
+------------------------------------------------------------+
| XM Darmo Caesar   Terbaru s.d. 9 Okt 2026 08.14            |
|                        [Sinkronkan sekarang]  [Putuskan]   |
+------------------------------------------------------------+
```

- **Sinkronkan sekarang** tersedia untuk admin company dan administrator platform.

- Status yang tampil: Menunggu data, Menarik, Terbaru sampai (tanggal), Gagal (pesan singkat).
- **Putuskan** hanya menghentikan pembaruan. Data yang sudah masuk tetap ada.
- Menu unggah manual tetap ada. Menyembunyikannya dari pengguna biasa dikerjakan terpisah.

## 9. Siapa yang boleh menyambungkan

> **Diperbarui 9 Oktober 2026 (sore):** aturan di bawah ini diganti. Administrator platform sekarang memasang **satu company AutoAudit** pada tiap company XM (opsional, lewat menu Perusahaan). Setelah dipasang, **admin company boleh menyambungkan dan memutuskan sendiri**, tetapi hanya sales dari company AutoAudit itu; server menolak sales lain, dan tarikan berhenti dengan status Gagal bila pemasangan dicabut atau sales berpindah company. Company tanpa pemasangan tidak bisa memakai API sama sekali. Rute `/admin/autoaudit/options|sources` menjadi `/autoaudit/options|sources`; yang khusus administrator platform adalah `/admin/autoaudit/companies` dan `/admin/autoaudit/link/{company}`.

API key di `.env` bisa melihat sales dari beberapa company AutoAudit. Kalau setiap admin company XM boleh memilih dari daftar itu, admin company A bisa menyambungkan chat milik company B.

**Karena itu daftar sales dan tombol Sambungkan/Putuskan hanya untuk administrator platform** (peran `admin`), yang memang sudah bisa masuk ke company mana pun. Admin company boleh menekan **Sinkronkan sekarang** pada sambungan yang sudah ada, karena itu hanya mengambil ulang sumber yang sudah dipilihkan untuk company-nya. Anggota biasa hanya melihat status.

Ini keputusan yang saya ambil sendiri demi keamanan. Mohon dikoreksi kalau admin company seharusnya bisa menyambungkan sendiri.

## 10. Konfigurasi `.env` backend

| Variabel | Bawaan | Arti |
|---|---|---|
| `AUTOAUDIT_BASE_URL` | – | Alamat aplikasi utama. |
| `AUTOAUDIT_API_KEY` | – | Bearer key integrasi. |
| `AUTOAUDIT_WEBHOOK_TOKEN` | – | Token di link webhook. |
| `AUTOAUDIT_CHECK_SECONDS` | 600 | Jeda cek berkala. |
| `AUTOAUDIT_RETRY_COUNT` | 10 | Jumlah percobaan unduh. |
| `AUTOAUDIT_RETRY_SECONDS` | 15 | Jeda antar percobaan. |
| `AUTOAUDIT_CHUNK_DAYS` | 31 | Panjang satu potongan unduhan. |

Tanpa `AUTOAUDIT_BASE_URL` atau `AUTOAUDIT_API_KEY`, fitur mati dengan tenang: kartu menampilkan "belum dikonfigurasi" dan worker tidak melakukan apa-apa. Key dan token tidak pernah dikirim ke frontend atau ditulis ke log.

Catatan: setup lokal memuat `.env.local-api` lewat shell, jadi variabel baru ditambahkan di sana dan di `.env.example`.

## 11. Yang belum terbukti dan harus diuji dulu

Sebelum implementasi dianggap aman, perlu **satu uji baca saja** ke API (tanpa menulis apa pun, dengan izin dan key dari Anda):

1. **Sidik pesan cocok.** Tarik rentang kecil yang sudah pernah diunggah manual, lalu pastikan pesannya dikenali sebagai lama. Ini asumsi terpenting; kalau meleset, stok akan dobel.
2. **Ukuran dan lama unduhan** untuk satu bulan, guna memastikan potongan 31 hari masuk akal.
3. **Perilaku `last_updated_at`**: benar berubah setelah sync, dan tidak berubah tanpa sebab.
4. **Tahun tanpa arsip.** API bisa menjawab 404 `year_shard_missing`. Perlu dipastikan apakah itu berarti "tidak ada data" atau "berkas belum tersedia".
5. **Urutan kabar "selesai" terhadap kesiapan berkas.** Sudah diamankan oleh langkah cek, tapi perlu diamati sekali.

Risiko yang diketahui dan diterima untuk versi pertama:

- **Matching dihitung ulang penuh di setiap impor.** Riwayat penuh yang dipotong per bulan berarti banyak hitung ulang berturut-turut. Hanya terjadi sekali per sambungan baru; kalau terlalu lama, potongan diperbesar lewat konfigurasi.
- **Pesan mentah duplikat tetap disimpan** (dokumen terstrukturnya tidak). Tumpang-tindih 2 hari menambah sedikit baris di setiap tarikan.
- **Selama impor besar diproses, pengecekan menunggu giliran**, karena worker mengerjakan satu hal dalam satu waktu.

## 12. Pengujian

Otomatis, dengan AutoAudit tiruan (tanpa jaringan):

- Dataset tidak berubah → tidak ada unduhan.
- Dataset lebih baru → impor diantrekan dengan nama sumber yang benar.
- Bungkus `data.dataset` dibuka menjadi bentuk `chats`.
- Pembagian potongan dan titik mulai (company berisi, kosong, rutin).
- Gagal 3 kali lalu berhasil; gagal 10 kali → status gagal dan penanda tidak maju; 401 tidak diulang.
- Tarikan ulang rentang yang sama tidak menambah listing, dan status Sold/Hold bertahan.
- Webhook: token salah, event lain, sales tak dikenal, sales tersambung.
- Sync manual: menarik walau dataset tidak berubah, tidak menambah listing, dan tidak bisa dipakai untuk sambungan company lain.
- Hak akses: hanya administrator platform yang bisa menyambungkan.

Manual di lokal: sambungkan satu sales, amati tarikan pertama, picu lewat tunnel webhook, lalu matikan jaringan untuk melihat status gagal dan pemulihannya.

## 13. Di luar cakupan

- Menyembunyikan menu unggah.
- Analytics per properti, history pencarian/ekspor, Telegram.
- Tanda tangan webhook di AutoAudit.
- Memicu sync WhatsApp dari Property.
- Otomatisasi referensi lokasi.
