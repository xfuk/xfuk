import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorTracker, joinParagraphs, nthIndexOf } from '../src/core/tracker.js';

const E = (text, offset, type = 'spelling', paragraphIndex = 0) => ({ text, offset, length: text.length, type, paragraphIndex });

test('初回はすべて added', () => {
  const t = new ErrorTracker();
  const r = t.update([E('teh', 0), E('recieve', 10)]);
  assert.equal(r.added.length, 2);
  assert.equal(r.resolved.length, 0);
  assert.equal(t.size, 2);
});

test('位置がずれても同じ誤りは再通知されない', () => {
  const t = new ErrorTracker();
  t.update([E('teh', 10)]);
  const r = t.update([E('teh', 25)]);
  assert.equal(r.added.length, 0);
  assert.equal(r.resolved.length, 0);
});

test('同じ語が 2 回目に現れたら 1 件だけ added', () => {
  const t = new ErrorTracker();
  t.update([E('teh', 0)]);
  const r = t.update([E('teh', 0), E('teh', 20)]);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].key, 'spelling|teh|1');
});

test('修正されると resolved', () => {
  const t = new ErrorTracker();
  t.update([E('teh', 0), E('teh', 20)]);
  const r = t.update([E('teh', 20)]);
  assert.equal(r.resolved.length, 1);
  assert.equal(r.added.length, 0);
  assert.equal(t.size, 1);
});

test('種別が違えば別の誤り', () => {
  const t = new ErrorTracker();
  t.update([E('the the', 0, 'grammar')]);
  const r = t.update([E('the the', 0, 'grammar'), E('the the', 0, 'style')]);
  assert.equal(r.added.length, 1);
});

test('reset は全件 resolved を返す', () => {
  const t = new ErrorTracker();
  t.update([E('a', 0), E('b', 5)]);
  assert.equal(t.reset().length, 2);
  assert.equal(t.size, 0);
});

test('joinParagraphs の locate が段落番号と段落内位置を返す', () => {
  const { text, locate } = joinParagraphs(['abc', '', 'defg']);
  assert.equal(text, 'abc\n\ndefg');
  assert.deepEqual(locate(0), { paragraphIndex: 0, offsetInParagraph: 0 });
  assert.deepEqual(locate(2), { paragraphIndex: 0, offsetInParagraph: 2 });
  assert.deepEqual(locate(5), { paragraphIndex: 2, offsetInParagraph: 0 });
  assert.deepEqual(locate(8), { paragraphIndex: 2, offsetInParagraph: 3 });
});

test('nthIndexOf', () => {
  assert.equal(nthIndexOf('a-a-a', 'a', 0), 0);
  assert.equal(nthIndexOf('a-a-a', 'a', 2), 4);
  assert.equal(nthIndexOf('a-a-a', 'a', 3), -1);
});
