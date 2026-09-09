import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("site creation offers all canonical site types", async () => {
  const picker = await source("../src/app/site-type-picker.tsx");
  for (const value of ["media", "corporate", "ecommerce", "landing"])
    assert.match(picker, new RegExp(`value: "${value}"`));
  assert.match(picker, /title: "Интернет-магазин"/);
});

test("ecommerce is labeled consistently and reuses the corporate page shell", async () => {
  const [projects, platform, settings, integration, shell] = await Promise.all([
    source("../src/app/all-projects-view.tsx"),
    source("../src/app/platform-views.tsx"),
    source("../src/app/site-settings-view.tsx"),
    source("../src/app/site-integration-view.tsx"),
    source("../src/app/page.tsx"),
  ]);

  for (const ui of [projects, platform, settings]) {
    assert.match(ui, /ecommerce: "Интернет-магазин"/);
  }
  assert.match(projects, /<option value="ecommerce">Интернет-магазин<\/option>/);
  assert.match(platform, /<option value="ecommerce">Интернет-магазин<\/option>/);
  assert.match(integration, /ecommerce:/);
  assert.match(shell, /siteMenus\.ecommerce = siteMenus\.corporate/);
});

test("the site shell names the workspace library Content Center", async () => {
  const [page, media] = await Promise.all([
    source("../src/app/page.tsx"),
    source("../src/app/media-view.tsx"),
  ]);
  assert.match(page, /label: "Контентный центр"/);
  assert.match(media, /<h1>Контентный центр<\/h1>/);
  assert.match(media, /Общая библиотека рабочего пространства/);
  assert.match(media, /Источ(?:ник|ный сайт)/);
});

test("settings expose honest DNS state and Media commercial linking", async () => {
  const settings = await source("../src/app/site-settings-view.tsx");
  assert.match(settings, /Связанный коммерческий сайт/);
  assert.match(settings, /<option value="">Не выбран<\/option>/);
  assert.match(settings, /settings\/verify-domain/);
  assert.match(settings, /DNS: \{domainStatusNames/);
});

test("Next proxy fails closed and rewrites only supported public paths", async () => {
  const [proxy, sitemap, robots] = await Promise.all([
    source("../src/proxy.ts"),
    source("../src/app/preview/[siteSlug]/[publicFile]/route.ts"),
    source("../src/app/preview/[siteSlug]/robots.txt/route.ts"),
  ]);
  assert.match(proxy, /resolve-host\?host=/);
  assert.match(proxy, /new NextResponse\("Not found", \{ status: 404 \}\)/);
  assert.match(proxy, /articles\|categories\|pages/);
  assert.match(proxy, /x-wispo-public-host/);
  assert.match(proxy, /cmsHosts\(\)\.has\(host\)/);
  assert.match(proxy, /pathname === "\/sitemap\.xml"/);
  assert.match(sitemap, /export async function GET/);
  assert.match(sitemap, /publicFile !== "sitemap\.xml"/);
  assert.match(robots, /data\.site\.canonicalUrl \|\| fallbackBase/);
  assert.match(robots, /`\$\{publicBase\}\/sitemap\.xml`/);
});
