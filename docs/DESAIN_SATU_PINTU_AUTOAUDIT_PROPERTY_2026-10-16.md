# Desain satu pintu AutoAudit–Property

Tanggal: 16 Oktober 2026, Asia/Jakarta. Status: **desain disetujui; implementasi kode lokal selesai, cutover belum dijalankan**.

Dokumen pasangan: [rencana implementasi](RENCANA_IMPLEMENTASI_SATU_PINTU_AUTOAUDIT_PROPERTY_2026-10-16.md).
Repo AA = `../../sales-audit-2/`; repo XM = `../` dari direktori dokumen ini.
Keputusan produk berasal dari diskusi pengguna; implementasi diizinkan melalui pesan “oke si nice, implement it”. Panduan perilaku aktual: [Property AutoAudit](../../sales-audit-2/agent-docs/domains/property/README.md).
Verifikasi lokal: 24 tes AutoAudit, 13 tes Python XM, 2 tes sinkronisasi akun, dan typecheck XM lulus. Mapping akun lama, penerapan schema/data, pengujian browser, serta deployment belum dilakukan; cutover tetap membutuhkan pemeriksaan mapping dan izin DB/deployment terpisah.

## 1. Keputusan produk

1. AutoAudit menjadi satu pintu login, akun, Company, Team Access, dan pengaturan Property.
2. Satu akun Company menjadi pengelola Company tersebut. Tidak ada promosi Team Access menjadi admin Company tambahan.
3. Superadmin masuk XM sebagai `admin`; Company sebagai `company_admin`; Team Access sebagai `user`.
4. Team Access cukup memakai checkbox **Agent Developer** existing. Tidak ada dropdown peran Property. Staff/Manajemen bukan penentu peran XM. Customer Service tetap tidak boleh masuk.
5. Mode Semua menu mengikuti gate modul existing. Mode Pilih menu membutuhkan `agent-developer`; flag Company `feature_property` tetap wajib.
6. Anggota satu Company berbagi workspace sesuai aturan XM sekarang. Scope Sales/divisi di AutoAudit tidak menjadi filter baru Property.
7. Matching, keyword Company/personal, watchlist, status, periode, dedupe, ekspor, dan isolasi Company mempertahankan semantik existing. Perubahan lokasi pengaturan bukan redesign mesin Property.
8. Login, refresh akun, logout, dan pembaruan sesi mengikuti pola Harness yang dijelaskan di bagian 5.
9. Pengguna memilih **log perubahan pengaturan Property di AutoAudit disimpan tanpa batas waktu**, pada diskusi 16 Oktober 2026. Ini tidak mengubah kebijakan log lain.

```text
Before
AutoAudit login ----SSO----> XM (anggota masih menjadi akun Company bersama)
XM login lokal -----------> XM
XM Settings/Tim ----------> PostgreSQL XM -> worker/matching

After
AutoAudit login -> Company / Team Access -> SSO -> XM sesuai identitas orang
AutoAudit Pengaturan Property -> API server XM -> PostgreSQL XM -> worker existing
XM -> buyer/listing/matching/status/ekspor
XM Login / Refresh / Logout -> alur AutoAudit
```

## 2. Temuan source aktual dan batas bukti

| Area | Aktual dari source lokal | Perubahan target |
|---|---|---|
| AA SSO | `/dashboard/property`, `/api/property/session`; flag dan menu scope dicek ulang | Pertahankan gate; validasi juga identitas lengkap |
| XM SSO | `identity_key` memakai `company:<id>` untuk Company dan Superior | Pisahkan orang dari workspace Company |
| XM role | Provision Company selalu `company_admin` | Superior menjadi `user`, Company tetap pengelola |
| XM login | Password lokal dan tombol SSO hidup berdampingan | Hanya SSO; backend password juga ditutup |
| XM sesi | Poll `/auth/me` 5 detik; sesi SSO sampai expiry tiket | Refresh browser harus membaca akun AA terkini |
| XM logout | Menghapus sesi XM, kembali ke form XM | Tutup XM lalu logout AA dan buka login AA |
| XM settings | Umum, Pencocokan, Pantau Sales, Akun saya, Integrasi workflow | Kontrol pengaturan hanya di AA |
| Harness | Reload memulai SSO; callback membandingkan role/Company/actorType/actorId | Ambil pola, tidak mengubah Harness |

Referensi source:

