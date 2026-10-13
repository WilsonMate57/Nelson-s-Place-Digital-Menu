import { describe, expect, it } from "vitest";
import {
  addDays,
  availableSlots,
  checkScheduledTime,
  hotelClock,
  hotelInstant,
  isKitchenOpen,
  type ScheduleRules,
} from "../src/shared/schedule";

const rules: ScheduleRules = { kitchenOpen: "07:00", kitchenClose: "23:00", minLeadMinutes: 45, maxDaysAhead: 1 };
const breakfast = { from: "07:00", until: "11:00" };
/** Hotel-local time helper: at("2026-10-13", "14:00"). */
const at = (day: string, hm: string) => hotelInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));

describe("hotel clock (Maputo, UTC+2)", () => {
  it("converts between UTC instants and local day/time", () => {
    expect(hotelClock(new Date("2026-10-13T21:30:00Z"))).toEqual({ day: "2026-10-13", minutes: 23 * 60 + 30 });
    expect(hotelClock(new Date("2026-10-13T22:30:00Z"))).toEqual({ day: "2026-10-14", minutes: 30 });
    expect(at("2026-10-13", "19:00").toISOString()).toBe("2026-10-13T17:00:00.000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows when the kitchen is open", () => {
    expect(isKitchenOpen(at("2026-10-13", "06:59"), rules)).toBe(false);
    expect(isKitchenOpen(at("2026-10-13", "12:00"), rules)).toBe(true);
    expect(isKitchenOpen(at("2026-10-13", "23:01"), rules)).toBe(false);
  });
});

describe("scheduled order times", () => {
  const now = at("2026-10-13", "14:00");

  it("requires at least 45 minutes of notice", () => {
    expect(checkScheduledTime(now, at("2026-10-13", "14:30"), rules, [])).toBe("TOO_SOON");
    expect(checkScheduledTime(now, at("2026-10-13", "14:45"), rules, [])).toBeNull();
  });

  it("only accepts times up to 23:00 and from opening + preparation time", () => {
    expect(checkScheduledTime(now, at("2026-10-13", "23:00"), rules, [])).toBeNull();
    expect(checkScheduledTime(now, at("2026-10-13", "23:15"), rules, [])).toBe("OUTSIDE_KITCHEN_HOURS");
    expect(checkScheduledTime(now, at("2026-10-14", "07:30"), rules, [])).toBe("OUTSIDE_KITCHEN_HOURS");
    expect(checkScheduledTime(now, at("2026-10-14", "07:45"), rules, [])).toBeNull();
  });

  it("limits how far ahead orders can be placed", () => {
    expect(checkScheduledTime(now, at("2026-10-14", "20:00"), rules, [])).toBeNull();
    expect(checkScheduledTime(now, at("2026-10-15", "12:00"), rules, [])).toBe("TOO_FAR");
  });

  it("serves breakfast only in the morning", () => {
    expect(checkScheduledTime(now, at("2026-10-14", "09:00"), rules, [breakfast])).toBeNull();
    expect(checkScheduledTime(now, at("2026-10-14", "12:00"), rules, [breakfast])).toBe("OUTSIDE_ITEM_HOURS");
  });

  it("lists only valid 15-minute slots", () => {
    const slots = availableSlots(now, rules, []);
    expect(slots[0]).toMatchObject({ day: "2026-10-13", minutes: 14 * 60 + 45 });
    expect(slots.at(-1)).toMatchObject({ day: "2026-10-14", minutes: 23 * 60 });
    const breakfastSlots = availableSlots(now, rules, [breakfast]);
    expect(breakfastSlots.every((s) => s.day === "2026-10-14" && s.minutes >= 7 * 60 + 45 && s.minutes <= 11 * 60)).toBe(true);
  });
});
