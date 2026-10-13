// Білет за замовлення — API сервер
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { q, tx, getSetting, setSetting } from "./db.js";
import { dateKey, monthKey, prevMonth, monthEnd, periodRange, kyivMidnight, addDays, weekStart, tsRange } from "./time.js";
import { normalizeConfig, mods, outcomes, draw, activeBoosts, BOOSTS, expectedCost } from "./game.js";
import * as odoo from "./odoo.js";
import { startSync, syncStatuses } from "./sync.js";

const E = process.env;
const SECRET = E.SESSION_SECRET || "";
if (SECRET.length < 20) console.warn("УВАГА: SESSION_SECRET коротший за 20 символів");

const app = express();
app.set("trust proxy", true);
const origins = String(E.FRONTEND_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: "200kb" }));

/* ---------- helpers ---------- */
const hashCode = code => crypto.createHash("sha256").update(SECRET + ":" + String(code).trim().toUpperCase()).digest("hex");
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPH[b % ALPH.length]).join("");
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, "");
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: "Помилка сервера. Спробуйте ще раз." });
});

async function loadConfig() { return normalizeConfig(await getSetting("config", null)); }
async function loadBoosts() { return activeBoosts(await getSetting("boosts", [])); }

function ticketJson(r) {
  const t = new Date(r.created_at).getTime();
  return {
    id: Number(r.id), o: r.order_no, t, dk: dateKey(t), a: r.amount, y: r.kind, s: r.scratched, g: r.gold,
    c: Number(r.mult_c), p: Number(r.mult_p), n: r.no_empty, j: Number(r.jp_mult), f: r.fireworks,
    st: r.status, stage: r.odoo_stage || null, mid: r.manager_id, src: r.status_source
  };
}

async function monthOrders(db, mk) {
  const r = await db.query("select count(*)::int n from tickets where created_at >= $1 and created_at < $2", tsRange(mk + "-01", monthEnd(mk)));
  return r.rows[0].n;
}
async function jackpotNow(db, mk, cfg) {
  const [n, j] = await Promise.all([monthOrders(db, mk), db.query("select reset_orders from jackpot where month = $1", [mk])]);
  const reset = j.rows.length ? j.rows[0].reset_orders : 0;
  return { value: Math.round(cfg.jp.start + cfg.jp.inc * Math.max(0, n - reset)), orders: n };
}

/* ---------- auth ---------- */
const attempts = new Map();
function limitLogin(ip) {
  const now = Date.now(), a = attempts.get(ip) || { n: 0, t: now };
  if (now - a.t > 15 * 60e3) { a.n = 0; a.t = now; }
  a.n++; attempts.set(ip, a);
  if (a.n > 10) throw new HttpError(429, "Забагато спроб. Зачекайте 15 хвилин.");
}
async function auth(req, res, next) {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Увійдіть за кодом" });
    const r = await q("select m.* from sessions s join managers m on m.id = s.manager_id where s.token = $1", [token]);
    if (!r.rows.length) return res.status(401).json({ error: "Сесія завершилась. Увійдіть знову." });
    req.me = r.rows[0]; req.token = token; next();
  } catch (e) { console.error(e); res.status(500).json({ error: "Помилка сервера" }); }
}
const adminOnly = (req, res, next) => (req.me.is_admin ? next() : res.status(403).json({ error: "Тільки для керівника" }));

app.get("/", (req, res) => res.json({ ok: true, service: "bilet-za-zamovlennya" }));

app.post("/api/login", wrap(async (req, res) => {
  limitLogin(req.ip);
  const code = String(req.body.code || "").trim();
  if (code.length < 4) throw new HttpError(400, "Введіть код входу");
  const r = await q("select * from managers where code_hash = $1", [hashCode(code)]);
  if (!r.rows.length) throw new HttpError(401, "Невірний код. Перевірте його в керівника.");
  const token = crypto.randomBytes(32).toString("hex");
  await q("insert into sessions (token, manager_id) values ($1, $2)", [token, r.rows[0].id]);
  attempts.delete(req.ip);
  res.json({ token });
}));
app.post("/api/logout", auth, wrap(async (req, res) => { await q("delete from sessions where token = $1", [req.token]); res.json({ ok: true }); }));

