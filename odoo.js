// Odoo через XML-RPC
import xmlrpc from "xmlrpc";

const E = process.env;
const MODEL = E.ODOO_ORDER_MODEL || "sale.order";
const F_NO = E.ODOO_ORDER_FIELD || "name";
const F_USER = E.ODOO_USER_FIELD || "user_id";
const F_STAGE = E.ODOO_STAGE_FIELD || "stage_id";
const list = s => String(s || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
export const DONE = list(E.STAGES_DONE || "Завершено");
export const CANCEL = list(E.STAGES_CANCEL || "Відказ,Попередня відмова,ЧС,Утиль,Відмова від отримання,Очікування повернення,Повернуто на склад");
export const CHECK_OWNER = String(E.ODOO_CHECK_OWNER || "true").toLowerCase() === "true";
export const configured = () => !!(E.ODOO_URL && E.ODOO_DB && E.ODOO_LOGIN && E.ODOO_API_KEY);

function client(path) {
  const u = new URL(E.ODOO_URL);
  const opts = { host: u.hostname, port: u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80), path };
  return u.protocol === "https:" ? xmlrpc.createSecureClient(opts) : xmlrpc.createClient(opts);
}
const call = (c, method, params) => new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error("odoo timeout")), 15000);
  c.methodCall(method, params, (err, v) => { clearTimeout(timer); err ? rej(err) : res(v); });
});

let uid = null;
async function auth() {
  if (uid) return uid;
  uid = await call(client("/xmlrpc/2/common"), "authenticate", [E.ODOO_DB, E.ODOO_LOGIN, E.ODOO_API_KEY, {}]);
  if (!uid) throw new Error("odoo auth failed");
  return uid;
}
async function exec(model, method, args, kwargs = {}) {
  const id = await auth();
  try {
    return await call(client("/xmlrpc/2/object"), "execute_kw", [E.ODOO_DB, id, E.ODOO_API_KEY, model, method, args, kwargs]);
  } catch (e) {
    uid = null; // повторна авторизація при наступному виклику
    throw e;
  }
}

export const stageName = v => (Array.isArray(v) ? String(v[1] || "") : String(v || ""));
const m2oId = v => (Array.isArray(v) ? v[0] : v || null);

// Пошук замовлення за номером (без урахування регістру)
export async function findOrder(orderNo) {
  const safe = orderNo.replace(/[%_\\]/g, m => "\\" + m);
  const rows = await exec(MODEL, "search_read", [[[F_NO, "=ilike", safe]]], { fields: ["id", F_NO, F_USER, F_STAGE], limit: 2 });
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, number: r[F_NO], userId: m2oId(r[F_USER]), stage: stageName(r[F_STAGE]) };
}

// Етапи кількох замовлень за id
export async function readStages(ids) {
  if (!ids.length) return [];
  const rows = await exec(MODEL, "read", [ids], { fields: ["id", F_STAGE] });
  return rows.map(r => ({ id: r.id, stage: stageName(r[F_STAGE]) }));
}

// Внутрішні користувачі Odoo для прив'язки менеджерів
export async function listUsers() {
  const rows = await exec("res.users", "search_read", [[["share", "=", false]]], { fields: ["id", "name"], limit: 500, order: "name asc" });
  return rows.map(r => ({ id: r.id, name: r.name }));
}

export const isDone = st => DONE.includes(String(st).toLowerCase());
export const isCancel = st => CANCEL.includes(String(st).toLowerCase());
