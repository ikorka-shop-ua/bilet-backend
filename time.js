// Дати за київським часом
export const TZ = "Europe/Kiev";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const dateKey = (ts = Date.now()) => fmt.format(new Date(ts));
export const monthKey = (ts = Date.now()) => dateKey(ts).slice(0, 7);

export function addDays(dk, n) {
  const [y, m, d] = dk.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function wdIdx(dk) {
  const [y, m, d] = dk.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = понеділок
}
export const weekStart = dk => addDays(dk, -wdIdx(dk));
export function prevMonth(mk, n = 1) {
  let [y, m] = mk.split("-").map(Number);
  m -= n;
  while (m < 1) { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}
export function monthEnd(mk) {
  let [y, m] = mk.split("-").map(Number);
  m += 1; if (m > 12) { m = 1; y++; }
  return addDays(`${y}-${String(m).padStart(2, "0")}-01`, -1);
}

// Період → [від, до] у форматі YYYY-MM-DD (включно)
export function periodRange(per) {
  const today = dateKey();
  if (per === "day") return [today, today];
  if (per === "week") return [weekStart(today), today];
  if (per === "month") return [today.slice(0, 7) + "-01", today];
  if (/^\d{4}-\d{2}$/.test(per)) return [per + "-01", monthEnd(per)];
  throw new Error("bad period");
}

// Момент початку дати dk за Києвом (мс)
export function kyivMidnight(dk) {
  for (let off = -4; off <= 4; off++) {
    const ts = Date.parse(dk + "T00:00:00Z") - off * 3600e3;
    if (dateKey(ts) === dk && dateKey(ts - 1) !== dk) return ts;
  }
  return Date.parse(dk + "T00:00:00Z") - 3 * 3600e3;
}

// Діапазон дат [від, до] (включно, за Києвом) → [початок, кінець) як Date для SQL
export function tsRange(from, to) {
  return [new Date(kyivMidnight(from)), new Date(kyivMidnight(addDays(to, 1)))];
}
