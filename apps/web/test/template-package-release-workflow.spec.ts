import { expect, test, type Page } from "@playwright/test";

const baseURL = "http://127.0.0.1:3320";
const siteId = "00000000-0000-4000-8000-000000000801";
const secondSiteId = "00000000-0000-4000-8000-000000000803";
const workspaceId = "00000000-0000-4000-8000-000000000802";

test.use({
  baseURL,
  channel: "chrome",
  viewport: { width: 1365, height: 900 },
});

type Role = "wispo_admin" | "site_owner" | "content_manager";

function siteFor(
  id: string,
  name: string,
  slug: string,
  role: Role,
) {
  return {
    id,
    name,
    slug,
    domain: null,
    domainStatus: "not_configured",
    siteType: "media",
    linkedCommercialSiteId: null,
    linkedCommercialSite: null,
    isActive: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    creator: null,
    access:
      role === "wispo_admin"
        ? null
        : { role, requiresApproval: role === "content_manager" },
  };
}

function sessionFor(role: Role, includeSecondSite = false) {
  return {
    user: {
      id: `user-${role}`,
      email: `${role}@local.test`,
      fullName:
        role === "wispo_admin"
          ? "Администратор Wispo"
          : role === "site_owner"
            ? "Владелец Skinova"
            : "Контент-менеджер Skinova",
      platformRole: role === "wispo_admin" ? "wispo_admin" : "user",
    },
    workspaces: [
      {
        id: workspaceId,
        name: "Luminava",
        slug: "luminava",
        canUseContentCenter: true,
        members: [],
        sites: [
          siteFor(siteId, "Skinova", "skinova", role),
          ...(includeSecondSite
            ? [siteFor(secondSiteId, "Second media", "second-media", role)]
            : []),
        ],
      },
    ],
  };
}

function packagePayload(
  targetSiteId: string,
  siteSlug: string,
  packageId: string,
  packageVersion: string,
  previewUrl: string | null,
) {
  return {
  siteId: targetSiteId,
  siteSlug,
  templatePackage: {
    packageId,
    packageVersion,
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    releaseDigest: `sha256:${packageId}-${packageVersion}`,
    artifactDigest: null,
    status: "ready",
    reasons: [],
    previewUrl,
    templates: [
      { kind: "homepage", key: "skinova-home", version: "1" },
    ],
  },
  };
}

const currentPackage = packagePayload(
  siteId,
  "skinova",
  "skinova-frontend",
  "1.4.0",
  "/preview/skinova",
);
const secondCurrentPackage = packagePayload(
  secondSiteId,
  "second-media",
  "second-frontend",
  "2.0.0",
  "/preview/second-media",
);

const candidates = [
  {
    packageId: "skinova-frontend",
    packageVersion: "1.4.0",
    sourceRevision: "0123456789abcdef0123456789abcdef01234567",
    releaseDigest: "sha256:current-release-digest",
    artifactDigest: null,
    status: "registered",
    isCurrent: true,
    previewUrl: "/preview/skinova",
  },
  {
    packageId: "skinova-frontend",
    packageVersion: "1.5.0",
    sourceRevision: "abcdef0123456789abcdef0123456789abcdef01",
    releaseDigest: "sha256:candidate-without-preview",
    artifactDigest: null,
    status: "registered",
    isCurrent: false,
    previewUrl: null,
  },
];

type MockOptions = {
  includeSecondSite?: boolean;
  currentDelayMs?: Partial<Record<string, number>>;
  currentPayloads?: Partial<Record<string, unknown>>;
  candidatesPayloads?: Partial<Record<string, unknown>>;
  currentErrors?: string[];
  candidatesErrors?: string[];
  candidatesGate?: Promise<void>;
};

