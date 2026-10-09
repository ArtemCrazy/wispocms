import { CmsRevisionsService } from '../content/cms-revisions.service';
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';

describe('managed chunk typed workflow surface', () => {
  it('exposes only manager-aware verified submit/request-changes methods', () => {
    expect(
      typeof (CmsRevisionsService.prototype as any)
        .submitManagedRevisionUsingManager,
    ).toBe('function');
    expect(
      typeof (CmsRevisionsService.prototype as any)
        .requestManagedRevisionChangesUsingManager,
    ).toBe('function');
  });

  it('exposes typed instance draft and workflow repository methods', () => {
    expect(
      typeof (ManagedChunkPersistenceRepository.prototype as any)
        .saveInstanceDraft,
    ).toBe('function');
    expect(
      typeof (ManagedChunkPersistenceRepository.prototype as any)
        .submitInstanceRevision,
    ).toBe('function');
    expect(
      typeof (ManagedChunkPersistenceRepository.prototype as any)
        .requestInstanceRevisionChanges,
    ).toBe('function');
  });
});
