# Sambungan Otomatis AutoAudit → XM Property: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat dari AutoAudit masuk ke company XM secara otomatis setelah sync selesai, tanpa unggah JSON manual dan tanpa menggandakan stok.

**Architecture:** Worker XM yang sudah ada mendapat satu langkah baru, "cek lalu tarik", untuk setiap sales yang tersambung. Langkah itu dipicu tiga jalur (webhook bertoken, cek tiap 10 menit, dan tombol sync manual), membandingkan `last_updated_at` dataset (dilewati pada sync manual), mengunduh per rentang tanggal, lalu menaruh file dan baris `xm.imports` berstatus antre. Pipeline impor, parser, dan matcher tidak diubah.

**Tech Stack:** Python 3.12, FastAPI, psycopg 3, `urllib` dari pustaka standar (tanpa dependensi baru), PostgreSQL schema `xm`, React/Vinext + HeroUI, `unittest`.

**Spec:** [docs/DESAIN_INTEGRASI_AUTOAUDIT_2026-10-09.md](DESAIN_INTEGRASI_AUTOAUDIT_2026-10-09.md). Latar belakang: [handoff](HANDOFF_AUTOAUDIT_PROPERTY_2026-10-09.md).

## Global Constraints

- Tidak ada perubahan kode di `../sales-audit-2`. Repository itu hanya dibaca.
- Produksi **read-only**: tidak mengunggah, menyimpan pengaturan, memicu sync, mengirim pesan, deploy, atau menulis DB produksi. Task 0 hanya memanggil `GET`.
- Kerjakan di checkout dan branch `okta` yang ada. Tidak membuat worktree. **Tanpa Git apa pun**: tidak ada `git add`, commit, push, branch, atau stash. Perubahan dibiarkan di working tree.
- Tidak menambah dependensi Python atau npm.
- `api/ingest.py`, `api/parser.py`, `api/matcher.py` tidak diubah.
- API key dan token webhook hanya dibaca dari environment backend. Tidak dikirim ke frontend, tidak ditulis ke log, tidak masuk Git.
- Nilai bawaan: `AUTOAUDIT_CHECK_SECONDS=600`, `AUTOAUDIT_RETRY_COUNT=10`, `AUTOAUDIT_RETRY_SECONDS=15`, `AUTOAUDIT_CHUNK_DAYS=31`, tumpang-tindih 2 hari.
- Tanggal "hari ini" dan rentang unduhan memakai zona `Asia/Jakarta`.
- Kode status di DB: `waiting`, `pulling`, `current`, `failed`. Label layar: Menunggu data, Menarik, Terbaru sampai …, Gagal.
- Teks yang dilihat pengguna berbahasa Indonesia, mengikuti gaya halaman yang ada.
- Gaya kode mengikuti berkas sekitarnya; tes memakai `unittest`, dan tes yang butuh DB diberi `@unittest.skipUnless(os.getenv('XM_TEST_DATABASE_URL'), ...)`.
- Menjalankan tes: dari folder `api/`, `python3 -m unittest <modul> -v`. Regresi penuh: `python3 -m unittest discover -s api -p 'test_*.py'` dari akar repository.

## Review Focus

1. **Nama sumber tidak sama dengan nama lama.** Kalau company sudah berisi tetapi nama sumber diketik berbeda, XM menganggapnya kosong dan menarik seluruh riwayat sebagai stok baru. Yang diharapkan: form sudah terisi nama sumber lama. Tes di Task 5 (`test_options_suggest_existing_agent_name`).
2. **Potongan tanpa pesan.** Rentang yang tidak punya chat tidak boleh membuat impor kosong, dan tidak boleh dianggap gagal. Tes di Task 3 (`test_empty_chunk_queues_nothing_and_still_completes`).
3. **Jawaban unduhan bukan JSON terbungkus** (ZIP, HTML galat, JSON tanpa `data.dataset.chats`). Harus diperlakukan sebagai galat yang diulang, bukan membuat worker berhenti. Tes di Task 1 (`test_download_rejects_non_json_and_missing_chats`).
4. **AutoAudit mati saat cek rutin.** Satu sambungan gagal tidak boleh menghentikan worker atau sambungan lain. Tes di Task 4 (`test_one_failing_source_does_not_stop_others`).
5. **Satu sales tersambung ke dua company XM.** Webhook harus mencolek keduanya. Tes di Task 5 (`test_webhook_marks_every_company_connected_to_sales`).

---

## Peta berkas

