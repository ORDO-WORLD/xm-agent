# Property Auto Audit — v4.0

Local property matchmaking workspace for Property. It imports WhatsApp `cleaned.json` files per agent, parses each message with deterministic Python rules, stores structured records in PostgreSQL schema `xm`, indexes searchable content in Qdrant collection `xm_rag`, and exposes the results to Hermes Agent.

## Pembaruan v4.0

Major update: ID publik untuk setiap listing dan buyer (`L-AB908`, `B-AB908`), status Ready / On-hold / Sold / Hapus, halaman **Match Terbaru** dengan riwayat tanggal, **Beranda** statistik yang dihitung Python, **Stok Sales** per nomor telepon, pengelompokan listing per pengirim atau nomor telepon, company dengan banyak akun (super admin dapat menambah akun dan mengunci kata kunci), serta tampilan baru yang lebih mudah dipakai di ponsel.

Panduan lengkap, tabel peran, dan langkah upgrade: [docs/UPGRADE_V4.0.md](docs/UPGRADE_V4.0.md).

## Local endpoints

- Web UI: `http://127.0.0.1:9004`
- The same local stack is also available at `http://127.0.0.1:9046` (replaces the temporary sample preview).
- Hermes gateway: `http://127.0.0.1:9002`

## Data isolation

- PostgreSQL schema: `xm`
- Qdrant collection: `xm_rag`
- Local runtime data: `data/`
- Company dan Team Access berbagi workspace Company, dengan UUID/preferensi pribadi terpisah. Mapping `xm.app_preferences.autoaudit_company_id` mempertahankan namespace arsip existing; Company baru memakai `aa-<id>`. PostgreSQL/Qdrant/file memakai workspace tersebut; arsip admin tetap `xm`. Setiap import tetap membawa `agent_name`.

## Matching defaults

- Category and transaction: hard match
- Land area tolerance: 10%
- Building area tolerance: 20%
- Price tolerance: 10%
- Imported location-index alternatives: at most 4 km, WARM pending buyer confirmation; distance never overrides mandatory constraints.

## Matching workspace update

Semua kontrol Pengaturan di bawah sekarang berada di **AutoAudit → Pengaturan Property**. XM tetap menjalankan matching, status, upload operasional, filter kerja, dan ekspor. Default arah/status personal diubah di AA; filter sementara di XM tidak menimpa default.

