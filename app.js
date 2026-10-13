(() => {
"use strict";
/* ---------- helpers ---------- */
const API = String(window.BILET_API || "").replace(/\/+$/, "");
const TZ = "Europe/Kiev";
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const fmtN = n => Math.round(Number(n) || 0).toLocaleString("uk-UA");
const grn = n => `${fmtN(n)} грн`;
const pct = n => (Math.round(n * 100) / 100).toLocaleString("uk-UA") + "%";
const mult = n => "×" + (Math.round(n * 100) / 100).toLocaleString("uk-UA");
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = () => Math.random();
const pfmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dateKey = (ts = Date.now()) => pfmt.format(new Date(ts));
const monthKey = (ts = Date.now()) => dateKey(ts).slice(0, 7);
function prevMonth(mk, n = 1) { let [y, m] = mk.split("-").map(Number); m -= n; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; }
function wdIdx(dk) { const [y, m, d] = dk.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }
function addDays(dk, n) { const [y, m, d] = dk.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const weekStart = dk => addDays(dk, -wdIdx(dk));
function inPeriod(dk, per) {
  const today = dateKey();
  if (per === "day") return dk === today;
  if (per === "week") return dk >= weekStart(today) && dk <= today;
  return dk.slice(0, 7) === today.slice(0, 7);
}
const WD = ["Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота", "Неділя"];
const timeFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dtFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dFmt = new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
function monthName(mk) { const [y, m] = mk.split("-").map(Number); const s = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15))); return s.charAt(0).toUpperCase() + s.slice(1); }
function plural(n, one, few, many) { const a = n % 10, b = n % 100; if (a === 1 && b !== 11) return one; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few; return many; }
function seg(opts, cur, on) { return h("div", { class: "seg", role: "group" }, opts.map(([v, l]) => h("button", { type: "button", "aria-pressed": String(v === cur), onclick: () => on(v) }, l))); }
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} } };

function tier(a, kind) {
  if (kind === 2) return "gold"; if (!a) return "grey";
  if (a < 20) return "green"; if (a < 40) return "teal"; if (a < 75) return "blue"; if (a < 150) return "violet"; return "coral";
}
const tierVar = t => `var(--t-${t})`;
function prizeChip(t, extra) {
  const label = t.y === 2 ? `Джекпот ${grn(t.a)}` : t.a ? grn(t.a) : "Порожньо";
  return h("span", { class: "chip num", style: `--c:${tierVar(tier(t.a, t.y))}` }, label, extra || null);
}
const ST_LABEL = { w: "очікує", c: "підтверджено", x: "скасовано" };

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (S.token) headers.Authorization = "Bearer " + S.token;
  let res;
  try { res = await fetch(API + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch (_) { throw new Error("Немає зв'язку із сервером. Перевірте інтернет."); }
  if (res.status === 401 && path !== "/api/login") { logout(); throw new Error("Сесія завершилась. Увійдіть знову."); }
  if (opts.raw) { if (!res.ok) throw new Error("Помилка сервера"); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Помилка сервера");
  return data;
}

/* ---------- state ---------- */
const S = {
  token: store.get("bz_token"), data: null, view: store.get("bz_view") || "cab", per: "day", ratePer: "month", ticket: null,
  adm: { tab: "orders", per: "month", mgr: null, sel: new Set(), confirm: null, msg: "", summary: null, detail: null, cfg: null, odooUsers: null, newCode: null, showArch: false, dataMk: monthKey() }
};
function logout() {
  if (S.token) api("/api/logout", { method: "POST" }).catch(() => {});
  S.token = null; S.data = null; S.ticket = null; store.set("bz_token", null); cabBuilt = null; show();
}
$("#logout").addEventListener("click", logout);
$("#tabs").addEventListener("click", e => {
  const b = e.target.closest(".tab"); if (!b) return;
  S.view = b.dataset.v; store.set("bz_view", S.view); show();
});

function show() {
  const logged = !!(S.token && S.data);
  $("#tabs").hidden = !logged;
  $("#admTab").hidden = !(logged && S.data.me.isAdmin);
  if (logged && S.view === "adm" && !S.data.me.isAdmin) S.view = "cab";
  $("#jpVal").textContent = logged ? grn(S.data.jackpot) : "—";
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.v === S.view));
  $("#vLogin").hidden = logged;
  $("#vCab").hidden = !logged || S.view !== "cab";
  $("#vRate").hidden = !logged || S.view !== "rate";
  $("#vAdm").hidden = !logged || S.view !== "adm";
  if (!logged) { renderLogin(); return; }
  if (S.view === "cab") renderCab();
  if (S.view === "rate") renderRate();
  if (S.view === "adm") renderAdm(true);
}

