import { createContext, useContext } from "react";
import type { StaffDto } from "../../shared/types";
import type { AdminSettings } from "../../shared/types";
import type { WhatsAppMode } from "../../shared/constants";
import { hasAny, type Permission } from "../../shared/permissions";

export type AdminSettingsView = AdminSettings & { whatsappMode: WhatsAppMode };

export interface SessionValue {
  staff: StaffDto;
  /** True if the signed-in person's profile has ANY of the permissions. */
  can: (...permissions: Permission[]) => boolean;
  settings: AdminSettingsView | null;
  setSettings: (s: AdminSettingsView) => void;
  /** Call when the API answers 401: returns to the login screen. */
  onUnauthorized: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside provider");
  return value;
}

export const makeCan =
  (staff: StaffDto) =>
  (...permissions: Permission[]) =>
    hasAny(staff.permissions, ...permissions);
