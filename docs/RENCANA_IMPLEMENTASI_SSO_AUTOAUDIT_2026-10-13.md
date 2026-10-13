# Rencana Implementasi: SSO dari AutoAudit ke Property

Tanggal: 13 Oktober 2026. Status: diimplementasikan 13 Oktober 2026. Tes yang butuh database (`XM_TEST_DATABASE_URL`) belum pernah dijalankan.

Penyesuaian dari rencana: rute SSO berada di `api/auth.py` (bukan router di `api/sso.py`); Superadmin berbagi workspace administrator `xm`; `auth.sso_login` dicatat hanya bila login terakhir lebih dari 30 menit lalu (bukan `merge=True`); `/company/settings` menambah `managed_by_autoaudit`.

> **Untuk pelaksana:** kerjakan inline di checkout ini. Jangan commit, push, atau membuat worktree tanpa permintaan pengguna. Langkah memakai checkbox (`- [ ]`).

**Tujuan:** Company dan Superadmin AutoAudit masuk ke Property tanpa login kedua; akses putus begitu modul Property dimatikan di AutoAudit.

**Arsitektur:** Property tidak membuka tiket dan tidak menyimpan secret. Ia menukar tiket ke AutoAudit (`POST /api/property/session`) untuk mendapat identitas, menyimpan tiket itu di baris sesi, lalu menanyakannya ulang pada setiap request. Akun dan workspace dibuat otomatis berdasarkan kunci stabil `autoaudit_key`.

**Tech stack:** FastAPI, psycopg 3, PostgreSQL schema `xm`, `urllib` (tanpa dependency baru), React/vinext, `unittest`.

**Spec:** `../sales-audit-2/docs/superpowers/specs/2026-10-13-company-modules-property-harness-sso-design.md`

**Pasangan:** `../sales-audit-2/docs/superpowers/plans/2026-10-13-company-modules-and-property-sso.md`. Task 3 di sana menyediakan `/dashboard/property` dan `/api/property/session`; tanpa itu SSO di sini hanya bisa diuji dengan mock.

## Batasan global

- SSO aktif hanya bila `XM_SSO_ENABLED=1` dan `AUTOAUDIT_BASE_URL` terisi. Tanpa itu perilaku sekarang tidak berubah.
- `AUTOAUDIT_PUBLIC_URL` (opsional) = origin AutoAudit untuk redirect browser; default `AUTOAUDIT_BASE_URL`.
- Sesi SSO berakhir pada `exp` dari AutoAudit (15 menit). Callback hanya menerima tiket dengan `iat` maksimal 60 detik yang lalu.
- AutoAudit tidak terjangkau saat cek ulang → 503, sesi tidak dihapus. Ditolak (401) → sesi dihapus, 401.
- Akun dengan `autoaudit_key` terisi tidak bisa login password.
- Workspace `aa-*` tidak bisa menambah akun anggota.
- Company lama dan akun lama tidak diubah.
- Tiket tidak pernah dikembalikan ke browser, tidak dicatat di log aktivitas, dan tidak ikut di respons `/auth/me`.
- Akses produksi tetap read-only. Tes DB hanya memakai `XM_TEST_DATABASE_URL` yang terisolasi.

## Fokus review

- AutoAudit mati saat request berjalan: harus 503, bukan 401 dan bukan lolos (Task 2).
- Tiket milik identitas lain dipakai pada sesi yang ada (AutoAudit menjawab actor berbeda): sesi dihapus, 401 (Task 2).
- Callback dibuka tanpa cookie state atau dengan state berbeda: ditolak, tidak ada akun dibuat (Task 3).
- Dua callback bersamaan untuk company yang sama pada login pertama: tetap satu akun dan satu workspace (Task 3).
- Akun SSO yang password-nya direset administrator: login password tetap ditolak (Task 4).

---

### Task 1: Kolom dan klien cek ulang

**File:**
- Ubah: `api/schema.sql` (tambahkan di akhir)
- Buat: `api/sso.py`
- Tes: `api/test_sso.py`