- Upload menawarkan mode **Company** (keyword milik company, tanpa membedakan huruf besar/kecil, termasuk tanda tangan pesan) atau **Sales** (nomor kontak utama/alternatif dalam watchlist company). Salah satu sisi pasangan harus termasuk company/sales yang dipantau; sisi lain dicari dari seluruh arsip workspace tersebut. Mode Sales ditolak bila watchlist company kosong, dan tidak memakai nama pengunggah/pengirim sebagai nomor pemilik listing.
- Mode upload tersimpan pada riwayat; mode terakhir yang berhasil diproses menjadi default company untuk proses ulang berikutnya. Company baru mulai pada mode Company tanpa saringan keyword. Aturan keyword/watchlist dibaca kembali saat worker mencocokkan, sehingga aturan yang sudah berubah setelah upload tetap berlaku. File duplikat tidak menambah pesan; bila mode diganti, arsip yang ada diproses ulang sebagai maintenance, tanpa menandai pasangan lama sebagai penemuan upload baru.
- Pengaturan → Umum juga dapat mengganti mode otomatis dan menghitung ulang hasil. Pergantian filter, arah, sales, serta proses ulang menampilkan animasi loading dan skeleton/status proses; animasi mengikuti preferensi pengurangan gerak perangkat.
- After login, choose Buyer → Property or Property → Buyer with all dates selected by default; optional Jakarta calendar presets include this month, this week (Monday–Sunday), last month, and a manual range before opening the matching workspace.
- Both search directions use the company's keywords (company baru mulai tanpa saringan). Super admin dapat memasukkan sampai 20 frasa dipisah baris atau koma; sumber yang cocok dengan salah satu frasa dipakai. Super admin dapat **mengunci** kata kunci; bila tidak dikunci, setiap anggota boleh memakai daftarnya sendiri.
- Select one source card to open its recommendations. On mobile, the source list and recommendations appear as separate views, with a back button to return to the list.
- Property contacts support multiple Indonesian phone numbers separated by commas or newlines, normalized to `62`. Matching uses bubble contact details, including alternate numbers, independently of the uploading agent.
- Hot: score ≥80 only after recognised mandatory constraints pass; uncertain evidence or tolerances cap at 79. Warm: 60–79; Belum cocok: no stored match ≥60. Unrequested factors contribute no points. Multiple status filters can be enabled together.
- Exact complete raw texts are grouped before pagination and in both recommendation directions. Original messages remain stored; occurrence badges expose repeats.
- Local accuracy audit and sample limits: [docs/MATCHING_ACCURACY_AUDIT.md](docs/MATCHING_ACCURACY_AUDIT.md).
- Original-data Caesar feedback loop, regression coverage, and measured search/render checks: [docs/CAESAR_QUALITY_AUDIT.md](docs/CAESAR_QUALITY_AUDIT.md). Repeat the local evidence export with `python audit_quality.py --search caesar --output /tmp/caesar-audit.json` inside the API container; the export contains private source messages.
- Settings and location glossary are stored in PostgreSQL. Save & reprocess queues a durable maintenance job; the worker reparses original messages, updates Qdrant, and recomputes matches. Progress survives leaving/reopening the page.
- Advertising phrases with concrete stock details no longer override listing intent. Contact signatures are extracted separately and excluded from structured locations, searchable matching text, and embeddings.
- Hot/Warm scores always include visible text: 🔥 Hot and 🌡️ Warm. Hot cards have a red border and soft pulsing glow, respecting reduced-motion preferences. PDF badges use rounded red/orange backgrounds; WhatsApp links prefill an Indonesian follow-up message.
- Select individual result pairs (or unmatched sources) to download an A4 portrait PDF (one selected pair per page, 11 pt body text that shrinks only when needed), with the same website logo, Jakarta generation date, and a clickable WhatsApp button only for the recommendation on the right. Maximum 200 report pairs from 50 sources per export.
- Export semua PDF offers one combined PDF or a ZIP containing one PDF per sender/phone group (default). Separate filenames include the sender/contact name, representative phone, source count, and continuous page range, e.g. `01_Ivan-Prayogo_6282226811158_60listing_hal1-574.pdf`. Grouping follows the company’s selected sender/phone setting.
- Backend workflow integration: company-scoped API keys, durable export jobs, per-contact PDF manifests, and authenticated file downloads. See [docs/WORKFLOW_INTEGRATION.md](docs/WORKFLOW_INTEGRATION.md).
- Cocokkan supports independent buyer and listing posting periods in both directions, with Today, rolling one/three months, previous calendar month, and custom ranges. Counts, recommendations and PDF exports follow both periods. Scheduled integration jobs can resolve relative WIB periods and exclude previously delivered pairs after an explicit successful-delivery receipt.
- Regression checks: `python3 -m unittest discover -s api -p 'test_*.py'`.
- Existing local services remain at http://127.0.0.1:9004. The Python/PostgreSQL/Qdrant stack is hosted through Docker Compose; the starter `.openai/hosting.json` has no registered cloud Site.

## Login dan peran

Login hanya melalui AutoAudit. Password lokal ditolak dan startup tidak membuat akun password. Konfigurasi SSO hilang menghasilkan error, bukan fallback lokal.

Tiga peran:

- **Administrator platform** (`admin`): principal Superadmin AA, dapat membuka workspace Company; Company/akun dikelola di AA.
- **Pengelola Company** (`company_admin`): satu principal akun Company AA; upload dan pengaturan Property langsung di XM, kunci anggota melalui AA. Tidak ada promosi Team Access menjadi admin tambahan.
- **Anggota** (`user`): mencocokkan, menandai status, mengunduh PDF, dan melihat Beranda, Match Terbaru, serta Stok Sales.

Akun terkunci menampilkan layar kosong dengan latar blur dan tautan WhatsApp admin. Hak akses ditegakkan di server pada setiap permintaan.

### Masuk lewat AutoAudit

