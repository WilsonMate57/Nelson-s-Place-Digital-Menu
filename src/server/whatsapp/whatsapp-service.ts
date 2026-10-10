import type { IntegrationStatus, WhatsAppMode } from "../../shared/constants";
import type { OrderDto } from "../../shared/types";
import { buildOrderMessage, buildWhatsAppLink } from "../../shared/whatsapp-message";
import { conflict, notFound } from "../http/errors";
import type { IntegrationRepo } from "../repositories/integration-repo";
import type { OrdersRepo } from "../repositories/orders-repo";
import type { SettingsRepo } from "../repositories/settings-repo";
import { templateParameters, type CloudApiSender } from "./cloud-api";

const INTEGRATION = "whatsapp";

/**
 * Forwards orders to the hotel's WhatsApp. Kept separate from order
 * processing: the order is always committed first, and a WhatsApp failure
 * never changes or removes it.
 *
 * - `link` mode: generates a prefilled wa.me link for the guest. Nothing is
 *   sent by the server and delivery cannot be confirmed.
 * - `cloud_api` mode: the server sends a template message via the official
 *   WhatsApp Business Platform; result and errors are recorded.
 */
export class WhatsAppService {
  constructor(
    public readonly mode: WhatsAppMode,
    private readonly settings: SettingsRepo,
    private readonly orders: OrdersRepo,
    private readonly integrations: IntegrationRepo,
    private readonly sender: CloudApiSender | null,
    private readonly publicBaseUrl: string,
  ) {}

  /** Status recorded together with a new order (inside the order transaction). */
  initialStatus(): IntegrationStatus {
    if (!this.settings.get().whatsappNumber) return "not_configured";
    return this.mode === "link" ? "link_ready" : "pending";
  }

  registerOrder(orderId: number): void {
    this.integrations.create(orderId, INTEGRATION, this.mode, this.initialStatus());
  }

  dashboardUrl(orderId: number): string | null {
    return this.publicBaseUrl ? `${this.publicBaseUrl}/admin/#/orders/${orderId}` : null;
  }

  message(order: OrderDto, withDashboardLink = false): string {
    const s = this.settings.get();
    return buildOrderMessage(order, {
      hotelName: s.hotelName,
      currencySymbol: s.currencySymbol,
      dashboardUrl: withDashboardLink ? this.dashboardUrl(order.id) : null,
    });
  }

  /** Prefilled link the guest can use to send the order to the hotel (link mode only). */
  guestLink(order: OrderDto): string | null {
    const number = this.settings.get().whatsappNumber;
    if (this.mode !== "link" || !number) return null;
    return buildWhatsAppLink(number, this.message(order));
  }

  status(orderId: number): IntegrationStatus | null {
    return this.integrations.get(orderId, INTEGRATION)?.status ?? null;
  }

  markLinkOpened(orderId: number): void {
    this.integrations.markLinkOpened(orderId);
  }

  /**
   * Attempts server-side delivery (cloud_api mode). Safe to call more than
   * once: an attempt is only made when the record can be claimed, so a
   * message that was sent is never sent again.
   */
  async deliver(orderId: number): Promise<IntegrationStatus | null> {
    if (this.mode !== "cloud_api" || !this.sender) return this.status(orderId);
    const number = this.settings.get().whatsappNumber;
    if (!number) {
      this.integrations.markResult(orderId, INTEGRATION, "not_configured", "Número de WhatsApp do hotel não configurado");
      return "not_configured";
    }
    if (!this.integrations.claimAttempt(orderId, INTEGRATION)) return this.status(orderId);

    const order = this.orders.get(orderId);
    if (!order) {
      this.integrations.markResult(orderId, INTEGRATION, "failed", "Pedido não encontrado");
      return "failed";
    }
    const result = await this.sender.send(
      number,
      templateParameters(order, this.settings.get().currencySymbol, this.dashboardUrl(orderId)),
    );
    if (result.ok) {
      this.integrations.markResult(orderId, INTEGRATION, "sent", null, result.externalId);
      return "sent";
    }
    this.integrations.markResult(orderId, INTEGRATION, "failed", result.error);
    return "failed";
  }

  /** Staff-triggered retry of a failed server-side delivery. */
  async retry(orderId: number): Promise<IntegrationStatus | null> {
    const record = this.integrations.get(orderId, INTEGRATION);
    if (!record) throw notFound("Registo de WhatsApp não encontrado");
    if (record.channel !== "cloud_api" || this.mode !== "cloud_api") {
      throw conflict("RETRY_NOT_SUPPORTED", "O reenvio automático só existe no modo WhatsApp Cloud API. Use 'Copiar mensagem'.");
    }
    if (record.status === "sent") throw conflict("ALREADY_SENT", "A mensagem já foi entregue à API do WhatsApp.");
    return this.deliver(orderId);
  }
}
