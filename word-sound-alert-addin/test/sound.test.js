import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EarconPlayer, EARCON_PRESETS, earconDuration, positionToPan } from '../src/core/sound.js';

function fakeContext() {
  const calls = [];
  const node = () => ({
    connect() {},
    start() {},
    stop() {},
    type: '',
    frequency: { value: 0 },
    pan: { value: 0 },
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  });
  return {
    state: 'running',
    currentTime: 0,
    destination: {},
    createOscillator() { calls.push('osc'); return node(); },
    createGain() { return node(); },
    createStereoPanner() { calls.push('pan'); return node(); },
    resume: async function () { this.state = 'running'; },
    calls,
  };
}

test('各プリセットに必要な種類が揃っている', () => {
  for (const [name, preset] of Object.entries(EARCON_PRESETS)) {
    for (const kind of ['spelling', 'grammar', 'style', 'resolved', 'multiple', 'test']) {
      assert.ok(preset[kind], `${name}.${kind}`);
      assert.ok(earconDuration(preset[kind]) > 0);
      assert.ok(earconDuration(preset[kind]) < 1, '1 秒未満の短い音');
    }
  }
});

test('既定プリセットではスペルと文法の音が異なる', () => {
  const p = EARCON_PRESETS.default;
  assert.notDeepEqual(p.spelling.notes, p.grammar.notes);
});

test('play はオシレータをノート数だけ作り、再生時間を返す', () => {
  const ctx = fakeContext();
  const player = new EarconPlayer({ audioContext: ctx });
  const d = player.play('spelling');
  assert.equal(ctx.calls.filter((c) => c === 'osc').length, 2);
  assert.ok(Math.abs(d - earconDuration(EARCON_PRESETS.default.spelling)) < 1e-9);
});

test('パン指定でステレオパンナーを使う', () => {
  const ctx = fakeContext();
  const player = new EarconPlayer({ audioContext: ctx });
  player.play('grammar', { pan: -0.5 });
  assert.ok(ctx.calls.includes('pan'));
});

test('コンテキストが無いときは 0 を返して落ちない', () => {
  const player = new EarconPlayer({ createContext: () => null });
  assert.equal(player.play('spelling'), 0);
  assert.equal(player.ready, false);
});

test('unlock は suspended なコンテキストを resume する', async () => {
  const ctx = fakeContext();
  ctx.state = 'suspended';
  const player = new EarconPlayer({ createContext: () => ctx });
  assert.equal(await player.unlock(), true);
  assert.equal(player.ready, true);
});

test('positionToPan は左端で負、右端で正', () => {
  assert.ok(positionToPan(0, 100) < 0);
  assert.ok(positionToPan(100, 100) > 0);
  assert.equal(positionToPan(50, 100), 0);
  assert.equal(positionToPan(5, 0), 0);
});