Wajib `XM_SSO_ENABLED=1` dan `AUTOAUDIT_BASE_URL`. AA memakai `PROPERTY_PUBLIC_BASE_URL` dan `PROPERTY_SSO_SECRET`; API/worker XM menerima secret tersebut khusus relay audit, tanpa membuka tiket SSO. Browser memakai `AUTOAUDIT_PUBLIC_URL`, canonical `XM_PUBLIC_BASE_URL`, allowlist tambahan `AUTOAUDIT_SSO_ORIGINS`; cookie Secure untuk HTTPS. Compose memuat `.env` di API/worker.

- **Principal:** Company aktif dengan modul Property menjadi `company:<id>` / `company_admin`; Team Access non-CS dengan izin Agent Developer menjadi `superior:<id>` / `user`; Superadmin mengikuti akses existing. Anggota berbagi workspace Company; scope Sales/divisi AA tidak menjadi filter baru Property.
- **Workspace:** mapping Company existing dipakai kembali; hanya Company belum terhubung mendapat `aa-<id>`. Tidak mencocokkan identitas dari email/nama atau menghapus arsip lokal otomatis.
- **Pengaturan:** halaman XM `/#/pengaturan` menyediakan Umum, Pencocokan, Pantau Sales, Akun saya, dan Integrasi workflow. Edit memakai sesi SSO XM yang divalidasi AA, Origin XM, serta izin Company/anggota existing. Nama Company, akun/password dan Team Access dikelola di AA. Sumber data dan kontrol tambahan tetap tersedia melalui AA dengan tiket `property-control`; workflow key hanya berwenang untuk export.
- **Perusahaan / Login As:** Superadmin memakai kartu, pencarian, pagination, statistik, detail akun dan aktivitas di XM. Tombol Login As membuka workspace Company melalui owner UUID existing; aktor tetap Superadmin, bukan sesi/password Company baru. Create/rename Company dan CRUD akun diarahkan ke AA.
- **Sesi:** maksimal 15 menit; validasi AA sekali/request di luar connection DB. Reload browser membaca akun AA aktif; actor sama memperbarui sesi dan return hash aman, actor berbeda mendapat konteks baru. Poll auth lima detik/focus tab dihapus; lock/revoke terlihat pada request berikutnya. `401` memulai SSO; `403/503` tidak membuat loop. Gangguan AA tidak menghapus sesi. Logout cookie AA saja belum mencabut salinan tiket root/Company selama maksimal 15 menit.
- **Logout:** tutup XM → signed-out → logout AA → login AA. Penanda Property memungkinkan pilihan AutoAudit/Agent Developer sesudah login yang berhak; default AutoAudit tiga detik.
- **Saat modul dimatikan** data company tetap tersimpan dan sambungan sales tetap menarik chat.

## Sambungan AutoAudit

Chat dari sales AutoAudit bisa masuk ke sebuah company tanpa unggah manual. Rancangannya ada di [docs/DESAIN_INTEGRASI_AUTOAUDIT_2026-10-09.md](docs/DESAIN_INTEGRASI_AUTOAUDIT_2026-10-09.md).

- **Mengaktifkan:** isi `AUTOAUDIT_BASE_URL` dan `AUTOAUDIT_API_KEY` di environment backend (lihat `.env.example`), lalu jalankan ulang API dan worker. Tanpa keduanya fitur ini mati.
- **Mapping Company:** stable Company ID AA dan workspace existing yang direview. Rekonsiliasi arsip lokal harus eksplisit sebelum cutover; bukan melalui nama/email atau membuat Company lokal baru.
- **Menyambungkan:** Company/Superadmin membuka AA → Pengaturan Property → Sumber data. Daftar Sales hanya Company terhubung. Nama sumber sama dengan unggahan sebelumnya mempertahankan dedupe. XM menampilkan status dan tautan pengaturan.
- **Kapan data ditarik:** worker mengecek tiap sambungan setiap `AUTOAUDIT_CHECK_SECONDS` (bawaan 10 menit) dan hanya mengunduh bila `last_updated_at` dataset berubah. Tombol **Sinkronkan sekarang** (admin company) langsung mengambil data yang tersedia saat itu.
- **Webhook (opsional, supaya lebih cepat):** isi `AUTOAUDIT_WEBHOOK_TOKEN` dengan teks acak panjang, lalu di AutoAudit tambahkan langganan webhook dengan link `https://<alamat Property>/api/hooks/autoaudit/<token>` dan grup `sync`. Untuk lokal, arahkan ke tunnel HTTPS. Kiriman AutoAudit tidak bertanda tangan, jadi token itu satu-satunya pengaman; isi kiriman hanya dipakai sebagai tanda untuk mengecek lebih awal.
- **Status:** Menunggu data (dataset belum ada atau impor sebelumnya masih diproses), Menarik, Terbaru sampai (waktu dataset), Gagal (dicoba lagi pada cek berikutnya).
- **Uji baca:** `python3 scripts/autoaudit_probe.py` mencetak daftar sales; dengan `--sales-id`, `--start`, `--end`, dan `--manual-json` ia membandingkan sidik pesan API dengan file unggahan lama. Hanya memanggil `GET`.