- AA: [SSO modules](../../sales-audit-2/src/controllers/harnessAccessController.js), [menu scope](../../sales-audit-2/src/services/superiorMenuScopeService.js), [modal Team Access](../../sales-audit-2/views/components/superiors-manager-access.ejs).
- XM: [SSO identity](../api/sso.py), [auth](../api/auth.py), [access matrix](../api/access.py), [middleware](../api/app.py), [session UI](../lib/session.tsx).
- Harness: [web routes](../../sales-audit-2/harness-worker/routes/web.js), [account sync](../../sales-audit-2/harness-worker/public/account-sync.js), [auth middleware](../../sales-audit-2/harness-worker/middleware/auth.js), [kontrak SSO](../../sales-audit-2/harness-worker/docs/company-access.md).

Ini bukti source lokal, bukan bukti konfigurasi, data, atau deployment production. Enam tes terarah Harness/login choice lulus pada inspeksi diskusi sebelumnya; perilaku refresh browser belum dibuktikan lewat browser.

## 3. Pemisahan identitas, peran, dan workspace

| Principal AA | `xm.users.autoaudit_key` target | Peran XM | Workspace |
|---|---|---|---|
| Root Superadmin | `superadmin:root` existing | `admin` | Arsip admin `xm` existing |
| Child Superadmin aktif | `superadmin:<actorId>` existing | `admin` | Mengikuti akses Superadmin existing |
| Company | `company:<companyId>` existing | `company_admin` | Workspace terhubung Company |
| Team Access/Superior | **format baru** `superior:<actorId>` | `user` | Workspace Company yang sama |

`actorType`, `actorId`, `companyId` adalah identitas otoritatif. Nama/email hanya label; jangan mencocokkan atau menggabungkan akun berdasarkan nama/email. `actorName` Superior dipakai sebagai display actor.
`xm.users.id` tetap UUID internal untuk FK, preferensi personal, dan actor aktivitas.
Workspace bukan identitas orang: beberapa user berbagi workspace, tetapi preferensi serta aktivitas milik user masing-masing.

Resolver `/api/property/session` wajib membandingkan seluruh tuple `(role, companyId, actorType, actorId)` terhadap tiket dan mengembalikan actor terbaru. XM memverifikasi key, role, dan workspace yang sesuai. Jangan mengubah kontrak Harness tanpa kebutuhan konkret.

Company yang telah terhubung memakai workspace existing dari `xm.app_preferences.autoaudit_company_id`; hanya Company yang belum memiliki mapping mendapat `aa-<companyId>`. Jangan membuat workspace kosong kedua bila arsip Company sudah ada.
Satu mapping Company AA ke satu workspace Property. Jika mapping ganda atau admin lokal ganda ditemukan, lakukan rekonsiliasi eksplisit sebelum constraint/cutover, bukan memilih row pertama.

Team Access pindah Company: sesi lama ditolak karena company tuple berubah; binding user diperbarui lewat login baru ke Company tujuan. Arsip Company lama tidak ikut dipindah. Preferensi personal yang memuat konteks Company perlu direset/dipetakan secara eksplisit agar tidak terbawa tanpa sengaja.

## 4. Pengalaman pengaturan di AutoAudit

### Modal Team Access

```text
Tambah / Edit Team Access
Nama / Email / Password / Tipe tim (existing)
Akses data Sales (existing; bukan scope baru Property)
Akses menu
  ( ) Semua menu   (o) Pilih menu
  [x] Agent Developer
  [ ] Chat With AI
  ...
[Batal] [Simpan]
```

Tidak menambah kolom/tabel role Property pada `superiors`. Jangan menambah toggle duplikat di luar `superior_menu_scopes`.
Company mengelola anggota melalui Team Access AA; XM tidak lagi memiliki CRUD akun/role/password independen. Menonaktifkan atau mencabut akses mengikuti mekanisme AA existing.

### Halaman Pengaturan Property

Usulan route baru AA: `GET /dashboard/property/settings`; shortcut dari menu Agent Developer dan halaman XM. Anggota boleh membuka bagian personal yang existing mengizinkan, tanpa memperoleh kontrol Company. Pengaturan Company hanya Company/Superadmin. Superadmin dapat memilih Company melalui lookup existing yang dipaginasi, tanpa membuat Company lokal XM.

