# Diskusi XM Property dan Integrasi AutoAudit

Tanggal rangkuman: 9 Oktober 2026.

Dokumen ini merangkum dua rekaman diskusi dan membandingkannya dengan source lokal `xm-agent` serta `../sales-audit-2`. Isinya adalah bahan diskusi, bukan spesifikasi final atau persetujuan implementasi.

## Sumber dan batas pemeriksaan

- [Rekaman 8 Oktober 2026, 10.42](<../data/discussions/2026-10-09/08-10-2026 10.42.m4a>) — sekitar 20 menit 23 detik; salinan utuh audio asli.
- [Rekaman 9 Oktober 2026, 08.21](<../data/discussions/2026-10-09/09-10-2026 08.21.m4a>) — sekitar 3 menit 37 detik; salinan utuh audio asli.
- [Transkripsi otomatis lengkap dan bertimestamp](../data/discussions/2026-10-09/TRANSKRIP_OTOMATIS.md), beserta TXT/SRT mentah dan hasil tambahan bagian pembuka rekaman pertama. Transkripsi belum dikoreksi kata demi kata; audio asli tetap menjadi rujukan utama.
- Source lokal `xm-agent` dan `../sales-audit-2`.
- Pemeriksaan read-only halaman publik [property.autoaudit.id](https://property.autoaudit.id).

Rangkuman dibuat dari transkripsi lokal. Beberapa nama dan kalimat campuran Jawa kurang jelas, sehingga detail tersebut tidak dianggap sebagai keputusan pasti. Timestamp bersifat perkiraan untuk membantu menelusuri pembahasan.

Halaman produksi menampilkan login “XM Auto Audit · Property Matchmaker”. Sesi browser pemeriksaan belum login, sehingga kondisi fitur di dalam produksi belum dapat dipastikan. Perbandingan implementasi di dokumen ini berdasarkan source lokal, bukan bukti bahwa seluruh fitur sudah tersedia di produksi.

Saat pemeriksaan tidak dilakukan perubahan kode/data aplikasi atau pengiriman notifikasi. Setelahnya ditambahkan dokumen rangkuman dan arsip rekaman lokal atas permintaan pengguna. Audio dan transkripsi disimpan di `data/discussions/2026-10-09/`, yang sudah diabaikan Git oleh aturan `/data/`. Salinan audio diverifikasi dengan SHA-256 terhadap file asli di Downloads.

## Inti kedua rekaman

Rekaman pertama menjelaskan cara kerja XM dan arah pengembangannya. Rekaman kedua memperjelas prioritas integrasinya dengan AutoAudit: data otomatis, beberapa sales sumber, analytics per properti, history penggunaan, dan Telegram melalui aplikasi utama.

## Rekaman 8 Oktober: demo XM dan kebutuhan operasional

### 1. Data masuk otomatis, pemrosesan tetap tanpa AI API

Sekitar **03:08–04:36**, dijelaskan bahwa dashboard dan pencocokan berjalan dengan Python tanpa penggunaan token AI. Upload harian yang sekarang manual ingin diganti pengambilan otomatis dari AutoAudit. Menu upload nantinya dibahas untuk disembunyikan dari pengguna biasa.

Istilah “nol token” di sini merujuk pada pemrosesan inti tanpa panggilan AI API.

### 2. Pencocokan dua arah dengan batas company

Sekitar **04:36–05:43**, pengguna bisa mencari listing untuk buyer yang dimiliki, atau mencari buyer untuk listing miliknya.

Admin company mengatur dan mengunci kata kunci, misalnya identitas kantor, supaya cakupan pencarian anggota konsisten.

### 3. Identitas sales berbeda dari akun sumber chat

Sekitar **05:55–09:01**, dibahas tiga identitas yang bisa berbeda:

| Identitas | Peran |
|---|---|
| Akun WhatsApp yang di-sync | Sumber pengumpulan data |
| Orang yang mengirim pesan di grup | Pengirim pesan |
| Nomor yang tertulis dalam listing | Kontak properti |

Contohnya, akun asisten mengumpulkan chat banyak agen. Stok harus bisa dikelompokkan berdasarkan kontak agen dalam listing, bukan hanya akun yang mengumpulkan chat.

Menggabungkan beberapa akun juga perlu menjaga agar pesan yang sama tidak menggandakan stok.

### 4. Listing punya status dan identitas yang bertahan

Sekitar **09:11–11:12**, dibahas penandaan listing yang sudah terjual, ditahan, atau dihapus, serta penggunaan ID untuk menemukannya kembali.

### 5. Hasil match dikirim ke masing-masing agen melalui Telegram

Sekitar **11:12–11:52** dan **16:16–16:34**, arahnya adalah pengiriman berkala yang relevan per agen: agen A menerima hasil untuk listing A, agen B untuk listing B. Pembahasan mengarah ke penerima personal.

Jadwal dan aturan pengiriman belum dianggap sebagai keputusan final.

### 6. Lokasi dan riwayat properti perlu diperkuat

Sekitar **11:59–15:45**, ada dua kebutuhan:

- Glosarium, alias lokasi, dan hubungan jarak antar-cluster membantu pencocokan. Data referensinya sekarang masih dimasukkan manual.
- Setiap properti perlu punya perjalanan historis: hari ini cocok dengan lima buyer, besok tujuh, kapan mulai diposting, dan bagaimana demand-nya berkembang.

## Rekaman 9 Oktober: penegasan prioritas

| Perkiraan waktu | Pembahasan |
|---|---|
| **00:00–00:28** | Sambungkan data terlebih dahulu, ganti upload manual menjadi otomatis, dan dukung beberapa sales sumber. |
| **00:28–00:51** | Tambahkan informasi per properti: demand, sejak kapan diposting, dan apakah sudah mendapat kecocokan. |
| **00:51–01:31** | Buat history pencarian dan ekspor untuk mengetahui apa yang dicari serta hasil apa yang digunakan pengguna. Pencatatan setiap klik/filter tidak menjadi kebutuhan utama dalam pembahasan ini. |
| **01:35–02:15** | Pengiriman Telegram ingin tetap melalui AutoAudit, dengan pengaturan company/penerima dikelola di sana. |
| **02:17–sekitar 03:05** | Evaluasi kemungkinan otomatisasi data cluster/lokasi sambil mempertahankan pemrosesan inti tanpa token AI. |

Interpretasi sementara atas “multiple sales”: beberapa akun sumber AutoAudit yang datanya masuk ke satu workspace company XM. Detail pemetaannya masih perlu dikonfirmasi.

## Perbandingan dengan source lokal

| Kebutuhan | Kondisi saat pemeriksaan |
|---|---|
| Matching, status listing, pengelompokan pengirim/nomor kontak | Sudah ada fondasinya. |
| Sync otomatis dari AutoAudit | Belum ada konektor. |
| Analytics demand | Sudah ada dashboard agregat; riwayat khusus per properti perlu diperluas. |
| Riwayat match | Sudah mencatat pasangan baru dan pembaruan pasangan; belum menjadi rekaman lengkap kondisi setiap hari. |
| History pencarian dan ekspor pengguna | Belum ditemukan pada jalur yang diperiksa; audit yang ada terutama mencatat pemrosesan dan perubahan status. |
| Telegram melalui AutoAudit | Modul Telegram tersedia di aplikasi utama; penghubung khusus hasil XM belum terlihat pada API integrasi yang diperiksa. |
| Cluster/lokasi otomatis | Matching sudah memakai indeks lokasi; pemasukan data referensinya masih manual. |

### Rujukan source

- [Pipeline impor XM](../api/ingest.py).
- [Embedding lokal tanpa AI API](../api/embedding.py).
- [Mesin pencocokan](../api/matcher.py).
- [Identitas dan status buyer/listing](../api/entities.py).
- [Dashboard analytics](../api/dashboard.py).
- [Pencatatan riwayat match](../api/matchlog.py).
- [Indeks lokasi dan hubungan cluster](../api/location_index.py).
- [API pengelolaan indeks lokasi](../api/location_routes.py).
- [Kontrak API Sales AutoAudit](../../sales-audit-2/agent-docs/integrations/external-api/sales.md).
- [Fondasi Telegram terpusat AutoAudit](../../sales-audit-2/agent-docs/domains/notifications/telegram-destinations-linking-and-delivery.md).

## Hal yang perlu dikunci dalam diskusi berikutnya

Pertanyaan awal:

> Apakah satu company XM akan mengambil chat dari beberapa akun sales di AutoAudit, lalu stok dan hasil match tetap dikelompokkan berdasarkan nomor kontak agen yang tercantum dalam listing?

Setelah pemetaan tersebut jelas, diskusi dapat menentukan cakupan data sumber, bentuk riwayat per properti, serta aturan penerima dan pengiriman Telegram. Belum ada keputusan implementasi yang ditetapkan melalui dokumen ini.
