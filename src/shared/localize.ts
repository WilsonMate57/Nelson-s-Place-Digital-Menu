import type { Language } from "./constants";
import type { LocalizedText } from "./types";

/**
 * Returns the text in the requested language. Content not translated yet
 * falls back to English for foreign guests, then to Portuguese.
 */
export function localize(value: LocalizedText | null | undefined, language: Language): string {
  if (!value) return "";
  return value[language] || (language !== "pt" && value.en) || value.pt;
}