| Kontrol existing XM | Lokasi target / pemilik | Semantik yang dipertahankan |
|---|---|---|
| Nama Company | Profile Company AA | Nama AA menjadi sumber label XM; tidak ada nama Company kedua yang dapat diedit |
| Mode Company/Sales; pengelompokan sender/phone | Pengaturan Property → Umum; Company/Superadmin | Update default dan recompute lewat jalur existing |
| Keyword Company dan kunci keyword | Umum; Company/Superadmin | Maksimal 20 frasa; clear/lock mengikuti API existing |
| Keyword pribadi; reset ke Company | Umum → Preferensi saya; anggota | Hanya identitas sendiri dan saat Company tidak mengunci |
| Arah/status default personal | Preferensi saya | Tetap milik user, bukan satu preferensi bersama |
| Toleransi/bobot matching | Pencocokan; Company/Superadmin | Range existing; total bobot 100% |
| Kamus alias dan CSV | Pencocokan; Company/Superadmin | Maksimal 500 istilah; simpan/reprocess existing |
| Indeks kedekatan lokasi dan preview/import | Pencocokan; Company/Superadmin | Revision/preview existing; radius dan batas existing |
| Watchlist nomor Sales/label | Pantau Sales; Company/Superadmin | Normalisasi nomor dan efek scope/recompute existing |
| Sumber AutoAudit: pilih, sambung, putus, sync | Sumber data; Company/Superadmin | Company mapping + stable `sales.id`; tidak otomatis menghubungkan semua Sales |
| API key workflow: buat/nama/konfirmasi/revoke | Integrasi workflow; Company/Superadmin | Secret tampil sekali; key export bukan key login/control |
| Password/profil akun | Halaman akun AA existing | Tidak ada password XM baru |
| Kunci/buka kunci akses Property existing | Rincian anggota Property di AA; Company untuk anggota, Superadmin juga untuk Company | Tetap memakai `xm.users.is_locked` dan aturan `can_edit` existing; bukan role tambahan atau suspend seluruh akun AA |

XM Settings/Tim lama menjadi navigasi ke lokasi AA yang sesuai; endpoint mutasi pengaturan juga membutuhkan provenance control AA. Menyembunyikan tombol saja tidak cukup. Rincian anggota Property hanya mengatur kunci modul atas actor AA yang valid, bukan membuat akun/email/password/role XM independen. Checkbox Agent Developer tetap izin masuk AA; status kunci XM existing tetap gate tambahan agar akun lama yang terkunci tidak terbuka otomatis saat migrasi.
Buyer/listing, matching, filter kerja sementara, status, PDF, stok read-only, aktivitas, dan upload operasional tetap di XM sesuai role existing. Mode yang dipilih saat upload tetap tersedia agar semantik upload tidak dikurangi; ini aksi kerja existing, bukan editor konfigurasi baru.
Tool deploy Superadmin adalah operasi terpisah, tidak dipindah/diaktifkan otomatis oleh task ini.

## 5. Kontrak login dan sesi, mengacu Harness

```text
Buka XM tanpa sesi -> XM SSO start -> AA /dashboard/property
  -> jika belum login: AA /login -> lanjut ke Property
  -> validasi actor + Company + modul + menu
  -> tiket property (15 menit) -> callback XM -> workspace actor

Refresh XM -> handshake SSO baru meski sesi XM masih hidup
  -> actor sama: perbarui tiket/sesi, kembali ke route yang diizinkan
  -> actor berbeda: cabut sesi lama, kosongkan konteks/cache akun, masuk beranda

Logout XM -> cabut sesi XM -> halaman signed-out origin XM
  -> AA /logout?from=property -> AA /login
```

