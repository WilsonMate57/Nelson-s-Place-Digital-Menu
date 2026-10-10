import { settingsInputSchema, type SettingsInput } from "../../shared/schemas";
import type { AdminSettings } from "../../shared/types";
import { nowIso, type Db } from "../db/connection";

/**
 * Operational settings editable by administrators. Values that depend on
 * hotel policy (charges, required fields, WhatsApp number) start empty or
 * permissive until the hotel confirms them — see docs/IMPLEMENTATION_STATUS.md.
 */
export const DEFAULT_SETTINGS: AdminSettings = {
  hotelName: "Nelson's Place Apart Hotel",
  currency: "MZN",
  currencySymbol: "MT",
  whatsappNumber: "",
  ordersEnabled: true,
  ordersPausedMessage: null,
  locationTypes: ["room", "table"],
  requireGuestName: false,
  requireContactPhone: false,
  charges: [],
};

const KEY = "general";

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(): AdminSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    const stored = JSON.parse(row.value) as Partial<AdminSettings>;
    // Re-validate so a manually edited row cannot inject invalid values.
    const merged = settingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
    return merged.success ? { ...merged.data, currency: DEFAULT_SETTINGS.currency } : { ...DEFAULT_SETTINGS };
  }

  save(input: SettingsInput, staffId: number | null): AdminSettings {
    const value: AdminSettings = { ...input, currency: DEFAULT_SETTINGS.currency };
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(KEY, JSON.stringify(value), nowIso(), staffId);
    return value;
  }
}