| Berkas | Tanggung jawab |
|---|---|
| `scripts/autoaudit_probe.py` (baru) | Uji baca sekali jalan ke API; tidak menulis apa pun. |
| `api/autoaudit_client.py` (baru) | Satu-satunya kode yang berbicara HTTP ke AutoAudit. |
| `api/autoaudit_sync.py` (baru) | Aturan rentang, percobaan ulang, "cek lalu tarik", pemilihan sambungan yang jatuh tempo. |
| `api/autoaudit_routes.py` (baru) | Rute sambungan, status, dan penerima webhook. |
| `api/schema.sql` | Tabel `xm.autoaudit_sources`, kolom `xm.imports.source`. |
| `api/worker.py` | Memanggil sinkronisasi saat antrean kosong. |
| `api/access.py`, `api/app.py` | Jalur publik `/hooks/`, pendaftaran router. |
| `api/harness.py` | Menambah tabel baru ke daftar pembersihan tes. |
| `components/pages/autoaudit-card.tsx` (baru), `components/pages/upload-page.tsx`, `lib/types.ts` | Kartu sambungan. |
| `.env.example`, `README.md` | Variabel baru dan cara memasang webhook. |
| `api/test_autoaudit_client.py`, `api/test_autoaudit_sync.py`, `api/test_autoaudit_routes.py` (baru) | Tes. |

---

### Task 0: Uji baca ke API (gerbang sebelum implementasi)

Butuh izin pengguna dan API key di environment shell. Hanya `GET`.

**Files:**
- Create: `scripts/autoaudit_probe.py`

**Interfaces:**
- Produces: jawaban atas lima pertanyaan Bagian 11 desain. Tidak ada kode yang dipakai task lain.

- [ ] **Step 1: Tulis `scripts/autoaudit_probe.py`**

Argumen: `--sales-id`, `--start`, `--end` (YYYY-MM-DD), `--manual-json` (path file unggahan manual lama, opsional). Membaca `AUTOAUDIT_BASE_URL` dan `AUTOAUDIT_API_KEY`. Tanpa `--sales-id` hanya mencetak daftar sales (`id`, `name`, `company.name`). Dengan `--sales-id` mencetak: `dataset` dari detail sales; status, `Content-Type`, ukuran, dan lama unduhan rentang; jumlah chat dan pesan; kunci-kunci tingkat atas `data.dataset`. Dengan `--manual-json` menghitung `parser.message_hash(chat_id, timestamp, author, text)` untuk pesan pada rentang yang sama di kedua sumber dan mencetak jumlah yang sama, hanya di API, dan hanya di file manual, plus tiga contoh selisih. Tidak pernah mencetak key.

- [ ] **Step 2: Jalankan untuk sales sumber `XM Darmo Caesar`**

Run: `cd api && python3 ../scripts/autoaudit_probe.py --sales-id <id> --start 2026-09-10 --end 2026-09-16 --manual-json <file unggahan terakhir>`
Expected: pesan pada rentang itu **seluruhnya** berstatus sama. Catat ukuran dan lama unduhan.

- [ ] **Step 3: Jalankan untuk satu tahun lama dan satu rentang kosong**

Expected: mengetahui apakah tahun tanpa arsip menjawab 404 `year_shard_missing` atau dataset kosong.

- [ ] **Step 4: Laporkan hasil ke pengguna dan berhenti**

Bila sidik pesan tidak cocok, **jangan lanjut**: catat bentuk perbedaannya (zona waktu, format timestamp, `chat_id`, pengirim) dan minta keputusan. Bila cocok, lanjut ke Task 1 dan sesuaikan `AUTOAUDIT_CHUNK_DAYS` bila ukuran satu bulan terlalu besar.

---

### Task 1: Klien AutoAudit

**Files:**
- Create: `api/autoaudit_client.py`
- Test: `api/test_autoaudit_client.py`

**Interfaces:**
- Produces:
  - `class AutoAuditError(Exception)` dengan atribut `status: int | None`, `code: str | None`, `retryable: bool`.
  - `def configured() -> bool` — benar bila `AUTOAUDIT_BASE_URL` dan `AUTOAUDIT_API_KEY` terisi.
  - `class AutoAuditClient(base_url: str, api_key: str, timeout: float = 120, opener=urllib.request.urlopen)`
    - `list_sales() -> list[dict]` — tiap item `{'id': int, 'name': str, 'company': str | None}`, semua halaman digabung.
    - `dataset_summary(sales_id: int) -> dict` — isi `data.dataset` dari detail sales.
    - `download_range(sales_id: int, start: date, end: date) -> dict` — isi `data.dataset`; dijamin punya `chats` bertipe `dict`.
  - `def from_env() -> AutoAuditClient`

