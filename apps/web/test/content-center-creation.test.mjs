import test from 'node:test';
import assert from 'node:assert/strict';
import { creationLocation,filterClusters,launchClusters,unpublishedChanges } from '../src/app/content-center/creation-state.ts';
const cluster=(id,archived=false)=>({id,number:1,title:id,direction:'Care',queries:[{text:'skin',general:10,exact:2,primary:true}],archived,revision:1});
test('creation deep links remain inside the workspace content center',()=>{
  assert.equal(creationLocation(new URLSearchParams('creation=versions&contentId=article&contentVersion=2')).version,2);
  assert.equal(creationLocation(new URLSearchParams('creation=unknown')).screen,'table');
});
test('empty selection means all active clusters, not the filtered list',()=>{
  const clusters=[cluster('a'),cluster('b'),cluster('archived',true)];
  assert.deepEqual(launchClusters(clusters,[]).map(c=>c.id),['a','b']);
  assert.deepEqual(launchClusters(clusters,['b','archived']).map(c=>c.id),['b']);
});
test('status and recommendation filters must match the same platform article; archives stay searchable',()=>{
  const data={clusters:[cluster('a'),cluster('archive',true)],settings:{platforms:[{siteId:'1'},{siteId:'2'}]},sites:[],articles:[{cluster_id:'a',site_id:'1',status:'published',recommendation:'keep',title:'Published'},{cluster_id:'a',site_id:'2',status:'created',recommendation:'update',title:'Draft'}]};
  assert.equal(filterClusters(data,'','','published','update').length,0);
  assert.equal(filterClusters(data,'','','created','update').length,1);
  assert.equal(filterClusters(data,'archive','','','')[0].archived,true);
});
test('new current versions do not change publication status',()=>{
  assert.equal(unpublishedChanges({status:'published',current_number:3,published_number:2}),true);
  assert.equal(unpublishedChanges({status:'published',current_number:2,published_number:2}),false);
});
