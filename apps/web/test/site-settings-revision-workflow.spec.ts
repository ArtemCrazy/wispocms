import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
} from "@playwright/test";

const baseURL = "http://localhost:3310";
const siteId = "51a00000-0000-4000-8000-000000000002";
test.use({ baseURL, channel: "chrome", viewport: { width: 1280, height: 800 } });
test.beforeAll(() => {
  if (process.env.WISPO_E2E_ISOLATED_DB !== "wispo_cms_e2e")
    throw new Error(
      "Site settings E2E requires the disposable wispo_cms_e2e database and explicit opt-in.",
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

function captureRuntimeErrors(page: Page, errors: string[]) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}

test("global data stays private until the exact approved revision is published", async ({
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
    fullName: "E2E владелец общих данных",
    email: `e2e-settings-owner-${nonce}@example.invalid`,
    password,
  };
  const manager = {
    fullName: "E2E менеджер общих данных",
    email: `e2e-settings-manager-${nonce}@example.invalid`,
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

  const publicURL = "/api/public/sites/skinova";
  const publicBeforeResponse = await adminApi.get(publicURL);
  expect(publicBeforeResponse.status(), await publicBeforeResponse.text()).toBe(200);
  const publicBefore = (await publicBeforeResponse.json()) as {
    site: { globalData: { phone?: string } };
  };
  const stagedPhone = `+7 999 ${nonce.slice(0, 3)}-${nonce.slice(3, 5)}-11`;

  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const runtimeErrors: string[] = [];

  await login(managerPage, manager, "globals");
  captureRuntimeErrors(managerPage, runtimeErrors);
  await managerPage.getByLabel("Телефон").fill(stagedPhone);
  await managerPage.getByRole("button", { name: "Сохранить общие данные" }).click();
  await expect(
    managerPage.getByText(
      "Новая версия общих данных сохранена. Публичный сайт не изменён.",
    ),
  ).toBeVisible();
  await expect(
    managerPage.getByRole("button", { name: "Отправить владельцу на проверку" }),
  ).toBeVisible();

  const currentResponse = await adminApi.get(
    `/api/sites/${siteId}/content/globals/revisions/current`,
  );
  expect(currentResponse.status(), await currentResponse.text()).toBe(200);
  const current = (await currentResponse.json()) as {
    draft: { id: string };
  };
  const exactPreview = await adminApi.get(
    `/api/sites/${siteId}/content/globals/revisions/${current.draft.id}/preview`,
  );
  expect(exactPreview.status(), await exactPreview.text()).toBe(200);
  expect(
    ((await exactPreview.json()) as { site: { globalData: { phone?: string } } })
      .site.globalData.phone,
  ).toBe(stagedPhone);
  expect(
    ((await (await adminApi.get(publicURL)).json()) as {
      site: { globalData: { phone?: string } };
    }).site.globalData.phone,
  ).toBe(publicBefore.site.globalData.phone);

  const screenshotDirectory = process.env.WISPO_E2E_SCREENSHOT_DIR;
  if (screenshotDirectory)
    await managerPage.screenshot({
      path: join(screenshotDirectory, "site-settings-workflow-desktop.png"),
      fullPage: true,
    });

  await managerPage
    .getByRole("button", { name: "Отправить владельцу на проверку" })
    .click();
  await expect(
    managerPage.getByText("Версия отправлена владельцу на проверку"),
  ).toBeVisible();

  await login(ownerPage, owner, "globals");
  captureRuntimeErrors(ownerPage, runtimeErrors);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(ownerPage.getByText("Версия одобрена")).toBeVisible();

  await managerPage.reload();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage
    .getByRole("button", { name: "Опубликовать одобренную версию" })
    .click();
  await expect(managerPage.getByText("Одобренная версия опубликована")).toBeVisible();
  expect(
    ((await (await adminApi.get(publicURL)).json()) as {
      site: { globalData: { phone?: string } };
    }).site.globalData.phone,
  ).toBe(stagedPhone);
  expect(runtimeErrors).toEqual([]);

  if (screenshotDirectory) {
    const mobile = await managerContext.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`/?site=${siteId}&view=globals`);
    await expect(mobile.getByRole("heading", { name: "Общие данные" })).toBeVisible();
    await mobile.screenshot({
      path: join(screenshotDirectory, "site-settings-workflow-mobile.png"),
      fullPage: true,
    });
    await mobile.close();
  }

  await managerContext.close();
  await ownerContext.close();
  await adminApi.dispose();
});
