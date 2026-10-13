import pg from "pg";
import fs from "node:fs";

const url = process.env.DATABASE_URL || "";
// SSL потрібен для зовнішніх баз (Supabase, публічний Railway URL),
// але не для внутрішньої мережі Railway і локальної бази. PGSSL=false вимикає примусово.
const noSsl = /localhost|127\.0\.0\.1|\.railway\.internal|host=\//.test(url) || String(process.env.PGSSL).toLowerCase() === "false";

export const pool = new pg.Pool({
  connectionString: url,
  ssl: url && !noSsl ? { rejectUnauthorized: false } : false,
  max: 8
});

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const res = await fn(client);
    await client.query("commit");
    return res;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Створює таблиці при старті, якщо їх ще немає (schema.sql безпечно запускати повторно)
export async function migrate() {
  const sql = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

// Налаштування гри зберігаються в таблиці settings як JSON
export async function getSetting(key, fallback) {
  const r = await q("select value from settings where key = $1", [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}
export async function setSetting(key, value) {
  await q("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
}
