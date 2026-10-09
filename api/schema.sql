CREATE SCHEMA IF NOT EXISTS xm;

CREATE TABLE IF NOT EXISTS xm.users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS xm.sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES xm.users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON xm.sessions(expires_at);

CREATE TABLE IF NOT EXISTS xm.user_preferences (
    user_id uuid PRIMARY KEY REFERENCES xm.users(id) ON DELETE CASCADE,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS xm.imports (
    id uuid PRIMARY KEY,
    company_id text NOT NULL DEFAULT 'xm',
    agent_name text NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_sha256 text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    total_messages integer NOT NULL DEFAULT 0,
    processed_messages integer NOT NULL DEFAULT 0,
    request_count integer NOT NULL DEFAULT 0,
    listing_count integer NOT NULL DEFAULT 0,
    ignored_count integer NOT NULL DEFAULT 0,
    duplicate_count integer NOT NULL DEFAULT 0,
    qdrant_points integer NOT NULL DEFAULT 0,
    error text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, agent_name, file_sha256)
);

CREATE TABLE IF NOT EXISTS xm.raw_messages (
    id uuid PRIMARY KEY,
    company_id text NOT NULL DEFAULT 'xm',
    agent_name text NOT NULL,
    import_id uuid NOT NULL REFERENCES xm.imports(id) ON DELETE CASCADE,
    chat_id text NOT NULL,
    chat_name text NOT NULL,
    is_group boolean NOT NULL DEFAULT false,
    message_position integer NOT NULL,
    sent_at timestamp,
    author text,
    raw_text text NOT NULL,
    message_hash text NOT NULL,
    classification text NOT NULL,
    confidence numeric(5,4) NOT NULL DEFAULT 0,
    duplicate_of uuid,
    extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(import_id, chat_id, message_position)
);

CREATE INDEX IF NOT EXISTS raw_messages_import_idx ON xm.raw_messages(import_id);
CREATE INDEX IF NOT EXISTS raw_messages_classification_idx ON xm.raw_messages(company_id, classification);
CREATE INDEX IF NOT EXISTS raw_messages_hash_idx ON xm.raw_messages(company_id, message_hash);
CREATE INDEX IF NOT EXISTS raw_messages_text_group_idx ON xm.raw_messages(company_id, md5(raw_text));

