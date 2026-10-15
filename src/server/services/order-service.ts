import { createHash, randomBytes, randomInt } from "node:crypto";
import { HOTEL_TIME_ZONE, type LocationType } from "../../shared/constants";
import { canTransition } from "../../shared/order-status";
import { PricingError, priceOrder } from "../../shared/pricing";
import { checkScheduledTime, hotelClock, inWindow, isKitchenOpen, type ScheduleError, type ScheduleRules } from "../../shared/schedule";
import type { OrderSubmission } from "../../shared/schemas";
import type { AdminOrderDetailDto, AdminSettings, GuestOrderDto, KitchenDto, OrderDto, OrderListResponse, ProductDto } from "../../shared/types";
import type { Db } from "../db/connection";
import { AppError, badRequest, conflict, notFound } from "../http/errors";
import type { MenuRepo } from "../repositories/menu-repo";
import type { OrderListFilter, OrdersRepo } from "../repositories/orders-repo";
import type { SettingsRepo } from "../repositories/settings-repo";
import type { WhatsAppService } from "../whatsapp/whatsapp-service";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** Mozambique (CAT) is UTC+2 all year, with no daylight saving time. */
export const HOTEL_UTC_OFFSET = "+02:00";

export function generateReference(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOTEL_TIME_ZONE,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `NP-${get("year")}${get("month")}${get("day")}-${suffix}`;
}

