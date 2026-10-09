# Flow XM Property, Isi Rekaman, dan Hasil Pengecekan

Tanggal: 9 Oktober 2026.

**Saat ini, AutoAudit mengumpulkan chat, sedangkan XM mengolah chat tersebut menjadi buyer, listing, dan hasil pencocokan. Perpindahan data di antara keduanya masih manual.**

Dokumen ini menjelaskan alur sekarang dan arah pengembangan berdasarkan dua rekaman, pemeriksaan read-only `property.autoaudit.id`, serta source lokal. Arah pengembangan merupakan bahan diskusi, bukan spesifikasi final atau persetujuan implementasi. Ringkasan rekaman menggunakan transkripsi otomatis; bagian yang kurang jelas tidak dianggap sebagai keputusan pasti.

## 1. Flow yang sekarang

```text
AUTOAUDIT
|
|-- Sync percakapan WhatsApp
|
|-- Hasil chat tersedia
|
`-- Seseorang download hasilnya sebagai JSON
    |
    |  File dipindahkan secara manual
    v
XM PROPERTY
|
|-- Masuk ke company yang sesuai
|
|-- Buka "Unggah Data"
|   |-- Pilih file JSON
|   `-- Isi nama sales sumber chat
|
|-- XM membaca isi pesan
|   |-- Pesan mencari properti --> Buyer
|   `-- Pesan menawarkan properti --> Listing
|
|-- XM menjalankan pencocokan
|   |-- Lokasi
|   |-- Harga / anggaran
|   |-- Luas tanah dan bangunan
|   `-- Kebutuhan lain yang terbaca
|
`-- Hasil tersedia untuk pengguna
    |-- Dashboard statistik
    |-- Buyer --> cari listing yang cocok
    |-- Listing --> cari buyer yang cocok
    |-- Hasil Hot / Warm / Belum cocok
    |-- Pengelompokan per sales
    |-- Status Ready / Hold / Sold / Hapus
    `-- Ekspor hasil menjadi PDF
```

**XM belum otomatis ikut diperbarui setiap AutoAudit selesai sync.** Seseorang masih harus memasukkan file baru ke XM.

Ada satu hal penting tentang “sales”:

```text
Akun yang di-sync
Contoh: akun WhatsApp asisten
|
`-- Mengumpulkan chat dari banyak grup
    |
    |-- Pengirim pesan: Asisten
    |
    `-- Isi listing: "Hubungi Agen A"
        |
        `-- Kontak listing: Agen A
```

Ketiganya bisa berbeda. Karena itu, XM menyediakan pilihan pengelompokan berdasarkan **pengirim pesan** atau **nomor telepon dalam listing**.

## 2. Isi rekaman pertama — 8 Oktober

Rekaman pertama banyak menjelaskan **demo XM yang sudah berjalan**, kemudian membahas kebutuhan tambahannya.

```text
DEMO YANG SUDAH ADA
|
|-- Upload chat harian
|-- Matching buyer dan listing dua arah
|-- Penyaringan dengan kata kunci company
|-- Pengelompokan pengirim / nomor kontak
|-- Mengatur status properti
`-- Matching memakai aturan dan indeks lokasi

KEBUTUHAN YANG DIBAHAS
|
|-- Upload harian diganti pengambilan otomatis
|-- Hasil match dikirim ke agen melalui Telegram
|-- Setiap properti punya riwayat kecocokan
`-- Referensi lokasi lebih mudah diperbarui
```

Bagian yang paling penting:

- Akun asisten bisa membawa listing banyak agen, sehingga stok perlu mengikuti kontak agen yang benar.
- Matching mempertimbangkan lokasi, luas, dan harga. Pemrosesan inti dijelaskan berjalan tanpa token AI API.
- Riwayat properti yang dibayangkan: **hari ini cocok dengan lima buyer, besok tujuh—perubahannya bisa dilihat**.
- Prioritas awalnya adalah membuat data masuk otomatis.

## 3. Isi rekaman kedua — 9 Oktober

Rekaman kedua memperjelas urutan pekerjaan:

```text
1. Sambungkan data terlebih dahulu
   |
   `-- Upload manual menjadi otomatis
       dan mendukung beberapa sales sumber

2. Tambahkan analytics per properti
   |
   `-- Demand, sejak kapan diposting,
       sudah cocok atau belum

3. Tambahkan history penggunaan
   |
   `-- Pengguna mencari apa
       dan mengekspor hasil apa

4. Hubungkan Telegram melalui AutoAudit
   |
   `-- Pengaturan company dan penerima
       tetap dikelola di aplikasi utama