- Tidak ada login lokal fallback jika konfigurasi SSO hilang; tampilkan error konfigurasi `503`. Password endpoint lama ditolak, seed akun login lokal tidak berjalan pada startup target.
- Cookie state acak HttpOnly/SameSite untuk callback browser; validasi fresh maksimal 60 detik dan expiry. Callback/response sesi `no-store`; tiket dan cookie tidak masuk log, URL telemetry, atau model.
- `/api/property/session` tetap audience `property`; tiket Harness tidak diterima. XM tetap menanyakan tiket ke AA, tidak mengimpor runtime/auth internal AA atau membaca MySQL AA langsung.
- Reload browser memicu SSO; fokus tab, perpindahan route internal, dan tab tersembunyi tidak memicu handshake terus-menerus. `401` API same-origin memulai satu alur SSO; `403` izin menampilkan akses ditolak, tidak membuat loop.
- Akun sama dapat mempertahankan sesi token dan route hash/query yang diizinkan. Akun berbeda membersihkan `xm.manage`, cache hasil, personal context, pending request, dan draft. Respons async akun lama tidak boleh mengisi state akun baru.
- Return route harus berupa route internal XM yang diizinkan, termasuk hash router existing; jangan menerima URL/host arbitrer. Jangan memulihkan draft lintas actor atau context Company.
- Domain AA asal diingat setelah dicocokkan dengan allowlist. `from` tak dikenal diabaikan. Gunakan canonical origin XM sebelum state cookie dibuat agar localhost/127.0.0.1 tidak berpisah.
- Session invalid/expired: `401`; Company/modul/menu/epoch dicabut: request berikutnya ditolak. Gangguan validasi AA: `503`, jangan menganggap logout sukses atau berpindah ke login lokal.
- Batas existing tetap dinyatakan: cookie AA yang sudah disalin di tiket tidak otomatis dicabut hanya karena logout browser; tanpa epoch Company/root baru, tiket lama paling lama 15 menit. Tidak menambah registry sesi global dalam scope ini. Pekerjaan background lama tidak dibatalkan karena pergantian akun.
- Usulan adaptasi pilihan aplikasi Harness: penanda baru `aa_property_login_origin` maksimal 15 menit, hanya setelah logout Property. Setelah login berhasil dan akun terbaru berhak, modal AutoAudit / Agent Developer; default ke AutoAudit setelah 3 detik. Tanpa hak/config, ikuti redirect AA existing. Penanda Harness dan perilakunya tidak berubah.

## 6. Boundary pengaturan: AA mengatur, XM menyimpan dan memvalidasi

Jangan menduplikasi semua setting XM ke MySQL atau menyalin mesin matching ke AA.

```text
Browser -> AA controller (session, CSRF/origin policy, role, Company)
  -> AA propertyControlService (allowlist action, tiket control, HTTP timeout)
  -> XM middleware (validasi tiket ke AA, actor, target, method/path/body)
  -> handler/service XM existing -> transaksi setting + aktivitas XM
  -> response -> AA UI/status job
```

Usulan endpoint baru AA: `/api/property/settings/*`, **allowlist action**, bukan proxy URL bebas.
Gunakan `PROPERTY_PUBLIC_BASE_URL` existing untuk koneksi awal server XM; timeout eksplisit. Jangan menambah env internal kedua tanpa bukti kebutuhan jaringan.
XM tetap memakai `AUTOAUDIT_BASE_URL` untuk validasi dan `AUTOAUDIT_PUBLIC_URL` untuk navigasi browser.

Kontrak resource AA **baru** berikut diterjemahkan ke route XM existing (path XM di tabel sudah termasuk prefix publik `/api`). Parameter target user hanya untuk operasi lock yang role-nya diizinkan; personal selalu actor sendiri.

| Resource di bawah `/api/property/settings` AA | Method | Tujuan XM |
|---|---|---|
| `/company` | GET, PUT | `/api/company/settings` (PUT tidak menerima rename Company) |
| `/search` | GET, PUT | `/api/search-default` |
| `/personal-search` | PUT, DELETE | `/api/search-default/personal` |
| `/preferences` | GET, PUT | `/api/preferences` |
| `/matching` | GET, PUT | `/api/settings` |
| `/glossary` | GET, PUT | `/api/glossary` |
| `/locations`, `/locations/preview`, `/locations/import` | GET, POST, POST | `/api/location-index`, `/api/location-index/preview`, `/api/location-index/import` |
| `/stock`, `/stock/tracked` | GET, PUT | `/api/stock/overview`, `/api/stock/tracked` |
| `/sources`, `/sources/options`, `/sources/:id`, `/sources/:id/sync` | GET/POST, GET, DELETE, POST | `/api/autoaudit/sources`, `/api/autoaudit/options`, `/api/autoaudit/sources/:id`, `/api/autoaudit/sources/:id/sync` |
| `/keys`, `/keys/:id` | GET/POST, PUT/DELETE | `/api/integration/keys`, `/api/integration/keys/:id` |
| `/recompute`, `/job` | POST, GET | `/api/index/recompute`, `/api/index/status` |
| `/members/:superiorId/lock` | PUT | **Route XM baru** `/api/property-control/members/:superiorId/lock`, body hanya `is_locked`; resolve actor AA valid dan mirror UUID; tidak memakai model edit akun lokal yang menerima role/password |

