import assert from "node:assert/strict";
import { siteCapabilities } from "./site-access";

assert.deepEqual(siteCapabilities(true, null), {
  canRead: true,
  canEditContent: true,
  canApprove: true,
  canPublishDirectly: true,
  canViewCode: true,
  canPublishCodeDirectly: true,
  canEditCode: true,
  canManageSettings: true,
  canManageUsers: true,
});

assert.deepEqual(
  siteCapabilities(false, {
    role: "site_owner",
    canEditCode: false,
    requiresApproval: false,
  }),
  {
    canRead: true,
    canEditContent: true,
    canApprove: true,
    canPublishDirectly: true,
    canViewCode: true,
    canPublishCodeDirectly: false,
    canEditCode: false,
    canManageSettings: true,
    canManageUsers: false,
  },
);

assert.deepEqual(
  siteCapabilities(false, {
    role: "content_manager",
    canEditCode: true,
    requiresApproval: true,
  }),
  {
    canRead: true,
    canEditContent: true,
    canApprove: false,
    canPublishDirectly: false,
    canViewCode: true,
    canPublishCodeDirectly: false,
    canEditCode: true,
    canManageSettings: false,
    canManageUsers: false,
  },
);

assert.equal(
  siteCapabilities(false, {
    role: "content_manager",
    canEditCode: false,
    requiresApproval: false,
  }).canPublishDirectly,
  true,
);

assert.equal(siteCapabilities(false, null).canRead, false);
assert.equal(siteCapabilities(false, null).canViewCode, false);
