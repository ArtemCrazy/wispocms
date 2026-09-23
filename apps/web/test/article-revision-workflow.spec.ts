import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const baseURL = "http://localhost:3310";
const siteId = "51a00000-0000-4000-8000-000000000002";
test.use({ baseURL, channel: "chrome" });
test.beforeAll(() => {
  if (process.env.WISPO_E2E_ISOLATED_DB !== "wispo_cms_e2e")
    throw new Error("This mutating test requires the disposable wispo_cms_e2e database and explicit WISPO_E2E_ISOLATED_DB=wispo_cms_e2e opt-in.");
});

function bootstrapCredentials() {
  const source = readFileSync(join(__dirname, "../../../.env.local"), "utf8");
  const value = (key: string) => {
    const line = source.split(/\r?\n/).find((row) => row.startsWith(`${key}=`));
    if (!line) throw new Error(`Missing ${key} in local environment`);
    return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "");
  };
  return { email: value("BOOTSTRAP_ADMIN_EMAIL"), password: value("BOOTSTRAP_ADMIN_PASSWORD") };
}

test("manager submits, owner approves, manager publishes an article revision", async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL });
  const login = await api.post("/api/auth/login", { data: bootstrapCredentials() });
  expect(login.status()).toBe(200);

  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const accounts = [
    { role: "site_owner", fullName: "E2E владелец", email: `e2e-owner-${nonce}@example.invalid` },
    { role: "site_content_manager", fullName: "E2E менеджер", email: `e2e-manager-${nonce}@example.invalid` },
  ];
  for (const account of accounts) {
    const response = await api.post("/api/platform/users", {
      data: { ...account, password, siteIds: [siteId] },
    });
    expect(response.status(), await response.text()).toBe(201);
  }

  const slug = `e2e-revision-${nonce}`;
  const oldTitle = `Проверка версии ${nonce}`;
  const newTitle = `${oldTitle} после согласования`;
  const created = await api.post(`/api/sites/${siteId}/content/articles`, {
    data: { title: oldTitle, slug, body: "Тестовый текст статьи для проверки согласования.", displayTemplateKey: "skinova-article", displayTemplateVersion: "1" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const articleId = (await created.json()).id as string;
  for (const [path, state] of [
    ["editorial", "review"], ["editorial", "approved"], ["publication", "published"],
  ]) {
    const response = await api.post(`/api/sites/${siteId}/content/articles/${articleId}/${path}`, {
      data: { state },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const initialRevision = await api.get(`/api/sites/${siteId}/content/articles/${articleId}/revisions/current`);
  expect(initialRevision.status(), await initialRevision.text()).toBe(200);
  expect(await initialRevision.text()).toBe("");
  const publicURL = `/api/public/sites/skinova/articles/${slug}`;
  const publishedBefore = await api.get(publicURL);
  expect(publishedBefore.status(), await publishedBefore.text()).toBe(200);
  expect((await publishedBefore.json()).article.title).toBe(oldTitle);

  const articleURL = `/?site=${siteId}&view=articles&subview=content&contentArticle=${articleId}`;
  const manager = await browser.newContext();
  const owner = await browser.newContext();
  const managerPage = await manager.newPage();
  const ownerPage = await owner.newPage();
  const browserErrors: string[] = [];
  for (const page of [managerPage, ownerPage])
    page.on("pageerror", (error) => browserErrors.push(error.message));

  async function signIn(page: Page, account: (typeof accounts)[number]) {
    await page.goto("/");
    await page.getByLabel("Электронная почта").fill(account.email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByText(account.fullName).first()).toBeVisible();
    await page.goto(articleURL);
    await expect(page.getByRole("button", { name: "Сохранить изменения" })).toBeVisible();
    await page.getByRole("navigation", { name: "Разделы статьи" }).getByRole("button", { name: "Параметры" }).click();
  }

  await signIn(managerPage, accounts[1]);
  await managerPage.locator('input[name="title"]').last().fill(newTitle);
  await managerPage.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(managerPage.getByText("Изменения сохранены")).toBeVisible();
  const notYetPublished = await api.get(publicURL);
  expect((await notYetPublished.json()).article.title).toBe(oldTitle);
  await managerPage.goto(articleURL);
  await managerPage.getByRole("navigation", { name: "Разделы статьи" }).getByRole("button", { name: "Параметры" }).click();
  await expect(managerPage.getByRole("button", { name: "Отправить владельцу на проверку" })).toBeVisible();
  await expect(managerPage.getByRole("button", { name: "Одобрить версию" })).toHaveCount(0);
  await managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }).click();
  await expect(managerPage.getByText("Версия отправлена владельцу сайта на проверку")).toBeVisible();

  await signIn(ownerPage, accounts[0]);
  await ownerPage.screenshot({ path: join(tmpdir(), "wispo-revision-owner-desktop.png"), fullPage: true });
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.getByText("Версия одобрена. Теперь её можно опубликовать")).toBeVisible();

  await managerPage.reload();
  await managerPage.getByRole("navigation", { name: "Разделы статьи" }).getByRole("button", { name: "Параметры" }).click();
  await expect(managerPage.getByRole("button", { name: "Опубликовать одобренную версию" })).toBeVisible();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage.getByRole("button", { name: "Опубликовать одобренную версию" }).click();
  await expect(managerPage.getByText("Одобренная версия опубликована")).toBeVisible();
  const publishedAfter = await api.get(publicURL);
  expect((await publishedAfter.json()).article.title).toBe(newTitle);
  await managerPage.screenshot({ path: join(tmpdir(), "wispo-revision-manager-desktop.png"), fullPage: true });
  await managerPage.setViewportSize({ width: 375, height: 812 });
  await managerPage.screenshot({ path: join(tmpdir(), "wispo-revision-manager-mobile.png"), fullPage: true });
  expect(browserErrors).toEqual([]);

  await manager.close();
  await owner.close();
  await api.dispose();
});
