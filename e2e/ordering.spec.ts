import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end: real browser (Edge) → real production build → real SQLite.
 * Nothing is mocked. WhatsApp is in link mode with no number configured.
 */

const ADMIN = { email: "admin@e2e.local", password: "e2e-admin-password" };
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 860 },
];

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(1);
}

async function adminLogin(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Palavra-passe").fill(ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
}

test("guest places an order on a phone and staff processes it", async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?t=room&loc=12");

  await expect(page.getByRole("heading", { name: "Sabores que fazem parte da sua estadia." })).toBeVisible();
  // Categories are tabs: only the selected category's items are shown.
  await expect(page.getByRole("heading", { name: /^Entradas/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Frango grelhado/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Pratos principais" }).click();
  await expect(page.getByRole("tab", { name: "Pratos principais" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /^Entradas/ })).toHaveCount(0);

  // Product with a required option: cannot be added until the option is chosen.
  await page.getByRole("button", { name: /Frango grelhado/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Adicionar ao pedido/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Complete as opções obrigatórias");
  // Several sides may be chosen.
  await dialog.getByLabel("Arroz").check();
  await dialog.getByLabel("Salada").check();
  await expect(dialog.getByLabel("Arroz")).toBeChecked();
  await dialog.getByLabel("Molho extra").check();
  await dialog.getByRole("button", { name: "Aumentar quantidade" }).click();
  await page.screenshot({ path: "test-results/screens/guest-product-mobile.png" });
  await expect(dialog.getByRole("button", { name: /Adicionar ao pedido · 1400 MT/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Adicionar ao pedido/ }).click();

  // A simple product, in another tab.
  await page.getByRole("tab", { name: "Bebidas" }).click();
  await page.getByRole("button", { name: /Sumo natural/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Adicionar ao pedido/ }).click();

  // Cart bar shows count and estimated total; cart persists across reloads.
  await expect(page.getByRole("button", { name: /Ver pedido/ })).toContainText("3");
  await expect(page.getByRole("button", { name: /Ver pedido/ })).toContainText("1580 MT");
  await page.reload();
  await expect(page.getByRole("button", { name: /Ver pedido/ })).toContainText("1580 MT");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: "test-results/screens/guest-menu-mobile.png", fullPage: false });

  await page.getByRole("button", { name: /Ver pedido/ }).click();
  const sheet = page.getByRole("dialog", { name: "O seu pedido" });
  await expect(sheet.getByText("Acompanhamento: Arroz", { exact: false }).or(sheet.getByText("Arroz · Salada · Molho extra"))).toBeVisible();
  await sheet.getByRole("button", { name: "Continuar" }).click();

  // Checkout: room pre-filled from the QR code; invalid input rejected client-side.
  const checkout = page.getByRole("dialog", { name: "Confirmar pedido" });
  const room = checkout.getByLabel("Número do apartamento");
  await expect(room).toHaveValue("12");
  await room.fill("");
  await checkout.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(checkout.getByText("Campo obrigatório.")).toBeVisible();
  await room.fill("12");
  await checkout.getByLabel(/Nome/).fill("Ana Teste");
  await checkout.getByLabel(/Observações gerais/).fill("Sem gelo");
  await page.screenshot({ path: "test-results/screens/guest-checkout-mobile.png" });
  await checkout.getByRole("button", { name: /Enviar pedido · 1580 MT/ }).click();

  // Confirmation with server reference.
  await expect(page.getByRole("heading", { name: "Pedido recebido" })).toBeVisible();
  const reference = (await page.locator(".order-ref").textContent())!.trim();
  expect(reference).toMatch(/^NP-\d{6}-[A-Z2-9]{4}$/);
  await expect(page.getByText("Recebido — a aguardar confirmação").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Ver pedido/ })).toHaveCount(0); // cart emptied
  await page.screenshot({ path: "test-results/screens/guest-confirmation-mobile.png", fullPage: true });
  const statusUrl = page.url();

  // Staff side, separate browser context (separate cookies).
  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const staff = await staffContext.newPage();
  await adminLogin(staff);
  const row = staff.getByRole("button", { name: new RegExp(reference) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(staff.getByRole("heading", { name: "Apartamento 12" })).toBeVisible();
  await expect(staff.getByText("2 × Frango grelhado")).toBeVisible();
  await expect(staff.getByText("“Sem gelo”")).toBeVisible();
  await staff.screenshot({ path: "test-results/screens/admin-orders-desktop.png" });
  await staff.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(staff.locator(".order-detail .badge-lg")).toHaveText("Confirmado");

  // The guest's open status page announces the change without a reload (polls every 15 s).
  const notice = page.locator(".status-notice");
  await expect(notice).toContainText("Pedido confirmado", { timeout: 20_000 });
  await expect(page).toHaveTitle(/Confirmado · NP-/);
  await page.screenshot({ path: "test-results/screens/guest-status-notice-mobile.png" });
  await notice.getByRole("button", { name: "Fechar" }).click();
  await expect(notice).toHaveCount(0);

  await staff.getByRole("button", { name: "Iniciar preparação" }).click();
  await expect(staff.locator(".order-detail .badge-lg")).toHaveText("Em preparação");
  await staff.screenshot({ path: "test-results/screens/admin-detail-desktop.png" });
  await staff.setViewportSize({ width: 375, height: 812 });
  await staff.screenshot({ path: "test-results/screens/admin-detail-mobile.png", fullPage: true });

  // Guest sees the new status.
  await page.goto(statusUrl);
  await expect(page.locator(".order-progress .badge")).toHaveText("Em preparação");
  await staffContext.close();
});

test("checkout defaults to Mesa when there is no QR location", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: /Sopa do dia/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Adicionar ao pedido/ }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByRole("dialog", { name: "O seu pedido" }).getByRole("button", { name: "Continuar" }).click();
  const checkout = page.getByRole("dialog", { name: "Confirmar pedido" });
  await expect(checkout.getByRole("radio", { name: "Mesa" })).toBeChecked();
  await expect(checkout.getByLabel("Número da mesa")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/guest-checkout-table-mobile.png" });
});

async function openCheckoutWithSoup(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: /Sopa do dia/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Adicionar ao pedido/ }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByRole("dialog", { name: "O seu pedido" }).getByRole("button", { name: "Continuar" }).click();
  return page.getByRole("dialog", { name: "Confirmar pedido" });
}

test("guest schedules an order for later (Encomendar) and staff see it under Encomendas", async ({ page, browser }) => {
  const checkout = await openCheckoutWithSoup(page);
  await checkout.locator(".segment", { hasText: "Mais tarde" }).click();
  await expect(checkout.getByLabel("Dia")).toBeVisible();
  const time = checkout.getByLabel("Hora");
  await expect(time).toBeVisible();
  const chosen = (await time.locator("option").first().textContent())!.trim();
  await checkout.getByLabel("Número da mesa").fill("7");
  await checkout.getByRole("button", { name: /Enviar pedido/ }).click();
  // A phone number is required for scheduled orders.
  await expect(checkout.getByText("Campo obrigatório.")).toBeVisible();
  await checkout.getByLabel(/Telefone de contacto/).fill("+258 84 123 4567");
  await page.screenshot({ path: "test-results/screens/guest-schedule-mobile.png" });
  await checkout.getByRole("button", { name: /Enviar pedido/ }).click();

  await expect(page.getByRole("heading", { name: "Pedido recebido" })).toBeVisible();
  await expect(page.locator(".order-meta")).toContainText("Encomenda para");
  await expect(page.locator(".order-meta")).toContainText(chosen);
  const reference = (await page.locator(".order-ref").textContent())!.trim();

  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const staff = await staffContext.newPage();
  await adminLogin(staff);
  await staff.getByRole("tab", { name: /Encomendas/ }).click();
  const row = staff.getByRole("button", { name: new RegExp(reference) });
  await expect(row).toContainText("Para");
  await row.click();
  await expect(staff.locator(".scheduled-banner")).toContainText("Encomenda para");
  await staffContext.close();
});

test("take-away asks for the 50% deposit and staff must confirm it before the order", async ({ page, browser }) => {
  const checkout = await openCheckoutWithSoup(page);
  await checkout.locator(".segment", { hasText: "Levantar" }).click();
  await expect(checkout.getByLabel("Número da mesa")).toHaveCount(0);
  await expect(checkout.locator(".deposit-box")).toContainText("Sinal de 50% a pagar agora: 125 MT");
  await expect(checkout.locator(".deposit-box")).toContainText("M-Pesa 84 000 0000 (teste)");

  await checkout.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(checkout.getByText("Campo obrigatório.")).toHaveCount(3); // name, phone, payment reference
  await checkout.getByLabel(/^Nome/).fill("Carlos Teste");
  await checkout.getByLabel(/Telefone de contacto/).fill("+258 84 765 4321");
  await checkout.getByLabel("Referência do pagamento").fill("MP261013.TESTE.01");
  await page.screenshot({ path: "test-results/screens/guest-takeaway-mobile.png" });
  await checkout.getByRole("button", { name: /Enviar pedido/ }).click();

  await expect(page.getByRole("heading", { name: "Pedido recebido" })).toBeVisible();
  await expect(page.locator(".order-meta")).toContainText("Levantar no hotel");
  await expect(page.getByText(/Sinal 125 MT: a aguardar verificação/)).toBeVisible();
  const reference = (await page.locator(".order-ref").textContent())!.trim();

  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const staff = await staffContext.newPage();
  await adminLogin(staff);
  const row = staff.getByRole("button", { name: new RegExp(reference) });
  await expect(row).toContainText("Sinal por verificar");
  await row.click();
  const confirmOrder = staff.getByRole("button", { name: "Confirmar pedido" });
  await expect(confirmOrder).toBeDisabled();
  await expect(staff.locator(".deposit-panel")).toContainText("MP261013.TESTE.01");
  await staff.screenshot({ path: "test-results/screens/admin-deposit-desktop.png" });
  staff.once("dialog", (d) => void d.accept());
  await staff.getByRole("button", { name: "Sinal recebido" }).click();
  await expect(staff.locator(".deposit-panel")).toContainText("Recebido");
  await expect(confirmOrder).toBeEnabled();
  await confirmOrder.click();
  await expect(staff.locator(".order-detail .badge-lg")).toHaveText("Confirmado");

  // The saved PDF is named after the order (the page title while printing).
  await staff.evaluate(() => {
    window.print = () => void ((window as unknown as { printedAs: string }).printedAs = document.title);
  });
  await staff.getByRole("button", { name: "Imprimir talão (80 mm)" }).click();
  expect(await staff.evaluate(() => (window as unknown as { printedAs: string }).printedAs)).toBe(`Talao_${reference}`);

  // 80 mm POS ticket: in print mode only the ticket is shown, 72 mm wide.
  await staff.emulateMedia({ media: "print" });
  const ticket = staff.locator("#receipt");
  await expect(ticket).toBeVisible();
  await expect(staff.locator("#root")).toBeHidden();
  await expect(ticket).toContainText("LEVANTAR NO HOTEL");
  await expect(ticket).toContainText(reference);
  await expect(ticket).toContainText("Sinal (recebido)");
  await expect(ticket).toContainText("NUIT: 400966079");
  await expect(ticket).toContainText("Kumbeza, célula A, no. 281, Q.8");
  await expect(ticket).toContainText("info@nelsonsplace.co.mz");
  await expect(ticket).toContainText("não serve de factura");
  const widthPx = await ticket.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round((widthPx * 25.4) / 96)).toBe(72);
  const heightMm = await ticket.evaluate((el) => Math.ceil((el.scrollHeight * 25.4) / 96) + 6);
  await staff.pdf({ path: "test-results/screens/ticket-80mm.pdf", width: "80mm", height: `${heightMm}mm`, printBackground: true });
  await staffContext.close();

  await page.reload();
  await expect(page.getByText(/Sinal 125 MT: confirmado/)).toBeVisible();
});

