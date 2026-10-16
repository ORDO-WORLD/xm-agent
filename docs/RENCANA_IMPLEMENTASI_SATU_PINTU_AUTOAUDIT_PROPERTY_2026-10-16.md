# Rencana implementasi satu pintu AutoAudit–Property

Tanggal: 16 Oktober 2026, Asia/Jakarta. Status: **implementasi kode lokal selesai; rekonsiliasi data dan cutover tertunda**.

**Koreksi produk disetujui dan diimplementasikan 16 Oktober 2026:** T6 memakai halaman pengaturan native XM dan tampilan Perusahaan existing dengan Login As; T5 mengizinkan setting native melalui sesi SSO tervalidasi, Origin XM, izin existing dan outbox audit. Pengelolaan akun/password/Company/Team Access tetap AA. Instruksi “setting hanya di AA” pada rincian rencana awal di bawah sudah digantikan koreksi ini. Tidak ada schema baru untuk koreksi UI/akses ini.
Desain: [satu pintu AutoAudit–Property](DESAIN_SATU_PINTU_AUTOAUDIT_PROPERTY_2026-10-16.md).
AA = `/Users/oktaariaditya/ordo/sales-audit-2`; XM = `/Users/oktaariaditya/ordo/xm-agent`. Semua path tugas di bawah relatif terhadap root repo yang diberi label. `(baru)` berarti file/route/schema belum ada.

## 0. Izin, prinsip, dan checklist

Desain dan implementasi telah disetujui pengguna melalui pesan “oke si nice, implement it”. Kode T2–T6 dan verifikasi lokal T8 telah dikerjakan. Inventaris/mapping data aktual T1 dan rekonsiliasi/cutover T7 tetap menjadi gate sebelum deployment; tidak ada migrasi atau perubahan data yang dijalankan.
Verifikasi lokal lulus: 24 tes AutoAudit, 13 tes Python XM, 2 tes sinkronisasi akun, dan typecheck XM. Tes DB lama masih memakai fixture login password dan perlu disesuaikan untuk pengujian cutover SSO; belum ada bukti browser atau integrasi DB langsung. Panduan aktual: [Property AutoAudit](../../sales-audit-2/agent-docs/domains/property/README.md).
Tidak membuat worktree, commit/push/checkout, menjalankan server, scripts/, migrasi, DB write, live AI/WhatsApp, atau deployment tanpa izin terkait. Pertahankan perubahan user; pada inspeksi dokumen, XM memiliki perubahan `package-lock.json` di luar task ini.

- [x] Scope/solusi: AA menjadi tempat kontrol; XM tetap storage/validator/worker. Tidak membuat mesin matching kedua.
- [x] Scale: asumsi 100 tab; auth polling existing sekitar 20 request/detik; target reload/401, validasi sekali/request, job tetap worker. Tidak ada pengukuran production.
- [x] Tech debt: tidak memperluas full-history sync; hindari transaksi DB terbuka selama HTTP. Relay audit reuse worker dan log, dengan alasan konkret kegagalan lintas DB.
- [x] DB/retention: schema/keys/write semantics di desain bagian 7; pengguna menetapkan log pengaturan AA tanpa batas waktu. Receipt dedupe disimpan selama log. View/export mempertahankan retention existing.
- [x] Decision: tidak ada role dropdown, tidak mewariskan scope Sales AA ke Property, tidak menebak mapping akun lama.
- [x] Handoff: laporkan evidence lokal terpisah dari browser/deployment, `Scale/debt check`, model/delegasi/review, dan tepat satu status docs.

## 1. Urutan dan gate

```text
Review desain + izin implementasi
  -> T1 inventory/mapping + kontrak
  -> T2 schema additive + audit contract
  -> T3 identity/provision + validasi
  -> T4 lifecycle SSO XM/AA
  -> T5 control boundary + audit relay
  -> T6 UI pengaturan AA + navigasi XM
  -> T7 rekonsiliasi/cutover (izin DB/deploy terpisah)
  -> T8 focused verification + update docs aktif
```

Jangan mengaktifkan cutover SSO-only sebelum UI kontrol, mapping lama, gate backend, dan audit siap. Perubahan dapat dibangun berurutan dalam satu working checkout tanpa menerapkan schema/data ke DB nyata.

## T1 — Inventaris dan mapping yang dapat direview

**Dependensi:** desain/izin implementasi. **Belum memutasi DB.**

