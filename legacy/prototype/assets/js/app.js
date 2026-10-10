import { APP_CONFIG } from "./config.js";
import { categories, products } from "./menu-data.js";
import { translations } from "./i18n.js";

const state = { language: APP_CONFIG.defaultLanguage, category: "all", query: "", cart: [] };
const $ = (s) => document.querySelector(s);
const money = (value) => new Intl.NumberFormat(state.language, { style: "currency", currency: APP_CONFIG.currency, maximumFractionDigits: 0 }).format(value);
const tr = (key) => translations[state.language]?.[key] ?? translations.pt[key] ?? key;
const localized = (value) => value?.[state.language] ?? value?.pt ?? "";
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const categoryName = (id) => localized(categories.find(c => c.id === id)?.name);
const productPrice = (product) => product.price;

function applyLanguage() {
  document.documentElement.lang = state.language;
  document.querySelectorAll("[data-i18n]").forEach(el => { const value = tr(el.dataset.i18n); if (value) el.textContent = value; });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
  $("#searchInput").setAttribute("aria-label", tr("search"));
  renderCategories(); renderProducts(); renderCart();
}

function renderCategories() {
  const list = [{ id:"all", name:tr("categoryAll") }, ...categories.filter(c => c.active !== false).sort((a,b)=>a.sortOrder-b.sortOrder).map(c=>({id:c.id,name:localized(c.name)}))];
  $("#categoryNav").innerHTML = list.map(c => `<button type="button" class="category-chip ${state.category===c.id?"active":""}" data-category="${safe(c.id)}">${safe(c.name)}</button>`).join("");
  $("#categoryNav").querySelectorAll("[data-category]").forEach(button => button.addEventListener("click", () => { state.category = button.dataset.category; renderCategories(); renderProducts(); }));
}

function renderProducts() {
  const query = state.query.trim().toLocaleLowerCase(state.language);
  const filtered = products.filter(p => p.available !== false && (state.category==="all" || p.categoryId===state.category))
    .filter(p => !query || `${localized(p.name)} ${localized(p.description)} ${categoryName(p.categoryId)}`.toLocaleLowerCase(state.language).includes(query));
  $("#productGrid").innerHTML = filtered.length ? filtered.map(p => `
    <article class="product-card" tabindex="0" role="button" data-product="${safe(p.id)}" aria-label="${safe(localized(p.name))}">
      <img class="product-image" src="${safe(p.image)}" alt="${safe(localized(p.name))}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="product-body"><span class="product-category">${safe(categoryName(p.categoryId))}</span>
        <h3 class="product-title">${safe(localized(p.name))}</h3><p class="product-description">${safe(localized(p.description))}</p>
        <div class="product-bottom"><span class="product-price">${money(productPrice(p))}</span><button class="add-button" type="button" data-add="${safe(p.id)}" aria-label="${tr("add")} ${safe(localized(p.name))}">+</button></div>
      </div>
    </article>`).join("") : `<div class="empty-state">${safe(tr("noResults"))}</div>`;
  $("#productGrid").querySelectorAll("[data-product]").forEach(card => {
    card.addEventListener("click", e => { if (!e.target.closest("[data-add]")) openProduct(card.dataset.product); });
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProduct(card.dataset.product); } });
  });
  $("#productGrid").querySelectorAll("[data-add]").forEach(button => button.addEventListener("click", e => { e.stopPropagation(); openProduct(button.dataset.add); }));
}

function openProduct(id) {
  const p = products.find(item => item.id === id); if (!p) return;
  $("#productModalTitle").textContent = localized(p.name);
  const modifiers = p.modifiers ?? [];
  $("#productModalBody").innerHTML = `
    <div class="row g-4"><div class="col-md-5"><img class="modal-product-image" src="${safe(p.image)}" alt="${safe(localized(p.name))}"></div>
    <div class="col-md-7"><p class="text-secondary">${safe(localized(p.description))}</p><p class="h5 text-success">${money(p.price)}</p>
    ${modifiers.length ? `<div class="modifier-group"><strong>${safe(tr("orderNotes"))}</strong>${modifiers.map(m=>`<div class="modifier-option"><label for="mod-${safe(m.id)}">${safe(localized(m.name))}<div class="price-adjustment">${m.price ? "+"+money(m.price) : ""}</div></label><input type="checkbox" id="mod-${safe(m.id)}" value="${safe(m.id)}"></div>`).join("")}</div>` : `<p class="small text-secondary">${safe(tr("noModifiers"))}</p>`}
    <label class="form-label mt-3" for="productNote">${safe(tr("orderNotes"))}</label><textarea class="form-control" id="productNote" rows="2" maxlength="250"></textarea>
    <label class="form-label mt-3" for="productQty">${safe(tr("quantity"))}</label><input id="productQty" type="number" min="1" max="20" value="1" class="form-control" style="max-width:110px">
    <button class="btn btn-dark-green w-100 mt-4" id="confirmAdd" type="button">${safe(tr("add"))} · ${money(p.price)}</button></div></div>`;
  $("#confirmAdd").addEventListener("click", () => {
    const selected = modifiers.filter(m => document.getElementById("mod-"+m.id)?.checked).map(m => ({ id:m.id, name:localized(m.name), price:Number(m.price)||0, type:m.type }));
    const qty = Math.max(1, Math.min(20, Number($("#productQty").value)||1));
    state.cart.push({ lineId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()), productId:p.id, name:localized(p.name), basePrice:p.price, quantity:qty, modifiers:selected, notes:$("#productNote").value.trim() });
    bootstrap.Modal.getInstance($("#productModal"))?.hide();
    renderCart(); $("#orderFeedback").textContent = tr("itemAdded");
    bootstrap.Offcanvas.getOrCreateInstance($("#cartDrawer")).show();
  });
  bootstrap.Modal.getOrCreateInstance($("#productModal")).show();
}