/* ---------- manager ---------- */
app.get("/api/me", auth, wrap(async (req, res) => {
  const me = req.me, cfg = await loadConfig(), boosts = await loadBoosts(), mk = monthKey();
  const from = prevMonth(mk) + "-01";
  const [jp, tk] = await Promise.all([
    jackpotNow({ query: q }, mk, cfg),
    q("select * from tickets where manager_id = $1 and created_at >= $2 order by created_at desc limit 3000", [me.id, new Date(kyivMidnight(from))])
  ]);
  const m = mods(cfg, boosts);
  res.json({
    me: { id: me.id, name: me.name, isAdmin: me.is_admin, archived: me.archived },
    jackpot: jp.value, boostLabels: m.labels, goldEvery: cfg.goldEvery,
    tickets: tk.rows.map(ticketJson)
  });
}));

app.post("/api/ticket", auth, wrap(async (req, res) => {
  const me = req.me;
  if (me.archived) throw new HttpError(403, "Кабінет в архіві");
  const raw = String(req.body.order || "").trim();
  const key = norm(raw);
  if (!key) throw new HttpError(400, "Введіть номер замовлення.");
  if (raw.length > 40) throw new HttpError(400, "Номер замовлення до 40 символів.");

  const ex = await q("select * from tickets where order_key = $1", [key]);
  if (ex.rows.length) {
    if (ex.rows[0].manager_id !== me.id) throw new HttpError(409, "Цей номер замовлення вже використав інший менеджер");
    return res.json({ ticket: ticketJson(ex.rows[0]), existing: true });
  }

  let order = null;
  if (odoo.configured()) {
    try { order = await odoo.findOrder(raw.replace(/\s+/g, "")); }
    catch (e) { console.error("odoo", e.message); throw new HttpError(503, "Odoo зараз не відповідає. Спробуйте за хвилину."); }
    if (!order) throw new HttpError(404, "Замовлення з таким номером не знайдено в Odoo. Перевірте номер.");
    if (odoo.isCancel(order.stage)) throw new HttpError(409, `Замовлення в статусі «${order.stage}», білет за нього не видається.`);
    if (odoo.CHECK_OWNER && me.odoo_user_id && order.userId && order.userId !== me.odoo_user_id)
      throw new HttpError(403, "Це замовлення оформив інший менеджер.");
  }

  const cfg = await loadConfig(), boosts = await loadBoosts();
  const ticket = await tx(async db => {
    await db.query("select pg_advisory_xact_lock(42, $1)", [me.id]);
    const now = Date.now(), dk = dateKey(now), mk = monthKey(now);
    const today = await db.query("select count(*)::int n from tickets where manager_id = $1 and created_at >= $2 and created_at < $3", [me.id, ...tsRange(dk, dk)]);
    const gold = cfg.goldEvery > 0 && (today.rows[0].n + 1) % cfg.goldEvery === 0;
    const m = mods(cfg, boosts, now, gold);
    const jp = await jackpotNow(db, mk, cfg);
    const o = draw(outcomes(cfg, m, Math.round(jp.value + cfg.jp.inc)));
    const ins = await db.query(
      `insert into tickets (manager_id, order_no, order_key, odoo_id, amount, kind, gold, mult_c, mult_p, no_empty, jp_mult, fireworks, prob, status, odoo_stage, checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (order_key) do nothing returning *`,
      [me.id, raw.slice(0, 40), key, order ? order.id : null, o.a, o.y, gold, m.c, m.p, m.ne, m.jm, o.y !== 0 && o.p < 5, Math.round(o.p * 1000) / 1000,
        o.a > 0 ? (order && odoo.isDone(order.stage) ? "c" : "w") : null, order ? order.stage : null, order ? new Date() : null]
    );
    if (!ins.rows.length) throw new HttpError(409, "Цей номер замовлення щойно використав інший менеджер");
    if (o.y === 2) {
      await db.query(
        "insert into jackpot (month, reset_orders, last_win) values ($1, $2, $3) on conflict (month) do update set reset_orders = excluded.reset_orders, last_win = excluded.last_win",
        [mk, jp.orders + 1, JSON.stringify({ manager_id: me.id, amount: o.a, at: now })]
      );
    }
    return ins.rows[0];
  });
  res.json({ ticket: ticketJson(ticket) });
}));