Aturan `retryable`: `True` untuk galat jaringan, batas waktu, status 202, 404, 408, 429, dan 5xx, serta jawaban yang bukan JSON atau tanpa `data.dataset.chats`. `False` untuk 400, 401, 403.

- [ ] **Step 1: Tulis tes yang gagal**

Tes memakai `opener` tiruan yang mengembalikan objek dengan `.status`, `.headers`, `.read()`; tanpa jaringan.

```python
def test_list_sales_follows_pagination(self):
    # halaman 1: 2 item, pagination {'page':1,'total_pages':2}; halaman 2: 1 item
    self.assertEqual([s['id'] for s in client.list_sales()], [57, 58, 61])
    self.assertEqual(client.list_sales()[0], {'id': 57, 'name': 'Caesar', 'company': 'XM Darmo'})

def test_requests_carry_bearer_key_and_never_put_it_in_url(self):
    self.assertEqual(seen[0].get_header('Authorization'), 'Bearer k-secret')
    self.assertNotIn('k-secret', seen[0].full_url)

def test_dataset_summary_returns_dataset_block(self):
    self.assertEqual(client.dataset_summary(57)['last_updated_at'], '2026-10-09T01:14:00.000Z')

def test_download_unwraps_data_dataset(self):
    # body: {'success': True, 'download_format': 'json', 'data': {'dataset': {'chats': {'c1': {...}}}}}
    self.assertEqual(list(client.download_range(57, date(2026, 9, 14), date(2026, 10, 9))['chats']), ['c1'])
    self.assertIn('start_date=2026-09-14', seen[-1].full_url)
    self.assertIn('end_date=2026-10-09', seen[-1].full_url)

def test_download_rejects_non_json_and_missing_chats(self):
    for body, ctype in [(b'PK\x03\x04', 'application/zip'), (b'<html>', 'text/html'),
                        (b'{"success":true,"data":{"dataset":{}}}', 'application/json')]:
        with self.assertRaises(AutoAuditError) as ctx:
            client_with(body, ctype).download_range(57, date(2026, 9, 1), date(2026, 9, 2))
        self.assertTrue(ctx.exception.retryable)

def test_auth_errors_are_not_retryable_and_server_errors_are(self):
    self.assertFalse(error_for(401).retryable); self.assertFalse(error_for(403).retryable)
    self.assertTrue(error_for(404).retryable); self.assertTrue(error_for(503).retryable)
    self.assertTrue(error_for(202).retryable)

def test_error_message_never_contains_key(self):
    self.assertNotIn('k-secret', str(error_for(500)))
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd api && python3 -m unittest test_autoaudit_client -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'autoaudit_client'`

- [ ] **Step 3: Implementasikan `api/autoaudit_client.py`**

