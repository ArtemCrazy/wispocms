import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  approveRevision,
  publishRevision,
  requestChanges,
  saveDraftRevision,
  submitRevision,
  type RevisionPointers,
} from './revision-workflow';

describe('revision workflow', () => {
  const published: RevisionPointers = {
    draftRevisionId: 'revision-2',
    approvedRevisionId: 'revision-2',
    publishedRevisionId: 'revision-1',
    reviewState: 'approved',
  };

  it('keeps the public revision and revokes approval after another save', () => {
    expect(saveDraftRevision(published, 'revision-3', 'revision-2')).toEqual({
      draftRevisionId: 'revision-3',
      approvedRevisionId: null,
      publishedRevisionId: 'revision-1',
      reviewState: 'draft',
    });
  });

  it('refuses a parallel save against an obsolete draft', () => {
    expect(() =>
      saveDraftRevision(published, 'revision-3', 'revision-1'),
    ).toThrow(ConflictException);
  });

  it('does not publish an older approval after a new draft', () => {
    const next = saveDraftRevision(published, 'revision-3', 'revision-2');
    expect(() => publishRevision(next, 'revision-2')).toThrow(
      ConflictException,
    );
  });

  it('approves only the exact draft submitted for review', () => {
    const review = submitRevision(
      {
        ...published,
        approvedRevisionId: null,
        reviewState: 'draft',
      },
      'revision-2',
    );
    expect(() => approveRevision(review, 'revision-1')).toThrow(
      ConflictException,
    );
    expect(approveRevision(review, 'revision-2')).toEqual({
      draftRevisionId: 'revision-2',
      approvedRevisionId: 'revision-2',
      publishedRevisionId: 'revision-1',
      reviewState: 'approved',
    });
  });

  it('requires a reason to return a version to its author', () => {
    const review = submitRevision(
      {
        ...published,
        approvedRevisionId: null,
        reviewState: 'draft',
      },
      'revision-2',
    );
    expect(() => requestChanges(review, 'revision-2', '  ')).toThrow(
      BadRequestException,
    );
    expect(requestChanges(review, 'revision-2', 'Fix title')).toEqual({
      draftRevisionId: 'revision-2',
      approvedRevisionId: null,
      publishedRevisionId: 'revision-1',
      reviewState: 'changes_requested',
    });
  });

  it('publishes the approved version without changing its draft', () => {
    expect(publishRevision(published, 'revision-2')).toEqual({
      ...published,
      publishedRevisionId: 'revision-2',
    });
  });

  it('refuses publication after review has been reopened', () => {
    expect(() =>
      publishRevision(
        { ...published, reviewState: 'changes_requested' },
        'revision-2',
      ),
    ).toThrow(ConflictException);
  });
});
