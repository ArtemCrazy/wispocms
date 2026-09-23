import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const baseURL = "http://localhost:3310";
const siteId = "51a00000-0000-4000-8000-000000000002";
test.use({ baseURL, channel: "chrome", viewport: { width: 1280, height: 800 } });
test.beforeAll(() => {
  if (process.env.WISPO_E2E_ISOLATED_DB !== "wispo_cms_e2e")
    throw new Error("Page E2E requires the disposable wispo_cms_e2e database and explicit opt-in.");
});

function adminCredentials() {
  const source = readFileSync(join(__dirname, "../../../.env.local"), "utf8");
  const value = (key: string) => {
    const line = source.split(/\r?\n/).find((row) => row.startsWith(`${key}=`));
    if (!line) throw new Error(`Missing ${key} in local environment`);
    return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "");
  };
  return { email: value("BOOTSTRAP_ADMIN_EMAIL"), password: value("BOOTSTRAP_ADMIN_PASSWORD") };
}

type Account = { fullName: string; email: string; password: string };

async function signIn(page: Page, account: Account) {
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(account.fullName).first()).toBeVisible();
  await page.goto(`/?site=${siteId}&view=pages`);
  await page.locator(".pages-list article").filter({ hasText: "/thank-you" }).getByRole("button", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { name: "Спасибо", exact: true })).toBeVisible();
}

