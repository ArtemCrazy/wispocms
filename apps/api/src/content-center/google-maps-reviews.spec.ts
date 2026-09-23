import {
  googleReviewCountFromText,
  parseGoogleReviewHtml,
} from './google-maps-reviews';

describe('public Google Maps review parsing', () => {
  const sourceUrl = 'https://www.google.com/maps/place/Example/data=!1s0x1:0x2';

  it('keeps only actual Google review text with its author, rating and date', () => {
    const html = `
      <div class="jftiEf" data-review-id="google-review">
        <div class="d4r55">Анна</div>
        <div class="DU9Pgb">
          <span class="fontBodyLarge">3/5</span>
          <span class="xRkPPb">2 месяца назад в <span class="qmhsmd">Google</span></span>
        </div>
        <div><div class="MyEned"><span>Хорошее расположение, но шумно.</span><button>Ещё</button></div></div>
      </div>
      <div class="jftiEf" data-review-id="external-review">
        <div class="d4r55">Борис</div>
        <div class="DU9Pgb">
          <span class="fontBodyLarge">5/5</span>
          <span class="xRkPPb">1 год назад в <span class="qmhsmd">Tripadvisor</span></span>
        </div>
        <div><span>Отзыв другого сервиса</span></div>
      </div>`;
    expect(parseGoogleReviewHtml(html, sourceUrl)).toEqual([
      {
        author: 'Анна',
        rating: 3,
        date: '2 месяца назад',
        text: 'Хорошее расположение, но шумно.',
        url: sourceUrl,
      },
    ]);
  });

  it('does not turn empty ratings or duplicated cards into reviews', () => {
    const html = `
      <div class="jftiEf" data-review-id="rating-only"><div class="d4r55">Олег</div><div class="DU9Pgb"></div><div></div></div>
      <div class="jftiEf" data-review-id="one"><div class="d4r55">Елена</div><div class="DU9Pgb"></div><div>Всё понравилось</div></div>
      <div class="jftiEf" data-review-id="one"><div class="d4r55">Елена</div><div class="DU9Pgb"></div><div>Всё понравилось</div></div>`;
    expect(parseGoogleReviewHtml(html, sourceUrl)).toMatchObject([
      { author: 'Елена', text: 'Всё понравилось' },
    ]);
  });

  it('does not glue the rating to the review counter', () => {
    expect(googleReviewCountFromText('4.9\n297 reviews\nWrite a review')).toBe(
      297,
    );
    expect(googleReviewCountFromText('4.9\nNo public review count')).toBeNull();
  });
});
