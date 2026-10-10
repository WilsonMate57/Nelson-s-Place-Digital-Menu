import { HOTEL_TIME_ZONE } from "../../shared/constants";

/** RFC 4122 v4 UUID. crypto.randomUUID only exists on HTTPS/localhost, so fall back to getRandomValues. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** localStorage access that never throws (private mode, quota, disabled storage). */
export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function formatDateTime(iso: string, locale = "pt-PT"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: HOTEL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTime(iso: string, locale = "pt-PT"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: HOTEL_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** "há 5 min" style relative time, in Portuguese or English. */
export function timeAgo(iso: string, nowMs: number, language: "pt" | "en" = "pt"): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(language === "pt" ? "pt-PT" : "en", { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/** Today's date in the hotel's time zone, as YYYY-MM-DD. */
export function hotelToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOTEL_TIME_ZONE }).format(new Date());
}

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