CREATE TABLE IF NOT EXISTS xm.documents (
    id uuid PRIMARY KEY,
    company_id text NOT NULL DEFAULT 'xm',
    agent_name text NOT NULL,
    raw_message_id uuid NOT NULL REFERENCES xm.raw_messages(id) ON DELETE CASCADE,
    import_id uuid NOT NULL REFERENCES xm.imports(id) ON DELETE CASCADE,
    document_type text NOT NULL CHECK (document_type IN ('buyer_request', 'property_listing')),
    transaction_type text NOT NULL DEFAULT 'unknown',
    categories text[] NOT NULL DEFAULT '{}',
    primary_category text,
    locations text[] NOT NULL DEFAULT '{}',
    land_area_min numeric,
    land_area_max numeric,
    building_area_min numeric,
    building_area_max numeric,
    price_min bigint,
    price_max bigint,
    price_basis text,
    negotiable boolean NOT NULL DEFAULT false,
    facing text[] NOT NULL DEFAULT '{}',
    exclusions text[] NOT NULL DEFAULT '{}',
    requirements text[] NOT NULL DEFAULT '{}',
    contact_name text,
    contact_phone text,
    normalized_text text NOT NULL,
    extraction_confidence numeric(5,4) NOT NULL DEFAULT 0,
    review_status text NOT NULL DEFAULT 'auto',
    active boolean NOT NULL DEFAULT true,
    qdrant_point_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_type_idx ON xm.documents(company_id, document_type, active);
CREATE INDEX IF NOT EXISTS documents_category_idx ON xm.documents USING gin(categories);
CREATE INDEX IF NOT EXISTS documents_locations_idx ON xm.documents USING gin(locations);
CREATE INDEX IF NOT EXISTS documents_import_idx ON xm.documents(import_id);

CREATE OR REPLACE VIEW xm.buyer_requests AS
SELECT * FROM xm.documents WHERE document_type = 'buyer_request';

CREATE OR REPLACE VIEW xm.property_listings AS
SELECT * FROM xm.documents WHERE document_type = 'property_listing';

CREATE TABLE IF NOT EXISTS xm.match_settings (
    company_id text PRIMARY KEY,
    land_tolerance_pct numeric NOT NULL DEFAULT 10,
    building_tolerance_pct numeric NOT NULL DEFAULT 20,
    price_tolerance_pct numeric NOT NULL DEFAULT 10,
    location_radius_km numeric NOT NULL DEFAULT 3,
    location_extended_radius_km numeric NOT NULL DEFAULT 5,
    location_weight_pct numeric NOT NULL DEFAULT 35,
    land_weight_pct numeric NOT NULL DEFAULT 20,
    building_weight_pct numeric NOT NULL DEFAULT 15,
    price_weight_pct numeric NOT NULL DEFAULT 20,
    semantic_weight_pct numeric NOT NULL DEFAULT 5,
    data_quality_weight_pct numeric NOT NULL DEFAULT 5,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO xm.match_settings(company_id)
VALUES ('xm') ON CONFLICT (company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS xm.matches (
    id uuid PRIMARY KEY,
    company_id text NOT NULL DEFAULT 'xm',
    buyer_request_id uuid NOT NULL REFERENCES xm.documents(id) ON DELETE CASCADE,
    property_listing_id uuid NOT NULL REFERENCES xm.documents(id) ON DELETE CASCADE,
    score numeric(6,2) NOT NULL,
    location_score numeric(6,2) NOT NULL DEFAULT 0,
    land_score numeric(6,2) NOT NULL DEFAULT 0,
    building_score numeric(6,2) NOT NULL DEFAULT 0,
    price_score numeric(6,2) NOT NULL DEFAULT 0,
    semantic_score numeric(6,2) NOT NULL DEFAULT 0,
    explanation jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(company_id, buyer_request_id, property_listing_id)
);

CREATE INDEX IF NOT EXISTS matches_buyer_score_idx ON xm.matches(company_id, buyer_request_id, score DESC);
CREATE INDEX IF NOT EXISTS matches_score_idx ON xm.matches(company_id, score DESC);
CREATE INDEX IF NOT EXISTS matches_listing_idx ON xm.matches(property_listing_id);

CREATE TABLE IF NOT EXISTS xm.audit_events (
    id bigserial PRIMARY KEY,
    company_id text NOT NULL DEFAULT 'xm',
    event_type text NOT NULL,
    entity_type text,
    entity_id text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS xm.glossary (
  alias text PRIMARY KEY, canonical text NOT NULL
);
CREATE TABLE IF NOT EXISTS xm.location_indexes (
 company_id text PRIMARY KEY,
 data jsonb NOT NULL DEFAULT '{"clusters":[],"edges":[]}'::jsonb,
 sources jsonb NOT NULL DEFAULT '[]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xm.glossary ADD COLUMN IF NOT EXISTS company_id text NOT NULL DEFAULT 'xm';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='xm.glossary'::regclass AND contype='p' AND array_length(conkey,1)=1) THEN
  ALTER TABLE xm.glossary DROP CONSTRAINT glossary_pkey;
  ALTER TABLE xm.glossary ADD PRIMARY KEY(company_id,alias);
 END IF;
END $$;
INSERT INTO xm.glossary(company_id, alias, canonical) VALUES
('xm','regensi','regency'),('xm','rgcy','regency'),('xm','nashos','national hospital'),('xm','nathos','national hospital')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS xm.maintenance_jobs (
 id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'queued', result jsonb, error text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
ALTER TABLE xm.maintenance_jobs ADD COLUMN IF NOT EXISTS company_id text NOT NULL DEFAULT 'xm';
DROP INDEX IF EXISTS xm.maintenance_one_running;
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_one_running_per_workspace ON xm.maintenance_jobs(company_id) WHERE status IN ('queued','processing');

ALTER TABLE xm.documents ADD COLUMN IF NOT EXISTS contact_phones text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS documents_recent_idx ON xm.documents(company_id,created_at DESC) WHERE active;

ALTER TABLE xm.match_settings ADD COLUMN IF NOT EXISTS location_weight_pct numeric NOT NULL DEFAULT 35;
ALTER TABLE xm.match_settings ADD COLUMN IF NOT EXISTS land_weight_pct numeric NOT NULL DEFAULT 20;
ALTER TABLE xm.match_settings ADD COLUMN IF NOT EXISTS building_weight_pct numeric NOT NULL DEFAULT 15;
ALTER TABLE xm.match_settings ADD COLUMN IF NOT EXISTS price_weight_pct numeric NOT NULL DEFAULT 20;
ALTER TABLE xm.match_settings ADD COLUMN IF NOT EXISTS semantic_weight_pct numeric NOT NULL DEFAULT 5;
ALTER TABLE xm.match_settings ADD COLUMN IF NOT EXISTS data_quality_weight_pct numeric NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS xm.document_groups (
 group_id uuid PRIMARY KEY, company_id text NOT NULL, document_type text NOT NULL,
 duplicate_count bigint NOT NULL, last_seen_at timestamp,
 hot_count bigint NOT NULL DEFAULT 0,warm_count bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS document_groups_kind_idx ON xm.document_groups(company_id,document_type,last_seen_at DESC);
CREATE TABLE IF NOT EXISTS xm.document_group_members (
 document_id uuid PRIMARY KEY,group_id uuid NOT NULL,company_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS group_members_group_idx ON xm.document_group_members(group_id);
CREATE TABLE IF NOT EXISTS xm.group_matches (
 company_id text NOT NULL,buyer_group_id uuid NOT NULL,property_group_id uuid NOT NULL,
 match_id uuid NOT NULL,score numeric NOT NULL,
 PRIMARY KEY(buyer_group_id,property_group_id)
);
CREATE INDEX IF NOT EXISTS group_matches_property_idx ON xm.group_matches(property_group_id,score DESC);
CREATE TABLE IF NOT EXISTS xm.workspace_cache_state(company_id text PRIMARY KEY,refreshed_at timestamptz NOT NULL);


ALTER TABLE xm.users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));
ALTER TABLE xm.users ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS xm.app_preferences (
 company_id text PRIMARY KEY,
 search_terms text[] NOT NULL DEFAULT ARRAY['XM Darmo'],
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO xm.app_preferences(company_id, search_terms)
SELECT 'xm', ARRAY[coalesce((SELECT nullif(trim(p.preferences->>'default_search'),'')
 FROM xm.user_preferences p JOIN xm.users u ON u.id=p.user_id
 WHERE u.email='admin@autoaudit.id'), 'XM Darmo')]
ON CONFLICT (company_id) DO NOTHING;


-- Preserve legacy rows under 'xm' (admin); new inserts inherit the trusted scope.
ALTER TABLE xm.users ADD COLUMN IF NOT EXISTS workspace_id text UNIQUE;
ALTER TABLE xm.imports ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
ALTER TABLE xm.raw_messages ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
ALTER TABLE xm.documents ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
ALTER TABLE xm.matches ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
ALTER TABLE xm.audit_events ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
ALTER TABLE xm.glossary ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
ALTER TABLE xm.maintenance_jobs ALTER COLUMN company_id SET DEFAULT current_setting('xm.workspace_id');
CREATE INDEX IF NOT EXISTS maintenance_workspace_recent_idx ON xm.maintenance_jobs(company_id,created_at DESC);


-- ============================================================================
-- v4.0: companies with several accounts, public IDs, listing/buyer status,
-- recent-match history, tracked-sales stock log and company settings.
-- Everything below is idempotent and DDL-only (data backfill lives in
-- entities.migrate_v4 so that startup stays fast and restartable).
-- ============================================================================

-- Several accounts may share one company workspace. Roles: 'admin' (platform
-- administrator), 'company_admin' (super admin of one company), 'user' (member).
ALTER TABLE xm.users DROP CONSTRAINT IF EXISTS users_workspace_id_key;
CREATE INDEX IF NOT EXISTS users_workspace_idx ON xm.users(workspace_id);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='xm.users'::regclass AND conname='users_role_check'
            AND pg_get_constraintdef(oid) NOT LIKE '%company_admin%') THEN
  ALTER TABLE xm.users DROP CONSTRAINT users_role_check;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='xm.users'::regclass AND conname='users_role_check') THEN
  ALTER TABLE xm.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','company_admin','user'));
 END IF;
END $$;

-- Company-level settings live in the existing per-workspace preferences row.
ALTER TABLE xm.app_preferences ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE xm.app_preferences ADD COLUMN IF NOT EXISTS search_locked boolean NOT NULL DEFAULT false;
ALTER TABLE xm.app_preferences ADD COLUMN IF NOT EXISTS listing_group_by text NOT NULL DEFAULT 'sender';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='xm.app_preferences'::regclass AND conname='app_preferences_group_by_check') THEN
  ALTER TABLE xm.app_preferences ADD CONSTRAINT app_preferences_group_by_check CHECK (listing_group_by IN ('sender','phone'));
 END IF;
END $$;

-- Human-friendly public IDs: L-AB908 / B-AB908. Letters skip I and O so they
-- cannot be confused with 1 and 0; the letter block grows (AA..ZZ, AAA..ZZZ,
-- ...) while the three digits roll over, so the sequence never runs out.
CREATE OR REPLACE FUNCTION xm.public_id(prefix text, seq bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  base constant bigint := 24;
  blk bigint := seq / 1000;
  digits int := (seq % 1000)::int;
  width int := 2;
  span bigint := 576;
  letters text := '';
BEGIN
  WHILE blk >= span LOOP
    blk := blk - span;
    width := width + 1;
    span := span * base;
  END LOOP;
  FOR i IN 1..width LOOP
    letters := substr(alphabet, (blk % base)::int + 1, 1) || letters;
    blk := blk / base;
  END LOOP;
  RETURN prefix || '-' || letters || lpad(digits::text, 3, '0');
END $$;

CREATE TABLE IF NOT EXISTS xm.entity_counters (
 company_id text NOT NULL,
 document_type text NOT NULL,
 next_seq bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (company_id, document_type)
);

-- One entity = one unique complete message text per company and kind. It is
-- what a card represents in the UI and what keeps its ID and status when the
-- matching tables are rebuilt.
CREATE TABLE IF NOT EXISTS xm.entities (
 entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id text NOT NULL DEFAULT current_setting('xm.workspace_id'),
 document_type text NOT NULL CHECK (document_type IN ('buyer_request','property_listing')),
 text_hash text NOT NULL,
 seq bigint NOT NULL,
 public_id text NOT NULL,
 status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','on_hold','sold','deleted')),
 status_note text,
 status_changed_at timestamptz,
 status_changed_by uuid,
 first_seen_at timestamp,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (company_id, document_type, text_hash),
 UNIQUE (company_id, document_type, seq),
 UNIQUE (company_id, public_id)
);
CREATE INDEX IF NOT EXISTS entities_status_idx ON xm.entities(company_id, document_type, status);

ALTER TABLE xm.documents ADD COLUMN IF NOT EXISTS entity_id uuid;
CREATE INDEX IF NOT EXISTS documents_entity_idx ON xm.documents(entity_id);
CREATE INDEX IF NOT EXISTS documents_unassigned_idx ON xm.documents(company_id) WHERE entity_id IS NULL AND active;
CREATE INDEX IF NOT EXISTS documents_contact_phones_idx ON xm.documents USING gin(contact_phones);
CREATE INDEX IF NOT EXISTS documents_contact_phone_idx ON xm.documents(company_id, contact_phone) WHERE contact_phone IS NOT NULL;

ALTER TABLE xm.document_groups ADD COLUMN IF NOT EXISTS entity_id uuid;
ALTER TABLE xm.document_groups ADD COLUMN IF NOT EXISTS public_id text;
ALTER TABLE xm.document_groups ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
CREATE INDEX IF NOT EXISTS document_groups_status_idx ON xm.document_groups(company_id, document_type, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS document_groups_entity_idx ON xm.document_groups(entity_id);
CREATE INDEX IF NOT EXISTS document_groups_public_idx ON xm.document_groups(company_id, public_id);

-- History of buyer/listing pairs. 'import' rows are what "Match terbaru" shows;
-- 'baseline' marks pairs that already existed before this feature or before a
-- settings-driven recompute, so they are never announced as new.
CREATE TABLE IF NOT EXISTS xm.match_events (
 id bigserial PRIMARY KEY,
 company_id text NOT NULL DEFAULT current_setting('xm.workspace_id'),
 buyer_entity uuid NOT NULL,
 listing_entity uuid NOT NULL,
 first_score numeric(6,2) NOT NULL,
 last_score numeric(6,2) NOT NULL,
 temperature text NOT NULL CHECK (temperature IN ('hot','warm')),
 source text NOT NULL CHECK (source IN ('import','recompute','baseline')),
 import_id uuid,
 agent_name text,
 active boolean NOT NULL DEFAULT true,
 found_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 hot_at timestamptz,
 last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (company_id, buyer_entity, listing_entity)
);
CREATE INDEX IF NOT EXISTS match_events_found_idx ON xm.match_events(company_id, found_at DESC) WHERE source='import';
CREATE INDEX IF NOT EXISTS match_events_buyer_idx ON xm.match_events(company_id, buyer_entity);
CREATE INDEX IF NOT EXISTS match_events_listing_idx ON xm.match_events(company_id, listing_entity);
CREATE INDEX IF NOT EXISTS match_events_import_idx ON xm.match_events(import_id) WHERE import_id IS NOT NULL;

-- Sales phone numbers a company wants to monitor, and the automatic stock log.
CREATE TABLE IF NOT EXISTS xm.tracked_sales (
 company_id text NOT NULL DEFAULT current_setting('xm.workspace_id'),
 phone text NOT NULL,
 label text,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid,
 PRIMARY KEY (company_id, phone)
);
CREATE TABLE IF NOT EXISTS xm.stock_log (
 id bigserial PRIMARY KEY,
 company_id text NOT NULL DEFAULT current_setting('xm.workspace_id'),
 phone text NOT NULL,
 logged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 event_type text NOT NULL CHECK (event_type IN ('import','status','manual','tracking')),
 import_id uuid,
 agent_name text,
 total integer NOT NULL,
 ready integer NOT NULL,
 on_hold integer NOT NULL,
 sold integer NOT NULL,
 deleted integer NOT NULL,
 delta_total integer NOT NULL DEFAULT 0,
 delta_ready integer NOT NULL DEFAULT 0,
 note text
);
CREATE INDEX IF NOT EXISTS stock_log_phone_idx ON xm.stock_log(company_id, phone, logged_at DESC);
CREATE INDEX IF NOT EXISTS stock_log_time_idx ON xm.stock_log(company_id, logged_at DESC);


-- Backend-only workflow integration. Raw API keys are never stored.
CREATE TABLE IF NOT EXISTS xm.integration_keys (
 id uuid PRIMARY KEY,
 company_id text NOT NULL,
 created_by uuid NOT NULL REFERENCES xm.users(id) ON DELETE CASCADE,
 name text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS integration_keys_company_idx ON xm.integration_keys(company_id);
CREATE TABLE IF NOT EXISTS xm.export_jobs (
 id uuid PRIMARY KEY,
 company_id text NOT NULL,
 request_id text NOT NULL,
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled','expired')),
 progress jsonb NOT NULL DEFAULT '{}'::jsonb,
 files jsonb NOT NULL DEFAULT '[]'::jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 expires_at timestamptz,
 UNIQUE(company_id, request_id)
);
CREATE INDEX IF NOT EXISTS export_jobs_pending_idx ON xm.export_jobs(created_at) WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS export_jobs_company_idx ON xm.export_jobs(company_id, created_at DESC);
