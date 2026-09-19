import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as preparation from '../src/app/content-center/preparation-state.ts';

const source = await readFile(new URL('../src/app/content-center/speech-input.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
const target = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', compiled.outputText)(id => id === './preparation-state' ? preparation : id.endsWith('.css') ? { default: {} } : require(id), target, target.exports);
const render = disabled => renderToStaticMarkup(React.createElement(target.exports.SpeechInput, { disabled, onTranscript() {}, onActiveChange() {} }));

test('dictation uses an accessible icon-only microphone button with a tooltip', () => {
  const html = render(false);
  const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(button, /aria-label="Голосовой ввод"/);
  assert.match(button, /title="Голосовой ввод"/);
  assert.match(button, /aria-pressed="false"/);
  assert.match(button, /<svg[^>]*aria-hidden="true"/);
  assert.equal(button.replace(/<[^>]*>/g, '').trim(), '');
  assert.doesNotMatch(button, /disabled=/);
  assert.match(html, /Микрофон пока выключен/);
});

test('microphone button retains the disabled state', () => {
  const button = render(true).match(/<button\b[^>]*>/)[0];
  assert.match(button, /disabled=""/);
  assert.match(button, /aria-label="Голосовой ввод"/);
});
