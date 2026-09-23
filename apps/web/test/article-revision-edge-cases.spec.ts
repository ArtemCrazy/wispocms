import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    throw new Error("Mutating E2E tests require the disposable wispo_cms_e2e database and explicit opt-in.");
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

async function seedPublishedArticle() {
  const api = await playwrightRequest.newContext({ baseURL });
  expect((await api.post("/api/auth/login", { data: adminCredentials() })).status()).toBe(200);
  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const owner = { fullName: "E2E владелец", email: `e2e-owner-${nonce}@example.invalid`, password };
  const manager = { fullName: "E2E менеджер", email: `e2e-manager-${nonce}@example.invalid`, password };
  for (const [account, role] of [[owner, "site_owner"], [manager, "site_content_manager"]] as const) {
    const response = await api.post("/api/platform/users", { data: { ...account, role, siteIds: [siteId] } });
    expect(response.status(), await response.text()).toBe(201);
  }
  const slug = `e2e-revision-${nonce}`;
  const title = `Проверка версии ${nonce}`;
  const body = `Исходный текст ${nonce}`;
  const created = await api.post(`/api/sites/${siteId}/content/articles`, {
    data: { title, slug, body, displayTemplateKey: "skinova-article", displayTemplateVersion: "1" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const articleId = (await created.json()).id as string;
  for (const [path, state] of [["editorial", "review"], ["editorial", "approved"], ["publication", "published"]]) {
    const response = await api.post(`/api/sites/${siteId}/content/articles/${articleId}/${path}`, { data: { state } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  return {
    api, owner, manager, title, body, articleId,
    articleURL: `/?site=${siteId}&view=articles&subview=content&contentArticle=${articleId}`,
    publicURL: `/api/public/sites/skinova/articles/${slug}`,
    currentURL: `/api/sites/${siteId}/content/articles/${articleId}/revisions/current`,
  };
}

async function signIn(page: Page, account: Account, articleURL: string) {
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(account.fullName).first()).toBeVisible();
  await page.goto(articleURL);
  await expect(page.getByRole("button", { name: "Сохранить изменения" })).toBeVisible();
}

async function parameters(page: Page) {
  await page.getByRole("navigation", { name: "Разделы статьи" })
    .getByRole("button", { name: "Параметры" }).click();
}

async function current(api: APIRequestContext, url: string) {
  const response = await api.get(url);
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

test("owner returns a revision for changes; only the resubmitted revision can be published", async ({ browser }) => {
  const fixture = await seedPublishedArticle();
  const manager = await browser.newContext();
  const owner = await browser.newContext();
  const managerPage = await manager.newPage();
  const ownerPage = await owner.newPage();
  await signIn(managerPage, fixture.manager, fixture.articleURL);
  await parameters(managerPage);
  await managerPage.locator('input[name="title"]').fill(`${fixture.title} первый черновик`);
  await managerPage.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(managerPage.getByText("Изменения сохранены")).toBeVisible();
  await managerPage.goto(fixture.articleURL);
  await parameters(managerPage);
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await expect(managerPage.getByText("Версия отправлена владельцу сайта на проверку")).toBeVisible();
  const submitted = await current(fixture.api, fixture.currentURL);
  expect(submitted.reviewState).toBe("in_review");

  await signIn(ownerPage, fixture.owner, fixture.articleURL);
  await parameters(ownerPage);
  ownerPage.once("dialog", (dialog) => dialog.accept("Уточнить заголовок"));
  await ownerPage.getByRole("button", { name: "Вернуть на доработку" }).click();
  await expect(ownerPage.getByText("Версия возвращена на доработку")).toBeVisible();
  await ownerPage.screenshot({ path: join(tmpdir(), "wispo-revision-returned.png") });
  const returned = await current(fixture.api, fixture.currentURL);
  expect(returned.reviewState).toBe("changes_requested");
  expect(returned.approvedRevisionId).toBeNull();
  expect(returned.draft.id).toBe(submitted.draft.id);
  expect((await (await fixture.api.get(fixture.publicURL)).json()).article.title).toBe(fixture.title);

  await managerPage.reload();
  await parameters(managerPage);
  await expect(managerPage.getByRole("button", { name: "Отправить владельцу на проверку" })).toBeVisible();
  await expect(managerPage.getByRole("button", { name: "Опубликовать одобренную версию" })).toHaveCount(0);
  const correctedTitle = `${fixture.title} исправленный`;
  await managerPage.locator('input[name="title"]').fill(correctedTitle);
  await managerPage.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(managerPage.getByText("Изменения сохранены")).toBeVisible();
  const corrected = await current(fixture.api, fixture.currentURL);
  expect(corrected.draft.id).not.toBe(submitted.draft.id);
  expect(corrected.reviewState).toBe("draft");
  await managerPage.goto(fixture.articleURL);
  await parameters(managerPage);
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await ownerPage.reload();
  await parameters(ownerPage);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.getByText("Версия одобрена. Теперь её можно опубликовать")).toBeVisible();
  await managerPage.reload();
  await parameters(managerPage);
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage.getByRole("button", { name: "Опубликовать одобренную версию" }).click();
  await expect(managerPage.getByText("Одобренная версия опубликована")).toBeVisible();
  expect((await (await fixture.api.get(fixture.publicURL)).json()).article.title).toBe(correctedTitle);
  await manager.close();
  await owner.close();
  await fixture.api.dispose();
});

test("owner cannot approve a revision submitted after opening an older one", async ({ browser }) => {
  const fixture = await seedPublishedArticle();
  const manager = await browser.newContext();
  const owner = await browser.newContext();
  const managerPage = await manager.newPage();
  const ownerPage = await owner.newPage();
  await signIn(managerPage, fixture.manager, fixture.articleURL);
  await parameters(managerPage);
  await managerPage.locator('input[name="title"]').fill(`${fixture.title} версия 1`);
  await managerPage.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(managerPage.getByText("Изменения сохранены")).toBeVisible();
  await managerPage.goto(fixture.articleURL);
  await parameters(managerPage);
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await expect(managerPage.getByText("Версия отправлена владельцу сайта на проверку")).toBeVisible();
  const firstRevisionId = (await current(fixture.api, fixture.currentURL)).draft.id;

  await signIn(ownerPage, fixture.owner, fixture.articleURL);
  await parameters(ownerPage);
  await expect(ownerPage.getByRole("button", { name: "Одобрить версию" })).toBeVisible();
  const openedPreviewHref = await ownerPage.getByRole("link", { name: "Посмотреть черновик" }).getAttribute("href");
  if (!openedPreviewHref) throw new Error("Opened revision preview link is missing");
  expect(openedPreviewHref).toContain(`cmsRevisionId=${firstRevisionId}`);

  await managerPage.reload();
  await parameters(managerPage);
  await managerPage.locator('input[name="title"]').fill(`${fixture.title} версия 2`);
  await managerPage.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(managerPage.getByText("Изменения сохранены")).toBeVisible();
  const secondRevisionId = (await current(fixture.api, fixture.currentURL)).draft.id;
  expect(secondRevisionId).not.toBe(firstRevisionId);
  await managerPage.goto(fixture.articleURL);
  await parameters(managerPage);
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await expect(managerPage.getByText("Версия отправлена владельцу сайта на проверку")).toBeVisible();

  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.locator(".inline-message")).toContainText(
    "Версия изменилась после открытия. Проверьте новую версию перед одобрением.",
  );
  await expect(ownerPage.getByRole("link", { name: "Посмотреть черновик" })).toHaveAttribute("href", openedPreviewHref);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.locator(".inline-message")).toContainText(
    "Версия изменилась после открытия. Проверьте новую версию перед одобрением.",
  );
  const after = await current(fixture.api, fixture.currentURL);
  expect(after.draft.id).toBe(secondRevisionId);
  expect(after.approvedRevisionId).toBeNull();
  expect(after.reviewState).toBe("in_review");
  await manager.close();
  await owner.close();
  await fixture.api.dispose();
});

test("article preview link keeps showing its original revision after another save", async ({ browser }) => {
  const fixture = await seedPublishedArticle();
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, fixture.manager, fixture.articleURL);
  await parameters(page);
  const firstTitle = `${fixture.title} первая версия`;
  await page.locator('input[name="title"]').fill(firstTitle);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.getByText("Изменения сохранены")).toBeVisible();
  await page.goto(fixture.articleURL);
  await parameters(page);
  const previewHref = await page.getByRole("link", { name: "Посмотреть черновик" }).getAttribute("href");
  if (!previewHref) throw new Error("Draft preview link is missing");
  const firstRevisionId = (await current(fixture.api, fixture.currentURL)).draft.id;

  const secondTitle = `${fixture.title} вторая версия`;
  await page.locator('input[name="title"]').fill(secondTitle);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.getByText("Изменения сохранены")).toBeVisible();
  expect((await current(fixture.api, fixture.currentURL)).draft.id).not.toBe(firstRevisionId);

  await page.goto(previewHref);
  await expect(page.getByRole("heading", { name: firstTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: secondTitle })).toHaveCount(0);
  await context.close();
  await fixture.api.dispose();
});

