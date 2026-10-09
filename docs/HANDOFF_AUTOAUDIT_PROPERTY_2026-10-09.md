# Handoff: Integrasi Otomatis AutoAudit → XM Property

Tanggal: 9 Oktober 2026.

Dokumen ini merupakan titik lanjut diskusi sesi ini. **Keputusan terbaru pada dokumen ini mengoreksi contoh pemetaan akun pada diskusi sebelumnya.** Integrasi belum diimplementasikan. Permintaan terakhir pengguna adalah menyimpan handoff untuk sesi baru.

## 1. Tujuan pengguna dan batas pekerjaan

Pengguna ingin data chat dari AutoAudit otomatis masuk ke Property setelah sync selesai dan dataset siap, menggantikan download/upload JSON manual. Matching yang sudah ada tetap dipakai.

- Repository Property: `/Users/oktaariaditya/ordo/xm-agent`.
- Repository aplikasi utama AutoAudit: `/Users/oktaariaditya/ordo/sales-audit-2`.
- Domain Property: `https://property.autoaudit.id`.
- API aplikasi utama yang dimaksud: `https://app.autoaudit.id`.
- Pengguna meminta diskusi dengan bahasa manusia dan diagram ASCII.
- Akses produksi tetap **read-only**. Jangan upload, menyimpan pengaturan, mengubah status, memicu sync, mengirim Telegram/WhatsApp, restart, deploy, atau melakukan DB production write tanpa instruksi baru.
- Pengguna menyetujui arah konsep sambungan sederhana, lalu meminta handoff. Jangan menganggap penyimpanan handoff sebagai perintah implementasi.
- Kerjakan di checkout yang ada; jangan membuat worktree atau melakukan commit/push tanpa permintaan pengguna.
- Jangan menambah alur setup rumit, model agent baru, atau infrastruktur berat tanpa kebutuhan nyata.

## 2. Keputusan terbaru yang sudah disepakati

### Akses API dari `.env`

**API key AutoAudit berasal dari `.env` backend. Tidak ada form memasukkan API key di UI Property.**

Nama variabel belum ditetapkan. Contoh yang bisa dibahas: `AUTOAUDIT_BASE_URL` dan `AUTOAUDIT_API_KEY`. Ini usulan, belum ditambahkan ke konfigurasi. Jangan memasukkan key ke variabel frontend/public atau menampilkan nilainya.

Setup lokal sebelumnya memuat `.env.local-api` melalui shell. Ketika implementasi diminta, sesuaikan pemuatan konfigurasi dengan cara menjalankan backend yang nyata; jangan menganggap file `.env` otomatis sudah dibaca.

### UI sambungan sederhana

Keinginan terakhir pengguna:

> “key nya ini dari .env sih … sesimpel sambungkan saja agent yang ada di xm agent ini ke autoaudit itu kayak sales yang mana”

Interpretasi yang diajukan: pada entri/company yang sudah ada di XM, pilih sales AutoAudit sebagai sumber chat, lalu klik **Sambungkan**. Pengguna menyetujui arah ini sebelum meminta handoff.

```text
Company/entri yang sudah ada di XM
|
`-- Sambungkan AutoAudit
    |
    |-- Pilih sales sumber: [ dropdown ]
    |   `-- Bisa beberapa sumber bila diperlukan
    |
    `-- Klik "Sambungkan"
        |
        |-- Ambil data awal
        |-- Proses buyer, listing, dan matching
        `-- Aktifkan pembaruan otomatis
```

- Dropdown membaca daftar sales dari API dengan key backend.
- Tampilkan nama sales; simpan hubungan menggunakan **ID sales stabil**, bukan nama.
- Struktur XM sekarang memiliki company/workspace, akun pengguna, nama sumber pada impor (`agent_name`), dan nomor sales yang dipantau. Belum ditemukan model agent terpisah yang perlu dijadikan entitas baru.
- Arah penyimpanan hubungan adalah company/workspace yang sudah ada. Bila istilah “agent” pengguna merujuk entri lain, klarifikasi secara singkat sebelum mengubah model data; jangan mengulang pembahasan identitas yang sudah dikunci di bawah.

