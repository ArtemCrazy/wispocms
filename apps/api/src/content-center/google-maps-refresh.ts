import type { SourceSnapshot } from './preparation-ai.service';

export function wouldLoseGoogleReviews(
  previous: SourceSnapshot | null,
  next: SourceSnapshot,
): boolean {
  return (
    previous?.map?.provider === 'google' &&
    next.map?.provider === 'google' &&
    previous.map.reviews.length > 0 &&
    next.map.reviews.length === 0 &&
    next.map.reviewCount !== 0
  );
}