/** Stable fingerprint of a submission, used to detect idempotency-key reuse with different content. */
export function requestFingerprint(submission: OrderSubmission): string {
  const { idempotencyKey: _key, ...content } = submission;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

const PRICING_MESSAGES: Record<PricingError["code"], string> = {
  PRODUCT_NOT_FOUND: "Um dos artigos já não está disponível no menu.",
  PRODUCT_UNAVAILABLE: "Um dos artigos está esgotado de momento.",
  OPTION_INVALID: "Uma das opções escolhidas já não existe.",
  OPTION_UNAVAILABLE: "Uma das opções escolhidas está indisponível.",
  OPTION_DUPLICATE: "Opção repetida num artigo.",
  OPTION_SELECTION_COUNT: "As opções escolhidas não cumprem as regras do artigo.",
};

export interface SubmitResult {
  order: GuestOrderDto;
  /** False when the request repeated an idempotency key and the existing order was returned. */
  created: boolean;
}

export class OrderService {
  constructor(
    private readonly db: Db,
    private readonly menu: MenuRepo,
    private readonly orders: OrdersRepo,
    private readonly settings: SettingsRepo,
    private readonly whatsapp: WhatsAppService,
    private readonly log: (message: string, error?: unknown) => void = console.error,
    /** Injectable clock so tests can run "at" any hotel time. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  submit(submission: OrderSubmission): SubmitResult {
    const settings = this.settings.get();
    const fingerprint = requestFingerprint(submission);

    const outcome = this.db.transaction((): { id: number; created: boolean } => {
      // Idempotency is checked first so a retried request still succeeds
      // even if ordering was paused in the meantime.
      const existing = this.orders.findByIdempotencyKey(submission.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== fingerprint) {
          throw conflict("IDEMPOTENCY_KEY_REUSED", "Este pedido já foi submetido com conteúdo diferente.");
        }
        return { id: existing.id, created: false };
      }

      if (!settings.ordersEnabled) {
        throw new AppError(503, "ORDERS_PAUSED", "De momento não estamos a aceitar pedidos pelo menu digital.");
      }
      const takeaway = submission.location.type === "takeaway";
      const scheduled = submission.scheduledFor !== null;
      if (takeaway) {
        if (!settings.takeawayEnabled || !settings.paymentInstructions) {
          throw badRequest("TAKEAWAY_DISABLED", "De momento não aceitamos pedidos para levantar.");
        }
      } else if (!settings.locationTypes.includes(submission.location.type as LocationType)) {
        throw badRequest("LOCATION_TYPE_NOT_ALLOWED", "Tipo de localização não disponível.");
      }
      if ((settings.requireGuestName || takeaway) && !submission.guestName) {
        throw badRequest("GUEST_NAME_REQUIRED", "Indique o seu nome.");
      }
      // Scheduled and take-away orders need a phone so staff can reach the guest.
      if ((settings.requireContactPhone || takeaway || scheduled) && !submission.contactPhone) {
        throw badRequest("CONTACT_REQUIRED", "Indique um número de contacto.");
      }
      if (takeaway && settings.takeawayDepositPercent > 0 && !submission.paymentReference) {
        throw badRequest("PAYMENT_REFERENCE_REQUIRED", "Indique a referência do pagamento do sinal.");
      }

      const catalogue = this.menu.getOrderableCatalogue(submission.items.map((i) => i.productId));
      this.checkTiming(submission, catalogue, settings);
      let priced;
      try {
        // Snapshots are stored in Portuguese because they are read by staff.
        priced = priceOrder(submission.items, catalogue, settings.charges, "pt");
      } catch (err) {
        if (err instanceof PricingError) {
          throw conflict("MENU_CHANGED", PRICING_MESSAGES[err.code], {
            reason: err.code,
            lineIndex: err.lineIndex,
            productId: err.productId,
          });
        }
        throw err;
      }

      const stockTracked = this.takeStock(submission.items, catalogue);

      let reference = generateReference();
      for (let attempt = 0; this.orders.referenceExists(reference); attempt++) {
        if (attempt > 10) throw new Error("Could not generate a unique order reference");
        reference = generateReference();
      }

      const id = this.orders.insert({
        reference,
        publicToken: randomBytes(18).toString("base64url"),
        idempotencyKey: submission.idempotencyKey,
        requestHash: fingerprint,
        locationType: submission.location.type,
        locationLabel: takeaway ? "" : submission.location.label,
        scheduledFor: submission.scheduledFor,
        depositCents: takeaway ? Math.round((priced.totalCents * settings.takeawayDepositPercent) / 100) : 0,
        paymentReference: takeaway ? submission.paymentReference : null,
        guestName: submission.guestName,
        contactPhone: submission.contactPhone,
        notes: submission.notes,
        language: submission.language,
        currency: settings.currency,
        priced,
        stockTracked,
      });
      this.whatsapp.registerOrder(id);
      return { id, created: true };
    })();

    if (outcome.created && this.whatsapp.mode === "cloud_api") {
      // Fire-and-forget: the order is already committed; the result is recorded on the order.
      this.whatsapp.deliver(outcome.id).catch((err) => this.log(`WhatsApp delivery crashed for order ${outcome.id}`, err));
    }

    const order = this.orders.get(outcome.id)!;
    return { order: this.toGuestView(order, this.orders.getPublicToken(outcome.id)!), created: outcome.created };
  }

  guestStatus(publicToken: string): GuestOrderDto {
    const order = this.orders.getByPublicToken(publicToken);
    if (!order) throw notFound("Pedido não encontrado");
    return this.toGuestView(order, order.publicToken);
  }

  recordWhatsAppLinkOpened(publicToken: string): void {
    const order = this.orders.getByPublicToken(publicToken);
    if (!order) throw notFound("Pedido não encontrado");
    this.whatsapp.markLinkOpened(order.id);
  }

  list(filter: OrderListFilter): OrderListResponse {
    return {
      orders: this.orders.list(filter),
      counts: this.orders.countByStatus(),
      scheduledCount: this.orders.countScheduledActive(),
      unreadMessagesTotal: this.orders.unreadMessagesTotal(),
      serverTime: this.now().toISOString(),
    };
  }

  kitchen(): KitchenDto {
    return {
      orders: this.orders.listForKitchen(),
      pendingCount: this.orders.countByStatus().PENDING,
      leadMinutes: this.settings.get().minLeadMinutes,
      serverTime: this.now().toISOString(),
    };
  }

  detail(id: number): AdminOrderDetailDto {
    const order = this.orders.get(id);
    if (!order) throw notFound("Pedido não encontrado");
    return { ...order, history: this.orders.history(id), integrations: this.orders.integrations(id) };
  }

  changeStatus(id: number, expected: OrderDto["status"], to: OrderDto["status"], staffId: number, note: string | null): AdminOrderDetailDto {
    const order = this.orders.get(id);
    if (!order) throw notFound("Pedido não encontrado");
    if (order.status !== expected) {
      throw conflict("STATUS_CHANGED", "O estado deste pedido foi alterado por outra pessoa. Actualize e tente novamente.", {
        currentStatus: order.status,
      });
    }
    if (!canTransition(order.status, to)) {
      throw badRequest("INVALID_TRANSITION", `Não é possível passar de ${order.status} para ${to}.`);
    }
    if (to === "CONFIRMED" && order.depositStatus === "pending") {
      throw conflict("DEPOSIT_NOT_CONFIRMED", "Confirme primeiro a recepção do sinal (pagamento de 50%).");
    }
    this.db.transaction(() => {
      if (!this.orders.updateStatus(id, expected, to, staffId, note)) {
        throw conflict("STATUS_CHANGED", "O estado deste pedido foi alterado por outra pessoa. Actualize e tente novamente.");
      }
      // A cancelled order gives its units back to stock.
      if (to === "CANCELLED") for (const r of this.orders.releaseStockTaken(id)) this.menu.returnStock(r.productId, r.quantity);
    })();
    return this.detail(id);
  }

  /** Records that staff received the take-away deposit. */
  confirmDeposit(id: number, staffId: number): AdminOrderDetailDto {
    const order = this.orders.get(id);
    if (!order) throw notFound("Pedido não encontrado");
    if (order.depositStatus !== "pending") {
      throw conflict("DEPOSIT_NOT_PENDING", order.depositStatus === "confirmed" ? "O sinal já foi confirmado." : "Este pedido não tem sinal.");
    }
    if (!this.orders.confirmDeposit(id, staffId)) throw conflict("DEPOSIT_NOT_PENDING", "O sinal já foi confirmado.");
    return this.detail(id);
  }

  /**
   * Takes the ordered units from products whose stock is tracked. Runs inside
   * the order transaction, so a refusal undoes everything already taken.
   */
  private takeStock(items: OrderSubmission["items"], catalogue: Map<number, ProductDto>): Set<number> {
    const wanted = new Map<number, number>();
    for (const item of items) wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
    const tracked = new Set<number>();
    for (const [productId, quantity] of wanted) {
      const product = catalogue.get(productId);
      if (!product || product.stockQty === null) continue;
      if (!this.menu.takeStock(productId, quantity)) {
        throw conflict("MENU_CHANGED", `«${product.name.pt}»: só restam ${product.stockQty} unidade(s).`, {
          reason: "OUT_OF_STOCK",
          productId,
          available: product.stockQty,
        });
      }
      tracked.add(productId);
    }
    return tracked;
  }

  /**
   * Kitchen hours and item availability windows, for both "as soon as
   * possible" orders and scheduled ones ("Encomendar").
   */
  private checkTiming(submission: OrderSubmission, catalogue: Map<number, ProductDto>, settings: AdminSettings): void {
    const now = this.now();
    const rules: ScheduleRules = settings;
    const categoryIds = submission.items.map((i) => catalogue.get(i.productId)?.categoryId).filter((id): id is number => id !== undefined);
    const windows = this.menu.categoryWindows(categoryIds);

    if (submission.scheduledFor === null) {
      if (!isKitchenOpen(now, rules)) {
        throw new AppError(
          503,
          "KITCHEN_CLOSED",
          `A cozinha funciona das ${settings.kitchenOpen} às ${settings.kitchenClose}.${settings.preOrdersEnabled ? " Pode encomendar para mais tarde." : ""}`,
        );
      }
      const minutes = hotelClock(now).minutes;
      for (const item of submission.items) {
        const product = catalogue.get(item.productId);
        const window = product && windows.get(product.categoryId);
        if (product && window && !inWindow(minutes, window)) {
          throw conflict("ITEM_NOT_AVAILABLE_NOW", `«${product.name.pt}» só está disponível das ${window.from} às ${window.until}.`, {
            productId: product.id,
            window,
          });
        }
      }
      return;
    }

    if (!settings.preOrdersEnabled) throw badRequest("PREORDERS_DISABLED", "De momento não aceitamos encomendas para mais tarde.");
    const error = checkScheduledTime(now, new Date(submission.scheduledFor), rules, [...windows.values()]);
    if (error) {
      const messages: Record<ScheduleError, string> = {
        TOO_SOON: `As encomendas precisam de pelo menos ${settings.minLeadMinutes} minutos de antecedência.`,
        TOO_FAR: settings.maxDaysAhead === 0 ? "Só aceitamos encomendas para hoje." : `Só aceitamos encomendas até ${settings.maxDaysAhead} dia(s) de antecedência.`,
        OUTSIDE_KITCHEN_HOURS: `A hora escolhida está fora do horário da cozinha (${settings.kitchenOpen}–${settings.kitchenClose}).`,
        OUTSIDE_ITEM_HOURS: "Um dos artigos não está disponível à hora escolhida (ex.: pequeno-almoço só de manhã).",
      };
      throw badRequest("SCHEDULE_INVALID", messages[error], { reason: error });
    }
  }

  private toGuestView(order: OrderDto, publicToken: string): GuestOrderDto {
    return {
      reference: order.reference,
      publicToken,
      status: order.status,
      locationType: order.locationType,
      locationLabel: order.locationLabel,
      scheduledFor: order.scheduledFor,
      depositCents: order.depositCents,
      depositStatus: order.depositStatus,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      charges: order.charges,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        options: i.options,
        lineTotalCents: i.lineTotalCents,
        notes: i.notes,
      })),
      whatsapp: {
        mode: this.whatsapp.mode,
        status: this.whatsapp.status(order.id),
        url: this.whatsapp.guestLink(order),
      },
    };
  }
}