File yang diperiksa:

- AA `src/controllers/harnessAccessController.js`, `src/services/superiorMenuScopeService.js`, `src/repositories/superiorRepository.js`, `src/utils/viewAuthSession.js`, `src/utils/superiorSessionEpoch.js`, `server.js`.
- AA `harness-worker/routes/web.js`, `harness-worker/public/account-sync.js`, `harness-worker/middleware/auth.js` sebagai referensi read-only.
- XM `api/sso.py` (`identity_key`, `provision_identity`), `api/auth.py`, `api/tenant.py`, `api/app.py` (`require_login`), `api/schema.sql`, `api/access.py`.
- XM `components/settings/{general-tab,matching-tab,sales-tab,account-tab,integration-tab,location-index-panel}.tsx`, `api/{company,workspace,location_routes,stock,autoaudit_routes,integration}.py`.

Langkah:

1. Verifikasi ulang status Git kedua repo dan instruction set aktif, tanpa mengubah branch.
2. Cocokkan action settings desain dengan actual method/path, limit parser/body, validation, transaksi, actor scope, dan efek recompute. Input lokasi besar tidak boleh gagal karena default JSON parser AA lebih kecil; tetapkan limit route-specific yang mempertahankan validator XM.
3. Siapkan mapping eksplisit `AA company_id -> XM workspace -> Company user UUID`; `superior_id -> user UUID` bila adopsi diperlukan. Read-only DB inspection hanya bila target/credential sudah jelas dan izin aksesnya sesuai policy; tidak mengambil credential/chat ke output.
4. Tandai duplicate mapping/admin lokal dan user tanpa pasangan; minta keputusan hanya untuk konflik nyata. Tidak cocokkan berdasarkan email/nama.
5. Bekukan kontrak control allowlist, event payload redacted, return-route hash, dan tipe FK receipt dari schema aktual.

**Bukti selesai:** matriks action/persistence sesuai desain dan mapping/conflict report yang tidak mengandung secret. Konflik belum diputuskan menghalangi migration/cutover, bukan alasan memilih default diam-diam.

## T2 — Schema additive dan definisi aktivitas

**Dependensi:** T1. Penulisan migration bukan izin menjalankannya.

Files:

- XM `api/schema.sql`: kolom outbox `xm.activity_log`, index pending, unique mapping/Company-principal sesuai desain; ikuti pola upgrade idempotent existing. Jangan menambahkan table role Property.
- AA `db/migrations/<19-digit-unique>_property_control_activity.sql` **(baru; pilih timestamp unik saat implementasi)**: table `property_activity_receipts`, index/constraint, module `property`, definition `PR0001` zero-point setelah cek keunikan. Cocokkan tipe FK dengan schema aktual.
- XM `api/test_sso.py`, `api/test_activity.py`; AA `src/repositories/__tests__/propertyActivityReceiptRepository.test.js` **(baru)** bila mengikuti lokasi test module.

Langkah:

1. Buat DDL additive, backfill akun/mapping sebagai langkah data terpisah yang memerlukan persetujuan mapping. Jangan menegakkan unique index sebelum konflik selesai.
2. Snapshot setting/user tidak append per refresh. Event/receipt tanpa batas waktu sesuai keputusan pengguna; tidak membuat cleanup yang menghapus dedupe sementara event masih dapat retry.
3. Down migration tidak menghapus user/arsip atau membuka login password otomatis; risiko kehilangan audit harus disebut sebelum rollback schema.

**Verifikasi:** static diff/SQL/identifier review. Uji schema hanya pada DB disposable yang telah diizinkan; jangan `dbmate up/down/dump` otomatis. Bukti constraint menghadapi duplicate mapping dibutuhkan sebelum rollout.

## T3 — Identitas per orang dan satu Company principal

**Dependensi:** T1–T2 (DDL belum perlu dijalankan ke production).

Files/symbols:

- AA `src/controllers/harnessAccessController.js`: `createModulePrincipalResolver`, `/api/property/session` branch; validasi full actor tuple khusus kontrak Property tanpa mengubah principal Company Harness.
- AA `src/controllers/__tests__/moduleAccessController.test.js`: Company/Superior/module/menu/epoch/actor comparison.
- XM `api/sso.py`: `identity_key`, `provision_identity`; `api/auth.py`: `_still_valid`, `current_user`, `public_user`; `api/tenant.py`: provision shared workspace.
- XM `api/access.py`: mapping hasil AA tetap memakai tiga role existing, tidak menambah role baru.
- XM `api/test_sso.py`, `api/test_admin_access.py`, `api/test_user_isolation.py`: perluas kasus yang relevan saja.