**Antarmuka:**
- Menghasilkan kolom `xm.users.autoaudit_key text UNIQUE` dan `xm.sessions.sso_ticket text` (`ADD COLUMN IF NOT EXISTS`).
- Menghasilkan di `sso.py`:
  - `enabled() -> bool`
  - `public_url() -> str`
  - `class Unavailable(Exception)`
  - `exchange(ticket: str) -> dict | None` — `POST {AUTOAUDIT_BASE_URL}/api/property/session` body JSON `{"ticket": ...}`, timeout 5 detik. 200 → dict `{actor, state, iat, exp}`; 401 → `None`; error jaringan, timeout, atau status lain → `Unavailable`.
  - `identity_key(actor: dict) -> str` — `company:<companyId>` untuk `role == 'company'`; `superadmin:root` untuk `actorType == 'superadmin'`; `superadmin:<actorId>` untuk `actorType == 'child_superadmin'`; `ValueError` untuk bentuk lain.

- [ ] **Langkah 1: Tulis tes yang gagal** (`SsoClientTests`, tanpa DB, `urllib.request.urlopen` di-patch): `identity_key` untuk ketiga bentuk actor dan `ValueError` untuk `role: 'company'` tanpa `companyId`; `exchange` mengembalikan dict pada 200, `None` pada `HTTPError` 401, melempar `Unavailable` pada `URLError` dan pada 500; `enabled()` false bila salah satu env kosong.
- [ ] **Langkah 2:** `python3 -m unittest discover -s api -p test_sso.py` → gagal karena `sso` belum ada.
- [ ] **Langkah 3:** Tambah kolom dan `sso.py`.
- [ ] **Langkah 4:** Jalankan ulang → lulus.

### Task 2: Cek ulang pada setiap request

**File:**
- Ubah: `api/auth.py` (`current_user`, `public_user`, `login`)
- Ubah: `api/app.py` (middleware `require_login`)
- Tes: `api/test_sso.py`

**Antarmuka:**
- Memakai: `sso.exchange`, `sso.identity_key`, `sso.Unavailable` (Task 1).
- `current_user(request)` kini juga membaca `s.id AS session_id`, `s.sso_ticket`, `u.autoaudit_key`. Bila `sso_ticket` terisi: panggil `sso.exchange`; hasil `None` atau `identity_key(actor) != autoaudit_key` → hapus baris sesi, kembalikan `None`; `Unavailable` diteruskan. Baris yang dikembalikan **tidak** memuat `sso_ticket` dan memuat `sso: bool`.
- `public_user` menambah kunci `sso`.
- `login` menolak dengan 401 yang sama bila `user['autoaudit_key']` terisi.
- Middleware menangkap `sso.Unavailable` di sekitar `current_user(request)` dan menjawab `503 {'detail': 'AutoAudit belum dapat dihubungi. Coba lagi sebentar.'}`.

- [ ] **Langkah 1: Tulis tes yang gagal** (`SsoSessionTests(ServerTestCase)`, `sso.exchange` di-patch): sesi ber-tiket dengan actor cocok → `/auth/me` 200, memuat `sso: true`, tidak memuat `sso_ticket`; `exchange` → `None` → 401 dan baris sesi terhapus; actor company lain → 401 dan terhapus; `exchange` melempar `Unavailable` → 503 dan baris sesi masih ada; sesi password (tiket `NULL`) tidak memanggil `exchange`; login password untuk akun ber-`autoaudit_key` → 401.
- [ ] **Langkah 2:** `XM_TEST_DATABASE_URL=<db uji> python3 -m unittest discover -s api -p test_sso.py` → gagal.
- [ ] **Langkah 3:** Implementasi perubahan `auth.py` dan `app.py`.
- [ ] **Langkah 4:** Jalankan ulang → lulus.

### Task 3: Start, callback, dan pembuatan otomatis

