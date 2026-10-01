import assert from "node:assert/strict";
import {
  capabilityLabels,
  formatSiteSummary,
  managedUserRole,
} from "./team-access-summary";

assert.equal(formatSiteSummary([], true), "Все сайты");
assert.equal(formatSiteSummary([], false), "Не назначены");
assert.equal(formatSiteSummary(["Luminowa"], false), "Luminowa");
assert.equal(
  formatSiteSummary(["Luminowa", "Skinova", "Wispo Media"], false),
  "Luminowa / Skinova / Wispo Media",
);
assert.equal(
  formatSiteSummary(["One", "Two", "Three", "Four"], false),
  "4 сайта",
);
assert.equal(
  formatSiteSummary(["One", "Two", "Three", "Four", "Five"], false),
  "5 сайтов",
);
assert.equal(
  formatSiteSummary(Array.from({ length: 21 }, (_, index) => String(index)), false),
  "21 сайт",
);

assert.deepEqual(
  capabilityLabels({
    administrator: true,
    canEditCode: false,
    requiresApproval: false,
  }),
  ["Полный доступ"],
);
assert.deepEqual(
  capabilityLabels({
    administrator: false,
    canEditCode: true,
    requiresApproval: true,
  }),
  ["Доступ к коду", "Согласование"],
);
assert.deepEqual(
  capabilityLabels({
    administrator: false,
    canEditCode: false,
    requiresApproval: false,
  }),
  [],
);

assert.equal(
  managedUserRole({ platformRole: "wispo_admin", siteAccesses: [] }),
  "wispo_admin",
);
assert.equal(
  managedUserRole({
    platformRole: "employee",
    siteAccesses: [{ role: "site_owner" }],
  }),
  "site_owner",
);
assert.equal(
  managedUserRole({
    platformRole: "employee",
    siteAccesses: [{ role: "content_manager" }],
  }),
  "content_manager",
);