Penarikan dataset tetap read-only dan tidak memicu sinkronisasi WhatsApp. POST validasi sesi/control dan relay aktivitas memakai endpoint AA terpisah.

## Log aktivitas

Perubahan pengaturan dari XM maupun AA disimpan atomik dengan outbox XM. Untuk edit native XM, actor dan `auditEligible` diambil dari jawaban validasi sesi AA; tidak ada validasi AA tambahan per mutasi. Worker mengirim maksimal 50 event/60 detik dengan budget jaringan sekitar lima detik; ack baru mengubah sent. AA memakai receipt UUID + PR0001 atomik. Company/Superior tercatat, Superadmin/Login As tidak menjadi company activity. Log pengaturan/receipt tanpa batas umur sesuai keputusan 16 Oktober 2026; view tetap 90 hari, PDF integration tujuh hari. Relay tidak membawa raw key/tiket/isi chat.

Menu **Aktivitas** (hanya administrator platform) menampilkan siapa melakukan apa di semua company, dalam kalimat biasa. Company tidak dapat melihatnya dengan cara apa pun. Rancangannya ada di [docs/DESAIN_ACTIVITY_LOG_2026-10-09.md](docs/DESAIN_ACTIVITY_LOG_2026-10-09.md).

- **Yang dicatat:** perubahan data dan pengaturan, urusan akun (termasuk gagal masuk), unduhan (PDF dan Excel), dan apa yang dilihat orang (buka halaman, pencarian, buka rekomendasi). Kejadian otomatis dari worker dan AutoAudit tercatat sebagai "Sistem".
- **Tampilan:** bawaan hanya perubahan, akun, dan unduhan. Tombol **Sekadar melihat** menambahkan sisanya. Bisa disaring per company, orang, jenis, tanggal, dan kata. Dari kartu company di menu Perusahaan ada tautan **Lihat aktivitas**.
- **Masa simpan:** catatan "sekadar melihat" dihapus worker setelah `ACTIVITY_VIEW_RETENTION_DAYS` hari (bawaan 90). Catatan lain disimpan selamanya.
- **Jaminan:** perubahan dan catatannya disimpan dalam satu transaksi, jadi tidak ada perubahan tanpa jejak. Password, API key, token, dan isi chat tidak pernah dicatat. Log hanya bisa dibaca.
- **Menambah aksi baru:** panggil `activity.record(conn, lapis, kode, kalimat, rincian)` sebelum `conn.commit()` dan daftarkan kodenya di `ACTIONS` (`api/activity.py`). Tes `test_activity.CoverageTests` gagal bila ada rute tulis baru yang belum dicatat atau dikecualikan.

Log mulai terisi sejak versi ini dijalankan; kejadian sebelumnya tidak direkonstruksi.

## Backup lengkap

Gunakan `scripts/backup-data.sh` untuk membuat dump PostgreSQL, snapshot Qdrant `xm_rag`, serta arsip file sumber. Panduan pemulihan tersedia di `docs/BACKUP_RESTORE.md`. Backup data sengaja tidak dilacak Git karena berisi percakapan dan nomor kontak.

## Upgrade