5. Evaluasi otomatisasi referensi lokasi
```

History penggunaan yang dimaksud terutama **pencarian dan ekspor**, bukan mencatat semua klik pengguna.

## 4. Hasil pengecekan dibandingkan dengan rekaman

Pemeriksaan dilakukan pada [property.autoaudit.id](https://property.autoaudit.id/) melalui sesi Chrome yang sudah login, termasuk company **Caesar XM Darmo**. Pemeriksaan hanya membaca halaman dan hasil pencocokan; tidak melakukan upload, perubahan status, penyimpanan pengaturan, atau pengiriman pesan.

| Bagian dalam rekaman | Hasil pemeriksaan |
|---|---|
| Matching dua arah | Ada di produksi. |
| Contoh tanah Citraland 379 m² | Ditemukan listing **L-AP600**, dengan **1 Hot dan 3 Warm**. Ini sesuai contoh demo. |
| Pengelompokan pengirim/nomor | Kedua pilihan tersedia. Konig memakai nomor; Caesar XM Darmo saat diperiksa memakai pengirim. |
| Kata kunci company | Tersedia. Konig menguncinya; Caesar XM Darmo saat diperiksa belum mengunci. |
| Upload chat | Masih manual melalui JSON, lengkap dengan riwayat upload. |
| Analytics | Dashboard agregat sudah ada: demand, lokasi, anggaran, dan stok. Riwayat lengkap per properti belum terlihat. |
| History match | Fondasinya ada pada source lokal, tetapi belum menyimpan seluruh perubahan kondisi properti dari hari ke hari. |
| History pencarian/ekspor | Belum ditemukan pada halaman dan source lokal yang diperiksa. |
| Telegram melalui AutoAudit | Penghubung khusus XM belum ditemukan pada pemeriksaan tersebut. |
| Lokasi/cluster | Indeks sudah terisi; referensinya masih dimasukkan melalui CSV/Excel. |

Di workspace Caesar XM Darmo, dashboard menunjukkan tanggal data terbaru **16 September 2026**. Itu menjelaskan mengapa periode minggu ini bisa kosong meskipun banyak listing lama tersedia.

Pada pengaturan pencocokan workspace tersebut terdapat **692 cluster** dan **4.114 pasangan jarak**, dengan alternatif lokasi sampai **4 km**. Glosarium yang terlihat adalah **`bdg` → `bukit darmo golf`**, yang memperjelas bagian transkripsi rekaman yang kurang jelas.

History match yang ada mencatat pasangan dan memperbarui pasangan yang sama. Hal tersebut belum sama dengan menyimpan keadaan lengkap “hari ini lima buyer, besok tujuh”. Rujukan: [pencatatan match pada source lokal](../api/matchlog.py).

Temuan tentang fitur produksi berasal dari halaman yang diperiksa. Temuan tentang pencatatan internal dan ketiadaan konektor berasal dari source lokal; pemeriksaan ini tidak mengakses database produksi atau membuktikan seluruh proses backend produksi.

## 5. Flow yang dituju dan pekerjaan berikutnya

```text
SEKARANG
AutoAudit sync
    |
Download JSON
    |
Upload manual ke XM
    |
XM mengolah dan mencocokkan


YANG DITUJU
AutoAudit sync
    |
Data siap
    |
XM mengambil data otomatis lewat API
    |
XM memperbarui buyer, listing, stok, dan match
    |
Pengguna melihat hasil terbaru
    |
Nantinya: history properti + Telegram per agen
```

**Pekerjaan berikutnya adalah mengganti jembatan manual tersebut.** Pertama tentukan akun AutoAudit mana memasok company XM mana, lalu buat pengambilan otomatis dengan pemeriksaan agar data tidak menggandakan stok dan status properti tetap terjaga.

Setelah pemasukan data itu berjalan, barulah dilanjutkan ke riwayat properti, history pencarian/ekspor, dan Telegram.

## Sumber diskusi

- [Rekaman lengkap 8 Oktober 2026, 10.42](<../data/discussions/2026-10-09/08-10-2026 10.42.m4a>).
- [Rekaman lengkap 9 Oktober 2026, 08.21](<../data/discussions/2026-10-09/09-10-2026 08.21.m4a>).
- [Transkripsi otomatis lengkap dan bertimestamp](../data/discussions/2026-10-09/TRANSKRIP_OTOMATIS.md).
- [Rangkuman diskusi sebelumnya dengan perkiraan timestamp](DISKUSI_INTEGRASI_AUTOAUDIT_2026-10-09.md).

Audio dan transkripsi tersimpan lokal di folder `data/`, yang diabaikan Git oleh konfigurasi repository.
