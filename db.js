import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
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

// Налаштування гри зберігаються в таблиці settings як JSON
export async function getSetting(key, fallback) {
  const r = await q("select value from settings where key = $1", [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}
export async function setSetting(key, value) {
  await q("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
}
