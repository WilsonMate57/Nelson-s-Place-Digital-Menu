import { useEffect, useMemo, useRef, useState } from "react";
import { ORDER_LIMITS, type LocationType, type OrderLocationType } from "../../shared/constants";
import { addDays, availableSlots, formatHm, hotelClock, inWindow, isKitchenOpen, type TimeWindow } from "../../shared/schedule";
import type { OrderSubmissionInput } from "../../shared/schemas";
import type { CategoryDto, GuestOrderDto, ProductDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { ApiError, api } from "../lib/api";
import { uuid } from "../lib/util";
import type { CartLine, usePricedCart } from "./cart";
import { useGuest } from "./context";
import { locationLabelKey, locationPlaceholderKey, locationTypeKey } from "./i18n";

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
  products: ProductDto[];
  categories: CategoryDto[];
  onQuantity: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  onOrderPlaced: (order: GuestOrderDto) => void;
  onMenuStale: () => void;
}

type Errors = Partial<Record<"location" | "guestName" | "contactPhone" | "paymentReference" | "when" | "form", string>>;

const LOCATION_DISPLAY_ORDER: LocationType[] = ["table", "room"];
const LOCATION_PATTERN =/^[\p{L}\p{N} ._\-/#]+$/u;
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

function CheckoutStep({ lines, priced, qrLocation, products, categories, onBack, onOrderPlaced, onMenuStale }: Props & { onBack: () => void }) {
  const { t, money, settings, language, text } = useGuest();
  // "Mesa" first and selected by default; a room QR code (?t=room) still pre-selects the room.
  const onSite = LOCATION_DISPLAY_ORDER.filter((type) => settings.locationTypes.includes(type));
  const allowedTypes: OrderLocationType[] = settings.takeawayEnabled ? [...onSite, "takeaway"] : onSite;
  const initialType = qrLocation.type && allowedTypes.includes(qrLocation.type) ? qrLocation.type : allowedTypes[0]!;
  const [locationType, setLocationType] = useState<OrderLocationType>(initialType);
  const [locationLabel, setLocationLabel] = useState(qrLocation.label);
  const [guestName, setGuestName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  // Reused for retries of the same content so a lost response never creates a duplicate order.
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null);

  // --- When: now or later ("Encomendar") ----------------------------------
  const now = useMinuteClock();
  const windows = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const result: TimeWindow[] = [];
    for (const line of lines) {
      const category = byId.get(products.find((p) => p.id === line.productId)?.categoryId ?? -1);
      if (category?.availableFrom && category.availableUntil) result.push({ from: category.availableFrom, until: category.availableUntil });
    }
    return result;
  }, [lines, products, categories]);
  const kitchenOpen = isKitchenOpen(now, settings);
  const itemsAvailableNow = windows.every((w) => inWindow(hotelClock(now).minutes, w));
  const canOrderNow = kitchenOpen && itemsAvailableNow;
  const slots = useMemo(() => (settings.preOrdersEnabled ? availableSlots(now, settings, windows) : []), [now, settings, windows]);
  const [when, setWhen] = useState<"now" | "later">(canOrderNow || slots.length === 0 ? "now" : "later");
  const days = useMemo(() => [...new Set(slots.map((s) => s.day))], [slots]);
  const [day, setDay] = useState<string>("");
  const [slotIso, setSlotIso] = useState<string>("");
  const activeDay = days.includes(day) ? day : (days[0] ?? "");
  const daySlots = slots.filter((s) => s.day === activeDay);
  const activeSlot = daySlots.find((s) => s.iso === slotIso) ?? daySlots[0] ?? null;

  const takeaway = locationType === "takeaway";
  const later = when === "later";
  const nameRequired = settings.requireGuestName || takeaway;
  const phoneRequired = settings.requireContactPhone || takeaway || later;
  const depositCents = takeaway ? Math.round((priced.totalCents * settings.takeawayDepositPercent) / 100) : 0;
  const dayLabel = (d: string) => {
    const today = hotelClock(now).day;
    if (d === today) return t("today");
    if (d === addDays(today, 1)) return t("tomorrow");
    return new Intl.DateTimeFormat(language === "pt" ? "pt-PT" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(`${d}T12:00:00Z`),
    );
  };

  const clearError = (key: keyof Errors) => {
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest);
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!takeaway) {
      const label = locationLabel.trim();
      if (!label) e.location = t("errRequired");
      else if (!LOCATION_PATTERN.test(label)) e.location = t("errLocation");
    }
    if (nameRequired && !guestName.trim()) e.guestName = t("errRequired");
    const phone = contactPhone.trim();
    if (phoneRequired && !phone) e.contactPhone = t("errRequired");
    else if (phone && !PHONE_PATTERN.test(phone)) e.contactPhone = t("errPhone");
    if (takeaway && settings.takeawayDepositPercent > 0 && !paymentReference.trim()) e.paymentReference = t("errRequired");
    if (!later && !canOrderNow) e.when = kitchenOpen ? t("itemsNotNow") : t("errKitchenClosed");
    if (later && !activeSlot) e.when = t("noSlots");
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
      location: { type: locationType, label: takeaway ? "" : locationLabel.trim() },
      scheduledFor: later ? activeSlot!.iso : null,
      paymentReference: takeaway ? paymentReference.trim() || null : null,
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
      let message: string = t("errGeneric");
      if (e.isNetwork) message = t("errNetwork");
      else if (e.code === "MENU_CHANGED") {
        const details = e.details as { reason?: string; available?: number } | undefined;
        message = details?.reason === "OUT_OF_STOCK" ? t("errOutOfStock", { n: details.available ?? 0 }) : t("errMenuChanged");
        onMenuStale();
      } else if (e.code === "ORDERS_PAUSED") message = t("errPaused");
      else if (e.code === "RATE_LIMITED") message = t("errRateLimited");
      else if (e.code === "KITCHEN_CLOSED") message = t("errKitchenClosed");
      else if (e.code === "SCHEDULE_INVALID") message = t("errSchedule");
      // Messages written for guests by the server (Portuguese).
      else if (["ITEM_NOT_AVAILABLE_NOW", "TAKEAWAY_DISABLED", "PREORDERS_DISABLED", "CONTACT_REQUIRED", "GUEST_NAME_REQUIRED", "PAYMENT_REFERENCE_REQUIRED"].includes(e.code)) message = e.message;
      else if (e.code === "IDEMPOTENCY_KEY_REUSED") attempt.current = null;
      setErrors({ form: message });
    } finally {
      setSubmitting(false);
    }
  };

  const optional = (required: boolean) => (!required ? <span className="muted">{t("optionalSuffix")}</span> : null);

  return (
    <form className="checkout" onSubmit={submit} noValidate>
      <button type="button" className="btn btn-ghost btn-sm checkout-back" onClick={onBack}>
        ← {t("back")}
      </button>

      <fieldset className="checkout-section">
        <legend className="label">{t("howToReceive")}</legend>
        {allowedTypes.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label={t("howToReceive")}>
            {allowedTypes.map((type) => (
              <label key={type} className={type === locationType ? "segment active" : "segment"}>
                <input type="radio" name="locationType" value={type} checked={type === locationType} onChange={() => setLocationType(type)} />
                {t(locationTypeKey(type))}
              </label>
            ))}
          </div>
        )}
        {takeaway ? (
          <p className="hint">{t("takeawayHint")}</p>
        ) : (
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
                clearError("location");
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
        )}
      </fieldset>

      {(settings.preOrdersEnabled || !canOrderNow) && (
        <fieldset className="checkout-section">
          <legend className="label">{t("when")}</legend>
          {settings.preOrdersEnabled && (
            <div className="segmented" role="radiogroup" aria-label={t("when")}>
              {(["now", "later"] as const).map((option) => (
                <label key={option} className={option === when ? "segment active" : "segment"}>
                  <input
                    type="radio"
                    name="when"
                    value={option}
                    checked={option === when}
                    onChange={() => {
                      setWhen(option);
                      clearError("when");
                    }}
                  />
                  {option === "now" ? t("whenNow") : t("whenLater")}
                </label>
              ))}
            </div>
          )}
          {!later && !canOrderNow && (
            <p className="alert alert-warning small">
              {kitchenOpen ? t("itemsNotNow") : t("kitchenClosedNow", { open: settings.kitchenOpen, close: settings.kitchenClose })}
            </p>
          )}
          {later &&
            (slots.length === 0 ? (
              <p className="alert alert-warning small">{t("noSlots")}</p>
            ) : (
              <div className="schedule-pickers">
                <div className="field">
                  <label className="label" htmlFor="schedule-day">
                    {t("scheduleDay")}
                  </label>
                  <select id="schedule-day" className="select" value={activeDay} onChange={(e) => setDay(e.target.value)}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {dayLabel(d)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="schedule-time">
                    {t("scheduleTime")}
                  </label>
                  <select id="schedule-time" className="select" value={activeSlot?.iso ?? ""} onChange={(e) => setSlotIso(e.target.value)}>
                    {daySlots.map((s) => (
                      <option key={s.iso} value={s.iso}>
                        {formatHm(s.minutes)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="hint schedule-hint">
                  {t("scheduleHint", { min: settings.minLeadMinutes, open: settings.kitchenOpen, close: settings.kitchenClose })}
                </p>
              </div>
            ))}
          {errors.when && (
            <span className="field-error" role="alert">
              {errors.when}
            </span>
          )}
        </fieldset>
      )}

      <div className="field">
        <label className="label" htmlFor="guest-name">
          {t("guestName")} {optional(nameRequired)}
        </label>
        <input
          id="guest-name"
          className="input"
          autoComplete="name"
          maxLength={ORDER_LIMITS.maxGuestNameLength}
          value={guestName}
          onChange={(e) => {
            setGuestName(e.target.value);
            clearError("guestName");
          }}
          aria-invalid={errors.guestName ? true : undefined}
        />
        {errors.guestName && <span className="field-error">{errors.guestName}</span>}
      </div>

      <div className="field">
        <label className="label" htmlFor="contact-phone">
          {t("contactPhone")} {optional(phoneRequired)}
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
            clearError("contactPhone");
          }}
          aria-invalid={errors.contactPhone ? true : undefined}
        />
        {errors.contactPhone && <span className="field-error">{errors.contactPhone}</span>}
      </div>

      {takeaway && depositCents > 0 && (
        <section className="deposit-box" aria-labelledby="deposit-title">
          <h3 id="deposit-title" className="label">
            {t("depositTitle", { pct: settings.takeawayDepositPercent, amount: money(depositCents) })}
          </h3>
          <p className="small">{t("depositText")}</p>
          {settings.paymentInstructions && <p className="payment-instructions">{text(settings.paymentInstructions)}</p>}
          <div className="field">
            <label className="label" htmlFor="payment-reference">
              {t("paymentReference")}
            </label>
            <input
              id="payment-reference"
              className="input"
              autoComplete="off"
              maxLength={ORDER_LIMITS.maxPaymentReferenceLength}
              placeholder={t("paymentReferencePlaceholder")}
              value={paymentReference}
              onChange={(e) => {
                setPaymentReference(e.target.value);
                clearError("paymentReference");
              }}
              aria-invalid={errors.paymentReference ? true : undefined}
            />
            {errors.paymentReference && <span className="field-error">{errors.paymentReference}</span>}
          </div>
        </section>
      )}

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
        {later && activeSlot && (
          <p className="small">
            <strong>
              {t("scheduledFor")}: {dayLabel(activeSlot.day)}, {formatHm(activeSlot.minutes)}
            </strong>
          </p>
        )}
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
        {depositCents > 0 && (
          <div className="row-between small">
            <span>{t("deposit")}</span>
            <strong>{money(depositCents)}</strong>
          </div>
        )}
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

/** Current time, refreshed every minute so the offered time slots stay valid. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