## 3. Pemahaman penting: sumber chat ≠ pengirim ≠ kontak listing

**Jangan kembali menyimpulkan bahwa company “Caesar XM Darmo” harus disambungkan ke akun WhatsApp Caesar sebagai pemilik semua listing.** Contoh itu dikoreksi pengguna.

Pengguna mengatakan Caesar/asisten dan keyword perlu dipahami dari transkrip. Hasil baca ulang:

- **04:43–05:35, rekaman pertama:** “buyer saya mencari listing” atau “listing saya mencari buyer orang lain”; contoh pencarian memakai keyword **XM Darmo**.
- **05:55–06:31:** saat membahas Caesar, identitas pengirim bisa berbeda dari kontak yang tertulis dalam pesan. Bisa memakai sender atau nomor di listing.
- **07:09–08:09:** personal assistant berada di grup dan membawa listing beberapa agen. Pengelompokan perlu bisa mengikuti nomor agen sebenarnya.

```text
Akun AutoAudit yang mengumpulkan chat
|
`-- Percakapan berisi banyak pihak
    |-- Listing XM Darmo
    |-- Listing kantor lain
    `-- Kebutuhan buyer dari berbagai agen
                |
                v
Property membaca kumpulan chat
|
|-- Keyword --> memilih buyer/listing yang relevan
|-- Pengirim/nomor --> mengenali dan mengelompokkan agen
`-- Matching --> mencari pasangan dalam kumpulan data
```

Pengguna mengonfirmasi pemahaman tersebut dengan **“yes benar”**.

**Jangan hanya mengimpor pesan berkeyword “XM Darmo”.** Pesan buyer/listing lain dalam kumpulan yang diizinkan bisa menjadi calon pasangan. Keyword yang ada bekerja pada pemilihan daftar sumber pencocokan; lawan matching tidak harus memiliki keyword yang sama.

Kumpulan data tetap berada dalam company/workspace yang sesuai dan batas akses API. Tidak ada keputusan membuat semua company berbagi satu dataset global.

## 4. Flow sekarang dan yang dituju

```text
SEKARANG
AutoAudit sync WhatsApp
    |
Seseorang download cleaned JSON
    |
Upload ke company XM + isi nama sales sumber
    |
Worker membaca buyer/listing dan menjalankan matching
    |
Pengguna melihat dashboard, match, stok, dan PDF


YANG DITUJU
AutoAudit sync WhatsApp seperti biasa
    |
Sync selesai dan dataset siap
    |
Property mengambil data lewat API
    |
Masuk ke company XM yang tersambung
    |
Buyer/listing, matching, dan stok diperbarui
    |
