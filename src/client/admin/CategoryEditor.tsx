import { useEffect, useState } from "react";
import type { AdminCategoryDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { useErrorMessage } from "./errors";

interface Props {
  open: boolean;
  category: AdminCategoryDto | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CategoryEditor({ open, category, onClose, onSaved }: Props) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [namePt, setNamePt] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [descPt, setDescPt] = useState("");
  const [descEn, setDescEn] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [limited, setLimited] = useState(false);
  const [from, setFrom] = useState("07:00");
  const [until, setUntil] = useState("11:00");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNamePt(category?.name.pt ?? "");
    setNameEn(category?.name.en ?? "");
    setDescPt(category?.description?.pt ?? "");
    setDescEn(category?.description?.en ?? "");
    setSortOrder(String(category?.sortOrder ?? 0));
    setIsActive(category?.isActive ?? true);
    setLimited(!!category?.availableFrom);
    setFrom(category?.availableFrom ?? "07:00");
    setUntil(category?.availableUntil ?? "11:00");
    setError(null);
  }, [open, category]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!namePt.trim()) return setError("O nome em português é obrigatório.");
    setBusy(true);
    setError(null);
    const body = {
      name: { pt: namePt, en: nameEn || undefined },
      description: descPt.trim() ? { pt: descPt, en: descEn || undefined } : null,
      sortOrder: Number(sortOrder) || 0,
      isActive,
      availableFrom: limited ? from : null,
      availableUntil: limited ? until : null,
    };
    try {
      await api(category ? `/api/admin/categories/${category.id}` : "/api/admin/categories", { method: category ? "PUT" : "POST", body });
      toast("Categoria guardada.");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!category || !confirm(`Eliminar a categoria «${category.name.pt}»?`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/categories/${category.id}`, { method: "DELETE" });
      toast("Categoria eliminada.");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={category ? "Editar categoria" : "Nova categoria"}
      footer={
        <>
          {category && (
            <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy} style={{ marginRight: "auto" }}>
              Eliminar
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="category-form" className="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </>
      }
    >
      <form id="category-form" className="stack" onSubmit={save}>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="cat-name-pt">Nome (PT) *</label>
            <input id="cat-name-pt" className="input" maxLength={80} value={namePt} onChange={(e) => setNamePt(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="cat-name-en">Nome (EN)</label>
            <input id="cat-name-en" className="input" maxLength={80} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="cat-desc-pt">Descrição (PT)</label>
            <input id="cat-desc-pt" className="input" maxLength={300} value={descPt} onChange={(e) => setDescPt(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="cat-desc-en">Descrição (EN)</label>
            <input id="cat-desc-en" className="input" maxLength={300} value={descEn} onChange={(e) => setDescEn(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="cat-order">Ordem</label>
            <input id="cat-order" className="input" type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            <span className="hint">Números menores aparecem primeiro.</span>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Visível para os hóspedes
        </label>
        <label className="check">
          <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
          Disponível só em certo horário (ex.: pequeno-almoço de manhã)
        </label>
        {limited && (
          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="cat-from">Das</label>
              <input id="cat-from" className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="cat-until">Até às</label>
              <input id="cat-until" className="input" type="time" value={until} onChange={(e) => setUntil(e.target.value)} required />
            </div>
          </div>
        )}
        {error && <p className="alert alert-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
