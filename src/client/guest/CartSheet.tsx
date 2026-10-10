import { useRef, useState } from "react";
import { ORDER_LIMITS, type LocationType } from "../../shared/constants";
import type { OrderSubmissionInput } from "../../shared/schemas";
import type { GuestOrderDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { ApiError, api } from "../lib/api";
import { uuid } from "../lib/util";
import type { CartLine, usePricedCart } from "./cart";
import { useGuest } from "./context";
import { locationLabelKey, locationPlaceholderKey, locationTypeKey, type MessageKey } from "./i18n";

export interface QrLocation {
  type: LocationType | null;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  priced: ReturnType<typeof usePricedCart>;
  qrLocation: QrLocation;
  onQuantity: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  onOrderPlaced: (order: GuestOrderDto) => void;
  onMenuStale: () => void;
}

type Errors = Partial<Record<"location" | "guestName" | "contactPhone" | "form", string>>;

const LOCATION_PATTERN = /^[\p{L}\p{N} ._\-/#]+$/u;
const PHONE_PATTERN = /^\+?[0-9 ()-]{6,20}$/;

export function CartSheet(props: Props) {
  const { t } = useGuest();
  const [step, setStep] = useState<"cart" | "checkout">("cart");
  const close = () => {
    props.onClose();
    setStep("cart");
  };
  return (
    <Dialog
      open={props.open}
      onClose={close}
      variant="sheet"
      closeLabel={t("close")}
      title={step === "cart" ? t("cart") : t("checkout")}
    >
      {step === "cart" ? (
        <CartStep {...props} onClose={close} onContinue={() => setStep("checkout")} />
      ) : (
        <CheckoutStep {...props} onBack={() => setStep("cart")} />
      )}
    </Dialog>
  );
}

function Totals({ priced }: { priced: Props["priced"] }) {
  const { t, money } = useGuest();
  return (
    <dl className="totals">
      <div className="row-between">
        <dt>{t("subtotal")}</dt>
        <dd>{money(priced.subtotalCents)}</dd>
      </div>
      {priced.charges.map((c) => (
        <div className="row-between" key={c.id}>
          <dt>{c.label}</dt>
          <dd>{money(c.amountCents)}</dd>
        </div>
      ))}
      <div className="row-between totals-total">
        <dt>{t("total")}</dt>
        <dd className="price">{money(priced.totalCents)}</dd>
      </div>
    </dl>
  );
}

function CartStep({ priced, onQuantity, onRemove, onClose, onContinue }: Props & { onContinue: () => void }) {
  const { t, money, settings } = useGuest();
  if (priced.views.length === 0) {
    return (
      <div className="state-block">
        <p>{t("emptyCart")}</p>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t("browseMenu")}
        </button>
      </div>
    );
  }
  return (
    <div className="cart">
      <ul className="cart-lines">
        {priced.views.map(({ line, priced: p }) => (
          <li key={line.lineId} className={p ? "cart-line" : "cart-line cart-line-invalid"}>
            <div className="row-between cart-line-head">
              <strong>{p?.productName ?? "—"}</strong>
              {p && <span className="price">{money(p.lineTotalCents)}</span>}
            </div>
            {p && p.options.length > 0 && <p className="small muted">{p.options.map((o) => o.name).join(" · ")}</p>}
            {line.notes && <p className="small muted">“{line.notes}”</p>}
            {!p && (
              <p className="small field-error" role="alert">
                {t("lineInvalid")}
              </p>
            )}
            <div className="row-between cart-line-actions">
              {p ? (
                <div className="stepper stepper-sm" role="group" aria-label={`${t("quantity")}: ${p.productName}`}>
                  <button type="button" onClick={() => onQuantity(line.lineId, line.quantity - 1)} aria-label={t("decrease")}>
                    −
                  </button>
                  <output>{line.quantity}</output>
                  <button
                    type="button"
                    onClick={() => onQuantity(line.lineId, line.quantity + 1)}
                    disabled={line.quantity >= ORDER_LIMITS.maxQuantityPerLine}
                    aria-label={t("increase")}
                  >
                    +
                  </button>
                </div>
              ) : (
                <span />
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(line.lineId)}>
                {t("remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Totals priced={priced} />
      <p className="hint">{t("estimatedNote")}</p>
      {!settings.ordersEnabled && <p className="alert alert-warning">{t("ordersPaused")}</p>}
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={onContinue}
        disabled={priced.hasInvalid || !settings.ordersEnabled}
      >
        {t("continue")}
      </button>
    </div>
  );
}

function CheckoutStep({ lines, priced, qrLocation, onBack, onOrderPlaced, onMenuStale }: Props & { onBack: () => void }) {
  const { t, money, settings, language } = useGuest();
  const allowedTypes = settings.locationTypes;
  const initialType = qrLocation.type && allowedTypes.includes(qrLocation.type) ? qrLocation.type : allowedTypes[0]!;
  const [locationType, setLocationType] = useState<LocationType>(initialType);
  const [locationLabel, setLocationLabel] = useState(qrLocation.label);
  const [guestName, setGuestName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  // Reused for retries of the same content so a lost response never creates a duplicate order.
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null);

  const validate = (): Errors => {
    const e: Errors = {};
    const label = locationLabel.trim();
    if (!label) e.location = t("errRequired");
    else if (!LOCATION_PATTERN.test(label)) e.location = t("errLocation");
    if (settings.requireGuestName && !guestName.trim()) e.guestName = t("errRequired");
    const phone = contactPhone.trim();
    if (settings.requireContactPhone && !phone) e.contactPhone = t("errRequired");
    else if (phone && !PHONE_PATTERN.test(phone)) e.contactPhone = t("errPhone");
    return e;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    const content: Omit<OrderSubmissionInput, "idempotencyKey"> = {
      language,
      location: { type: locationType, label: locationLabel.trim() },
      guestName: guestName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      notes: notes.trim() || null,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, optionIds: l.optionIds, notes: l.notes })),
    };
    const fingerprint = JSON.stringify(content);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { key: uuid(), fingerprint };

    setSubmitting(true);
    try {
      const order = await api<GuestOrderDto>("/api/orders", {
        method: "POST",
        body: { ...content, idempotencyKey: attempt.current.key },
        timeoutMs: 25_000,
      });
      attempt.current = null;
      onOrderPlaced(order);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "");
      let message: MessageKey = "errGeneric";
      if (e.isNetwork) message = "errNetwork";
      else if (e.code === "MENU_CHANGED") {
        message = "errMenuChanged";
        onMenuStale();
      } else if (e.code === "ORDERS_PAUSED") message = "errPaused";
      else if (e.code === "RATE_LIMITED") message = "errRateLimited";
      else if (e.code === "IDEMPOTENCY_KEY_REUSED") attempt.current = null;
      setErrors({ form: t(message) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="checkout" onSubmit={submit} noValidate>
      <button type="button" className="btn btn-ghost btn-sm checkout-back" onClick={onBack}>
        ← {t("back")}
      </button>

      <fieldset className="checkout-section">
        <legend className="label">{t("where")}</legend>
        {allowedTypes.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label={t("where")}>
            {allowedTypes.map((type) => (
              <label key={type} className={type === locationType ? "segment active" : "segment"}>
                <input type="radio" name="locationType" value={type} checked={type === locationType} onChange={() => setLocationType(type)} />
                {t(locationTypeKey(type))}
              </label>
            ))}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="location-label">
            {t(locationLabelKey(locationType))}
          </label>
          <input
            id="location-label"
            className="input"
            inputMode="text"
            autoComplete="off"
            maxLength={ORDER_LIMITS.maxLocationLabelLength}
            placeholder={t(locationPlaceholderKey(locationType))}
            value={locationLabel}
            onChange={(e) => {
              setLocationLabel(e.target.value);
              if (errors.location) setErrors(({ location: _l, ...rest }) => rest);
            }}
            aria-invalid={errors.location ? true : undefined}
            aria-describedby="location-help"
          />
          {errors.location ? (
            <span id="location-help" className="field-error">
              {errors.location}
            </span>
          ) : (
            qrLocation.label && (
              <span id="location-help" className="hint">
                {t("locationFromQr")}
              </span>
            )
          )}
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="guest-name">
          {t("guestName")} {!settings.requireGuestName && <span className="muted">{t("optionalSuffix")}</span>}
        </label>
        <input
          id="guest-name"
          className="input"
          autoComplete="name"
          maxLength={ORDER_LIMITS.maxGuestNameLength}
          value={guestName}
          onChange={(e) => {
            setGuestName(e.target.value);
            if (errors.guestName) setErrors(({ guestName: _g, ...rest }) => rest);
          }}
          aria-invalid={errors.guestName ? true : undefined}
        />
        {errors.guestName && <span className="field-error">{errors.guestName}</span>}
      </div>

      <div className="field">
        <label className="label" htmlFor="contact-phone">
          {t("contactPhone")} {!settings.requireContactPhone && <span className="muted">{t("optionalSuffix")}</span>}
        </label>
        <input
          id="contact-phone"
          className="input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={ORDER_LIMITS.maxPhoneLength}
          placeholder="+258 …"
          value={contactPhone}
          onChange={(e) => {
            setContactPhone(e.target.value);
            if (errors.contactPhone) setErrors(({ contactPhone: _p, ...rest }) => rest);
          }}
          aria-invalid={errors.contactPhone ? true : undefined}
        />
        {errors.contactPhone && <span className="field-error">{errors.contactPhone}</span>}
      </div>

      <div className="field">
        <label className="label" htmlFor="order-notes">
          {t("orderNotes")} <span className="muted">{t("optionalSuffix")}</span>
        </label>
        <textarea
          id="order-notes"
          className="textarea"
          rows={2}
          maxLength={ORDER_LIMITS.maxNotesLength}
          placeholder={t("orderNotesPlaceholder")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <section className="checkout-review" aria-labelledby="review-title">
        <h3 id="review-title" className="label">
          {t("review")}
        </h3>
        <ul className="review-lines">
          {priced.views.map(({ line, priced: p }) =>
            p ? (
              <li key={line.lineId} className="row-between">
                <span>
                  {line.quantity} × {p.productName}
                  {p.options.length > 0 && <span className="muted small"> ({p.options.map((o) => o.name).join(", ")})</span>}
                </span>
                <span>{money(p.lineTotalCents)}</span>
              </li>
            ) : null,
          )}
        </ul>
        <Totals priced={priced} />
      </section>

      {errors.form && (
        <p className="alert alert-error" role="alert">
          {errors.form}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={submitting || priced.hasInvalid || lines.length === 0}>
        {submitting && <span className="spinner spinner-sm" aria-hidden="true" />}
        {submitting ? t("submitting") : `${t("submit")} · ${money(priced.totalCents)}`}
      </button>
    </form>
  );
}
