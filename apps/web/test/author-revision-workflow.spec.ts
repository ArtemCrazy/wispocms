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
      "Author E2E requires the disposable wispo_cms_e2e database and explicit opt-in.",
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
type Author = {
  id: string;
  fullName: string;
  email: string | null;
  bio: string | null;
};
type RevisionCurrent = {
  draft: { id: string; versionNumber: number } | null;
  approvedRevisionId: string | null;
  publishedRevisionId: string | null;
  reviewState: string;
} | null;

async function current(api: APIRequestContext, authorId: string) {
  const response = await api.get(
    `/api/sites/${siteId}/content/authors/${authorId}/revisions/current`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<RevisionCurrent>;
}

async function signIn(page: Page, account: Account, authorName: string) {
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByLabel("Электронная почта")).toBeHidden();
  await page.goto(`/?site=${siteId}&view=authors`);
  const card = page.locator(".authors-grid article").filter({ hasText: authorName });
  await card
    .getByRole("button", { name: `Редактировать автора ${authorName}` })
    .click();
  await expect(page.getByLabel("Имя и фамилия")).toBeVisible();
}

test("manager submits, owner approves, and manager publishes one exact author revision", async ({
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
    fullName: "E2E владелец авторов",
    email: `e2e-author-owner-${nonce}@example.invalid`,
    password,
  };
  const manager = {
    fullName: "E2E менеджер авторов",
    email: `e2e-author-manager-${nonce}@example.invalid`,
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

  const articlesResponse = await api.get(
    `/api/sites/${siteId}/content/articles`,
  );
  expect(articlesResponse.status(), await articlesResponse.text()).toBe(200);
  const articles = (await articlesResponse.json()) as Array<{
    slug: string;
    publicationState: string;
    author: Author | null;
  }>;
  let selected:
    | { author: Author; publicURL: string; publicName: string }
    | undefined;
  for (const article of articles) {
    if (article.publicationState !== "published" || !article.author) continue;
    const publicURL = `/api/public/sites/skinova/articles/${article.slug}`;
    const response = await api.get(publicURL);
    if (response.status() !== 200) continue;
    const publicName = ((await response.json()) as { article: { author: Author } })
      .article.author.fullName;
    selected = { author: article.author, publicURL, publicName };
    break;
  }
  if (!selected)
    throw new Error("A published Skinova article with an author is missing");

  const nextName = `Автор после согласования ${nonce}`;
  const managerContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const ownerPage = await ownerContext.newPage();

  await signIn(managerPage, manager, selected.author.fullName);
  await managerPage.getByLabel("Имя и фамилия").fill(nextName);
  await managerPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(managerPage.getByText("Новая версия автора сохранена")).toBeVisible();
  expect(
    ((await (await api.get(selected.publicURL)).json()) as {
      article: { author: Author };
    }).article.author.fullName,
  ).toBe(selected.publicName);

  const saved = await current(api, selected.author.id);
  expect(saved?.draft?.id).toBeTruthy();
  await managerPage
    .getByRole("button", { name: "Просмотреть выбранную версию" })
    .click();
  await expect(
    managerPage.getByRole("region", { name: "Предпросмотр автора" }),
  ).toContainText(nextName);
  if (process.env.WISPO_CAPTURE_UI === "1")
    await managerPage.screenshot({
      path: join(tmpdir(), "wispo-author-revision-desktop.png"),
      fullPage: true,
    });

  await managerPage
    .getByRole("button", { name: "Отправить владельцу на проверку" })
    .click();
  await expect(
    managerPage.getByText(
      "Версия автора отправлена владельцу сайта на проверку",
    ),
  ).toBeVisible();
  expect((await current(api, selected.author.id))?.reviewState).toBe("in_review");

  await signIn(ownerPage, owner, nextName);
  await ownerPage.getByRole("button", { name: "Одобрить версию" }).click();
  await expect(
    ownerPage.getByText("Версия автора одобрена. Теперь её можно опубликовать"),
  ).toBeVisible();

  await managerPage.reload();
  const managerCard = managerPage
    .locator(".authors-grid article")
    .filter({ hasText: nextName });
  await managerCard
    .getByRole("button", { name: `Редактировать автора ${nextName}` })
    .click();
  managerPage.once("dialog", (dialog) => dialog.accept());
  await managerPage
    .getByRole("button", { name: "Опубликовать одобренную версию" })
    .click();
  await expect(
    managerPage.getByText("Одобренная версия автора опубликована"),
  ).toBeVisible();
  expect(
    ((await (await api.get(selected.publicURL)).json()) as {
      article: { author: Author };
    }).article.author.fullName,
  ).toBe(nextName);
  expect((await current(api, selected.author.id))?.publishedRevisionId).toBe(
    saved?.draft?.id,
  );

  if (process.env.WISPO_CAPTURE_UI === "1") {
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobileContext.newPage();
    await signIn(mobilePage, manager, nextName);
    await mobilePage.screenshot({
      path: join(tmpdir(), "wispo-author-revision-mobile.png"),
      fullPage: true,
    });
    await mobileContext.close();
  }

  await managerContext.close();
  await ownerContext.close();
  await api.dispose();
});
