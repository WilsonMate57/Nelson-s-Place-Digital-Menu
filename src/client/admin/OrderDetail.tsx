import { useCallback, useEffect, useState } from "react";
import type { OrderStatus, WhatsAppMode } from "../../shared/constants";
import { formatMoney } from "../../shared/money";
import { allowedTransitions } from "../../shared/order-status";
import type { AdminOrderDetailDto } from "../../shared/types";
import { describeLocation } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/util";
import { useErrorMessage } from "./errors";
import { STATUS_ACTION, STATUS_LABEL, WHATSAPP_STATUS } from "./labels";
import { PrintReceipt, printReceipt } from "./PrintReceipt";
import { StaffChat } from "./StaffChat";
import { useSession } from "./session";

interface Props {
  id: number;
  /** updatedAt from the polled list; a change triggers a reload. */
  version: string | null;
  onBack: () => void;
  onChanged: () => void;
}

export function OrderDetail({ id, version, onBack, onChanged }: Props) {
  const { settings, can } = useSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [order, setOrder] = useState<AdminOrderDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const symbol = settings?.currencySymbol ?? "MT";
  const money = (c: number) => formatMoney(c, { symbol });

  const load = useCallback(async () => {
    try {
      setOrder(await api<AdminOrderDetailDto>(`/api/admin/orders/${id}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id, errorMessage]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const changeStatus = async (to: OrderStatus, note: string | null = null) => {
    if (!order) return;
    setBusy(true);
    try {
      setOrder(await api<AdminOrderDetailDto>(`/api/admin/orders/${id}/status`, { method: "POST", body: { to, expectedStatus: order.status, note } }));
      toast(`Pedido ${order.reference}: ${STATUS_LABEL[to]}`);
      setCancelling(false);
      setCancelReason("");
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const confirmDeposit = async () => {
    if (!order || !confirm(`Confirma que recebeu o sinal de ${money(order.depositCents)} (ref. ${order.paymentReference ?? "—"})?`)) return;
    setBusy(true);
    try {
      setOrder(await api<AdminOrderDetailDto>(`/api/admin/orders/${id}/deposit/confirm`, { method: "POST" }));
      toast("Sinal registado como recebido.");
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  if (error && !order) {
    return (
      <div className="state-block">
        <p className="alert alert-error">{error}</p>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Voltar
        </button>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="state-block" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  const next = can("orders.status") ? allowedTransitions(order.status).filter((s) => s !== "CANCELLED") : [];
  const canCancel = can("orders.cancel") && allowedTransitions(order.status).includes("CANCELLED");

  return (
    <article className="order-detail" aria-labelledby="order-detail-title">
      <div className="order-detail-head">
        <button type="button" className="btn btn-ghost btn-sm detail-back" onClick={onBack}>
          ← Pedidos
        </button>
        <div className="row-between">
          <h2 id="order-detail-title" className="order-detail-title">
            {describeLocation(order.locationType, order.locationLabel)}
          </h2>
          <span className={`badge badge-lg status-${order.status}`}>{STATUS_LABEL[order.status]}</span>
        </div>
        <p className="muted small">
          {order.reference} · recebido {formatDateTime(order.createdAt)}
        </p>
        {order.scheduledFor && <p className="scheduled-banner">🕒 Encomenda para {formatDateTime(order.scheduledFor)}</p>}
      </div>

      {order.depositCents > 0 && (
        <div className={order.depositStatus === "confirmed" ? "deposit-panel is-confirmed" : "deposit-panel"}>
          <div className="row-between wrap">
            <strong>Sinal (pagamento antecipado): {money(order.depositCents)}</strong>
            <span className={order.depositStatus === "confirmed" ? "badge badge-success" : "badge badge-warning"}>
              {order.depositStatus === "confirmed" ? "Recebido" : "Por verificar"}
            </span>
          </div>
          <p className="small">
            Referência indicada pelo cliente: <strong>{order.paymentReference ?? "—"}</strong>
          </p>
          {order.depositStatus === "pending" && can("orders.deposit") && (
            <>
              <p className="small muted">Verifique o pagamento (M-Pesa, banco, etc.) antes de confirmar. O pedido só pode ser confirmado depois do sinal.</p>
              <button type="button" className="btn btn-primary btn-sm no-print" disabled={busy} onClick={() => void confirmDeposit()}>
                Sinal recebido
              </button>
            </>
          )}
        </div>
      )}

      {(next.length > 0 || canCancel) && (
        <div className="status-actions no-print">
          {next.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-primary"
              disabled={busy || (s === "CONFIRMED" && order.depositStatus === "pending")}
              title={s === "CONFIRMED" && order.depositStatus === "pending" ? "Confirme primeiro o sinal" : undefined}
              onClick={() => void changeStatus(s)}
            >
              {STATUS_ACTION[s]}
            </button>
          ))}
          {canCancel && !cancelling && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setCancelling(true)}>
              Cancelar…
            </button>
          )}
        </div>
      )}
      {cancelling && (
        <div className="cancel-box no-print">
          <label className="label" htmlFor="cancel-reason">
            Motivo do cancelamento (opcional)
          </label>
          <textarea id="cancel-reason" className="textarea" rows={2} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void changeStatus("CANCELLED", cancelReason.trim() || null)}>
              Confirmar cancelamento
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCancelling(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      <StaffChat orderId={order.id} canReply={can("chat.reply")} />

      <section className="detail-section">
        <h3 className="detail-heading">Hóspede</h3>
        <dl className="kv">
          <dt>Nome</dt>
          <dd>{order.guestName ?? "—"}</dd>
          <dt>Contacto</dt>
          <dd>{order.contactPhone ? <a href={`tel:${order.contactPhone.replace(/[^\d+]/g, "")}`}>{order.contactPhone}</a> : "—"}</dd>
          <dt>Idioma</dt>
          <dd>{order.language.toUpperCase()}</dd>
        </dl>
        {order.notes && <p className="notes-box">“{order.notes}”</p>}
      </section>

      <section className="detail-section">
        <h3 className="detail-heading">Artigos</h3>
        <ul className="detail-items">
          {order.items.map((item) => (
            <li key={item.id}>
              <div className="row-between">
                <strong>
                  {item.quantity} × {item.productName}
                </strong>
                <span className="price">{money(item.lineTotalCents)}</span>
              </div>
              {item.options.map((o) => (
                <div key={o.optionId} className="small muted">
                  {o.groupName}: {o.name}
                  {o.priceDeltaCents > 0 && ` (+${money(o.priceDeltaCents)})`}
                </div>
              ))}
              {item.notes && <div className="small item-note">✎ {item.notes}</div>}
              <div className="small muted">{money(item.unitPriceCents)} / un.</div>
            </li>
          ))}
        </ul>
        <dl className="totals">
          <div className="row-between">
            <dt>Subtotal</dt>
            <dd>{money(order.subtotalCents)}</dd>
          </div>
          {order.charges.map((c) => (
            <div key={c.id} className="row-between">
              <dt>{c.label}</dt>
              <dd>{money(c.amountCents)}</dd>
            </div>
          ))}
          <div className="row-between totals-total">
            <dt>Total</dt>
            <dd className="price">{money(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

      <WhatsAppSection order={order} mode={settings?.whatsappMode ?? "link"} onUpdated={setOrder} />

      <section className="detail-section">
        <h3 className="detail-heading">Histórico</h3>
        <ol className="timeline">
          {order.history.map((h) => (
            <li key={h.id}>
              <span className={`badge status-${h.toStatus}`}>{STATUS_LABEL[h.toStatus]}</span>
              <span className="small muted">
                {formatDateTime(h.createdAt)} · {h.staffName ?? "Hóspede (menu digital)"}
              </span>
              {h.note && <span className="small">“{h.note}”</span>}
            </li>
          ))}
        </ol>
      </section>

      {order.review && (
        <section className="card">
          <h2 className="card-title">Avaliação do cliente</h2>
          <p className="stars-static" aria-label={`${order.review.rating} de 5 estrelas`}>
            {"★".repeat(order.review.rating)}
            <span className="stars-off">{"★".repeat(5 - order.review.rating)}</span>
          </p>
          {order.review.comment && <p>“{order.review.comment}”</p>}
        </section>
      )}

      <div className="no-print">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => printReceipt("receipt", `Talao_${order.reference}`)}>
          Imprimir talão (80 mm)
        </button>
      </div>
      <PrintReceipt order={order} hotelName={settings?.hotelName ?? "Nelson's Place"} hotel={settings} currencySymbol={symbol} />
    </article>
  );
}

function WhatsAppSection({ order, mode, onUpdated }: { order: AdminOrderDetailDto; mode: WhatsAppMode; onUpdated: (o: AdminOrderDetailDto) => void }) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const event = order.integrations.find((i) => i.integration === "whatsapp");
  const info = event ? WHATSAPP_STATUS[event.status] : null;

  const fetchMessage = () => api<{ text: string; shareUrl: string; hotelUrl: string | null }>(`/api/admin/orders/${order.id}/whatsapp`);

  const copy = async () => {
    try {
      const { text } = await fetchMessage();
      await navigator.clipboard.writeText(text);
      toast("Mensagem copiada.");
    } catch (err) {
      toast(err instanceof Error && err.name === "NotAllowedError" ? "O navegador bloqueou a cópia." : errorMessage(err), "error");
    }
  };

  const share = async () => {
    // Open the window synchronously to avoid pop-up blockers, then point it at WhatsApp.
    const win = window.open("about:blank", "_blank");
    try {
      const { shareUrl } = await fetchMessage();
      if (win) {
        win.opener = null;
        win.location.href = shareUrl;
      } else {
        location.href = shareUrl;
      }
    } catch (err) {
      win?.close();
      toast(errorMessage(err), "error");
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      onUpdated(await api(`/api/admin/orders/${order.id}/whatsapp/retry`, { method: "POST" }));
      toast("Tentativa de envio concluída.");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="detail-section no-print">
      <h3 className="detail-heading">WhatsApp</h3>
      {event && info ? (
        <div className="stack">
          <div className="row">
            <span className={`badge badge-${info.tone}`}>{info.label}</span>
            <span className="small muted">
              {event.channel === "link" ? "Link pré-preenchido" : "API WhatsApp Business"} · {event.attempts} tentativa(s)
            </span>
          </div>
          <p className="small muted">{info.help}</p>
          {event.lastError && <p className="alert alert-error small">{event.lastError}</p>}
        </div>
      ) : (
        <p className="small muted">Sem registo de WhatsApp.</p>
      )}
      <div className="row wrap">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
          Copiar mensagem
        </button>
        <button type="button" className="btn btn-whatsapp btn-sm" onClick={() => void share()}>
          Encaminhar no WhatsApp
        </button>
        {mode === "cloud_api" && event?.channel === "cloud_api" && event.status !== "sent" && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void retry()}>
            Reenviar automaticamente
          </button>
        )}
      </div>
    </section>
  );
}
