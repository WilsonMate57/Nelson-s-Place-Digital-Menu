import { useEffect, useState } from "react";
import { ORDER_LIMITS, PAYMENT_METHODS, type LocationType, type PaymentMethod, type ServiceRequestKind } from "../../shared/constants";
import type { GuestServiceRequestDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { ApiError, api } from "../lib/api";
import { cx } from "../lib/util";
import type { QrLocation } from "./CartSheet";
import { useGuest } from "./context";
import { locationLabelKey, locationPlaceholderKey, locationTypeKey, type MessageKey } from "./i18n";

const POLL_MS = 10_000;

/** "Chamar o empregado" / "Pedir a conta" without placing an order. */
export function ServiceDialog({ open, onClose, qrLocation }: { open: boolean; onClose: () => void; qrLocation: QrLocation }) {
  const { t, settings } = useGuest();
  const allowed = settings.locationTypes;
  const [kind, setKind] = useState<ServiceRequestKind>("waiter");
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [locationType, setLocationType] = useState<LocationType>(
    qrLocation.type && allowed.includes(qrLocation.type) ? qrLocation.type : allowed.includes("table") ? "table" : allowed[0]!,
  );
  const [label, setLabel] = useState(qrLocation.label);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<GuestServiceRequestDto | null>(null);

  // Follow the call until someone handles it.
  useEffect(() => {
    if (!open || !sent || sent.status === "done") return;
    const id = setInterval(() => {
      api<GuestServiceRequestDto>(`/api/service-requests/${sent.token}`).then(setSent, () => undefined);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [open, sent]);

  const send = async () => {
    if (!label.trim()) return setError(t("errRequired"));
    setError(null);
    setSending(true);
    try {
      setSent(
        await api<GuestServiceRequestDto>("/api/service-requests", {
          method: "POST",
          body: { kind, location: { type: locationType, label: label.trim() }, paymentMethod: kind === "bill" ? payment : null },
        }),
      );
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(e?.code === "RATE_LIMITED" ? t("errRateLimited") : e?.code === "VALIDATION_ERROR" ? t("errLocation") : t("callError"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("callStaffTitle")} closeLabel={t("close")}>
      {sent ? (
        <div className="stack call-sent" role="status">
          <p className={cx("alert", sent.status === "done" ? "alert-success" : "alert-info")}>
            {sent.status === "done" ? t("callDone") : t(`callSent_${sent.kind}` as MessageKey)}
          </p>
          {sent.status === "open" && (
            <p className="hint row">
              <span className="spinner spinner-sm" aria-hidden="true" /> {t("callWaiting")}
            </p>
          )}
          <div className="row wrap">
            <button type="button" className="btn btn-secondary" onClick={() => setSent(null)}>
              {t("callAgain")}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="call-options" role="radiogroup" aria-label={t("callStaffTitle")}>
            {(["waiter", "bill"] as const).map((k) => (
              <label key={k} className={cx("call-option", kind === k && "active")}>
                <input type="radio" name="call-kind" checked={kind === k} onChange={() => setKind(k)} />
                <span className="call-option-icon" aria-hidden="true">
                  {k === "waiter" ? "🛎️" : "🧾"}
                </span>
                <span>
                  <strong>{t(k === "waiter" ? "callWaiter" : "askBill")}</strong>
                  <span className="hint">{t(k === "waiter" ? "callWaiterHint" : "askBillHint")}</span>
                </span>
              </label>
            ))}
          </div>

          {kind === "bill" && (
            <fieldset className="checkout-section">
              <legend className="label">{t("payHow")}</legend>
              <div className="segmented" role="radiogroup" aria-label={t("payHow")}>
                {PAYMENT_METHODS.map((m) => (
                  <label key={m} className={payment === m ? "segment active" : "segment"}>
                    <input type="radio" name="payment" checked={payment === m} onChange={() => setPayment(m)} />
                    {t(`pay_${m}` as MessageKey)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="checkout-section">
            <legend className="label">{t("where")}</legend>
            {allowed.length > 1 && (
              <div className="segmented" role="radiogroup" aria-label={t("where")}>
                {allowed.map((type) => (
                  <label key={type} className={type === locationType ? "segment active" : "segment"}>
                    <input type="radio" name="call-location" checked={type === locationType} onChange={() => setLocationType(type)} />
                    {t(locationTypeKey(type))}
                  </label>
                ))}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="call-label">
                {t(locationLabelKey(locationType))}
              </label>
              <input
                id="call-label"
                className="input"
                autoComplete="off"
                maxLength={ORDER_LIMITS.maxLocationLabelLength}
                placeholder={t(locationPlaceholderKey(locationType))}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              {qrLocation.label && !error && <span className="hint">{t("locationFromQr")}</span>}
            </div>
          </fieldset>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-primary btn-block" disabled={sending} onClick={() => void send()}>
            {sending && <span className="spinner spinner-sm" aria-hidden="true" />}
            {t(kind === "waiter" ? "callWaiter" : "askBill")}
          </button>
        </div>
      )}
    </Dialog>
  );
}
