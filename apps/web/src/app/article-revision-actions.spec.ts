import assert from "node:assert/strict";
import {
  legacyBulkAllowed,
  revisionActions,
  type ArticleRevisionCurrent,
} from "./article-revision-actions";

assert.equal(legacyBulkAllowed([{ draftRevisionId: null }]), true);
assert.equal(
  legacyBulkAllowed([
    { draftRevisionId: null },
    { draftRevisionId: "revision-2" },
  ]),
  false,
);

const base: ArticleRevisionCurrent = {
  draft: { id: "revision-2", versionNumber: 2 },
  approvedRevisionId: null,
  publishedRevisionId: "revision-1",
  reviewState: "draft",
};

assert.deepEqual(revisionActions(base, { canEdit: true, canApprove: false }), {
  submit: true,
  approve: false,
  requestChanges: false,
  publish: false,
});

assert.deepEqual(
  revisionActions(
    { ...base, reviewState: "in_review" },
    { canEdit: true, canApprove: false },
  ),
  { submit: false, approve: false, requestChanges: false, publish: false },
);

assert.deepEqual(
  revisionActions(
    { ...base, reviewState: "in_review" },
    { canEdit: true, canApprove: true },
  ),
  { submit: false, approve: true, requestChanges: true, publish: false },
);

assert.deepEqual(
  revisionActions(
    { ...base, reviewState: "approved", approvedRevisionId: "revision-2" },
    { canEdit: true, canApprove: false },
  ),
  { submit: false, approve: false, requestChanges: false, publish: true },
);

assert.deepEqual(
  revisionActions(
    { ...base, reviewState: "approved", approvedRevisionId: "revision-1" },
    { canEdit: true, canApprove: false },
  ),
  { submit: false, approve: false, requestChanges: false, publish: false },
);

assert.deepEqual(
  revisionActions(
    {
      ...base,
      reviewState: "approved",
      approvedRevisionId: "revision-2",
      publishedRevisionId: "revision-2",
    },
    { canEdit: true, canApprove: false },
  ),
  { submit: false, approve: false, requestChanges: false, publish: false },
);
