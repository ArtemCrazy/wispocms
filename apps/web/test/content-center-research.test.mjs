import test from 'node:test';
import assert from 'node:assert/strict';
import { RESEARCH_TYPES, RESEARCH_STEPS, researchLocation, researchReady } from '../src/app/content-center/research-state.ts';

test('research has four types and the three specified competitive analysis steps', () => {
  assert.deepEqual(RESEARCH_TYPES.map((t) => t.id), ['competitive','jtbd','demand','seo']);
  assert.deepEqual(RESEARCH_STEPS.map((t) => t.label), ['Данные','Поиск источников','Результат']);
  assert.deepEqual(researchLocation(new URLSearchParams('research=competitive&researchStep=sources')), {type:'competitive',step:'sources'});
  assert.deepEqual(researchLocation(new URLSearchParams('research=invalid&researchStep=unknown')), {type:'competitive',step:'data'});
});
test('absence of prepared material does not block a directed manual research', () => {
  assert.equal(researchReady({contextKind:'conclusions',direction:'Cosmetics',sources:[{included:true}]},null),null);
  assert.match(researchReady({contextKind:'conclusions',direction:'',sources:[{included:true}]},null), /направление/);
});
test('full document is never mislabeled as structured conclusions and excluded sources do not count', () => {
  assert.match(researchReady({contextKind:'conclusions',direction:'',sources:[{included:true}]},{id:'prepared'}), /выводы/);
  assert.equal(researchReady({contextKind:'full',direction:'',sources:[{included:true}]},{id:'prepared'}),null);
  assert.match(researchReady({contextKind:'full',direction:'',sources:[{included:false}]},{id:'prepared'}), /хотя бы один/);
});
