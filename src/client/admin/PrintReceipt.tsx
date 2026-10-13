import { createPortal } from "react-dom";
import { formatMoney } from "../../shared/money";
import type { AdminOrderDetailDto, HotelDetails } from "../../shared/types";
import { LOCATION_LABELS_PT } from "../../shared/whatsapp-message";
import { formatDateTime } from "../lib/util";
import { STATUS_LABEL } from "./labels";

/**
 * Kitchen/reception ticket for 80 mm thermal (POS) printers.
 * Rendered outside the app root so that, when printing, only the ticket is
 * shown (see `.receipt` rules in admin.css). Black only, fixed-width font,
 * 72 mm printable width (the usual area of 80 mm paper).
 */
export function PrintReceipt({
  order,
  hotelName,
  hotel,
  currencySymbol,
}: {
  order: AdminOrderDetailDto;
  hotelName: string;
  hotel: HotelDetails | null;
  currencySymbol: string;
}) {
  const money = (cents: number) => formatMoney(cents, { symbol: currencySymbol });
  const place = order.locationType === "takeaway" ? "LEVANTAR NO HOTEL" : `${LOCATION_LABELS_PT[order.locationType].toUpperCase()} ${order.locationLabel}`;

  return createPortal(
    <div className="receipt" id="receipt" aria-hidden="true">
      <div className="r-center r-strong">{hotelName.toUpperCase()}</div>
      {hotel?.hotelAddress && <div className="r-center">{hotel.hotelAddress}</div>}
      {hotel?.hotelPhone && <div className="r-center">Tel.: {hotel.hotelPhone}</div>}
      {hotel?.hotelEmail && <div className="r-center">{hotel.hotelEmail}</div>}
      {hotel?.hotelWebsite && <div className="r-center">{hotel.hotelWebsite}</div>}
      {hotel?.hotelNuit && <div className="r-center">NUIT: {hotel.hotelNuit}</div>}
      <div className="r-rule" />
      <div className="r-center r-strong">TALÃO DE PEDIDO</div>
      <div className="r-center">Menu digital</div>
      <div className="r-rule" />
      <div className="r-center r-big">{place}</div>
      <div className="r-center r-strong">{order.reference}</div>
      {order.scheduledFor && <div className="r-inverse">ENCOMENDA PARA {formatDateTime(order.scheduledFor)}</div>}
      <div className="r-row">
        <span>Recebido</span>
        <span>{formatDateTime(order.createdAt)}</span>
      </div>
      <div className="r-row">
        <span>Estado</span>
        <span>{STATUS_LABEL[order.status]}</span>
      </div>
      {order.guestName && (
        <div className="r-row">
          <span>Cliente</span>
          <span>{order.guestName}</span>
        </div>
      )}
      {order.contactPhone && (
        <div className="r-row">
          <span>Tel.</span>
          <span>{order.contactPhone}</span>
        </div>
      )}
      <div className="r-rule" />

      {order.items.map((item) => (
        <div key={item.id} className="r-item">
          <div className="r-row r-strong">
            <span>
              {item.quantity}x {item.productName}
            </span>
            <span>{money(item.lineTotalCents)}</span>
          </div>
          {item.options.map((o) => (
            <div key={o.optionId} className="r-sub">
              - {o.groupName}: {o.name}
            </div>
          ))}
          {item.notes && <div className="r-sub r-strong">* {item.notes}</div>}
        </div>
      ))}

      <div className="r-rule" />
      <div className="r-row">
        <span>Subtotal</span>
        <span>{money(order.subtotalCents)}</span>
      </div>
      {order.charges.map((c) => (
        <div key={c.id} className="r-row">
          <span>{c.label}</span>
          <span>{money(c.amountCents)}</span>
        </div>
      ))}
      <div className="r-row r-big">
        <span>TOTAL</span>
        <span>{money(order.totalCents)}</span>
      </div>
      {order.depositCents > 0 && (
        <>
          <div className="r-row">
            <span>Sinal ({order.depositStatus === "confirmed" ? "recebido" : "POR VERIFICAR"})</span>
            <span>{money(order.depositCents)}</span>
          </div>
          <div className="r-row">
            <span>A pagar no levantamento</span>
            <span>{money(order.totalCents - (order.depositStatus === "confirmed" ? order.depositCents : 0))}</span>
          </div>
          {order.paymentReference && <div className="r-sub">Ref. pagamento: {order.paymentReference}</div>}
        </>
      )}

      {order.notes && (
        <>
          <div className="r-rule" />
          <div className="r-strong">OBSERVAÇÕES:</div>
          <div>{order.notes}</div>
        </>
      )}

      <div className="r-rule" />
      <div className="r-center r-small">Talão de pedido — não serve de factura</div>
      <div className="r-center r-small">Impresso {formatDateTime(new Date().toISOString())}</div>
    </div>,
    document.body,
  );
}

/**
 * Prints the ticket on 80 mm paper. The page height is set to the ticket's
 * own length so thermal printers cut right after it instead of feeding a
 * full A4-length page.
 */
export function printReceipt(): void {
  const receipt = document.getElementById("receipt");
  if (!receipt) return;
  const heightMm = Math.ceil((receipt.scrollHeight * 25.4) / 96) + 6;
  const style = document.createElement("style");
  style.id = "receipt-page-size";
  style.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0; }`;
  document.getElementById("receipt-page-size")?.remove();
  document.head.appendChild(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
