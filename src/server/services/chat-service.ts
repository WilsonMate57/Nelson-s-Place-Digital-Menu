import { isFinalStatus } from "../../shared/order-status";
import type { ChatThreadDto, OrderDto } from "../../shared/types";
import { AppError, notFound } from "../http/errors";
import type { AuditRepo } from "../repositories/audit-repo";
import type { MessagesRepo } from "../repositories/messages-repo";
import type { OrdersRepo } from "../repositories/orders-repo";

/** A finished (completed/cancelled) order stays open for messages this long. */
const OPEN_AFTER_FINISH_MS = 24 * 3600_000;
/** Anti-abuse: at most this many guest messages per order in 10 minutes. */
const GUEST_BURST_LIMIT = 15;

/**
 * Chat between the guest and the hotel staff, one thread per order.
 * Guests are identified only by the order's private token.
 */
export class ChatService {
  constructor(
    private readonly orders: OrdersRepo,
    private readonly messages: MessagesRepo,
    private readonly audit: AuditRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  guestThread(publicToken: string): ChatThreadDto {
    const order = this.orderByToken(publicToken);
    this.messages.markRead(order.id, "guest");
    return { messages: this.anonymiseStaff(this.messages.list(order.id)), open: this.isOpen(order) };
  }

  guestSend(publicToken: string, body: string): ChatThreadDto {
    const order = this.orderByToken(publicToken);
    if (!this.isOpen(order)) throw new AppError(409, "CHAT_CLOSED", "Esta conversa já foi encerrada. Contacte a recepção.");
    const since = new Date(this.now().getTime() - 10 * 60_000).toISOString();
    if (this.messages.countRecentFromGuest(order.id, since) >= GUEST_BURST_LIMIT) {
      throw new AppError(429, "RATE_LIMITED", "Enviou muitas mensagens seguidas. Aguarde um pouco pela resposta.");
    }
    this.messages.add(order.id, "guest", null, body);
    return this.guestThread(publicToken);
  }

  staffThread(orderId: number): ChatThreadDto {
    const order = this.orders.get(orderId);
    if (!order) throw notFound("Pedido não encontrado");
    this.messages.markRead(orderId, "staff");
    return { messages: this.messages.list(orderId), open: this.isOpen(order) };
  }

  staffSend(orderId: number, staffId: number, body: string): ChatThreadDto {
    const order = this.orders.get(orderId);
    if (!order) throw notFound("Pedido não encontrado");
    this.messages.add(orderId, "staff", staffId, body);
    this.audit.record(staffId, "chat_reply", "order", orderId);
    return this.staffThread(orderId);
  }

  private orderByToken(token: string): OrderDto {
    const order = this.orders.getByPublicToken(token);
    if (!order) throw notFound("Pedido não encontrado");
    return order;
  }

  private isOpen(order: OrderDto): boolean {
    if (!isFinalStatus(order.status)) return true;
    return this.now().getTime() - new Date(order.updatedAt).getTime() < OPEN_AFTER_FINISH_MS;
  }

  /** Guests see "Equipa do hotel", never individual staff names. */
  private anonymiseStaff(messages: ChatThreadDto["messages"]): ChatThreadDto["messages"] {
    return messages.map((m) => ({ ...m, authorName: null }));
  }
}
