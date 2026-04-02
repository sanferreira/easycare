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
}