Langkah:

1. `company:<id>` tetap `company_admin`; `superior:<id>` menjadi `user`; kedua orang berbagi workspace, bukan UUID/preferensi. Superadmin existing tetap `admin`.
2. Resolve workspace melalui mapping existing; provision `aa-<id>` hanya bila tidak ada. Jangan reinitialize setting yang sudah ada.
3. Actor full tuple, role, dan current Company harus cocok pada tiap validasi; pindah Company/epoch/akses dicabut menolak sesi lama.
4. Pindahkan validasi HTTP keluar dari blok connection PostgreSQL; cache actor hanya sepanjang request. Tindakan/proxy tidak mempercayai actor dari body browser.
5. Personal preferences dan activity memakai actor UUID aktual, bukan Company principal atau target owner admin. Nama Superior dari `actorName`, Company label dari `name`.

**Bukti selesai:** dua Superior satu Company mendapat UUID/preferensi berbeda dan data bersama; Superior tak bisa menulis Company setting; login paralel tak menggandakan Company; rename tak mengubah identity; scope Sales AA tidak menyempitkan matching.

## T4 — Login, refresh, logout, dan return origin

**Dependensi:** T3.

Files:

- XM `api/auth.py`, `api/sso.py`, `api/access.py`, `api/app.py`: SSO-only login, callback renewal, logout/signed-out, seed startup.
- XM `lib/session.tsx`, `lib/api.ts`, `lib/router.ts`, `lib/workspace-context.tsx`, `app/page.tsx`, `components/app/login-screen.tsx`, `components/app/company-shell.tsx`: lifecycle/account clearing dan link AA.
- XM `.env.example`, `docker-compose.yml`: konfigurasi canonical origin/allowlist dan secret relay pada API/worker. Jangan mengedit `.env` berisi secret user.
- AA `src/controllers/harnessAccessController.js`, `server.js`, `views/login.ejs`: property origin, penanda Property dan pilihan aplikasi; pertahankan Harness.
- XM `api/test_sso.py`, `tests/account-sync.test.mjs` **(baru)**; AA `src/controllers/__tests__/moduleAccessController.test.js`, `tests/unit/harness-login-choice.test.js` (regresi Harness), `tests/unit/property-login-choice.test.js` **(baru)**.

Langkah:

1. Login lokal XM ditutup pada handler, bukan sekadar sembunyikan form; SSO tidak configured menghasilkan 503. Hilangkan seed password lokal pada startup target, tanpa menghapus row legacy.
2. Implement trigger reload/401 mengikuti Harness, dedupe satu navigation dan pending marker; hapus poll auth 5 detik redundan. Jangan memuat ulang saat hanya focus/pindah route. Lock/revoke dikenali pada request berikutnya, sesuai kontrak target.
3. Callback full tuple sama memperbarui tiket/expiry; beda mencabut sesi lama, bersihkan manage/context/cache/draft dan batalkan/abaikan response lama. Simpan return hash/query yang diizinkan hanya untuk actor sama.
4. Gunakan origin allowlist dan canonical XM; tambah `from` Property di AA tanpa mengubah flow Harness. Native API 401 memicu SSO; 403/503 menampilkan alasan, tidak retry loop.
5. Logout API mengakhiri sesi XM; navigasi halaman same-origin signed-out menuju AA `/logout?from=property`. Jangan logout AA lewat fetch cross-origin yang mengandalkan CORS/cookie berbeda.
6. Implement `aa_property_login_origin` maksimal 15 menit dan modal AutoAudit/Agent Developer untuk akun yang baru login. Default AutoAudit setelah tiga detik; manual choice membatalkan timer; tanpa penanda/perizinan gunakan redirect lama. Pertahankan pilihan Harness.
7. Jangan menjanjikan instant global logout dari tiket lama atau membatalkan job background saat actor berganti.

**Bukti selesai:** mocked flow reload akun sama/berbeda, anggota A ke anggota B dalam Company sama, 401/403/503, query/hash aman, origin tidak dikenal, callback invalid, local-password denied, logout AA, serta draft/context isolation. Browser manual hanya pada app lokal yang sudah berjalan/diizinkan.

## T5 — Control API dan audit delivery

