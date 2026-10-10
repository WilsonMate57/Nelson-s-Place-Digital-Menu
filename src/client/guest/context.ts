import { createContext, useContext } from "react";
import type { Language } from "../../shared/constants";
import type { LocalizedText, PublicSettings } from "../../shared/types";
import type { Translate } from "./i18n";

export interface GuestContextValue {
  language: Language;
  t: Translate;
  money: (cents: number) => string;
  text: (value: LocalizedText | null | undefined) => string;
  settings: PublicSettings;
}

export const GuestContext = createContext<GuestContextValue | null>(null);

export function useGuest(): GuestContextValue {
  const value = useContext(GuestContext);
  if (!value) throw new Error("useGuest must be used inside GuestContext");
  return value;
}