app.post("/api/ticket/:id/scratch", auth, wrap(async (req, res) => {
  const r = await q("update tickets set scratched = true where id = $1 and manager_id = $2 returning *", [req.params.id, req.me.id]);
  if (!r.rows.length) throw new HttpError(404, "Білет не знайдено");
  res.json({ ticket: ticketJson(r.rows[0]) });
}));

app.get("/api/rating", auth, wrap(async (req, res) => {
  const per = ["day", "week", "month"].includes(req.query.period) ? req.query.period : "month";
  const [from, to] = periodRange(per);
  const r = await q(
    `select m.id, m.name, count(t.id)::int n, coalesce(sum(case when t.scratched then t.amount else 0 end),0)::int w
       from tickets t join managers m on m.id = t.manager_id
      where m.archived = false and t.created_at >= $1 and t.created_at < $2
      group by m.id, m.name order by w desc, n desc`, tsRange(from, to));
  res.json({ rows: r.rows });
}));

/* ---------- admin ---------- */
const A = express.Router();
A.use(auth, adminOnly);

function periodOf(req) { const p = String(req.query.period || "month"); let r; try { r = periodRange(p); } catch { throw new HttpError(400, "Невірний період"); } return tsRange(r[0], r[1]); }
const T_DATE = "t.created_at >= $2 and t.created_at < $3";

A.get("/summary", wrap(async (req, res) => {
  const [from, to] = periodOf(req);
  const r = await q(
    `select m.id, m.name, m.phone, m.archived, m.is_admin, m.odoo_user_id, m.created_at,
            count(t.id)::int n,
            coalesce(sum(t.amount) filter (where t.status='w'),0)::int pw,
            count(t.id) filter (where t.status='w')::int pwn,
            coalesce(sum(t.amount) filter (where t.status='c'),0)::int c,
            coalesce(sum(t.amount) filter (where t.status='x'),0)::int x,
            coalesce(sum(t.amount),0)::int tot,
            max(t.created_at) last
       from managers m left join tickets t on t.manager_id = m.id and t.created_at >= $1 and t.created_at < $2
      group by m.id order by n desc, m.name`, [from, to]);
  res.json({ rows: r.rows.map(x => Object.assign(x, { last: x.last ? new Date(x.last).getTime() : null, created_at: new Date(x.created_at).getTime() })) });
}));

A.get("/tickets", wrap(async (req, res) => {
  const [from, to] = periodOf(req);
  const mid = Number(req.query.manager_id);
  if (!mid) throw new HttpError(400, "Не вказано менеджера");
  const [list, sum] = await Promise.all([
    q(`select * from tickets t where manager_id = $1 and ${T_DATE} order by created_at desc limit 1000`, [mid, from, to]),
    q(`select count(*)::int n,
              coalesce(sum(amount) filter (where status='w'),0)::int pw, count(*) filter (where status='w')::int pwn,
              coalesce(sum(amount) filter (where status='c'),0)::int c, coalesce(sum(amount) filter (where status='x'),0)::int x,
              coalesce(sum(amount),0)::int tot
         from tickets t where manager_id = $1 and ${T_DATE}`, [mid, from, to])
  ]);
  const pend = await q(`select id from tickets t where manager_id = $1 and status = 'w' and ${T_DATE}`, [mid, from, to]);
  res.json({ tickets: list.rows.map(ticketJson), summary: sum.rows[0], pendingIds: pend.rows.map(r => Number(r.id)) });
}));

