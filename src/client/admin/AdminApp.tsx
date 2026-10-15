import { useEffect, useMemo, useState } from "react";
import type { StaffDto } from "../../shared/types";
import { useToast } from "../components/Toasts";
import { ApiError, api } from "../lib/api";
import { cx } from "../lib/util";
import { AccountPage } from "./AccountPage";
import { AuditPage } from "./AuditPage";
import { DataCleanup } from "./DataCleanup";
import { useHashRoute } from "./hooks";
import { LoginPage } from "./LoginPage";
import { MenuPage } from "./MenuPage";
import { OrdersPage } from "./OrdersPage";
import { OrderAlertsProvider, useOrderAlerts } from "./order-alerts";
import { ReportsPage } from "./ReportsPage";
import { makeCan, SessionContext, useSession, type AdminSettingsView, type SessionValue } from "./session";
import type { Permission } from "../../shared/permissions";
import { useErrorMessage } from "./errors";
import { SettingsPage } from "./SettingsPage";
import { StaffPage } from "./StaffPage";

type AuthState = { status: "checking" } | { status: "anonymous" } | { status: "signed-in"; staff: StaffDto };

export function AdminApp() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [settings, setSettings] = useState<AdminSettingsView | null>(null);

  useEffect(() => {
    api<{ staff: StaffDto }>("/api/auth/me")
      .then(({ staff }) => setAuth({ status: "signed-in", staff }))
      .catch(() => setAuth({ status: "anonymous" }));
  }, []);

  const signedInStaff = auth.status === "signed-in" ? auth.staff : null;
  useEffect(() => {
    if (!signedInStaff) return;
    api<AdminSettingsView>("/api/admin/settings")
      .then(setSettings)
      .catch(() => undefined);
  }, [signedInStaff]);

  const session: SessionValue | null = useMemo(
    () =>
      signedInStaff && {
        staff: signedInStaff,
        can: makeCan(signedInStaff),
        settings,
        setSettings,
        onUnauthorized: () => setAuth({ status: "anonymous" }),
      },
    [signedInStaff, settings],
  );

  if (auth.status === "checking") {
    return (
      <div className="state-block admin-loading" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }
  if (!session) return <LoginPage onSignedIn={(staff) => setAuth({ status: "signed-in", staff })} />;

  return (
    <SessionContext.Provider value={session}>
      <OrderAlertsProvider>
        <Shell onSignedOut={() => setAuth({ status: "anonymous" })} />
      </OrderAlertsProvider>
    </SessionContext.Provider>
  );
}

/** Each section is shown to profiles holding any of its permissions (none = everyone). */
const NAV: { path: string; label: string; needs?: Permission[] }[] = [
  { path: "orders", label: "Pedidos", needs: ["orders.view"] },
  { path: "menu", label: "Menu", needs: ["menu.availability", "menu.edit"] },
  { path: "reports", label: "Relatórios", needs: ["reports.view"] },
  { path: "staff", label: "Equipa", needs: ["staff.manage"] },
  { path: "settings", label: "Definições", needs: ["settings.manage"] },
  { path: "audit", label: "Registo", needs: ["audit.view"] },
  { path: "account", label: "Conta" },
];

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const { staff, can, settings, setSettings } = useSession();
  const alerts = useOrderAlerts();
  const [route, navigate] = useHashRoute();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [toggling, setToggling] = useState(false);
  const section = route[0] ?? "orders";
  const nav = NAV.filter((n) => !n.needs || can(...n.needs));
  const current = nav.some((n) => n.path === section) ? section : (nav[0]?.path ?? "account");

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  };

  const toggleOrders = async () => {
    if (!settings) return;
    const next = !settings.ordersEnabled;
    if (!next && !confirm("Pausar a recepção de pedidos pelo menu digital? Os hóspedes continuam a ver o menu.")) return;
    setToggling(true);
    try {
      setSettings(await api<AdminSettingsView>("/api/admin/settings/orders-enabled", { method: "PATCH", body: { ordersEnabled: next } }));
      toast(next ? "Pedidos retomados." : "Pedidos pausados.");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="admin">
      <a href="#admin-main" className="skip-link">
        Saltar para o conteúdo
      </a>
      <header className="admin-header">
        <div className="admin-header-inner">
          <a className="admin-brand" href="#/orders">
            <span className="brand-mark" aria-hidden="true">
              N
            </span>
            <span>
              <strong>Nelson's Place</strong>
              <small>Painel interno</small>
            </span>
          </a>
          {settings && can("orders.pause") && (
            <button
              type="button"
              className={cx("orders-toggle", settings.ordersEnabled ? "is-on" : "is-off")}
              onClick={() => void toggleOrders()}
              disabled={toggling}
              aria-pressed={settings.ordersEnabled}
              title="Ligar/desligar a recepção de pedidos"
            >
              <span className="orders-toggle-dot" aria-hidden="true" />
              <span className="toggle-long">{settings.ordersEnabled ? "A aceitar pedidos" : "Pedidos pausados"}</span>
              <span className="toggle-short">{settings.ordersEnabled ? "Aberto" : "Pausado"}</span>
            </button>
          )}
          {alerts && can("orders.view") && (
            <button
              type="button"
              className={cx("alerts-toggle", alerts.alertsOn && "is-on")}
              onClick={alerts.toggleAlerts}
              aria-pressed={alerts.alertsOn}
              title={alerts.alertsOn ? "Som e notificações ligados" : "Ligar som e notificações de novos pedidos"}
            >
              {alerts.alertsOn ? "🔔" : "🔕"}
              <span className="alerts-label">{alerts.alertsOn ? "Alertas ligados" : "Alertas desligados"}</span>
            </button>
          )}
          <div className="admin-user">
            <span className="admin-user-name">
              {staff.displayName}
              <small>{staff.roleName}</small>
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void signOut()}>
              Sair
            </button>
          </div>
        </div>
        <nav className="admin-nav" aria-label="Secções do painel">
          {nav.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={cx("admin-nav-link", current === n.path && "active")} aria-current={current === n.path ? "page" : undefined}>
              {n.label}
              {n.path === "orders" && alerts && alerts.attention > 0 && (
                <span className="nav-count" aria-label={`${alerts.attention} por tratar`}>
                  {alerts.attention > 99 ? "99+" : alerts.attention}
                </span>
              )}
            </a>
          ))}
        </nav>
      </header>
      <main id="admin-main" className="admin-main">
        {current === "orders" && <OrdersPage selectedId={route[1] ? Number(route[1]) : null} navigate={navigate} />}
        {current === "menu" && <MenuPage />}
        {current === "reports" && <ReportsPage />}
        {current === "staff" && <StaffPage />}
        {current === "settings" && (
          <>
            <SettingsPage />
            <DataCleanup />
          </>
        )}
        {current === "audit" && <AuditPage />}
        {current === "account" && <AccountPage />}
      </main>
    </div>
  );
}

export function isApiError(err: unknown, code: string): boolean {
  return err instanceof ApiError && err.code === code;
}