Resource source/lock/key tidak otomatis mendapat seluruh method di resource lain. Daftar di service harus exact `(method, template path)`, bukan prefix saja. Role minimum tiap action mengikuti validator XM existing. Read personal/Company untuk tampilan boleh; mutation Company tetap Company/Superadmin.

Usulan tiket control: audience **baru** `property-control`, lifetime maksimal 60 detik, dibuat backend AA memakai helper enkripsi existing dan `PROPERTY_SSO_SECRET`; tidak dikirim ke browser. Memuat actor tuple, target Company ID, method, path allowlist, SHA-256 exact body yang diteruskan, iat/exp, cookie AA terenkripsi, serta event UUID untuk mutation. Eligibility company activity (termasuk pengecualian Login As) di-resolve AA dari sesi asli dan diikat dalam tiket/hasil validasi; jangan menyimpulkan eligibility hanya dari role XM.
XM menerima header **baru** `X-AutoAudit-Property-Control`, lalu meminta endpoint AA **baru** `POST /api/property/control-session` memvalidasi tiket dan izin actor terbaru. Endpoint ini tidak menerbitkan browser session. Tiket browser tidak berlaku untuk control, atau sebaliknya.
Company hanya target dirinya; Superior hanya tindakan personal dirinya; Superadmin memakai scope existing yang dicek AA. Target workspace di-resolve XM dari mapping, bukan `X-XM-User-Id`/body browser. Header control ditolak di luar allowlist pengaturan.
Revalidasi sekali per request, jangan membuka transaksi/koneksi PostgreSQL saat menunggu HTTP AA. Reuse business validation XM; refactor hanya fungsi yang perlu dipanggil ulang, bukan rewrite seluruh API.
Hasil: `401` identitas invalid, `403` scope/action ditolak, `400/409` validasi/konflik existing, `502/503` layanan tak tersedia. Pertahankan field/status kontrak XM lewat adapter AA.
Tidak ada retry otomatis mutation non-idempoten (buat key, connect, job) setelah timeout. UI membaca ulang state/status dan memberitahu hasil belum pasti; jangan mengirim ulang lalu menggandakan operasi.

### Konfigurasi

| Aplikasi | Variable | Status dan tujuan |
|---|---|---|
| AA | `PROPERTY_PUBLIC_BASE_URL`, `PROPERTY_SSO_SECRET` | Existing; URL XM dan secret tiket/control |
| XM | `AUTOAUDIT_BASE_URL`, `AUTOAUDIT_PUBLIC_URL`, `XM_SSO_ENABLED` | Existing; internal validation, browser navigation, enable SSO. Target instalasi wajib SSO aktif; off/missing tidak membuka password fallback |
| XM | `XM_PUBLIC_BASE_URL` | **Baru di XM**; canonical origin callback, mencegah mismatch cookie host |
| XM | `AUTOAUDIT_SSO_ORIGINS` | **Baru di XM**; allowlist domain AA tambahan untuk return origin seperti Harness; origin utama tetap default |
| XM API/worker | `PROPERTY_SSO_SECRET` | **Baru untuk deployment XM**, nilai sama dengan AA; khusus autentikasi relay aktivitas. XM tetap tidak membuka/menerbitkan tiket browser atau control, melainkan memvalidasi ke AA |

HTTP raw body/ticket/signature/secret wajib dikecualikan dari request logging. Nilai rahasia tidak disalin ke dokumen atau browser. `.env.example` dan wiring compose/API/worker perlu diperbarui saat implementasi.

## 7. Persistence dan schema yang diusulkan

### Source identity dan konfigurasi existing

