export type RevisionReviewState =
  'draft' | 'in_review' | 'changes_requested' | 'approved';

export type RevisionPointers = {
  draftRevisionId: string | null;
  approvedRevisionId: string | null;
  publishedRevisionId: string | null;
  reviewState: RevisionReviewState;
};

export function saveDraftRevision(
  current: RevisionPointers,
  nextRevisionId: string,
  expectedDraftRevisionId: string | null,
): RevisionPointers {
  if (current.draftRevisionId !== expectedDraftRevisionId)
    throw new ConflictException('Черновик уже изменён');
  return {
    draftRevisionId: nextRevisionId,
    approvedRevisionId: null,
    publishedRevisionId: current.publishedRevisionId,
    reviewState: 'draft',
  };
}

export function submitRevision(
  current: RevisionPointers,
  revisionId: string,
): RevisionPointers {
  if (current.draftRevisionId !== revisionId)
    throw new ConflictException('Выбрана неактуальная версия');
  if (!['draft', 'changes_requested'].includes(current.reviewState))
    throw new BadRequestException('Эту версию нельзя отправить на проверку');
  return { ...current, reviewState: 'in_review' };
}

export function approveRevision(
  current: RevisionPointers,
  revisionId: string,
): RevisionPointers {
  if (current.draftRevisionId !== revisionId)
    throw new ConflictException('Выбрана неактуальная версия');
  if (current.reviewState !== 'in_review')
    throw new BadRequestException('Версия не отправлена на проверку');
  return {
    ...current,
    approvedRevisionId: revisionId,
    reviewState: 'approved',
  };
}

export function requestChanges(
  current: RevisionPointers,
  revisionId: string,
  reason: string,
): RevisionPointers {
  if (!reason.trim()) throw new BadRequestException('Укажите причину возврата');
  if (current.draftRevisionId !== revisionId)
    throw new ConflictException('Выбрана неактуальная версия');
  if (current.reviewState !== 'in_review')
    throw new BadRequestException('Версия не отправлена на проверку');
  return {
    ...current,
    approvedRevisionId: null,
    reviewState: 'changes_requested',
  };
}

export function publishRevision(
  current: RevisionPointers,
  revisionId: string,
): RevisionPointers {
  if (
    current.draftRevisionId !== revisionId ||
    current.approvedRevisionId !== revisionId ||
    current.reviewState !== 'approved'
  )
    throw new ConflictException('Публиковать можно только одобренную версию');
  return { ...current, publishedRevisionId: revisionId };
}
import { BadRequestException, ConflictException } from '@nestjs/common';