async function current(api: APIRequestContext, pageId: string) {
  const response = await api.get(`/api/sites/${siteId}/content/pages/${pageId}/revisions/current`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<{
    draft: { id: string } | null;
    approvedRevisionId: string | null;
    publishedRevisionId: string | null;
    reviewState: string;
  } | null>;
}

test("manager submits, owner approves, manager publishes one exact ordinary page revision", async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await playwrightRequest.newContext({ baseURL });
  expect((await api.post("/api/auth/login", { data: adminCredentials() })).status()).toBe(200);
  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const owner = { fullName: "E2E владелец страницы", email: `e2e-page-owner-${nonce}@example.invalid`, password };
  const manager = { fullName: "E2E менеджер страницы", email: `e2e-page-manager-${nonce}@example.invalid`, password };
  for (const [account, role] of [[owner, "site_owner"], [manager, "site_content_manager"]] as const) {
    const response = await api.post("/api/platform/users", { data: { ...account, role, siteIds: [siteId] } });
    expect(response.status(), await response.text()).toBe(201);
  }
  const pagesResponse = await api.get(`/api/sites/${siteId}/content/pages`);
  expect(pagesResponse.status(), await pagesResponse.text()).toBe(200);
  const page = (await pagesResponse.json() as Array<{ id: string; slug: string }>).find((item) => item.slug === "thank-you");
  if (!page) throw new Error("Skinova thank-you page is missing in the disposable database");
  const publicURL = "/api/public/sites/skinova/pages/thank-you";
  const publishedBefore = await api.get(publicURL);
  expect(publishedBefore.status(), await publishedBefore.text()).toBe(200);
  const oldText = (await publishedBefore.json()).page.blocks[0].text as string;
  const firstText = `Первый черновик страницы ${nonce}`;
  const newText = `Тест согласования страницы ${nonce}`;
  const finalText = `Финальная редакция страницы ${nonce}`;

  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();
  await signIn(managerPage, manager);
  await managerPage.getByRole("textbox", { name: "Текст", exact: true }).fill(firstText);
  await managerPage.getByRole("button", { name: "Сохранить страницу" }).click();
  await expect(managerPage.getByText("Страница сохранена")).toBeVisible();
  expect((await (await api.get(publicURL)).json()).page.blocks[0].text).toBe(oldText);
  const firstSaved = await current(api, page.id);
  expect(firstSaved?.draft?.id).toBeTruthy();

  await managerPage.locator(".pages-list article").filter({ hasText: "/thank-you" }).getByRole("button", { name: "Открыть" }).click();
  const firstPreviewHref = await managerPage.getByRole("link", { name: "Посмотреть черновик" }).getAttribute("href");
  if (!firstPreviewHref) throw new Error("Versioned page preview link is missing");
  expect(firstPreviewHref).toContain(`cmsRevisionId=${firstSaved?.draft?.id}`);
  await managerPage.getByRole("textbox", { name: "Текст", exact: true }).fill(newText);
  await managerPage.getByRole("button", { name: "Сохранить страницу" }).click();
  await expect(managerPage.getByText("Страница сохранена")).toBeVisible();
  expect((await (await api.get(publicURL)).json()).page.blocks[0].text).toBe(oldText);
  const saved = await current(api, page.id);
  expect(saved?.draft?.id).not.toBe(firstSaved?.draft?.id);
  const historicalPreview = await managerContext.newPage();
  await historicalPreview.goto(firstPreviewHref);
  await expect(historicalPreview.getByText(firstText)).toBeVisible();
  await expect(historicalPreview.getByText(newText)).toHaveCount(0);
  await historicalPreview.close();

  await managerPage.locator(".pages-list article").filter({ hasText: "/thank-you" }).getByRole("button", { name: "Открыть" }).click();
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await expect(managerPage.locator(".page-editor-message")).toHaveText("Версия страницы отправлена владельцу на проверку");
  const submitted = await current(api, page.id);
  expect(submitted?.draft?.id).toBe(saved?.draft?.id);
  expect(submitted?.reviewState).toBe("in_review");

  await signIn(ownerPage, owner);
  await expect(ownerPage.getByRole("textbox", { name: "Текст", exact: true })).toHaveValue(newText);
  const openedPreviewHref = await ownerPage.getByRole("link", { name: "Посмотреть черновик" }).getAttribute("href");
  if (!openedPreviewHref) throw new Error("Owner preview link is missing");
  expect(openedPreviewHref).toContain(`cmsRevisionId=${submitted?.draft?.id}`);

  await managerPage.getByRole("textbox", { name: "Текст", exact: true }).fill(finalText);
  await managerPage.getByRole("button", { name: "Сохранить страницу" }).click();
  await expect(managerPage.getByText("Страница сохранена")).toBeVisible();
  await managerPage.locator(".pages-list article").filter({ hasText: "/thank-you" }).getByRole("button", { name: "Открыть" }).click();
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  const finalSubmitted = await current(api, page.id);
  expect(finalSubmitted?.draft?.id).not.toBe(submitted?.draft?.id);

  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.locator(".page-editor-message")).toHaveText(
    "Версия страницы изменилась после открытия. Проверьте новую версию перед действием.",
  );
  await expect(ownerPage.getByRole("link", { name: "Посмотреть черновик" })).toHaveAttribute("href", openedPreviewHref);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  expect((await current(api, page.id))?.approvedRevisionId).toBeNull();
  await ownerPage.reload();
  await ownerPage.locator(".pages-list article").filter({ hasText: "/thank-you" }).getByRole("button", { name: "Открыть" }).click();
  await expect(ownerPage.getByRole("textbox", { name: "Текст", exact: true })).toHaveValue(finalText);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.locator(".page-editor-message")).toHaveText("Версия страницы одобрена");
  expect((await current(api, page.id))?.approvedRevisionId).toBe(finalSubmitted?.draft?.id);

  await managerPage.reload();
  await managerPage.locator(".pages-list article").filter({ hasText: "/thank-you" }).getByRole("button", { name: "Открыть" }).click();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage.getByRole("button", { name: "Опубликовать одобренную версию" }).click();
  await expect(managerPage.getByText("Одобренная версия страницы опубликована")).toBeVisible();
  expect((await (await api.get(publicURL)).json()).page.blocks[0].text).toBe(finalText);
  expect((await current(api, page.id))?.publishedRevisionId).toBe(finalSubmitted?.draft?.id);
  await managerContext.close();
  await ownerContext.close();
  await api.dispose();
});