A.post("/tickets/status", wrap(async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 20000);
  const st = req.body.status;
  if (!["w", "c", "x"].includes(st)) throw new HttpError(400, "Невірний статус");
  if (!ids.length) throw new HttpError(400, "Нічого не вибрано");
  const r = await q("update tickets set status = $1, status_source = 'manual' where id = any($2::bigint[]) and amount > 0 returning id", [st, ids]);
  res.json({ updated: r.rowCount });
}));

A.get("/managers", wrap(async (req, res) => {
  const r = await q("select id, name, phone, odoo_user_id, is_admin, archived, created_at from managers order by archived, name");
  res.json({ rows: r.rows });
}));
A.post("/managers", wrap(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2) throw new HttpError(400, "Вкажіть ім'я та прізвище, щонайменше 2 символи.");
  const code = newCode();
  const r = await q("insert into managers (name, phone, odoo_user_id, code_hash, is_admin) values ($1,$2,$3,$4,$5) returning id",
    [name.slice(0, 80), String(req.body.phone || "").trim().slice(0, 30) || null, Number(req.body.odoo_user_id) || null, hashCode(code), !!req.body.is_admin]);
  res.json({ id: r.rows[0].id, code });
}));
A.patch("/managers/:id", wrap(async (req, res) => {
  const id = Number(req.params.id), b = req.body;
  const cur = (await q("select * from managers where id = $1", [id])).rows[0];
  if (!cur) throw new HttpError(404, "Менеджера не знайдено");
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) : cur.name;
  if (name.length < 2) throw new HttpError(400, "Ім'я щонайменше 2 символи.");
  await q("update managers set name=$1, phone=$2, odoo_user_id=$3, archived=$4 where id=$5", [
    name,
    b.phone !== undefined ? (String(b.phone).trim().slice(0, 30) || null) : cur.phone,
    b.odoo_user_id !== undefined ? (Number(b.odoo_user_id) || null) : cur.odoo_user_id,
    b.archived !== undefined ? !!b.archived : cur.archived,
    id]);
  if (b.archived) await q("delete from sessions where manager_id = $1 and manager_id <> $2", [id, req.me.id]);
  res.json({ ok: true });
}));
A.post("/managers/:id/code", wrap(async (req, res) => {
  const code = newCode(), id = Number(req.params.id);
  const r = await q("update managers set code_hash = $1 where id = $2", [hashCode(code), id]);
  if (!r.rowCount) throw new HttpError(404, "Менеджера не знайдено");
  if (id !== req.me.id) await q("delete from sessions where manager_id = $1", [id]);
  res.json({ code });
}));

A.get("/odoo-users", wrap(async (req, res) => {
  if (!odoo.configured()) return res.json({ rows: [], configured: false });
  try { res.json({ rows: await odoo.listUsers(), configured: true }); }
  catch (e) { console.error(e.message); throw new HttpError(503, "Не вдалося отримати користувачів з Odoo"); }
}));