| Database/tabel | Key stabil; kolom dibaca/ditulis | Kapan / sifat simpan |
|---|---|---|
| MySQL AA `companies` | `id`; baca `status`, `deleted_at`, `name`, `feature_property` | Gate saat masuk/validasi/control; edit profil/modul memakai mekanisme AA existing |
| AA `superiors` | `id`; baca `company_id`, `name`, `email`, `team_type`, `session_epoch` | Identitas/hak terbaru; CRUD Team Access existing |
| AA `superior_menu_scopes` | `superior_id`; `scope_mode`, `menu_keys`, `updated_by`, `updated_at` | Snapshot diganti saat simpan akses; refresh hanya baca; tidak menambah role Property |
| PostgreSQL `xm.users` | `id`; lookup unik `autoaudit_key`; `workspace_id`, `role`, `display_name`, `email`, `password_hash`, `is_locked` | Provision sekali per actor; mirror label/role saat SSO; password sentinel SSO, bukan password AA |
| `xm.sessions` | `id`, unique `token_hash`; `user_id`, `sso_ticket`, `expires_at` | Insert login; renewal actor sama memperbarui tiket/expiry; actor beda mencabut sesi lama |
| `xm.app_preferences` | `company_id` workspace; `autoaudit_company_id`, `autoaudit_company_name`, `company_name`, `search_terms`, `search_locked`, `listing_group_by`, `matching_mode`, `updated_at` | Mapping/label saat provision; setting saat aksi simpan; overwrite snapshot, bukan history |
| `xm.user_preferences` | `user_id`; `preferences`, `updated_at` | Merge field arah/status/search_terms milik actor saat simpan; refresh hanya baca |
| `xm.match_settings` | `company_id`; `land_tolerance_pct`, `building_tolerance_pct`, `price_tolerance_pct`, enam `*_weight_pct` existing, `updated_at` | Update snapshot setting; field radius existing yang tidak disentuh tetap dipertahankan |
| `xm.glossary` | `(company_id, alias)`; `canonical` | Ganti snapshot glossary Company lewat transaksi existing |
| `xm.location_indexes` | `company_id`; `data`, `sources`, `updated_at` | Preview read-only; import merge sesuai revision/validator existing, bukan reset diam-diam |
| `xm.tracked_sales` | `(company_id, phone)`; `label`, `created_by`, `created_at` | Tambah/hapus watchlist lewat transaksi existing; tidak membatasi anggota per Sales |
| `xm.autoaudit_sources` | `id`, unique `(company_id, sales_id)`; `sales_name`, `agent_name`, status/timestamp/error/check/force fields existing | Connect insert, disconnect delete, sync update state; worker existing tetap pemilik penarikan data |
| `xm.integration_keys` | `id`, unique `token_hash`; `company_id`, `created_by`, `name`, `saved_at`, `revoked_at`, `last_used_at` | Buat key insert hash; rename/ack/revoke update; refresh tidak membuat key |
| `xm.maintenance_jobs` | `id`, `company_id`, `status`, `result`, `error`, timestamp existing | Recompute reuse antrean satu job aktif per workspace; tidak memproses seluruh arsip di request AA |

Tidak ada tabel konfigurasi Property baru di AA. Tidak ada kolom role Property baru di Team Access.
**Index baru yang diusulkan:** unique partial `xm.app_preferences(autoaudit_company_id) WHERE autoaudit_company_id IS NOT NULL`; unique partial `xm.users(workspace_id) WHERE autoaudit_key LIKE 'company:%'`. Terapkan hanya setelah inventory konflik disetujui. Constraint kedua menjaga satu Company principal, bukan satu user per workspace.

### Aktivitas lintas aplikasi: satu log bisnis XM, pengiriman ke log AA

Kegagalan nyata yang harus ditangani: transaksi XM berhasil tetapi koneksi putus sebelum AA menulis aktivitas. Logging langsung setelah HTTP tidak menjamin jejak audit. Usulan paling terbatas yang menjaga jejak: reuse `xm.activity_log` sebagai outbox; tidak menambah broker atau database setting kedua.

