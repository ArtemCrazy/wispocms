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
      "Banner E2E requires the disposable wispo_cms_e2e database and explicit opt-in.",
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
type Banner = { id: string; name: string; title: string | null };
type RevisionCurrent = {
  draft: { id: string; versionNumber: number } | null;
  approvedRevisionId: string | null;
  publishedRevisionId: string | null;
  reviewState: string;
} | null;

async function current(api: APIRequestContext, bannerId: string) {
  const response = await api.get(
    `/api/sites/${siteId}/content/banners/${bannerId}/revisions/current`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<RevisionCurrent>;
}

async function publicBanner(api: APIRequestContext, bannerId: string) {
  const response = await api.get("/api/public/sites/skinova");
  expect(response.status(), await response.text()).toBe(200);
  const payload = (await response.json()) as { banners: Banner[] };
  const banner = payload.banners.find((item) => item.id === bannerId);
  if (!banner) throw new Error("Published Skinova banner is missing");
  return banner;
}

async function signIn(page: Page, account: Account, bannerName: string) {
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByLabel("Электронная почта")).toBeHidden();
  await page.goto(`/?site=${siteId}&view=banners`);
  const card = page.locator(".media-banner-card").filter({ hasText: bannerName });
  await card.getByRole("button").click();
  await expect(
    page.getByRole("textbox", { name: "Заголовок", exact: true }),
  ).toBeEditable();
}

test("manager submits, owner approves, and manager publishes one exact banner revision", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const api = await playwrightRequest.newContext({ baseURL });
  expect(
    (await api.post("/api/auth/login", { data: adminCredentials() })).status(),
  ).toBe(200);
  const bannersResponse = await api.get(
    `/api/sites/${siteId}/content/banners`,
  );
  expect(bannersResponse.status(), await bannersResponse.text()).toBe(200);
  const banner = ((await bannersResponse.json()) as Banner[]).find(
    (item) => item.name === "Баннер статьи Skinova",
  );
  if (!banner) throw new Error("Skinova banner is missing");
  const publicBefore = await publicBanner(api, banner.id);

  const nonce = randomBytes(5).toString("hex");
  const password = `LocalOnly-${randomBytes(15).toString("hex")}`;
  const owner = {
    fullName: "E2E владелец баннеров",
    email: `e2e-banner-owner-${nonce}@example.invalid`,
    password,
  };
  const manager = {
    fullName: "E2E менеджер баннеров",
    email: `e2e-banner-manager-${nonce}@example.invalid`,
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

  const nextTitle = `Баннер после согласования ${nonce}`;
  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();

  await signIn(managerPage, manager, banner.name);
  await managerPage
    .getByRole("textbox", { name: "Заголовок", exact: true })
    .fill(nextTitle);
  await expect(managerPage.getByText("Новая версия баннера сохранена")).toBeVisible();
  expect((await publicBanner(api, banner.id)).title).toBe(publicBefore.title);

  const saved = await current(api, banner.id);
  expect(saved?.draft?.id).toBeTruthy();
  await managerPage
    .getByRole("button", { name: "Просмотреть выбранную версию" })
    .click();
  await expect(
    managerPage.getByRole("region", { name: "Предпросмотр версии баннера" }),
  ).toBeVisible();
  if (process.env.WISPO_CAPTURE_UI === "1")
    await managerPage.screenshot({
      path: join(tmpdir(), "wispo-banner-revision-desktop.png"),
      fullPage: true,
    });

  await managerPage
    .getByRole("button", { name: "Отправить владельцу на проверку" })
    .click();
  await expect(
    managerPage.getByText(
      "Версия баннера отправлена владельцу сайта на проверку",
    ),
  ).toBeVisible();
  expect((await current(api, banner.id))?.reviewState).toBe("in_review");

  await signIn(ownerPage, owner, banner.name);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(
    ownerPage.getByText("Версия баннера одобрена. Теперь её можно опубликовать"),
  ).toBeVisible();

  await managerPage.reload();
  const managerCard = managerPage
    .locator(".media-banner-card")
    .filter({ hasText: banner.name });
  await managerCard.getByRole("button").click();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage
    .getByRole("button", { name: "Опубликовать одобренную версию" })
    .click();
  await expect(
    managerPage.getByText("Одобренная версия баннера опубликована"),
  ).toBeVisible();
  expect((await publicBanner(api, banner.id)).title).toBe(nextTitle);
  expect((await current(api, banner.id))?.publishedRevisionId).toBe(
    saved?.draft?.id,
  );

  if (process.env.WISPO_CAPTURE_UI === "1") {
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobileContext.newPage();
    await signIn(mobilePage, manager, banner.name);
    await mobilePage.screenshot({
      path: join(tmpdir(), "wispo-banner-revision-mobile.png"),
      fullPage: true,
    });
    await mobileContext.close();
  }

  await managerContext.close();
  await ownerContext.close();
  await api.dispose();
});
