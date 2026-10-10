/**
 * Domain constants shared by the server and the browser.
 * Internal codes (statuses, roles, location types) are never translated;
 * only their display labels are localised.
 */

export const LANGUAGES = ["pt", "en", "fr", "es"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "pt";

export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STAFF_ROLES = ["admin", "reception", "restaurant"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const LOCATION_TYPES = ["room", "table"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const WHATSAPP_MODES = ["link", "cloud_api"] as const;
export type WhatsAppMode = (typeof WHATSAPP_MODES)[number];

export const INTEGRATION_STATUSES = [
  "pending", // queued for server-side delivery (cloud_api)
  "link_ready", // a prefilled wa.me link was generated; nothing has been sent
  "link_opened", // the guest tapped the link; delivery is NOT confirmed
  "sent", // accepted by the WhatsApp Cloud API
  "failed", // delivery attempt failed (see last_error)
  "not_configured", // no destination number configured
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Hard limits that protect the order endpoint from abuse. */
export const ORDER_LIMITS = {
  maxLines: 30,
  maxQuantityPerLine: 20,
  maxNotesLength: 400,
  maxItemNotesLength: 200,
  maxGuestNameLength: 80,
  maxLocationLabelLength: 40,
  maxPhoneLength: 20,
} as const;

export const HOTEL_TIME_ZONE = "Africa/Maputo";

/** Minimum staff password length (validated on the server). */
export const PASSWORD_MIN_LENGTH = 10;