- **Kolom baru yang diusulkan di `xm.activity_log`:** `autoaudit_event_id uuid UNIQUE NULL`, `autoaudit_delivery_state text NULL` (`pending`/`sent`). Isi metadata actor AA, stable target IDs, operation, dan changed field names dalam `details` existing; tidak menyimpan tiket, secret, raw payload, nomor, keyword, atau isi chat untuk relay AA.
- Key row XM tetap `id`; event UUID dibuat per perubahan berhasil, disimpan atomik dengan setting dan aktivitas XM. View/refresh/no-op tidak membuat event perubahan. Superadmin dan Login As mengikuti pengecualian company activity AA; tetap gunakan audit XM existing sesuai kebijakannya.
- **Index baru:** partial pending `(id) WHERE autoaudit_delivery_state='pending'`; hanya backlog yang masuk index.
- Worker XM existing mengirim pending maksimal 50 event/run, concurrency satu, interval awal 60 detik. Network dilakukan di luar transaksi. Berhasil di-ack baru update `sent`; gagal tetap pending. Jangan memodifikasi isi event pending lewat merge view/login.
- Endpoint AA **baru** `POST /api/property/activity-events`: service-only, autentikasi HMAC-SHA256 raw body + timestamp + method/path menggunakan secret Property existing dengan prefix purpose `property-activity-v1`; constant-time compare; window 5 menit. Bukan browser endpoint atau akses setting. Replay event yang sama aman melalui receipt unik.
- **Tabel MySQL baru yang diusulkan** `property_activity_receipts`: `event_id CHAR(36) PRIMARY KEY`, `company_id BIGINT NOT NULL` sebagai snapshot ID, `company_activity_log_id BIGINT NULL` dengan FK `ON DELETE SET NULL`, `created_at`. UUID identitas pengiriman; tipe diverifikasi terhadap schema sebelum migration final. Tidak memasang cascade Company pada receipt agar dedupe tidak hilang jika Company dihapus; lifecycle hard-delete company activity existing tetap berlaku. Insert receipt dan log AA dalam satu transaksi; duplicate UUID mengembalikan ack tanpa log kedua, termasuk bila log dihapus melalui lifecycle existing. Event actor/Company harus konsisten dengan metadata XM yang dibuat setelah control validation, bukan body browser.
- AA `activity_modules`/`activity_definitions`: usulan module code `property`, zero-point definition `PR0001` untuk perubahan pengaturan; verifikasi keunikan saat implementasi. AA `company_activity_logs`: kolom existing `company_id`, `superior_id`, `activity_definition_id`, `source='server'`, `metadata_json`; metadata terbatas event UUID, operation, target IDs, changed field names. Jangan log Superadmin sebagai Company.
- XM mencatat durable log dalam transaksi yang sama dengan state; AA sink eventually consistent. UI menampilkan state simpan berhasil walau relay pending, bukan sukses palsu bahwa kedua DB sudah sinkron. Monitoring backlog lewat diagnosis existing; tidak menambah notifikasi/live send.

### Retention dan pertumbuhan

- Setting, mirror akun, mapping: snapshot bounded per Company/actor, bukan append setiap refresh. Jangan hapus arsip/akun lama otomatis dalam task ini.
- Sesi berumur maksimal 15 menit; hapus sesi expired melalui cleanup existing dan perbaiki agar cleanup tetap berjalan pada low-login traffic memakai worker existing dengan batch terbatas. Menghapus cookie saja bukan cleanup row.
- Aktivitas pengaturan XM dan AA, beserta receipt dedupe, **tanpa batas waktu sesuai keputusan pengguna** (tidak ada pembersihan berdasarkan umur). Lifecycle hard-delete Company AA existing tetap bisa menghapus log Company melalui FK; receipt mempertahankan UUID tanpa menahan penghapusan Company. Jika Company sudah dihapus sebelum event pending diterima, receiver membuat receipt tanpa log dan ack sebagai `company_deleted`; tidak menghidupkan Company kembali. Superior terhapus tetapi Company masih ada: log memakai `superior_id=NULL` dengan snapshot actor ID di metadata, sesuai lifecycle nullable FK existing. Pertumbuhan O(jumlah mutasi), bukan O(request).
- View log XM tetap `ACTIVITY_VIEW_RETENTION_DAYS` default 90 hari, mengikuti [desain aktivitas existing](DESAIN_ACTIVITY_LOG_2026-10-09.md); kebijakan ini tidak diperluas ke perubahan pengaturan.
- Ekspor integration tetap mengikuti `XM_INTEGRATION_EXPORT_DAYS` default 7 hari. Data listing, raw chat, stock history, delivery receipts, dan maintenance history tidak diberi kebijakan penghapusan baru.

## 8. Migrasi akun dan arsip lama