Rute: `GET {base}/api/v1/integrations/sales?page=N&limit=100`, `GET .../sales/{id}`, `GET .../sales/{id}/artifacts/download?start_date=&end_date=`. Hentikan paginasi saat halaman kosong atau `pagination` menunjukkan halaman terakhir. `urllib.error.HTTPError` diubah menjadi `AutoAuditError` dengan `code` dari `error.code` di badan JSON bila ada.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd api && python3 -m unittest test_autoaudit_client -v`
Expected: PASS

---

### Task 2: Skema dan aturan rentang

**Files:**
- Modify: `api/schema.sql` (tambahkan di akhir berkas)
- Modify: `api/harness.py` (`WORKSPACE_TABLES`: tambah `'autoaudit_sources'` di depan)
- Create: `api/autoaudit_sync.py`
- Test: `api/test_autoaudit_sync.py`

**Interfaces:**
- Produces:
  - Tabel `xm.autoaudit_sources(id uuid PK, company_id text NOT NULL DEFAULT current_setting('xm.workspace_id'), sales_id integer NOT NULL, sales_name text NOT NULL, agent_name text NOT NULL, status text NOT NULL DEFAULT 'waiting', dataset_updated_at text, check_requested_at timestamptz, force_requested boolean NOT NULL DEFAULT false, last_checked_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, UNIQUE(company_id, sales_id))`.
  - Kolom `xm.imports.source text NOT NULL DEFAULT 'upload'`.
  - `OVERLAP_DAYS = 2`
  - `def today() -> date` — tanggal sekarang di `Asia/Jakarta`.
  - `def start_date(last_sent: date | None, first_message: date | None) -> date | None`
  - `def chunk_ranges(start: date, end: date, days: int) -> list[tuple[date, date]]`
  - `def with_retry(action, attempts: int, delay: float, sleep=time.sleep)` — mengembalikan hasil `action()`.

`dataset_updated_at` disimpan sebagai teks apa adanya dari API dan dibandingkan dengan kesamaan, bukan urutan waktu.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_start_continues_two_days_before_last_message(self):
    self.assertEqual(start_date(date(2026, 9, 16), date(2023, 1, 5)), date(2026, 9, 14))

def test_start_is_first_message_when_company_empty(self):
    self.assertEqual(start_date(None, date(2023, 1, 5)), date(2023, 1, 5))

def test_start_is_none_when_nothing_known(self):
    self.assertIsNone(start_date(None, None))

def test_chunks_cover_range_without_gap_or_overlap(self):
    self.assertEqual(chunk_ranges(date(2026, 9, 14), date(2026, 10, 9), 31),
                     [(date(2026, 9, 14), date(2026, 10, 9))])
    self.assertEqual(chunk_ranges(date(2026, 1, 1), date(2026, 3, 5), 31),
                     [(date(2026, 1, 1), date(2026, 1, 31)), (date(2026, 2, 1), date(2026, 3, 3)),
                      (date(2026, 3, 4), date(2026, 3, 5))])

def test_chunks_empty_when_start_after_end(self):
    self.assertEqual(chunk_ranges(date(2026, 10, 10), date(2026, 10, 9), 31), [])

def test_retry_succeeds_on_fourth_attempt(self):
    # action gagal 3x dengan AutoAuditError(retryable=True) lalu mengembalikan 'ok'
    self.assertEqual(with_retry(action, 10, 15, sleep=slept.append), 'ok')
    self.assertEqual(slept, [15, 15, 15])

def test_retry_gives_up_after_ten_attempts(self):
    with self.assertRaises(AutoAuditError): with_retry(always_503, 10, 15, sleep=slept.append)
    self.assertEqual(calls, 10); self.assertEqual(len(slept), 9)

def test_retry_does_not_repeat_auth_errors(self):
    with self.assertRaises(AutoAuditError): with_retry(always_401, 10, 15, sleep=slept.append)
    self.assertEqual(calls, 1); self.assertEqual(slept, [])
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd api && python3 -m unittest test_autoaudit_sync -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'autoaudit_sync'`

- [ ] **Step 3: Tambahkan skema dan implementasikan fungsi di atas**

Skema memakai `CREATE TABLE IF NOT EXISTS` dan `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, seperti bagian lain `schema.sql`. Tambah indeks `autoaudit_sources(sales_id)`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd api && python3 -m unittest test_autoaudit_sync -v`
Expected: PASS

---

### Task 3: "Cek lalu tarik" untuk satu sambungan

**Files:**
- Modify: `api/autoaudit_sync.py`
- Test: `api/test_autoaudit_sync.py` (kelas baru, butuh `XM_TEST_DATABASE_URL`)

**Interfaces:**
- Consumes: `AutoAuditClient.dataset_summary`, `.download_range`, `AutoAuditError` (Task 1); `start_date`, `chunk_ranges`, `with_retry`, `today` (Task 2).
- Produces:
  - `def queue_import(agent_name: str, file_name: str, chats: dict) -> str | None` — menulis `UPLOAD_DIR/<workspace>/<uuid>.json` berisi `{"chats": chats}`, menyisipkan baris `xm.imports` (`status='queued'`, `source='autoaudit'`), mengembalikan id; `None` bila `chats` kosong atau SHA-256 yang sama sudah ada untuk company + nama sumber itu (file dihapus lagi).
  - `def sync_source(source_id: str, client, sleep=time.sleep) -> str` — mengembalikan status akhir. Menetapkan `workspace_scope(company_id)` sendiri.

Urutan `sync_source`:

1. Baca `force_requested` ke variabel `force`, lalu tandai `status='pulling'`, kosongkan `check_requested_at`, set `force_requested=false`, isi `last_checked_at=now()`.
2. Bila masih ada impor `source='autoaudit'` untuk nama sumber itu berstatus `queued`/`processing`: kembalikan status sebelumnya tanpa mengunduh.
3. `summary = client.dataset_summary(sales_id)`. Bila `has_cleaned_data` salah → `waiting`.
4. Bila `summary['last_updated_at'] == dataset_updated_at` dan `force` salah → `current`. Sync manual (`force` benar) melewati pemeriksaan ini dan menarik data yang ada saat itu; langkah 2 dan 3 tetap berlaku.
5. `last_sent` = `max(sent_at)::date` dari `xm.raw_messages` untuk company + nama sumber. `start = start_date(last_sent, first_message_date)`. Bila `None` → `waiting`.
6. Untuk tiap `chunk_ranges(start, today(), AUTOAUDIT_CHUNK_DAYS)`: `with_retry(lambda: client.download_range(...), AUTOAUDIT_RETRY_COUNT, AUTOAUDIT_RETRY_SECONDS, sleep)`, lalu `queue_import(agent_name, f'autoaudit_sales_{sales_id}_{a}_{b}.json', dataset['chats'])`.
7. Semua potongan selesai → simpan `dataset_updated_at`, `status='current'`, `last_error=NULL`.
8. `AutoAuditError` atau galat lain → `status='failed'`, `last_error` diisi pesan singkat (maks 300 karakter), `dataset_updated_at` **tidak** diubah.