Versi sekarang: `4.0.0`. Lihat [docs/UPGRADE_V4.0.md](docs/UPGRADE_V4.0.md) untuk memperbarui instalasi berjalan tanpa kehilangan data. Catatan versi sebelumnya: [v3.1](docs/UPGRADE_V3.1.md), [v3.0](docs/UPGRADE_V3.0.md).


## Admin and mobile update (v3.0, diperbarui di v4.0)

- Riwayat v3/v4 menambahkan `role`/`is_locked` tanpa mengganti data matching. Kontrak satu pintu tidak menjalankan bootstrap password. Akun/password dikelola di AA; kunci modul existing dikelola dari AA dengan `xm.users.is_locked`. Tidak ada poll auth lima detik/focus tab.
- Hanya super admin (dan administrator platform) yang dapat mengubah pengaturan company, upload, glosarium, indeks lokasi, dan penghitungan ulang. Akun terkunci hanya dapat melihat sesinya dan keluar. Hak akses ditegakkan di API, termasuk untuk permintaan langsung.


## Isolated user workspaces

Superadmin membuka workspace dari daftar Company XM; create/rename/account management di AA. Matching, import, kamus, lokasi, dan toleransi milik workspace Company; preferensi personal milik UUID actor. Anggota Company sama berbagi data Company.

Admin requests carry a selected user ID, checked against the authenticated role on the server. Each request and worker job gets its own workspace context. PostgreSQL queries, uploaded-file directories, Qdrant searches/payloads, result caches, calendar counts, exports, and maintenance jobs are scoped to that workspace. A normal user cannot switch owner by changing a request header or submitting another account's document ID. The selected workspace stays local to the browser view, so admin tabs can manage different users independently.

Arsip existing dipertahankan; mapping AA terhubung tidak dipindah namespace otomatis. Upload dan pengaturan Property tersedia langsung di XM sesuai izin existing; akun/Company tetap AA. Sebelum cutover, review mapping/conflict dan izin DB/migration. `ensure_schema` berjalan saat startup API/worker; jangan memulai server untuk menguji schema tanpa izin DB.

Startup API dan worker membandingkan hash `schema.sql` + `MIGRATION_VERSION` (`api/db.py`) dengan satu baris `xm.bootstrap_state` (`id=1`). Bila sama, startup langsung lanjut tanpa DDL maupun backfill `migrate_v4`. Bila beda (schema berubah atau versi dinaikkan), startup memakai advisory lock sesi yang sama, menjalankan `schema.sql` lalu `migrate_v4`, kemudian menimpa hash; proses kedua menunggu lalu melewati. Naikkan `MIGRATION_VERSION` bila logika backfill berubah tanpa mengubah `schema.sql`. Hanya penerapan itu yang masih dapat tertunda oleh query baca panjang; periksa melalui `pg_stat_activity`/`pg_blocking_pids`, bukan dengan menjalankan beberapa API tambahan. Koneksi XM memakai `client_connection_check_interval=5s`, sehingga query yang kliennya sudah putus (restart/Ctrl+C) dibatalkan dan tidak menahan lock.

Kontrak aktif: [Property satu pintu](../sales-audit-2/agent-docs/domains/property/README.md). [Desain](docs/DESAIN_SATU_PINTU_AUTOAUDIT_PROPERTY_2026-10-16.md), [rencana](docs/RENCANA_IMPLEMENTASI_SATU_PINTU_AUTOAUDIT_PROPERTY_2026-10-16.md). Focused local checks bukan bukti DB, browser, atau deployment. Fixture DB lama berbasis password perlu disesuaikan ke SSO sebelum menguji cutover; jangan menjalankan full discover dengan env normal.

`api/test_user_isolation.py` exercises real HTTP requests against a disposable PostgreSQL database: identical uploads in different accounts, settings/glossary/location independence, forbidden owner switches and foreign document IDs, cached and uncached results, exports, worker ownership, reindexing, and concurrent requests. Run the regression suite with `XM_TEST_DATABASE_URL` pointing only to an isolated test database.

PDF layout regressions: install `api/requirements-test.txt` and run `python3 -m unittest discover -s api -p test_report.py`. These tests inspect the generated PDF for A4 size, page count, complete long text, default font size, and right-column WhatsApp links.