/* ---------- login & registration ---------- */
const fmtPhone = p => p && /^380\d{9}$/.test(p) ? `0${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : (p || "");
const L = { mode: "login", reg: { teamCode: "", ok: false } };
async function afterAuth(token) { S.token = token; store.set("bz_token", token); await loadMe(); show(); }
function renderLogin() {
  const root = $("#vLogin");
  if (S.token && !S.data) { root.replaceChildren(h("div", { class: "center muted" }, "Завантажуємо…")); return; }
  const tabs = seg([["login", "Вхід"], ["reg", "Реєстрація"]], L.mode === "admin" ? "login" : L.mode, v => { L.mode = v; renderLogin(); });
  const msg = h("div");
  const fail = er => msg.replaceChildren(h("div", { class: "msg err" }, er.message));
  let form;
  if (L.mode === "login") {
    form = h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault(); msg.replaceChildren(h("div", { class: "msg" }, "Перевіряємо…"));
      try { await afterAuth((await api("/api/login", { method: "POST", body: { name: $("#lgName").value, pin: $("#lgPin").value } })).token); } catch (er) { fail(er); }
    } },
      h("div", { class: "field" }, h("label", { for: "lgName" }, "Ім'я та прізвище"), h("input", { class: "inp", id: "lgName", autocomplete: "username", placeholder: "Олена Коваль", required: true })),
      h("div", { class: "field" }, h("label", { for: "lgPin" }, "PIN"), h("input", { class: "inp code", id: "lgPin", type: "password", inputmode: "numeric", autocomplete: "current-password", maxlength: "8", required: true })),
      msg, h("button", { class: "btn primary", type: "submit" }, "Увійти"),
      h("p", { class: "muted", style: "margin:0;font-size:13px" }, "Забули PIN? Попросіть керівника скинути його."),
      h("button", { class: "linkbtn", type: "button", style: "font-size:13px;align-self:flex-start", onclick: () => { L.mode = "admin"; renderLogin(); } }, "Вхід керівника за кодом"));
  } else if (L.mode === "admin") {
    form = h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault(); msg.replaceChildren(h("div", { class: "msg" }, "Перевіряємо…"));
      try { await afterAuth((await api("/api/login", { method: "POST", body: { code: $("#loginCode").value } })).token); } catch (er) { fail(er); }
    } },
      h("input", { class: "inp code", id: "loginCode", maxlength: "40", "aria-label": "Код входу", placeholder: "КОД" }),
      msg, h("button", { class: "btn primary", type: "submit" }, "Увійти"),
      h("button", { class: "linkbtn", type: "button", style: "font-size:13px;align-self:flex-start", onclick: () => { L.mode = "login"; renderLogin(); } }, "← Вхід менеджера"));
  } else if (!L.reg.ok) {
    form = h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault(); msg.replaceChildren(h("div", { class: "msg" }, "Перевіряємо…"));
      const teamCode = $("#rgTeam").value.trim();
      try { await api("/api/register/users", { method: "POST", body: { teamCode } }); L.reg = { teamCode, ok: true }; renderLogin(); } catch (er) { fail(er); }
    } },
      h("p", { class: "muted", style: "margin:0" }, "Введіть код команди. Його дає керівник."),
      h("input", { class: "inp code", id: "rgTeam", maxlength: "40", "aria-label": "Код команди", placeholder: "КОД КОМАНДИ", required: true }),
      msg, h("button", { class: "btn primary", type: "submit" }, "Далі"));
  } else {
    form = h("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      const pin = $("#rgPin").value, pin2 = $("#rgPin2").value;
      if (!/^\d{4,8}$/.test(pin)) { fail(new Error("PIN — від 4 до 8 цифр.")); return; }
      if (pin !== pin2) { fail(new Error("PIN-коди не збігаються.")); return; }
      msg.replaceChildren(h("div", { class: "msg" }, "Реєструємо…"));
      try {
        const r = await api("/api/register", { method: "POST", body: { teamCode: L.reg.teamCode, name: $("#rgName").value, pin } });
        L.reg = { teamCode: "", ok: false }; L.mode = "login"; await afterAuth(r.token);
      } catch (er) { fail(er); }
    } },
      h("div", { class: "field" }, h("label", { for: "rgName" }, "Ім'я та прізвище, як в Odoo"), h("input", { class: "inp", id: "rgName", autocomplete: "name", maxlength: "80", required: true, placeholder: "Олена Коваль" })),
      h("div", { class: "field" }, h("label", { for: "rgPin" }, "Придумайте PIN (4–8 цифр)"), h("input", { class: "inp code", id: "rgPin", type: "password", inputmode: "numeric", autocomplete: "new-password", maxlength: "8", required: true })),
      h("div", { class: "field" }, h("label", { for: "rgPin2" }, "Повторіть PIN"), h("input", { class: "inp code", id: "rgPin2", type: "password", inputmode: "numeric", autocomplete: "new-password", maxlength: "8", required: true })),
      msg, h("button", { class: "btn primary", type: "submit" }, "Зареєструватися"));
  }
  root.replaceChildren(h("div", { class: "login panel stack" },
    h("h2", { style: "margin:0" }, L.mode === "admin" ? "Вхід керівника" : "Білет за замовлення"),
    L.mode === "admin" ? null : tabs, form));
}
function pinChangeBox() {
  const msg = h("div");
  return h("form", { class: "panel stack", style: "max-width:420px", onsubmit: async e => {
    e.preventDefault();
    const pin = $("#npPin").value;
    if (!/^\d{4,8}$/.test(pin)) { msg.replaceChildren(h("div", { class: "msg err" }, "PIN — від 4 до 8 цифр.")); return; }
    try { await api("/api/pin", { method: "POST", body: { pin } }); S.data.me.pinReset = false; cabBuilt = null; show(); }
    catch (er) { msg.replaceChildren(h("div", { class: "msg err" }, er.message)); }
  } },
    h("h2", { style: "margin:0" }, "Придумайте новий PIN"),
    h("p", { class: "muted", style: "margin:0" }, "Керівник скинув ваш PIN. Задайте свій, щоб продовжити."),
    h("input", { class: "inp code", id: "npPin", type: "password", inputmode: "numeric", autocomplete: "new-password", maxlength: "8", required: true }),
    msg, h("button", { class: "btn primary", type: "submit" }, "Зберегти PIN"));
}

/* ---------- cabinet ---------- */
async function loadMe() { S.data = await api("/api/me"); }
let cabBuilt = null;
function renderCab() {
  const root = $("#vCab");
  if (S.data.me.pinReset) { root.replaceChildren(h("div", { style: "margin-top:24px" }, pinChangeBox())); cabBuilt = "pin"; return; }
  if (S.data.me.archived) { root.replaceChildren(h("div", { class: "center panel" }, h("h2", null, "Кабінет в архіві"), h("p", { class: "muted" }, "Отримати білети зараз не можна. Якщо це помилка, зверніться до керівника."))); cabBuilt = "arch"; return; }
  if (cabBuilt !== "main") {
    root.replaceChildren(h("div", { class: "cab" },
      h("div", { class: "stage" },
        h("form", { class: "getform", onsubmit: onGet },
          h("input", { class: "inp", id: "ordInp", maxlength: "40", placeholder: "Номер оформленого замовлення", autocomplete: "off", "aria-label": "Номер замовлення" }),
          h("button", { class: "btn primary", id: "getBtn", type: "submit" }, "Отримати білет")),
        h("div", { id: "getMsg" }), h("div", { id: "boostBox" }), h("div", { id: "ticketBox" })),
      h("aside", { class: "rail", id: "rail" })));
    cabBuilt = "main"; showTicket(S.ticket);
  }
  renderBoostBox(); renderRail();
}
function renderBoostBox() {
  const box = $("#boostBox"); if (!box) return; const l = S.data.boostLabels || [];
  box.replaceChildren(l.length ? h("div", { class: "boost" }, h("b", null, "Зараз діє бонус"), l.map(x => h("span", null, "· " + x))) : "");
}
function renderRail() {
  const rail = $("#rail"); if (!rail) return;
  const all = S.data.tickets; const N = S.data.goldEvery;
  const agg = per => { const ts = all.filter(t => inPeriod(t.dk, per)); return { n: ts.length, w: ts.filter(t => t.s).reduce((s, t) => s + t.a, 0), c: ts.filter(t => t.st === "c").reduce((s, t) => s + t.a, 0) }; };
  const A = { day: agg("day"), week: agg("week"), month: agg("month") };
  const done = N > 0 ? A.day.n % N : 0, left = N - done;
  const hist = all.filter(t => inPeriod(t.dk, S.per));
  rail.replaceChildren(
    h("div", { class: "panel" },
      h("div", { class: "muted", style: "font-size:13px;font-weight:700" }, "Менеджер"),
      h("div", { style: "font-family:var(--f-display);font-size:22px;margin-bottom:10px" }, S.data.me.name),
      h("table", { class: "stat num" },
        h("thead", null, h("tr", null, h("th", null, ""), h("th", { class: "r" }, "Сьогодні"), h("th", { class: "r" }, "Тиждень"), h("th", { class: "r" }, "Місяць"))),
        h("tbody", null,
          h("tr", null, h("td", null, "Замовлень"), ["day", "week", "month"].map(k => h("td", { class: "r" }, fmtN(A[k].n)))),
          h("tr", null, h("td", null, "Виграно"), ["day", "week", "month"].map(k => h("td", { class: "r" }, grn(A[k].w)))),
          h("tr", null, h("td", null, "Підтверджено"), ["day", "week", "month"].map(k => h("td", { class: "r" }, grn(A[k].c))))))),
    N > 0 ? h("div", { class: "panel" }, h("h3", null, "Золотий білет"),
      h("div", { class: "dots", "aria-hidden": "true" }, Array.from({ length: N }, (_, i) => h("i", { class: i < done ? "on" : "" }))),
      h("div", { class: "num" }, `До золотого білета: ${left} ${plural(left, "замовлення", "замовлення", "замовлень")}`)) : null,
    h("div", { class: "panel" },
      h("div", { class: "bar", style: "justify-content:space-between;margin-bottom:8px" }, h("h3", { style: "margin:0" }, "Мої білети"), seg([["day", "День"], ["week", "Тиждень"], ["month", "Місяць"]], S.per, v => { S.per = v; renderRail(); })),
      hist.length ? h("div", { class: "hist" }, hist.map(t => h("div", { class: "hrow" },
        h("span", { class: "muted num", style: "font-size:13px" }, S.per === "day" ? timeFmt.format(new Date(t.t)) : t.dk.slice(8) + "." + t.dk.slice(5, 7)),
        h("span", { class: "o", title: t.o }, t.o),
        t.s ? prizeChip(t) : h("button", { class: "btn sm", onclick: () => openTicket(t) }, "стерти"),
        t.s && t.st ? h("span", { class: "st " + t.st, title: t.stage ? "Етап в Odoo: " + t.stage : "" }, ST_LABEL[t.st]) : h("span"))))
        : h("p", { class: "muted", style: "margin:0" }, "Тут з'являться ваші білети за обраний період.")));
}
function setGetMsg(text, kind) { const m = $("#getMsg"); if (m) m.replaceChildren(text ? h("div", { class: "msg " + (kind || "") }, text) : ""); }
let busy = false;
async function onGet(e) {
  e.preventDefault(); if (busy) return;
  const raw = $("#ordInp").value.trim();
  if (!raw) { setGetMsg("Введіть номер замовлення.", "err"); return; }
  busy = true; $("#getBtn").disabled = true; setGetMsg("Перевіряємо замовлення в Odoo…");
  try {
    const r = await api("/api/ticket", { method: "POST", body: { order: raw } });
    const t = r.ticket;
    if (!S.data.tickets.some(x => x.id === t.id)) S.data.tickets.unshift(t);
    setGetMsg(r.existing ? (t.s ? "Цей білет ви вже відкрили." : "Це ваш нестертий білет. Зітріть його.") : "", r.existing ? "ok" : "");
    $("#ordInp").value = ""; openTicket(t); renderRail();
    loadMe().then(() => { $("#jpVal").textContent = grn(S.data.jackpot); renderRail(); }).catch(() => {});
  } catch (er) { setGetMsg(er.message, "err"); }
  finally { busy = false; const b = $("#getBtn"); if (b) b.disabled = false; }
}

/* ---------- ticket & scratch ---------- */
function openTicket(t) { S.ticket = t; showTicket(t); const b = $("#ticketBox"); if (b) b.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "nearest" }); }
function showTicket(t) {
  const box = $("#ticketBox"); if (!box) return;
  if (!t) { box.replaceChildren(h("div", { class: "placeholder" }, h("b", null, "Білет з'явиться тут"), "Оформили замовлення? Введіть його номер вище і зітріть захисний шар.")); return; }
  const flags = [];
  if (t.g) flags.push("Золотий білет");
  if (t.c !== 1) flags.push("Шанси " + mult(t.c));
  if (t.p !== 1) flags.push("Призи " + mult(t.p));
  if (t.n) flags.push("Без порожніх");
  if (t.j !== 1) flags.push("Джекпот " + mult(t.j));
  const tr = tier(t.a, t.y);
  const prize = h("div", { class: "prize" },
    t.y === 2 ? h("div", { class: "sub", style: "font-size:14px;letter-spacing:.1em;text-transform:uppercase" }, "Джекпот!") : null,
    h("div", { class: "amt num" }, t.a ? grn(t.a) : "Порожньо"),
    h("div", { class: "sub" }, t.a ? "Виплата після підтвердження замовлення" : "Наступне замовлення — новий шанс"));
  const cv = h("canvas", { class: "scr", "aria-label": "Захисний шар. Зітріть пальцем або мишкою" });
  const fx = h("div", { class: "fx" });
  const pb = h("div", { class: "prizebox", style: `--pc:${tierVar(tr)}` }, prize, cv, fx);
  const openBtn = h("button", { class: "btn sm", type: "button" }, "Відкрити одразу");
  const status = h("span", null, t.s ? "Білет відкрито" : "Зітріть поле, щоб дізнатися приз");
  const card = h("article", { class: "ticket" + (t.g ? " gold" : "") },
    h("div", { class: "t-head" },
      h("div", null, h("div", { class: "t-name" }, t.g ? "Золотий білет" : "Білет за замовлення"), h("div", { class: "t-ord" }, "Замовлення № " + t.o)),
      h("div", { class: "t-serial" }, dtFmt.format(new Date(t.t)), h("br"), "№ " + String(t.id).padStart(7, "0"))),
    flags.length ? h("div", { class: "t-flags" }, flags.map(f => h("span", { class: "t-flag" }, f))) : h("div", { style: "height:14px" }),
    pb, h("div", { class: "t-foot" }, status, t.s ? null : openBtn));
  box.replaceChildren(card);
  if (t.s) { pb.classList.add("ready", "open"); return; }
  let opened = false;
  const reveal = () => {
    if (opened) return; opened = true; pb.classList.add("open"); openBtn.remove(); status.textContent = "Білет відкрито";
    t.s = true; renderRail();
    api(`/api/ticket/${t.id}/scratch`, { method: "POST" }).catch(() => {});
    if (t.a > 0 && !reduce()) { sparks(fx, tr); if (t.f) fireworks(fx, tr); }
  };
  openBtn.addEventListener("click", reveal);
  requestAnimationFrame(() => setupScratch(cv, pb, !!t.g, reveal));
}
function setupScratch(cv, pb, gold, done) {
  const r = pb.getBoundingClientRect(), dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
  const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.scale(dpr, dpr);
  const g = ctx.createLinearGradient(0, 0, W, H);
  if (gold) { g.addColorStop(0, "#f6dd7a"); g.addColorStop(.5, "#c9a227"); g.addColorStop(1, "#f1d16a"); }
  else { g.addColorStop(0, "#d9dde0"); g.addColorStop(.5, "#a9b0b5"); g.addColorStop(1, "#d3d8db"); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < W * H / 18; i++) { ctx.fillStyle = rnd() < .5 ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.07)"; ctx.fillRect(rnd() * W, rnd() * H, 1.4, 1.4); }
  ctx.fillStyle = gold ? "rgba(70,48,0,.55)" : "rgba(40,48,52,.5)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `400 ${Math.min(30, W / 9)}px "Russo One", "Arial Black", sans-serif`;
  ctx.fillText("Зітріть тут", W / 2, H / 2);
  pb.classList.add("ready");
  ctx.globalCompositeOperation = "destination-out"; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 38;
  let down = false, last = null, finished = false, checkT = 0;
  const pos = e => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * (W / b.width), y: (e.clientY - b.top) * (H / b.height) }; };
  const check = () => {
    if (finished) return;
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data; let clr = 0, tot = 0; const step = (8 * dpr) | 0;
    for (let y = 0; y < cv.height; y += step) for (let x = 0; x < cv.width; x += step) { tot++; if (d[(y * cv.width + x) * 4 + 3] < 128) clr++; }
    if (clr / tot > 0.55) { finished = true; done(); }
  };
  cv.addEventListener("pointerdown", e => { down = true; last = pos(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 19, 0, Math.PI * 2); ctx.fill(); });
  cv.addEventListener("pointermove", e => {
    if (!down) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p;
    const n = performance.now(); if (n - checkT > 180) { checkT = n; check(); }
  });
  const up = () => { if (!down) return; down = false; check(); };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
}
const cssColor = tr => getComputedStyle(document.documentElement).getPropertyValue("--t-" + tr).trim() || "#c49a1e";
function sparks(fx, tr) {
  const col = cssColor(tr), n = 9 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const s = h("span", { class: "spark" }); s.style.background = col; fx.append(s);
    const a = rnd() * Math.PI * 2, d = 50 + rnd() * 90;
    s.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.3)`, opacity: 0 }],
      { duration: 900 + rnd() * 250, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).onfinish = () => s.remove();
  }
}
function fireworks(fx, tr) {
  const col = cssColor(tr), goldC = cssColor("gold");
  const cv = h("canvas", { style: "position:absolute;inset:0;width:100%;height:100%" }); fx.append(cv);
  const r = fx.getBoundingClientRect(), dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
  cv.width = r.width * dpr; cv.height = r.height * dpr; const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const P = [];
  for (let b = 0; b < 5; b++) {
    const delay = b * 260, cx = r.width * (0.15 + rnd() * 0.7), cy = r.height * (0.25 + rnd() * 0.4);
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2, sp = 0.9 + rnd() * 1.4; P.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: i % 4 === 0 ? goldC : col, d: delay, life: 900 + rnd() * 300 }); }
  }
  const t0 = performance.now();
  const step = now => {
    const el = now - t0; ctx.clearRect(0, 0, r.width, r.height); let alive = false;
    for (const p of P) {
      const t = el - p.d; if (t < 0) { alive = true; continue; } if (t > p.life) continue; alive = true;
      const k = t / 16;
      ctx.globalAlpha = 1 - t / p.life; ctx.fillStyle = p.c; ctx.beginPath();
      ctx.arc(p.x + p.vx * k * 1.6, p.y + p.vy * k * 1.6 + 0.0009 * t * t / 16, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    if (alive && el < 2400) requestAnimationFrame(step); else cv.remove();
  };
  requestAnimationFrame(step);
}

/* ---------- rating ---------- */
async function renderRate() {
  const root = $("#vRate");
  const head = h("div", { class: "rate-head" }, h("h2", { style: "margin:0" }, "Рейтинг менеджерів"), seg([["day", "Сьогодні"], ["week", "Тиждень"], ["month", "Місяць"]], S.ratePer, v => { S.ratePer = v; renderRate(); }));
  root.replaceChildren(head, h("p", { class: "muted" }, "Завантажуємо…"));
  let rows;
  try { rows = (await api("/api/rating?period=" + S.ratePer)).rows; }
  catch (er) { root.replaceChildren(head, h("div", { class: "msg err" }, er.message)); return; }
  root.replaceChildren(head, rows.length ? h("div", { class: "tscroll" }, h("table", null,
    h("thead", null, h("tr", null, h("th", null, "Місце"), h("th", null, "Менеджер"), h("th", { class: "r" }, "Замовлень"), h("th", { class: "r" }, "Виграно"))),
    h("tbody", null, rows.map((r, i) => h("tr", { class: r.id === S.data.me.id ? "today-row" : "" },
      h("td", null, h("span", { class: "place" + (i === 0 ? " p1" : "") }, String(i + 1))),
      h("td", null, r.name), h("td", { class: "r num" }, fmtN(r.n)), h("td", { class: "r num" }, grn(r.w)))))))
    : h("div", { class: "placeholder" }, h("b", null, "Поки порожньо"), "Рейтинг заповниться, щойно менеджери отримають перші білети за цей період."));
}

/* ---------- admin ---------- */
const A = S.adm;
function cards(r) {
  const avg = r.n ? r.tot / r.n : 0;
  return h("div", { class: "cards num" },
    h("div", { class: "card" }, h("small", null, "Замовлень"), h("b", null, fmtN(r.n))),
    h("div", { class: "card" }, h("small", null, "Очікують перевірки"), h("b", null, grn(r.pw)), h("span", null, `${fmtN(r.pwn)} ${plural(r.pwn, "виграш", "виграші", "виграшів")}`)),
    h("div", { class: "card" }, h("small", null, "Підтверджено до виплати"), h("b", { style: "color:var(--ok)" }, grn(r.c))),
    h("div", { class: "card" }, h("small", null, "Згоріло через скасування"), h("b", { style: "color:var(--danger)" }, grn(r.x))),
    h("div", { class: "card" }, h("small", null, "Середня вартість білета"), h("b", null, (Math.round(avg * 10) / 10).toLocaleString("uk-UA") + " грн")));
}
function perPicker(onChange) {
  const cur = monthKey(); const months = Array.from({ length: 17 }, (_, i) => prevMonth(cur, i + 1));
  return h("div", { class: "bar" },
    seg([["day", "Сьогодні"], ["week", "Тиждень"], ["month", "Місяць"]], A.per, v => { A.per = v; A.sel.clear(); onChange(); }),
    h("select", { class: "inp", id: "admMonth", style: "width:auto", onchange: e => { if (e.target.value) { A.per = e.target.value; A.sel.clear(); onChange(); } } },
      h("option", { value: "" }, "Минулий місяць…"), months.map(m => h("option", { value: m, selected: A.per === m }, monthName(m)))));
}
const setMsg = (m) => { A.msg = m; };
async function renderAdm(reload) {
  const root = $("#vAdm");
  const tabs = [["orders", "Менеджери і замовлення"], ["boost", "Бонуси і розклад"], ["prizes", "Призи і шанси"], ["data", "Дані"]];
  const head = h("div", { class: "subtabs" }, seg(tabs, A.tab, v => { A.tab = v; A.mgr = null; A.msg = ""; A.confirm = null; A.newCode = null; renderAdm(true); }));
  const msg = A.msg ? h("div", { class: "msg", style: "margin-bottom:12px" }, A.msg) : "";
  if (reload) root.replaceChildren(head, msg, h("p", { class: "muted" }, "Завантажуємо…"));
  let body;
  try {
    if (A.tab === "orders") {
      if (A.mgr) { if (reload || !A.detail) A.detail = await api(`/api/admin/tickets?period=${A.per}&manager_id=${A.mgr}`); body = admManager(); }
      else {
        if (reload || !A.summary) A.summary = await api(`/api/admin/summary?period=${A.per}`);
        if (A.teamCode === undefined) { try { A.teamCode = (await api("/api/admin/config")).teamCode; } catch (_) { A.teamCode = null; } }
        if (!A.odooUsers) loadOdooUsers(); body = admOrders();
      }
    } else {
      if (reload || !A.cfg) A.cfg = await api("/api/admin/config");
      body = A.tab === "boost" ? admBoost() : A.tab === "prizes" ? admPrizes() : admData();
    }
  } catch (er) { body = h("div", { class: "msg err" }, er.message); }
  root.replaceChildren(head, A.msg ? h("div", { class: "msg", style: "margin-bottom:12px" }, A.msg) : "", body);
}
async function loadOdooUsers() {
  try { const r = await api("/api/admin/odoo-users"); A.odooUsers = r.rows; } catch (_) { A.odooUsers = []; }
  if (A.tab === "orders" && !A.mgr && S.view === "adm") renderAdm(false);
}
function odooSelect(id, val) {
  const list = A.odooUsers || [];
  return h("select", { class: "inp", id },
    h("option", { value: "" }, list.length ? "Не прив'язано" : "Список Odoo недоступний"),
    list.map(u => h("option", { value: u.id, selected: Number(val) === u.id }, u.name)));
}
function admOrders() {
  const rows = A.summary.rows.filter(r => A.showArch || !r.archived);
  const tot = rows.reduce((s, r) => { for (const k of ["n", "pw", "pwn", "c", "x", "tot"]) s[k] += r[k]; return s; }, { n: 0, pw: 0, pwn: 0, c: 0, x: 0, tot: 0 });
  const addMsg = h("div");
  const add = h("form", { class: "panel stack", onsubmit: async e => {
    e.preventDefault();
    try {
      const r = await api("/api/admin/managers", { method: "POST", body: { name: $("#nmName").value, phone: $("#nmPhone").value, odoo_user_id: $("#nmOdoo").value } });
      A.newCode = { name: $("#nmName").value.trim(), code: r.code }; renderAdm(true);
    } catch (er) { addMsg.replaceChildren(h("div", { class: "msg err" }, er.message)); }
  } },
    h("h2", { style: "margin:0" }, "Додати менеджера"),
    h("div", { class: "cols2", style: "grid-template-columns:repeat(auto-fit,minmax(200px,1fr))" },
      h("div", { class: "field" }, h("label", { for: "nmName" }, "Ім'я та прізвище"), h("input", { class: "inp", id: "nmName", required: true, minlength: "2", maxlength: "80" })),
      h("div", { class: "field" }, h("label", { for: "nmPhone" }, "Телефон (необов'язково)"), h("input", { class: "inp", id: "nmPhone", type: "tel", maxlength: "30" })),
      h("div", { class: "field" }, h("label", { for: "nmOdoo" }, "Користувач в Odoo"), odooSelect("nmOdoo", null))),
    addMsg, h("div", null, h("button", { class: "btn primary", type: "submit" }, "Створити й отримати код")));
  const tc = A.teamCode;
  const invite = h("div", { class: "panel stack" },
    h("h2", { style: "margin:0" }, "Як менеджерам приєднатися"),
    tc ? h("div", { class: "stack", style: "gap:8px" },
      h("div", null, "Надішліть менеджерам посилання і код команди. Вони самі зареєструються: ім'я та прізвище, як в Odoo, і PIN."),
      h("div", { class: "bar" }, h("span", { class: "muted" }, "Код команди:"), h("span", { class: "codebox" }, tc)),
      h("div", { class: "mono", style: "word-break:break-all" }, location.href.split("#")[0]),
      h("div", null, h("button", { class: "btn sm", onclick: async e => { const t = `Гра «Білет за замовлення»\n${location.href.split("#")[0]}\nКод команди: ${tc}\nЗареєструйтеся: ім'я та прізвище, як в Odoo, і придумайте PIN.`; try { await navigator.clipboard.writeText(t); e.target.textContent = "Скопійовано"; } catch (_) { e.target.textContent = "Не вдалося скопіювати"; } } }, "Скопіювати запрошення")))
      : h("div", { class: "msg err" }, "Реєстрацію вимкнено: на сервері не задано TEAM_CODE. Додайте змінну TEAM_CODE у Railway."));
  return h("div", { class: "stack" },
    A.newCode ? codeNotice(A.newCode.name, A.newCode.code, A.newCode.pin) : null,
    h("div", { class: "bar", style: "justify-content:space-between" }, perPicker(() => renderAdm(true)),
      h("label", { class: "bar", style: "gap:6px;font-weight:600" }, h("input", { type: "checkbox", id: "showArch", checked: A.showArch, onchange: e => { A.showArch = e.target.checked; renderAdm(false); } }), "Показати архів")),
    cards(tot),
    rows.length ? h("div", { class: "tscroll" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, "Менеджер"), h("th", { class: "r" }, "Замовлень"), h("th", { class: "r" }, "Очікує"), h("th", { class: "r" }, "Підтверджено"), h("th", { class: "r" }, "Згоріло"), h("th", null, "Останнє замовлення"))),
      h("tbody", null, rows.map(r => h("tr", null,
        h("td", null, h("button", { class: "linkbtn", onclick: () => { A.mgr = r.id; A.sel.clear(); A.confirm = null; A.newCode = null; A.detail = null; renderAdm(true); } }, r.name),
          r.is_admin ? h("span", { class: "tag" }, "керівник") : null, r.archived ? h("span", { class: "tag" }, "архів") : null, !r.odoo_user_id && !r.is_admin ? h("span", { class: "tag" }, "без Odoo") : null,
          r.phone ? h("div", { class: "muted num", style: "font-size:12px" }, fmtPhone(r.phone)) : null),
        h("td", { class: "r num" }, fmtN(r.n)), h("td", { class: "r num" }, grn(r.pw)), h("td", { class: "r num" }, grn(r.c)), h("td", { class: "r num" }, grn(r.x)),
        h("td", { class: "num muted" }, r.last ? dtFmt.format(new Date(r.last)) : "—")))))) : null,
    invite,
    h("details", null, h("summary", { class: "muted", style: "cursor:pointer;font-weight:700" }, "Додати менеджера вручну"), h("div", { style: "margin-top:12px" }, add)));
}
function codeNotice(name, code, isPin) {
  return h("div", { class: "confirm", style: "flex-direction:column;align-items:flex-start" },
    h("div", null, isPin ? `Тимчасовий PIN для «${name}». Передайте його менеджеру: він увійде зі своїм ім'ям і цим PIN, а потім задасть новий.` : `Код входу для «${name}». Передайте його особисто. Повторно цей код не показується.`),
    h("span", { class: "codebox" }, code),
    h("div", { class: "bar" },
      h("button", { class: "btn sm", onclick: async e => { try { await navigator.clipboard.writeText(code); e.target.textContent = "Скопійовано"; } catch (_) { e.target.textContent = "Виділіть код вручну"; } } }, "Скопіювати"),
      h("button", { class: "btn sm", onclick: () => { A.newCode = null; renderAdm(false); } }, "Готово")));
}
function admManager() {
  const D = A.detail; const m = (A.summary && A.summary.rows.find(r => r.id === A.mgr)) || {};
  const ts = D.tickets; const sel = A.sel;
  const selT = ts.filter(t => sel.has(t.id));
  const selCount = sel.size;
  const selSum = selT.reduce((s, t) => s + t.a, 0);
  const editMsg = h("div");
  return h("div", { class: "stack" },
    h("div", null, h("button", { class: "linkbtn", onclick: () => { A.mgr = null; A.newCode = null; renderAdm(true); } }, "← Усі менеджери")),
    A.newCode ? codeNotice(A.newCode.name, A.newCode.code, A.newCode.pin) : null,
    h("div", { class: "panel stack" },
      h("div", { class: "bar", style: "justify-content:space-between" },
        h("div", null, h("h2", { style: "margin:0" }, m.name || "Менеджер", m.archived ? h("span", { class: "tag" }, "архів") : null),
          h("div", { class: "muted num" }, [m.phone ? fmtPhone(m.phone) : "Телефон не вказано", m.created_at ? "Зареєстровано " + dFmt.format(new Date(m.created_at)) : ""].filter(Boolean).join(" · "))),
        h("div", { class: "bar" },
          !m.is_admin
            ? h("button", { class: "btn", onclick: async () => { try { const r = await api(`/api/admin/managers/${A.mgr}/pin`, { method: "POST" }); A.newCode = { name: m.name, code: r.pin, pin: true }; renderAdm(false); } catch (er) { setMsg(er.message); renderAdm(false); } } }, "Скинути PIN")
            : h("button", { class: "btn", onclick: async () => { try { const r = await api(`/api/admin/managers/${A.mgr}/code`, { method: "POST" }); A.newCode = { name: m.name, code: r.code }; renderAdm(false); } catch (er) { setMsg(er.message); renderAdm(false); } } }, "Новий код входу"),
          m.is_admin ? null : h("button", { class: "btn", onclick: async () => { try { await api(`/api/admin/managers/${A.mgr}`, { method: "PATCH", body: { archived: !m.archived } }); A.summary = null; await renderAdm(true); } catch (er) { setMsg(er.message); renderAdm(false); } } }, m.archived ? "Повернути з архіву" : "Перенести в архів"))),
      h("form", { class: "bar", onsubmit: async e => {
        e.preventDefault();
        try { await api(`/api/admin/managers/${A.mgr}`, { method: "PATCH", body: { odoo_user_id: $("#mgOdoo").value } }); m.odoo_user_id = Number($("#mgOdoo").value) || null; editMsg.replaceChildren(h("span", { class: "muted" }, "Збережено")); }
        catch (er) { editMsg.replaceChildren(h("span", { class: "msg err" }, er.message)); }
      } }, h("label", { for: "mgOdoo", style: "font-weight:700" }, "Користувач в Odoo"), h("div", { style: "min-width:220px" }, odooSelect("mgOdoo", m.odoo_user_id)), h("button", { class: "btn sm", type: "submit" }, "Зберегти"), editMsg)),
    perPicker(() => { A.detail = null; renderAdm(true); }),
    cards(D.summary),
    ts.length ? h("div", { class: "tscroll" }, h("table", null,
      h("thead", null, h("tr", null, h("th", null, ""), h("th", null, "Дата і час"), h("th", null, "Замовлення"), h("th", null, "Приз"), h("th", null, "Умови"), h("th", null, "Етап Odoo"), h("th", null, "Статус"))),
      h("tbody", null, ts.map(t => {
        const cond = [t.g ? "золотий" : "", t.c !== 1 ? "шанси " + mult(t.c) : "", t.p !== 1 ? "призи " + mult(t.p) : "", t.n ? "без порожніх" : "", t.j !== 1 ? "джекпот " + mult(t.j) : ""].filter(Boolean).join(", ") || "звичайні";
        return h("tr", null,
          h("td", null, t.st ? h("input", { type: "checkbox", id: "c_" + t.id, "aria-label": "Вибрати " + t.o, checked: sel.has(t.id), onchange: e => { e.target.checked ? sel.add(t.id) : sel.delete(t.id); renderAdm(false); } }) : null),
          h("td", { class: "num", style: "white-space:nowrap" }, dtFmt.format(new Date(t.t))),
          h("td", { class: "mono" }, t.o),
          h("td", null, prizeChip(t, t.s ? null : h("span", { style: "font-weight:600;opacity:.8" }, "· не стертий"))),
          h("td", { class: "muted", style: "font-size:13px" }, cond),
          h("td", { class: "muted", style: "font-size:13px" }, t.stage || "—"),
          h("td", null, t.st ? h("select", { class: "inp", style: "padding:4px 8px;width:auto", id: "s_" + t.id, "aria-label": "Статус", onchange: e => setStatus([t.id], e.target.value) },
            Object.entries(ST_LABEL).map(([k, l]) => h("option", { value: k, selected: k === t.st }, l))) : h("span", { class: "muted" }, "—")));
      })))) : h("div", { class: "placeholder" }, "За цей період замовлень немає."),
    D.summary.n > ts.length ? h("p", { class: "muted" }, `Показано останні ${fmtN(ts.length)} з ${fmtN(D.summary.n)} замовлень. Масові дії застосовуються до всіх вибраних.`) : null,
    h("p", { class: "muted", style: "margin:0" }, "Статуси ставляться автоматично за Odoo: «Завершено» підтверджує виграш, відмова спалює приз. Змінений вручну статус автоматика більше не чіпає."),
    A.confirm ? h("div", { class: "confirm" }, A.confirm.text,
      h("button", { class: "btn sm primary", onclick: async () => { const c = A.confirm; A.confirm = null; await setStatus(c.ids, c.to); sel.clear(); } }, "Так"),
      h("button", { class: "btn sm", onclick: () => { A.confirm = null; renderAdm(false); } }, "Ні")) : null,
    h("div", { class: "bulk" },
      h("button", { class: "btn sm", onclick: () => { D.pendingIds.forEach(id => sel.add(id)); renderAdm(false); } }, "Вибрати всі, що очікують"),
      h("button", { class: "btn sm", onclick: () => { sel.clear(); renderAdm(false); } }, "Зняти вибір"),
      h("button", { class: "btn sm primary", disabled: !selCount, onclick: () => { A.confirm = { ids: [...sel], to: "c", text: `Підтвердити ${selCount} ${plural(selCount, "виграш", "виграші", "виграшів")}?` }; renderAdm(false); } }, "Підтвердити вибрані"),
      h("button", { class: "btn sm danger", disabled: !selCount, onclick: () => { A.confirm = { ids: [...sel], to: "x", text: `Скасувати ${selCount} ${plural(selCount, "виграш", "виграші", "виграшів")}? Призи згорять.` }; renderAdm(false); } }, "Скасувати вибрані"),
      h("span", { class: "num", style: "margin-left:auto;font-weight:700" }, `Вибрано: ${selCount}` + (selT.length === selCount ? ` на ${grn(selSum)}` : ""))));
}
async function setStatus(ids, status) {
  try { await api("/api/admin/tickets/status", { method: "POST", body: { ids, status } }); A.msg = ""; }
  catch (er) { A.msg = er.message; }
  A.summary = null; await renderAdm(true);
}
/* boosts & schedule */
function admBoost() {
  const C = A.cfg.config; const draft = { week: C.week.map(w => ({ ...w })), specials: C.specials.map(s => ({ ...s })) };
  const wkBody = h("tbody"), spBody = h("tbody"), saveMsg = h("span", { class: "muted" });
  const today = wdIdx(dateKey());
  wkBody.replaceChildren(...draft.week.map((w, i) => h("tr", { class: i === today ? "today-row" : "" },
    h("td", null, WD[i], i === today ? h("span", { class: "tag" }, "сьогодні") : null),
    h("td", null, h("input", { class: "inp small-inp num", id: "wc" + i, type: "number", step: "0.1", min: "0", value: w.c, oninput: e => w.c = parseFloat(e.target.value) || 1, "aria-label": "Шанси " + WD[i] })),
    h("td", null, h("input", { class: "inp small-inp num", id: "wp" + i, type: "number", step: "0.1", min: "0", value: w.p, oninput: e => w.p = parseFloat(e.target.value) || 1, "aria-label": "Призи " + WD[i] })))));
  const drawSp = () => spBody.replaceChildren(...draft.specials.map((s, i) => h("tr", null,
    h("td", null, h("input", { class: "inp", id: "sd" + i, type: "date", value: s.date || "", oninput: e => s.date = e.target.value, style: "min-width:140px" })),
    h("td", null, h("input", { class: "inp", id: "sn" + i, value: s.name || "", placeholder: "День зарплати", oninput: e => s.name = e.target.value, style: "min-width:140px" })),
    h("td", null, h("input", { class: "inp small-inp num", id: "sc" + i, type: "number", step: "0.1", min: "0", value: s.c, oninput: e => s.c = parseFloat(e.target.value) || 1 })),
    h("td", null, h("input", { class: "inp small-inp num", id: "sp" + i, type: "number", step: "0.1", min: "0", value: s.p, oninput: e => s.p = parseFloat(e.target.value) || 1 })),
    h("td", null, h("button", { class: "btn sm danger", type: "button", onclick: () => { draft.specials.splice(i, 1); drawSp(); } }, "Видалити")))));
  drawSp();
  const boosts = A.cfg.boosts, names = A.cfg.boostNames;
  const DESC = { c2: "призові білети випадають удвічі частіше", c15: "м'який бонус для звичайного дня", p2: "грошові призи подвоюються", p3: "для особливих днів і розпродажів", ne: "кожен білет із призом", jp5: "підігріти інтерес до джекпоту", happy: "шанси й призи ×2 рівно на 1 годину" };
  return h("div", { class: "stack" },
    h("div", { class: "panel" }, h("h2", null, "Швидкі бонуси"),
      h("div", { class: "bar", style: "margin-bottom:12px" }, h("label", { for: "boostDur", style: "font-weight:700" }, "Тривалість"),
        h("select", { class: "inp", id: "boostDur", style: "width:auto" }, h("option", { value: "1h" }, "1 година"), h("option", { value: "3h" }, "3 години"), h("option", { value: "day", selected: true }, "До кінця дня"), h("option", { value: "week" }, "До кінця тижня")),
        h("span", { class: "muted" }, "Діє для всіх менеджерів одразу.")),
      h("div", { class: "boostgrid" }, Object.keys(names).map(k => h("button", { class: "boostbtn", onclick: async () => {
        try { const r = await api("/api/admin/boosts", { method: "POST", body: { type: k, duration: $("#boostDur").value } }); A.cfg.boosts = r.boosts; renderAdm(false); } catch (er) { setMsg(er.message); renderAdm(false); }
      } }, h("b", null, names[k]), h("span", null, DESC[k] || "")))),
      h("h3", { style: "margin-top:18px" }, "Зараз діють"),
      boosts.length ? h("div", { class: "stack", style: "gap:8px" }, boosts.map(b => h("div", { class: "bar", style: "justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:8px 12px" },
        h("span", null, h("b", null, names[b.type]), h("span", { class: "muted num" }, " · до " + dtFmt.format(new Date(b.until)))),
        h("button", { class: "btn sm", onclick: async () => { try { const r = await api("/api/admin/boosts/" + b.id, { method: "DELETE" }); A.cfg.boosts = r.boosts; renderAdm(false); } catch (er) { setMsg(er.message); renderAdm(false); } } }, "Вимкнути"))))
        : h("p", { class: "muted", style: "margin:0" }, "Активних бонусів немає.")),
    h("div", { class: "cols2" },
      h("div", { class: "panel" }, h("h2", null, "Розклад по днях тижня"),
        h("div", { class: "tscroll" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "День"), h("th", null, "Шанси ×"), h("th", null, "Призи ×"))), wkBody))),
      h("div", { class: "panel" }, h("h2", null, "Особливі дати"),
        h("p", { class: "muted", style: "margin-top:0" }, "Свято, акція, день зарплати. Множники перемножуються з розкладом і швидкими бонусами."),
        h("div", { class: "tscroll" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Дата"), h("th", null, "Назва"), h("th", null, "Шанси ×"), h("th", null, "Призи ×"), h("th", null, ""))), spBody)),
        h("button", { class: "btn sm", type: "button", style: "margin-top:10px", onclick: () => { draft.specials.push({ date: dateKey(), name: "", c: 1, p: 1 }); drawSp(); } }, "Додати дату"))),
    h("div", { class: "bar" }, h("button", { class: "btn primary", onclick: async () => {
      try { const r = await api("/api/admin/config", { method: "PUT", body: { week: draft.week, specials: draft.specials.filter(s => s.date) } }); A.cfg.config = r.config; saveMsg.textContent = "Розклад збережено"; }
      catch (er) { saveMsg.textContent = er.message; }
    } }, "Зберегти розклад"), saveMsg));
}
/* prizes */
function admPrizes() {
  const C = A.cfg.config; const D = { prizes: C.prizes.map(p => ({ ...p })), jp: { ...C.jp }, goldEvery: C.goldEvery };
  const tb = h("tbody"), calc = h("div"), saveMsg = h("span", { class: "muted" });
  const chip = (x, i, sum) => {
    const fw = x.a > 0 && x.p / (sum || 100) * 100 < 5;
    return h("span", { id: "pc" + i, class: "bar", style: "gap:6px" }, h("span", { class: "chip", style: `--c:${tierVar(tier(x.a, 1))}` }, x.a > 0 ? grn(x.a) : "Порожньо"), fw ? h("span", { class: "tag", style: "margin:0" }, "феєрверк") : null);
  };
  const recalc = () => {
    const sum = D.prizes.reduce((s, x) => s + x.p, 0) + D.jp.p;
    const exp = D.prizes.reduce((s, x) => s + x.a * x.p / 100, 0) + D.jp.start * D.jp.p / 100;
    const ok = Math.abs(sum - 100) < 0.001;
    calc.replaceChildren(h("div", { class: "calc num" },
      h("div", { class: "card" }, h("small", null, "Сума шансів"), h("b", { style: `color:${ok ? "var(--ok)" : "var(--danger)"}` }, pct(sum)), h("span", null, ok ? "Усе гаразд" : "Має бути 100%. Інакше шанси перерахуються пропорційно.")),
      h("div", { class: "card" }, h("small", null, "Середня вартість білета"), h("b", null, (Math.round(exp * 10) / 10).toLocaleString("uk-UA") + " грн"), h("span", null, "у звичайний день, без бонусів")),
      h("div", { class: "card" }, h("small", null, "Прогноз на менеджера"), h("b", null, grn(exp * 10 * 22)), h("span", null, "на місяць: 10 замовлень × 22 дні"))));
    D.prizes.forEach((x, i) => { const el = $("#pc" + i); if (el) el.replaceWith(chip(x, i, sum)); });
  };
  const drawRows = () => {
    tb.replaceChildren(...D.prizes.map((x, i) => h("tr", null,
      h("td", null, h("input", { class: "inp small-inp num", id: "pa" + i, type: "number", min: "0", step: "1", value: x.a, oninput: e => { x.a = Math.max(0, parseFloat(e.target.value) || 0); recalc(); }, "aria-label": "Сума" })),
      h("td", null, h("input", { class: "inp small-inp num", id: "pp" + i, type: "number", min: "0", step: "0.1", value: x.p, oninput: e => { x.p = Math.max(0, parseFloat(e.target.value) || 0); recalc(); }, "aria-label": "Шанс" })),
      h("td", null, h("span", { id: "pc" + i })),
      h("td", null, h("button", { class: "btn sm danger", type: "button", onclick: () => { D.prizes.splice(i, 1); drawRows(); } }, "Видалити")))));
    requestAnimationFrame(recalc);
  };
  const num = (id, label, val, step, on) => h("div", { class: "field" }, h("label", { for: id }, label), h("input", { class: "inp num", id, type: "number", min: "0", step, value: val, oninput: e => { on(Math.max(0, parseFloat(e.target.value) || 0)); recalc(); } }));
  drawRows();
  return h("div", { class: "stack" },
    h("div", { class: "cols2" },
      h("div", { class: "panel" }, h("h2", null, "Таблиця призів"),
        h("p", { class: "muted", style: "margin-top:0" }, "Сума 0 означає порожній білет. Колір мітки залежить від суми, «феєрверк» для призів із шансом менше 5%."),
        h("div", { class: "tscroll" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Сума, грн"), h("th", null, "Шанс, %"), h("th", null, "Мітка"), h("th", null, ""))), tb)),
        h("button", { class: "btn sm", type: "button", style: "margin-top:10px", onclick: () => { D.prizes.push({ a: 0, p: 0 }); drawRows(); } }, "Додати рядок")),
      h("div", { class: "panel stack" }, h("h2", { style: "margin:0" }, "Джекпот і золотий білет"),
        num("jpP", "Шанс джекпоту, %", D.jp.p, "0.01", v => D.jp.p = v),
        num("jpS", "Стартовий джекпот, грн", D.jp.start, "1", v => D.jp.start = v),
        num("jpI", "Приріст джекпоту з кожного замовлення, грн", D.jp.inc, "0.5", v => D.jp.inc = v),
        num("goldN", "Золотий білет кожні N замовлень за день (0 вимикає)", D.goldEvery, "1", v => D.goldEvery = Math.round(v)))),
    calc,
    h("div", { class: "bar" }, h("button", { class: "btn primary", onclick: async () => {
      try { const r = await api("/api/admin/config", { method: "PUT", body: { prizes: D.prizes.filter(x => x.p > 0 || x.a > 0), jp: D.jp, goldEvery: D.goldEvery } }); A.cfg.config = r.config; saveMsg.textContent = "Призи збережено"; }
      catch (er) { saveMsg.textContent = er.message; }
    } }, "Зберегти призи"), saveMsg));
}
/* data */
function admData() {
  const cur = monthKey(); const months = Array.from({ length: 18 }, (_, i) => prevMonth(cur, i));
  const mk = A.dataMk; const canDel = mk < prevMonth(cur);
  const out = h("div"); const o = A.cfg.odoo;
  return h("div", { class: "stack" },
    h("div", { class: "panel stack" },
      h("h2", { style: "margin:0" }, "Звірка з Odoo"),
      o.configured ? h("p", { class: "muted", style: "margin:0" }, `Підтверджує: ${o.done.join(", ")}. Спалює приз: ${o.cancel.join(", ")}. Перевірка, що замовлення оформив цей менеджер: ${o.checkOwner ? "увімкнена" : "вимкнена"}.`)
        : h("div", { class: "msg err" }, "Odoo не підключено: замовлення не перевіряються. Додайте змінні ODOO_* на сервері."),
      h("div", { class: "bar" }, h("button", { class: "btn", disabled: !o.configured, onclick: async e => {
        e.target.disabled = true; out.replaceChildren(h("div", { class: "msg" }, "Звіряємо…"));
        try { const r = await api("/api/admin/sync", { method: "POST" }); out.replaceChildren(h("div", { class: "msg ok" }, r.note || `Перевірено ${fmtN(r.checked)}, підтверджено ${fmtN(r.confirmed)}, скасовано ${fmtN(r.cancelled)}.`)); }
        catch (er) { out.replaceChildren(h("div", { class: "msg err" }, er.message)); }
        e.target.disabled = false;
      } }, "Звірити зараз"), h("span", { class: "muted" }, "Автоматично звіряється кожні кілька хвилин."))),
    h("div", { class: "panel stack" },
      h("h2", { style: "margin:0" }, "Дані гри"),
      h("div", { class: "field", style: "max-width:320px" }, h("label", { for: "dataMk" }, "Місяць"),
        h("select", { class: "inp", id: "dataMk", onchange: e => { A.dataMk = e.target.value; A.confirm = null; renderAdm(false); } }, months.map(m => h("option", { value: m, selected: m === mk }, monthName(m))))),
      h("div", { class: "bar" },
        h("button", { class: "btn primary", onclick: () => exportCsv(mk, out) }, "Вивантажити CSV"),
        h("button", { class: "btn danger", disabled: !canDel, onclick: () => { A.confirm = { del: mk }; renderAdm(false); } }, "Видалити дані місяця")),
      !canDel ? h("p", { class: "muted", style: "margin:0" }, "Поточний і минулий місяці видаляти не можна.") : null,
      A.confirm && A.confirm.del === mk ? h("div", { class: "confirm" }, `Видалити всі білети за ${monthName(mk).toLowerCase()}? Скасувати це не можна.`,
        h("button", { class: "btn sm danger", onclick: async () => {
          A.confirm = null;
          try { const r = await api("/api/admin/month/" + mk, { method: "DELETE" }); A.msg = `Видалено записів: ${fmtN(r.deleted)}.`; } catch (er) { A.msg = er.message; }
          renderAdm(false);
        } }, "Так, видалити"),
        h("button", { class: "btn sm", onclick: () => { A.confirm = null; renderAdm(false); } }, "Ні")) : null,
      out,
      h("p", { class: "muted", style: "margin:0" }, "Раз на квартал вивантажуйте CSV для звіту, а місяці старші за пів року можна видаляти.")));
}
async function exportCsv(mk, out) {
  out.replaceChildren(h("div", { class: "msg" }, "Готуємо файл…"));
  try {
    const res = await api("/api/admin/export?month=" + mk, { raw: true });
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: `bilet-${mk}.csv` }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    out.replaceChildren(h("div", { class: "msg ok" }, "Файл завантажено."));
  } catch (er) { out.replaceChildren(h("div", { class: "msg err" }, er.message)); }
}

/* ---------- boot ---------- */
async function boot() {
  if (!API || API.includes("ВАШ-СЕРВІС")) { $("#vLogin").hidden = false; $("#vLogin").replaceChildren(h("div", { class: "center panel" }, h("h2", null, "Сервер не налаштовано"), h("p", { class: "muted" }, "Вкажіть адресу сервера Railway у файлі config.js."))); return; }
  show();
  if (S.token) { try { await loadMe(); } catch (_) { S.token = null; store.set("bz_token", null); } show(); }
  setInterval(async () => {
    if (!S.token || !S.data || document.hidden) return;
    try { await loadMe(); $("#jpVal").textContent = grn(S.data.jackpot); if (S.view === "cab" && cabBuilt === "main") { renderBoostBox(); renderRail(); } } catch (_) {}
  }, 30000);
}
boot();
})();
