import type { Language } from "./constants";
import type { LocalizedText } from "./types";

/** Returns the text in the requested language, falling back to Portuguese. */
export function localize(value: LocalizedText | null | undefined, language: Language): string {
  if (!value) return "";
  return value[language] || value.pt;
}
