import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTENT_CENTER_SECTIONS,
  contentCenterSection,
  parseContentCenterScreen,
} from '../src/app/content-center/navigation.ts';

test('the root and sidebar share exactly three canonical sections, not a fourth materials page', () => {
  assert.deepEqual(CONTENT_CENTER_SECTIONS.map(({ id, label }) => [id, label]), [
    ['preparation', 'Подготовка информации'],
    ['research', 'Исследование и анализ'],
    ['creation', 'Создание контента'],
  ]);
});

test('each section and existing version screens can be restored from a direct URL', () => {
  for (const screen of ['preparation', 'research', 'creation', 'history', 'document']) {
    const url = new URL(`https://cms.example/?view=content-center&cc=${screen}`);
    assert.equal(parseContentCenterScreen(url.searchParams.get('cc')), screen);
  }
  for (const invalid of [null, '', 'root', 'materials', 'unknown']) {
    assert.equal(parseContentCenterScreen(invalid), 'root');
  }
});

test('history and prepared documents stay within preparation without extra root navigation items', () => {
  assert.equal(contentCenterSection('root'), null);
  for (const screen of ['preparation', 'history', 'document']) {
    assert.equal(contentCenterSection(screen), 'preparation');
  }
  assert.equal(contentCenterSection('research'), 'research');
  assert.equal(contentCenterSection('creation'), 'creation');
});
