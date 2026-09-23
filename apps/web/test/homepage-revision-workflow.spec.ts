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
    throw new Error("Homepage E2E requires the disposable wispo_cms_e2e database and explicit opt-in.");
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
  await page.goto(`/?site=${siteId}&view=homepage-template`);
  await page.getByRole("button", { name: "Редактировать содержимое" }).click();
  await expect(page.getByText("ПУБЛИКАЦИЯ")).toBeVisible();
}

async function current(api: APIRequestContext, pageId: string) {
  const response = await api.get(`/api/sites/${siteId}/content/pages/${pageId}/revisions/current`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<{
    draft: { id: string; versionNumber: number } | null;
    approvedRevisionId: string | null;
    publishedRevisionId: string | null;
    reviewState: string;
  } | null>;
}

test("manager submits, owner approves, and manager publishes one exact homepage revision", async ({ browser }) => {
  test.setTimeout(120_000);
  const api = await playwrightRequest.newContext({ baseURL });
  expect((await api.post("/api/auth/login", { data: adminCredentials() })).status()).toBe(200);
  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const owner = { fullName: "E2E владелец главной", email: `e2e-home-owner-${nonce}@example.invalid`, password };
  const manager = { fullName: "E2E менеджер главной", email: `e2e-home-manager-${nonce}@example.invalid`, password };
  for (const [account, role] of [[owner, "site_owner"], [manager, "site_content_manager"]] as const) {
    const response = await api.post("/api/platform/users", { data: { ...account, role, siteIds: [siteId] } });
    expect(response.status(), await response.text()).toBe(201);
  }

  const pagesResponse = await api.get(`/api/sites/${siteId}/content/pages`);
  expect(pagesResponse.status(), await pagesResponse.text()).toBe(200);
  const homepage = (await pagesResponse.json() as Array<{ id: string; kind: string }>).find((item) => item.kind === "homepage");
  if (!homepage) throw new Error("Skinova homepage is missing in the disposable database");
  const publicURL = "/api/public/sites/skinova";
  const publishedBefore = await api.get(publicURL);
  expect(publishedBefore.status(), await publishedBefore.text()).toBe(200);
  const oldTitle = (await publishedBefore.json()).pages.find((item: { kind: string }) => item.kind === "homepage").blocks[0].title as string;
  const nextTitle = `Главная на согласовании ${nonce}`;

  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();
  await signIn(managerPage, manager);
  await managerPage.getByRole("textbox", { name: "Заголовок", exact: true }).first().fill(nextTitle);
  await managerPage.getByRole("button", { name: "Сохранить страницу" }).click();
  await expect(managerPage.getByText("Страница сохранена")).toBeVisible();
  expect((await (await api.get(publicURL)).json()).pages.find((item: { kind: string }) => item.kind === "homepage").blocks[0].title).toBe(oldTitle);

  const saved = await current(api, homepage.id);
  expect(saved?.draft?.id).toBeTruthy();
  await managerPage.getByRole("button", { name: "Редактировать содержимое" }).click();
  const previewHref = await managerPage.getByRole("link", { name: "Посмотреть черновик" }).getAttribute("href");
  if (!previewHref) throw new Error("Homepage revision preview link is missing");
  expect(previewHref).toContain(`cmsRevisionId=${saved?.draft?.id}`);
  const preview = await managerContext.newPage();
  await preview.goto(previewHref);
  await expect(preview.getByText(nextTitle)).toBeVisible();
  await preview.close();

  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await expect(managerPage.locator(".page-editor-message")).toHaveText("Версия страницы отправлена владельцу на проверку");
  expect((await current(api, homepage.id))?.reviewState).toBe("in_review");

  await signIn(ownerPage, owner);
  await expect(ownerPage.getByRole("textbox", { name: "Заголовок", exact: true }).first()).toHaveValue(nextTitle);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.locator(".page-editor-message")).toHaveText("Версия страницы одобрена");
  expect((await current(api, homepage.id))?.approvedRevisionId).toBe(saved?.draft?.id);

  await managerPage.reload();
  await managerPage.getByRole("button", { name: "Редактировать содержимое" }).click();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage.getByRole("button", { name: "Опубликовать одобренную версию" }).click();
  await expect(managerPage.getByText("Одобренная версия страницы опубликована")).toBeVisible();
  expect((await (await api.get(publicURL)).json()).pages.find((item: { kind: string }) => item.kind === "homepage").blocks[0].title).toBe(nextTitle);
  expect((await current(api, homepage.id))?.publishedRevisionId).toBe(saved?.draft?.id);

  await managerContext.close();
  await ownerContext.close();
  await api.dispose();
});