function lineTotal(line) { return (line.basePrice + line.modifiers.reduce((sum,m)=>sum+(m.type==="remove"?0:m.price),0))*line.quantity; }
function cartTotal() { return state.cart.reduce((sum,line)=>sum+lineTotal(line),0); }
function renderCart() {
  $("#cartCount").textContent = state.cart.reduce((n,line)=>n+line.quantity,0);
  $("#cartTotal").textContent = money(cartTotal());
  $("#cartItems").innerHTML = state.cart.length ? state.cart.map(line => `
    <div class="cart-line"><div class="d-flex justify-content-between gap-2"><div><div class="cart-line-title">${safe(line.name)}</div><div class="cart-line-meta">${line.modifiers.map(m=>safe(localized(products.find(p=>p.id===line.productId)?.modifiers?.find(x=>x.id===m.id)?.name)||m.name)).join(", ")}${line.notes ? "\n"+safe(line.notes) : ""}</div></div><strong>${money(lineTotal(line))}</strong></div>
    <div class="d-flex justify-content-between align-items-center mt-2"><div class="quantity-controls"><button type="button" data-decrease="${safe(line.lineId)}" aria-label="−">−</button><span>${line.quantity}</span><button type="button" data-increase="${safe(line.lineId)}" aria-label="+">+</button></div><button type="button" class="btn btn-sm btn-link text-danger" data-remove="${safe(line.lineId)}">${safe(tr("removeItem"))}</button></div></div>`).join("") : `<div class="empty-state">${safe(tr("emptyCart"))}</div>`;
  $("#cartItems").querySelectorAll("[data-increase]").forEach(b=>b.addEventListener("click",()=>changeQty(b.dataset.increase,1)));
  $("#cartItems").querySelectorAll("[data-decrease]").forEach(b=>b.addEventListener("click",()=>changeQty(b.dataset.decrease,-1)));
  $("#cartItems").querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",()=>{state.cart=state.cart.filter(x=>x.lineId!==b.dataset.remove);renderCart();}));
}
function changeQty(id, delta) { const line=state.cart.find(x=>x.lineId===id); if(!line)return; line.quantity=Math.max(1,Math.min(20,line.quantity+delta));renderCart(); }

function readLocationFromQR() {
  const params = new URLSearchParams(location.search);
  const code = params.get("loc");
  // O valor do URL é apenas uma sugestão de localização; validar no backend antes de aceitar o pedido.
  if (code && /^[a-zA-Z0-9_-]{1,40}$/.test(code)) $("#locationInput").value = code;
}
function buildOrderText(order) {
  const lines = order.items.map(i => `• ${i.quantity} x ${i.name} — ${money(i.total)}${i.modifiers.length ? "\n  "+i.modifiers.map(m=>m.name).join(", ") : ""}${i.notes ? "\n  Nota: "+i.notes : ""}`).join("\n");
  return `Nelson's Place — ${tr("orderSummary")}\nPedido: ${order.orderNumber}\nLocal: ${order.location}\n\n${lines}\n\n${tr("total")}: ${money(order.total)}\nObservações: ${order.notes || "-"}`;
}
async function submitOrder() {
  const feedback=$("#orderFeedback"); feedback.textContent="";
  if (!state.cart.length) { feedback.textContent=tr("emptyOrder"); return; }
  const locationValue=$("#locationInput").value.trim();
  if (!locationValue) { feedback.textContent=tr("missingLocation"); $("#locationInput").focus(); return; }
  const order = {
    orderNumber: `DEMO-${Date.now().toString().slice(-6)}`, location:locationValue, language:state.language,
    items:state.cart.map(line=>({name:line.name,quantity:line.quantity,unitPrice:line.basePrice,modifiers:line.modifiers,notes:line.notes,total:lineTotal(line)})),
    total:cartTotal(), notes:$("#orderNotes").value.trim(), createdAt:new Date().toISOString()
  };
  if (APP_CONFIG.orderMode !== "backend") {
    feedback.textContent=tr("demoWarning");
    const text=buildOrderText(order);
    if (APP_CONFIG.whatsappNumber) {
      const url=`https://wa.me/${APP_CONFIG.whatsappNumber}?text=${encodeURIComponent(text)}`;
      const link=document.createElement("a"); link.href=url; link.target="_blank"; link.rel="noopener noreferrer"; link.className="btn btn-outline-success w-100 mt-2"; link.textContent=tr("sendWhatsApp"); feedback.appendChild(document.createElement("br")); feedback.appendChild(link);
    }
    return;
  }
  // TODO: enviar para uma API/Cloud Function autenticada que valide tudo no servidor.
  feedback.textContent="Backend ainda não configurado. Não foi enviado nenhum pedido.";
}
$("#languageSelect").value=state.language;
$("#languageSelect").addEventListener("change",e=>{state.language=e.target.value;applyLanguage();});
$("#searchInput").addEventListener("input",e=>{state.query=e.target.value;renderProducts();});
$("#cartButton").addEventListener("click",()=>bootstrap.Offcanvas.getOrCreateInstance($("#cartDrawer")).show());
$("#submitOrderButton").addEventListener("click",submitOrder);
$("#orderNotes").placeholder=tr("notesPlaceholder");$("#locationInput").placeholder=tr("locationPlaceholder");
$("#year").textContent=new Date().getFullYear();
readLocationFromQR();applyLanguage();
