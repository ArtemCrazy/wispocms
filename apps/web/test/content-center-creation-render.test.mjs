import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as state from '../src/app/content-center/creation-state.ts';
import * as preparation from '../src/app/content-center/preparation-state.ts';
const require=createRequire(import.meta.url),cache=new Map();
function load(name){
  if(cache.has(name))return cache.get(name);
  const source=readFileSync(new URL(`../src/app/content-center/${name}.tsx`,import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  const module={exports:{}};
  new Function('require','module','exports',compiled.outputText)(id=>id==='./creation-state'?state:id==='./preparation-state'?preparation:id.endsWith('.css')?{}:id.startsWith('./')?load(id.slice(2)):require(id),module,module.exports);
  cache.set(name,module.exports);return module.exports;
}
test('article exposes per-proposal decisions, unpublished current-version notice and separate publication',()=>{
  const article={id:'article',cluster_id:'cluster',site_id:'site',status:'published',recommendation:'update',rationale:'Reason',current_number:2,published_number:1,revision:1,publication_url:'/preview/test/articles/one'};
  const version={number:2,snapshot:{title:'Title',excerpt:'Excerpt',document:{version:1,blocks:[{id:'one',type:'paragraph',text:'<script>inert</script>'}]}},changes:[]};
  const html=renderToStaticMarkup(React.createElement(load('creation-article').CreationArticle,{base:'/api/test',parentBase:'/api/test',details:{article,version,versions:[],sites:[{id:'site',name:'Media',slug:'test'}],categories:[],templates:[],correction:{id:'correction',proposals:[{id:'p',target:'title',before:'Title',after:'New',reason:'Why',decision:'pending'}]}},data:{ai:{connected:false},run:null},location:{screen:'article'},navigate(){},async refresh(){},onDirtyChange(){}}));
  for(const label of ['Есть изменения, не опубликованные на сайте','Принять','Отклонить','Отправить в публикацию','Снять с публикации','Изменить с помощью AI','Список промптов','Прикрепить файл'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/type="file"/);
});
test('run history does not expand; history has all three specified tabs and filters',()=>{
  const html=renderToStaticMarkup(React.createElement(load('creation-history').CreationHistory,{data:{runs:[{id:'r',number:1,status:'succeeded',cluster_count:2,actor_name:'Editor',created_at:'2026-09-19T00:00:00Z'}],events:[]},location:{historyTab:'runs'},navigate(){}}));
  for(const label of ['Запуски','Кластеры','Статьи','Пользователь','Результат','С даты','По дату'])assert.ok(html.includes(label));
  assert.doesNotMatch(html,/<details/);
});