test("sold-out products cannot be ordered", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Bebidas" }).click();
  const card = page.getByRole("button", { name: /Água mineral.*Esgotado/ });
  await expect(card).toBeVisible();
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Esgotado").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Adicionar ao pedido/ })).toHaveCount(0);
});

test("the dashboard requires login and rejects wrong passwords", async ({ page }) => {
  await page.goto("/admin/");
  await expect(page.getByRole("heading", { name: "Painel Nelson's Place" })).toBeVisible();
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Palavra-passe").fill("wrong-password!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrectos");
  const api = await page.request.get("/api/admin/orders");
  expect(api.status()).toBe(401);
});

test("staff marks a product as sold out and guests see it immediately", async ({ page, browser }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await adminLogin(page);
  await page.getByRole("link", { name: "Menu" }).click();
  const row = page.locator(".admin-product", { hasText: "Fatia de bolo" });
  const toggle = row.locator(".switch");
  await toggle.click();
  await expect(toggle).toContainText("Esgotado");
  await expect(row.locator(".badge-danger")).toHaveText("Esgotado");
  await page.screenshot({ path: "test-results/screens/admin-menu-tablet.png" });

  const guest = await browser.newPage();
  await guest.goto("/");
  await guest.getByRole("tab", { name: "Sobremesas" }).click();
  await expect(guest.getByRole("button", { name: /Fatia de bolo.*Esgotado/ })).toBeVisible();
  await guest.close();

  await toggle.click();
  await expect(toggle).toContainText("Disponível");
});

