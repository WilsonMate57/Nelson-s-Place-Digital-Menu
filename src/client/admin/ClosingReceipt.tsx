import { createPortal } from "react-dom";
import { periodLabel } from "../../shared/daily-summary";
import { formatMoney } from "../../shared/money";
import type { HotelDetails, ReportDto } from "../../shared/types";
import { formatDateTime } from "../lib/util";

const LOCATION = { table: "Mesa", room: "Apartamento", takeaway: "Levantar" } as const;

/** "Fecho do dia" for 80 mm POS printers (same format as the order ticket). */
export function ClosingReceipt({ report, hotelName, hotel, currencySymbol }: { report: ReportDto; hotelName: string; hotel: HotelDetails | null; currencySymbol: string }) {
  const money = (c: number) => formatMoney(c, { symbol: currencySymbol });
  const k = report.kpis;
  const row = (label: string, value: string | number, strong = false) => (
    <div className={strong ? "r-row r-strong" : "r-row"}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return createPortal(
    <div className="receipt" id="closing-receipt" aria-hidden="true">
      <div className="r-center r-strong">{hotelName.toUpperCase()}</div>
      {hotel?.hotelAddress && <div className="r-center">{hotel.hotelAddress}</div>}
      {hotel?.hotelNuit && <div className="r-center">NUIT: {hotel.hotelNuit}</div>}
      <div className="r-rule" />
      <div className="r-center r-big">{report.from === report.to ? "FECHO DO DIA" : "FECHO DO PERÍODO"}</div>
      <div className="r-center r-strong">{periodLabel(report)}</div>
      <div className="r-rule" />
      {row("VENDAS", money(k.revenueCents), true)}
      {row("Pedidos aceites", k.ordersSold)}
      {row("Pedidos recebidos", k.ordersReceived)}
      {row("Concluídos", k.ordersCompleted)}
      {row("Cancelados", k.ordersCancelled)}
      {row("Pendentes", k.ordersPending)}
      {row("Valor médio", money(k.avgTicketCents))}
      {row("Artigos vendidos", k.itemsSold)}
      {row("Encomendas", k.scheduledOrders)}
      {row("Sinais recebidos", money(k.depositsConfirmedCents))}
      {report.byLocation.length > 0 && (
        <>
          <div className="r-rule" />
          <div className="r-strong">POR ENTREGA</div>
          {report.byLocation.map((l) => (
            <div key={l.type}>{row(`${LOCATION[l.type]} (${l.orders})`, money(l.revenueCents))}</div>
          ))}
        </>
      )}
      {report.topItems.length > 0 && (
        <>
          <div className="r-rule" />
          <div className="r-strong">MAIS PEDIDOS</div>
          {report.topItems.map((i) => (
            <div key={i.name}>{row(`${i.quantity}x ${i.name}`, money(i.revenueCents))}</div>
          ))}
        </>
      )}
      {report.staff.length > 0 && (
        <>
          <div className="r-rule" />
          <div className="r-strong">EQUIPA (confirm./concl./canc.)</div>
          {report.staff.map((s) => (
            <div key={s.name}>{row(s.name, `${s.confirmed}/${s.completed}/${s.cancelled}`)}</div>
          ))}
        </>
      )}
      <div className="r-rule" />
      <div className="r-center r-small">Vendas = pedidos aceites. Não serve de documento fiscal.</div>
      <div className="r-center r-small">Impresso {formatDateTime(new Date().toISOString())}</div>
    </div>,
    document.body,
  );
}