**Dependensi:** T2–T3. Selesaikan sebelum mutasi UI AA diaktifkan.

Files:

- AA `src/controllers/propertySettingsController.js`, `src/services/propertyControlService.js` **(baru)**; `src/controllers/harnessAccessController.js` atau helper Property terfokus untuk `/api/property/control-session`; mount `server.js`.
- AA `src/services/superiorMenuScopeService.js`: tambahkan prefix settings API yang tepat ke `agent-developer` agar mode Pilih menu bekerja, tanpa memberikan akses browser ke control/session receiver. AA `src/utils/inspectorLogRedaction.js`: samarkan ticket/header control/signature dan secret key pada response yang relevan.
- XM `api/property_control.py` **(baru)**, `api/app.py` (`require_login`), `api/sso.py` (exchange control); `api/{company,workspace,stock,location_routes,autoaudit_routes,integration}.py` hanya pada adapter setting yang perlu provenance control.
- XM `api/activity.py`, `api/worker.py`, `api/property_activity.py` **(baru)**: local log/outbox dan bounded relay.
- AA `src/controllers/propertyActivityController.js`, `src/services/propertyActivityService.js`, `src/repositories/propertyActivityReceiptRepository.js` **(baru)**; reuse `companyActivityLogger`/repository di transaksi penerima.
- Tests: AA `src/controllers/__tests__/propertySettingsController.test.js`, `src/services/__tests__/propertyControlService.test.js`, `src/services/__tests__/propertyActivityService.test.js` **(baru)**; XM `api/test_property_control.py`, `api/test_property_activity.py` **(baru)**.

Langkah:

1. Backend AA memetakan action allowlist ke exact method/path XM; tidak menerima upstream URL dari browser. Apply session/Company/feature/menu checks, anti-CSRF/origin policy existing yang sesuai route; target Company Superadmin juga divalidasi.
   Route `/api/property/control-session` dan `/api/property/activity-events` adalah receiver antar-server, dipasang sebelum browser-only gate yang dapat menghalangi request tanpa cookie; masing-masing tetap wajib validasi tiket/HMAC sendiri. Jangan memakai pengecualian auth berdasarkan prefix `/api/property/*` secara luas.
2. Tiket `property-control` 60 detik mengikat full actor, target, method/path, body digest, event UUID. XM validate ke `/api/property/control-session`, tanpa membuat browser session. Tidak menahan connection DB selama jaringan.
3. Middleware memerlukan control provenance pada mutasi pengaturan lama; browser session XM dan workflow key tidak cukup. Role/action tetap diverifikasi; anggota hanya preferensi sendiri yang diizinkan existing. CRUD akun lokal dan Company lokal ditutup.
   Untuk lock, gunakan route baru terbatas pada desain, resolve Superior yang benar lewat AA lalu mirror UUID; jangan meneruskan payload edit akun lokal yang dapat mengubah email/password/role. Pisahkan payload navigasi/read dari payload mutation, dan ikuti exact resource/method matrix desain bagian 6.
4. Gunakan validator/transaksi/queue XM existing; simpan state+log+outbox atomik. Jangan mengulang implementasi matching di AA.
5. Worker kirim maksimal 50 event/60 detik satu concurrency melalui authenticated activity endpoint. HMAC meliputi purpose, timestamp, method/path, raw body; enforce size/time limit, receipt UUID unique, identity snapshot redacted, dan Superadmin/impersonation skip.
6. Receiver AA menyimpan company activity dan receipt dalam satu MySQL transaction. Retry setelah ack hilang mengembalikan ack tanpa duplicate. Ack membuat XM event sent; network gagal tidak rollback state XM yang sudah committed.
7. Service AA tidak otomatis retry mutation non-idempoten; timeout memberitahu hasil belum pasti dan menawarkan read state/status. Tidak menyimpan raw key/tiket/payload sensitif di log atau receipt.

**Bukti selesai:** tamper Company/actor/path/body, wrong audience, expired ticket, old browser mutation, workflow-key misuse ditolak. XM audit failure rollback setting; AA receiver failure rollback receipt+log; repeated delivery hanya satu log; outage backlog tetap durable dan tidak menghentikan matching.

## T6 — Pengaturan di AA dan navigasi XM

**Dependensi:** T4–T5. Port semantik, bukan redesign form bisnis.

Files:

