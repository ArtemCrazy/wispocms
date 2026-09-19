"use client";

import {
  Fragment,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { LoginScreen } from "./login-screen";
import { PlatformView } from "./platform-views";
import { ContentView } from "./content-view";
import { PagesView } from "./pages-view";
import { SiteDirectoryView } from "./site-directories-view";
import { SiteSettingsView } from "./site-settings-view";
import { SiteBannersView } from "./site-banners-view";
import {
  GlobalSearchView,
  type GlobalSearchTarget,
  type SearchTarget,
} from "./global-search";
import { NotificationCenter } from "./notification-center";
import { MediaView } from "./media-view";
import { SiteGlobalsView } from "./site-globals-view";
import { SiteLayoutView } from "./site-layout-view";
import { SiteSeoView } from "./site-seo-view";
import { SiteIntegrationView } from "./site-integration-view";
import { SiteTypePicker } from "./site-type-picker";
import { AllProjectsView } from "./all-projects-view";
import { AuditLogView } from "./audit-log-view";
import { PrivacyPolicyView } from "./privacy-policy-view";
import { NotFoundPageView } from "./not-found-page-view";
import { MediaHomeView } from "./media-home-view";
import { MediaArticlesView } from "./media-articles-view";
import { MediaSiteView } from "./media-site-view";
import { MediaBannerLibraryView } from "./media-banner-library-view";
import { SiteVariablesView } from "./site-variables-view";
import { MediaLayoutView } from "./media-layout-view";
import { MediaTemplatesView } from "./media-templates-view";
import { ContentCenterView } from "./content-center/content-center-view";

type SessionData = {
  user: { id: string; email: string; fullName: string; platformRole: string };
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: string | null;
    members: Array<{
      id: string;
      fullName: string;
      email: string;
      role: string;
    }>;
    sites: Array<{
      id: string;
      name: string;
      slug: string;
      domain: string | null;
      domainStatus: "not_configured" | "pending" | "verified" | "error";
      siteType: "media" | "corporate" | "ecommerce" | "landing";
      linkedCommercialSiteId: string | null;
      linkedCommercialSite: {
        id: string;
        name: string;
        slug: string;
        domain: string | null;
      } | null;
      isActive: boolean;
      createdAt: string;
      creator: {
        id: string;
        fullName: string;
        email: string;
      } | null;
    }>;
  }>;
};

type SessionWorkspace = SessionData["workspaces"][number];

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="nav-icon" aria-hidden="true">
    {children}
  </span>
);

