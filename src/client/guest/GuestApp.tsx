import { useCallback, useEffect, useMemo, useState } from "react";
import { LOCATION_TYPES, type Language, type LocationType } from "../../shared/constants";
import { localize } from "../../shared/localize";
import { formatMoney } from "../../shared/money";
import type { GuestOrderDto, ProductDto, PublicMenuDto } from "../../shared/types";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { storage } from "../lib/util";
import { useCart, usePricedCart } from "./cart";
import { CartSheet, type QrLocation } from "./CartSheet";
import { GuestContext, type GuestContextValue } from "./context";
import { GUEST_LANGUAGES, makeTranslator } from "./i18n";
import { MenuView } from "./MenuView";
import { OrderStatusView } from "./OrderStatusView";
import { ProductDialog } from "./ProductDialog";
import { ServiceDialog } from "./ServiceDialog";

const LANGUAGE_KEY = "np.language";
const LAST_ORDER_KEY = "np.lastOrder";

function initialLanguage(): Language {
  const stored = storage.get<Language>(LANGUAGE_KEY);
  if (stored && GUEST_LANGUAGES.some((l) => l.code === stored)) return stored;
  // Portuguese by default; offer another supported language only if the phone is set to it.
  const browser = navigator.language.slice(0, 2) as Language;
  return GUEST_LANGUAGES.some((l) => l.code === browser) ? browser : "pt";
}