1. Inventory read-only: workspace, mapping AA, jumlah akun Company/local admin, stable user IDs, preferensi, sumber, key workflow, dan sesi. Jangan dump secret atau isi chat.
2. Company SSO existing `company:<id>` dipertahankan UUID/workspace-nya. Buat `superior:<id>` terpisah; jangan membagi aktivitas/preferensi akun bersama lama secara tebakan.
3. Akun lokal existing hanya boleh diadopsi ke actor AA dengan mapping eksplisit yang direview. Konflik email/nama bukan bukti identitas. Legacy admin/Company ganda perlu keputusan pemilik; jangan promosi/demosi/hapus diam-diam.
4. Mapping `autoaudit_company_id` dari workspace lokal dapat dipertahankan, sehingga imports, raw_messages, documents, matches, entities, Qdrant payload, uploaded files, settings, dan keys tidak perlu dipindah namespace.
5. Akun tanpa mapping tidak boleh dihilangkan atau dipindahkan otomatis. Selesaikan mapping sebelum menutup pintu login lama untuk pengguna terkait; rollout tidak boleh mengunci pemilik arsip.
6. Saat cutover, invalidasi sesi password lokal dan sesi SSO Company-shared lama yang dipakai anggota; login ulang lewat AA. Password lama tidak disalin ke AA. Jangan menghapus `xm.users` legacy karena FK key/preferences/history.
7. Snapshot/backup dan semua perubahan data/schema memerlukan izin eksplisit. Desain ini bukan izin menjalankan migration atau script.

## 9. Scale, debt, dan batas scope

- Solusi menggunakan HTTP/SSO, controller/service/repository existing, PostgreSQL dan worker existing. Tidak membutuhkan browser/headless, child process baru, Redis, broker, atau direct cross-database join.
- Asumsi diskusi: 100 tab aktif, bukan pengukuran production. Poll sesi XM 5 detik sekarang = sekitar 20 request/detik sebelum API fitur dan validasi SSO tambahan. Target meniru trigger reload/401 Harness dan menghapus poll auth periodik yang redundan; kebutuhan notifikasi lock harus tetap lewat respons request berikutnya dan diberitahu pada UI.
- Satu validasi AA per request XM; jangan dobel lookup oleh setiap handler. HTTP validation tidak menahan DB connection. Tidak menambah cache izin ber-TTL tanpa bukti bottleneck karena dapat menunda pencabutan akses.
- Kontrol pengaturan hanya saat dibuka/disimpan; status maintenance dipoll selama job aktif, berhenti saat terminal/halaman ditutup. Recompute berat tetap worker, satu job aktif/workspace.
- Pertahankan batas 20 keyword, 500 glossary, lokasi 5.000 cluster/100.000 hubungan, dan pagination existing. Payload kontrol tidak boleh diperluas melebihi batas route/parser existing; verifikasi byte limit yang cukup untuk format lokasi sebelum port UI, jangan memotong data diam-diam.
- Audit asumsi 1.000 mutasi/hari = 365.000 event + receipt/tahun; ukuran baris belum diukur. Pending index bounded backlog, query riwayat paginated; bila volume nyata lebih besar ukur storage/query sebelum menambah histori lain.
- Debt existing: beberapa read glossary memuat seluruh snapshot dan location import memproses JSON utuh; tetap pada batas validator existing, jangan klaim tanpa batas. Shared-cookie ticket tidak memberi instant global logout. Dataset sync/matching full-history tidak direfactor dalam task ini.
- Akun sumber AutoAudit, pengirim chat, dan kontak pemilik listing tetap konsep berbeda; pemindahan setting tidak boleh mengubah identitas properti atau mempersempit counterpart matching.

## 10. Acceptance dan review

- Satu Company principal; Team Access masuk sebagai anggota berbeda, workspace bersama, tanpa role dropdown.
- Hasil matching, status, PDF, keyword lock/personal, dan izin kerja existing sama untuk fixture yang sama.
- Company tak dapat membuka/mengubah Company lain; anggota tak dapat menulis setting Company, memalsukan control header, atau menggunakan key workflow sebagai login/control.
- Login langsung, refresh akun sama/berbeda, logout, expiry, 401/403/503, origin, route hash, dan async response lama diuji lokal dengan fake services.
- Pengaturan tidak dapat dimutasi lewat XM browser route lama; UI AA memakai validator/transaksi/job XM existing.
- Dua perubahan paralel tidak membuat akun Company/workspace ganda; relay retry tidak menduplikasi aktivitas AA; log gagal di XM menggagalkan perubahan XM.
- Mapping lama dan rollback data direview sebelum cutover. Rollback tidak boleh otomatis membuka kembali password lokal ke production atau menghapus mapping/user baru.
- Review tambahan sebelum implementasi: transport control, relay audit, receipt/type migration, pilihan aplikasi Property, inventory mapping aktual. Ini rincian proposal, bukan klaim telah disetujui teknis satu per satu.

Setelah dokumen disetujui, minta izin implementasi terpisah: **“May I implement this now?”** Tunggu jawaban eksplisit. Izin DB/live/Git/server tetap terpisah.
