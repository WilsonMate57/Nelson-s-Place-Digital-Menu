import { z } from "zod";
import {
  LANGUAGES,
  LOCATION_TYPES,
  ORDER_LIMITS,
  ORDER_LOCATION_TYPES,
  ORDER_STATUSES,
  PASSWORD_MIN_LENGTH,
  STAFF_ROLES,
} from "./constants";
import { HM_PATTERN, parseHm } from "./schedule";

/** Removes control characters (except newlines/tabs) that have no place in user text. */
// eslint-disable-next-line no-control-regex -- intentionally strips control characters
const stripControl = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const text = (max: number) => z.string().transform(stripControl).pipe(z.string().trim().max(max));
const requiredText = (max: number) => text(max).pipe(z.string().min(1, "Obrigatório"));
const optionalText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalLang = (max: number) =>
  text(max)
    .transform((v) => (v ? v : undefined))
    .optional();

export const localizedTextSchema = (max: number) =>
  z.object({
    pt: requiredText(max),
    en: optionalLang(max),
    fr: optionalLang(max),
    es: optionalLang(max),
  });

const optionalLocalizedText = (max: number) =>
  localizedTextSchema(max)
    .nullish()
    .transform((v) => v ?? null);

const id = z.number().int().positive();

// ---------------------------------------------------------------------------
// Guest order submission
// ---------------------------------------------------------------------------

export const orderItemInputSchema = z.object({
  productId: id,
  quantity: z.number().int().min(1).max(ORDER_LIMITS.maxQuantityPerLine),
  optionIds: z.array(id).max(30).default([]),
  notes: optionalText(ORDER_LIMITS.maxItemNotesLength),
});

export const orderSubmissionSchema = z.object({
  idempotencyKey: z.uuid(),
  language: z.enum(LANGUAGES),
  location: z
    .object({
      type: z.enum(ORDER_LOCATION_TYPES),
      // Table or apartment number; not used for take-away.
      label: text(ORDER_LIMITS.maxLocationLabelLength)
        .pipe(z.string().regex(/^[\p{L}\p{N} ._\-/#]*$/u, "Caracteres inválidos"))
        .default(""),
    })
    .refine((l) => l.type === "takeaway" || l.label.length > 0, { message: "Obrigatório", path: ["label"] }),
  /** Requested delivery time ("Encomendar"); null/absent = as soon as possible. */
  scheduledFor: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((v) => (v ? new Date(v).toISOString() : null)),
  /** Reference of the deposit payment (take-away), e.g. the M-Pesa transaction ID. */
  paymentReference: optionalText(ORDER_LIMITS.maxPaymentReferenceLength),
  guestName: optionalText(ORDER_LIMITS.maxGuestNameLength),
  contactPhone: z
    .string()
    .trim()
    .max(ORDER_LIMITS.maxPhoneLength)
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\+?[0-9 ()-]{6,20}$/.test(v), "Número inválido"),
  notes: optionalText(ORDER_LIMITS.maxNotesLength),
  items: z.array(orderItemInputSchema).min(1, "Carrinho vazio").max(ORDER_LIMITS.maxLines),
});

export type OrderSubmission = z.infer<typeof orderSubmissionSchema>;
export type OrderSubmissionInput = z.input<typeof orderSubmissionSchema>;

// ---------------------------------------------------------------------------
// Staff authentication
// ---------------------------------------------------------------------------

export { PASSWORD_MIN_LENGTH };

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
});

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A palavra-passe deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(200);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export const orderStatusUpdateSchema = z.object({
  to: z.enum(ORDER_STATUSES),
  /** The status the staff member saw; prevents two people overwriting each other. */
  expectedStatus: z.enum(ORDER_STATUSES),
  note: optionalText(300),
});