- AA `views/property-settings.ejs`, `public/dashboard/property-settings.js` **(baru)**; controller T5; `public/dashboard/components.js` (link Agent Developer pada shared Company navigation), `views/companies-detail.ejs` (shortcut pengaturan Company untuk Superadmin). Jangan membuat sidebar duplikat.
- AA `views/components/superiors-manager-access.ejs`: pertahankan checkbox existing; hanya tambahkan keterangan bila diperlukan, tanpa selector role.
- XM `components/pages/settings-page.tsx`, `components/pages/team-page.tsx`, `components/pages/companies-page.tsx`, `components/app/company-shell.tsx`, `components/pages/autoaudit-card.tsx`, `lib/router.ts`: arahkan pengaturan/account management ke AA dan hilangkan editor independen.
- XM `components/settings/*.tsx` sebagai referensi port; hapus file hanya jika semua import/use sudah dipastikan tidak diperlukan. Tidak wajib cleanup semua komponen lama untuk task ini.
- Tests: AA `tests/unit/property-settings-ui.test.js` **(baru)**; XM `tests/property-settings-navigation.test.mjs` **(baru)**.

Langkah:

1. Buat bagian Umum, Pencocokan, Pantau Sales, Sumber data, Integrasi workflow, serta preferensi personal yang relevan. Nama/password/anggota menuju halaman AA existing.
2. Role Company/Superadmin mendapat kontrol Company; anggota hanya personal saat unlocked. Jangan otomatis menjadikan Staff/Manajemen admin.
3. Port batas keyword, bobot, glossary preview, location revision, pagination, normalisasi nomor, key one-time, connect/disconnect/sync; status job aktif memakai polling terbatas yang berhenti pada terminal/unmount.
4. Tidak ada auto-import/sync/recompute saat hanya membuka halaman. Pemilihan mode upload operasional di XM tetap seperti existing; pilihan Sales tidak otomatis membatasi data anggota.
5. Navigasi pengaturan XM membawa asal AA dan bagian yang diizinkan, bukan token di URL. Link lama punya tujuan yang jelas; halaman Company XM boleh read-only/switch workspace bagi Superadmin, tetapi create/rename/account editing menuju AA.
6. Port kunci/buka kunci Property ke rincian anggota di AA dengan `can_edit` existing; target harus actor AA valid. Tidak membuka CRUD email/password/role XM. Pertahankan status kunci legacy saat adopsi agar migrasi tidak membuka akses yang sebelumnya ditutup.

**Bukti selesai:** matriks semua kontrol existing pada desain bagian 4 tercakup; tidak ada silent removal preferensi personal/integrasi/lokasi; save/error/status mengikuti backend; Team Access hanya checkbox Agent Developer.

## T7 — Mapping, rollout, dan rollback

**Dependensi:** T1–T6 + izin DB/deployment eksplisit. Jangan eksekusi dari dokumen ini otomatis.

Files: XM `api/schema.sql`, `api/sso.py`; AA migration T2; rencana mapping T1. Bila perlu script rekonsiliasi, tetapkan file baru dan dapatkan izin eksekusi; jangan menjalankan scripts/ default.

1. Review mapping dan snapshot/backup. Selesaikan duplicate mapping sebelum unique index; pertahankan namespace arsip, UUID actor existing yang terverifikasi, API key dan delivery receipts.
2. Deploy backward-compatible additive schema/endpoint sebelum cutover UI; tidak mengaktifkan akses password sebagai fallback production. Tentukan urutan terpasang AA/XM agar tidak ada titik akses setengah siap.
3. Mapping akun dan invalidasi sesi lokal/shared lama dilakukan dengan izin data write terpisah. Jangan infer siapa pemilik aktivitas akun bersama lama.
4. Smoke satu Company dan dua anggota; baru lanjut Company lain. Root/child Superadmin tidak boleh kehilangan arsip/workspace admin.
5. Rollback aplikasi terkoordinasi; pertahankan mapping, log/receipt, dan arsip. Jangan down migration audit atau menghapus user baru otomatis. Jika versi lama tidak dapat mempertahankan gate SSO-only, jangan rollback ke versi tersebut tanpa keputusan eksplisit.

**Bukti selesai:** tidak ada arsip hilang, satu Company principal, anggota terpisah, link login/logout berfungsi, pending audit terantar, dan hasil property fixture tidak berubah. Deployment evidence dicatat terpisah dari tes lokal.

## T8 — Verifikasi fokus dan dokumen aktif

