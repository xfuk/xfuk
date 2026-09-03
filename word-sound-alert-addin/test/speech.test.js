import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUtterances, buildBurstUtterance, Speaker } from '../src/core/speech.js';

test('読み上げモードごとの発話', () => {
  const e = { type: 'spelling', text: 'recieve' };
  assert.deepEqual(buildUtterances(e, 'none'), []);
  assert.deepEqual(buildUtterances(e, 'type'), [{ text: 'スペル', lang: 'ja-JP' }]);
  assert.deepEqual(buildUtterances(e, 'word'), [{ text: 'スペル', lang: 'ja-JP' }, { text: 'recieve', lang: 'en-US' }]);
  const spell = buildUtterances(e, 'spell');
  assert.equal(spell.length, 3);
  assert.equal(spell[2].text, 'r, e, c, i, e, v, e');
});

test('日本語の語は日本語音声で、綴り読みはしない', () => {
  const e = { type: 'grammar', text: 'こんにちわ' };
  const u = buildUtterances(e, 'spell');
  assert.deepEqual(u, [{ text: '文法', lang: 'ja-JP' }, { text: 'こんにちわ', lang: 'ja-JP' }]);
});

test('まとめ通知の発話', () => {
  assert.deepEqual(buildBurstUtterance(5), [{ text: '5件の誤りがあります', lang: 'ja-JP' }]);
});

test('Speaker は speechSynthesis が無くても落ちない', async () => {
  const s = new Speaker({ synth: null });
  assert.equal(s.available, false);
  await s.speak([{ text: 'x', lang: 'ja-JP' }]);
  assert.equal(s.spoken.length, 1);
});
