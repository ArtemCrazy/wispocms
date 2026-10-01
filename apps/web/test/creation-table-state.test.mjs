import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterPage, selectPageClusters, tablePlatforms } from '../src/app/content-center/creation-table-state.ts';

const cluster = (id, archived = false) => ({ id, archived });
test('pagination puts archives last and clamps after filtering; selecting a page preserves other pages', () => {
  const rows = [cluster('archive', true), ...Array.from({ length: 12 }, (_, i) => cluster(`c${i}`))];
  const first = clusterPage(rows, 1, 10);
  const second = clusterPage(rows, 2, 10);
  assert.equal(first.rows.length, 10);
  assert.deepEqual(second.rows.map(c => c.id), ['c10', 'c11', 'archive']);
  assert.equal(clusterPage(rows.slice(0, 2), 4, 10).page, 1);
  const selected = selectPageClusters(['c0'], second.rows, true);
  assert.deepEqual(selected, ['c0', 'c10', 'c11']);
  assert.deepEqual(selectPageClusters(selected, second.rows, false), ['c0']);
  assert.equal(clusterPage([], 10, 10).pages, 1);
});
test('disconnected platforms retain existing articles without becoming connected launch targets', () => {
  const data = { settings: { platforms: [{ siteId: 'live' }] }, sites: [{ id: 'live', name: 'Сайт' }], articles: [{ site_id: 'old' }, { site_id: 'live' }] };
  assert.deepEqual(tablePlatforms(data), [
    { id: 'live', name: 'Сайт', connected: true },
    { id: 'old', name: 'Отключённая площадка', connected: false },
  ]);
});
