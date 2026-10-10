import { createHash, randomBytes, randomInt } from "node:crypto";
import { HOTEL_TIME_ZONE } from "../../shared/constants";
import { canTransition } from "../../shared/order-status";
import { PricingError, priceOrder } from "../../shared/pricing";
import type { OrderSubmission } from "../../shared/schemas";
import type { AdminOrderDetailDto, GuestOrderDto, OrderDto, OrderListResponse } from "../../shared/types";
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
      if (!settings.locationTypes.includes(submission.location.type)) {
        throw badRequest("LOCATION_TYPE_NOT_ALLOWED", "Tipo de localização não disponível.");
      }
      if (settings.requireGuestName && !submission.guestName) {
        throw badRequest("GUEST_NAME_REQUIRED", "Indique o seu nome.");
      }
      if (settings.requireContactPhone && !submission.contactPhone) {
        throw badRequest("CONTACT_REQUIRED", "Indique um número de contacto.");
      }

      const catalogue = this.menu.getOrderableCatalogue(submission.items.map((i) => i.productId));
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
        locationLabel: submission.location.label,
        guestName: submission.guestName,
        contactPhone: submission.contactPhone,
        notes: submission.notes,
        language: submission.language,
        currency: settings.currency,
        priced,
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
    return { orders: this.orders.list(filter), counts: this.orders.countByStatus(), serverTime: new Date().toISOString() };
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
    if (!this.orders.updateStatus(id, expected, to, staffId, note)) {
      throw conflict("STATUS_CHANGED", "O estado deste pedido foi alterado por outra pessoa. Actualize e tente novamente.");
    }
    return this.detail(id);
  }

  private toGuestView(order: OrderDto, publicToken: string): GuestOrderDto {
    return {
      reference: order.reference,
      publicToken,
      status: order.status,
      locationType: order.locationType,
      locationLabel: order.locationLabel,
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
