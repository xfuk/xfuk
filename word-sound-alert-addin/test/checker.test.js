import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuiltinChecker, LanguageToolChecker, CompositeChecker, parseDictionaryText, dedupe } from '../src/core/checker.js';

test('内蔵辞書で英語のスペルミスを単語単位で検出する', async () => {
  const c = new BuiltinChecker({ misspellings: { recieve: 'receive', teh: 'the' } });
  const errs = await c.check('I will recieve teh package. Receive it.');
  const spelling = errs.filter((e) => e.type === 'spelling');
  assert.equal(spelling.length, 2);
  assert.equal(spelling[0].text, 'recieve');
  assert.deepEqual(spelling[0].suggestions, ['receive']);
  assert.equal(spelling[1].text, 'teh');
  assert.equal(spelling[1].offset, 15);
});

test('大文字始まりの誤りは候補も大文字始まりにする', async () => {
  const c = new BuiltinChecker({ misspellings: { recieve: 'receive' } });
  const errs = await c.check('Recieve');
  assert.deepEqual(errs[0].suggestions, ['Receive']);
});

test('日本語の表記誤りは部分一致で検出する', async () => {
  const c = new BuiltinChecker({ misspellings: { こんにちわ: 'こんにちは', シュミレーション: 'シミュレーション' } });
  const errs = await c.check('こんにちわ。シュミレーションを行う。');
  assert.equal(errs.length, 2);
  assert.equal(errs[0].text, 'こんにちわ');
  assert.equal(errs[0].offset, 0);
  assert.equal(errs[1].text, 'シュミレーション');
  assert.equal(errs[1].offset, 6);
});

test('内蔵ルール: 単語の重複と文頭小文字', async () => {
  const c = new BuiltinChecker();
  const errs = await c.check('This is the the test. it works.');
  const ids = errs.map((e) => e.source);
  assert.ok(ids.includes('builtin:repeated-word'));
  assert.ok(ids.includes('builtin:lowercase-sentence-start'));
  const rep = errs.find((e) => e.source === 'builtin:repeated-word');
  assert.equal(rep.text, 'the the');
  assert.equal(rep.type, 'grammar');
});

test('内蔵ルール: 冠詞 a/an', async () => {
  const c = new BuiltinChecker();
  const errs = await c.check('a apple and an banana');
  const srcs = errs.map((e) => e.source).sort();
  assert.deepEqual(srcs, ['builtin:article-a-before-vowel', 'builtin:article-an-before-consonant']);
});

test('内蔵ルール: 日本語句読点の連続と混在', async () => {
  const c = new BuiltinChecker();
  const errs = await c.check('です。。ます、，');
  const srcs = errs.map((e) => e.source).sort();
  assert.deepEqual(srcs, ['builtin:mixed-ja-punct', 'builtin:repeated-ja-punct']);
});

test('単語リストがあれば未知語をスペルミスとみなす', async () => {
  const c = new BuiltinChecker({ wordlist: ['this', 'is', 'a', 'pen'] });
  const errs = await c.check('This is a pne. NASA 2024');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].text, 'pne');
});

test('空文字では何も返さない', async () => {
  const c = new BuiltinChecker({ misspellings: { teh: 'the' } });
  assert.deepEqual(await c.check(''), []);
});

test('LanguageTool の応答を共通形式に変換する', () => {
  const text = 'This is a exmaple.';
  const json = {
    matches: [
      { offset: 10, length: 7, message: 'Possible spelling mistake found.', shortMessage: 'Spelling mistake', replacements: [{ value: 'example' }], rule: { id: 'MORFOLOGIK_RULE_EN_US', issueType: 'misspelling', category: { id: 'TYPOS' } } },
      { offset: 8, length: 1, message: 'Use "an"', replacements: [{ value: 'an' }], rule: { id: 'EN_A_VS_AN', issueType: 'grammar', category: { id: 'MISC' } } },
      { offset: 0, length: 4, message: 'style', replacements: [], rule: { id: 'X', issueType: 'style', category: { id: 'STYLE' } } },
    ],
  };
  const errs = LanguageToolChecker.convert(json, text);
  assert.equal(errs.length, 3);
  assert.equal(errs[0].type, 'style');
  assert.equal(errs[1].type, 'grammar');
  assert.equal(errs[2].type, 'spelling');
  assert.equal(errs[2].text, 'exmaple');
  assert.deepEqual(errs[2].suggestions, ['example']);
});

test('LanguageTool チェッカーは form 形式で POST する', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ matches: [] }) };
  };
  const c = new LanguageToolChecker({ endpoint: 'https://example.test/v2/check', language: 'en-US', fetchImpl });
  await c.check('Hello world');
  assert.equal(captured.url, 'https://example.test/v2/check');
  assert.equal(captured.init.method, 'POST');
  const params = new URLSearchParams(captured.init.body);
  assert.equal(params.get('text'), 'Hello world');
  assert.equal(params.get('language'), 'en-US');
});

test('LanguageTool の HTTP エラーは例外になる', async () => {
  const c = new LanguageToolChecker({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(() => c.check('x'), /HTTP 500/);
});

test('複合チェッカーは片方が失敗しても結果を返す', async () => {
  const good = new BuiltinChecker({ misspellings: { teh: 'the' } });
  const bad = { check: async () => { throw new Error('down'); } };
  const c = new CompositeChecker([good, bad]);
  const errs = await c.check('teh');
  assert.equal(errs.length, 1);
});

test('複合チェッカーは全滅なら例外', async () => {
  const bad = { check: async () => { throw new Error('down'); } };
  const c = new CompositeChecker([bad]);
  await assert.rejects(() => c.check('teh'), /down/);
});

test('辞書テキストの解析', () => {
  const d = parseDictionaryText('# comment\nrecieve,receive\nteh\tthe\nこんにちわ，こんにちは\n\nbad,good,better');
  assert.deepEqual(d, { recieve: ['receive'], teh: ['the'], こんにちわ: ['こんにちは'], bad: ['good', 'better'] });
});

test('dedupe は同位置・同型を 1 つにし位置順に並べる', () => {
  const out = dedupe([
    { type: 'spelling', offset: 5, length: 3 },
    { type: 'spelling', offset: 5, length: 3 },
    { type: 'grammar', offset: 1, length: 2 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].offset, 1);
});