/** Reads the table/room pre-filled by a QR code: ?t=room|table&loc=12 */
function readQrLocation(): QrLocation {
  const params = new URLSearchParams(location.search);
  const type = params.get("t");
  const label = params.get("loc") ?? "";
  return {
    type: LOCATION_TYPES.includes(type as LocationType) ? (type as LocationType) : null,
    label: /^[\p{L}\p{N} ._\-/#]{1,40}$/u.test(label) ? label : "",
  };
}

function readOrderToken(): string | null {
  const token = new URLSearchParams(location.search).get("order");
  return token && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
}

type MenuState = { status: "loading" } | { status: "error" } | { status: "ready"; menu: PublicMenuDto };

export function GuestApp() {
  const toast = useToast();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [menuState, setMenuState] = useState<MenuState>({ status: "loading" });
  const [openProduct, setOpenProduct] = useState<ProductDto | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [orderToken, setOrderToken] = useState<string | null>(readOrderToken);
  const [placedOrder, setPlacedOrder] = useState<GuestOrderDto | null>(null);
  const [lastOrder, setLastOrder] = useState<string | null>(() => storage.get<string>(LAST_ORDER_KEY));
  const [qrLocation] = useState(readQrLocation);
  const cart = useCart();

  const loadMenu = useCallback(async () => {
    setMenuState((s) => (s.status === "ready" ? s : { status: "loading" }));
    try {
      const menu = await api<PublicMenuDto>("/api/menu");
      setMenuState({ status: "ready", menu });
    } catch {
      setMenuState((s) => (s.status === "ready" ? s : { status: "error" }));
    }
  }, []);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  useEffect(() => {
    document.documentElement.lang = language === "pt" ? "pt-MZ" : language;
    storage.set(LANGUAGE_KEY, language);
  }, [language]);

  const menu = menuState.status === "ready" ? menuState.menu : null;
  const t = useMemo(() => makeTranslator(language), [language]);
  const ctx: GuestContextValue | null = useMemo(
    () =>
      menu && {
        language,
        t,
        settings: menu.settings,
        money: (cents: number) => formatMoney(cents, { symbol: menu.settings.currencySymbol }),
        text: (value) => localize(value, language),
      },
    [menu, language, t],
  );
  const priced = usePricedCart(cart.lines, menu?.products ?? [], menu?.settings.charges ?? [], language);

  const showOrder = (token: string | null) => {
    const url = new URL(location.href);
    if (token) url.searchParams.set("order", token);
    else url.searchParams.delete("order");
    history.pushState(null, "", url);
    setOrderToken(token);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const onPop = () => setOrderToken(readOrderToken());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (!ctx) {
    const tt = makeTranslator(language);
    return (
      <div className="page">
        <Header language={language} onLanguage={setLanguage} hotelName="Nelson's Place" />
        <main id="main" className="container state-block" aria-busy={menuState.status === "loading"}>
          {menuState.status === "loading" ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <p>{tt("loadingMenu")}</p>
            </>
          ) : (
            <>
              <p>{tt("loadError")}</p>
              <button type="button" className="btn btn-primary" onClick={() => void loadMenu()}>
                {tt("retry")}
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  const settings = ctx.settings;
  return (
    <GuestContext.Provider value={ctx}>
      <div className="page">
        <a href="#menu" className="skip-link">
          {t("skipToMenu")}
        </a>
        <Header
          language={language}
          onLanguage={setLanguage}
          hotelName={settings.hotelName}
          lastOrder={lastOrder && !orderToken ? () => showOrder(lastOrder) : undefined}
          lastOrderLabel={t("myOrder")}
          onCall={settings.serviceRequestsEnabled ? () => setCallOpen(true) : undefined}
          callLabel={t("callStaff")}
        />

        {orderToken ? (
          <OrderStatusView
            key={orderToken}
            token={orderToken}
            initial={placedOrder?.publicToken === orderToken ? placedOrder : null}
            onBackToMenu={() => showOrder(null)}
            onForget={() => {
              storage.remove(LAST_ORDER_KEY);
              setLastOrder(null);
            }}
          />
        ) : (
          <main id="main">
            <section className="hero">
              <div className="container hero-inner">
                <p className="eyebrow hero-eyebrow">
                  {t("welcome")} · {settings.hotelName}
                </p>
                <h1 className="hero-title">{t("heroTitle")}</h1>
                <p className="hero-text">{t("heroText")}</p>
              </div>
            </section>
            {!settings.ordersEnabled && (
              <div className="container">
                <p className="alert alert-warning paused-banner" role="status">
                  {settings.ordersPausedMessage ? ctx.text(settings.ordersPausedMessage) : t("ordersPaused")}
                </p>
              </div>
            )}
            <MenuView categories={menu!.categories} products={menu!.products} onOpenProduct={setOpenProduct} />
          </main>
        )}

        <footer className="site-footer">
          <div className="container row-between footer-inner">
            <span>
              © {new Date().getFullYear()} {settings.hotelName}
            </span>
            <span className="row">
              <span>{t("pricesIn", { currency: settings.currency })}</span>
              {settings.whatsappContactNumber && (
                <a href={`https://wa.me/${settings.whatsappContactNumber}`} target="_blank" rel="noopener noreferrer">
                  {t("contactHotel")}
                </a>
              )}
            </span>
          </div>
        </footer>

        {!orderToken && priced.itemCount > 0 && (
          <div className="cart-bar">
            <button type="button" className="cart-bar-btn" onClick={() => setCartOpen(true)}>
              <span className="cart-bar-count">{priced.itemCount}</span>
              <span>{t("viewOrder")}</span>
              <span className="cart-bar-total">{ctx.money(priced.totalCents)}</span>
            </button>
          </div>
        )}

        {settings.serviceRequestsEnabled && <ServiceDialog open={callOpen} onClose={() => setCallOpen(false)} qrLocation={qrLocation} />}
        <ProductDialog
          product={openProduct}
          canOrder={settings.ordersEnabled}
          onClose={() => setOpenProduct(null)}
          onAdd={(item) => {
            cart.add(item);
            setOpenProduct(null);
            toast(t("added"));
          }}
        />
        <CartSheet
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          lines={cart.lines}
          priced={priced}
          qrLocation={qrLocation}
          products={menu!.products}
          categories={menu!.categories}
          onQuantity={cart.setQuantity}
          onRemove={cart.remove}
          onMenuStale={() => void loadMenu()}
          onOrderPlaced={(order) => {
            cart.clear();
            setCartOpen(false);
            setPlacedOrder(order);
            storage.set(LAST_ORDER_KEY, order.publicToken);
            setLastOrder(order.publicToken);
            showOrder(order.publicToken);
          }}
        />
      </div>
    </GuestContext.Provider>
  );
}

function Header(props: {
  language: Language;
  onLanguage: (l: Language) => void;
  hotelName: string;
  lastOrder?: (() => void) | undefined;
  lastOrderLabel?: string;
  onCall?: (() => void) | undefined;
  callLabel?: string;
}) {
  const t = makeTranslator(props.language);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="brand" href="./" aria-label={props.hotelName}>
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <span className="brand-text">
            <strong>NELSON'S PLACE</strong>
            <small>APART HOTEL</small>
          </span>
        </a>
        <div className="header-actions">
          {props.onCall && (
            <button type="button" className="my-order-btn call-btn" onClick={props.onCall} aria-label={props.callLabel} title={props.callLabel}>
              <span aria-hidden="true">🛎️</span>
              <span className="my-order-label">{props.callLabel}</span>
            </button>
          )}
          {props.lastOrder && (
            <button type="button" className="my-order-btn" onClick={props.lastOrder} aria-label={props.lastOrderLabel} title={props.lastOrderLabel}>
              <svg className="my-order-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M6 2.75h12a.75.75 0 0 1 .75.75v17.25l-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5-2.25 1.5V3.5A.75.75 0 0 1 6 2.75Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M9 8h6M9 11.5h6M9 15h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="my-order-label">{props.lastOrderLabel}</span>
            </button>
          )}
          <label className="visually-hidden" htmlFor="language">
            {t("language")}
          </label>
          <select id="language" className="select language-select" value={props.language} onChange={(e) => props.onLanguage(e.target.value as Language)}>
            {GUEST_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} aria-label={l.label}>
                {l.code.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