function buildWorkspaceSlug(name: string) {
  const transliteration: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  const base = name
    .trim()
    .toLowerCase()
    .split("")
    .map((character) => transliteration[character] ?? character)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "workspace"}-${Date.now().toString(36)}`;
}

function pluralizeRu(count: number, forms: [string, string, string]) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export default function Home() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    });
    setSession(response.ok ? await response.json() : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active) {
          setSession(payload);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setSession(null);
  }

  if (loading)
    return (
      <div className="app-loading">
        <span>W</span>
        <p>Загружаем рабочее пространство…</p>
      </div>
    );
  if (!session) return <LoginScreen onSuccess={loadSession} />;

  return (
    <Dashboard
      session={session}
      onLogout={logout}
      onSessionRefresh={loadSession}
    />
  );
}

function Dashboard({
  session,
  onLogout,
  onSessionRefresh,
}: {
  session: SessionData;
  onLogout: () => Promise<void>;
  onSessionRefresh: () => Promise<void>;
}) {
  type View =
    | "projects"
    | "all-projects"
    | "global-search"
    | "overview"
    | "workspaces"
    | "team"
    | "audit"
    | "site"
    | "templates"
    | "homepage-template"
    | "homepage"
    | "articles"
    | "categories"
    | "authors"
    | "pages"
    | "privacy-policy"
    | "404"
    | "banners"
    | "header"
    | "footer"
    | "layout"
    | "variables"
    | "media"
    | "content-center"
    | "globals"
    | "seo"
    | "integration"
    | "settings"
    | "history";
  const [activeView, setActiveView] = useState<View>("all-projects");
  const [navigationTarget, setNavigationTarget] = useState<
    (SearchTarget & { requestId: number }) | null
  >(null);
  const navigationSequence = useRef(0);
  const initialNavigationRestored = useRef(false);
  const [, setContentCount] = useState(0);
  const [structurePages, setStructurePages] = useState<
    Array<{
      id: string;
      title: string;
      slug: string;
      kind: "homepage" | "page";
      status: "draft" | "published";
      bannerSlots?: import("./banner-slot").BannerSlotDefinition[];
    }>
  >([]);
  const [bannerLibraryContext, setBannerLibraryContext] = useState<{
    createKey?: number;
    previewRenderer?: string;
  } | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [siteSwitcherOpen, setSiteSwitcherOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPeekOpen, setSidebarPeekOpen] = useState(false);
  const sidebarPeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sidebarCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [workspaceCreateLocation, setWorkspaceCreateLocation] = useState<
    "switcher" | "sidebar" | null
  >(null);
  const [workspaceCreateName, setWorkspaceCreateName] = useState("");
  const [workspaceCreateError, setWorkspaceCreateError] = useState("");
  const [workspaceCreateBusy, setWorkspaceCreateBusy] = useState(false);
  const workspaceCreateRef = useRef<HTMLFormElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement>(null);
  const helpWrapRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (sidebarPeekTimerRef.current)
        clearTimeout(sidebarPeekTimerRef.current);
      if (sidebarCloseTimerRef.current)
        clearTimeout(sidebarCloseTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!workspaceCreateLocation) return;
    const closeOutside = (event: MouseEvent) => {
      if (
        !workspaceCreateBusy &&
        !workspaceCreateRef.current?.contains(event.target as Node)
      ) {
        setWorkspaceCreateLocation(null);
        setWorkspaceCreateName("");
        setWorkspaceCreateError("");
      }
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [workspaceCreateBusy, workspaceCreateLocation]);

  const workspace = session.workspaces.find(
    (item) => item.id === selectedWorkspaceId,
  );
  const site = workspace?.sites.find((item) => item.id === selectedSiteId);
  const isWispoAdmin = session.user.platformRole === "wispo_admin";
  const workspaceRole = workspace?.role;
  const roleLabel = isWispoAdmin ? "Администратор" : "Сотрудник";
  const hasWorkspaceAccess = isWispoAdmin || Boolean(workspaceRole);
  const canEdit = hasWorkspaceAccess;
  const canApprove = hasWorkspaceAccess;
  const canEditPublished = hasWorkspaceAccess;
  const canManageSettings = canEditPublished;

  useEffect(() => {
    function restoreSiteView() {
      const url = new URL(window.location.href);
      const siteId = url.searchParams.get("site");
      const view = url.searchParams.get("view");
      if (view === "content-center") {
        const workspaceId = url.searchParams.get("workspace");
        if (session.workspaces.some((item) => item.id === workspaceId)) {
          setSelectedWorkspaceId(workspaceId);
          setSelectedSiteId(null);
          setActiveView("content-center");
          setNavigationTarget(null);
        }
        return;
      }
      if (!siteId || !view) return;
      const restorableViews: View[] = [
        "site",
        "templates",
        "homepage-template",
        "homepage",
        "articles",
        "pages",
        "privacy-policy",
        "404",
        "header",
        "footer",
        "layout",
        "variables",
        "banners",
        "media",
        "globals",
        "seo",
        "integration",
        "settings",
      ];
      if (!restorableViews.includes(view as View)) return;
      const targetWorkspace = session.workspaces.find((workspaceItem) =>
        workspaceItem.sites.some((siteItem) => siteItem.id === siteId),
      );
      if (!targetWorkspace) return;
      setSelectedWorkspaceId(targetWorkspace.id);
      setSelectedSiteId(siteId);
      setActiveView(view as View);
      setNavigationTarget(null);
      void fetch(`/api/sites/${siteId}/content/pages`, {
        credentials: "include",
      })
        .then((response) => (response.ok ? response.json() : []))
        .then((rows) =>
          setStructurePages(
            (rows as typeof structurePages).map(
              ({ id, title, slug, kind, status, bannerSlots }) => ({
                id,
                title,
                slug,
                kind,
                status,
                bannerSlots,
              }),
            ),
          ),
        )
        .catch(() => undefined);
    }

    if (!initialNavigationRestored.current) {
      initialNavigationRestored.current = true;
      restoreSiteView();
    }
    window.addEventListener("popstate", restoreSiteView);
    return () => window.removeEventListener("popstate", restoreSiteView);
  }, [session.workspaces]);

  function confirmDiscardChanges() {
    if (!hasUnsavedChanges) return true;
    if (
      !window.confirm(
        "Перейти в другой раздел? Несохранённые изменения будут потеряны.",
      )
    )
      return false;
    setHasUnsavedChanges(false);
    return true;
  }

  function navigateTo(view: View, itemId?: string, force = false) {
    if (
      !force &&
      hasUnsavedChanges &&
      (view !== activeView || Boolean(itemId)) &&
      !confirmDiscardChanges()
    )
      return false;
    if (view !== "banners") setBannerLibraryContext(null);
    if (activeView === "content-center" && view !== "content-center") {
      const url = new URL(window.location.href);
      for (const key of ["cc", "ccVersion", "workspace", "view"]) url.searchParams.delete(key);
      window.history.replaceState({}, "", url);
    }
    navigationSequence.current += 1;
    setActiveView(view);
    setNavigationTarget(
      itemId &&
        ["homepage", "articles", "pages", "categories", "authors"].includes(
          view,
        )
        ? {
            view: view as SearchTarget["view"],
            id: itemId,
            requestId: navigationSequence.current,
          }
        : null,
    );
    if (
      typeof window !== "undefined" &&
      selectedSiteId &&
      !force &&
      ![
        "projects",
        "all-projects",
        "global-search",
        "overview",
        "workspaces",
        "team",
        "audit",
        "content-center",
      ].includes(view)
    ) {
      const url = new URL(window.location.href);
      url.searchParams.set("site", selectedSiteId);
      url.searchParams.set("view", view);
      window.history.pushState({}, "", url);
    }
    return true;
  }

  function navigateToArticlesSection(section: "root" | "content") {
    if (!navigateTo("articles")) return;
    const url = new URL(window.location.href);
    if (section === "content") url.searchParams.set("subview", "content");
    else url.searchParams.delete("subview");
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  const initials = session.user.fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const isPlatform = ["overview", "workspaces", "team", "audit"].includes(
    activeView,
  );
  const showsPlatformMenu = isPlatform;
  const isSiteNavigationActive =
    Boolean(selectedSiteId) &&
    !isPlatform &&
    !["projects", "all-projects", "global-search", "content-center"].includes(activeView);
  type SiteMenuItem = {
    id: View;
    icon: string;
    label: string;
    pageId?: string;
    draft?: boolean;
  };
  const corporatePages: SiteMenuItem[] = structurePages
    .filter((page) => page.kind === "page")
    .map((page) => ({
      id: page.slug === "privacy-policy" ? "privacy-policy" : "pages",
      icon: /service|uslug/i.test(page.slug) ? "services" : "page",
      label: page.title,
      pageId: page.id,
      draft: page.status === "draft",
    }));
  const mediaSystemPages: SiteMenuItem[] = [
    {
      slug: "privacy-policy",
      icon: "privacy",
      label: "ПК",
    },
    { slug: "404", icon: "not-found", label: "404" },
    { slug: "thank-you", icon: "thanks", label: "Спасибо" },
    { slug: "capture-form", icon: "capture-form", label: "Форма захвата" },
  ].flatMap((definition) => {
    const page = structurePages.find(
      (item) => item.kind === "page" && item.slug === definition.slug,
    );
    return page
      ? [
          {
            id:
              definition.slug === "privacy-policy"
                ? ("privacy-policy" as View)
                : definition.slug === "404"
                  ? ("404" as View)
                  : ("pages" as View),
            icon: definition.icon,
            label: definition.label,
            pageId: definition.slug === "404" ? undefined : page.id,
            draft: page.status === "draft",
          },
        ]
      : [];
  });
  const hasBannerSlots = structurePages.some(
    (page) => page.kind === "homepage" && Boolean(page.bannerSlots?.length),
  );
  const siteMenus: Record<string, SiteMenuItem[]> = {
    media: [
      { id: "site", icon: "template", label: "Сайт" },
      { id: "homepage", icon: "home", label: "Главная" },
      { id: "articles", icon: "blog", label: "Статьи" },
      ...mediaSystemPages,
      { id: "layout", icon: "header", label: "Шапка и подвал" },
      { id: "banners", icon: "banners", label: "Баннеры" },
      { id: "variables", icon: "company-data", label: "Переменные" },
      { id: "media", icon: "content-center", label: "Медиатека" },
      { id: "globals", icon: "company-data", label: "Общие данные" },
      { id: "seo", icon: "seo", label: "SEO" },
      { id: "integration", icon: "integration", label: "Подключение" },
      { id: "settings", icon: "management", label: "Настройки сайта" },
      { id: "history", icon: "log", label: "История изменений" },
    ],
    corporate: [
      { id: "homepage", icon: "home", label: "Главная" },
      ...corporatePages,
      {
        id: "pages",
        icon: "services",
        label: corporatePages.length ? "Все страницы" : "Страницы и услуги",
      },
      { id: "articles", icon: "blog", label: "Блог" },
      { id: "banners", icon: "banners", label: "Баннеры" },
      { id: "header", icon: "header", label: "Шапка" },
      { id: "footer", icon: "footer", label: "Подвал" },
      { id: "media", icon: "content-center", label: "Медиатека" },
      { id: "globals", icon: "company-data", label: "Данные компании" },
      { id: "seo", icon: "seo", label: "SEO" },
      { id: "integration", icon: "integration", label: "Подключение" },
      { id: "settings", icon: "management", label: "Настройки сайта" },
      { id: "history", icon: "log", label: "История изменений" },
    ],
    landing: [
      { id: "homepage", icon: "home", label: "Структура лендинга" },
      { id: "media", icon: "content-center", label: "Медиатека" },
      { id: "globals", icon: "company-data", label: "Контакты" },
      { id: "seo", icon: "seo", label: "SEO" },
      { id: "integration", icon: "integration", label: "Подключение" },
      { id: "settings", icon: "management", label: "Настройки сайта" },
      { id: "history", icon: "log", label: "История изменений" },
    ],
  };
  siteMenus.ecommerce = siteMenus.corporate;
  const siteMenu = (
    siteMenus[site?.siteType ?? "media"] ?? siteMenus.media
  ).filter(
    (item) =>
      (item.id !== "banners" || hasBannerSlots) &&
      (!["settings", "integration"].includes(item.id) || canManageSettings),
  );
  const siteTopTabs = (
    [
      { id: "homepage", label: "Шаблон", icon: "template" },
      { id: "categories", label: "Категории", icon: "categories" },
      { id: "banners", label: "Баннеры", icon: "banners" },
    ] satisfies Array<{
      id: View;
      label: string;
      icon: "template" | "categories" | "banners";
    }>
  ).filter((item) => item.id !== "banners" || hasBannerSlots);
  const siteSidebarGroups = [
    {
      label: "Сайт",
      items: siteMenu.filter((item) =>
        ["site", "homepage", "articles"].includes(item.id),
      ),
    },
    {
      label: "Шапка и подвал",
      items: siteMenu.filter((item) =>
        ["header", "footer", "layout"].includes(item.id),
      ),
    },
    {
      label:
        site?.siteType === "corporate" || site?.siteType === "ecommerce"
          ? "Страницы"
          : "Технические",
      items: siteMenu.filter(
        (item) =>
          Boolean(item.pageId) ||
          item.id === "404" ||
          (item.id === "pages" &&
            !item.pageId &&
            (site?.siteType === "corporate" || site?.siteType === "ecommerce")),
      ),
    },
  ].filter((group) => group.items.length);
  const siteSidebarUtilities = siteMenu.filter((item) =>
    [
      "banners",
      "variables",
      "media",
      "globals",
      "seo",
      "integration",
      "settings",
      "history",
    ].includes(item.id),
  );
  const defaultHelp = {
    title: "Как работать в Wispo",
    items: [
      [
        "Выберите рабочее пространство",
        "Сначала откройте рабочее пространство клиента.",
      ],
      [
        "Выберите сайт",
        "Затем откройте нужный сайт внутри рабочего пространства.",
      ],
      [
        "Откройте нужный раздел",
        "Структура меню повторяет структуру выбранного сайта.",
      ],
    ],
  };
  const helpGuides: Partial<
    Record<View, { title: string; items: string[][] }>
  > = {
    articles: {
      title: "Работа со статьями",
      items: [
        ["Создайте черновик", "Заполните заголовок, текст, автора и рубрику."],
        [
          "Отправьте на согласование",
          "После сохранения передайте материал следующему участнику процесса.",
        ],
        [
          "Опубликуйте",
          canApprove
            ? "Проверьте материал и опубликуйте его на сайте."
            : "Публикацию завершит пользователь с правом согласования.",
        ],
      ],
    },
    homepage: {
      title: "Главная страница",
      items: [
        ["Заполните шаблон", "Отредактируйте доступные поля главной страницы."],
        ["Настройте баннеры", "Баннеры главной находятся ниже полей страницы."],
        ["Откройте предпросмотр", "Проверьте страницу перед публикацией."],
      ],
    },
    pages: {
      title: "Системная страница",
      items: [
        ["Заполните содержимое", "Отредактируйте поля системного шаблона."],
        ["Проверьте SEO", "При необходимости заполните поисковые настройки."],
        ["Опубликуйте", "После проверки страница станет доступна на сайте."],
      ],
    },
    "privacy-policy": {
      title: "Политика конфиденциальности",
      items: [
        [
          "Заполните данные",
          "Укажите реквизиты компании и фактические сценарии сайта.",
        ],
        [
          "Сформируйте документ",
          "CMS соберёт snapshot из выбранной юридической модели.",
        ],
        [
          "Следите за актуальностью",
          "После изменения исходных данных документ потребует внимания.",
        ],
      ],
    },
    media: {
      title: "Работа с медиа",
      items: [
        [
          "Загрузите изображение",
          "Перетащите файл или выберите его на компьютере.",
        ],
        [
          "Добавьте alt-описание",
          "Опишите смысл изображения для доступности и SEO.",
        ],
        [
          "Используйте в контенте",
          "Загруженный файл появится в статьях, страницах и баннерах.",
        ],
      ],
    },
    settings: {
      title: "Настройки сайта",
      items: [
        [
          "Проверьте основные данные",
          "Название и домен относятся только к этому сайту.",
        ],
        [
          "Укажите почту",
          "На этот адрес будут приходить заявки с публичной формы.",
        ],
        [
          "Сохраните и проверьте",
          "После сохранения можно отправить тестовое письмо.",
        ],
      ],
    },
    integration: {
      title: "Подключение шаблона",
      items: [
        [
          "Возьмите публичный адрес",
          "CMS отдаёт только опубликованные данные.",
        ],
        [
          "Свяжите поля",
          "Шаблон сайта получает JSON и размещает его в верстке.",
        ],
        [
          "Сохраните SSR",
          "Финальный сайт должен отдавать поисковикам готовый HTML.",
        ],
      ],
    },
  };
  const currentHelp = helpGuides[activeView] ?? defaultHelp;

  useEffect(() => {
    if (!site?.id) return;
    let active = true;
    fetch(`/api/sites/${site.id}/content/articles`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => (response.ok ? response.json() : []))
      .then((rows) => {
        if (active) setContentCount(rows.length);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [site?.id]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!profileWrapRef.current?.contains(event.target as Node))
        setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!helpWrapRef.current?.contains(event.target as Node))
        setHelpOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [helpOpen]);

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setPasswordMessage("Новые пароли не совпадают");
      return;
    }
    setChangingPassword(true);
    setPasswordMessage("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(", ")
            : (payload?.message ?? "Не удалось изменить пароль"),
        );
      form.reset();
      setPasswordFormOpen(false);
      setPasswordMessage("Пароль успешно изменён");
    } catch (reason) {
      setPasswordMessage(
        reason instanceof Error ? reason.message : "Не удалось изменить пароль",
      );
    } finally {
      setChangingPassword(false);
    }
  }

  function startWorkspaceCreate(location: "switcher" | "sidebar") {
    setWorkspaceCreateLocation(location);
    setWorkspaceCreateName("");
    setWorkspaceCreateError("");
    if (location === "sidebar") setSwitcherOpen(false);
  }

  function scheduleSidebarPeek() {
    if (!sidebarCollapsed || sidebarPeekOpen || sidebarPeekTimerRef.current)
      return;
    sidebarPeekTimerRef.current = setTimeout(() => {
      sidebarPeekTimerRef.current = null;
      setSidebarPeekOpen(true);
    }, 900);
  }

  function cancelSidebarPeekSchedule() {
    if (!sidebarPeekTimerRef.current) return;
    clearTimeout(sidebarPeekTimerRef.current);
    sidebarPeekTimerRef.current = null;
  }

  function keepSidebarPeekOpen() {
    cancelSidebarPeekSchedule();
    if (sidebarCloseTimerRef.current) {
      clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    if (sidebarCollapsed) setSidebarPeekOpen(true);
  }

  function scheduleSidebarPeekClose() {
    if (!sidebarCollapsed) return;
    if (sidebarCloseTimerRef.current)
      clearTimeout(sidebarCloseTimerRef.current);
    sidebarCloseTimerRef.current = setTimeout(() => {
      sidebarCloseTimerRef.current = null;
      setSidebarPeekOpen(false);
      setSwitcherOpen(false);
      setWorkspaceCreateLocation(null);
    }, 180);
  }

  function toggleSidebar() {
    cancelSidebarPeekSchedule();
    if (sidebarCloseTimerRef.current) {
      clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    setSidebarPeekOpen(false);
    setSwitcherOpen(false);
    setWorkspaceCreateLocation(null);
    setSidebarCollapsed((collapsed) => !collapsed);
  }

  function cancelWorkspaceCreate() {
    if (workspaceCreateBusy) return;
    setWorkspaceCreateLocation(null);
    setWorkspaceCreateName("");
    setWorkspaceCreateError("");
  }

  async function createWorkspaceInline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceCreateName.trim();
    if (name.length < 2) {
      setWorkspaceCreateError("Введите минимум 2 символа");
      return;
    }
    setWorkspaceCreateBusy(true);
    setWorkspaceCreateError("");
    try {
      const response = await fetch("/api/platform/workspaces", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug: buildWorkspaceSlug(name) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(", ")
            : (payload?.message ?? "Не удалось создать рабочее пространство"),
        );
      }
      await onSessionRefresh();
      setSelectedWorkspaceId(payload.id);
      setSelectedSiteId(null);
      setWorkspaceCreateLocation(null);
      setWorkspaceCreateName("");
      setSwitcherOpen(false);
      navigateTo("projects", undefined, true);
    } catch (reason) {
      setWorkspaceCreateError(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать рабочее пространство",
      );
    } finally {
      setWorkspaceCreateBusy(false);
    }
  }

  function renderWorkspaceCreate(location: "switcher" | "sidebar") {
    if (workspaceCreateLocation !== location) return null;
    return (
      <form
        ref={workspaceCreateRef}
        className={`workspace-quick-create workspace-quick-create-${location}`}
        onSubmit={createWorkspaceInline}
      >
        <span className="weeek-icon weeek-icon-projects" aria-hidden="true" />
        <input
          autoFocus
          aria-label="Название рабочего пространства"
          disabled={workspaceCreateBusy}
          maxLength={160}
          minLength={2}
          onChange={(event) => {
            setWorkspaceCreateName(event.target.value);
            if (workspaceCreateError) setWorkspaceCreateError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelWorkspaceCreate();
          }}
          placeholder="Название пространства"
          title={workspaceCreateError || "Введите название и нажмите Enter"}
          value={workspaceCreateName}
        />
        <button
          type="submit"
          aria-label="Создать пространство"
          disabled={
            workspaceCreateBusy || workspaceCreateName.trim().length < 2
          }
          title="Создать"
        >
          {workspaceCreateBusy ? "…" : "✓"}
        </button>
        <button
          type="button"
          aria-label="Отменить создание"
          disabled={workspaceCreateBusy}
          onClick={cancelWorkspaceCreate}
          title="Отмена"
        >
          ×
        </button>
        {workspaceCreateError ? (
          <small role="alert">{workspaceCreateError}</small>
        ) : null}
      </form>
    );
  }

  function openProject(workspaceId: string) {
    if (
      (workspaceId !== selectedWorkspaceId || selectedSiteId !== null || activeView !== "projects") &&
      hasUnsavedChanges &&
      !confirmDiscardChanges()
    )
      return;
    setContentCount(0);
    setStructurePages([]);
    setSelectedWorkspaceId(workspaceId);
    setSelectedSiteId(null);
    setSwitcherOpen(false);
    setSiteSwitcherOpen(false);
    navigateTo("projects", undefined, true);
  }

  function openSite(siteId: string) {
    if (
      siteId !== selectedSiteId &&
      hasUnsavedChanges &&
      !confirmDiscardChanges()
    )
      return;
    setContentCount(0);
    setStructurePages([]);
    const targetWorkspace = session.workspaces.find((workspaceItem) =>
      workspaceItem.sites.some((siteItem) => siteItem.id === siteId),
    );
    const targetSite = targetWorkspace?.sites.find(
      (item) => item.id === siteId,
    );
    const initialView: View =
      targetSite?.siteType === "media" ? "site" : "homepage";
    if (targetWorkspace) setSelectedWorkspaceId(targetWorkspace.id);
    setSelectedSiteId(siteId);
    setSwitcherOpen(false);
    setSiteSwitcherOpen(false);
    navigateTo(initialView, undefined, true);
    const url = new URL(window.location.href);
    url.searchParams.set("site", siteId);
    url.searchParams.set("view", initialView);
    window.history.pushState({}, "", url);
  }

  function openContentCenter(workspaceId: string) {
    if (hasUnsavedChanges && !confirmDiscardChanges()) return;
    setSelectedWorkspaceId(workspaceId);
    setSelectedSiteId(null);
    setStructurePages([]);
    navigateTo("content-center", undefined, true);
    const url = new URL(window.location.href);
    for (const key of ["site", "subview", "cc", "ccVersion"]) url.searchParams.delete(key);
    url.searchParams.set("workspace", workspaceId);
    url.searchParams.set("view", "content-center");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function showAllProjects() {
    if (hasUnsavedChanges && !confirmDiscardChanges()) return;
    setContentCount(0);
    setStructurePages([]);
    setSelectedWorkspaceId(null);
    setSelectedSiteId(null);
    setSwitcherOpen(false);
    setSiteSwitcherOpen(false);
    navigateTo("projects", undefined, true);
  }

  function showAllSites() {
    if (hasUnsavedChanges && !confirmDiscardChanges()) return;
    setContentCount(0);
    setStructurePages([]);
    setSelectedSiteId(null);
    setSwitcherOpen(false);
    setSiteSwitcherOpen(false);
    navigateTo("all-projects", undefined, true);
  }

  function openGlobalSearchResult(target: GlobalSearchTarget) {
    if (hasUnsavedChanges && !confirmDiscardChanges()) return;
    setContentCount(0);
    setStructurePages([]);
    setSelectedWorkspaceId(target.workspaceId);
    setSelectedSiteId(target.siteId);
    setSwitcherOpen(false);
    if (target.view === "categories" || target.view === "authors") {
      navigationSequence.current += 1;
      setActiveView("articles");
      setNavigationTarget({
        view: target.view,
        id: target.id,
        requestId: navigationSequence.current,
      });
      return;
    }
    navigateTo(target.view, target.id, true);
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {sidebarCollapsed ? (
        <div
          className="sidebar-hover-rail"
          onMouseEnter={scheduleSidebarPeek}
          onMouseLeave={cancelSidebarPeekSchedule}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={`sidebar ${sidebarPeekOpen ? "sidebar-peek-open" : ""}`}
        onMouseEnter={keepSidebarPeekOpen}
        onMouseLeave={scheduleSidebarPeekClose}
      >
        <div className="sidebar-topbar">
          <div className="workspace-switcher-wrap">
            <button
              className="workspace-switcher"
              aria-expanded={switcherOpen}
              aria-haspopup="menu"
              onClick={() => {
                setSiteSwitcherOpen(false);
                setSwitcherOpen((open) => !open);
              }}
            >
              <span className="workspace-logo">
                {workspace?.name.slice(0, 1).toUpperCase() ?? "W"}
              </span>
              <span className="workspace-switcher-copy">
                <strong>{workspace?.name ?? "Wispo"}</strong>
              </span>
              <span
                className={`weeek-icon weeek-icon-chevron chevron ${switcherOpen ? "open" : ""}`}
                aria-hidden="true"
              />
            </button>
            {switcherOpen ? (
              <div className="site-switcher-menu" aria-label="Пространства">
                <div className="workspace-menu-current">
                  <span className="workspace-menu-logo">
                    {workspace?.name.slice(0, 1).toUpperCase() ?? "W"}
                  </span>
                  <span>
                    <strong>{workspace?.name ?? "Wispo"}</strong>
                    <small>
                      {roleLabel}
                      {workspace ? ` • ${workspace.sites.length} сайтов` : ""}
                    </small>
                  </span>
                </div>
                <div className="workspace-menu-actions">
                  <button
                    onClick={() => {
                      setSwitcherOpen(false);
                      if (isWispoAdmin) navigateTo("workspaces");
                      else showAllProjects();
                    }}
                  >
                    <span
                      className="weeek-icon weeek-icon-settings"
                      aria-hidden="true"
                    />
                    Настройки
                  </button>
                  {isWispoAdmin ? (
                    <button
                      onClick={() => {
                        setSwitcherOpen(false);
                        navigateTo("team");
                      }}
                    >
                      <span
                        className="weeek-icon weeek-icon-invite"
                        aria-hidden="true"
                      />
                      Пригласить
                    </button>
                  ) : null}
                </div>
                {session.workspaces.length > 1 ? (
                  <div className="site-switcher-list">
                    {session.workspaces.map((workspaceItem) => (
                      <section key={workspaceItem.id}>
                        <button
                          aria-current={
                            workspaceItem.id === workspace?.id
                              ? "true"
                              : undefined
                          }
                          onClick={() => openProject(workspaceItem.id)}
                        >
                          <i>{workspaceItem.name.slice(0, 1).toUpperCase()}</i>
                          <span>
                            <strong>{workspaceItem.name}</strong>
                            <small>{workspaceItem.sites.length} сайтов</small>
                          </span>
                          {workspaceItem.id === workspace?.id ? <b>✓</b> : null}
                        </button>
                      </section>
                    ))}
                  </div>
                ) : null}
                {isWispoAdmin ? (
                  workspaceCreateLocation === "switcher" ? (
                    renderWorkspaceCreate("switcher")
                  ) : (
                    <button
                      className="manage-sites-link"
                      onClick={() => startWorkspaceCreate("switcher")}
                    >
                      Новое пространство
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            className={`sidebar-tool-button ${activeView === "global-search" ? "active" : ""}`}
            aria-label="Глобальный поиск"
            title="Глобальный поиск"
            onClick={() => navigateTo("global-search")}
          >
            <span className="weeek-icon weeek-icon-search" aria-hidden="true" />
          </button>
          {site ? (
            <NotificationCenter
              key={`sidebar-notifications-${site.id}`}
              siteId={site.id}
              variant="sidebar"
              onNavigate={(articleId) => navigateTo("articles", articleId)}
            />
          ) : (
            <button
              className="sidebar-tool-button"
              aria-label="Уведомления"
              title="Сначала выберите сайт"
              disabled
            >
              <span
                className="weeek-icon weeek-icon-notifications"
                aria-hidden="true"
              />
            </button>
          )}
          <button
            className="sidebar-tool-button sidebar-toggle-button"
            aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
            title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
            onClick={toggleSidebar}
          >
            <span
              className="weeek-icon weeek-icon-sidebar-toggle"
              aria-hidden="true"
            />
          </button>
        </div>

        <button
          className="sidebar-search"
          onClick={() => navigateTo("global-search")}
        >
          <span className="weeek-icon weeek-icon-search" aria-hidden="true" />
          <span>Поиск…</span>
        </button>

        <nav aria-label="Основная навигация">
          {showsPlatformMenu && isWispoAdmin ? (
            <>
              <p className="nav-label">Управление Wispo</p>
              <button
                title="Обзор платформы"
                className={`nav-item ${activeView === "overview" ? "active" : ""}`}
                onClick={() => navigateTo("overview")}
              >
                <Icon>⌂</Icon>
                <span className="nav-text">Обзор платформы</span>
              </button>
              <button
                title="Рабочие пространства и сайты"
                className={`nav-item ${activeView === "workspaces" ? "active" : ""}`}
                onClick={() => navigateTo("workspaces")}
              >
                <Icon>
                  <span
                    className="weeek-icon weeek-icon-projects"
                    aria-hidden="true"
                  />
                </Icon>
                <span className="nav-text">Рабочие пространства и сайты</span>
              </button>
              <button
                title="Команда и доступы"
                className={`nav-item ${activeView === "team" ? "active" : ""}`}
                onClick={() => navigateTo("team")}
              >
                <Icon>
                  <span
                    className="weeek-icon weeek-icon-invite"
                    aria-hidden="true"
                  />
                </Icon>
                <span className="nav-text">Команда и доступы</span>
              </button>
              <button
                title="Журнал изменений"
                className={`nav-item ${activeView === "audit" ? "active" : ""}`}
                onClick={() => navigateTo("audit")}
              >
                <Icon>↺</Icon>
                <span className="nav-text">Журнал изменений</span>
              </button>
            </>
          ) : (
            <>
              <button
                title="Все проекты"
                className={`nav-item ${activeView === "all-projects" ? "active" : ""}`}
                onClick={showAllSites}
              >
                <Icon>
                  <span
                    className="weeek-icon weeek-icon-projects"
                    aria-hidden="true"
                  />
                </Icon>
                <span className="nav-text">Все проекты</span>
              </button>
              <div className="nav-label-row">
                <p className="nav-label">Рабочие пространства</p>
                {isWispoAdmin ? (
                  <button
                    className="nav-add-button"
                    aria-label="Создать рабочее пространство"
                    title="Создать рабочее пространство"
                    onClick={() => startWorkspaceCreate("sidebar")}
                  >
                    <span
                      className="weeek-icon weeek-icon-add"
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
              </div>
              {renderWorkspaceCreate("sidebar")}
              {session.workspaces.map((workspaceItem) => {
                const expanded = workspaceItem.id === selectedWorkspaceId;
                const selected =
                  expanded && activeView === "projects" && !selectedSiteId;
                return (
                  <section
                    className="workspace-tree-item"
                    key={workspaceItem.id}
                  >
                    <button
                      title={workspaceItem.name}
                      className={`nav-item workspace-tree-workspace ${selected ? "active" : ""}`}
                      aria-expanded={expanded}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => {
                        if (!expanded) openProject(workspaceItem.id);
                        else if (selectedSiteId) openProject(workspaceItem.id);
                        else showAllProjects();
                      }}
                    >
                      <Icon>
                        <span
                          className="weeek-icon weeek-icon-projects"
                          aria-hidden="true"
                        />
                      </Icon>
                      <span className="nav-text">{workspaceItem.name}</span>
                      <span
                        className={`weeek-icon weeek-icon-chevron workspace-tree-chevron ${expanded ? "open" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    <div
                      className={`workspace-site-tree ${expanded ? "expanded" : ""}`}
                      aria-hidden={!expanded}
                    >
                      <div className="workspace-site-tree-inner">
                        {workspaceItem.sites.map((siteItem, index) => (
                          <button
                            key={siteItem.id}
                            className={`nav-item workspace-site-item ${siteItem.id === selectedSiteId && isSiteNavigationActive ? "active" : ""}`}
                            title={siteItem.name}
                            tabIndex={expanded ? 0 : -1}
                            aria-current={
                              siteItem.id === selectedSiteId &&
                              isSiteNavigationActive
                                ? "page"
                                : undefined
                            }
                            onClick={() => openSite(siteItem.id)}
                          >
                            <span
                              className={`workspace-site-mark tone-${(index % 4) + 1}`}
                              aria-hidden="true"
                            >
                              {siteItem.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="nav-text">{siteItem.name}</span>
                          </button>
                        ))}
                        {!workspaceItem.sites.length ? (
                          <p className="workspace-tree-empty">
                            Сайтов пока нет
                          </p>
                        ) : null}
                        <div className="workspace-tools-divider" aria-hidden="true" />
                        <button
                          className={`nav-item workspace-site-item ${expanded && activeView === "content-center" ? "active" : ""}`}
                          tabIndex={expanded ? 0 : -1}
                          aria-current={expanded && activeView === "content-center" ? "page" : undefined}
                          onClick={() => openContentCenter(workspaceItem.id)}
                        >
                          <span className="site-system-icon content-center" aria-hidden="true" />
                          <span className="nav-text">Контент-центр</span>
                        </button>
                      </div>
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </nav>

        <div className="sidebar-lower-actions">
          {isWispoAdmin ? (
            <button
              className={activeView === "team" ? "active" : ""}
              onClick={() => navigateTo("team")}
            >
              <span
                className="weeek-icon weeek-icon-invite"
                aria-hidden="true"
              />
              Команда и доступы
            </button>
          ) : null}
        </div>

        <div className="profile-wrap" ref={profileWrapRef}>
          <div className="profile-card">
            <div className="avatar" title={session.user.fullName}>
              {initials}
            </div>
            <span className="profile-summary">
              <strong>{session.user.fullName}</strong>
              <small>{session.user.email}</small>
            </span>
            <button
              className="profile-menu-button"
              aria-label="Открыть профиль"
              title="Профиль"
              aria-expanded={profileOpen}
              onClick={() => {
                setProfileOpen((open) => !open);
                setPasswordFormOpen(false);
                setPasswordMessage("");
              }}
            >
              •••
            </button>
          </div>
          {profileOpen ? (
            <aside className="profile-popover">
              <header>
                <div className="avatar">{initials}</div>
                <span>
                  <strong>{session.user.fullName}</strong>
                  <small>{session.user.email}</small>
                </span>
              </header>
              <p>{roleLabel}</p>
              {passwordMessage ? (
                <div className="profile-message" role="status">
                  {passwordMessage}
                </div>
              ) : null}
              {passwordFormOpen ? (
                <form onSubmit={changePassword}>
                  <label>
                    <span>Текущий пароль</span>
                    <input
                      name="currentPassword"
                      type="password"
                      minLength={8}
                      maxLength={128}
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    <span>Новый пароль</span>
                    <input
                      name="newPassword"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    <span>Повторите новый пароль</span>
                    <input
                      name="confirmation"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <footer>
                    <button disabled={changingPassword}>
                      {changingPassword ? "Сохраняем…" : "Сменить пароль"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setPasswordFormOpen(false);
                        setPasswordMessage("");
                      }}
                    >
                      Отмена
                    </button>
                  </footer>
                </form>
              ) : (
                <div className="profile-actions">
                  <button onClick={() => setPasswordFormOpen(true)}>
                    Сменить пароль
                  </button>
                  <button
                    className="logout"
                    onClick={() => {
                      if (confirmDiscardChanges()) void onLogout();
                    }}
                  >
                    Выйти из аккаунта
                  </button>
                </div>
              )}
            </aside>
          ) : null}
        </div>
      </aside>

      <main
        className={`content ${activeView === "global-search" ? "global-search-mode" : ""} ${site && isSiteNavigationActive ? "site-content-active" : ""}`}
        id="content"
      >
        {site && isSiteNavigationActive ? (
          <aside className="site-secondary-sidebar">
            <div className="site-secondary-switcher-wrap">
              <button
                type="button"
                className="site-secondary-switcher"
                aria-haspopup="menu"
                aria-expanded={siteSwitcherOpen}
                onClick={() => {
                  setSwitcherOpen(false);
                  setSiteSwitcherOpen((open) => !open);
                }}
              >
                <span>
                  <strong>{site.name}</strong>
                  <small>{workspace?.name ?? "Рабочее пространство"}</small>
                </span>
                <i
                  className={`weeek-icon weeek-icon-chevron ${siteSwitcherOpen ? "open" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {siteSwitcherOpen && workspace ? (
                <div className="site-secondary-switcher-menu">
                  {workspace.sites.map((siteItem) => (
                    <button
                      type="button"
                      key={siteItem.id}
                      aria-current={
                        siteItem.id === site.id ? "page" : undefined
                      }
                      onClick={() => openSite(siteItem.id)}
                    >
                      <span>{siteItem.name.slice(0, 1).toUpperCase()}</span>
                      <i>
                        <strong>{siteItem.name}</strong>
                        <small>{siteItem.domain || siteItem.slug}</small>
                      </i>
                      {siteItem.id === site.id ? <b>✓</b> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <nav aria-label={`Разделы сайта ${site.name}`}>
              {siteSidebarGroups.map((group) => (
                <div className="site-nav-group" key={group.label}>
                  <p className="nav-label">{group.label}</p>
                  {group.items.map((item) => {
                    const selectedPageId =
                      navigationTarget?.view === "pages"
                        ? navigationTarget.id
                        : undefined;
                    const active =
                      activeView === item.id &&
                      (item.pageId
                        ? selectedPageId === item.pageId
                        : item.id !== "pages" || !selectedPageId);
                    return (
                      <Fragment key={item.pageId ?? item.id}>
                        <button
                          type="button"
                          title={item.label}
                          className={`nav-item site-nav-item ${active ? "active" : ""}`}
                          aria-current={active ? "page" : undefined}
                          onClick={() =>
                            item.id === "articles" && site.siteType === "media"
                              ? navigateToArticlesSection("root")
                              : navigateTo(item.id, item.pageId)
                          }
                        >
                          <Icon>
                            <span
                              className={`site-system-icon ${item.icon}`}
                              aria-hidden="true"
                            />
                          </Icon>
                          <span className="nav-text">{item.label}</span>
                        </button>
                        {item.id === "articles" && site.siteType === "media" ? (
                          <button
                            type="button"
                            className="nav-item site-nav-item"
                            onClick={() => navigateToArticlesSection("content")}
                          >
                            <Icon>
                              <span aria-hidden="true">↳</span>
                            </Icon>
                            <span className="nav-text">Контент</span>
                          </button>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              ))}
              <div className="site-nav-utilities">
                {siteSidebarUtilities.map((item) => {
                  const active = activeView === item.id;
                  const label =
                    item.id === "media"
                      ? "Медиатека"
                      : item.id === "settings"
                        ? "Управление"
                        : item.label;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={label}
                      className={`nav-item site-nav-item ${active ? "active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => navigateTo(item.id)}
                    >
                      <Icon>
                        <span
                          className={`site-system-icon ${item.icon}`}
                          aria-hidden="true"
                        />
                      </Icon>
                      <span className="nav-text">{label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          </aside>
        ) : null}
        {activeView !== "global-search" &&
        activeView !== "privacy-policy" &&
        activeView !== "404" &&
        !isPlatform &&
        site &&
        site.siteType !== "media" ? (
          <header className="site-tabs-bar">
            <div
              className="site-tabs-list"
              role="tablist"
              aria-label="Разделы сайта"
            >
              {siteTopTabs.map((item) => {
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`site-tab ${active ? "active" : ""}`}
                    title={item.label}
                    onClick={() => navigateTo(item.id)}
                  >
                    <i
                      className={`site-system-icon ${item.icon}`}
                      aria-hidden="true"
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </header>
        ) : null}
        {activeView !== "global-search" &&
        activeView !== "all-projects" &&
        activeView !== "projects" &&
        !(site && isSiteNavigationActive) ? (
          <header className="topbar topbar-actions-only">
            <div className="top-actions">
              {!isPlatform && site ? (
                <a
                  className="preview-site-button"
                  href={`/preview/${site.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Открыть сайт</span> ↗
                </a>
              ) : null}
              <div className="help-wrap" ref={helpWrapRef}>
                <button
                  className="help-button"
                  aria-label="Помощь"
                  aria-expanded={helpOpen}
                  onClick={() => setHelpOpen((open) => !open)}
                >
                  ?
                </button>
                {helpOpen ? (
                  <aside className="help-popover">
                    <header>
                      <div>
                        <small>БЫСТРЫЙ СТАРТ</small>
                        <strong>{currentHelp.title}</strong>
                      </div>
                      <button
                        aria-label="Закрыть справку"
                        onClick={() => setHelpOpen(false)}
                      >
                        ×
                      </button>
                    </header>
                    <ol>
                      {currentHelp.items.map(([title, description], index) => (
                        <li key={title}>
                          <b>{index + 1}</b>
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                        </li>
                      ))}
                    </ol>
                    {!isPlatform && site ? (
                      <div className="help-quick-links">
                        <span>Быстрые переходы</span>
                        <div>
                          <button
                            onClick={() => {
                              navigateTo("articles");
                              setHelpOpen(false);
                            }}
                          >
                            Статьи
                          </button>
                          <button
                            onClick={() => {
                              navigateTo("media");
                              setHelpOpen(false);
                            }}
                          >
                            Медиатека
                          </button>
                          <a
                            href={`/preview/${site.slug}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Открыть сайт ↗
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </aside>
                ) : null}
              </div>
            </div>
          </header>
        ) : null}

        {activeView === "global-search" ? (
          <GlobalSearchView
            workspaces={session.workspaces}
            onNavigate={openGlobalSearchResult}
          />
        ) : activeView === "all-projects" ? (
          <AllProjectsView
            workspaces={session.workspaces}
            onOpenSite={openSite}
            canManageProjects={isWispoAdmin}
            onChanged={async (siteUpdate) => {
              await onSessionRefresh();
              if (siteUpdate?.id === selectedSiteId)
                setStructurePages(siteUpdate.pages);
            }}
          />
        ) : activeView === "projects" ? (
          <ProjectSelectionView
            key={selectedWorkspaceId ?? "all-projects"}
            workspaces={session.workspaces}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelectProject={openProject}
            onSelectSite={openSite}
            onChanged={onSessionRefresh}
            canCreateSite={hasWorkspaceAccess}
          />
        ) : activeView === "content-center" && workspace ? (
          <ContentCenterView
            key={workspace.id}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "articles" ? (
          site?.siteType === "media" ? (
            <MediaArticlesView
              siteId={site.id}
              siteName={site.name}
              siteSlug={site.slug}
              canEdit={canEdit}
              canApprove={canApprove}
              canEditPublished={canEditPublished}
              onCountChange={setContentCount}
              openArticleId={
                navigationTarget?.view === "articles"
                  ? navigationTarget.id
                  : undefined
              }
              openCategoryId={
                navigationTarget?.view === "categories"
                  ? navigationTarget.id
                  : undefined
              }
              openAuthorId={
                navigationTarget?.view === "authors"
                  ? navigationTarget.id
                  : undefined
              }
              openRequestId={navigationTarget?.requestId}
              onDirtyChange={setHasUnsavedChanges}
            />
          ) : (
            <ContentView
              siteId={site?.id}
              siteName={site?.name}
              siteSlug={site?.slug}
              canEdit={canEdit}
              canApprove={canApprove}
              canEditPublished={canEditPublished}
              onCountChange={setContentCount}
              openArticleId={
                navigationTarget?.view === "articles"
                  ? navigationTarget.id
                  : undefined
              }
              openCategoryId={
                navigationTarget?.view === "categories"
                  ? navigationTarget.id
                  : undefined
              }
              openAuthorId={
                navigationTarget?.view === "authors"
                  ? navigationTarget.id
                  : undefined
              }
              openRequestId={navigationTarget?.requestId}
              onDirtyChange={setHasUnsavedChanges}
            />
          )
        ) : activeView === "privacy-policy" ? (
          <PrivacyPolicyView
            siteId={site?.id}
            siteName={site?.name}
            canEdit={canEdit}
            canApprove={canApprove}
            canManageLegalModels={isWispoAdmin}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "404" ? (
          <NotFoundPageView
            siteId={site?.id}
            canEdit={canEdit}
            canApprove={canApprove}
          />
        ) : activeView === "site" && site?.siteType === "media" ? (
          <MediaSiteView
            siteName={site.name}
            showBanners={hasBannerSlots}
            onOpen={(target) => navigateTo(target)}
          />
        ) : activeView === "templates" && site?.siteType === "media" ? (
          <MediaTemplatesView
            siteId={site.id}
            canEdit={canEdit}
            onOpen={(target) => navigateTo(target)}
          />
        ) : activeView === "homepage-template" && site?.siteType === "media" ? (
          <PagesView
            siteId={site.id}
            siteName={site.name}
            siteSlug={site.slug}
            canEdit={canEdit}
            canApprove={canApprove}
            canEditPublished={canEditPublished}
            mode="homepage"
            onDirtyChange={setHasUnsavedChanges}
            onPagesChange={setStructurePages}
            siteType="media"
          />
        ) : activeView === "homepage" || activeView === "pages" ? (
          site?.siteType === "media" && activeView === "homepage" ? (
            <MediaHomeView
              siteId={site.id}
              siteName={site.name}
              siteSlug={site.slug}
              canEdit={canEdit}
              canApprove={canApprove}
              canEditPublished={canEditPublished}
              onDirtyChange={setHasUnsavedChanges}
              onPagesChange={setStructurePages}
              hasBannerSlots={hasBannerSlots}
              onOpenBanners={(options) => {
                setBannerLibraryContext({
                  createKey: options?.create ? Date.now() : undefined,
                  previewRenderer: options?.previewRenderer,
                });
                navigateTo("banners");
              }}
            />
          ) : (
            <PagesView
              siteId={site?.id}
              siteName={site?.name}
              siteSlug={site?.slug}
              canEdit={canEdit}
              canApprove={canApprove}
              canEditPublished={canEditPublished}
              mode={activeView}
              openPageId={
                navigationTarget?.view === activeView
                  ? navigationTarget.id
                  : undefined
              }
              openRequestId={navigationTarget?.requestId}
              onDirtyChange={setHasUnsavedChanges}
              onPagesChange={setStructurePages}
              siteType={site?.siteType}
            />
          )
        ) : activeView === "categories" || activeView === "authors" ? (
          <SiteDirectoryView
            siteId={site?.id}
            siteName={site?.name}
            canEdit={canEdit}
            mode={activeView}
            focusId={
              navigationTarget?.view === activeView
                ? navigationTarget.id
                : undefined
            }
            focusRequestId={navigationTarget?.requestId}
          />
        ) : activeView === "banners" ? (
          !hasBannerSlots ? null : site?.siteType === "media" ? (
            <MediaBannerLibraryView
              siteId={site.id}
              siteName={site.name}
              canEdit={canEdit}
              createOnOpenKey={bannerLibraryContext?.createKey}
              initialPreviewRenderer={bannerLibraryContext?.previewRenderer}
              onBackToAssignments={
                bannerLibraryContext
                  ? () => {
                      setBannerLibraryContext(null);
                      navigateTo("homepage");
                    }
                  : undefined
              }
            />
          ) : (
            <SiteBannersView
              siteId={site?.id}
              siteName={site?.name}
              canEdit={canEdit}
            />
          )
        ) : activeView === "variables" && site?.siteType === "media" ? (
          <SiteVariablesView
            siteId={site.id}
            siteName={site.name}
            canEdit={canEdit}
          />
        ) : activeView === "layout" && site?.siteType === "media" ? (
          <MediaLayoutView
            siteId={site.id}
            siteName={site.name}
            siteSlug={site.slug}
            canEdit={canEdit}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "header" || activeView === "footer" ? (
          <SiteLayoutView
            siteId={site?.id}
            siteName={site?.name}
            mode={activeView}
            canEdit={canEdit}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "media" ? (
          <MediaView
            siteId={site?.id}
            siteName={site?.name}
            workspaceName={workspace?.name}
            canEdit={canEdit}
          />
        ) : activeView === "globals" ? (
          <SiteGlobalsView
            siteId={site?.id}
            siteName={site?.name}
            canEdit={canEdit}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "seo" ? (
          <SiteSeoView
            siteId={site?.id}
            siteName={site?.name}
            siteSlug={site?.slug}
            canEdit={canEdit}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "integration" && canManageSettings ? (
          <SiteIntegrationView
            siteName={site?.name}
            siteSlug={site?.slug}
            siteType={site?.siteType}
          />
        ) : activeView === "settings" && canManageSettings ? (
          <SiteSettingsView
            siteId={site?.id}
            siteName={site?.name}
            onSaved={onSessionRefresh}
            onDirtyChange={setHasUnsavedChanges}
          />
        ) : activeView === "history" && site ? (
          <AuditLogView siteId={site.id} />
        ) : isWispoAdmin && isPlatform ? (
          <PlatformView
            view={activeView as "overview" | "workspaces" | "team" | "audit"}
            currentUserId={session.user.id}
            onChanged={onSessionRefresh}
          />
        ) : null}
      </main>
    </div>
  );
}

function ProjectSelectionView({
  workspaces,
  selectedWorkspaceId,
  onSelectProject,
  onSelectSite,
  onChanged,
  canCreateSite,
}: {
  workspaces: SessionWorkspace[];
  selectedWorkspaceId: string | null;
  onSelectProject: (workspaceId: string) => void;
  onSelectSite: (siteId: string) => void;
  onChanged: () => Promise<void>;
  canCreateSite: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const workspace = workspaces.find((item) => item.id === selectedWorkspaceId);

  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !canCreateSite || saving) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/sites`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          slug: data.get("slug"),
          domain: data.get("domain"),
          siteType: data.get("siteType"),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(", ")
            : (payload?.message ?? "Не удалось добавить сайт"),
        );
      }
      form.reset();
      setCreating(false);
      setMessage("Сайт добавлен в рабочее пространство");
      await onChanged();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось добавить сайт",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!workspace) {
    return (
      <section className="project-entry">
        <header className="project-entry-head">
          <div>
            <small>WISPO</small>
            <h1>Рабочие пространства</h1>
            <p>
              Выберите рабочее пространство, чтобы увидеть его сайты и открыть
              нужную CMS.
            </p>
          </div>
          <span>{workspaces.length} рабочих пространств</span>
        </header>

        {workspaces.length ? (
          <div className="project-entry-grid">
            {workspaces.map((item) => (
              <button
                className="project-entry-card"
                key={item.id}
                onClick={() => onSelectProject(item.id)}
              >
                <i>{item.name.slice(0, 2).toUpperCase()}</i>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.sites.length} сайтов</small>
                </span>
                <b>Открыть →</b>
              </button>
            ))}
          </div>
        ) : (
          <div className="project-entry-empty">
            <strong>Рабочих пространств пока нет</strong>
            <p>Обратитесь к администратору Wispo, чтобы получить доступ.</p>
          </div>
        )}
      </section>
    );
  }

  if (!workspace.sites.length && !creating) {
    return (
      <section className="project-first-site-empty">
        <div className="project-first-site-card">
          <svg
            className="project-first-site-illustration"
            viewBox="0 0 176 126"
            aria-hidden="true"
          >
            <path
              d="M36 77c-14 0-21-8-21-19"
              fill="none"
              stroke="currentColor"
              strokeDasharray="3 5"
              strokeLinecap="round"
            />
            <circle cx="15" cy="53" r="3" fill="none" stroke="currentColor" />
            <path
              d="M141 89c13 0 20-7 20-18"
              fill="none"
              stroke="currentColor"
              strokeDasharray="3 5"
              strokeLinecap="round"
            />
            <circle cx="162" cy="66" r="2.5" fill="currentColor" />
            <rect
              x="40"
              y="24"
              width="96"
              height="76"
              rx="13"
              fill="white"
              stroke="currentColor"
              strokeWidth="6"
            />
            <path d="M43 40h90" stroke="currentColor" strokeWidth="5" />
            <circle cx="52" cy="32" r="2.5" fill="currentColor" />
            <circle cx="61" cy="32" r="2.5" fill="currentColor" opacity=".72" />
            <circle cx="70" cy="32" r="2.5" fill="currentColor" opacity=".45" />
            <rect
              x="52"
              y="51"
              width="72"
              height="37"
              rx="7"
              fill="none"
              stroke="currentColor"
              strokeDasharray="4 4"
            />
            <path
              d="M88 61v17M79.5 69.5h17"
              stroke="#5f4de8"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m143 13 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"
              fill="none"
              stroke="#5f4de8"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          <h1>
            {canCreateSite
              ? "Создайте первый сайт"
              : "В рабочем пространстве пока нет сайтов"}
          </h1>
          <p>
            {canCreateSite
              ? "Выберите тип сайта и задайте основные параметры, чтобы начать работу."
              : "Сайт появится здесь после добавления администратором Wispo."}
          </p>
          {canCreateSite ? (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setMessage("");
              }}
            >
              <span aria-hidden="true">＋</span>
              Добавить сайт
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="project-entry workspace-sites-view">
      <header className="workspace-sites-heading">
        <div>
          <div className="workspace-sites-title-line">
            <h1>{workspace.name}</h1>
            <span>
              {workspace.sites.length}{" "}
              {pluralizeRu(workspace.sites.length, ["сайт", "сайта", "сайтов"])}
            </span>
          </div>
        </div>
        {canCreateSite && !creating ? (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setMessage("");
            }}
          >
            <span aria-hidden="true">＋</span>
            Добавить сайт
          </button>
        ) : null}
      </header>

      {message ? (
        <div className="inline-message project-site-message" role="status">
          {message}
        </div>
      ) : null}

      {canCreateSite && creating ? (
        <div className="project-site-create">
          <div>
            <strong>Новый сайт</strong>
            <small>
              Тип сайта определяет набор разделов, который появится в его CMS.
            </small>
          </div>
          <form
            className="site-form"
            onSubmit={(event) => void createSite(event)}
          >
            <input
              name="name"
              placeholder="Название сайта"
              required
              minLength={2}
              maxLength={160}
            />
            <input
              name="slug"
              placeholder="уникальный-slug"
              title="Системный адрес должен быть уникальным среди всех сайтов Wispo"
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
            <input
              name="domain"
              placeholder="domain.ru (необязательно)"
              maxLength={255}
            />
            <SiteTypePicker />
            <div>
              <button disabled={saving}>
                {saving ? "Добавляем…" : "Добавить сайт"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={saving}
                onClick={() => {
                  setCreating(false);
                  setMessage("");
                }}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="workspace-sites-list">
        <div className="workspace-sites-table-head" aria-hidden="true">
          <span>Сайт</span>
          <span>Тип сайта</span>
          <span>Статус</span>
          <span />
        </div>
        {workspace.sites.map((item, index) => {
          const siteType =
            item.siteType === "media"
              ? "Медиа-сайт"
              : item.siteType === "ecommerce"
                ? "Интернет-магазин"
                : item.siteType === "landing"
                  ? "Лендинг"
                  : "Корпоративный сайт";
          return (
            <button
              type="button"
              className="workspace-site-row"
              key={item.id}
              onClick={() => onSelectSite(item.id)}
            >
              <span className="workspace-site-identity">
                <i className={`tone-${(index % 4) + 1}`} aria-hidden="true">
                  {item.name.slice(0, 1).toUpperCase()}
                </i>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.domain || item.slug}</small>
                </span>
              </span>
              <span className="workspace-site-type">{siteType}</span>
              <span
                className={`project-status ${item.isActive ? "active" : "inactive"}`}
              >
                <i /> {item.isActive ? "Активен" : "Отключён"}
              </span>
              <svg
                className="workspace-site-row-chevron"
                viewBox="0 0 18 18"
                aria-hidden="true"
              >
                <path d="m7 4 5 5-5 5" />
              </svg>
            </button>
          );
        })}
      </div>
    </section>
  );
}
