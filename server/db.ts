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
      ADD COLUMN IF NOT EXISTS photo_url text;
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
}
