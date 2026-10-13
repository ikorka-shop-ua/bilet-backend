// Звірка статусів виграшів з Odoo:
// «Завершено» → підтверджено до виплати, етапи відмови → приз згорає.
// Статуси, які керівник змінив вручну, не чіпаємо.
import { q } from "./db.js";
import * as odoo from "./odoo.js";

let running = false;

export async function syncStatuses() {
  if (!odoo.configured()) return { checked: 0, confirmed: 0, cancelled: 0, note: "Odoo не налаштовано" };
  if (running) return { checked: 0, confirmed: 0, cancelled: 0, note: "Звірка вже йде" };
  running = true;
  let checked = 0, confirmed = 0, cancelled = 0;
  try {
    const r = await q(`select id, odoo_id from tickets
                        where status = 'w' and status_source = 'auto' and odoo_id is not null
                          and created_at > now() - interval '90 days'
                        order by checked_at nulls first limit 2000`);
    const byOdoo = new Map();
    for (const row of r.rows) {
      const list = byOdoo.get(row.odoo_id) || [];
      list.push(Number(row.id)); byOdoo.set(row.odoo_id, list);
    }
    const ids = [...byOdoo.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      const stages = await odoo.readStages(ids.slice(i, i + 200));
      for (const s of stages) {
        const tids = byOdoo.get(s.id) || [];
        const st = odoo.isDone(s.stage) ? "c" : odoo.isCancel(s.stage) ? "x" : "w";
        await q("update tickets set odoo_stage = $1, checked_at = now(), status = $2 where id = any($3::bigint[]) and status_source = 'auto'", [s.stage, st, tids]);
        checked += tids.length;
        if (st === "c") confirmed += tids.length;
        if (st === "x") cancelled += tids.length;
      }
    }
  } finally { running = false; }
  return { checked, confirmed, cancelled };
}

export function startSync() {
  const min = Math.max(2, Number(process.env.SYNC_MINUTES) || 10);
  const tick = () => syncStatuses().then(r => { if (r.checked) console.log("sync", r); }).catch(e => console.error("sync", e.message));
  setTimeout(tick, 20e3);
  setInterval(tick, min * 60e3);
}