test("unknown pages show the not-found page", async ({ page }) => {
  const response = await page.goto("/pagina-que-nao-existe");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

for (const vp of VIEWPORTS) {
  test(`layout has no horizontal overflow at ${vp.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Entradas" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `test-results/screens/guest-menu-${vp.name}.png` });
    await adminLogin(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `test-results/screens/admin-orders-${vp.name}.png` });
  });
}

test("admin sees reports for the period and can export orders", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await adminLogin(page);
  // Make sure today has at least one delivered order (only those count).
  const menu = (await (await page.request.get("/api/menu")).json()) as { products: { id: number; name: { pt: string } }[] };
  const juice = menu.products.find((p) => p.name.pt === "Sumo natural")!;
  const placed = await page.request.post("/api/orders", {
    data: { idempotencyKey: crypto.randomUUID(), language: "pt", location: { type: "table", label: "3" }, items: [{ productId: juice.id, quantity: 2, optionIds: [] }] },
  });
  expect(placed.status()).toBe(201);
  const list = (await (await page.request.get("/api/admin/orders?status=PENDING")).json()) as { orders: { id: number }[] };
  let expectedStatus = "PENDING";
  for (const to of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
    const res = await page.request.post(`/api/admin/orders/${list.orders[0]!.id}/status`, { headers: { "x-np-request": "1" }, data: { to, expectedStatus } });
    expect(res.status()).toBe(200);
    expectedStatus = to;
  }
  await page.goto("/admin/#/reports");
  await page.getByRole("button", { name: "Hoje" }).click();
  await expect(page.locator(".kpi").filter({ hasText: "Pedidos entregues" })).toContainText("não contam");

  await page.getByRole("link", { name: "Relatórios" }).click();
  await expect(page.getByRole("heading", { name: "Relatórios" })).toBeVisible();
  await page.getByRole("button", { name: "Hoje" }).click();
  await expect(page.locator(".kpi-hero .kpi-label")).toHaveText("Vendas");
  await expect(page.getByRole("heading", { name: "Pedidos por hora do dia" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artigos mais pedidos" })).toBeVisible();
  await expect(page.locator(".ranked").first()).toContainText(/Frango grelhado|Sumo natural|Sopa do dia/);
  for (const title of ["Vendas por dia da semana", "Clientes", "Desempenho da equipa", "Artigos sem vendas", "Fecho e resumo do dia"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Enviar resumo por WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);

  // Daily closing on the 80 mm POS printer.
  await page.emulateMedia({ media: "print" });
  const closing = page.locator("#closing-receipt");
  await expect(closing).toBeVisible();
  await expect(closing).toContainText("FECHO DO DIA");
  await expect(closing).toContainText("VENDAS");
  const closingHeight = await closing.evaluate((el) => Math.ceil((el.scrollHeight * 25.4) / 96) + 6);
  await page.pdf({ path: "test-results/screens/closing-80mm.pdf", width: "80mm", height: `${closingHeight}mm`, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Últimos 7 dias" }).click();
  await expect(page.getByRole("heading", { name: "Vendas por dia", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/screens/admin-reports-desktop.png", fullPage: true });

  const href = await page.getByRole("link", { name: /Exportar pedidos/ }).getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Referência;Data;Estado");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/screens/admin-reports-mobile.png", fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("guest and staff exchange chat messages about an order", async ({ page, browser }) => {
  const checkout = await openCheckoutWithSoup(page);
  await checkout.getByLabel("Número da mesa").fill("9");
  await checkout.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(page.getByRole("heading", { name: "Pedido recebido" })).toBeVisible();
  const reference = (await page.locator(".order-ref").textContent())!.trim();

  const chat = page.locator(".chat");
  await chat.getByRole("button", { name: "Quanto tempo falta?" }).click();
  await expect(chat.locator(".chat-msg.is-mine")).toContainText("Quanto tempo falta?");

  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const staff = await staffContext.newPage();
  await adminLogin(staff);
  const row = staff.getByRole("button", { name: new RegExp(reference) });
  await expect(row).toContainText("💬 1 nova(s)");
  await row.click();
  const staffChat = staff.locator(".staff-chat");
  await expect(staffChat).toContainText("Quanto tempo falta?");
  await staffChat.getByRole("button", { name: "O seu pedido estará pronto em cerca de 15 minutos." }).click();
  await staffChat.getByRole("button", { name: "Enviar" }).click();
  await expect(staffChat.locator(".staff-chat-msg.is-mine")).toContainText("cerca de 15 minutos");
  await staff.screenshot({ path: "test-results/screens/admin-chat-desktop.png" });

  // The guest page polls every 8 s.
  await expect(chat.locator(".chat-msg.is-theirs")).toContainText("cerca de 15 minutos", { timeout: 15_000 });
  await expect(chat.locator(".chat-msg.is-theirs .chat-author")).toHaveText("Equipa do hotel");
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/screens/guest-chat-mobile.png" });
  await expect(staffChat).toContainText("lida pelo cliente", { timeout: 15_000 });
  await staffContext.close();
});

test("admin creates an access profile and the dashboard adapts to it", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await adminLogin(page);
  await page.getByRole("link", { name: "Equipa" }).click();
  await page.getByRole("tab", { name: "Perfis de acesso" }).click();
  const matrix = page.locator(".roles-matrix");
  for (const name of ["Administrador", "Gerente", "Recepção", "Cozinha"]) await expect(matrix).toContainText(name);

  await page.getByRole("button", { name: "Novo perfil" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome do perfil").fill("Caixa");
  await dialog.getByLabel("Confirmar sinais (pagamentos)").check();
  await page.screenshot({ path: "test-results/screens/admin-role-editor.png" });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(matrix).toContainText("Caixa");
  await page.screenshot({ path: "test-results/screens/admin-roles-matrix.png", fullPage: true });

  await page.getByRole("tab", { name: "Pessoas" }).click();
  await page.getByRole("button", { name: "Novo utilizador" }).click();
  const staffDialog = page.getByRole("dialog");
  await staffDialog.getByLabel("Email").fill("caixa@e2e.local");
  await staffDialog.getByLabel("Nome").fill("Rosa Caixa");
  await staffDialog.getByRole("radio", { name: /^Caixa/ }).check();
  await staffDialog.getByLabel("Palavra-passe inicial").fill("caixa-password-1");
  await staffDialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("cell", { name: /Rosa Caixa/ })).toBeVisible();

  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cashier = await other.newPage();
  await cashier.goto("/admin/");
  await cashier.getByLabel("Email").fill("caixa@e2e.local");
  await cashier.getByLabel("Palavra-passe").fill("caixa-password-1");
  await cashier.getByRole("button", { name: "Entrar" }).click();
  await expect(cashier.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  const nav = cashier.getByRole("navigation", { name: "Secções do painel" });
  await expect(nav.getByRole("link")).toHaveText([/^Pedidos/, "Cozinha", "Conta"]); // "Pedidos" may carry the pending counter
  await expect(cashier.locator(".admin-user-name small")).toHaveText("Caixa");
  expect((await cashier.request.get("/api/admin/reports?from=2026-10-13&to=2026-10-13")).status()).toBe(403);
  await other.close();
});

test("new orders are signalled on any dashboard section, even with the tab in the background", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await adminLogin(page);
  await page.getByRole("link", { name: /^Menu/ }).click();
  await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Secções do painel" });
  const before = Number((await nav.locator(".nav-count").textContent().catch(() => "0")) || 0);

  // Simulate the browser tab being in the background.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  });

  const menu = (await (await page.request.get("/api/menu")).json()) as { products: { id: number; name: { pt: string } }[] };
  const soup = menu.products.find((p) => p.name.pt === "Sopa do dia")!;
  const placed = await page.request.post("/api/orders", {
    data: { idempotencyKey: crypto.randomUUID(), language: "pt", location: { type: "table", label: "11" }, items: [{ productId: soup.id, quantity: 1, optionIds: [] }] },
  });
  expect(placed.status()).toBe(201);
  const { reference } = (await placed.json()) as { reference: string };

  await expect(nav.locator(".nav-count")).toHaveText(String(before + 1), { timeout: 15_000 });
  await expect(page).toHaveTitle(`(${before + 1}) Pedidos | Nelson's Place`);
  await expect(page.locator(".toast-region")).toContainText(reference);
  await expect(page.locator("link[rel='icon']")).toHaveAttribute("href", /^data:image\/svg\+xml/);
  await page.screenshot({ path: "test-results/screens/admin-alert-other-section.png" });
});
