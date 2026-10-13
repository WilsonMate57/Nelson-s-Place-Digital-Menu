/**
 * Kitchen hours, availability windows and pre-order ("Encomendar") time
 * slots. Pure functions shared by the server (authoritative validation) and
 * the guest app (which only offers valid slots).
 *
 * All wall-clock times are hotel local time (Africa/Maputo, UTC+2 all year,
 * no daylight saving). Instants are UTC Date objects / ISO strings.
 */

export const HOTEL_UTC_OFFSET_MINUTES = 120;
export const SLOT_MINUTES = 15;

/** A daily window in hotel time, "HH:MM"–"HH:MM" (inclusive, same day). */
export interface TimeWindow {
  from: string;
  until: string;
}

export interface ScheduleRules {
  kitchenOpen: string;
  kitchenClose: string;
  /** Minimum time between ordering and receiving a scheduled order. */
  minLeadMinutes: number;
  /** 0 = today only, 1 = today and tomorrow, ... */
  maxDaysAhead: number;
}

export const HM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseHm(hm: string): number {
  const [h = "0", m = "0"] = hm.split(":");
  return Number(h) * 60 + Number(m);
}

export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Hotel-local calendar day ("YYYY-MM-DD") and minutes since local midnight. */
export function hotelClock(instant: Date): { day: string; minutes: number } {
  const local = new Date(instant.getTime() + HOTEL_UTC_OFFSET_MINUTES * 60_000);
  return { day: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** The instant for a hotel-local day and time. */
export function hotelInstant(day: string, minutes: number): Date {
  const [y = 0, mo = 1, d = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + (minutes - HOTEL_UTC_OFFSET_MINUTES) * 60_000);
}

export function addDays(day: string, days: number): string {
  return hotelClock(new Date(hotelInstant(day, 12 * 60).getTime() + days * 86_400_000)).day;
}

export function inWindow(minutes: number, window: TimeWindow): boolean {
  return minutes >= parseHm(window.from) && minutes <= parseHm(window.until);
}

export const kitchenWindow = (rules: ScheduleRules): TimeWindow => ({ from: rules.kitchenOpen, until: rules.kitchenClose });

/** Whether an order for "as soon as possible" can be accepted at this instant. */
export function isKitchenOpen(now: Date, rules: ScheduleRules): boolean {
  return inWindow(hotelClock(now).minutes, kitchenWindow(rules));
}

export type ScheduleError = "TOO_SOON" | "TOO_FAR" | "OUTSIDE_KITCHEN_HOURS" | "OUTSIDE_ITEM_HOURS";

/**
 * Validates a requested delivery time. `itemWindows` are the availability
 * windows of the ordered items (e.g. breakfast 07:00–11:00).
 */
export function checkScheduledTime(now: Date, requested: Date, rules: ScheduleRules, itemWindows: TimeWindow[]): ScheduleError | null {
  // One minute of tolerance for clock differences and the time spent on the form.
  if (requested.getTime() < now.getTime() + (rules.minLeadMinutes - 1) * 60_000) return "TOO_SOON";
  const today = hotelClock(now).day;
  const target = hotelClock(requested);
  if (target.day > addDays(today, rules.maxDaysAhead)) return "TOO_FAR";
  const earliest = parseHm(rules.kitchenOpen) + rules.minLeadMinutes;
  if (target.minutes < earliest || target.minutes > parseHm(rules.kitchenClose)) return "OUTSIDE_KITCHEN_HOURS";
  if (itemWindows.some((w) => !inWindow(target.minutes, w))) return "OUTSIDE_ITEM_HOURS";
  return null;
}

export interface TimeSlot {
  /** UTC ISO instant, sent to the server. */
  iso: string;
  day: string;
  minutes: number;
}

/** Every valid delivery slot, grouped implicitly by day (chronological). */
export function availableSlots(now: Date, rules: ScheduleRules, itemWindows: TimeWindow[]): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const today = hotelClock(now).day;
  for (let offset = 0; offset <= rules.maxDaysAhead; offset++) {
    const day = addDays(today, offset);
    for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_MINUTES) {
      const instant = hotelInstant(day, minutes);
      if (checkScheduledTime(now, instant, rules, itemWindows) === null) {
        slots.push({ iso: instant.toISOString(), day, minutes });
      }
    }
  }
  return slots;
}
