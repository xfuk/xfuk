import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationPolicy, isBeingTyped } from '../src/core/policy.js';

const err = (key, offsetInParagraph, length, paragraphIndex = 0) => ({ key, offsetInParagraph, length, paragraphIndex, type: 'spelling', text: 'x' });

test('カーソルが語の直後なら入力中とみなす', () => {
  const e = err('k', 10, 3);
  assert.equal(isBeingTyped(e, { paragraphIndex: 0, offset: 13 }), true);
  assert.equal(isBeingTyped(e, { paragraphIndex: 0, offset: 12 }), true);
  assert.equal(isBeingTyped(e, { paragraphIndex: 0, offset: 14 }), false);
  assert.equal(isBeingTyped(e, { paragraphIndex: 0, offset: 9 }), false);
  assert.equal(isBeingTyped(e, { paragraphIndex: 1, offset: 13 }), false);
  assert.equal(isBeingTyped(e, null), false);
});

test('入力中の誤りは保留し、区切りを打ったら通知する', () => {
  const p = new NotificationPolicy();
  const e = err('k', 0, 3);
  let d = p.decide({ added: [e], resolved: [] }, { paragraphIndex: 0, offset: 3 });
  assert.equal(d.announce.length, 0);
  assert.equal(d.deferred.length, 1);
  d = p.decide({ added: [], resolved: [] }, { paragraphIndex: 0, offset: 4 });
  assert.equal(d.announce.length, 1);
  assert.equal(d.announce[0].key, 'k');
  d = p.decide({ added: [], resolved: [] }, { paragraphIndex: 0, offset: 5 });
  assert.equal(d.announce.length, 0);
});

test('保留中に修正されたら通知しない', () => {
  const p = new NotificationPolicy();
  const e = err('k', 0, 3);
  p.decide({ added: [e], resolved: [] }, { paragraphIndex: 0, offset: 3 });
  const d = p.decide({ added: [], resolved: [e] }, { paragraphIndex: 0, offset: 0 });
  assert.equal(d.announce.length, 0);
  assert.equal(d.resolved.length, 1);
});

test('burst 閾値以上ならまとめ通知', () => {
  const p = new NotificationPolicy({ burstThreshold: 3 });
  const d = p.decide({ added: [err('a', 0, 1), err('b', 5, 1), err('c', 10, 1)], resolved: [] }, null);
  assert.equal(d.burst, true);
  const d2 = p.decide({ added: [err('d', 20, 1), err('e', 25, 1)], resolved: [] }, null);
  assert.equal(d2.burst, false);
});

test('deferWhileTyping=false なら即通知', () => {
  const p = new NotificationPolicy({ deferWhileTyping: false });
  const d = p.decide({ added: [err('k', 0, 3)], resolved: [] }, { paragraphIndex: 0, offset: 3 });
  assert.equal(d.announce.length, 1);
});

test('announceResolved=false なら resolved を返さない', () => {
  const p = new NotificationPolicy({ announceResolved: false });
  const d = p.decide({ added: [], resolved: [err('k', 0, 3)] }, null);
  assert.equal(d.resolved.length, 0);
});
