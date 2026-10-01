import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const baseURL = "http://localhost:3300";

test.use({
  baseURL,
  channel: "chrome",
  viewport: { width: 1440, height: 1000 },
});

function localEnvironment() {
  const source = readFileSync(join(__dirname, "../../../.env.local"), "utf8");
  const value = (key: string) => {
    const line = source.split(/\r?\n/).find((row) => row.startsWith(`${key}=`));
    if (!line) throw new Error(`Missing ${key} in local environment`);
    return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "");
  };
  return {
    adminEmail: value("BOOTSTRAP_ADMIN_EMAIL"),
    adminPassword: value("BOOTSTRAP_ADMIN_PASSWORD"),
    jwtSecret: value("JWT_SECRET"),
  };
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function localSessionToken(
  user: { id: string; platformRole: string },
  secret: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJwtPart({ alg: "HS256", typ: "JWT" });
  const payload = encodeJwtPart({
    sub: user.id,
    role: user.platformRole,
    iat: now,
    exp: now + 3600,
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function loginAsAdmin(page: Page) {
  const environment = localEnvironment();
  await page.goto("/");
  await page.getByLabel("Электронная почта").fill(environment.adminEmail);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(environment.adminPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(
    page.getByRole("heading", { name: "Все проекты" }),
  ).toBeVisible();
}

async function openLuminavaSite(page: Page) {
  const sidebar = page.locator("aside.sidebar");
  await sidebar.getByRole("button", { name: "Luminava", exact: true }).click();
  await sidebar.getByRole("button", { name: "Skinova", exact: true }).click();
  await expect(page).toHaveURL(/site=.*&view=site/);
}

async function setSessionCookie(
  context: BrowserContext,
  user: { id: string; platformRole: string },
) {
  await context.addCookies([
    {
      name: "wispo_session",
      value: localSessionToken(user, localEnvironment().jwtSecret),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("root project menu keeps site tools out of the header and admin tools in the profile", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const sidebar = page.locator("aside.sidebar");
  await expect(
    sidebar.getByRole("button", { name: "Поиск по сайту" }),
  ).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "Уведомления" }),
  ).toHaveCount(0);
  await expect(sidebar.locator(".sidebar-search")).toHaveCount(0);
  await expect(
    sidebar.getByRole("button", { name: "Команда и доступы" }),
  ).toHaveCount(0);

  await sidebar.getByRole("button", { name: "Открыть профиль" }).click();
  const profile = sidebar.locator(".profile-popover");
  await expect(
    profile.getByRole("button", { name: "Настройки платформы" }),
  ).toBeVisible();
  await expect(
    profile.getByRole("button", { name: "Команда и доступы" }),
  ).toBeVisible();
  await expect(
    profile.getByRole("button", { name: "Журнал изменений" }),
  ).toBeVisible();
});

test("workspace rows separate navigation from toggling and match site root geometry", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Основная навигация" });
  const workspaceRow = navigation
    .locator(".workspace-tree-item")
    .filter({ hasText: "Luminava" });
  const workspaceRoot = workspaceRow.getByRole("button", {
    name: "Luminava",
    exact: true,
  });
  const collapsedToggle = workspaceRow.getByRole("button", {
    name: "Развернуть рабочее пространство «Luminava»",
  });

  await collapsedToggle.click();
  await expect(
    workspaceRow.getByRole("button", {
      name: "Свернуть рабочее пространство «Luminava»",
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Luminava" })).toBeVisible();

  await workspaceRoot.click();
  await expect(
    workspaceRow.getByRole("button", {
      name: "Свернуть рабочее пространство «Luminava»",
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Luminava" })).toBeVisible();

  const expandedToggle = workspaceRow.getByRole("button", {
    name: "Свернуть рабочее пространство «Luminava»",
  });
  await expandedToggle.click();
  await expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "Luminava" })).toBeVisible();

  await workspaceRoot.click();
  await expect(expandedToggle).toHaveAttribute("aria-expanded", "true");
  const workspaceRootBox = await workspaceRow
    .locator(".workspace-tree-root-row")
    .boundingBox();
  const workspaceToggleBox = await expandedToggle.boundingBox();
  expect(workspaceRootBox).not.toBeNull();
  expect(workspaceRootBox?.width).toBe(280);
  expect(workspaceRootBox?.height).toBe(38);
  expect(workspaceToggleBox?.width).toBe(32);
  expect(workspaceToggleBox?.height).toBe(32);

  await workspaceRow
    .getByRole("button", { name: "Skinova", exact: true })
    .click();
  const siteNavigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  const siteRootBox = await siteNavigation
    .locator(".site-nav-root-row")
    .first()
    .boundingBox();
  expect(siteRootBox).not.toBeNull();
  expect(workspaceRootBox!.width).toBeCloseTo(siteRootBox!.width, 3);
  expect(workspaceRootBox!.height).toBeCloseTo(siteRootBox!.height, 3);
});

test("site header shows one compact search and keeps the site menu while searching", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const sidebar = page.locator("aside.sidebar");
  await expect(
    sidebar.getByRole("button", { name: "Поиск по сайту" }),
  ).toHaveCount(1);
  await expect(
    sidebar.getByRole("button", { name: "Уведомления" }),
  ).toHaveCount(1);
  await expect(sidebar.locator(".sidebar-search")).toHaveCount(0);

  await sidebar.getByRole("button", { name: "Поиск по сайту" }).click();
  await expect(page).toHaveURL(/site=.*&view=global-search/);
  await expect(
    sidebar.getByRole("navigation", { name: "Разделы сайта Skinova" }),
  ).toBeVisible();
});

test("profile admin tools open their views without replacing the project menu", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const sidebar = page.locator("aside.sidebar");
  await sidebar.getByRole("button", { name: "Открыть профиль" }).click();
  await sidebar
    .locator(".profile-popover")
    .getByRole("button", { name: "Команда и доступы" })
    .click();

  await expect(page).toHaveURL(/(?:\?|&)view=team(?:&|$)/);
  await expect(page).not.toHaveURL(/(?:\?|&)site=/);
  await expect(
    page.getByRole("heading", { name: "Команда и доступы" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("navigation", { name: "Основная навигация" }),
  ).toBeVisible();
  await expect(sidebar.getByText("Управление Wispo")).toHaveCount(0);

  await page.reload();

  await expect(page).toHaveURL(/(?:\?|&)view=team(?:&|$)/);
  await expect(
    page.getByRole("heading", { name: "Команда и доступы" }),
  ).toBeVisible();
});

test("team table opens the styled user editor with multi-site controls", async ({ page }) => {
  await loginAsAdmin(page);
  const sidebar = page.locator("aside.sidebar");
  await sidebar.getByRole("button", { name: "Открыть профиль" }).click();
  await sidebar
    .locator(".profile-popover")
    .getByRole("button", { name: "Команда и доступы" })
    .click();

  const table = page.getByRole("table", { name: "Команда и доступы" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText([
    "Пользователь",
    "Роль",
    "Сайты",
    "Дополнительные возможности",
    "Статус",
    "",
  ]);

  const editableRow = table
    .getByRole("row")
    .filter({ has: page.getByText("content.luminava@local.test") });
  await editableRow.getByRole("button", { name: "Редактировать" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Редактирование пользователя",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Email")).toHaveAttribute("readonly");
  await expect(dialog.getByRole("combobox", { name: "Роль" })).toHaveText(
    "Контент-менеджер",
  );
  await expect(dialog.getByText("Доступ к коду")).toBeVisible();
  await expect(dialog.getByText("Требует согласования")).toBeVisible();

  const siteCheckboxes = dialog.locator('.team-site-picker input[type="checkbox"]');
  await expect(siteCheckboxes).toHaveCount(3);
  const initiallySelected = await siteCheckboxes.evaluateAll((items) =>
    items.filter((item) => (item as HTMLInputElement).checked).length,
  );
  const unchecked = dialog.locator('.team-site-picker input[type="checkbox"]:not(:checked)').first();
  await unchecked.check();
  await expect(dialog.getByText(`Выбрано: ${initiallySelected + 1}`)).toBeVisible();

  const switchControl = dialog.locator(".team-switch-control");
  await expect(switchControl).toHaveCSS("width", "40px");
  await expect(switchControl).toHaveCSS("height", "22px");
  const switchGeometry = await switchControl.evaluate((control) => {
    const track = control.querySelector("span");
    if (!track) throw new Error("Missing switch track");
    const knob = getComputedStyle(track, "::after");
    return {
      knobWidth: knob.width,
      knobHeight: knob.height,
      knobTop: knob.top,
      knobLeft: knob.left,
    };
  });
  expect(switchGeometry).toEqual({
    knobWidth: "16px",
    knobHeight: "16px",
    knobTop: "3px",
    knobLeft: "3px",
  });
  await expect(siteCheckboxes.first()).toHaveCSS("appearance", "none");
  await expect(siteCheckboxes.first()).toHaveCSS("width", "18px");
  await expect(siteCheckboxes.first()).toHaveCSS("height", "18px");
  await expect(
    dialog.getByRole("button", { name: "Сохранить изменения" }),
  ).toBeVisible();
});

test("user editor keeps its actions reachable when the password form expands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await loginAsAdmin(page);
  await page.goto("/?view=team");

  const editableRow = page
    .getByRole("table", { name: "Команда и доступы" })
    .getByRole("row")
    .filter({ has: page.getByText("content.luminava@local.test") });
  await editableRow.getByRole("button", { name: "Редактировать" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Редактирование пользователя",
  });
  await dialog.getByRole("button", { name: "Новый пароль" }).click();
  await expect(dialog.locator(".team-modal-password strong")).toHaveText(
    "Новый пароль",
  );

  const modalBody = dialog.locator(".team-modal-body");
  const footer = dialog.locator(":scope > footer");
  const bodyGeometry = await modalBody.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  const footerBox = await footer.boundingBox();
  const dialogBox = await dialog.boundingBox();

  expect(bodyGeometry.overflowY).toBe("auto");
  expect(bodyGeometry.scrollHeight).toBeGreaterThan(bodyGeometry.clientHeight);
  expect(footerBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(
    dialogBox!.y + dialogBox!.height,
  );
  await modalBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => modalBody.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const scrolledFooterBox = await footer.boundingBox();
  expect(scrolledFooterBox?.y).toBe(footerBox!.y);
  await expect(
    dialog.getByRole("button", { name: "Сохранить изменения" }),
  ).toBeInViewport();
});

test("site owner editor keeps approval hidden and one site selected", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/?view=team");

  const ownerRow = page
    .getByRole("table", { name: "Команда и доступы" })
    .getByRole("row")
    .filter({ has: page.getByText("owner.luminava@local.test") });
  await ownerRow.getByRole("button", { name: "Редактировать" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Редактирование пользователя",
  });
  await expect(dialog.getByText("Требует согласования")).toHaveCount(0);
  await expect(dialog.getByText("Выбрано: 1")).toBeVisible();
  const unchecked = dialog
    .locator('.team-site-picker input[type="checkbox"]:not(:checked)')
    .first();
  await unchecked.check();
  await expect(dialog.getByText("Выбрано: 1")).toBeVisible();
});

test("Wispo administrator requests password change by email", async ({ page }) => {
  await page.route("**/api/auth/admin-password-reset/request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await loginAsAdmin(page);
  const sidebar = page.locator("aside.sidebar");
  await sidebar.getByRole("button", { name: "Открыть профиль" }).click();
  await sidebar
    .locator(".profile-popover")
    .getByRole("button", { name: "Сменить пароль по email" })
    .click();

  await expect(
    sidebar.getByText("Письмо со ссылкой отправлено на email администратора"),
  ).toBeVisible();
  await expect(sidebar.getByLabel("Текущий пароль")).toHaveCount(0);

  await page.goto("/?view=team");
  const adminRow = page
    .getByRole("table", { name: "Команда и доступы" })
    .getByRole("row")
    .filter({ has: page.getByText(localEnvironment().adminEmail) });
  await adminRow.getByRole("button", { name: "Редактировать" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Редактирование пользователя",
  });
  await dialog
    .getByRole("button", { name: "Отправить ссылку на email" })
    .click();
  await expect(
    dialog.getByText("Письмо со ссылкой отправлено на email администратора"),
  ).toBeVisible();
});

test("media site uses a clickable and collapsible Site root", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  const siteRoot = navigation.getByRole("button", {
    name: "Сайт",
    exact: true,
  });
  const sections = navigation.getByRole("group", {
    name: "Страницы сайта",
  });

  await expect(siteRoot).toHaveAttribute("aria-current", "page");
  await expect(
    navigation.getByRole("button", { name: "Свернуть раздел «Сайт»" }),
  ).toHaveAttribute("aria-expanded", "true");
  for (const label of [
    "Главная",
    "Статьи",
    "Шапка и подвал",
    "Политика",
    "404",
  ]) {
    await expect(
      sections.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }

  await sections.getByRole("button", { name: "Статьи", exact: true }).click();
  await expect(page).toHaveURL(/view=articles/);
  await siteRoot.click();
  await expect(page).toHaveURL(/view=site/);
  await expect(page.getByRole("heading", { name: "Сайт" })).toBeVisible();

  await navigation
    .getByRole("button", { name: "Свернуть раздел «Сайт»" })
    .click();
  const siteCollapse = navigation.locator('[data-site-nav-collapse="site"]');
  await expect(siteCollapse).toHaveAttribute("aria-hidden", "true");
  await expect(siteCollapse).toHaveCSS("grid-template-rows", "0px");
  await expect(siteCollapse).toHaveCSS("opacity", "0");
  await expect(
    siteCollapse.getByRole("group", {
      name: "Страницы сайта",
      includeHidden: true,
    }),
  ).toHaveCount(1);
  await expect(
    navigation.getByRole("button", { name: "Развернуть раздел «Сайт»" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("section labels open their root while arrows only collapse expanded lists", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  const sections = [
    {
      label: "Сайт",
      child: "Статьи",
      rootView: "site",
      childView: "articles",
      toggleExpandedName: "Свернуть раздел «Сайт»",
      toggleCollapsedName: "Развернуть раздел «Сайт»",
    },
    {
      label: "Настройки",
      child: "Общие данные",
      rootView: "settings",
      childView: "globals",
      toggleExpandedName: "Свернуть раздел «Настройки»",
      toggleCollapsedName: "Развернуть раздел «Настройки»",
    },
    {
      label: "Контент-центр",
      child: "Исследование и анализ",
      rootView: "content-center",
      childView: "content-center",
      childScreen: "research",
      toggleExpandedName: "Свернуть раздел «Контент-центр»",
      toggleCollapsedName: "Развернуть раздел «Контент-центр»",
    },
  ];

  for (const section of sections) {
    const root = navigation.getByRole("button", {
      name: section.label,
      exact: true,
    });
    const expandedToggle = navigation.getByRole("button", {
      name: section.toggleExpandedName,
    });
    const collapsedToggle = navigation.getByRole("button", {
      name: section.toggleCollapsedName,
    });
    const child = navigation.getByRole("button", {
      name: section.child,
      exact: true,
    });

    if (await expandedToggle.isVisible()) await expandedToggle.click();
    await root.click();
    await expect(
      expandedToggle,
    ).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe(section.rootView);

    await child.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe(section.childView);
    if (section.childScreen) {
      expect(new URL(page.url()).searchParams.get("cc")).toBe(
        section.childScreen,
      );
    }
    await root.click();
    await expect(expandedToggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe(section.rootView);
    if (section.label === "Контент-центр") {
      expect(new URL(page.url()).searchParams.get("cc")).toBeNull();
    }

    await child.click();
    const childUrl = page.url();
    await expandedToggle.click();
    await expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
    expect(page.url()).toBe(childUrl);

    await root.click();
    await expect(expandedToggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe(section.rootView);

    await child.click();
    await expandedToggle.click();
    await expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
    await collapsedToggle.click();
    await expect(expandedToggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe(section.rootView);
    if (section.label === "Контент-центр") {
      expect(new URL(page.url()).searchParams.get("cc")).toBeNull();
    }
  }
});

test("administrator site selector keeps site icons without repeating workspace labels", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const sidebar = page.locator("aside.sidebar");
  const selector = sidebar.locator(".site-context-switcher");
  await expect(selector.locator("strong")).toHaveText("Skinova");
  await expect(selector.locator("small")).toHaveCount(0);

  await selector.click();
  const options = sidebar.locator(".site-context-switcher-menu > button");
  await expect(options).not.toHaveCount(0);
  await expect(options.locator(":scope > span")).toHaveCount(
    await options.count(),
  );
  await expect(options.locator("small")).toHaveCount(0);
});

test("site sidebar is 300 pixels wide and uses a compact selected-site icon control", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const sidebar = page.locator("aside.sidebar");
  const navigation = sidebar.getByRole("navigation", {
    name: "Разделы сайта Skinova",
  });
  const selector = sidebar.locator(".site-context-switcher");
  const selectedSiteIcon = selector.locator(".site-context-icon");

  await expect(sidebar).toHaveCSS("width", "300px");
  await expect(selector).toHaveCSS("width", "280px");
  await expect(selector).toHaveCSS("height", "44px");
  await expect(selectedSiteIcon).toBeVisible();
  await expect(selectedSiteIcon).toHaveText("S");
  await expect(selectedSiteIcon).toHaveCSS("width", "28px");
  await expect(navigation.locator(".site-nav-root-row").first()).toHaveCSS(
    "width",
    "280px",
  );
  await expect(navigation.locator(".site-nav-child").first()).toHaveCSS(
    "width",
    "262px",
  );
  await expect(sidebar.locator(".profile-card")).toHaveCSS("width", "280px");
});

test("site menu keeps SEO in the main hierarchy after Content Center", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  expect(
    await navigation.locator("[data-site-nav-root]").allTextContents(),
  ).toEqual(["Сайт", "Настройки", "Контент-центр", "SEO"]);
  await expect(
    navigation
      .locator(".site-nav-utilities")
      .getByRole("button", { name: "SEO", exact: true }),
  ).toHaveCount(0);
});

test("collapsed sidebar exposes a persistent control that opens it again", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  await page
    .locator("aside.sidebar")
    .getByRole("button", { name: "Свернуть меню" })
    .click();
  const reopen = page.locator(".sidebar-reopen-button");
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(reopen).toHaveCount(0);
  await expect(page.locator("aside.sidebar")).toBeVisible();
});

test("media site keeps CMS tools on the Site root screen instead of the sidebar", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  const content = page.locator("main.content");
  for (const label of [
    "Шаблоны и чанки",
    "Переменные",
    "Баннеры",
    "Медиатека",
  ]) {
    await expect(
      content.getByRole("button", {
        name: `Открыть раздел «${label}»`,
      }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(0);
  }
  expect(
    await content
      .getByRole("button", { name: /^Открыть раздел/ })
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Открыть раздел «Шаблоны и чанки»",
    "Открыть раздел «Переменные»",
    "Открыть раздел «Баннеры»",
    "Открыть раздел «Медиатека»",
  ]);
});

test("media site groups site settings under one collapsible Settings root", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });

  await navigation
    .getByRole("button", { name: "Настройки", exact: true })
    .click();
  await expect(page).toHaveURL(/view=settings/);
  expect(new URL(page.url()).searchParams.has("settings")).toBe(false);
  await expect(
    page.getByRole("heading", { name: "Настройки", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Параметры сайта" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Заявки с сайта" })).toBeVisible();

  const settings = navigation.getByRole("group", {
    name: "Настройки сайта",
  });
  await expect(
    navigation.getByRole("button", { name: "Свернуть раздел «Настройки»" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(await settings.getByRole("button").allTextContents()).toEqual([
    "Общие данные",
    "Подключение",
    "Домен",
    "Даты",
    "Продукт",
  ]);
  await expect(
    navigation.getByRole("group", { name: "Страницы сайта" }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("button", { name: "SEO", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("button", {
      name: "История изменений",
      exact: true,
    }),
  ).toHaveCount(0);

  await settings.getByRole("button", { name: "Домен", exact: true }).click();
  await expect(page).toHaveURL(/view=settings/);
  await expect(page).toHaveURL(/settings=domain/);
  await expect(
    page.getByRole("heading", { name: "Домен", exact: true }),
  ).toBeVisible();

  await settings.getByRole("button", { name: "Даты", exact: true }).click();
  await expect(page).toHaveURL(/settings=dates/);
  await expect(
    page.getByRole("heading", { name: "Даты", exact: true }),
  ).toBeVisible();

  await settings.getByRole("button", { name: "Продукт", exact: true }).click();
  await expect(page).toHaveURL(/settings=product/);
  await expect(
    page.getByRole("heading", { name: "Продукт", exact: true }),
  ).toBeVisible();
});

test("content center opens inside the selected site menu and is absent from the workspace tree", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const rootNavigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Основная навигация" });
  await rootNavigation
    .getByRole("button", { name: "Luminava", exact: true })
    .click();
  await expect(
    rootNavigation.getByRole("button", { name: "Контент-центр", exact: true }),
  ).toHaveCount(0);

  await rootNavigation
    .getByRole("button", { name: "Skinova", exact: true })
    .click();
  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  const initialMotionClass = await navigation.getAttribute("class");

  await navigation
    .getByRole("button", { name: "Контент-центр", exact: true })
    .click();
  await expect(page).toHaveURL(/site=.*&view=content-center/);
  await expect(page).not.toHaveURL(/(?:\?|&)workspace=/);
  await expect(
    page.getByRole("heading", { name: "Контент-центр", exact: true }),
  ).toBeVisible();
  await expect(navigation).toHaveAttribute("class", initialMotionClass ?? "");
  await expect(
    navigation.getByRole("group", { name: "Разделы контент-центра" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("group", { name: "Страницы сайта" }),
  ).toHaveCount(0);

  await navigation
    .getByRole("group", { name: "Разделы контент-центра" })
    .getByRole("button", { name: "Исследование и анализ", exact: true })
    .click();
  await expect(page).toHaveURL(/view=content-center/);
  await expect(page).toHaveURL(/cc=research/);
  await expect(
    page.getByRole("heading", { name: "Исследование и анализ" }),
  ).toBeVisible();
  await expect(navigation).toHaveAttribute("class", initialMotionClass ?? "");

  await page.reload();
  await expect(
    page
      .locator("aside.sidebar")
      .getByRole("navigation", { name: "Разделы сайта Skinova" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Исследование и анализ" }),
  ).toBeVisible();
});

test("administrator enters a site by replacing the existing sidebar", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toHaveCount(1);
  await expect(page.locator(".site-secondary-sidebar")).toHaveCount(0);
  await expect(
    sidebar.getByRole("navigation", { name: "Разделы сайта Skinova" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Все проекты", exact: true }),
  ).toBeVisible();

  await sidebar
    .getByRole("button", { name: "Все проекты", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Все проекты" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/(?:\?|&)site=/);
});

test("site navigation animates the existing menu and content surfaces", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const motion = await page.evaluate(() => {
    const navigation = document.querySelector("aside.sidebar nav");
    const content = document.querySelector("main.content");
    if (!navigation || !content) {
      throw new Error("Navigation surfaces are missing");
    }
    const navigationStyle = getComputedStyle(navigation);
    const contentStyle = getComputedStyle(content);
    const contentAnimation = content
      .getAnimations()
      .find(
        (animation) =>
          animation instanceof CSSAnimation &&
          animation.animationName.startsWith("wispo-content-enter-"),
      );
    const firstContentFrame =
      contentAnimation?.effect instanceof KeyframeEffect
        ? contentAnimation.effect.getKeyframes().at(0)
        : undefined;
    return {
      navigationName: navigationStyle.animationName,
      navigationDuration: navigationStyle.animationDuration,
      contentName: contentStyle.animationName,
      contentDuration: contentStyle.animationDuration,
      contentStartTransform: firstContentFrame?.transform,
    };
  });

  expect(motion.navigationName).toMatch(/^wispo-navigation-enter-/);
  expect(motion.navigationDuration).toBe("0.18s");
  expect(motion.contentName).toMatch(/^wispo-content-enter-/);
  expect(motion.contentDuration).toBe("0.22s");
  expect(motion.contentStartTransform).toBe("translateX(-10px)");
});

test("expanding a workspace does not animate an unchanged menu type", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const sidebar = page.locator("aside.sidebar");
  const navigation = sidebar.getByRole("navigation", {
    name: "Основная навигация",
  });
  await expect(navigation).toHaveCSS("animation-name", "none");

  await sidebar.getByRole("button", { name: "Luminava", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: "Skinova", exact: true }),
  ).toBeVisible();
  await expect(navigation).toHaveCSS("animation-name", "none");
});

test("opening another site section does not restart the site menu animation", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const navigation = page
    .locator("aside.sidebar")
    .getByRole("navigation", { name: "Разделы сайта Skinova" });
  const initialMotionClass = await navigation.getAttribute("class");

  await navigation.getByRole("button", { name: "Статьи", exact: true }).click();
  await expect(page).toHaveURL(/view=articles/);
  await expect(navigation).toHaveAttribute("class", initialMotionClass ?? "");
});

test("site navigation disables motion when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginAsAdmin(page);
  await openLuminavaSite(page);

  const animationNames = await page.evaluate(() => {
    const navigation = document.querySelector("aside.sidebar nav");
    const content = document.querySelector("main.content");
    if (!navigation || !content) {
      throw new Error("Navigation surfaces are missing");
    }
    return {
      navigation: getComputedStyle(navigation).animationName,
      content: getComputedStyle(content).animationName,
    };
  });

  expect(animationNames).toEqual({
    navigation: "none",
    content: "none",
  });
});

test("site owner opens directly inside the assigned site", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAsAdmin(adminPage);
  const usersResponse = await adminContext.request.get("/api/platform/users");
  expect(usersResponse.ok(), await usersResponse.text()).toBe(true);
  const users = (await usersResponse.json()) as Array<{
    id: string;
    email: string;
    platformRole: string;
    siteAccesses: Array<{ siteId: string; siteName: string }>;
  }>;
  const owner = users.find(
    (user) => user.email === "owner.luminava@local.test",
  );
  expect(owner).toBeTruthy();
  await adminContext.close();

  const ownerContext = await browser.newContext();
  await setSessionCookie(ownerContext, owner!);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto("/");

  await expect(ownerPage).toHaveURL(
    new RegExp(`site=${owner!.siteAccesses[0].siteId}.*view=site`),
  );
  const sidebar = ownerPage.locator("aside.sidebar");
  await expect(sidebar).toHaveCount(1);
  await expect(ownerPage.locator(".site-secondary-sidebar")).toHaveCount(0);
  await expect(
    sidebar.getByRole("navigation", {
      name: `Разделы сайта ${owner!.siteAccesses[0].siteName}`,
    }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Все проекты", exact: true }),
  ).toHaveCount(0);
  const ownerContextHeader = sidebar.locator(".owner-site-context");
  await expect(ownerContextHeader).toBeVisible();
  await expect(ownerContextHeader.locator("strong")).toHaveText(
    owner!.siteAccesses[0].siteName,
  );
  await expect(ownerContextHeader.locator(".weeek-icon-chevron")).toHaveCount(
    0,
  );
  await expect(sidebar.locator(".site-context-switcher")).toHaveCount(0);
  await ownerContext.close();
});

test("content managers see site content while code visibility follows the separate permission", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAsAdmin(adminPage);
  const usersResponse = await adminContext.request.get("/api/platform/users");
  expect(usersResponse.ok(), await usersResponse.text()).toBe(true);
  const users = (await usersResponse.json()) as Array<{
    id: string;
    email: string;
    platformRole: string;
    siteAccesses: Array<{ siteId: string; siteName: string }>;
  }>;
  const contentManager = users.find(
    (user) => user.email === "content.luminava@local.test",
  );
  const codeManager = users.find(
    (user) => user.email === "developer.luminava@local.test",
  );
  expect(contentManager).toBeTruthy();
  expect(codeManager).toBeTruthy();
  await adminContext.close();

  for (const [account, canSeeCode] of [
    [contentManager!, false],
    [codeManager!, true],
  ] as const) {
    const context = await browser.newContext();
    await setSessionCookie(context, account);
    const page = await context.newPage();
    await page.goto("/");
    const navigation = page
      .locator("aside.sidebar")
      .getByRole("navigation", {
        name: `Разделы сайта ${account.siteAccesses[0].siteName}`,
      });

    await navigation
      .getByRole("button", { name: "Настройки", exact: true })
      .click();
    await expect(
      navigation.getByRole("group", { name: "Настройки сайта" }).getByRole("button"),
    ).toHaveText(["Общие данные"]);
    await navigation.getByRole("button", { name: "Сайт", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Открыть раздел «Шаблоны и чанки»",
      }),
    ).toHaveCount(canSeeCode ? 1 : 0);
    await context.close();
  }
});
