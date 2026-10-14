import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { OrderLocationType } from "../../shared/constants";
import { formatMoney } from "../../shared/money";
import { addDays } from "../../shared/schedule";
import { buildDailySummary } from "../../shared/daily-summary";
import type { DailySummaryStatusDto, ReportDto, ReportKpis } from "../../shared/types";
import { buildWhatsAppLink } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { ClosingReceipt } from "./ClosingReceipt";
import { printReceipt } from "./PrintReceipt";
import { api } from "../lib/api";
import { withBase } from "../lib/base";
import { cx, hotelToday } from "../lib/util";
import { useErrorMessage } from "./errors";
import { useSession } from "./session";

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
const PRESETS: { id: Exclude<Preset, "custom">; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "month", label: "Este mês" },
  { id: "lastMonth", label: "Mês passado" },
];

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = hotelToday();
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: firstOfMonth, to: today };
    case "lastMonth": {
      const lastDay = addDays(firstOfMonth, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
  }
}

const LOCATION_LABEL: Record<OrderLocationType, string> = { table: "Mesa (restaurante)", room: "Apartamento", takeaway: "Levantar no hotel" };
/** Categorical slots in fixed order (validated: CVD-safe on the light surface). Colour follows the entity. */
const LOCATION_COLOR: Record<OrderLocationType, string> = { table: "var(--viz-cat-1)", room: "var(--viz-cat-2)", takeaway: "var(--viz-cat-3)" };
const LOCATION_ORDER: OrderLocationType[] = ["table", "room", "takeaway"];