**File:**
- Ubah: `api/sso.py` (router)
- Ubah: `api/access.py` (`PUBLIC_PREFIXES` tambah `'/auth/sso/'`)
- Ubah: `api/app.py` (`include_router`)
- Ubah: `api/activity.py` (`ACTIONS` tambah `'auth.sso_login': 'Masuk lewat AutoAudit'`)
- Tes: `api/test_sso.py`

**Antarmuka:**
- `GET /auth/sso/config` → `{"enabled": bool}`.
- `GET /auth/sso/start` → 503 bila tidak aktif. Selain itu: `state = secrets.token_hex(32)`, cookie `xm_sso_state` (`httponly`, `samesite=lax`, `path=/api/auth/sso`, `max_age=600`, `secure` mengikuti `XM_COOKIE_SECURE`), redirect 302 ke `{public_url()}/dashboard/property?state=<state>`.
- `GET /auth/sso/callback?ticket=` → urutan: `exchange(ticket)`; tolak bila `None`, bila `state` tidak sama dengan cookie (`hmac.compare_digest`), atau bila `now_ms - iat > 60000`. Lalu `provision_identity`, buat sesi (`expires_at` dari `exp`, `sso_ticket` = tiket), set cookie `xm_session` dengan `max_age` sisa umur tiket, hapus cookie state, hapus sesi kedaluwarsa, redirect 302 ke `/`. Header `Cache-Control: no-store` dan `Referrer-Policy: no-referrer`.
- Kegagalan callback → HTML 401 "Verifikasi login tidak ditemukan atau sudah kedaluwarsa." dengan tautan `/api/auth/sso/start`; `Unavailable` → HTML 503.
- `provision_identity(conn, actor) -> dict` (baris user):
  - Kunci `autoaudit_key = identity_key(actor)`; `INSERT ... ON CONFLICT (autoaudit_key) DO UPDATE SET display_name = excluded.display_name RETURNING *`.
  - Company: email `company-<id>@sso.autoaudit.id`, role `company_admin`, `workspace_id = 'aa-<id>'`, `password_hash = 'sso'`; `provision_company(conn, workspace, actor['name'])`; `UPDATE xm.app_preferences SET autoaudit_company_id = <id>, autoaudit_company_name = <name>`. Saat workspace baru dibuat, catat `company.create`.
  - Superadmin: email `superadmin-root@sso.autoaudit.id` atau `superadmin-<id>@sso.autoaudit.id`, role `admin`, `display_name = actor.get('name') or 'Superadmin'`, `password_hash = 'sso'`; `provision_workspace(conn, user_id)`.
  - Catat `activity.record(conn, 'account', 'auth.sso_login', 'masuk lewat AutoAudit', actor=user, company_id=user['workspace_id'], merge=True)`.

- [ ] **Langkah 1: Tulis tes yang gagal** (`SsoCallbackTests(ServerTestCase)`, `sso.exchange` di-patch):
  - `start` mengeset cookie state dan redirect ke `/dashboard/property?state=` dengan nilai yang sama.
  - callback company 12 "PT Contoh" → 302 ke `/`; ada satu user `autoaudit_key='company:12'`, role `company_admin`, workspace `aa-12`; `app_preferences` `aa-12` ber-`autoaudit_company_id = 12`; `/auth/me` dengan cookie sesi → 200.
  - callback kedua untuk company 12 → tetap satu user dan satu workspace.
  - callback `actorType: 'child_superadmin', actorId: 7` → user role `admin`, kunci `superadmin:7`.
  - tanpa cookie state, state berbeda, `iat` 61 detik lalu, dan `exchange` → `None`: masing-masing 401 dan tidak ada user baru.
  - `exchange` melempar `Unavailable` → 503.
  - `required_role`/middleware: `/auth/sso/start` dan `/auth/sso/callback` bisa diakses tanpa sesi.
- [ ] **Langkah 2:** Jalankan `test_sso.py` → gagal.
- [ ] **Langkah 3:** Implementasi router, `provision_identity`, dan pendaftaran.
- [ ] **Langkah 4:** Jalankan ulang → lulus. Jalankan juga `python3 -m unittest discover -s api -p test_activity.py`, karena `CoverageTests` memeriksa rute baru.