Serialisasi file memakai `json.dumps(..., ensure_ascii=False, sort_keys=True)` supaya SHA-256 stabil untuk isi yang sama.

- [ ] **Step 1: Tulis tes yang gagal**

Tes memakai klien tiruan (`FakeClient(summary, chats_by_range, fail_times=0)`), `UPLOAD_DIR` sementara, dan company uji sekali pakai yang dibersihkan di `tearDown`.

```python
def test_unchanged_dataset_downloads_nothing(self):
    # dataset_updated_at tersimpan == summary['last_updated_at']
    self.assertEqual(sync_source(sid, fake), 'current'); self.assertEqual(fake.downloads, [])

def test_manual_sync_pulls_even_when_dataset_unchanged(self):
    # dataset_updated_at tersimpan == summary['last_updated_at'], force_requested = true
    self.assertEqual(sync_source(sid, fake), 'current'); self.assertEqual(len(fake.downloads), 1)
    self.assertFalse(stored('force_requested'))

def test_newer_dataset_queues_import_with_source_agent_name(self):
    self.assertEqual(sync_source(sid, fake), 'current')
    row = one("SELECT agent_name, source, status, file_name FROM xm.imports WHERE company_id=%s", company)
    self.assertEqual((row['agent_name'], row['source'], row['status']), ('XM Darmo Caesar', 'autoaudit', 'queued'))
    self.assertEqual(json.loads(Path(file_path).read_text())['chats'], fake.chats)
    self.assertEqual(stored('dataset_updated_at'), fake.summary['last_updated_at'])

def test_filled_company_starts_two_days_before_last_message(self):
    # raw_messages sumber itu: sent_at terakhir 2026-09-16
    sync_source(sid, fake); self.assertEqual(fake.downloads[0][0], date(2026, 9, 14))

def test_empty_company_starts_at_first_message_date_in_chunks(self):
    # first_message_date 2026-07-01, today dipatch ke 2026-10-09
    sync_source(sid, fake); self.assertEqual(fake.downloads[0][0], date(2026, 7, 1)); self.assertEqual(len(fake.downloads), 4)

def test_empty_chunk_queues_nothing_and_still_completes(self):
    self.assertEqual(sync_source(sid, fake_without_chats), 'current'); self.assertEqual(count_imports(company), 0)

def test_same_content_twice_is_not_queued_again(self):
    sync_source(sid, fake); mark_imports_completed(company); change_summary(fake); sync_source(sid, fake)
    self.assertEqual(count_imports(company), 1)

def test_ten_failures_mark_failed_and_keep_marker(self):
    self.assertEqual(sync_source(sid, FakeClient(..., fail_times=99), sleep=lambda s: None), 'failed')
    self.assertIsNone(stored('dataset_updated_at')); self.assertTrue(stored('last_error'))

def test_pending_autoaudit_import_defers_next_pull(self):
    sync_source(sid, fake); change_summary(fake); before = len(fake.downloads)
    sync_source(sid, fake); self.assertEqual(len(fake.downloads), before)

def test_repull_does_not_add_listings_and_keeps_sold_status(self):
    # proses impor pertama lewat ingest.process_import (qdrant upsert dan embed dipatch),
    # tandai satu listing 'sold', tarik ulang rentang yang sama dengan summary baru, proses lagi
    self.assertEqual(listing_count_after, listing_count_before); self.assertEqual(status_of(listing), 'sold')
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd api && XM_TEST_DATABASE_URL=<db uji> python3 -m unittest test_autoaudit_sync -v`
Expected: FAIL, `ImportError: cannot import name 'sync_source'`

