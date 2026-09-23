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
  permissions: { canEdit: boolean; canApprove: boolean },
) {
  const draftId = current.draft?.id;
  return {
    submit:
      permissions.canEdit &&
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
      permissions.canEdit &&
      Boolean(draftId) &&
      current.reviewState === "approved" &&
      current.approvedRevisionId === draftId &&
      current.publishedRevisionId !== draftId,
  };
}
