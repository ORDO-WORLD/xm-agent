export type Role = 'admin' | 'company_admin' | 'user';
export type EntityStatus = 'ready' | 'on_hold' | 'sold' | 'deleted';
export type Direction = 'buyer' | 'property';
export type Temperature = 'hot' | 'warm';
export type MatchFilter = 'hot' | 'warm' | 'unmatched';
export type GroupBy = 'sender' | 'phone';
export type MatchingMode = 'company' | 'sales';
export type ImportStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_locked: boolean;
  company_name?: string | null;
  workspace_id?: string | null;
};

export type Permissions = {
  platform: boolean;
  manage_team: boolean;
  manage_settings: boolean;
  upload_data: boolean;
  edit_company_search: boolean;
  edit_personal_search: boolean;
  mark_status: boolean;
};

export type CompanySettings = {
  company_name: string | null;
  listing_group_by: GroupBy;
  matching_mode: MatchingMode;
  search_locked: boolean;
  search_terms: string[];
  personal_terms: string[] | null;
  effective_terms: string[];
  tracked_phones: string[];
  role: Role;
  permissions: Permissions;
};

/** A buyer or listing card: one unique text, with every posting folded into it. */
export type Row = {
  id: string;
  entity_id?: string;
  public_id?: string;
  entity_status?: EntityStatus;
  document_type?: 'buyer_request' | 'property_listing';
  raw_text: string;
  normalized_text: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_phones?: string[];
  author?: string | null;
  chat_name?: string | null;
  transaction_type?: string;
  locations: string[];
  categories: string[];
  land_area_min?: number | null;
  land_area_max?: number | null;
  building_area_min?: number | null;
  building_area_max?: number | null;
  price_min?: number | null;
  price_max?: number | null;
  price_basis?: string | null;
  sent_at?: string | null;
  last_seen_at?: string | null;
  hot_count?: number;
  warm_count?: number;
  match_count?: number;
  duplicate_count?: number;
  score?: number;
  explanation?: string[];
};

export type Group = { source: Row; recommendations: Row[] };

export type RowGroupSummary = {
  key: string;
  count: number;
  hot: number;
  warm: number;
  latest_at: string | null;
  contact_name: string | null;
  sender_count: number;
};

export type RecentMatch = {
  event_id: number;
  found_at: string;
  score: number;
  temperature: Temperature;
  import_id: string | null;
  agent_name: string | null;
  upgraded_to_hot: boolean;
  target: Row;
};

export type RecentGroup = {
  source: Row;
  latest_found_at: string;
  pair_count: number;
  hot_count: number;
  warm_count: number;
  matches: RecentMatch[];
};

export type RecentResponse = {
  direction: Direction;
  date_from: string;
  date_to: string;
  totals: { pairs: number; hot: number; warm: number };
  groups: RecentGroup[];
  has_more: boolean;
};

export type ImportRow = {
  id: string;
  agent_name: string;
  file_name: string;
  matching_mode?: MatchingMode | null;
  status: ImportStatus;
  total_messages: number;
  processed_messages: number;
  request_count: number;
  listing_count: number;
  ignored_count: number;
  duplicate_count: number;
  error?: string | null;
  created_at: string;
  finished_at?: string | null;
  new_matches: number;
  new_hot: number;
  new_warm: number;
};

export type StockTracked = {
  phone: string;
  label: string | null;
  contact_name: string | null;
  counts: { ready: number; on_hold: number; sold: number; deleted: number; total: number };
  new_7d: number;
  last_posted_at: string | null;
  history: { at: string; ready: number; total: number }[];
  tracked_since: string;
};

export type StockOverview = {
  tracked: StockTracked[];
  totals: { ready: number; on_hold: number; sold: number; deleted: number; total: number };
  last_logged_at: string | null;
  max_tracked: number;
};

export type StockLogRow = {
  id: number;
  phone: string;
  logged_at: string;
  event_type: 'import' | 'status' | 'manual' | 'tracking';
  import_id: string | null;
  agent_name: string | null;
  total: number;
  ready: number;
  on_hold: number;
  sold: number;
  deleted: number;
  delta_total: number;
  delta_ready: number;
  note: string | null;
  label: string | null;
};

export type TeamMember = {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_locked: boolean;
  created_at: string;
  editable: boolean;
  is_self: boolean;
};

export type CompanySummary = {
  company_id: string;
  name: string;
  company_name: string | null;
  owner_id: string | null;
  buyers: number;
  listings: number;
  search_locked: boolean;
  listing_group_by: GroupBy;
  users: { id: string; email: string; display_name: string; role: Role; is_locked: boolean; created_at: string }[];
};

export type DeployStatus = { enabled: false } | {
  enabled: true;
  status: 'idle' | 'running' | 'success' | 'failed';
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  commit: { sha: string; subject: string; date: string } | null;
  log: string;
};

export type Dashboard = {
  period: { key: string; label: string; date_from: string; date_to: string; compare_from: string; compare_to: string; days: number; bucket: 'day' | 'week'; in_future: boolean };
  latest_data_date: string | null;
  quick: { this_week: number; this_month: number };
  kpi: {
    buyers: number; listings: number; buyers_prev: number; listings_prev: number;
    buyers_change: number | null; listings_change: number | null;
    matches: number; matches_hot: number; matches_prev: number; matches_change: number | null;
  };
  trend: { labels: string[]; buyers: number[]; listings: number[]; matches: number[]; matches_hot: number[] };
  categories: { key: string; label: string; value: number }[];
  transactions: { key: string; label: string; value: number }[];
  locations: { label: string; value: number; stock: number }[];
  budget: { labels: string[]; sale: number[]; rent: number[]; skipped: number };
  gap_categories: { key: string; label: string; buyers: number; listings: number; pressure: number }[];
  gap_locations: { key: string; label: string; buyers: number; listings: number; pressure: number }[];
  status: { buyer: Record<EntityStatus, number>; listing: Record<EntityStatus, number> };
  top_sales: { group_by: GroupBy; rows: { key: string; label: string; contact_name: string | null; value: number }[] };
  matches: { total: number; hot: number; warm: number };
  insights: string[];
};

export type Stats = {
  raw_messages: number;
  buyer_requests: number;
  listings: number;
  buyers_ready: number;
  listings_ready: number;
};
