import { useEffect, useRef, useState } from "react";
import { ORDER_STATUSES, type OrderStatus } from "../../shared/constants";
import { formatMoney } from "../../shared/money";
import type { OrderListResponse, OrderSummaryDto } from "../../shared/types";
import { describeLocation } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { cx, formatDateTime, formatTime, storage, timeAgo } from "../lib/util";
import { useErrorMessage } from "./errors";
import { useNow, usePolling } from "./hooks";
import { STATUS_LABEL, WHATSAPP_STATUS } from "./labels";
import { OrderDetail } from "./OrderDetail";
import { useSession } from "./session";

const POLL_MS = 10_000;
const SOUND_KEY = "np.admin.sound";

type Filter = OrderStatus | "ACTIVE" | "ALL" | "SCHEDULED";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "ACTIVE", label: "Em curso" },
  { value: "SCHEDULED", label: "Encomendas" },
  ...ORDER_STATUSES.map((s) => ({ value: s as Filter, label: STATUS_LABEL[s] })),
  { value: "ALL", label: "Todos" },
];

/** Short two-tone chime generated with Web Audio (no audio file needed). */
function playChime() {
  try {
    const ctx = new AudioContext();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* audio unavailable */
  }
}

export function OrdersPage({ selectedId, navigate }: { selectedId: number | null; navigate: (path: string) => void }) {
  const { settings } = useSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<OrderListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState<boolean>(() => storage.get<boolean>(SOUND_KEY) ?? false);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const knownPending = useRef<Set<number> | null>(null);
  const lastUnread = useRef<number | null>(null);
  const notifiedDue = useRef<Set<number>>(new Set());
  const [dueIds, setDueIds] = useState<Set<number>>(new Set());
  const symbol = settings?.currencySymbol ?? "MT";

  const load = async () => {
    const params = new URLSearchParams({ status: filter, limit: "150" });
    if (query.trim()) params.set("q", query.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const next = await api<OrderListResponse>(`/api/admin/orders?${params}`);
      setData(next);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  usePolling(load, POLL_MS, [filter, query, from, to]);

  // Detect newly arrived orders independently of the current filter.
  usePolling(
    async () => {
      try {
        const pending = await api<OrderListResponse>("/api/admin/orders?status=PENDING&limit=200");
        const ids = new Set(pending.orders.map((o) => o.id));
        const known = knownPending.current;
        if (known) {
          const arrived = pending.orders.filter((o) => !known.has(o.id));
          if (arrived.length) {
            setFreshIds((s) => new Set([...s, ...arrived.map((o) => o.id)]));
            toast(
              arrived.length === 1
                ? `${arrived[0]!.scheduledFor ? "Nova encomenda" : "Novo pedido"} ${arrived[0]!.reference} — ${describeLocation(arrived[0]!.locationType, arrived[0]!.locationLabel)}`
                : `${arrived.length} novos pedidos`,
            );
            if (storage.get<boolean>(SOUND_KEY)) playChime();
          }
        }
        knownPending.current = ids;
        const attention = ids.size + pending.unreadMessagesTotal;
        document.title = attention > 0 ? `(${attention}) Pedidos | Nelson's Place` : "Painel | Nelson's Place";

        // New guest chat messages.
        if (lastUnread.current !== null && pending.unreadMessagesTotal > lastUnread.current) {
          toast("💬 Nova mensagem de um cliente");
          if (storage.get<boolean>(SOUND_KEY)) playChime();
        }
        lastUnread.current = pending.unreadMessagesTotal;

        // Scheduled orders: alert once when it is time to start preparing them.
        const scheduled = await api<OrderListResponse>("/api/admin/orders?status=SCHEDULED&limit=200");
        const leadMs = (settings?.minLeadMinutes ?? 45) * 60_000;
        const due = scheduled.orders.filter(
          (o) => o.scheduledFor && (o.status === "PENDING" || o.status === "CONFIRMED") && new Date(o.scheduledFor).getTime() - leadMs <= Date.now(),
        );
        setDueIds(new Set(due.map((o) => o.id)));
        const newlyDue = due.filter((o) => !notifiedDue.current.has(o.id));
        for (const o of newlyDue) notifiedDue.current.add(o.id);
        if (newlyDue.length) {
          const o = newlyDue[0]!;
          toast(
            newlyDue.length === 1
              ? `Começar a preparar: ${describeLocation(o.locationType, o.locationLabel)} — para as ${formatTime(o.scheduledFor!)}`
              : `${newlyDue.length} encomendas para começar a preparar`,
          );
          if (storage.get<boolean>(SOUND_KEY)) playChime();
        }
      } catch {
        /* the main list shows connection errors */
      }
    },
    POLL_MS,
    [],
  );

  useEffect(() => () => void (document.title = "Painel | Nelson's Place"), []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    storage.set(SOUND_KEY, next);
    if (next) playChime(); // also unlocks audio after a user gesture
  };

  const open = (order: OrderSummaryDto) => {
    setFreshIds((s) => {
      const n = new Set(s);
      n.delete(order.id);
      return n;
    });
    navigate(`orders/${order.id}`);
  };

  const selectedSummary = data?.orders.find((o) => o.id === selectedId);

  return (
    <div className={cx("orders-layout", selectedId !== null && "has-selection")}>
      <section className="orders-list-pane" aria-label="Lista de pedidos">
        <div className="orders-toolbar">
          <div className="row-between">
            <h1 className="admin-title">Pedidos</h1>
            <button type="button" className={cx("btn btn-sm", sound ? "btn-primary" : "btn-secondary")} onClick={toggleSound} aria-pressed={sound}>
              {sound ? "🔔 Som ligado" : "🔕 Som desligado"}
            </button>
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Filtrar por estado">
            {FILTERS.map((f) => {
              const count =
                f.value === "SCHEDULED"
                  ? (data?.scheduledCount ?? null)
                  : f.value === "ACTIVE"
                  ? data && (data.counts.PENDING + data.counts.CONFIRMED + data.counts.PREPARING + data.counts.READY)
                  : f.value !== "ALL" && data
                    ? data.counts[f.value]
                    : null;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.value}
                  className={cx("filter-tab", filter === f.value && "active", f.value === "PENDING" && count ? "has-pending" : undefined)}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  {count !== null && count !== undefined && <span className="filter-count">{count}</span>}
                </button>
              );
            })}
          </div>
          <div className="orders-search">
            <input
              className="input"
              type="search"
              placeholder="Pesquisar referência, quarto/mesa ou nome"
              aria-label="Pesquisar pedidos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="date-range">
              <label className="small">
                De <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="small">
                Até <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              {(from || to) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setFrom(""), setTo(""))}>
                  Limpar
                </button>
              )}
            </div>
          </div>
          {settings && !settings.ordersEnabled && <p className="alert alert-warning small">Os pedidos pelo menu digital estão pausados.</p>}
          {error && (
            <p className="alert alert-error small" role="alert">
              {error}
            </p>
          )}
        </div>

        {!data && !error && (
          <div className="state-block" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
        {data && data.orders.length === 0 && (
          <div className="state-block">
            <h2>Sem pedidos</h2>
            <p>{filter === "ACTIVE" ? "Não há pedidos em curso. Os novos pedidos aparecem aqui automaticamente." : "Nenhum pedido corresponde aos filtros."}</p>
          </div>
        )}
        {data && data.orders.length > 0 && (
          <ul className="order-list">
            {data.orders.map((o) => {
              const wa = o.whatsappStatus ? WHATSAPP_STATUS[o.whatsappStatus] : null;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    className={cx("order-row", o.id === selectedId && "selected", freshIds.has(o.id) && "fresh", o.status === "PENDING" && "pending", dueIds.has(o.id) && "due")}
                    onClick={() => open(o)}
                    aria-current={o.id === selectedId ? "true" : undefined}
                  >
                    <div className="row-between">
                      <strong className="order-row-location">{describeLocation(o.locationType, o.locationLabel)}</strong>
                      <span className={`badge status-${o.status}`}>{STATUS_LABEL[o.status]}</span>
                    </div>
                    <div className="row-between small muted">
                      <span>
                        {o.reference} · {o.itemCount} artigo(s){o.guestName ? ` · ${o.guestName}` : ""}
                      </span>
                      <span className="price">{formatMoney(o.totalCents, { symbol })}</span>
                    </div>
                    <div className="row-between small muted">
                      <span title={formatDateTime(o.createdAt)}>
                        {formatTime(o.createdAt)} · {timeAgo(o.createdAt, now)}
                      </span>
                      {wa && <span className={`badge badge-${wa.tone}`}>WhatsApp: {wa.label}</span>}
                    </div>
                    {(o.scheduledFor || o.depositStatus === "pending" || dueIds.has(o.id) || o.unreadMessages > 0) && (
                      <div className="row wrap order-row-flags">
                        {o.scheduledFor && <span className="badge badge-scheduled">🕒 Para {formatDateTime(o.scheduledFor)}</span>}
                        {dueIds.has(o.id) && <span className="badge badge-danger">Começar a preparar</span>}
                        {o.unreadMessages > 0 && <span className="badge badge-chat">💬 {o.unreadMessages} nova(s)</span>}
                        {o.depositStatus === "pending" && <span className="badge badge-warning">Sinal por verificar</span>}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="order-detail-pane" aria-label="Detalhe do pedido">
        {selectedId ? (
          <OrderDetail
            key={selectedId}
            id={selectedId}
            version={selectedSummary?.updatedAt ?? null}
            onBack={() => navigate("orders")}
            onChanged={() => void load()}
          />
        ) : (
          <div className="state-block detail-empty">
            <p>Seleccione um pedido para ver os detalhes.</p>
          </div>
        )}
      </section>
    </div>
  );
}
