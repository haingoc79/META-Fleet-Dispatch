PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  service_date TEXT NOT NULL,
  branch TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  cod_required INTEGER NOT NULL DEFAULT 1,
  cod_amount_due_vnd INTEGER NOT NULL DEFAULT 0,
  cod_status TEXT NOT NULL DEFAULT 'due',
  cod_source TEXT NOT NULL DEFAULT 'product_unit_cost_sum',
  assigned_driver_id INTEGER,
  assignment_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  execution_state TEXT NOT NULL DEFAULT 'at_depot',
  execution_version INTEGER NOT NULL DEFAULT 0,
  custody_holder TEXT NOT NULL DEFAULT 'DEPOT',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch,id);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON orders(assigned_driver_id);
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY,
  branch TEXT NOT NULL,
  group_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  roster_status TEXT NOT NULL DEFAULT 'active_unverified',
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drivers_branch ON drivers(branch,group_name);
CREATE TABLE IF NOT EXISTS assignment_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
  reason TEXT NOT NULL, before_driver_id INTEGER, after_driver_id INTEGER, before_version INTEGER NOT NULL,
  after_version INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custody_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, event_type TEXT NOT NULL, actor TEXT NOT NULL,
  reason TEXT, from_holder TEXT NOT NULL, to_holder TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
  before_version INTEGER NOT NULL, after_version INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cod_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, event_type TEXT NOT NULL, amount_vnd INTEGER NOT NULL,
  actor TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_results (
  idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, delivery_state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS dispatch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, scope_json TEXT NOT NULL, algorithm_version TEXT NOT NULL,
  status TEXT NOT NULL, input_count INTEGER NOT NULL, proposal_count INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatch_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, order_id INTEGER NOT NULL, driver_id INTEGER NOT NULL,
  vehicle_id TEXT NOT NULL, vehicle_type TEXT NOT NULL, route_id TEXT NOT NULL, trip_index INTEGER NOT NULL, sequence_no INTEGER NOT NULL,
  planned_arrival TEXT, planned_departure TEXT, feasibility_status TEXT NOT NULL, reason TEXT NOT NULL, score_json TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(run_id,order_id)
);
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, actor TEXT NOT NULL, service_date TEXT,
  order_count INTEGER NOT NULL, product_row_count INTEGER NOT NULL, driver_count INTEGER NOT NULL, created_at TEXT NOT NULL
);
