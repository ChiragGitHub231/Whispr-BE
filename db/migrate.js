import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env file manually
const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/SUPABASE_DB_URL="([^"]+)"/);
if (!match) {
  console.error("Could not find SUPABASE_DB_URL in .env file.");
  process.exit(1);
}

const connectionString = match[1];

const client = new pg.Client({
  connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to database successfully.");

    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log("Applying schema...");
    await client.query(sql);
    console.log("Schema applied successfully! Your tables are now visible in the Supabase Dashboard.");
  } catch (err) {
    console.error("Error applying schema:", err);
  } finally {
    await client.end();
  }
}

run();
