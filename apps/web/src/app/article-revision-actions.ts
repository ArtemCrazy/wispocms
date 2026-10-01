export type ArticleRevisionCurrent = {
  draft: {
    id: string;
    versionNumber: number;
    snapshot?: Record<string, unknown>;
  } | null;
  approvedRevisionId: string | null;
  publishedRevisionId: string | null;
  reviewState: "draft" | "in_review" | "changes_requested" | "approved";
};

export function legacyBulkAllowed(
  articles: ReadonlyArray<{ draftRevisionId?: string | null }>,
) {
  return articles.every((article) => !article.draftRevisionId);
}

export function revisionActions(
  current: ArticleRevisionCurrent,
  permissions: {
    canEdit: boolean;
    canApprove: boolean;
    canPublishDirectly?: boolean;
  },
) {
  const draftId = current.draft?.id;
  const canPublishDirectly = permissions.canPublishDirectly ?? false;
  return {
    submit:
      permissions.canEdit &&
      !canPublishDirectly &&
      Boolean(draftId) &&
      (current.reviewState === "draft" ||
        current.reviewState === "changes_requested"),
    approve:
      permissions.canApprove &&
      Boolean(draftId) &&
      current.reviewState === "in_review",
    requestChanges:
      permissions.canApprove &&
      Boolean(draftId) &&
      current.reviewState === "in_review",
    publish:
      Boolean(draftId) &&
      current.publishedRevisionId !== draftId &&
      ((canPublishDirectly && current.reviewState === "draft") ||
        ((permissions.canApprove || canPublishDirectly) &&
          current.reviewState === "approved" &&
          current.approvedRevisionId === draftId)),
  };
}
