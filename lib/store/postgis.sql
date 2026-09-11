-- PostGIS schema for AEGIS geospatial tables. Mirrors the logical tables in lib/store/db.mjs.
-- Apply with: psql "$DATABASE_URL" -f lib/store/postgis.sql
-- Load with: node scripts/export-postgis.mjs | psql "$DATABASE_URL"
-- Geometry column SRID is 4326 (WGS 84, longitude/latitude order in GeoJSON transport).
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS catchments (
  id text PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL,
  region_group text NOT NULL,
  hybas_id bigint NOT NULL UNIQUE,
  pfaf_id bigint NOT NULL,
  level smallint NOT NULL,
  next_down bigint,
  main_basin bigint NOT NULL,
  sub_area_km2 double precision NOT NULL,
  upstream_area_km2 double precision NOT NULL,
  edition text NOT NULL,             -- e.g. 'HydroBASINS v1.c (level 8, Asia, 2014 release)'
  source_sha1 text NOT NULL,
  license_url text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  seed_point geometry(Point, 4326) NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS catchments_geom_idx ON catchments USING GIST (geom);

CREATE TABLE IF NOT EXISTS river_reaches (
  hyriv_id bigint PRIMARY KEY,
  catchment_id text NOT NULL REFERENCES catchments(id),
  next_down bigint,
  main_river bigint,
  length_km double precision,
  upland_km2 double precision,
  mean_discharge_m3s double precision,   -- long-term modelled mean, not a gauge
  strahler_order smallint,
  edition text NOT NULL,
  geom geometry(MultiLineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS river_reaches_geom_idx ON river_reaches USING GIST (geom);
CREATE INDEX IF NOT EXISTS river_reaches_catchment_idx ON river_reaches (catchment_id);

CREATE TABLE IF NOT EXISTS forecast_runs (
  id uuid PRIMARY KEY,
  catchment_id text NOT NULL REFERENCES catchments(id),
  provider text NOT NULL,
  model text NOT NULL,
  issued_at timestamptz,
  retrieved_at timestamptz NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  native_resolution text,
  step_seconds integer,
  license text,
  payload jsonb NOT NULL              -- archived provider response before any resampling
);
CREATE INDEX IF NOT EXISTS forecast_runs_lookup ON forecast_runs (catchment_id, model, issued_at DESC);

CREATE TABLE IF NOT EXISTS scenarios (
  id text PRIMARY KEY,
  namespace text NOT NULL CHECK (namespace = 'research-scenario'),
  catchment_id text NOT NULL REFERENCES catchments(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  channel text NOT NULL,
  address text NOT NULL,              -- protect at rest; never log
  address_hash text NOT NULL,
  language text NOT NULL,
  catchment_id text NOT NULL REFERENCES catchments(id),
  status text NOT NULL,
  consent_text_version text NOT NULL,
  consent_recorded_at timestamptz NOT NULL,
  verification_code_hash text,
  verification_expires_at timestamptz,
  verified_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  UNIQUE (channel, address_hash, catchment_id)
);

CREATE TABLE IF NOT EXISTS advisories (
  id text PRIMARY KEY,
  catchment_id text NOT NULL REFERENCES catchments(id),
  status text NOT NULL,
  authority text NOT NULL,
  template_id text NOT NULL,
  template_version text NOT NULL,
  issued_at timestamptz,
  expires_at timestamptz,
  affected_area text NOT NULL,
  recommended_action text NOT NULL,
  official_link text NOT NULL,
  supersedes text REFERENCES advisories(id),
  approved_by text,
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id text PRIMARY KEY,
  advisory_id text NOT NULL REFERENCES advisories(id),
  subscription_id text NOT NULL REFERENCES subscriptions(id),
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL,
  provider text,
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  actor text,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text,
  request_id text,
  details jsonb
);

CREATE TABLE IF NOT EXISTS model_releases (
  version text PRIMARY KEY,
  released_at timestamptz NOT NULL,
  status text NOT NULL,
  card_path text,
  metrics_path text,
  notes text
);