const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const longDay = (day: string) =>
  new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function ReportsPage() {
  const { settings, can } = useSession();
  const errorMessage = useErrorMessage();
  const [preset, setPreset] = useState<Preset>("7d");
  const [range, setRange] = useState(() => presetRange("7d"));
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const symbol = settings?.currencySymbol ?? "MT";
  const money = useCallback((cents: number) => formatMoney(cents, { symbol }), [symbol]);

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return;
    let cancelled = false;
    setLoading(true);
    api<ReportDto>(`/api/admin/reports?from=${range.from}&to=${range.to}`)
      .then((r) => {
        if (!cancelled) {
          setReport(r);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, errorMessage]);

  const choose = (p: Exclude<Preset, "custom">) => {
    setPreset(p);
    setRange(presetRange(p));
  };

  return (
    <div className="admin-page reports">
      <div className="row-between wrap page-head">
        <div>
          <h1 className="admin-title">Relatórios</h1>
          <p className="muted small">
            «Vendas» = pedidos aceites pela equipa (confirmados, em preparação, prontos ou concluídos). Pedidos pendentes e cancelados não contam.
          </p>
        </div>
        {can("reports.export") && (
          <a className="btn btn-secondary" href={withBase(`/api/admin/reports/orders.csv?from=${range.from}&to=${range.to}`)} download>
            Exportar pedidos (Excel/CSV)
          </a>
        )}
      </div>

      {/* One filter row scopes every figure below. */}
      <div className="report-filters" role="group" aria-label="Período">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={cx("filter-tab", preset === p.id && "active")} aria-pressed={preset === p.id} onClick={() => choose(p.id)}>
            {p.label}
          </button>
        ))}
        <label className="small report-date">
          De
          <input
            className="input"
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              setPreset("custom");
              setRange((r) => ({ ...r, from: e.target.value }));
            }}
          />
        </label>
        <label className="small report-date">
          Até
          <input
            className="input"
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              setPreset("custom");
              setRange((r) => ({ ...r, to: e.target.value }));
            }}
          />
        </label>
      </div>

      {error && <p className="alert alert-error">{error}</p>}
      {!report && !error && (
        <div className="state-block" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
        </div>
      )}

      {report && (
        <div className={cx("report-body", loading && "is-refreshing")} aria-busy={loading}>
          <p className="muted small">
            {longDay(report.from)} – {longDay(report.to)} · comparado com {shortDay(report.previousFrom)}–{shortDay(report.previousTo)}
          </p>
          <ClosingActions report={report} />
          <Kpis k={report.kpis} prev={report.previous} money={money} />

          {report.kpis.ordersReceived === 0 ? (
            <div className="state-block card">
              <h2>Sem pedidos neste período</h2>
              <p>Escolha outro período acima.</p>
            </div>
          ) : (
            <>
              <div className="report-grid">
                {report.daily.length > 1 && (
                  <ChartCard title="Vendas por dia" subtitle={`Total ${money(report.kpis.revenueCents)}`} table={<DailyTable report={report} money={money} />}>
                    <ColumnChart
                      data={report.daily.map((d) => ({ key: d.day, label: shortDay(d.day), value: d.revenueCents, tip: `${longDay(d.day)} · ${d.orders} pedido(s)` }))}
                      format={money}
                      compact={(v) => compactMoney(v, symbol)}
                    />
                  </ChartCard>
                )}
                <ChartCard title="Pedidos por hora do dia" subtitle="Horas de maior movimento (hora de Maputo)" table={<HourlyTable report={report} />}>
                  <ColumnChart
                    data={report.hourly.map((h) => ({ key: String(h.hour), label: `${h.hour}h`, value: h.orders, tip: `${h.hour}:00–${h.hour}:59` }))}
                    format={(v) => `${v} pedido(s)`}
                    compact={(v) => String(v)}
                    labelEvery={3}
                    integer
                  />
                </ChartCard>
              </div>

              <div className="report-grid">
                <ChartCard title="Artigos mais pedidos" subtitle="Por quantidade vendida">
                  <RankedBars rows={report.topItems.map((i) => ({ label: i.name, value: i.quantity, valueLabel: `${i.quantity}×`, extra: money(i.revenueCents) }))} extraHeader="Vendas" />
                </ChartCard>
                <ChartCard title="Vendas por categoria">
                  <RankedBars rows={report.categories.map((c) => ({ label: c.name, value: c.revenueCents, valueLabel: money(c.revenueCents), extra: `${c.quantity} art.` }))} extraHeader="Artigos" />
                </ChartCard>
              </div>

              <div className="report-grid">
                <ChartCard title="Como os clientes recebem" subtitle="Pedidos não cancelados">
                  <LocationMix report={report} money={money} />
                </ChartCard>
                <ChartCard title="Opções mais escolhidas" subtitle="Acompanhamentos, tamanhos, gelo…">
                  {report.topOptions.length === 0 ? (
                    <p className="muted small">Nenhuma opção escolhida neste período.</p>
                  ) : (
                    <RankedBars rows={report.topOptions.map((o) => ({ label: `${o.name}`, sub: o.group, value: o.count, valueLabel: `${o.count}×` }))} />
                  )}
                </ChartCard>
              </div>

              <div className="report-grid">
                <ChartCard title="Vendas por dia da semana" subtitle="Em que dias se vende mais" table={<WeekdayTable report={report} money={money} />}>
                  <ColumnChart
                    data={report.weekday.map((w) => ({ key: String(w.weekday), label: WEEKDAYS[w.weekday]!, value: w.revenueCents, tip: `${WEEKDAYS_LONG[w.weekday]} · ${w.orders} pedido(s)` }))}
                    format={money}
                    compact={(v) => compactMoney(v, symbol)}
                    labelEvery={1}
                  />
                </ChartCard>
                <ChartCard title="Clientes" subtitle="Identificados pelo telefone que indicaram no pedido">
                  <div className="mini-kpis">
                    <div>
                      <strong>{report.customers.withPhone}</strong>
                      <span>com telefone</span>
                    </div>
                    <div>
                      <strong>{report.customers.returning}</strong>
                      <span>
                        voltaram a encomendar
                        {report.customers.withPhone > 0 && ` (${Math.round((report.customers.returning / report.customers.withPhone) * 100)}%)`}
                      </span>
                    </div>
                  </div>
                  {report.customers.top.length > 0 ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Cliente</th>
                            <th scope="col">Pedidos no período</th>
                            <th scope="col">Pedidos no total</th>
                            <th scope="col">Vendas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.customers.top.map((c) => (
                            <tr key={c.phone}>
                              <td>
                                {c.name ?? "—"}
                                <div className="small muted">{c.phone}</div>
                              </td>
                              <td>{c.ordersInPeriod}</td>
                              <td>
                                {c.ordersEver}
                                {c.ordersEver > 1 && <span className="badge badge-success"> volta</span>}
                              </td>
                              <td className="nowrap">{money(c.revenueCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted small">Nenhum pedido com telefone neste período.</p>
                  )}
                </ChartCard>
              </div>

              <div className="report-grid">
                <ChartCard title="Desempenho da equipa" subtitle="Acções registadas no painel durante o período">
                  {report.staff.length === 0 ? (
                    <p className="muted small">Nenhuma acção da equipa neste período.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Pessoa</th>
                            <th scope="col">Confirmou</th>
                            <th scope="col">Concluiu</th>
                            <th scope="col">Cancelou</th>
                            <th scope="col">Tempo médio p/ confirmar</th>
                            <th scope="col">Respostas no chat</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.staff.map((s) => (
                            <tr key={s.name}>
                              <td>{s.name}</td>
                              <td>{s.confirmed}</td>
                              <td>{s.completed}</td>
                              <td>{s.cancelled}</td>
                              <td className="nowrap">{minutes(s.avgMinutesToConfirm)}</td>
                              <td>{s.replies}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </ChartCard>
                <ChartCard title="Artigos sem vendas" subtitle={`${report.unsoldItems.length} artigo(s) do menu sem nenhuma venda neste período`}>
                  {report.unsoldItems.length === 0 ? (
                    <p className="muted small">Todos os artigos do menu tiveram vendas. 👏</p>
                  ) : (
                    <ul className="unsold-list">
                      {report.unsoldItems.map((u) => (
                        <li key={`${u.category}-${u.name}`}>
                          <span>{u.name}</span>
                          <span className="small muted">{u.category}</span>
                          {!u.isAvailable && <span className="badge badge-muted">esgotado</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </ChartCard>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function Kpis({ k, prev, money }: { k: ReportKpis; prev: ReportKpis; money: (c: number) => string }) {
  const cancelRate = k.ordersReceived ? Math.round((k.ordersCancelled / k.ordersReceived) * 100) : 0;
  const prevCancelRate = prev.ordersReceived ? Math.round((prev.ordersCancelled / prev.ordersReceived) * 100) : 0;
  return (
    <div className="kpis">
      <Tile hero label="Vendas" value={money(k.revenueCents)} delta={delta(k.revenueCents, prev.revenueCents)} />
      <Tile label="Pedidos aceites" value={String(k.ordersSold)} delta={delta(k.ordersSold, prev.ordersSold)} note={`${k.ordersReceived} recebidos · ${k.ordersPending} pendentes`} />
      <Tile label="Valor médio por pedido" value={money(k.avgTicketCents)} delta={delta(k.avgTicketCents, prev.avgTicketCents)} />
      <Tile label="Artigos vendidos" value={String(k.itemsSold)} delta={delta(k.itemsSold, prev.itemsSold)} />
      <Tile label="Cancelados" value={`${k.ordersCancelled}`} note={`${cancelRate}% dos pedidos`} delta={delta(cancelRate, prevCancelRate)} upIsBad />
      <Tile label="Encomendas (para mais tarde)" value={String(k.scheduledOrders)} delta={delta(k.scheduledOrders, prev.scheduledOrders)} />
      <Tile label="Sinais recebidos" value={money(k.depositsConfirmedCents)} />
      <Tile label="Tempo médio até confirmar" value={minutes(k.avgMinutesToConfirm)} delta={delta(k.avgMinutesToConfirm ?? 0, prev.avgMinutesToConfirm ?? 0)} upIsBad />
      <Tile label="Tempo médio até concluir" value={minutes(k.avgMinutesToComplete)} delta={delta(k.avgMinutesToComplete ?? 0, prev.avgMinutesToComplete ?? 0)} upIsBad />
    </div>
  );
}

const minutes = (m: number | null) => (m === null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Tile({ label, value, note, delta: d, upIsBad, hero }: { label: string; value: string; note?: string; delta?: number | null; upIsBad?: boolean; hero?: boolean }) {
  const good = d !== null && d !== undefined && d !== 0 ? (d > 0) !== !!upIsBad : null;
  return (
    <div className={cx("kpi", hero && "kpi-hero")}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {note && <span className="kpi-note">{note}</span>}
      {d !== undefined && (
        <span className={cx("kpi-delta", good === true && "is-good", good === false && "is-bad")}>
          {d === null ? "sem comparação" : d === 0 ? "= igual ao período anterior" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}% vs período anterior`}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function ChartCard({ title, subtitle, children, table }: { title: string; subtitle?: string; children: ReactNode; table?: ReactNode }) {
  return (
    <section className="card chart-card">
      <header>
        <h2 className="card-title">{title}</h2>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </header>
      {children}
      {table && (
        <details className="chart-table">
          <summary>Ver dados em tabela</summary>
          {table}
        </details>
      )}
    </section>
  );
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= max / 1)! * pow;
  return step;
}

function compactMoney(cents: number, symbol: string): string {
  const v = cents / 100;
  return `${new Intl.NumberFormat("pt-PT", { notation: "compact", maximumFractionDigits: 1 }).format(v)} ${symbol}`;
}

/** Single-series column chart: thin bars, rounded data end, hairline grid, hover/focus tooltip. */
function ColumnChart({
  data,
  format,
  compact,
  labelEvery,
  integer,
}: {
  data: { key: string; label: string; value: number; tip: string }[];
  format: (v: number) => string;
  compact: (v: number) => string;
  labelEvery?: number;
  /** Counts: only whole-number axis ticks. */
  integer?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = useMemo(() => niceMax(Math.max(...data.map((d) => d.value))), [data]);
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 10));
  const ticks = [0, 0.5, 1].map((f) => f * max).filter((t) => !integer || Number.isInteger(t));
  return (
    <div className="colchart" onPointerLeave={() => setActive(null)}>
      <div className="colchart-plot">
        {ticks.map((t) => (
          <div key={t} className="colchart-grid" style={{ bottom: `${(t / max) * 100}%` }}>
            <span>{compact(t)}</span>
          </div>
        ))}
        <div className="colchart-bars">
          {data.map((d, i) => (
            <div
              key={d.key}
              className={cx("colchart-slot", active === i && "is-active")}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              tabIndex={0}
              aria-label={`${d.tip}: ${format(d.value)}`}
            >
              <div className="colchart-bar" style={{ height: `${(d.value / max) * 100}%` }} />
              {active === i && (
                <div className={cx("chart-tip", i > data.length / 2 && "tip-left")} role="tooltip">
                  <strong>{format(d.value)}</strong>
                  <span>{d.tip}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="colchart-labels" aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.key}>{i % every === 0 ? d.label : ""}</span>
        ))}
      </div>
    </div>
  );
}

/** Ranked horizontal bars with the value at the bar tip (single series). */
function RankedBars({ rows, extraHeader }: { rows: { label: string; sub?: string; value: number; valueLabel: string; extra?: string }[]; extraHeader?: string }) {
  if (rows.length === 0) return <p className="muted small">Sem dados neste período.</p>;
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  return (
    <table className="ranked">
      <thead className="visually-hidden">
        <tr>
          <th scope="col">Posição</th>
          <th scope="col">Nome</th>
          <th scope="col">Valor</th>
          {extraHeader && <th scope="col">{extraHeader}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.label}-${r.sub ?? ""}`}>
            <td className="ranked-pos">{i + 1}</td>
            <td className="ranked-main">
              <span className="ranked-label">
                {r.label}
                {r.sub && <span className="muted"> · {r.sub}</span>}
              </span>
              <span className="ranked-track">
                <span className="ranked-bar" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                <span className="ranked-value">{r.valueLabel}</span>
              </span>
            </td>
            {r.extra !== undefined && <td className="ranked-extra">{r.extra}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Part-to-whole of how orders are received: one 100% bar + legend + table. */
function LocationMix({ report, money }: { report: ReportDto; money: (c: number) => string }) {
  const rows = LOCATION_ORDER.map((type) => report.byLocation.find((l) => l.type === type) ?? { type, orders: 0, revenueCents: 0 });
  const total = rows.reduce((n, r) => n + r.orders, 0) || 1;
  return (
    <div className="mix">
      <div className="mix-bar" role="img" aria-label={rows.map((r) => `${LOCATION_LABEL[r.type]}: ${Math.round((r.orders / total) * 100)}%`).join(", ")}>
        {rows
          .filter((r) => r.orders > 0)
          .map((r) => {
            const pct = Math.round((r.orders / total) * 100);
            return (
              <span key={r.type} className={cx("mix-seg", `mix-${r.type}`)} style={{ flex: `${r.orders} 1 0`, background: LOCATION_COLOR[r.type] }} title={`${LOCATION_LABEL[r.type]}: ${pct}%`}>
                {pct >= 12 && <span className="mix-label">{pct}%</span>}
              </span>
            );
          })}
      </div>
      <table className="mix-table">
        <thead>
          <tr>
            <th scope="col">Entrega</th>
            <th scope="col">Pedidos</th>
            <th scope="col">%</th>
            <th scope="col">Vendas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type}>
              <td>
                <span className="legend-swatch" style={{ background: LOCATION_COLOR[r.type] }} aria-hidden="true" />
                {LOCATION_LABEL[r.type]}
              </td>
              <td>{r.orders}</td>
              <td>{Math.round((r.orders / total) * 100)}%</td>
              <td>{money(r.revenueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyTable({ report, money }: { report: ReportDto; money: (c: number) => string }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Dia</th>
          <th scope="col">Pedidos</th>
          <th scope="col">Vendas</th>
        </tr>
      </thead>
      <tbody>
        {report.daily.map((d) => (
          <tr key={d.day}>
            <td>{longDay(d.day)}</td>
            <td>{d.orders}</td>
            <td>{money(d.revenueCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HourlyTable({ report }: { report: ReportDto }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Hora</th>
          <th scope="col">Pedidos</th>
        </tr>
      </thead>
      <tbody>
        {report.hourly
          .filter((h) => h.orders > 0)
          .map((h) => (
            <tr key={h.hour}>
              <td>
                {h.hour}:00–{h.hour}:59
              </td>
              <td>{h.orders}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_LONG = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function WeekdayTable({ report, money }: { report: ReportDto; money: (c: number) => string }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">Dia</th>
          <th scope="col">Pedidos</th>
          <th scope="col">Vendas</th>
        </tr>
      </thead>
      <tbody>
        {report.weekday.map((w) => (
          <tr key={w.weekday}>
            <td>{WEEKDAYS_LONG[w.weekday]}</td>
            <td>{w.orders}</td>
            <td>{money(w.revenueCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Closing ticket, manual summary (WhatsApp/copy) and the automatic summary status. */
function ClosingActions({ report }: { report: ReportDto }) {
  const { settings, can } = useSession();
  const canExport = can("reports.export");
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<DailySummaryStatusDto | null>(null);
  const [sending, setSending] = useState(false);
  const symbol = settings?.currencySymbol ?? "MT";
  const hotelName = settings?.hotelName ?? "Nelson's Place";
  const text = buildDailySummary(report, { hotelName, currencySymbol: symbol });
  const singleDay = report.from === report.to;

  useEffect(() => {
    api<DailySummaryStatusDto>("/api/admin/reports/daily-summary").then(setStatus, () => undefined);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Resumo copiado.");
    } catch {
      toast("O navegador bloqueou a cópia.", "error");
    }
  };

  const sendNow = async () => {
    setSending(true);
    try {
      const next = await api<DailySummaryStatusDto>("/api/admin/reports/daily-summary/send", { method: "POST", body: { day: report.from } });
      setStatus(next);
      const result = next.recent.find((r) => r.day === report.from);
      toast(
        result?.status === "sent" ? `Resumo enviado (${result.channels}).` : result?.lastError ?? "Não foi possível enviar.",
        result?.status === "sent" ? "info" : "error",
      );
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSending(false);
    }
  };

  const channels = status ? [status.channels.email && "email", status.channels.whatsapp && "WhatsApp Business"].filter(Boolean).join(" e ") : "";
  const last = status?.recent[0];

  return (
    <section className="card closing">
      <div className="row-between wrap">
        <div>
          <h2 className="card-title">{singleDay ? "Fecho e resumo do dia" : "Fecho e resumo do período"}</h2>
          <p className="muted small">Talão de 80 mm para a impressora POS e resumo para enviar ao gerente.</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => printReceipt("closing-receipt")}>
            Imprimir fecho (80 mm)
          </button>
          {canExport && (
            <>
              <a className="btn btn-whatsapp btn-sm" href={buildWhatsAppLink(settings?.managerWhatsapp || null, text)} target="_blank" rel="noopener noreferrer">
                Enviar resumo por WhatsApp
              </a>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
                Copiar resumo
              </button>
            </>
          )}
        </div>
      </div>
      {status && (
        <p className="small">
          <strong>Envio automático:</strong>{" "}
          {!status.enabled
            ? "desligado (ligue em Definições → Resumo diário ao gerente)."
            : channels
              ? `ligado — todos os dias às ${status.sendsAt}, por ${channels}.`
              : "ligado, mas o servidor não tem email (SMTP) nem WhatsApp Business configurados — use o botão acima para enviar manualmente."}
          {last && ` Último: ${last.day.split("-").reverse().join("/")} — ${SUMMARY_STATUS[last.status]}${last.lastError ? ` (${last.lastError})` : ""}.`}
          {singleDay && status.enabled && channels && canExport && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={sending} onClick={() => void sendNow()}>
              Enviar agora este dia
            </button>
          )}
        </p>
      )}
      <ClosingReceipt report={report} hotelName={hotelName} hotel={settings} currencySymbol={symbol} />
    </section>
  );
}

const SUMMARY_STATUS: Record<DailySummaryStatusDto["recent"][number]["status"], string> = {
  pending: "a enviar",
  sent: "enviado",
  failed: "falhou",
  skipped: "não enviado (sem canal)",
};
