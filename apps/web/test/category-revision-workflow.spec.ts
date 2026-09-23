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
    throw new Error(
      "Category E2E requires the disposable wispo_cms_e2e database and explicit opt-in.",
    );
});

function adminCredentials() {
  const source = readFileSync(join(__dirname, "../../../.env.local"), "utf8");
  const value = (key: string) => {
    const line = source
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${key}=`));
    if (!line) throw new Error(`Missing ${key} in local environment`);
    return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "");
  };
  return {
    email: value("BOOTSTRAP_ADMIN_EMAIL"),
    password: value("BOOTSTRAP_ADMIN_PASSWORD"),
  };
}

type Account = { fullName: string; email: string; password: string };
type CategoryRevisionCurrent = {
  draft: { id: string; versionNumber: number } | null;
  approvedRevisionId: string | null;
  publishedRevisionId: string | null;
  reviewState: string;
} | null;

async function signIn(
  page: Page,
  account: Account,
  category: { slug: string },
) {
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(account.fullName).first()).toBeVisible();
  await page.goto(`/?site=${siteId}&view=categories`);
  const row = page
    .locator(".category-tree article")
    .filter({ hasText: `/${category.slug}` });
  await row.getByTitle("Настройки рубрики").click();
  await expect(page.getByLabel("Название", { exact: true })).toBeVisible();
}

async function current(api: APIRequestContext, categoryId: string) {
  const response = await api.get(
    `/api/sites/${siteId}/content/categories/${categoryId}/revisions/current`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<CategoryRevisionCurrent>;
}

test("manager submits, owner approves, and manager publishes one exact category revision", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const api = await playwrightRequest.newContext({ baseURL });
  expect(
    (await api.post("/api/auth/login", { data: adminCredentials() })).status(),
  ).toBe(200);
  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const owner = {
    fullName: "E2E владелец рубрики",
    email: `e2e-category-owner-${nonce}@example.invalid`,
    password,
  };
  const manager = {
    fullName: "E2E менеджер рубрики",
    email: `e2e-category-manager-${nonce}@example.invalid`,
    password,
  };
  for (const [account, role] of [
    [owner, "site_owner"],
    [manager, "site_content_manager"],
  ] as const) {
    const response = await api.post("/api/platform/users", {
      data: { ...account, role, siteIds: [siteId] },
    });
    expect(response.status(), await response.text()).toBe(201);
  }

  const categoriesResponse = await api.get(
    `/api/sites/${siteId}/content/categories`,
  );
  expect(categoriesResponse.status(), await categoriesResponse.text()).toBe(200);
  const category = (
    (await categoriesResponse.json()) as Array<{
      id: string;
      name: string;
      slug: string;
      publicationState: string;
    }>
  ).find((item) => item.publicationState === "published");
  if (!category)
    throw new Error("A published Skinova category is missing in the disposable database");
  const publicURL = `/api/public/sites/skinova/categories/${category.slug}`;
  const before = await api.get(publicURL);
  expect(before.status(), await before.text()).toBe(200);
  const publicName = (await before.json()).category.name as string;
  const nextName = `Рубрика на согласовании ${nonce}`;

  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();

  await signIn(managerPage, manager, category);
  await managerPage.getByLabel("Название", { exact: true }).fill(nextName);
  await managerPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    managerPage.getByText("Новая версия рубрики сохранена"),
  ).toBeVisible();
  expect((await (await api.get(publicURL)).json()).category.name).toBe(publicName);

  const saved = await current(api, category.id);
  expect(saved?.draft?.id).toBeTruthy();
  const previewHref = await managerPage
    .getByRole("link", { name: "Посмотреть выбранную версию" })
    .getAttribute("href");
  if (!previewHref) throw new Error("Category revision preview link is missing");
  expect(previewHref).toContain(`cmsRevisionId=${saved?.draft?.id}`);
  const preview = await managerContext.newPage();
  await preview.goto(previewHref);
  await expect(preview.getByRole("heading", { name: nextName })).toBeVisible();
  await preview.close();

  await managerPage
    .getByRole("button", { name: "Отправить владельцу на проверку" })
    .click();
  await expect(
    managerPage.getByText(
      "Версия рубрики отправлена владельцу сайта на проверку",
    ),
  ).toBeVisible();
  expect((await current(api, category.id))?.reviewState).toBe("in_review");

  await signIn(ownerPage, owner, category);
  await expect(ownerPage.getByLabel("Название", { exact: true })).toHaveValue(
    nextName,
  );
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(
    ownerPage.getByText(
      "Версия рубрики одобрена. Теперь её можно опубликовать",
    ),
  ).toBeVisible();
  expect((await current(api, category.id))?.approvedRevisionId).toBe(
    saved?.draft?.id,
  );

  await managerPage.reload();
  const managerRow = managerPage
    .locator(".category-tree article")
    .filter({ hasText: `/${category.slug}` });
  await managerRow.getByTitle("Настройки рубрики").click();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage
    .getByRole("button", { name: "Опубликовать одобренную версию" })
    .click();
  await expect(
    managerPage.getByText("Одобренная версия рубрики опубликована"),
  ).toBeVisible();
  expect((await (await api.get(publicURL)).json()).category.name).toBe(nextName);
  expect((await current(api, category.id))?.publishedRevisionId).toBe(
    saved?.draft?.id,
  );

  const secondName = `${nextName} повторно`;
  await managerPage.reload();
  const reopenedRow = managerPage
    .locator(".category-tree article")
    .filter({ hasText: `/${category.slug}` });
  await reopenedRow.getByTitle("Настройки рубрики").click();
  await expect(managerPage.getByLabel("Название", { exact: true })).toBeVisible();
  await managerPage.getByLabel("Название", { exact: true }).fill(secondName);
  await managerPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    managerPage.getByText("Новая версия рубрики сохранена"),
  ).toBeVisible();
  const secondSaved = await current(api, category.id);
  expect(secondSaved?.draft?.id).not.toBe(saved?.draft?.id);
  const secondPreviewHref = await managerPage
    .getByRole("link", { name: "Посмотреть выбранную версию" })
    .getAttribute("href");
  if (!secondPreviewHref)
    throw new Error("Second category revision preview link is missing");
  const secondPreview = await managerContext.newPage();
  await secondPreview.goto(secondPreviewHref);
  await expect(
    secondPreview.getByRole("heading", { name: secondName }),
  ).toBeVisible();
  await secondPreview.close();
  expect((await (await api.get(publicURL)).json()).category.name).toBe(nextName);

  await managerPage.screenshot({
    path: join(tmpdir(), "wispo-category-revision-desktop.png"),
    fullPage: true,
  });
  await managerPage.setViewportSize({ width: 390, height: 844 });
  await managerPage.screenshot({
    path: join(tmpdir(), "wispo-category-revision-mobile.png"),
    fullPage: true,
  });

  await managerContext.close();
  await ownerContext.close();
  await api.dispose();
});
