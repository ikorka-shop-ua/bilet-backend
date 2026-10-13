// Odoo через XML-RPC
// Номер замовлення (S87995) шукаємо в sale.order, а етап воронки беремо
// з пов'язаної картки «Нагоди» (crm.lead) через поле opportunity_id.
import xmlrpc from "xmlrpc";

const E = process.env;
const MODEL = E.ODOO_ORDER_MODEL || "sale.order";
const F_NO = E.ODOO_ORDER_FIELD || "name";
const F_USER = E.ODOO_USER_FIELD || "user_id";
const F_LEAD = E.ODOO_LEAD_FIELD === undefined ? (MODEL === "sale.order" ? "opportunity_id" : "") : E.ODOO_LEAD_FIELD;
const F_STAGE = E.ODOO_STAGE_FIELD || "stage_id";

// Службові назви етапів, якщо замовлення скасоване або картку позначено втраченою
export const ST_ORDER_CANCEL = "Замовлення скасовано";
export const ST_LEAD_LOST = "Нагоду втрачено";

const list = s => String(s || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
export const DONE = list(E.STAGES_DONE || "Завершено");
export const CANCEL = [...new Set([
  ...list(E.STAGES_CANCEL || "Відказ,Попередня відмова,ЧС,Утиль,Відмова від отримання,Очікування повернення,Повернуто на склад"),
  ST_ORDER_CANCEL.toLowerCase(), ST_LEAD_LOST.toLowerCase()
])];
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
const ALL = { context: { active_test: false } }; // бачити й архівні (втрачені) картки

// Етапи карток «Нагоди» за їх id → Map(leadId → назва етапу)
async function leadStages(leadIds) {
  const out = new Map();
  if (!leadIds.length) return out;
  const rows = await exec("crm.lead", "read", [leadIds], { fields: ["id", "stage_id", "active"], ...ALL });
  for (const r of rows) out.set(r.id, r.active === false ? ST_LEAD_LOST : stageName(r.stage_id));
  return out;
}

// Етап одного запису замовлення (з урахуванням скасування й картки)
function orderStage(row, leads) {
  if (row.state === "cancel") return ST_ORDER_CANCEL;
  if (F_LEAD) {
    const lid = m2oId(row[F_LEAD]);
    if (lid && leads.has(lid)) return leads.get(lid);
    return ""; // замовлення без картки: етапу немає, чекаємо
  }
  return stageName(row[F_STAGE]);
}
function orderFields() {
  const f = ["id", F_NO, F_USER];
  if (MODEL === "sale.order") f.push("state");
  if (F_LEAD) f.push(F_LEAD); else f.push(F_STAGE);
  return f;
}

// Пошук замовлення за номером (без урахування регістру)
export async function findOrder(orderNo) {
  const safe = orderNo.replace(/[%_\\]/g, m => "\\" + m);
  const rows = await exec(MODEL, "search_read", [[[F_NO, "=ilike", safe]]], { fields: orderFields(), limit: 2 });
  if (!rows.length) return null;
  const r = rows[0];
  const lid = F_LEAD ? m2oId(r[F_LEAD]) : null;
  const leads = lid ? await leadStages([lid]) : new Map();
  return { id: r.id, number: r[F_NO], userId: m2oId(r[F_USER]), stage: orderStage(r, leads) };
}

// Етапи кількох замовлень за id → [{id, stage}]
export async function readStages(ids) {
  if (!ids.length) return [];
  const rows = await exec(MODEL, "read", [ids], { fields: orderFields() });
  const leadIds = F_LEAD ? [...new Set(rows.map(r => m2oId(r[F_LEAD])).filter(Boolean))] : [];
  const leads = await leadStages(leadIds);
  return rows.map(r => ({ id: r.id, stage: orderStage(r, leads) }));
}

// Внутрішні користувачі Odoo для прив'язки менеджерів
export async function listUsers() {
  const rows = await exec("res.users", "search_read", [[["share", "=", false]]], { fields: ["id", "name"], limit: 500, order: "name asc" });
  return rows.map(r => ({ id: r.id, name: r.name }));
}

export const isDone = st => DONE.includes(String(st).toLowerCase());
export const isCancel = st => CANCEL.includes(String(st).toLowerCase());
