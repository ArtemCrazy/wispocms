import assert from "node:assert/strict";
import {
  categoryRevisionApiBase,
  categoryRevisionPreviewPath,
} from "../src/app/category-revision-links.ts";

assert.equal(
  categoryRevisionApiBase("site id", "category/id"),
  "/api/sites/site%20id/content/categories/category%2Fid/revisions",
);

assert.equal(
  categoryRevisionPreviewPath({
    siteSlug: "media site",
    siteId: "site id",
    categoryId: "category/id",
    categorySlug: "draft slug",
    revisionId: "revision/id",
  }),
  "/preview/media%20site/categories/draft%20slug?cmsSiteId=site%20id&cmsCategoryId=category%2Fid&cmsRevisionId=revision%2Fid",
);
