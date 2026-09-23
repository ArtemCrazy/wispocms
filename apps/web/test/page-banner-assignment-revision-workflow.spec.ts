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
    throw new Error(
      "Page banner assignment E2E requires the disposable wispo_cms_e2e database and explicit opt-in.",
    );
});

function adminCredentials() {
  const source = readFileSync(join(__dirname, "../../../.env.local"), "utf8");
  const value = (key: string) => {
    const line = source.split(/\r?\n/).find((row) => row.startsWith(`${key}=`));
    if (!line) throw new Error(`Missing ${key} in local environment`);
    return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "");
  };
  return {
    email: value("BOOTSTRAP_ADMIN_EMAIL"),
    password: value("BOOTSTRAP_ADMIN_PASSWORD"),
  };
}

type Account = { fullName: string; email: string; password: string };

async function login(page: Page, account: Account, view: string) {
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(account.fullName).first()).toBeVisible();
  await page.goto(`/?site=${siteId}&view=${view}`);
}

async function openHomepageEditor(page: Page) {
  await page.goto(`/?site=${siteId}&view=homepage-template`);
  await page.getByRole("button", { name: "Редактировать содержимое" }).click();
  await expect(page.getByText("ПУБЛИКАЦИЯ")).toBeVisible();
}

async function current(api: APIRequestContext, pageId: string) {
  const response = await api.get(
    `/api/sites/${siteId}/content/pages/${pageId}/revisions/current`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<{
    draft: { id: string; versionNumber: number } | null;
    approvedRevisionId: string | null;
    publishedRevisionId: string | null;
    reviewState: string;
  } | null>;
}

function captureRuntimeErrors(page: Page, errors: string[]) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

test("page banner assignments stay draft-only until the exact page revision is approved and published", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const adminApi = await playwrightRequest.newContext({ baseURL });
  expect(
    (await adminApi.post("/api/auth/login", { data: adminCredentials() })).status(),
  ).toBe(200);
  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const owner = {
    fullName: "E2E владелец назначений",
    email: `e2e-assignment-owner-${nonce}@example.invalid`,
    password,
  };
  const manager = {
    fullName: "E2E менеджер назначений",
    email: `e2e-assignment-manager-${nonce}@example.invalid`,
    password,
  };
  for (const [account, role] of [
    [owner, "site_owner"],
    [manager, "site_content_manager"],
  ] as const) {
    const response = await adminApi.post("/api/platform/users", {
      data: { ...account, role, siteIds: [siteId] },
    });
    expect(response.status(), await response.text()).toBe(201);
  }

  const pagesResponse = await adminApi.get(`/api/sites/${siteId}/content/pages`);
  expect(pagesResponse.status(), await pagesResponse.text()).toBe(200);
  const homepage = (
    (await pagesResponse.json()) as Array<{ id: string; kind: string }>
  ).find((item) => item.kind === "homepage");
  if (!homepage) throw new Error("Skinova homepage is missing");
  const publicURL = "/api/public/sites/skinova";
  const publicBeforeResponse = await adminApi.get(publicURL);
  expect(publicBeforeResponse.status(), await publicBeforeResponse.text()).toBe(200);
  const publicBefore = (await publicBeforeResponse.json()) as {
    banners: Array<{ id: string; placement: string }>;
  };
  const publishedPlacements = publicBefore.banners
    .filter((banner) => banner.placement.startsWith("homepage_"))
    .map((banner) => banner.placement)
    .sort();
  expect(publishedPlacements.length).toBeGreaterThan(0);

  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const runtimeErrors: string[] = [];

  await login(managerPage, manager, "homepage");
  captureRuntimeErrors(managerPage, runtimeErrors);
  await expect(
    managerPage.getByRole("heading", { name: "Баннеры главной" }),
  ).toBeVisible();
  for (const placement of publishedPlacements) {
    const name =
      placement === "homepage_top"
        ? "Верхняя промо-полоса"
        : "Баннер консультации";
    const zone = managerPage.locator(".banner-zone-list article").filter({
      has: managerPage.getByRole("heading", { name }),
    });
    await zone.getByLabel("Выбрать или заменить").selectOption("");
    await expect(managerPage.getByText(/Новая версия страницы без баннера/)).toBeVisible();
  }

  const staged = await current(adminApi, homepage.id);
  expect(staged?.draft?.id).toBeTruthy();
  const exactPreview = await adminApi.get(
    `/api/sites/${siteId}/content/pages/${homepage.id}/revisions/${staged?.draft?.id}/preview`,
  );
  expect(exactPreview.status(), await exactPreview.text()).toBe(200);
  expect(
    ((await exactPreview.json()) as { banners: Array<{ placement: string }> }).banners.filter(
      (banner) => banner.placement.startsWith("homepage_"),
    ),
  ).toEqual([]);
  expect(
    ((await (await adminApi.get(publicURL)).json()) as {
      banners: Array<{ placement: string }>;
    }).banners
      .filter((banner) => banner.placement.startsWith("homepage_"))
      .map((banner) => banner.placement)
      .sort(),
  ).toEqual(publishedPlacements);

  const screenshotDirectory = process.env.WISPO_E2E_SCREENSHOT_DIR;
  if (screenshotDirectory)
    await managerPage.screenshot({
      path: join(screenshotDirectory, "page-banner-assignments-desktop.png"),
      fullPage: false,
    });

  await openHomepageEditor(managerPage);
  await managerPage
    .getByRole("button", { name: "Отправить владельцу на проверку" })
    .click();
  await expect(managerPage.locator(".page-editor-message")).toHaveText(
    "Версия страницы отправлена владельцу на проверку",
  );

  await login(ownerPage, owner, "homepage-template");
  captureRuntimeErrors(ownerPage, runtimeErrors);
  await ownerPage.getByRole("button", { name: "Редактировать содержимое" }).click();
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.locator(".page-editor-message")).toHaveText(
    "Версия страницы одобрена",
  );

  await managerPage.reload();
  await managerPage.getByRole("button", { name: "Редактировать содержимое" }).click();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage
    .getByRole("button", { name: "Опубликовать одобренную версию" })
    .click();
  await expect(
    managerPage.getByText("Одобренная версия страницы опубликована"),
  ).toBeVisible();
  expect(
    ((await (await adminApi.get(publicURL)).json()) as {
      banners: Array<{ placement: string }>;
    }).banners.filter((banner) => banner.placement.startsWith("homepage_")),
  ).toEqual([]);
  expect((await current(adminApi, homepage.id))?.publishedRevisionId).toBe(
    staged?.draft?.id,
  );
  expect(runtimeErrors).toEqual([]);

  if (screenshotDirectory) {
    const mobile = await managerContext.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(
      `/?site=${encodeURIComponent(siteId)}&view=homepage`,
    );
    await expect(
      mobile.getByRole("heading", { name: "Баннеры главной" }),
    ).toBeVisible();
    await mobile.screenshot({
      path: join(screenshotDirectory, "page-banner-assignments-mobile.png"),
      fullPage: false,
    });
    await mobile.close();
  }

  await managerContext.close();
  await ownerContext.close();
  await adminApi.dispose();
});