- [ ] **Step 3: Implementasikan `queue_import` dan `sync_source`**

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd api && XM_TEST_DATABASE_URL=<db uji> python3 -m unittest test_autoaudit_sync -v`
Expected: PASS

---

### Task 4: Putaran worker

**Files:**
- Modify: `api/autoaudit_sync.py`
- Modify: `api/worker.py:49-66`
- Test: `api/test_autoaudit_sync.py`

**Interfaces:**
- Consumes: `sync_source` (Task 3), `autoaudit_client.configured`, `autoaudit_client.from_env` (Task 1).
- Produces:
  - `def claim_due() -> str | None` — memilih satu sambungan dengan `check_requested_at IS NOT NULL` atau `last_checked_at` kosong/lebih tua dari `AUTOAUDIT_CHECK_SECONDS`, yang dicolek didahulukan; memakai `FOR UPDATE SKIP LOCKED`; langsung mengisi `last_checked_at=now()` agar tidak terpilih lagi.
  - `def run_once(client=None, sleep=time.sleep) -> bool` — `False` bila fitur tidak dikonfigurasi atau tidak ada yang jatuh tempo; selain itu menjalankan `sync_source` untuk satu sambungan dan mengembalikan `True`. Tidak pernah melempar galat.
  - `def reset_stuck() -> None` — mengubah `pulling` menjadi `waiting`; dipanggil sekali saat worker mulai.

Di `worker.py`: panggil `reset_stuck()` setelah `migrate_v4()`. Dalam loop, urutannya tetap maintenance → impor → **`run_once()`** → tidur. Impor yang antre selalu didahulukan.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_not_configured_does_nothing(self):
    with patch.dict(os.environ, {'AUTOAUDIT_API_KEY': ''}): self.assertFalse(run_once())

def test_webhook_requested_source_is_claimed_before_stale_one(self):
    self.assertEqual(claim_due(), requested_id)

def test_recently_checked_source_is_not_due(self):
    # last_checked_at = now() - 5 menit, check_requested_at NULL
    self.assertIsNone(claim_due())

def test_source_older_than_ten_minutes_is_due(self):
    self.assertEqual(claim_due(), stale_id)

def test_one_failing_source_does_not_stop_others(self):
    # sumber A: klien melempar ConnectionError di dataset_summary; sumber B normal
    self.assertTrue(run_once(client)); self.assertTrue(run_once(client))
    self.assertEqual(status_of(a), 'failed'); self.assertEqual(status_of(b), 'current')

def test_reset_stuck_returns_pulling_to_waiting(self):
    reset_stuck(); self.assertEqual(status_of(stuck), 'waiting')
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd api && XM_TEST_DATABASE_URL=<db uji> python3 -m unittest test_autoaudit_sync -v`
Expected: FAIL, `ImportError: cannot import name 'claim_due'`

- [ ] **Step 3: Implementasikan ketiga fungsi dan sambungkan ke `worker.py`**

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd api && XM_TEST_DATABASE_URL=<db uji> python3 -m unittest test_autoaudit_sync test_processing_pipeline -v`
Expected: PASS

---

### Task 5: Rute sambungan dan penerima webhook

**Files:**
- Create: `api/autoaudit_routes.py`
- Modify: `api/access.py` (jalur publik berawalan), `api/app.py:61-64` (pakai pemeriksa baru) dan akhir berkas (daftarkan router)
- Test: `api/test_autoaudit_routes.py`, `api/test_admin_access.py` (tambah baris matriks)

**Interfaces:**
- Consumes: `autoaudit_client.configured`, `from_env`, `AutoAuditError` (Task 1); tabel `xm.autoaudit_sources` (Task 2).
- Produces:
  - `access.is_public(path: str) -> bool` — benar untuk `PUBLIC_PATHS` dan jalur berawalan `/hooks/`.
  - `GET /autoaudit/sources` (semua peran) → `{'configured': bool, 'sources': [{'id','sales_id','sales_name','agent_name','status','dataset_updated_at','last_checked_at','last_error'}]}` untuk company aktif.
  - `GET /admin/autoaudit/options` (admin platform) → `{'sales': [{'id','name','company'}], 'agent_names': [str]}`; `agent_names` adalah nama sumber yang sudah ada di `xm.imports` company aktif, terbaru dahulu.
  - `POST /admin/autoaudit/sources` badan `{'sales_id': int, 'agent_name': str}` → 201 dengan baris sambungan, `check_requested_at=now()`. 409 bila sales itu sudah tersambung di company ini; 400 bila nama sumber kosong atau lebih dari 100 karakter; 404 bila `sales_id` tidak ada di daftar API; 503 bila fitur belum dikonfigurasi.
  - `POST /autoaudit/sources/{id}/sync` (admin company ke atas; aturan bawaan `access.required_role`) → 202 dengan baris sambungan setelah mengisi `check_requested_at=now()` dan `force_requested=true`. 404 bila sambungan bukan milik company aktif; 503 bila fitur belum dikonfigurasi. Tidak memicu sync WhatsApp di AutoAudit.
  - `DELETE /admin/autoaudit/sources/{id}` → 204; hanya menghapus baris sambungan company aktif. Data impor tidak disentuh.
  - `POST /hooks/autoaudit/{token}` (publik) → 404 bila token tidak sama dengan `AUTOAUDIT_WEBHOOK_TOKEN` atau variabel itu kosong (banding dengan `hmac.compare_digest`); selain itu selalu `200 {'ok': True}`. Bila `event == 'completed'` dan `data.sales_id` berupa bilangan, isi `check_requested_at=now()` pada **semua** baris dengan `sales_id` itu di company mana pun.

Jalur `/admin/...` otomatis khusus admin platform lewat `access.required_role`, dan tetap berjalan di dalam company yang sedang dikelola admin (header `X-XM-User-Id`).

- [ ] **Step 1: Tulis tes yang gagal**

`test_admin_access.py`: tambah `('/admin/autoaudit/options', 'GET')`, `('/admin/autoaudit/sources', 'POST')`, `('/admin/autoaudit/sources/x', 'DELETE')` ke `PLATFORM_ONLY`; `('/autoaudit/sources', 'GET')` ke `MEMBER_OK`; `('/autoaudit/sources/x/sync', 'POST')` ke `COMPANY_ADMIN_ONLY`.

`test_autoaudit_routes.py` memakai `ServerTestCase` dan mem-patch `autoaudit_routes.from_env` dengan klien tiruan:

```python
def test_options_suggest_existing_agent_name(self):
    # company punya impor lama bernama 'XM Darmo Caesar'
    body = self.admin_get('/admin/autoaudit/options', company)
    self.assertEqual(body['agent_names'][0], 'XM Darmo Caesar'); self.assertEqual(body['sales'][0]['id'], 57)

