import { useEffect, useState } from "react";
import { LOCATION_TYPES, type LocationType } from "../../shared/constants";
import { centsToInput, parseAmountToCents } from "../../shared/money";
import type { ChargeRule } from "../../shared/types";
import { LOCATION_LABELS_PT } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { useErrorMessage } from "./errors";
import { useSession, type AdminSettingsView } from "./session";

interface ChargeDraft {
  id: string;
  labelPt: string;
  labelEn: string;
  kind: ChargeRule["kind"];
  value: string;
}

export function SettingsPage() {
  const { settings, setSettings } = useSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState<AdminSettingsView | null>(settings);
  const [pausedPt, setPausedPt] = useState("");
  const [payPt, setPayPt] = useState("");
  const [payEn, setPayEn] = useState("");
  const [pausedEn, setPausedEn] = useState("");
  const [charges, setCharges] = useState<ChargeDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm(settings);
    setPausedPt(settings.ordersPausedMessage?.pt ?? "");
    setPayPt(settings.paymentInstructions?.pt ?? "");
    setPayEn(settings.paymentInstructions?.en ?? "");
    setPausedEn(settings.ordersPausedMessage?.en ?? "");
    setCharges(
      settings.charges.map((c) => ({
        id: c.id,
        labelPt: c.label.pt,
        labelEn: c.label.en ?? "",
        kind: c.kind,
        value: c.kind === "fixed" ? centsToInput(c.value) : String(c.value),
      })),
    );
  }, [settings]);

  if (!form) return <div className="state-block"><span className="spinner" aria-hidden="true" /></div>;

  const set = <K extends keyof AdminSettingsView>(key: K, value: AdminSettingsView[K]) => setForm({ ...form, [key]: value });
  const toggleLocation = (type: LocationType, on: boolean) =>
    set("locationTypes", on ? [...new Set([...form.locationTypes, type])] : form.locationTypes.filter((t) => t !== type));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let parsedCharges: ChargeRule[];
    try {
      parsedCharges = charges.map((c, i) => {
        if (!c.labelPt.trim()) throw new Error(`Indique o nome do encargo ${i + 1}.`);
        const value = c.kind === "fixed" ? parseAmountToCents(c.value) : Number(c.value);
        if (value === null || !Number.isInteger(value) || value < 0 || (c.kind === "percent" && value > 100)) {
          throw new Error(`Valor inválido no encargo «${c.labelPt}».`);
        }
        return { id: c.id, label: { pt: c.labelPt, en: c.labelEn || undefined }, kind: c.kind, value } as ChargeRule;
      });
    } catch (err) {
      return setError((err as Error).message);
    }
    if (form.locationTypes.length === 0) return setError("Seleccione pelo menos um tipo de localização.");
    setBusy(true);
    try {
      const saved = await api<AdminSettingsView>("/api/admin/settings", {
        method: "PUT",
        body: {
          hotelName: form.hotelName,
          currencySymbol: form.currencySymbol,
          whatsappNumber: form.whatsappNumber,
          ordersEnabled: form.ordersEnabled,
          ordersPausedMessage: pausedPt.trim() ? { pt: pausedPt, en: pausedEn || undefined } : null,
          locationTypes: form.locationTypes,
          requireGuestName: form.requireGuestName,
          requireContactPhone: form.requireContactPhone,
          charges: parsedCharges,
          preOrdersEnabled: form.preOrdersEnabled,
          kitchenOpen: form.kitchenOpen,
          kitchenClose: form.kitchenClose,
          minLeadMinutes: form.minLeadMinutes,
          maxDaysAhead: form.maxDaysAhead,
          takeawayEnabled: form.takeawayEnabled,
          takeawayDepositPercent: form.takeawayDepositPercent,
          paymentInstructions: payPt.trim() ? { pt: payPt, en: payEn || undefined } : null,
        },
      });
      setSettings(saved);
      toast("Definições guardadas.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-page narrow stack settings" onSubmit={save}>
      <h1 className="admin-title">Definições</h1>

      <section className="card stack">
        <h2 className="card-title">Hotel</h2>
        <div className="field">
          <label className="label" htmlFor="st-name">Nome apresentado</label>
          <input id="st-name" className="input" maxLength={100} value={form.hotelName} onChange={(e) => set("hotelName", e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="st-symbol">Símbolo da moeda</label>
          <input id="st-symbol" className="input input-narrow" maxLength={8} value={form.currencySymbol} onChange={(e) => set("currencySymbol", e.target.value)} required />
          <span className="hint">Moeda: {form.currency} (meticais). Os preços são guardados em centavos.</span>
        </div>
      </section>

      <section className="card stack">
        <h2 className="card-title">WhatsApp</h2>
        <div className="field">
          <label className="label" htmlFor="st-wa">Número de WhatsApp do hotel</label>
          <input
            id="st-wa"
            className="input"
            inputMode="tel"
            placeholder="258XXXXXXXXX"
            value={form.whatsappNumber}
            onChange={(e) => set("whatsappNumber", e.target.value)}
          />
          <span className="hint">Formato internacional com indicativo do país, sem «+» nem espaços (ex.: 2588XXXXXXXX). Deixe vazio para desactivar.</span>
        </div>
        <p className="small muted">
          Modo actual: <strong>{form.whatsappMode === "link" ? "Link pré-preenchido" : "API WhatsApp Business (envio automático)"}</strong>. O modo é
          definido no servidor (variável <code>WHATSAPP_MODE</code>) — ver docs/WHATSAPP.md.
        </p>
      </section>

      <section className="card stack">
        <h2 className="card-title">Pedidos</h2>
        <label className="check">
          <input type="checkbox" checked={form.ordersEnabled} onChange={(e) => set("ordersEnabled", e.target.checked)} />
          Aceitar pedidos pelo menu digital
        </label>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="st-paused-pt">Mensagem quando pausado (PT)</label>
            <input id="st-paused-pt" className="input" maxLength={200} value={pausedPt} onChange={(e) => setPausedPt(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="field">
            <label className="label" htmlFor="st-paused-en">Mensagem quando pausado (EN)</label>
            <input id="st-paused-en" className="input" maxLength={200} value={pausedEn} onChange={(e) => setPausedEn(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <fieldset className="plain-fieldset stack">
          <legend className="label">Onde os hóspedes podem receber pedidos</legend>
          {LOCATION_TYPES.map((type) => (
            <label key={type} className="check">
              <input type="checkbox" checked={form.locationTypes.includes(type)} onChange={(e) => toggleLocation(type, e.target.checked)} />
              {LOCATION_LABELS_PT[type]}
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={form.requireGuestName} onChange={(e) => set("requireGuestName", e.target.checked)} />
          Nome do hóspede obrigatório
        </label>
        <label className="check">
          <input type="checkbox" checked={form.requireContactPhone} onChange={(e) => set("requireContactPhone", e.target.checked)} />
          Telefone de contacto obrigatório
        </label>
      </section>

      <section className="card stack">
        <h2 className="card-title">Horário da cozinha e encomendas</h2>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="st-open">Cozinha abre</label>
            <input id="st-open" className="input" type="time" value={form.kitchenOpen} onChange={(e) => set("kitchenOpen", e.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="st-close">Cozinha fecha</label>
            <input id="st-close" className="input" type="time" value={form.kitchenClose} onChange={(e) => set("kitchenClose", e.target.value)} required />
          </div>
        </div>
        <p className="hint">Fora deste horário o menu não aceita pedidos para «agora». Horários por categoria (ex.: pequeno-almoço) definem-se em Menu → Editar categoria.</p>
        <label className="check">
          <input type="checkbox" checked={form.preOrdersEnabled} onChange={(e) => set("preOrdersEnabled", e.target.checked)} />
          Aceitar encomendas para mais tarde («Encomendar»)
        </label>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="st-lead">Antecedência mínima (minutos)</label>
            <input id="st-lead" className="input" type="number" min={0} max={600} value={form.minLeadMinutes} onChange={(e) => set("minLeadMinutes", Number(e.target.value) || 0)} />
            <span className="hint">Também é quando o painel avisa para começar a preparar.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="st-days">Encomendas até</label>
            <select id="st-days" className="select" value={form.maxDaysAhead} onChange={(e) => set("maxDaysAhead", Number(e.target.value))}>
              <option value={0}>Só para hoje</option>
              <option value={1}>Hoje e amanhã</option>
              <option value={2}>Até 2 dias</option>
              <option value={3}>Até 3 dias</option>
              <option value={7}>Até 7 dias</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 className="card-title">Levantar no hotel (take-away)</h2>
        <label className="check">
          <input type="checkbox" checked={form.takeawayEnabled} onChange={(e) => set("takeawayEnabled", e.target.checked)} />
          Permitir pedidos para levantar no hotel
        </label>
        <div className="field">
          <label className="label" htmlFor="st-deposit">Sinal a pagar ao fazer o pedido (%)</label>
          <input id="st-deposit" className="input input-narrow" type="number" min={0} max={100} value={form.takeawayDepositPercent} onChange={(e) => set("takeawayDepositPercent", Number(e.target.value) || 0)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="st-pay-pt">Instruções de pagamento (PT)</label>
            <textarea id="st-pay-pt" className="textarea" rows={3} maxLength={400} value={payPt} onChange={(e) => setPayPt(e.target.value)} placeholder="Ex.: M-Pesa 84 XXX XXXX (Nelson's Place)" />
          </div>
          <div className="field">
            <label className="label" htmlFor="st-pay-en">Instruções de pagamento (EN)</label>
            <textarea id="st-pay-en" className="textarea" rows={3} maxLength={400} value={payEn} onChange={(e) => setPayEn(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        {form.takeawayEnabled && !payPt.trim() && (
          <p className="alert alert-warning small">Enquanto não houver instruções de pagamento, a opção «Levantar» não aparece aos clientes.</p>
        )}
      </section>

      <section className="card stack">
        <div className="row-between">
          <h2 className="card-title">Encargos adicionais</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setCharges((cs) => [...cs, { id: `charge-${Date.now().toString(36)}`, labelPt: "", labelEn: "", kind: "percent", value: "0" }])}
            disabled={charges.length >= 5}
          >
            + Encargo
          </button>
        </div>
        <p className="alert alert-warning small">
          Adicione apenas encargos aprovados pela direcção do hotel (taxa de serviço, entrega, etc.). São somados ao total de cada pedido e mostrados ao hóspede.
        </p>
        {charges.length === 0 && <p className="small muted">Sem encargos adicionais: o total é a soma dos artigos.</p>}
        {charges.map((c, i) => (
          <div key={c.id} className="grid-charge">
            <input className="input" placeholder="Nome (PT)" aria-label={`Nome do encargo ${i + 1}`} value={c.labelPt} onChange={(e) => setCharges((cs) => cs.map((x) => (x.id === c.id ? { ...x, labelPt: e.target.value } : x)))} />
            <input className="input" placeholder="Nome (EN)" aria-label={`Nome do encargo ${i + 1} em inglês`} value={c.labelEn} onChange={(e) => setCharges((cs) => cs.map((x) => (x.id === c.id ? { ...x, labelEn: e.target.value } : x)))} />
            <select className="select" aria-label="Tipo" value={c.kind} onChange={(e) => setCharges((cs) => cs.map((x) => (x.id === c.id ? { ...x, kind: e.target.value as ChargeRule["kind"] } : x)))}>
              <option value="percent">% do subtotal</option>
              <option value="fixed">Valor fixo ({form.currencySymbol})</option>
            </select>
            <input className="input" inputMode="decimal" aria-label="Valor" value={c.value} onChange={(e) => setCharges((cs) => cs.map((x) => (x.id === c.id ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="icon-btn" aria-label="Remover encargo" onClick={() => setCharges((cs) => cs.filter((x) => x.id !== c.id))}>
              ×
            </button>
          </div>
        ))}
      </section>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="sticky-save">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
          Guardar definições
        </button>
      </div>
    </form>
  );
}
