/** time helpers. everything is stored as utc iso strings. */

export type TimeInput = Date | string | number | null | undefined;

const MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(t: TimeInput): string | null {
  if (t === null || t === undefined) return null;
  if (typeof t === "string") {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return new Date(t).toISOString();
}

export function addMs(t: TimeInput, ms: number): string {
  const base = toIso(t) ?? nowIso();
  return new Date(new Date(base).getTime() + ms).toISOString();
}

export const minutesFromNow = (n: number) => addMs(Date.now(), n * MS.minute);
export const hoursFromNow = (n: number) => addMs(Date.now(), n * MS.hour);
export const daysFromNow = (n: number) => addMs(Date.now(), n * MS.day);

export function startOfDay(t: TimeInput = new Date()): string {
  const d = new Date(toIso(t) ?? nowIso());
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function endOfDay(t: TimeInput = new Date()): string {
  const d = new Date(toIso(t) ?? nowIso());
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

export function startOfWeek(t: TimeInput = new Date()): string {
  const d = new Date(toIso(t) ?? nowIso());
  const day = (d.getUTCDay() + 6) % 7; // monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function daysAgoIso(n: number): string {
  return addMs(Date.now(), -n * MS.day);
}

export function isPast(t: TimeInput): boolean {
  const iso = toIso(t);
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

export function secondsBetween(a: TimeInput, b: TimeInput): number {
  const ai = toIso(a);
  const bi = toIso(b);
  if (!ai || !bi) return 0;
  return Math.max(0, Math.round((new Date(bi).getTime() - new Date(ai).getTime()) / 1000));
}

/** whole days between two instants, ignoring time of day. */
export function daysBetween(a: TimeInput, b: TimeInput): number {
  const ai = toIso(a);
  const bi = toIso(b);
  if (!ai || !bi) return 0;
  const a0 = new Date(ai).setUTCHours(0, 0, 0, 0);
  const b0 = new Date(bi).setUTCHours(0, 0, 0, 0);
  return Math.round((b0 - a0) / MS.day);
}

/** "3 minutes ago", "in 2 days". */
export function humanize(t: TimeInput, from: TimeInput = new Date()): string {
  const iso = toIso(t);
  if (!iso) return "";
  const diff = new Date(iso).getTime() - new Date(toIso(from) ?? nowIso()).getTime();
  const abs = Math.abs(diff);
  const future = diff > 0;

  let out: string;
  if (abs < 45_000) return future ? "in a moment" : "just now";
  if (abs < MS.hour) {
    const n = Math.round(abs / MS.minute);
    out = `${n} minute${n === 1 ? "" : "s"}`;
  } else if (abs < MS.day) {
    const n = Math.round(abs / MS.hour);
    out = `${n} hour${n === 1 ? "" : "s"}`;
  } else if (abs < MS.week) {
    const n = Math.round(abs / MS.day);
    out = `${n} day${n === 1 ? "" : "s"}`;
  } else if (abs < 30 * MS.day) {
    const n = Math.round(abs / MS.week);
    out = `${n} week${n === 1 ? "" : "s"}`;
  } else if (abs < 365 * MS.day) {
    const n = Math.round(abs / (30 * MS.day));
    out = `${n} month${n === 1 ? "" : "s"}`;
  } else {
    const n = Math.round(abs / (365 * MS.day));
    out = `${n} year${n === 1 ? "" : "s"}`;
  }
  return future ? `in ${out}` : `${out} ago`;
}

export function formatDate(t: TimeInput): string {
  const iso = toIso(t);
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(t: TimeInput): string {
  const iso = toIso(t);
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}