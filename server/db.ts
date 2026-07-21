import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function ensureDatabaseCompatibility() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid varchar NOT NULL COLLATE "default",
      sess json NOT NULL,
      expire timestamp(6) NOT NULL,
      CONSTRAINT user_sessions_pkey PRIMARY KEY (sid)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire"
      ON user_sessions (expire);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      user_id integer,
      staff_id integer,
      type text NOT NULL DEFAULT 'general',
      severity text NOT NULL DEFAULT 'info',
      source_module text NOT NULL DEFAULT 'system',
      title text NOT NULL,
      message text NOT NULL,
      action_url text,
      entity_type text,
      entity_id integer,
      dedupe_key text,
      metadata text,
      scheduled_for timestamp DEFAULT now(),
      delivered_at timestamp DEFAULT now(),
      read_at timestamp,
      cancelled_at timestamp,
      whatsapp_status text NOT NULL DEFAULT 'pending',
      whatsapp_attempts integer NOT NULL DEFAULT 0,
      whatsapp_sent_at timestamp,
      whatsapp_message_id text,
      whatsapp_error text,
      push_status text NOT NULL DEFAULT 'pending',
      push_attempts integer NOT NULL DEFAULT 0,
      push_sent_at timestamp,
      push_error text,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS notifications
      ADD COLUMN IF NOT EXISTS organization_id integer,
      ADD COLUMN IF NOT EXISTS user_id integer,
      ADD COLUMN IF NOT EXISTS staff_id integer,
      ADD COLUMN IF NOT EXISTS type text DEFAULT 'general',
      ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info',
      ADD COLUMN IF NOT EXISTS source_module text DEFAULT 'system',
      ADD COLUMN IF NOT EXISTS title text,
      ADD COLUMN IF NOT EXISTS message text,
      ADD COLUMN IF NOT EXISTS action_url text,
      ADD COLUMN IF NOT EXISTS entity_type text,
      ADD COLUMN IF NOT EXISTS entity_id integer,
      ADD COLUMN IF NOT EXISTS dedupe_key text,
      ADD COLUMN IF NOT EXISTS metadata text,
      ADD COLUMN IF NOT EXISTS scheduled_for timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS delivered_at timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS read_at timestamp,
      ADD COLUMN IF NOT EXISTS cancelled_at timestamp,
      ADD COLUMN IF NOT EXISTS whatsapp_status text DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS whatsapp_attempts integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamp,
      ADD COLUMN IF NOT EXISTS whatsapp_message_id text,
      ADD COLUMN IF NOT EXISTS whatsapp_error text,
      ADD COLUMN IF NOT EXISTS push_status text DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS push_attempts integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS push_sent_at timestamp,
      ADD COLUMN IF NOT EXISTS push_error text,
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
  `);

  await pool.query(`
    UPDATE notifications
    SET whatsapp_status = COALESCE(NULLIF(whatsapp_status, ''), 'pending'),
        whatsapp_attempts = COALESCE(whatsapp_attempts, 0),
        push_status = COALESCE(NULLIF(push_status, ''), 'pending'),
        push_attempts = COALESCE(push_attempts, 0)
    WHERE whatsapp_status IS NULL
       OR whatsapp_status = ''
       OR whatsapp_attempts IS NULL
       OR push_status IS NULL
       OR push_status = ''
       OR push_attempts IS NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS notifications_org_user_read_idx
      ON notifications (organization_id, user_id, read_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS notifications_org_created_idx
      ON notifications (organization_id, created_at);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_org_user_dedupe_unique
      ON notifications (organization_id, user_id, dedupe_key);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      user_id integer NOT NULL,
      endpoint text NOT NULL,
      p256dh text NOT NULL,
      auth text NOT NULL,
      user_agent text,
      active boolean NOT NULL DEFAULT true,
      last_seen_at timestamp DEFAULT now(),
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS push_subscriptions
      ADD COLUMN IF NOT EXISTS organization_id integer,
      ADD COLUMN IF NOT EXISTS user_id integer,
      ADD COLUMN IF NOT EXISTS endpoint text,
      ADD COLUMN IF NOT EXISTS p256dh text,
      ADD COLUMN IF NOT EXISTS auth text,
      ADD COLUMN IF NOT EXISTS user_agent text,
      ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
      ADD COLUMN IF NOT EXISTS last_seen_at timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
  `);

  await pool.query(`
    UPDATE push_subscriptions
    SET active = COALESCE(active, true),
        last_seen_at = COALESCE(last_seen_at, now()),
        updated_at = COALESCE(updated_at, now())
    WHERE active IS NULL
       OR last_seen_at IS NULL
       OR updated_at IS NULL;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
      ON push_subscriptions (endpoint);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS push_subscriptions_org_user_active_idx
      ON push_subscriptions (organization_id, user_id, active);
  `);

  await pool.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
  `);

  await pool.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
  `);

  await pool.query(`
    UPDATE organizations
    SET status = CASE
      WHEN COALESCE(active, true) = true THEN 'active'
      ELSE 'inactive'
    END
    WHERE status IS NULL OR btrim(status) = '';
  `);

  await pool.query(`
    UPDATE organizations
    SET active = CASE
      WHEN status = 'active' THEN true
      ELSE false
    END
    WHERE active IS NULL;
  `);

  await pool.query(`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS work_schedule text;
  `);

  await pool.query(`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS employment_type text DEFAULT 'clt',
      ADD COLUMN IF NOT EXISTS cpf text,
      ADD COLUMN IF NOT EXISTS cnpj text,
      ADD COLUMN IF NOT EXISTS shift_value real DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bonus_value real DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bonus_notes text,
      ADD COLUMN IF NOT EXISTS bank_name text,
      ADD COLUMN IF NOT EXISTS bank_agency text,
      ADD COLUMN IF NOT EXISTS bank_account text,
      ADD COLUMN IF NOT EXISTS pix_key text,
      ADD COLUMN IF NOT EXISTS specialty text,
      ADD COLUMN IF NOT EXISTS coren text,
      ADD COLUMN IF NOT EXISTS crm text,
      ADD COLUMN IF NOT EXISTS cep text,
      ADD COLUMN IF NOT EXISTS address text,
      ADD COLUMN IF NOT EXISTS email text,
      ADD COLUMN IF NOT EXISTS photo_url text,
      ADD COLUMN IF NOT EXISTS admission_date date,
      ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
  `);

  // Compatibility for legacy typo: employument_type <-> employment_type
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff'
          AND column_name = 'employument_type'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff'
          AND column_name = 'employment_type'
      ) THEN
        EXECUTE 'ALTER TABLE staff RENAME COLUMN employument_type TO employment_type';
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS employment_type text DEFAULT 'clt',
      ADD COLUMN IF NOT EXISTS employument_type text;
  `);

  await pool.query(`
    UPDATE staff
    SET employment_type = COALESCE(NULLIF(employment_type, ''), NULLIF(employument_type, ''), 'clt');
  `);

  await pool.query(`
    UPDATE staff
    SET employument_type = COALESCE(NULLIF(employument_type, ''), employment_type);
  `);

  await pool.query(`
    UPDATE staff
    SET shift_value = COALESCE(shift_value, 0)
    WHERE shift_value IS NULL;
  `);

  await pool.query(`
    UPDATE staff
    SET bonus_value = COALESCE(bonus_value, 0)
    WHERE bonus_value IS NULL;
  `);

  await pool.query(`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS portal_access boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS portal_username text,
      ADD COLUMN IF NOT EXISTS portal_user_id integer;
  `);

  await pool.query(`
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS environment_settings text;
  `);

  await pool.query(`
    ALTER TABLE residents
      ADD COLUMN IF NOT EXISTS gender text,
      ADD COLUMN IF NOT EXISTS cpf text,
      ADD COLUMN IF NOT EXISTS rg text,
      ADD COLUMN IF NOT EXISTS sus_number text,
      ADD COLUMN IF NOT EXISTS blood_type text,
      ADD COLUMN IF NOT EXISTS marital_status text,
      ADD COLUMN IF NOT EXISTS nationality text DEFAULT 'Brasileiro(a)',
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS health_notes text,
      ADD COLUMN IF NOT EXISTS allergies text,
      ADD COLUMN IF NOT EXISTS dietary_restrictions text,
      ADD COLUMN IF NOT EXISTS mobility_status text,
      ADD COLUMN IF NOT EXISTS cognitive_status text,
      ADD COLUMN IF NOT EXISTS contact_relationship text,
      ADD COLUMN IF NOT EXISTS photo_url text,
      ADD COLUMN IF NOT EXISTS care_type text DEFAULT 'residential',
      ADD COLUMN IF NOT EXISTS cep text,
      ADD COLUMN IF NOT EXISTS address text,
      ADD COLUMN IF NOT EXISTS address_number text,
      ADD COLUMN IF NOT EXISTS address_complement text,
      ADD COLUMN IF NOT EXISTS neighborhood text,
      ADD COLUMN IF NOT EXISTS city text,
      ADD COLUMN IF NOT EXISTS state text;
  `);

  await pool.query(`
    UPDATE residents
    SET care_type = COALESCE(NULLIF(care_type, ''), 'residential')
    WHERE care_type IS NULL OR care_type = '';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patient_documents (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      resident_id integer NOT NULL,
      title text NOT NULL,
      subtitle text,
      category text NOT NULL DEFAULT 'document',
      file_name text NOT NULL,
      file_type text,
      file_size integer,
      file_data text NOT NULL,
      created_by_user_id integer,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS patient_documents
      ADD COLUMN IF NOT EXISTS organization_id integer,
      ADD COLUMN IF NOT EXISTS resident_id integer,
      ADD COLUMN IF NOT EXISTS title text,
      ADD COLUMN IF NOT EXISTS subtitle text,
      ADD COLUMN IF NOT EXISTS category text DEFAULT 'document',
      ADD COLUMN IF NOT EXISTS file_name text,
      ADD COLUMN IF NOT EXISTS file_type text,
      ADD COLUMN IF NOT EXISTS file_size integer,
      ADD COLUMN IF NOT EXISTS file_data text,
      ADD COLUMN IF NOT EXISTS created_by_user_id integer,
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
  `);

  await pool.query(`
    UPDATE patient_documents
    SET category = COALESCE(NULLIF(category, ''), 'document')
    WHERE category IS NULL OR category = '';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS patient_documents_org_resident_idx
      ON patient_documents (organization_id, resident_id, created_at);
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS medical_records
      ADD COLUMN IF NOT EXISTS staff_id integer,
      ADD COLUMN IF NOT EXISTS glucose_level integer,
      ADD COLUMN IF NOT EXISTS daily_checklist text;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_clock_locations (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      name text NOT NULL,
      address text,
      latitude real NOT NULL,
      longitude real NOT NULL,
      radius_meters integer NOT NULL DEFAULT 200,
      active boolean DEFAULT true,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_clock_entries (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      staff_id integer NOT NULL,
      user_id integer,
      location_id integer,
      event_type text NOT NULL,
      event_time timestamp NOT NULL DEFAULT now(),
      latitude real,
      longitude real,
      accuracy real,
      distance_meters real,
      geofence_radius_meters integer,
      status text NOT NULL DEFAULT 'valid',
      notes text,
      ip_address text,
      user_agent text,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS time_clock_locations
      ADD COLUMN IF NOT EXISTS address text,
      ADD COLUMN IF NOT EXISTS radius_meters integer NOT NULL DEFAULT 200,
      ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS time_clock_entries
      ALTER COLUMN latitude DROP NOT NULL,
      ALTER COLUMN longitude DROP NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS time_clock_entries
      ADD COLUMN IF NOT EXISTS user_id integer,
      ADD COLUMN IF NOT EXISTS location_id integer,
      ADD COLUMN IF NOT EXISTS accuracy real,
      ADD COLUMN IF NOT EXISTS distance_meters real,
      ADD COLUMN IF NOT EXISTS geofence_radius_meters integer,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'valid',
      ADD COLUMN IF NOT EXISTS notes text,
      ADD COLUMN IF NOT EXISTS ip_address text,
      ADD COLUMN IF NOT EXISTS user_agent text;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_clock_adjustment_requests (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      staff_id integer NOT NULL,
      requested_by_user_id integer,
      entry_id integer,
      event_type text NOT NULL,
      requested_event_time timestamp NOT NULL,
      reason text NOT NULL,
      notes text,
      status text NOT NULL DEFAULT 'pending',
      reviewed_by_user_id integer,
      reviewed_at timestamp,
      reviewer_notes text,
      applied_entry_id integer,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_clock_audit_logs (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      staff_id integer,
      entity_type text NOT NULL,
      entity_id integer,
      action text NOT NULL,
      performed_by_user_id integer,
      previous_value text,
      new_value text,
      reason text,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_clock_closures (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      reference_month text NOT NULL,
      status text NOT NULL DEFAULT 'closed',
      notes text,
      closed_by_user_id integer,
      closed_at timestamp DEFAULT now(),
      reopened_by_user_id integer,
      reopened_at timestamp,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS time_clock_adjustment_requests
      ADD COLUMN IF NOT EXISTS requested_by_user_id integer,
      ADD COLUMN IF NOT EXISTS entry_id integer,
      ADD COLUMN IF NOT EXISTS reviewed_by_user_id integer,
      ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
      ADD COLUMN IF NOT EXISTS reviewer_notes text,
      ADD COLUMN IF NOT EXISTS applied_entry_id integer;
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS time_clock_closures
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'closed',
      ADD COLUMN IF NOT EXISTS notes text,
      ADD COLUMN IF NOT EXISTS closed_by_user_id integer,
      ADD COLUMN IF NOT EXISTS closed_at timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS reopened_by_user_id integer,
      ADD COLUMN IF NOT EXISTS reopened_at timestamp;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts_payable (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      staff_id integer,
      title text NOT NULL,
      category text NOT NULL DEFAULT 'staff',
      reference_month text,
      due_date date NOT NULL,
      amount real NOT NULL,
      discount real DEFAULT 0,
      extra real DEFAULT 0,
      status text NOT NULL DEFAULT 'pending',
      paid_at timestamp,
      payment_method text,
      notes text,
      created_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS accounts_payable
      ADD COLUMN IF NOT EXISTS staff_id integer,
      ADD COLUMN IF NOT EXISTS title text,
      ADD COLUMN IF NOT EXISTS category text DEFAULT 'staff',
      ADD COLUMN IF NOT EXISTS reference_month text,
      ADD COLUMN IF NOT EXISTS due_date date,
      ADD COLUMN IF NOT EXISTS amount real,
      ADD COLUMN IF NOT EXISTS discount real DEFAULT 0,
      ADD COLUMN IF NOT EXISTS extra real DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS paid_at timestamp,
      ADD COLUMN IF NOT EXISTS payment_method text,
      ADD COLUMN IF NOT EXISTS notes text,
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_opportunities (
      id serial PRIMARY KEY,
      organization_id integer NOT NULL,
      title text NOT NULL,
      contact_name text,
      contact_phone text,
      contact_email text,
      source text,
      stage text NOT NULL DEFAULT 'lead',
      amount real DEFAULT 0,
      expected_close_date date,
      owner_id integer,
      owner_staff_id integer,
      notes text,
      follow_up_tasks text DEFAULT '[]',
      lost_reason text,
      position integer DEFAULT 0,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS crm_opportunities
      ADD COLUMN IF NOT EXISTS organization_id integer,
      ADD COLUMN IF NOT EXISTS title text,
      ADD COLUMN IF NOT EXISTS contact_name text,
      ADD COLUMN IF NOT EXISTS contact_phone text,
      ADD COLUMN IF NOT EXISTS contact_email text,
      ADD COLUMN IF NOT EXISTS source text,
      ADD COLUMN IF NOT EXISTS stage text DEFAULT 'lead',
      ADD COLUMN IF NOT EXISTS amount real DEFAULT 0,
      ADD COLUMN IF NOT EXISTS expected_close_date date,
      ADD COLUMN IF NOT EXISTS owner_id integer,
      ADD COLUMN IF NOT EXISTS owner_staff_id integer,
      ADD COLUMN IF NOT EXISTS notes text,
      ADD COLUMN IF NOT EXISTS follow_up_tasks text DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS lost_reason text,
      ADD COLUMN IF NOT EXISTS position integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
  `);

  await pool.query(`
    UPDATE crm_opportunities
    SET follow_up_tasks = '[]'
    WHERE follow_up_tasks IS NULL OR btrim(follow_up_tasks) = '';
  `);

  await pool.query(`
    UPDATE crm_opportunities
    SET stage = 'no_interest'
    WHERE stage = 'lost';
  `);
}
