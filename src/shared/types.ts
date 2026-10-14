import type {
  DepositStatus,
  IntegrationStatus,
  Language,
  LocationType,
  OrderLocationType,
  OrderStatus,
  WhatsAppMode,
} from "./constants";
import type { Permission } from "./permissions";

/** Text stored in several languages. Portuguese is mandatory; others fall back to it. */
export type LocalizedText = { pt: string } & Partial<Record<Exclude<Language, "pt">, string>>;

export interface OptionDto {
  id: number;
  name: LocalizedText;
  priceDeltaCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface OptionGroupDto {
  id: number;
  name: LocalizedText;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: OptionDto[];
}

export interface CategoryDto {
  id: number;
  name: LocalizedText;
  description: LocalizedText | null;
  sortOrder: number;
  isActive: boolean;
  /** Daily availability window in hotel time ("HH:MM"), e.g. breakfast 07:00–11:00. Null = whenever the kitchen is open. */
  availableFrom: string | null;
  availableUntil: string | null;
}

export interface ProductDto {
  id: number;
  categoryId: number;
  name: LocalizedText;
  description: LocalizedText | null;
  imageUrl: string | null;
  priceCents: number;
  currency: string;
  isAvailable: boolean;
  sortOrder: number;
  optionGroups: OptionGroupDto[];
}

export interface AdminProductDto extends ProductDto {
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCategoryDto extends CategoryDto {
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A configurable surcharge (e.g. service charge). None exist until the hotel confirms them. */
export interface ChargeRule {
  id: string;
  label: LocalizedText;
  kind: "percent" | "fixed";
  /** Percent value (e.g. 10 = 10%) or fixed amount in centavos. */
  value: number;
}

/** Settings that are safe to show to guests. */
export interface PublicSettings {
  hotelName: string;
  currency: string;
  currencySymbol: string;
  ordersEnabled: boolean;
  ordersPausedMessage: LocalizedText | null;
  locationTypes: LocationType[];
  requireGuestName: boolean;
  requireContactPhone: boolean;
  charges: ChargeRule[];
  /** "Encomendar": orders scheduled for a later time. */
  preOrdersEnabled: boolean;
  kitchenOpen: string;
  kitchenClose: string;
  minLeadMinutes: number;
  maxDaysAhead: number;
  /** Collection at the hotel; guests must pay a deposit when ordering. */
  takeawayEnabled: boolean;
  takeawayDepositPercent: number;
  /** How to pay the deposit (e.g. M-Pesa number). Take-away is offered only when set. */
  paymentInstructions: LocalizedText | null;
  whatsappContactNumber: string | null;
  whatsappMode: WhatsAppMode;
}

/** Full settings, editable by administrators. */
/** Hotel identification printed on order tickets. Empty strings are omitted. */
export interface HotelDetails {
  hotelNuit: string;
  hotelPhone: string;
  hotelAddress: string;
  hotelEmail: string;
  hotelWebsite: string;
}

export interface AdminSettings extends Omit<PublicSettings, "whatsappContactNumber" | "whatsappMode">, HotelDetails {
  whatsappNumber: string;
  /** Daily summary to the manager. */
  dailySummaryEnabled: boolean;
  managerWhatsapp: string;
  managerEmail: string;
}

export interface DailySummaryStatusDto {
  enabled: boolean;
  /** Which automatic channels are configured on the server. */
  channels: { email: boolean; whatsapp: boolean };
  /** When today's automatic summary is due (hotel time, HH:MM). */
  sendsAt: string;
  recent: { day: string; status: "pending" | "sent" | "failed" | "skipped"; channels: string | null; attempts: number; lastError: string | null; updatedAt: string }[];
}

export interface PublicMenuDto {
  settings: PublicSettings;
  categories: CategoryDto[];
  products: ProductDto[];
}

export interface SelectedOptionSnapshot {
  optionId: number;
  groupName: string;
  name: string;
  priceDeltaCents: number;
}

export interface OrderItemDto {
  id: number;
  productId: number | null;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  options: SelectedOptionSnapshot[];
  notes: string | null;
  lineTotalCents: number;
}

export interface AppliedCharge {
  id: string;
  label: string;
  amountCents: number;
}

export interface OrderDto {
  id: number;
  reference: string;
  status: OrderStatus;
  locationType: OrderLocationType;
  locationLabel: string;
  /** Requested delivery time (UTC ISO) for scheduled orders; null = as soon as possible. */
  scheduledFor: string | null;
  depositCents: number;
  depositStatus: DepositStatus;
  paymentReference: string | null;
  guestName: string | null;
  contactPhone: string | null;
  notes: string | null;
  language: Language;
  currency: string;
  subtotalCents: number;
  chargesCents: number;
  charges: AppliedCharge[];
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDto[];
}

export interface OrderSummaryDto extends Omit<OrderDto, "items"> {
  itemCount: number;
  whatsappStatus: IntegrationStatus | null;
  /** Guest chat messages not yet read by staff. */
  unreadMessages: number;
}

export interface StatusHistoryDto {
  id: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  staffName: string | null;
  note: string | null;
  createdAt: string;
}

export interface IntegrationEventDto {
  id: number;
  integration: string;
  channel: WhatsAppMode;
  status: IntegrationStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

export interface AdminOrderDetailDto extends OrderDto {
  history: StatusHistoryDto[];
  integrations: IntegrationEventDto[];
}

/** What a guest sees after submitting, and when checking status later. */
export interface GuestOrderDto {
  reference: string;
  publicToken: string;
  status: OrderStatus;
  locationType: OrderLocationType;
  locationLabel: string;
  scheduledFor: string | null;
  depositCents: number;
  depositStatus: DepositStatus;
  currency: string;
  subtotalCents: number;
  charges: AppliedCharge[];
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  items: Pick<OrderItemDto, "productName" | "quantity" | "options" | "lineTotalCents" | "notes">[];
  whatsapp: { mode: WhatsAppMode; status: IntegrationStatus | null; url: string | null };
}

export interface StaffDto {
  id: number;
  email: string;
  displayName: string;
  roleId: number;
  roleName: string;
  /** Effective permissions of the staff member's role. */
  permissions: Permission[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface OrderListResponse {
  orders: OrderSummaryDto[];
  counts: Record<OrderStatus, number>;
  /** Active orders with a requested time ("Encomendas"). */
  scheduledCount: number;
  /** Unread guest chat messages across all orders. */
  unreadMessagesTotal: number;
  serverTime: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Reports (admin)
// ---------------------------------------------------------------------------

export interface ReportKpis {
  ordersReceived: number;
  /** Orders accepted by the hotel (confirmed or later, not cancelled). */
  ordersSold: number;
  ordersCompleted: number;
  ordersCancelled: number;
  ordersPending: number;
  /** Sales = total of accepted orders. */
  revenueCents: number;
  avgTicketCents: number;
  itemsSold: number;
  depositsConfirmedCents: number;
  scheduledOrders: number;
  /** Average minutes until staff confirmed / completed an order (immediate orders only). */
  avgMinutesToConfirm: number | null;
  avgMinutesToComplete: number | null;
}

export interface ReportDto {
  /** Hotel-local dates, inclusive. */
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  kpis: ReportKpis;
  previous: ReportKpis;
  /** One entry per day in the range (zeros included). */
  daily: { day: string; orders: number; revenueCents: number }[];
  /** 24 entries, local hour 0–23. */
  hourly: { hour: number; orders: number }[];
  topItems: { name: string; quantity: number; revenueCents: number }[];
  categories: { name: string; quantity: number; revenueCents: number }[];
  topOptions: { group: string; name: string; count: number }[];
  byLocation: { type: import("./constants").OrderLocationType; orders: number; revenueCents: number }[];
  staff: { name: string; confirmed: number; completed: number; cancelled: number; avgMinutesToConfirm: number | null; replies: number }[];
  unsoldItems: { name: string; category: string; isAvailable: boolean }[];
  /** 7 entries, Monday first. */
  weekday: { weekday: number; orders: number; revenueCents: number }[];
  customers: {
    withPhone: number;
    returning: number;
    top: { name: string | null; phone: string; ordersInPeriod: number; ordersEver: number; revenueCents: number }[];
  };
}

// ---------------------------------------------------------------------------
// Chat (per order)
// ---------------------------------------------------------------------------

export interface ChatMessageDto {
  id: number;
  sender: "guest" | "staff";
  /** Staff name for the dashboard; guests always see "Equipa do hotel". */
  authorName: string | null;
  body: string;
  createdAt: string;
  /** Read by the other side. */
  read: boolean;
}

export interface ChatThreadDto {
  messages: ChatMessageDto[];
  /** False once the order is closed for messages (finished more than 24 h ago). */
  open: boolean;
}

// ---------------------------------------------------------------------------
// Access profiles (roles)
// ---------------------------------------------------------------------------

export interface RoleDto {
  id: number;
  name: string;
  description: string | null;
  /** Effective permissions ("*" is expanded). */
  permissions: Permission[];
  /** Built-in Administrador: always every permission, cannot be changed or deleted. */
  isSystem: boolean;
  staffCount: number;
}
