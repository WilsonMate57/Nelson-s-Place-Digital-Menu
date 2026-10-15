import { expect, test, type Page } from "@playwright/test";

/** Guest calls, kitchen screen, languages and ratings — real browser, real build. */

const ADMIN = { email: "admin@e2e.local", password: "e2e-admin-password" };

async function adminLogin(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Palavra-passe").fill(ADMIN.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
}

test("a guest calls the waiter from a table and staff handle it", async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?t=table&loc=7");
  await page.getByRole("button", { name: "Chamar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Pedir a conta").click();
  await dialog.getByText("Cartão").click();
  await expect(dialog.getByLabel("Número da mesa")).toHaveValue("7");
  await page.screenshot({ path: "test-results/screens/guest-call-mobile.png" });
  await dialog.getByRole("button", { name: "Pedir a conta" }).click();
  await expect(dialog.getByRole("status")).toContainText("Pedido de conta enviado");

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await adminLogin(staff);
  const calls = staff.getByRole("region", { name: "Chamadas de clientes" });
  await expect(calls).toContainText("Mesa 7 pede a conta (Cartão)");
  await calls.getByRole("button", { name: "Atendido" }).click();
  await expect(calls).toHaveCount(0);
  await staffContext.close();

  // The guest's dialog notices within the next poll.
  await expect(dialog.getByRole("status")).toContainText("Atendido", { timeout: 15_000 });
});

test("the kitchen screen shows accepted orders and moves them forward", async ({ page }) => {
  const menu = (await (await page.request.get("/api/menu")).json()) as { products: { id: number; name: { pt: string } }[] };
  const juice = menu.products.find((p) => p.name.pt === "Sumo natural")!;
  const placed = await page.request.post("/api/orders", {
    data: { idempotencyKey: crypto.randomUUID(), language: "pt", location: { type: "table", label: "9" }, notes: "Sem açúcar", items: [{ productId: juice.id, quantity: 3, optionIds: [] }] },
  });
  expect(placed.status()).toBe(201);
  await page.setViewportSize({ width: 1280, height: 900 });
  await adminLogin(page);
  const list = (await (await page.request.get("/api/admin/orders?status=PENDING")).json()) as { orders: { id: number; locationLabel: string }[] };
  const id = list.orders.find((o) => o.locationLabel === "9")!.id;
  await page.request.post(`/api/admin/orders/${id}/status`, { headers: { "x-np-request": "1" }, data: { to: "CONFIRMED", expectedStatus: "PENDING" } });

  await page.getByRole("link", { name: "Cozinha" }).click();
  const toStart = page.getByRole("region", { name: /Por começar/ });
  const ticket = toStart.locator(".kitchen-ticket", { hasText: "Mesa 9" });
  await expect(ticket).toContainText("3× Sumo natural");
  await expect(ticket).toContainText("Sem açúcar");
  await page.screenshot({ path: "test-results/screens/kitchen-desktop.png" });
  await ticket.getByRole("button", { name: "Começar" }).click();
  await expect(page.getByRole("region", { name: /Em preparação/ }).locator(".kitchen-ticket", { hasText: "Mesa 9" })).toBeVisible();
});

test("the menu switches to other languages", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByLabel("Idioma").selectOption("de");
  await expect(page.getByRole("heading", { name: "Genuss, der zu Ihrem Aufenthalt gehört." })).toBeVisible();
  await page.getByLabel("Sprache").selectOption("fr");
  await expect(page.getByRole("heading", { name: "Des saveurs qui font partie de votre séjour." })).toBeVisible();
  await page.getByLabel("Langue").selectOption("pt");
  await expect(page.getByRole("heading", { name: "Sabores que fazem parte da sua estadia." })).toBeVisible();
});

test("a guest rates a delivered order and can order the same again", async ({ page }) => {
  const menu = (await (await page.request.get("/api/menu")).json()) as { products: { id: number; name: { pt: string } }[] };
  const juice = menu.products.find((p) => p.name.pt === "Sumo natural")!;
  const placed = (await (
    await page.request.post("/api/orders", {
      data: { idempotencyKey: crypto.randomUUID(), language: "pt", location: { type: "room", label: "3" }, items: [{ productId: juice.id, quantity: 2, optionIds: [] }] },
    })
  ).json()) as { publicToken: string; reference: string };

  await adminLogin(page);
  const list = (await (await page.request.get(`/api/admin/orders?status=ALL&q=${placed.reference}`)).json()) as { orders: { id: number }[] };
  let expected = "PENDING";
  for (const to of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
    await page.request.post(`/api/admin/orders/${list.orders[0]!.id}/status`, { headers: { "x-np-request": "1" }, data: { to, expectedStatus: expected } });
    expected = to;
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/?order=${placed.publicToken}`);
  await page.locator("label.star").nth(3).click(); // 4th star
  await page.getByLabel("Comentário (opcional)").fill("Sumo muito fresco.");
  await page.getByRole("button", { name: "Enviar avaliação" }).click();
  await expect(page.getByText("Obrigado pela sua avaliação!")).toBeVisible();

  await page.getByRole("button", { name: "Pedir outra vez" }).click();
  const cart = page.getByRole("dialog");
  await expect(cart).toContainText("Sumo natural");
  await expect(cart).toContainText("2");
});
