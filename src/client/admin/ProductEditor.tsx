import { useEffect, useRef, useState } from "react";
import { centsToInput, parseAmountToCents } from "../../shared/money";
import type { AdminCategoryDto, AdminProductDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { ProductImage } from "../components/ProductImage";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { uuid } from "../lib/util";
import { useErrorMessage } from "./errors";
import { resizeImage } from "./image-resize";
import { useSession } from "./session";

interface OptionDraft {
  key: string;
  id?: number;
  namePt: string;
  nameEn: string;
  price: string;
  isAvailable: boolean;
}
interface GroupDraft {
  key: string;
  id?: number;
  namePt: string;
  nameEn: string;
  required: boolean;
  maxSelect: string;
  options: OptionDraft[];
}

interface Props {
  open: boolean;
  product: AdminProductDto | null;
  defaultCategoryId: number | null;
  categories: AdminCategoryDto[];
  onClose: () => void;
  /** keepOpen: a new product was created and the editor stays open for the photo. */
  onSaved: (product: AdminProductDto, keepOpen: boolean) => void;
}

const newOption = (): OptionDraft => ({ key: uuid(), namePt: "", nameEn: "", price: "0", isAvailable: true });

export function ProductEditor({ open, product, defaultCategoryId, categories, onClose, onSaved }: Props) {
  const { settings, can } = useSession();
  // Without "Alterar preços" the price fields are read-only (also enforced by the server).
  const priceLocked = !can("menu.prices");
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [categoryId, setCategoryId] = useState<number>(0);
  const [namePt, setNamePt] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [descPt, setDescPt] = useState("");
  const [descEn, setDescEn] = useState("");
  const [price, setPrice] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isAvailable, setIsAvailable] = useState(true);
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const symbol = settings?.currencySymbol ?? "MT";

  useEffect(() => {
    if (!open) return;
    setCategoryId(product?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? 0);
    setNamePt(product?.name.pt ?? "");
    setNameEn(product?.name.en ?? "");
    setDescPt(product?.description?.pt ?? "");
    setDescEn(product?.description?.en ?? "");
    setPrice(product ? centsToInput(product.priceCents) : "");
    setSortOrder(String(product?.sortOrder ?? 0));
    setIsAvailable(product?.isAvailable ?? true);
    setGroups(
      (product?.optionGroups ?? []).map((g) => ({
        key: String(g.id),
        id: g.id,
        namePt: g.name.pt,
        nameEn: g.name.en ?? "",
        required: g.minSelect > 0,
        maxSelect: String(g.maxSelect),
        options: g.options.map((o) => ({
          key: String(o.id),
          id: o.id,
          namePt: o.name.pt,
          nameEn: o.name.en ?? "",
          price: centsToInput(o.priceDeltaCents),
          isAvailable: o.isAvailable,
        })),
      })),
    );
    setError(null);
    // Only reset when opening or switching product, not on every categories refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const updateGroup = (key: string, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const updateOption = (groupKey: string, optionKey: string, patch: Partial<OptionDraft>) =>
    setGroups((gs) => gs.map((g) => (g.key === groupKey ? { ...g, options: g.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) } : g)));

  const buildBody = () => {
    const priceCents = parseAmountToCents(price);
    if (!namePt.trim()) throw new Error("O nome em português é obrigatório.");
    if (priceCents === null) throw new Error("Preço inválido. Use, por exemplo, 250 ou 250,50.");
    const optionGroups = groups.map((g, gi) => {
      if (!g.namePt.trim()) throw new Error(`Dê um nome ao grupo de opções ${gi + 1}.`);
      if (g.options.length === 0) throw new Error(`O grupo «${g.namePt}» não tem opções.`);
      const maxSelect = Math.max(1, Math.min(g.options.length, Number(g.maxSelect) || 1));
      return {
        id: g.id,
        name: { pt: g.namePt, en: g.nameEn || undefined },
        minSelect: g.required ? 1 : 0,
        maxSelect,
        options: g.options.map((o) => {
          const delta = parseAmountToCents(o.price || "0");
          if (!o.namePt.trim()) throw new Error(`Há uma opção sem nome no grupo «${g.namePt}».`);
          if (delta === null) throw new Error(`Preço inválido na opção «${o.namePt}».`);
          return { id: o.id, name: { pt: o.namePt, en: o.nameEn || undefined }, priceDeltaCents: delta, isAvailable: o.isAvailable };
        }),
      };
    });
    return {
      categoryId,
      name: { pt: namePt, en: nameEn || undefined },
      description: descPt.trim() ? { pt: descPt, en: descEn || undefined } : null,
      priceCents,
      isAvailable,
      sortOrder: Number(sortOrder) || 0,
      optionGroups,
    };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let body;
    try {
      body = buildBody();
    } catch (err) {
      return setError((err as Error).message);
    }
    setBusy(true);
    try {
      const saved = await api<AdminProductDto>(product ? `/api/admin/products/${product.id}` : "/api/admin/products", {
        method: product ? "PUT" : "POST",
        body,
      });
      toast(product ? "Produto actualizado." : "Produto criado. Pode agora adicionar uma fotografia.");
      onSaved(saved, !product);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!product) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await resizeImage(file);
      const form = new FormData();
      form.append("image", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
      const saved = await api<AdminProductDto>(`/api/admin/products/${product.id}/image`, { method: "POST", body: form, timeoutMs: 60_000 });
      toast("Fotografia actualizada.");
      onSaved(saved, true);
    } catch (err) {
      setError(err instanceof Error && !("status" in err) ? err.message : errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeImage = async () => {
    if (!product || !confirm("Remover a fotografia deste produto?")) return;
    setUploading(true);
    try {
      onSaved(await api<AdminProductDto>(`/api/admin/products/${product.id}/image`, { method: "DELETE" }), true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="wide"
      title={product ? `Editar: ${product.name.pt}` : "Novo produto"}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
          <button type="submit" form="product-form" className="btn btn-primary" disabled={busy}>
            {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="product-form" className="stack" onSubmit={save}>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="p-category">Categoria</label>
            <select id="p-category" className="select" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.pt}
                  {!c.isActive ? " (oculta)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="p-price">Preço ({symbol}) *</label>
            <input id="p-price" className="input" inputMode="decimal" placeholder="Ex.: 650" value={price} onChange={(e) => setPrice(e.target.value)} required disabled={priceLocked} />
            {priceLocked && <span className="hint">O seu perfil não permite alterar preços.</span>}
          </div>
          <div className="field">
            <label className="label" htmlFor="p-name-pt">Nome (PT) *</label>
            <input id="p-name-pt" className="input" maxLength={100} value={namePt} onChange={(e) => setNamePt(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-name-en">Nome (EN)</label>
            <input id="p-name-en" className="input" maxLength={100} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-desc-pt">Descrição (PT)</label>
            <textarea id="p-desc-pt" className="textarea" rows={3} maxLength={500} value={descPt} onChange={(e) => setDescPt(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-desc-en">Descrição (EN)</label>
            <textarea id="p-desc-en" className="textarea" rows={3} maxLength={500} value={descEn} onChange={(e) => setDescEn(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-order">Ordem na categoria</label>
            <input id="p-order" className="input" type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
            Disponível para encomenda
          </label>
        </div>

        <section className="editor-section" aria-labelledby="opt-title">
          <div className="row-between">
            <h3 id="opt-title" className="label">Opções e personalização</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setGroups((gs) => [...gs, { key: uuid(), namePt: "", nameEn: "", required: false, maxSelect: "1", options: [newOption()] }])}
            >
              + Grupo de opções
            </button>
          </div>
          <p className="hint">Ex.: «Acompanhamento» (obrigatório, escolher 1) ou «Extras» (opcional, até 3). Os preços das opções são somados ao preço base.</p>
          {groups.map((g, gi) => (
            <fieldset key={g.key} className="option-editor">
              <legend className="visually-hidden">Grupo {gi + 1}</legend>
              <div className="grid-4">
                <input className="input" placeholder="Nome do grupo (PT) *" aria-label="Nome do grupo (PT)" value={g.namePt} onChange={(e) => updateGroup(g.key, { namePt: e.target.value })} />
                <input className="input" placeholder="Nome (EN)" aria-label="Nome do grupo (EN)" value={g.nameEn} onChange={(e) => updateGroup(g.key, { nameEn: e.target.value })} />
                <label className="check small">
                  <input type="checkbox" checked={g.required} onChange={(e) => updateGroup(g.key, { required: e.target.checked })} />
                  Obrigatório
                </label>
                <label className="small row">
                  Máx. escolhas
                  <input className="input input-narrow" type="number" min={1} max={20} value={g.maxSelect} onChange={(e) => updateGroup(g.key, { maxSelect: e.target.value })} />
                </label>
              </div>
              <ul className="option-editor-list">
                {g.options.map((o) => (
                  <li key={o.key} className="grid-option">
                    <input className="input" placeholder="Opção (PT) *" aria-label="Opção (PT)" value={o.namePt} onChange={(e) => updateOption(g.key, o.key, { namePt: e.target.value })} />
                    <input className="input" placeholder="Opção (EN)" aria-label="Opção (EN)" value={o.nameEn} onChange={(e) => updateOption(g.key, o.key, { nameEn: e.target.value })} />
                    <input className="input" inputMode="decimal" aria-label={`Preço adicional (${symbol})`} title={`Preço adicional (${symbol})`} value={o.price} onChange={(e) => updateOption(g.key, o.key, { price: e.target.value })} disabled={priceLocked} />
                    <label className="check small" title="Disponível">
                      <input type="checkbox" checked={o.isAvailable} onChange={(e) => updateOption(g.key, o.key, { isAvailable: e.target.checked })} />
                      Disp.
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remover opção"
                      onClick={() => updateGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateGroup(g.key, { options: [...g.options, newOption()] })}>
                  + Opção
                </button>
                <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}>
                  Remover grupo
                </button>
              </div>
            </fieldset>
          ))}
        </section>

        <section className="editor-section" aria-labelledby="img-title">
          <h3 id="img-title" className="label">Fotografia</h3>
          {product ? (
            <div className="row wrap image-editor">
              <ProductImage src={product.imageUrl} alt={product.name.pt} className="image-preview" />
              <div className="stack">
                <p className="hint">Use apenas fotografias reais e autorizadas dos pratos do hotel. JPEG, PNG ou WebP; a imagem é reduzida automaticamente.</p>
                <div className="row wrap">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="visually-hidden"
                    id="p-image"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                    {uploading && <span className="spinner spinner-sm" aria-hidden="true" />}
                    {product.imageUrl ? "Substituir fotografia" : "Carregar fotografia"}
                  </button>
                  {product.imageUrl && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => void removeImage()}>
                      Remover
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="hint">Guarde o produto primeiro para poder adicionar uma fotografia.</p>
          )}
        </section>

        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