export const orderListQuerySchema = z.object({
  status: z.union([z.enum(ORDER_STATUSES), z.literal("ACTIVE"), z.literal("ALL"), z.literal("SCHEDULED")]).default("ACTIVE"),
  q: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const hm = z.string().regex(HM_PATTERN, "Hora inválida (HH:MM)");
const optionalHm = hm.nullish().transform((v) => v ?? null);

export const categoryInputSchema = z
  .object({
    name: localizedTextSchema(80),
    description: optionalLocalizedText(300),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
    availableFrom: optionalHm,
    availableUntil: optionalHm,
  })
  .refine((c) => (c.availableFrom === null) === (c.availableUntil === null), {
    message: "Indique as duas horas ou nenhuma",
    path: ["availableUntil"],
  })
  .refine((c) => c.availableFrom === null || parseHm(c.availableFrom) < parseHm(c.availableUntil!), {
    message: "A hora final deve ser depois da inicial",
    path: ["availableUntil"],
  });

export const optionInputSchema = z.object({
  id: id.optional(),
  name: localizedTextSchema(80),
  priceDeltaCents: z.number().int().min(0).max(100_000_000),
  isAvailable: z.boolean().default(true),
});

export const optionGroupInputSchema = z
  .object({
    id: id.optional(),
    name: localizedTextSchema(80),
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    options: z.array(optionInputSchema).min(1, "Adicione pelo menos uma opção").max(30),
  })
  .refine((g) => g.maxSelect >= g.minSelect, { message: "Máximo deve ser ≥ mínimo", path: ["maxSelect"] })
  .refine((g) => g.minSelect <= g.options.length, {
    message: "Mínimo superior ao número de opções",
    path: ["minSelect"],
  });

export const productInputSchema = z.object({
  categoryId: id,
  name: localizedTextSchema(100),
  description: optionalLocalizedText(500),
  priceCents: z.number().int().min(0).max(100_000_000),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  optionGroups: z.array(optionGroupInputSchema).max(10).default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const availabilitySchema = z.object({ isAvailable: z.boolean() });

export const staffCreateSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  displayName: requiredText(80),
  role: z.enum(STAFF_ROLES),
  password: passwordSchema,
});

export const staffUpdateSchema = z.object({
  displayName: requiredText(80),
  role: z.enum(STAFF_ROLES),
  isActive: z.boolean(),
});

export const staffPasswordResetSchema = z.object({ password: passwordSchema });

export const chargeRuleSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/),
  label: localizedTextSchema(60),
  kind: z.enum(["percent", "fixed"]),
  value: z.number().int().min(0).max(100_000_000),
}).refine((c) => c.kind !== "percent" || c.value <= 100, { message: "Percentagem inválida", path: ["value"] });

export const settingsInputSchema = z.object({
  hotelName: requiredText(100),
  currencySymbol: requiredText(8),
  whatsappNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s+()-]/g, ""))
    .refine((v) => v === "" || /^[1-9]\d{7,14}$/.test(v), "Use o formato internacional, ex.: 258XXXXXXXXX"),
  ordersEnabled: z.boolean(),
  ordersPausedMessage: optionalLocalizedText(200),
  locationTypes: z.array(z.enum(LOCATION_TYPES)).min(1).max(LOCATION_TYPES.length),
  requireGuestName: z.boolean(),
  requireContactPhone: z.boolean(),
  charges: z.array(chargeRuleSchema).max(5),
  preOrdersEnabled: z.boolean(),
  kitchenOpen: hm,
  kitchenClose: hm,
  minLeadMinutes: z.number().int().min(0).max(600),
  maxDaysAhead: z.number().int().min(0).max(7),
  takeawayEnabled: z.boolean(),
  takeawayDepositPercent: z.number().int().min(0).max(100),
  paymentInstructions: optionalLocalizedText(400),
}).refine((s) => parseHm(s.kitchenOpen) < parseHm(s.kitchenClose), {
  message: "O fecho da cozinha deve ser depois da abertura",
  path: ["kitchenClose"],
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

export const ordersEnabledSchema = z.object({ ordersEnabled: z.boolean() });