async function mockCms(page: Page, role: Role, options: MockOptions = {}) {
  const requests: Array<{ method: string; pathname: string }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requests.push({ method: request.method(), pathname });

    let payload: unknown = [];
    if (pathname === "/api/auth/me")
      payload = sessionFor(role, options.includeSecondSite);
    else if (pathname.endsWith("/template-package/current")) {
      const targetSiteId = pathname.split("/")[3];
      const delay = options.currentDelayMs?.[targetSiteId] ?? 0;
      if (delay)
        await new Promise((resolve) => setTimeout(resolve, delay));
      if (options.currentErrors?.includes(targetSiteId)) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "release read unavailable" }),
        });
        return;
      }
      payload =
        options.currentPayloads?.[targetSiteId] ??
        (targetSiteId === secondSiteId
          ? secondCurrentPackage
          : currentPackage);
    } else if (pathname.endsWith("/template-package/candidates")) {
      const targetSiteId = pathname.split("/")[4];
      if (options.candidatesGate) await options.candidatesGate;
      if (options.candidatesErrors?.includes(targetSiteId)) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "candidates unavailable" }),
        });
        return;
      }
      payload = options.candidatesPayloads?.[targetSiteId] ?? candidates;
    }
    else if (pathname.endsWith("/content/pages"))
      payload = [
        {
          id: "homepage-id",
          title: "Главная",
          slug: "home",
          kind: "homepage",
          status: "published",
          systemTemplateKey: "skinova-home",
          systemTemplateVersion: "1",
          bannerSlots: [],
        },
      ];
    else if (pathname.endsWith("/content/articles/settings")) payload = null;
    else if (pathname.endsWith("/content/not-found"))
      payload = { template: { name: "Skinova 404", version: "1" } };
    else if (pathname.endsWith("/content/privacy"))
      payload = {
        displayTemplate: {
          title: "Политика Skinova",
          key: "skinova-privacy",
          version: "1",
        },
      };
    else if (pathname.endsWith("/content/templates"))
      payload = [
        {
          kind: "header",
          key: "skinova-header",
          version: "1",
          name: "Шапка Skinova",
          config: {},
        },
        {
          kind: "footer",
          key: "skinova-footer",
          version: "1",
          name: "Подвал Skinova",
          config: {},
        },
      ];
    else if (pathname.endsWith("/content/layout"))
      payload = {
        headerTemplateKey: "skinova-header",
        headerTemplateVersion: "1",
        footerTemplateKey: "skinova-footer",
        footerTemplateVersion: "1",
        draftRevisionId: null,
      };
    else if (pathname.endsWith("/revisions/current")) payload = null;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
  return requests;
}

async function openTemplates(
  page: Page,
  role: Role,
  options: MockOptions = {},
) {
  const requests = await mockCms(page, role, options);
  await page.goto(`/?site=${siteId}&view=templates`);
  return requests;
}