def test_connect_creates_source_and_requests_first_check(self):
    row = self.admin_post('/admin/autoaudit/sources', company, {'sales_id': 57, 'agent_name': 'XM Darmo Caesar'}, expect=201)
    self.assertEqual(row['status'], 'waiting'); self.assertIsNotNone(db_value('check_requested_at', row['id']))

def test_connect_same_sales_twice_conflicts(self): ...  # 409
def test_connect_unknown_sales_is_404(self): ...
def test_company_admin_cannot_connect_but_sees_status(self): ...  # POST 403, GET /autoaudit/sources 200
def test_sources_are_isolated_per_company(self): ...  # company B tidak melihat sambungan company A
def test_disconnect_keeps_imports(self): ...  # DELETE 204, baris xm.imports tetap ada
def test_manual_sync_sets_force_and_request(self):
    self.company_admin_post(f'/autoaudit/sources/{sid}/sync', expect=202)
    self.assertTrue(db_value('force_requested', sid)); self.assertIsNotNone(db_value('check_requested_at', sid))
def test_manual_sync_of_other_company_source_is_404(self): ...
def test_member_cannot_manual_sync(self): ...  # peran user: 403
def test_not_configured_reports_false_and_blocks_connect(self): ...  # configured False, POST 503

def test_webhook_wrong_token_is_404(self): ...
def test_webhook_ignores_other_events_and_unknown_sales(self): ...  # 200, tidak ada baris berubah
def test_webhook_marks_every_company_connected_to_sales(self):
    # sales 57 tersambung di company A dan B
    self.post_public('/hooks/autoaudit/tok', {'group': 'sync', 'event': 'completed', 'data': {'sales_id': 57}})
    self.assertEqual(requested_count(57), 2)
