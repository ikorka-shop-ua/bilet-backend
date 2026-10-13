// Механіка розіграшу. Виконується тільки на сервері.
import crypto from "node:crypto";
import { dateKey, wdIdx } from "./time.js";

export const DEFAULT_CONFIG = {
  prizes: [{ a: 0, p: 45 }, { a: 10, p: 35 }, { a: 25, p: 12 }, { a: 50, p: 6 }, { a: 100, p: 1.8 }],
  jp: { p: 0.2, start: 1000, inc: 2 },
  goldEvery: 10,
  week: [{ c: 1, p: 1 }, { c: 1, p: 1 }, { c: 1, p: 1 }, { c: 1, p: 1 }, { c: 1, p: 1 }, { c: 2, p: 1 }, { c: 2, p: 1 }],
  specials: []
};

export const BOOSTS = {
  c2: "Шанси ×2", c15: "Шанси ×1,5", p2: "Призи ×2", p3: "Призи ×3",
  ne: "Без порожніх білетів", jp5: "Шанс джекпоту ×5", happy: "Щаслива година"
};
const WD = ["Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота", "Неділя"];

export function normalizeConfig(c) {
  c = c || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const prizes = Array.isArray(c.prizes) && c.prizes.length
    ? c.prizes.map(x => ({ a: Math.max(0, Math.round(num(x.a, 0))), p: Math.max(0, num(x.p, 0)) }))
    : DEFAULT_CONFIG.prizes;
  const jp = Object.assign({}, DEFAULT_CONFIG.jp, c.jp || {});
  return {
    prizes,
    jp: { p: Math.max(0, num(jp.p, 0.2)), start: Math.max(0, num(jp.start, 1000)), inc: Math.max(0, num(jp.inc, 2)) },
    goldEvery: Math.max(0, Math.round(num(c.goldEvery, DEFAULT_CONFIG.goldEvery))),
    week: Array.isArray(c.week) && c.week.length === 7
      ? c.week.map(w => ({ c: Math.max(0, num(w.c, 1)) || 1, p: Math.max(0, num(w.p, 1)) || 1 }))
      : DEFAULT_CONFIG.week,
    specials: Array.isArray(c.specials)
      ? c.specials.filter(s => s && /^\d{4}-\d{2}-\d{2}$/.test(s.date)).map(s => ({ date: s.date, name: String(s.name || "").slice(0, 60), c: num(s.c, 1) || 1, p: num(s.p, 1) || 1 }))
      : []
  };
}

export const activeBoosts = (boosts, now = Date.now()) => (boosts || []).filter(b => b && b.until > now && BOOSTS[b.type]);

const x = n => "×" + String(Math.round(n * 100) / 100).replace(".", ",");
const hm = ts => new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kiev", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

// Множники, що діють зараз (з урахуванням золотого білета)
export function mods(cfg, boosts, now = Date.now(), gold = false) {
  const dk = dateKey(now), wi = wdIdx(dk);
  let c = cfg.week[wi].c, p = cfg.week[wi].p, ne = false, jm = 1;
  const labels = [];
  if (c !== 1) labels.push(`${WD[wi]}: шанси ${x(c)}`);
  if (p !== 1) labels.push(`${WD[wi]}: призи ${x(p)}`);
  for (const s of cfg.specials) if (s.date === dk) {
    c *= s.c; p *= s.p;
    const bits = [];
    if (s.c !== 1) bits.push("шанси " + x(s.c));
    if (s.p !== 1) bits.push("призи " + x(s.p));
    labels.push((s.name || "Особлива дата") + (bits.length ? ": " + bits.join(", ") : ""));
  }
  for (const b of activeBoosts(boosts, now)) {
    if (b.type === "c2") c *= 2;
    else if (b.type === "c15") c *= 1.5;
    else if (b.type === "p2") p *= 2;
    else if (b.type === "p3") p *= 3;
    else if (b.type === "ne") ne = true;
    else if (b.type === "jp5") jm *= 5;
    else if (b.type === "happy") { c *= 2; p *= 2; }
    labels.push(`${BOOSTS[b.type]} до ${hm(b.until)}`);
  }
  if (gold) { ne = true; p *= 2; jm *= 2; }
  return { c, p, ne, jm, labels };
}

// Підсумкова таблиця виходів з урахуванням множників (шанси в %, сума = 100)
export function outcomes(cfg, m, jackpotValue) {
  const list = [];
  let emptyP = 0, inc = 0;
  for (const pr of cfg.prizes) {
    if (pr.a <= 0) { emptyP += pr.p; continue; }
    const np = pr.p * m.c;
    inc += np - pr.p;
    list.push({ y: 1, a: Math.round(pr.a * m.p), p: np });
  }
  const jp = cfg.jp.p * m.c * m.jm;
  inc += jp - cfg.jp.p;
  if (jp > 0) list.push({ y: 2, a: jackpotValue, p: jp });
  const e = m.ne ? 0 : Math.max(0, emptyP - inc);
  if (e > 0) list.unshift({ y: 0, a: 0, p: e });
  const total = list.reduce((s, o) => s + o.p, 0) || 1;
  list.forEach(o => { o.p = (o.p / total) * 100; });
  return list;
}

// Криптографічно стійкий вибір
export function draw(list) {
  const r = (crypto.randomInt(0, 1_000_000_000) / 1_000_000_000) * 100;
  let acc = 0;
  for (const o of list) { acc += o.p; if (r < acc) return o; }
  return list[list.length - 1];
}

// Середня вартість білета в звичайний день
export function expectedCost(cfg) {
  return cfg.prizes.reduce((s, p) => s + p.a * p.p / 100, 0) + cfg.jp.start * cfg.jp.p / 100;
}
