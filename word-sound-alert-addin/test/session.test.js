import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckSession, describeError } from '../src/core/session.js';
import { BuiltinChecker } from '../src/core/checker.js';
import { EvaluationLog, EventKind } from '../src/core/evalLog.js';

function fakePlayer() {
  const played = [];
  return {
    played,
    enabled: true,
    play(kind, opts) { played.push({ kind, ...opts }); return 0; },
    setPreset() {},
    setVolume() {},
  };
}
function fakeSpeaker() {
  const spoken = [];
  return { spoken, rate: 1, async speak(u) { spoken.push(...u); } };
}

function makeSession(settings = {}) {
  const player = fakePlayer();
  const speaker = fakeSpeaker();
  const announced = [];
  const log = new EvaluationLog({ now: () => 0 });
  const session = new CheckSession({
    checker: new BuiltinChecker({ misspellings: { teh: 'the', recieve: 'receive' } }),
    player,
    speaker,
    log,
    announce: (t) => announced.push(t),
    settings: { minIntervalMs: 0, ...settings },
    sleep: async () => {},
  });
  return { session, player, speaker, announced, log };
}

test('新しい誤りを検出すると音と読み上げと画面通知が行われる', async () => {
  const { session, player, speaker, announced, log } = makeSession();
  await session.scan(['I recieve it.'], { paragraphIndex: 0, offset: 13 });
  await session.queue;
  assert.deepEqual(player.played.map((p) => p.kind), ['spelling']);
  assert.equal(speaker.spoken[0].text, 'スペル');
  assert.equal(speaker.spoken[1].text, 'recieve');
  assert.ok(announced[0].startsWith('スペル: recieve'));
  assert.ok(log.events.some((e) => e.kind === EventKind.NOTIFIED && e.key === 'spelling|recieve|0'));
});

test('入力中の語は保留され、区切りを打った後に通知される', async () => {
  const { session, player } = makeSession();
  await session.scan(['teh'], { paragraphIndex: 0, offset: 3 });
  await session.queue;
  assert.equal(player.played.length, 0);
  await session.scan(['teh '], { paragraphIndex: 0, offset: 4 });
  await session.queue;
  assert.deepEqual(player.played.map((p) => p.kind), ['spelling']);
});

test('修正すると確認音が鳴る', async () => {
  const { session, player, announced } = makeSession();
  await session.scan(['teh cat'], null);
  await session.queue;
  await session.scan(['the cat'], null);
  await session.queue;
  assert.deepEqual(player.played.map((p) => p.kind), ['spelling', 'resolved']);
  assert.ok(announced.includes('修正されました'));
  assert.equal(session.errors.length, 0);
});

test('多数の誤りが同時に現れたらまとめ音 1 回', async () => {
  const { session, player, speaker } = makeSession({ burstThreshold: 3 });
  await session.scan(['teh recieve teh recieve'], null);
  await session.queue;
  assert.deepEqual(player.played.map((p) => p.kind), ['multiple']);
  assert.equal(speaker.spoken[0].text, '4件の誤りがあります');
});

test('種別ごとの音の ON/OFF と読み上げなし', async () => {
  const { session, player, speaker } = makeSession({ soundSpelling: false, speechMode: 'none' });
  await session.scan(['teh'], null);
  await session.queue;
  assert.equal(player.played.length, 0);
  assert.equal(speaker.spoken.length, 0);
});

test('ステレオパンが有効なら位置に応じたパンを渡す', async () => {
  const { session, player } = makeSession({ stereoPan: true });
  await session.scan(['aaaaaaaaaaaaaaaaaaaa teh'], null);
  await session.queue;
  assert.ok(player.played[0].pan > 0);
});

test('チェッカーの失敗は lastError に残り例外になる', async () => {
  const { session } = makeSession();
  session.checker = { check: async () => { throw new Error('offline'); } };
  await assert.rejects(() => session.scan(['x'], null), /offline/);
  assert.equal(session.lastError.message, 'offline');
});

test('段落 ID が誤りに付与される', async () => {
  const { session } = makeSession();
  const r = await session.scan(['ok', 'teh'], null, { paragraphIds: ['p1', 'p2'] });
  assert.equal(r.errors[0].paragraphId, 'p2');
  assert.equal(r.errors[0].paragraphIndex, 1);
  assert.equal(r.errors[0].offsetInParagraph, 0);
});

test('describeError', () => {
  assert.equal(describeError({ type: 'grammar', text: 'a apple', message: 'x', suggestions: ['an'] }), '文法: a apple(x)。候補: an');
});
