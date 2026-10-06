import assert from "node:assert/strict";
import { siteCapabilities } from "./site-access";

assert.deepEqual(siteCapabilities(true, null), {
  canRead: true,
  canEditContent: true,
  canApprove: true,
  canPublishDirectly: true,
  canManageStructure: true,
  canManageSettings: true,
  canManageUsers: true,
});

assert.deepEqual(
  siteCapabilities(false, {
    role: "site_owner",
    requiresApproval: false,
  }),
  {
    canRead: true,
    canEditContent: true,
    canApprove: true,
    canPublishDirectly: true,
    canManageStructure: true,
    canManageSettings: true,
    canManageUsers: false,
  },
);

assert.deepEqual(
  siteCapabilities(false, {
    role: "content_manager",
    requiresApproval: true,
  }),
  {
    canRead: true,
    canEditContent: true,
    canApprove: false,
    canPublishDirectly: false,
    canManageStructure: false,
    canManageSettings: false,
    canManageUsers: false,
  },
);

assert.equal(
  siteCapabilities(false, {
    role: "content_manager",
    requiresApproval: false,
  }).canPublishDirectly,
  true,
);
assert.equal(siteCapabilities(false, null).canRead, false);
assert.equal(siteCapabilities(false, null).canManageStructure, false);
