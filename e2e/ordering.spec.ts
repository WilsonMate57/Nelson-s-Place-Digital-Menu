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
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
}

test("guest places an order on a phone and staff processes it", async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?t=room&loc=12");

  await expect(page.getByRole("heading", { name: "Sabores que fazem parte da sua estadia." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pratos principais" })).toBeVisible();

  // Product with a required option: cannot be added until the option is chosen.
  await page.getByRole("button", { name: /Frango grelhado/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Adicionar ao pedido/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("Complete as opções obrigatórias");
  await dialog.getByLabel("Arroz").check();
  await dialog.getByLabel("Molho extra").check();
  await dialog.getByRole("button", { name: "Aumentar quantidade" }).click();
  await page.screenshot({ path: "test-results/screens/guest-product-mobile.png" });
  await expect(dialog.getByRole("button", { name: /Adicionar ao pedido · 1400 MT/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Adicionar ao pedido/ }).click();

  // A simple product.
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
  await expect(sheet.getByText("Acompanhamento: Arroz", { exact: false }).or(sheet.getByText("Arroz · Molho extra"))).toBeVisible();
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

test("sold-out products cannot be ordered", async ({ page }) => {
  await page.goto("/");
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
