import { describe, expect, it } from "vitest";
import { localize } from "../src/shared/localize";
import { GUEST_LANGUAGES, MESSAGE_KEYS, loadDictionary, makeTranslator } from "../src/client/guest/i18n";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("guest languages", () => {
  it("translate every text and keep the same {placeholders}", async () => {
    const pt = makeTranslator("pt");
    for (const { code } of GUEST_LANGUAGES) {
      await loadDictionary(code);
      const t = makeTranslator(code);
      for (const key of MESSAGE_KEYS) {
        expect(t(key).trim(), `${code}.${key}`).not.toBe("");
        expect(placeholders(t(key)), `${code}.${key}`).toEqual(placeholders(pt(key)));
      }
    }
    // A loaded language is really used (not the English fallback).
    expect(makeTranslator("de")("cart")).toBe("Ihre Bestellung");
  });

  it("shows untranslated dish names in English to foreign guests, Portuguese otherwise", () => {
    expect(localize({ pt: "Frango", en: "Chicken" }, "de")).toBe("Chicken");
    expect(localize({ pt: "Frango", en: "Chicken", de: "Hähnchen" }, "de")).toBe("Hähnchen");
    expect(localize({ pt: "Matapa" }, "fr")).toBe("Matapa");
    expect(localize({ pt: "Frango", en: "Chicken" }, "pt")).toBe("Frango");
  });
});