def test_webhook_needs_no_login(self): ...  # tanpa cookie, 200
def test_responses_never_contain_key_or_token(self): ...
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd api && XM_TEST_DATABASE_URL=<db uji> python3 -m unittest test_autoaudit_routes test_admin_access -v`
Expected: FAIL (404 pada rute baru; matriks akses gagal)

- [ ] **Step 3: Implementasikan `access.is_public`, router, dan pendaftarannya di `app.py`**

`require_login` memakai `is_public(path)` menggantikan `path not in PUBLIC_PATHS`. Galat `AutoAuditError` saat mengambil daftar sales dijawab 502 dengan pesan "AutoAudit tidak dapat dihubungi".

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `cd api && XM_TEST_DATABASE_URL=<db uji> python3 -m unittest test_autoaudit_routes test_admin_access test_user_isolation -v`
Expected: PASS

---

### Task 6: Kartu "Sambungan AutoAudit"

**Files:**
- Create: `components/pages/autoaudit-card.tsx`
- Modify: `components/pages/upload-page.tsx` (render kartu di atas panel unggah), `lib/types.ts`

**Interfaces:**
- Consumes: rute Task 5; `useApi`, `useData`, `useSession` (untuk `permissions.platform`); komponen `Panel`, `Notice`, `ErrorNotice` dari `@/components/app/primitives`.
- Produces: `export function AutoAuditCard({ onImported }: { onImported: () => void })`; tipe `AutoAuditSource`, `AutoAuditSources`, `AutoAuditOptions` di `lib/types.ts` sesuai bentuk jawaban Task 5.

Perilaku:

- `configured === false`: admin platform melihat satu baris "Sambungan AutoAudit belum dikonfigurasi di server."; peran lain tidak melihat kartu.
- Daftar sambungan tampil untuk semua peran: nama sumber, chip status (Menunggu data / Menarik / Terbaru sampai `dateTime(dataset_updated_at)` / Gagal), dan `last_error` di bawahnya saat gagal.
- Hanya admin platform yang melihat form: dropdown "Sales sumber" (`nama — company`), isian "Nama sumber" yang terisi otomatis dengan `agent_names[0]` atau, bila kosong, nama sales terpilih; tombol **Sambungkan**; tombol **Putuskan** per baris dengan konfirmasi "Pembaruan otomatis dihentikan. Data yang sudah masuk tetap ada."
- Admin company dan admin platform (`permissions.upload_data`) melihat tombol **Sinkronkan sekarang** per baris. Tombol memanggil `POST /autoaudit/sources/{id}/sync`, nonaktif selama status `pulling` atau saat permintaan berjalan, lalu menampilkan "Permintaan diterima. Data yang tersedia sedang diambil."
- Selama ada sambungan berstatus `waiting` atau `pulling`, atau baru saja diminta sync manual, muat ulang tiap 5 detik dan panggil `onImported()` agar riwayat impor ikut segar.
- Galat rute ditampilkan lewat `errorMessage`.

- [ ] **Step 1: Tambah tipe dan komponen, pasang di `upload-page.tsx`** dengan `onImported={imports.reload}`

- [ ] **Step 2: Periksa tipe dan lint**

Run: `npx tsc --noEmit`
Expected: tanpa galat

- [ ] **Step 3: Periksa di browser lokal** (`http://localhost:9004`, sebagai admin platform di dalam satu company uji, lalu sebagai admin company)

Expected: admin platform melihat form dan bisa menyambungkan/memutuskan; admin company hanya melihat status; tanpa variabel environment kartu menampilkan pesan belum dikonfigurasi.

---

### Task 7: Konfigurasi, dokumentasi, dan uji menyeluruh di lokal

**Files:**
- Modify: `.env.example`, `README.md`
- Modify (lokal, tidak masuk Git): `.env.local-api`

- [ ] **Step 1: Tambah tujuh variabel ke `.env.example`** dengan nilai kosong untuk tiga rahasia dan nilai bawaan untuk empat lainnya, plus satu baris komentar tiap variabel.

- [ ] **Step 2: Tambah bagian "Sambungan AutoAudit" di `README.md`**: cara mengaktifkan, link webhook `https://<alamat>/api/hooks/autoaudit/<token>` dengan grup `sync`, catatan tunnel HTTPS untuk lokal, dan arti keempat status.

- [ ] **Step 3: Jalankan regresi penuh**

Run: `XM_TEST_DATABASE_URL=<db uji> python3 -m unittest discover -s api -p 'test_*.py'`
Expected: semua lulus, tidak ada tes lama yang berubah hasil.

- [ ] **Step 4: Uji lokal dengan API nyata** (butuh izin pengguna; hanya membaca dari AutoAudit)

1. Isi `.env.local-api`, jalankan ulang API dan worker.
2. Di company uji kosong, sambungkan satu sales. Expected: status Menarik → impor antre bermunculan → Terbaru sampai ….
3. Sambungkan ulang setelah diputus. Expected: tidak ada listing baru.
4. `curl -X POST http://127.0.0.1:8100/hooks/autoaudit/<token> -H 'Content-Type: application/json' -d '{"group":"sync","event":"completed","data":{"sales_id":<id>}}'`. Expected: `{"ok":true}`, dan dalam beberapa detik `last_checked_at` berubah.
5. Klik **Sinkronkan sekarang** saat status sudah Terbaru. Expected: status Menarik lalu Terbaru lagi, tanpa listing baru.
6. Ubah `AUTOAUDIT_BASE_URL` ke alamat yang salah, jalankan ulang worker. Expected: status Gagal dengan pesan; setelah alamat dibetulkan, pulih pada cek berikutnya.

- [ ] **Step 5: Laporkan hasil ke pengguna.** Pemasangan langganan webhook di AutoAudit produksi dan pengisian `.env` produksi dilakukan pengguna.

