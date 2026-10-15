import { useCallback, useEffect, useState } from "react";
import type { OrderStatus } from "../../shared/constants";
import type { KitchenDto, OrderDto } from "../../shared/types";
import { describeLocation } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { cx, formatTime } from "../lib/util";
import { useErrorMessage } from "./errors";
import { useNow, usePolling } from "./hooks";
import { STATUS_ACTION } from "./labels";
import { useSession } from "./session";

const POLL_MS = 10_000;
/** An order waiting longer than this (minutes) is highlighted. */
const LATE_MINUTES = 30;

const COLUMNS: { status: OrderStatus; title: string; next: OrderStatus; action: string }[] = [
  { status: "CONFIRMED", title: "Por começar", next: "PREPARING", action: "Começar" },
  { status: "PREPARING", title: "Em preparação", next: "READY", action: "Pronto" },
  { status: "READY", title: "Pronto a entregar", next: "COMPLETED", action: "Entregue" },
];

/**
 * Large-type view for a kitchen tablet: accepted orders with their items,
 * one tap to move each order forward. Scheduled orders appear when it is
 * time to start them.
 */
export function KitchenPage() {
  const { can } = useSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [data, setData] = useState<KitchenDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const now = useNow();
  const [fullscreen, setFullscreen] = useState(false);
  const canAdvance = can("orders.status");

  const load = useCallback(async () => {
    try {
      setData(await api<KitchenDto>("/api/admin/kitchen"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [errorMessage]);
  usePolling(load, POLL_MS, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const advance = async (order: OrderDto, to: OrderStatus) => {
    setBusyId(order.id);
    try {
      await api(`/api/admin/orders/${order.id}/status`, { method: "POST", body: { to, expectedStatus: order.status } });
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (!data) {
    return (
      <div className="admin-page">
        {error ? <p className="alert alert-error">{error}</p> : <div className="state-block" aria-busy="true"><span className="spinner" aria-hidden="true" /></div>}
      </div>
    );
  }

  const leadMs = data.leadMinutes * 60_000;
  // Scheduled orders join the board when preparation should start.
  const isDue = (o: OrderDto) => !o.scheduledFor || new Date(o.scheduledFor).getTime() - leadMs <= now;
  const later = data.orders.filter((o) => o.status === "CONFIRMED" && !isDue(o));

  return (
    <div className="kitchen">
      <div className="row-between wrap kitchen-head">
        <h1 className="admin-title">Cozinha</h1>
        <div className="row wrap">
          {data.pendingCount > 0 && (
            <a className="badge badge-warning kitchen-pending" href="#/orders">
              {data.pendingCount} pedido(s) a aguardar confirmação na recepção
            </a>
          )}
          <span className="kitchen-clock">{formatTime(new Date(now).toISOString())}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={toggleFullscreen}>
            {fullscreen ? "Sair do ecrã inteiro" : "Ecrã inteiro"}
          </button>
        </div>
      </div>
      {error && <p className="alert alert-error small">{error}</p>}

      <div className="kitchen-board">
        {COLUMNS.map((col) => {
          const orders = data.orders.filter((o) => o.status === col.status && (col.status !== "CONFIRMED" || isDue(o)));
          return (
            <section key={col.status} className="kitchen-col" aria-labelledby={`k-${col.status}`}>
              <h2 id={`k-${col.status}`} className="kitchen-col-title">
                {col.title} <span className="kitchen-count">{orders.length}</span>
              </h2>
              {orders.length === 0 && <p className="muted kitchen-empty">Nada aqui.</p>}
              {orders.map((o) => {
                const minutes = Math.max(0, Math.round((now - new Date(o.scheduledFor ?? o.createdAt).getTime()) / 60_000));
                const late = col.status !== "READY" && minutes >= LATE_MINUTES;
                return (
                  <article key={o.id} className={cx("kitchen-ticket", late && "is-late")}>
                    <header className="kitchen-ticket-head">
                      <strong className="kitchen-where">{describeLocation(o.locationType, o.locationLabel)}</strong>
                      <span className="kitchen-ref">{o.reference.slice(-4)}</span>
                    </header>
                    <p className="small kitchen-time">
                      {o.scheduledFor ? `🕒 Para as ${formatTime(o.scheduledFor)}` : `Há ${minutes} min`}
                      {o.guestName && ` · ${o.guestName}`}
                    </p>
                    <ul className="kitchen-items">
                      {o.items.map((i) => (
                        <li key={i.id}>
                          <span className="kitchen-qty">{i.quantity}×</span> {i.productName}
                          {i.options.length > 0 && <span className="kitchen-options">{i.options.map((op) => op.name).join(", ")}</span>}
                          {i.notes && <span className="kitchen-note">⚠ {i.notes}</span>}
                        </li>
                      ))}
                    </ul>
                    {o.notes && <p className="kitchen-note">⚠ {o.notes}</p>}
                    {canAdvance && (
                      <button
                        type="button"
                        className={cx("btn kitchen-action", col.next === "COMPLETED" ? "btn-secondary" : "btn-primary")}
                        disabled={busyId === o.id}
                        title={STATUS_ACTION[col.next]}
                        onClick={() => void advance(o, col.next)}
                      >
                        {busyId === o.id && <span className="spinner spinner-sm" aria-hidden="true" />}
                        {col.action}
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      {later.length > 0 && (
        <section className="card kitchen-later">
          <h2 className="card-title">Encomendas para mais tarde</h2>
          <ul className="small">
            {later.map((o) => (
              <li key={o.id}>
                <strong>{formatTime(o.scheduledFor!)}</strong> — {describeLocation(o.locationType, o.locationLabel)}: {o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