**Dependensi:** task implementasi terkait. Jangan menunggu akhir untuk menemukan boundary salah.

Strategi: satu targeted check pada area yang sedang dikembangkan, satu final focused run setelah perubahan terkait selesai. Tidak full suite, tidak Playwright default. Rerun hanya jika code/test terkait berubah atau finding nyata.

Contoh command lokal, disesuaikan file yang benar-benar berubah:

```sh
# AA: regression SSO/Harness dan target Property; bukan server production.
node --test src/controllers/__tests__/moduleAccessController.test.js tests/unit/harness-login-choice.test.js tests/unit/property-login-choice.test.js src/controllers/__tests__/propertySettingsController.test.js src/services/__tests__/propertyActivityService.test.js

# XM: test JS pure/mocked untuk account state/navigation.
node --test tests/account-sync.test.mjs tests/property-settings-navigation.test.mjs

# Syntax/diff saja untuk docs-only atau sesudah perubahan non-runtime.
git diff --check
```

Python: pilih unit test pure/mock dalam `api/test_sso.py`, `api/test_property_control.py`, `api/test_property_activity.py` sesuai class aktual. `api/harness.py`/`ServerTestCase` dapat menulis schema/data: test DB hanya setelah izin eksplisit dan `XM_TEST_DATABASE_URL` menunjuk DB disposable terisolasi; jangan menjalankan discover seluruh `test_*.py` dengan env normal. Jangan menjalankan app/server atau AI/network nyata untuk mengejar status hijau.

Acceptance matrix minimum:

| Kelompok | Kasus konkret |
|---|---|
| Identity | Company + dua anggota, concurrent first login, rename, pindah Company, role mismatch |
| Hak | Modul mati, menu dicabut, CS ditolak, epoch dicabut, anggota tidak dapat edit setting Company |
| Lifecycle | Login langsung, reload akun sama/beda, hash route, stale async/draft, logout AA, 401/403/503, origin/callback invalid |
| Control | Wrong audience/method/path/body, target lintas Company, workflow-key misuse, browser lama ditolak |
| Bisnis | Keyword lock/personal, mode/watchlist, toleransi/glossary/lokasi, connect/sync, key one-time, fixture matching/status/PDF |
| Audit | Rollback lokal jika log gagal, receiver atomic, retry ack lost, Superadmin skip, backlog bounded |
| Migrasi | Mapping lama dipakai tanpa namespace baru; arsip/preferences/key tidak hilang; duplicate mapping terdeteksi |

Manual utama setelah app test lokal diizinkan: login AA sebagai Company A, buka XM; ganti akun AA menjadi anggota B lalu refresh XM, pastikan nama/hak B dan data Company tepat; logout XM harus berakhir di login AA. Pengujian ini bukan izin menjalankan server.

Docs yang diperbarui **saat behavior diimplementasikan**, bukan pada task desain:

- AA `agent-docs/core/auth-rbac-and-tenancy.md`, `agent-docs/domains/companies/roles-divisions-and-superiors.md`, `agent-docs/domains/notifications/activity-and-app-logs.md`, inventories route/table/env yang berubah; tambahkan feature guide Property terfokus bila perlu dan route-kan dari master.
- XM `README.md`, `docs/WORKFLOW_INTEGRATION.md` bila lokasi pengelolaan key berubah, `docs/DESAIN_ACTIVITY_LOG_2026-10-09.md` untuk relay/retention. Dokumen desain SSO 13 Oktober tetap konteks historis; tautkan kontrak baru, jangan klaim target sudah live.

Handoff implementasi: hasil/fungsi, focused checks dan batasnya, `Scale/debt check`, `Models used`, `Delegation`, `Review result`, tepat satu `Docs updated` atau `Docs unchanged`. Tidak commit/push/deploy otomatis.

## Keputusan yang masih memerlukan review

- Approval dokumen desain, termasuk control ticket, outbox audit/receipt, pilihan aplikasi Property, dan scope pemindahan seluruh editor pengaturan.
- Mapping nyata akun/workspace lokal dan penanganan konflik yang baru diketahui melalui inventory. Ini keputusan data, bukan diasumsikan dari diskusi produk.
- Izin implementasi terpisah; setelah itu tetap perlu izin DB write/migration, server, Git, dan deployment sesuai scope.

Rencana ini tidak memilih akun nyata, tidak menjalankan migrasi, dan tidak mengubah akses pengguna mana pun.