A.get("/config", wrap(async (req, res) => {
  const cfg = await loadConfig();
  res.json({ config: cfg, boosts: await loadBoosts(), boostNames: BOOSTS, expected: expectedCost(cfg),
    odoo: { configured: odoo.configured(), done: odoo.DONE, cancel: odoo.CANCEL, checkOwner: odoo.CHECK_OWNER } });
}));
A.put("/config", wrap(async (req, res) => {
  const cur = await loadConfig();
  const next = normalizeConfig(Object.assign({}, cur, req.body || {}));
  await setSetting("config", next);
  res.json({ config: next });
}));
A.post("/boosts", wrap(async (req, res) => {
  const type = req.body.type, dur = req.body.duration;
  if (!BOOSTS[type]) throw new HttpError(400, "Невідомий бонус");
  const now = Date.now(); let until;
  if (type === "happy" || dur === "1h") until = now + 3600e3;
  else if (dur === "3h") until = now + 3 * 3600e3;
  else if (dur === "week") until = kyivMidnight(addDays(weekStart(dateKey(now)), 7));
  else until = kyivMidnight(addDays(dateKey(now), 1));
  const list = (await loadBoosts()).concat([{ id: crypto.randomBytes(6).toString("hex"), type, until }]);
  await setSetting("boosts", list);
  res.json({ boosts: list });
}));
A.delete("/boosts/:id", wrap(async (req, res) => {
  const list = (await loadBoosts()).filter(b => b.id !== req.params.id);
  await setSetting("boosts", list);
  res.json({ boosts: list });
}));

A.post("/sync", wrap(async (req, res) => { res.json(await syncStatuses()); }));

A.get("/export", wrap(async (req, res) => {
  const mk = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(mk)) throw new HttpError(400, "Невірний місяць");
  const r = await q(`select t.*, m.name from tickets t join managers m on m.id = t.manager_id
                      where t.created_at >= $1 and t.created_at < $2 order by t.created_at`, tsRange(mk + "-01", monthEnd(mk)));
  const esc = v => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const ST = { w: "очікує", c: "підтверджено", x: "скасовано" };
  const tf = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kiev", hour: "2-digit", minute: "2-digit" });
  const dec = n => String(Number(n)).replace(".", ",");
  const lines = [["Дата", "Час", "Менеджер", "Замовлення", "Приз, грн", "Тип", "Статус", "Етап Odoo", "Стертий", "Золотий", "Шанси ×", "Призи ×", "Без порожніх", "Джекпот ×"]];
  for (const t of r.rows) lines.push([dateKey(t.created_at), tf.format(t.created_at), t.name, t.order_no, t.amount,
    t.kind === 2 ? "джекпот" : t.amount ? "грошовий" : "порожньо", t.status ? ST[t.status] : "", t.odoo_stage || "",
    t.scratched ? "так" : "ні", t.gold ? "так" : "ні", dec(t.mult_c), dec(t.mult_p), t.no_empty ? "так" : "ні", dec(t.jp_mult)]);
  const csv = "﻿" + lines.map(l => l.map(esc).join(";")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="bilet-${mk}.csv"`);
  res.send(csv);
}));

A.delete("/month/:mk", wrap(async (req, res) => {
  const mk = req.params.mk;
  if (!/^\d{4}-\d{2}$/.test(mk)) throw new HttpError(400, "Невірний місяць");
  if (mk >= prevMonth(monthKey())) throw new HttpError(400, "Поточний і минулий місяці видаляти не можна.");
  const r = await q("delete from tickets where created_at >= $1 and created_at < $2", tsRange(mk + "-01", monthEnd(mk)));
  await q("delete from jackpot where month = $1", [mk]);
  res.json({ deleted: r.rowCount });
}));

app.use("/api/admin", A);

/* ---------- start ---------- */
async function bootstrapAdmin() {
  const r = await q("select count(*)::int n from managers where is_admin");
  if (r.rows[0].n > 0) return;
  if (!E.ADMIN_CODE || E.ADMIN_CODE.length < 6) { console.warn("Немає жодного керівника. Задайте ADMIN_CODE (6+ символів) і перезапустіть."); return; }
  await q("insert into managers (name, code_hash, is_admin) values ($1, $2, true) on conflict (code_hash) do nothing", [E.ADMIN_NAME || "Керівник", hashCode(E.ADMIN_CODE)]);
  console.log("Створено керівника з кодом із ADMIN_CODE");
}

const port = Number(E.PORT) || 3000;
app.listen(port, async () => {
  console.log("Сервер запущено на порту", port);
  try { await bootstrapAdmin(); } catch (e) { console.error("bootstrap", e.message); }
  startSync();
});