Pengguna membuka hasil terbaru tanpa upload manual
```

Untuk awal, pendekatan yang disarankan adalah **Property menarik data secara berkala**. Ini bisa dipakai dari lokal tanpa alamat callback publik. Interval belum disepakati; satu menit pernah disebut sebagai contoh, bukan keputusan final.

API pemberitahuan sync bisa membantu mendeteksi pembaruan. Namun jangan menyamakan event `completed` dengan jaminan file mirror sudah siap diunduh. Pilihan antara mengecek metadata dataset dan memakai pemberitahuan masih perlu dirapikan menjadi desain paling sederhana.

Saat koneksi pertama, ambil data yang sudah tersedia; tidak harus memicu sync WhatsApp baru. Bila belum ada dataset atau proses belum siap, tampilkan status menunggu. Pengambilan awal, status sederhana, dan retry adalah usulan flow; belum dibangun.

## 5. Hal yang masih terbuka

1. **Sumber konkret untuk percobaan pertama:** company XM dan ID sales AutoAudit yang dipilih belum ditentukan. Pengguna belum menjawab apakah dataset yang sekarang diupload berasal dari satu akun pengumpul atau gabungan beberapa akun.
2. **Periode data awal:** 30 hari, 3 bulan, atau seluruh riwayat pernah ditawarkan, tetapi belum dipilih. Pengguna ingin setup singkat; periode bisa menjadi konfigurasi backend agar UI tetap pilih sumber + Sambungkan.
3. **Cakupan chat:** seluruh percakapan yang diizinkan atau grup tertentu belum ditetapkan. Jangan mengurangi calon pasangan hanya berdasarkan keyword kantor.
4. **Pemeriksaan pembaruan:** interval dan mekanisme metadata/event belum diputuskan secara final.
5. **Data lama dari upload manual:** perlu rekonsiliasi agar pengambilan API tidak menggandakan stok dan status sold/hold tetap bertahan.

Jangan menganggap API saat ini menyediakan delta pesan dengan cursor. Pengambilan periode, perubahan dataset, pesan lama yang baru diimpor, dan deduplikasi perlu diperiksa sebelum menjanjikan hanya mengambil pesan baru.

## 6. Kontrak API AutoAudit yang sudah diperiksa di source lokal

Belum ada pengujian authenticated terhadap API produksi dalam sesi ini. Fakta berikut berdasarkan source lokal; periksa ulang bila source berubah.

- API integrasi menggunakan Bearer key dan pembatasan company yang diizinkan.
- Daftar/detail sales: `/api/v1/integrations/sales` dan `/api/v1/integrations/sales/:id`.
- Detail menyediakan informasi sync serta dataset, termasuk `has_cleaned_data` dan `last_updated_at`.
- Unduh chat: `GET /api/v1/integrations/sales/:id/artifacts/download` dengan filter tanggal/chat yang tersedia.
- Respons JSON unduhan dibungkus: isi chat berada pada **`data.dataset`**, bukan langsung top-level `chats`.
- Unduhan besar atau beberapa file tahun dapat menjadi ZIP walaupun permintaan memakai format JSON. Hormati content type/status; jangan menganggap semua respons adalah raw cleaned JSON.
- API pemberitahuan: `GET /api/v1/integrations/notifications/poll`, dengan cursor `after_id`, filter company/group/event, dan hasil `next_cursor`.
- Lifecycle sync memiliki group `sync`, event `completed`, serta `sales_id`/`job_id` pada data.
- Semua jalur sync belum dibuktikan menghasilkan event yang sama. Mirror worker → main dan kesiapan unduhan perlu diperhatikan.
- Callback publik HTTPS membutuhkan Property yang dapat dijangkau; belum dipilih untuk fase lokal.

Rujukan:

- [Kontrak API sales](/Users/oktaariaditya/ordo/sales-audit-2/agent-docs/integrations/external-api/sales.md).
- [Controller sales](/Users/oktaariaditya/ordo/sales-audit-2/src/controllers/api/v1/integrationSalesController.js).
- [Service sales](/Users/oktaariaditya/ordo/sales-audit-2/src/services/integrationSalesService.js).
- [Controller notification/poll](/Users/oktaariaditya/ordo/sales-audit-2/src/controllers/notificationIntegrationController.js).
- [Lifecycle sync](/Users/oktaariaditya/ordo/sales-audit-2/src/services/syncLifecycleNotificationService.js).

## 7. Fondasi XM yang bisa digunakan

- Frontend React/Vinext, backend FastAPI, worker Python, PostgreSQL schema `xm`, Qdrant.
- `POST /imports` saat ini menerima file JSON dengan top-level `chats`, menyimpan impor dalam company/workspace, dan mengantrekan pemrosesan.
- Worker membaca impor dan menjalankan parser/matching. Embedding berupa feature hashing lokal 384 dimensi; inti tidak memakai AI API.
- Login HTTP XM saat ini memakai cookie session, bukan service-token connector. Proses backend internal dapat menjadi tempat integrasi; jangan membuat otomasi bergantung pada login browser pengguna tanpa kebutuhan.
- Deduplikasi file sekarang memakai company + `agent_name` + SHA-256 file. Deduplikasi pesan juga mencakup `agent_name`. **Ini belum menjadi dedup lintas sumber otomatis.** Nama sumber lama harus diperhatikan saat menghubungkan data API.
- Pesan mentah duplikat masih disimpan, sementara dokumen terstruktur duplikat tidak dibuat. Pertumbuhan storage perlu dipertimbangkan bila impor berulang.
- Impor menggunakan pembacaan JSON penuh ke memori, dan matching menghitung ulang seluruh workspace setiap impor. Jangan mengunduh seluruh riwayat berkali-kali tanpa menilai ukuran dan biaya proses.
- Status entity dan public ID menyediakan fondasi mempertahankan identitas serta status listing.
- Keyword company/personal dan pengelompokan pengirim/nomor sudah tersedia. Pertahankan semantiknya.
- Riwayat pasangan match memperbarui pasangan yang sama; belum menyimpan keadaan lengkap harian setiap properti.

Rujukan:

- [API impor](/Users/oktaariaditya/ordo/xm-agent/api/app.py).
- [Pipeline impor](/Users/oktaariaditya/ordo/xm-agent/api/ingest.py).
- [Worker](/Users/oktaariaditya/ordo/xm-agent/api/worker.py).
- [Company/workspace](/Users/oktaariaditya/ordo/xm-agent/api/company.py).
- [Pemilihan sumber/rekomendasi](/Users/oktaariaditya/ordo/xm-agent/api/workspace.py).
- [Keyword](/Users/oktaariaditya/ordo/xm-agent/api/search_terms.py).
- [Matching](/Users/oktaariaditya/ordo/xm-agent/api/matcher.py).
- [Status dan identitas](/Users/oktaariaditya/ordo/xm-agent/api/entities.py).
- [Stok sales](/Users/oktaariaditya/ordo/xm-agent/api/stock.py).
- [History match](/Users/oktaariaditya/ordo/xm-agent/api/matchlog.py).

## 8. Isi rekaman dan fitur lanjutan

**Rekaman 8 Oktober:** demo upload, matching dua arah, keyword company, pengirim vs kontak listing, status listing, toleransi/glosarium/cluster. Kebutuhan tambahan: pemasukan otomatis, Telegram per agen, history kecocokan per properti, referensi lokasi lebih otomatis.

**Rekaman 9 Oktober:** prioritas data otomatis dan multiple sales sumber; analytics per properti (demand, usia posting, sudah cocok/belum); history pencarian dan ekspor; Telegram melalui aplikasi utama AutoAudit; evaluasi otomatisasi lokasi dengan inti tetap tanpa token AI.

Urutan yang dibahas: **sambungan data dahulu**, lalu history/analytics dan Telegram. Jadwal Telegram, bentuk analytics, serta aturan penerima belum final. API notification AutoAudit yang ada jangan langsung dianggap sebagai API generik pengiriman hasil XM ke Telegram; jalur khusus itu belum dibuktikan.

## 9. Bukti pemeriksaan domain

Pemeriksaan read-only memakai sesi Chrome yang sudah login, melalui tab sementara yang telah ditutup. Tab milik pengguna tetap terbuka.

- Matching dua arah dan pengelompokan pengirim/nomor tersedia di produksi.
- Contoh tanah Citraland **379 m²**, ID **L-AP600**, ditemukan dengan **1 Hot dan 3 Warm**, sesuai contoh rekaman.
- Konig menggunakan grouping nomor dan keyword dikunci.
- Caesar XM Darmo saat diperiksa memakai grouping pengirim, keyword `XM Darmo` belum dikunci, dan nomor untuk Stok Sales belum didaftarkan.
- Upload masih melalui JSON; riwayat upload terlihat.
- Dashboard menyediakan statistik agregat; tanggal data terbaru Caesar XM Darmo saat diperiksa **16 September 2026**.
- Pengaturan lokasi menampilkan **692 cluster**, **4.114 pasangan jarak**, alternatif sampai **4 km**, serta impor CSV/Excel.
- Glosarium produksi memperjelas transkripsi: `bdg` → `bukit darmo golf`.
- History pencarian/ekspor dan sambungan Telegram khusus XM belum ditemukan pada halaman/source yang diperiksa. Ketiadaan UI bukan audit lengkap backend produksi.
- Halaman Match Terbaru tidak dibuka dalam pemeriksaan terakhir karena source menandai match sebagai dilihat secara otomatis saat halaman dibaca.

## 10. Dokumen dan rekaman yang sudah disimpan

- [Rangkuman awal](/Users/oktaariaditya/ordo/xm-agent/docs/DISKUSI_INTEGRASI_AUTOAUDIT_2026-10-09.md).
- [Penjelasan flow dan kedua rekaman](/Users/oktaariaditya/ordo/xm-agent/docs/FLOW_XM_DAN_REKAMAN_2026-10-09.md).
- [Transkripsi otomatis bertimestamp](/Users/oktaariaditya/ordo/xm-agent/data/discussions/2026-10-09/TRANSKRIP_OTOMATIS.md).
- [Audio lengkap 8 Oktober](</Users/oktaariaditya/ordo/xm-agent/data/discussions/2026-10-09/08-10-2026 10.42.m4a>).
- [Audio lengkap 9 Oktober](</Users/oktaariaditya/ordo/xm-agent/data/discussions/2026-10-09/09-10-2026 08.21.m4a>).

Salinan audio diverifikasi identik dengan file asli di Downloads menggunakan SHA-256. Transkripsi dilakukan lokal, belum dikoreksi kata demi kata. Bagian pembuka rekaman pertama memiliki kesalahan berulang “Bersambung”; bagian akhir juga memiliki repetisi yang mungkin kesalahan mesin. Jangan menganggap repetisi itu sebagai ucapan/keputusan. Hasil tambahan pembuka tersedia di arsip sebagai `08-10-opening.txt`/`.srt`.

Folder audio/transkripsi `data/discussions/2026-10-09/` diabaikan Git oleh aturan `/data/`. Jangan memasukkan rekaman atau kredensial ke Git tanpa permintaan pengguna.

## 11. Kondisi checkout dan lokal

- Branch saat menulis handoff: **`okta`**.
- Sebelum handoff, perubahan Git hanya dua dokumen untracked di bagian 10. Tidak ada perubahan kode integrasi.
- Handoff ini menambahkan satu dokumen; belum ada commit/push.
- Setup lokal sebelumnya sudah dilakukan tanpa Docker: PostgreSQL 16, Qdrant hasil build lokal, virtualenv Python 3.12, API, worker, dan frontend.
- Endpoint yang sebelumnya diperiksa: Qdrant `127.0.0.1:6333`, API `127.0.0.1:8100`, frontend **`http://localhost:9004`**. Frontend sebelumnya bind IPv6 localhost; `127.0.0.1:9004` tidak selalu setara.
- Worker yang diam ketika antrean kosong adalah kondisi normal.
- Kesehatan layanan tidak diperiksa ulang saat membuat handoff; jangan mengklaim semuanya masih aktif.

