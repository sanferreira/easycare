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
}