### Task 4: Batas akun dan label asal

**File:**
- Ubah: `api/team.py` (tolak tambah akun di workspace `aa-*`)
- Ubah: `api/company.py` (`_companies` menambah `source`)
- Tes: `api/test_sso.py`

**Antarmuka:**
- `POST /team/users` di workspace berawalan `aa-` → 403 `'Akun company ini dikelola dari AutoAudit.'`.
- Tiap item `_companies` mendapat `source: 'autoaudit'` bila `company_id` berawalan `aa-`, selain itu `'xm'`; tiap user di dalamnya mendapat `sso: bool` dari `autoaudit_key`.

- [ ] **Langkah 1: Tulis tes yang gagal:** tambah akun di workspace `aa-12` → 403; di workspace biasa tetap 201; `GET /admin/companies` memuat `source` yang benar untuk keduanya; akun SSO yang `password_hash`-nya diganti hash valid tetap 401 saat login password.
- [ ] **Langkah 2:** Jalankan `test_sso.py` → gagal.
- [ ] **Langkah 3:** Implementasi.
- [ ] **Langkah 4:** Jalankan ulang → lulus.

### Task 5: Antarmuka

**File:**
- Ubah: `lib/types.ts` (`User.sso?: boolean`; tipe company `source`, user `sso`)
- Ubah: `lib/session.tsx`
- Ubah: `components/app/login-screen.tsx`
- Ubah: `components/pages/companies-page.tsx`
- Ubah: `components/pages/team-page.tsx`

**Perilaku:**
- `login-screen.tsx`: ambil `/api/auth/sso/config`; bila `enabled`, tampilkan tombol "Masuk lewat AutoAudit" yang menavigasi ke `/api/auth/sso/start`. Form email + password tetap ada.
- `session.tsx`: saat `user.sso` terlihat, simpan `localStorage['xm.sso'] = '1'`. Saat user berubah dari terisi menjadi `null` dan penanda itu ada, navigasi penuh ke `/api/auth/sso/start` (sesi 15 menit habis). `logout` menghapus penanda sebelum memanggil `/api/auth/logout`. Akses `localStorage` dibungkus `try/catch`.
- `companies-page.tsx`: badge "AutoAudit" atau "XM" di kartu company; untuk akun `sso`, sembunyikan aksi reset password dan ubah email.
- `team-page.tsx`: bila company bersumber AutoAudit, sembunyikan tombol tambah akun dan tampilkan "Akun company ini dikelola dari AutoAudit."

- [ ] **Langkah 1:** Implementasi kelima file.
- [ ] **Langkah 2:** `npm run lint` → tanpa error baru.

### Task 6: Konfigurasi dan dokumen

**File:**
- Ubah: `.env.example` (`XM_SSO_ENABLED`, `AUTOAUDIT_PUBLIC_URL`, dengan komentar satu baris)
- Ubah: `README.md` (bagian "Login dan peran": SSO, asal akun, batas tambah anggota, sesi 15 menit)

- [ ] **Langkah 1:** Perbarui kedua file sesuai behavior yang sudah diimplementasikan.

## Verifikasi akhir

```bash
XM_TEST_DATABASE_URL=<db uji terisolasi> python3 -m unittest discover -s api -p 'test_sso.py'
```

Uji manual setelah kedua sisi terpasang: di AutoAudit nyalakan modul Property untuk satu company, login sebagai company itu, klik Modules → Property. Tab baru harus langsung masuk tanpa form login, dan company itu muncul berlabel "AutoAudit" di menu Perusahaan milik administrator. Matikan modulnya; request berikutnya di tab Property harus kembali ke layar masuk.

## Catatan skala

Antarmuka memanggil `/auth/me` tiap 5 detik per tab, sehingga tiap tab SSO menghasilkan minimal 12 cek ulang per menit ke AutoAudit, ditambah satu per request API. Itu ringan untuk puluhan tab. Untuk ratusan tab, tambahkan cache hasil cek ulang beberapa detik di `current_user`; belum termasuk rencana ini.