## 12. Titik lanjut sesi baru

1. Baca handoff ini dan instruksi repository yang berlaku. Untuk menyentuh AutoAudit, baca `AGENTS.md` dan router `agent-docs/README.md` di repository tersebut.
2. Pertahankan keputusan terbaru: key `.env`, pilih sales sumber, tombol Sambungkan, keyword/pengirim/nomor tetap seperti sekarang.
3. Kunci sumber konkret dan periode impor pertama dengan pertanyaan singkat. Tidak perlu mengulang konsep identitas yang sudah dikonfirmasi pengguna.
4. Lengkapi desain minimum: pemetaan company → ID sales, pengambilan awal, deteksi pembaruan, retry, dan rekonsiliasi data upload lama.
5. Tunggu instruksi implementasi sebelum menulis kode/migrasi. Pengujian live awal perlu dibatasi pada pembacaan API yang diizinkan.
6. Saat implementasi diminta, gunakan pemeriksaan fokus: data masuk ke workspace yang tepat, format API ditangani, pengambilan ulang tidak menggandakan stok, status bertahan, dan kegagalan dapat dicoba lagi. Tidak perlu pengujian luas yang tidak relevan.

Prompt untuk melanjutkan sesi baru:

```text
Baca docs/HANDOFF_AUTOAUDIT_PROPERTY_2026-10-09.md.
Lanjutkan diskusi integrasi AutoAudit ke Property dari keputusan
terakhir: API key dari .env backend, pilih sales AutoAudit sebagai
sumber chat pada company XM yang sudah ada, lalu Sambungkan.
Pertahankan keyword dan pengelompokan pengirim/nomor yang sudah ada.
Mulai dari hal yang masih terbuka pada handoff, bukan mengulang
pembahasan identitas Caesar/XM Darmo. Belum implementasi atau
mengubah produksi sampai saya meminta.
```