test("stale article body autosave reports a conflict and preserves local text", async ({ browser }) => {
  const fixture = await seedPublishedArticle();
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  await signIn(firstPage, fixture.manager, fixture.articleURL);
  await signIn(secondPage, fixture.manager, fixture.articleURL);
  const firstText = `${fixture.body} — изменение первой вкладки`;
  const secondText = `${fixture.body} — изменение второй вкладки`;
  await firstPage.getByRole("textbox", { name: "Текст абзаца" }).fill(firstText);
  await expect.poll(async () => (await current(fixture.api, fixture.currentURL))?.draft?.snapshot?.body).toBe(firstText);
  await secondPage.getByRole("textbox", { name: "Текст абзаца" }).fill(secondText);
  await expect(secondPage.getByText("Конфликт версий — скопируйте текст и перезагрузите")).toBeVisible();
  await expect(secondPage.getByRole("textbox", { name: "Текст абзаца" })).toHaveValue(secondText);
  expect((await current(fixture.api, fixture.currentURL)).draft.snapshot.body).toBe(firstText);
  expect((await (await fixture.api.get(fixture.publicURL)).json()).article.body).toBe(fixture.body);
  await secondPage.screenshot({ path: join(tmpdir(), "wispo-revision-body-conflict.png") });
  await first.close();
  await second.close();
  await fixture.api.dispose();
});

test("stale article parameters cannot overwrite a newer draft", async ({ browser }) => {
  const fixture = await seedPublishedArticle();
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  await signIn(firstPage, fixture.manager, fixture.articleURL);
  await signIn(secondPage, fixture.manager, fixture.articleURL);
  await parameters(firstPage);
  await parameters(secondPage);
  const firstTitle = `${fixture.title} первая вкладка`;
  await firstPage.locator('input[name="title"]').fill(firstTitle);
  await firstPage.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(firstPage.getByText("Изменения сохранены")).toBeVisible();
  expect((await current(fixture.api, fixture.currentURL)).draft.snapshot.title).toBe(firstTitle);
  await secondPage.locator('input[name="title"]').fill(`${fixture.title} вторая вкладка`);
  const staleSave = secondPage.waitForResponse((response) =>
    response.request().method() === "PATCH" &&
    response.url().includes(`/content/articles/${fixture.articleId}`),
  );
  await secondPage.getByRole("button", { name: "Сохранить изменения" }).click();
  expect((await staleSave).status()).toBe(409);
  expect((await current(fixture.api, fixture.currentURL)).draft.snapshot.title).toBe(firstTitle);
  await first.close();
  await second.close();
  await fixture.api.dispose();
});