test("Wispo admin sees current package and compatible read-only candidates", async ({
  page,
}) => {
  const requests = await openTemplates(page, "wispo_admin");

  await expect(
    page.getByRole("heading", { name: "Текущая версия frontend-пакета" }),
  ).toBeVisible();
  await expect(page.getByText("skinova-frontend", { exact: true })).toBeVisible();
  await expect(page.getByText("1.4.0", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Совместимые версии" }),
  ).toBeVisible();
  await expect(page.getByText("1.5.0", { exact: true })).toBeVisible();
  await expect(
    page.getByText(currentPackage.templatePackage.sourceRevision, {
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(
    page.getByText(candidates[1].sourceRevision, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть предпросмотр" })).toHaveAttribute(
    "href",
    "/preview/skinova",
  );
  await expect(
    page.getByRole("link", { name: "Предпросмотр", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Активировать|Откатить/ })).toHaveCount(0);
  expect(
    requests.some(
      ({ pathname }) =>
        pathname === `/api/platform/sites/${siteId}/template-package/candidates`,
    ),
  ).toBe(true);
  expect(
    requests.some(
      ({ method, pathname }) =>
        method !== "GET" && pathname.includes("template-package"),
    ),
  ).toBe(false);
});

test("site owner sees current package but never requests candidates", async ({
  page,
}) => {
  const requests = await openTemplates(page, "site_owner");

  await expect(
    page.getByRole("heading", { name: "Текущая версия frontend-пакета" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Совместимые версии" }),
  ).toHaveCount(0);
  expect(
    requests.some(({ pathname }) => pathname.includes("/platform/sites/")),
  ).toBe(false);
});

test("content manager cannot open Templates and makes no release-read requests", async ({
  page,
}) => {
  const requests = await openTemplates(page, "content_manager");

  await expect(page).toHaveURL(new RegExp(`site=${siteId}.*view=site`));
  await expect(
    page.locator(".media-site-root").getByRole("heading", { name: "Сайт" }),
  ).toBeVisible();
  await expect(page.locator(".app-loading")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await expect(
    page
      .locator("aside.sidebar")
      .getByRole("button", { name: "Шаблоны", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Текущая версия frontend-пакета" }),
  ).toHaveCount(0);
  expect(
    requests.some(({ pathname }) => pathname.includes("template-package")),
  ).toBe(false);
});

test("a delayed response for the previous site never overwrites the selected site", async ({
  page,
}) => {
  const requests = await openTemplates(page, "wispo_admin", {
    includeSecondSite: true,
    currentDelayMs: { [siteId]: 700 },
  });

  await expect(
    page.getByText("Загружаем данные frontend-пакета…"),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        requests.filter(
          ({ pathname }) =>
            pathname === `/api/sites/${siteId}/template-package/current`,
        ).length,
    )
    .toBe(1);

  await page.evaluate((targetSiteId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("site", targetSiteId);
    url.searchParams.set("view", "templates");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, secondSiteId);

  await expect(page.getByText("second-frontend", { exact: true })).toBeVisible();
  await expect(page.getByText("2.0.0", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText("second-frontend", { exact: true })).toBeVisible();
  await expect(page.getByText("skinova-frontend", { exact: true })).toHaveCount(0);
});

test("delayed release read shows loading while the template catalogue remains usable", async ({
  page,
}) => {
  await openTemplates(page, "wispo_admin", {
    currentDelayMs: { [siteId]: 450 },
  });

  await expect(
    page.getByText("Загружаем данные frontend-пакета…"),
  ).toBeVisible();
  await expect(
    page
      .locator(".media-template-manager")
      .getByRole("heading", { name: "Главная" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".media-template-manager")
      .getByRole("button", { name: "Открыть и изменить" })
      .first(),
  ).toBeEnabled();
  await expect(page.getByText("skinova-frontend", { exact: true })).toBeVisible();
});

test("null current package renders an empty state without hiding the catalogue", async ({
  page,
}) => {
  await openTemplates(page, "wispo_admin", {
    currentPayloads: {
      [siteId]: { siteId, siteSlug: "skinova", templatePackage: null },
    },
    candidatesPayloads: { [siteId]: [] },
  });

  await expect(
    page.getByText("Frontend-пакет ещё не зарегистрирован"),
  ).toBeVisible();
  await expect(
    page.getByText("Других совместимых версий пока нет"),
  ).toBeVisible();
  await expect(
    page
      .locator(".media-template-manager")
      .getByRole("heading", { name: "Главная" }),
  ).toBeVisible();
});

test("current release error stays local and the template catalogue remains usable", async ({
  page,
}) => {
  await openTemplates(page, "wispo_admin", { currentErrors: [siteId] });

  await expect(
    page.getByRole("alert").filter({
      hasText: "Не удалось загрузить данные frontend-пакета",
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".media-template-manager")
      .getByRole("button", { name: "Открыть и изменить" })
      .first(),
  ).toBeEnabled();
});

test("candidate error does not discard a successfully loaded current package", async ({
  page,
}) => {
  await openTemplates(page, "wispo_admin", { candidatesErrors: [siteId] });

  await expect(page.getByText("skinova-frontend", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Не удалось загрузить совместимые версии",
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".media-template-manager")
      .getByRole("heading", { name: "Главная" }),
  ).toBeVisible();
});

test("fast current renders while candidates remain independently pending", async ({
  page,
}) => {
  let releaseCandidates!: () => void;
  const candidatesGate = new Promise<void>((resolve) => {
    releaseCandidates = resolve;
  });
  await openTemplates(page, "wispo_admin", { candidatesGate });

  await expect(page.getByText("skinova-frontend", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Загружаем совместимые версии…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Загружаем данные frontend-пакета…", { exact: true }),
  ).toHaveCount(0);

  releaseCandidates();
  await expect(page.getByText("1.5.0", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Загружаем совместимые версии…", { exact: true }),
  ).toHaveCount(0);
});

test("long package identifiers wrap without horizontal overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const longPackageId = `skinova-${"package".repeat(13)}`.slice(0, 100);
  const longPackageVersion = "1".repeat(100);
  await openTemplates(page, "site_owner", {
    currentPayloads: {
      [siteId]: packagePayload(
        siteId,
        "skinova",
        longPackageId,
        longPackageVersion,
        null,
      ),
    },
  });

  await expect(page.getByText(longPackageId, { exact: true })).toBeVisible();
  await expect(page.getByText(longPackageVersion, { exact: true })).toBeVisible();
  const packagePanel = page.locator(".template-package-panel");
  await expect(packagePanel).toBeVisible();
  expect(
    await packagePanel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});
