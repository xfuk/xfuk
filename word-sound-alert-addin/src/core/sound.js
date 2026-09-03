// イヤコン(効果音)の再生
//
// Web Audio API で短い合成音を鳴らす。音の定義はデータ(プリセット)として持ち、
// 評価実験で音の種類を差し替えやすくしている。
// Word のタスクペイン(WebView2)では、ユーザー操作(クリック等)後でないと
// AudioContext が動かないため、unlock() をボタンから呼ぶ。

export const EARCON_PRESETS = {
  // 既定: 種別ごとに音色・輪郭を変えて区別しやすくする
  default: {
    label: '標準',
    spelling: { wave: 'square', gain: 0.18, notes: [{ f: 880, d: 0.08 }, { f: 660, d: 0.14 }], gap: 0.02 },
    grammar: { wave: 'triangle', gain: 0.3, notes: [{ f: 330, d: 0.28 }], gap: 0 },
    style: { wave: 'sine', gain: 0.18, notes: [{ f: 1320, d: 0.05 }], gap: 0 },
    resolved: { wave: 'sine', gain: 0.18, notes: [{ f: 660, d: 0.07 }, { f: 990, d: 0.12 }], gap: 0.02 },
    multiple: { wave: 'square', gain: 0.18, notes: [{ f: 880, d: 0.06 }, { f: 880, d: 0.06 }, { f: 880, d: 0.06 }], gap: 0.05 },
    test: { wave: 'sine', gain: 0.2, notes: [{ f: 523, d: 0.1 }, { f: 659, d: 0.1 }, { f: 784, d: 0.15 }], gap: 0.02 },
  },
  // 控えめ: 音量と長さを抑えたもの(長時間の作業向け)
  soft: {
    label: '控えめ',
    spelling: { wave: 'sine', gain: 0.12, notes: [{ f: 740, d: 0.06 }, { f: 590, d: 0.09 }], gap: 0.01 },
    grammar: { wave: 'sine', gain: 0.15, notes: [{ f: 294, d: 0.18 }], gap: 0 },
    style: { wave: 'sine', gain: 0.1, notes: [{ f: 1100, d: 0.04 }], gap: 0 },
    resolved: { wave: 'sine', gain: 0.1, notes: [{ f: 590, d: 0.05 }, { f: 880, d: 0.08 }], gap: 0.01 },
    multiple: { wave: 'sine', gain: 0.12, notes: [{ f: 740, d: 0.05 }, { f: 740, d: 0.05 }], gap: 0.04 },
    test: { wave: 'sine', gain: 0.12, notes: [{ f: 523, d: 0.08 }, { f: 784, d: 0.12 }], gap: 0.02 },
  },
  // 単一音: 種別を区別しない(比較条件用)
  single: {
    label: '単一音(種別を区別しない)',
    spelling: { wave: 'square', gain: 0.18, notes: [{ f: 660, d: 0.12 }], gap: 0 },
    grammar: { wave: 'square', gain: 0.18, notes: [{ f: 660, d: 0.12 }], gap: 0 },
    style: { wave: 'square', gain: 0.18, notes: [{ f: 660, d: 0.12 }], gap: 0 },
    resolved: { wave: 'sine', gain: 0.18, notes: [{ f: 660, d: 0.07 }, { f: 990, d: 0.12 }], gap: 0.02 },
    multiple: { wave: 'square', gain: 0.18, notes: [{ f: 660, d: 0.12 }, { f: 660, d: 0.12 }], gap: 0.05 },
    test: { wave: 'sine', gain: 0.2, notes: [{ f: 523, d: 0.1 }, { f: 784, d: 0.15 }], gap: 0.02 },
  },
};

/** イヤコン 1 つの合計再生時間(秒) */
export function earconDuration(spec) {
  if (!spec) return 0;
  return spec.notes.reduce((s, n) => s + n.d, 0) + (spec.gap || 0) * Math.max(0, spec.notes.length - 1);
}

export class EarconPlayer {
  constructor({ audioContext = null, preset = 'default', volume = 1.0, createContext = defaultCreateContext } = {}) {
    this.ctx = audioContext;
    this.createContext = createContext;
    this.presetName = preset;
    this.volume = volume;
    this.enabled = true;
    this.lastPlayed = null;
  }

  get preset() {
    return EARCON_PRESETS[this.presetName] || EARCON_PRESETS.default;
  }

  setPreset(name) {
    if (EARCON_PRESETS[name]) this.presetName = name;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
  }

  /** ユーザー操作の中で呼び、AudioContext を作成・再開する。 */
  async unlock() {
    if (!this.ctx) this.ctx = this.createContext();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (_) {
        /* ignore */
      }
    }
    return this.ctx.state === 'running';
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /**
   * @param {'spelling'|'grammar'|'style'|'resolved'|'multiple'|'test'} kind
   * @param {{pan?: number}} opts pan は -1(左)〜1(右)
   * @returns {number} 再生時間(秒)。再生できなかった場合は 0。
   */
  play(kind, { pan = 0 } = {}) {
    const spec = this.preset[kind];
    this.lastPlayed = { kind, pan, at: Date.now() };
    if (!spec || !this.enabled || !this.ctx || this.ctx.state !== 'running') return 0;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    let dest = master;
    if (typeof ctx.createStereoPanner === 'function' && pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      master.connect(panner);
      panner.connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }
    for (const note of spec.notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = spec.wave || 'sine';
      osc.frequency.value = note.f;
      // クリックノイズを避けるための短いエンベロープ
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(spec.gain, t + 0.008);
      g.gain.setValueAtTime(spec.gain, t + Math.max(0.008, note.d - 0.03));
      g.gain.exponentialRampToValueAtTime(0.0001, t + note.d);
      osc.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + note.d + 0.01);
      t += note.d + (spec.gap || 0);
    }
    return earconDuration(spec);
  }
}

function defaultCreateContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AC ? new AC() : null;
}

/** 段落内の相対位置(0〜1)を左右のパン(-1〜1)に変換する。 */
export function positionToPan(offset, length) {
  if (!length || length <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, offset / length));
  return (ratio * 2 - 1) * 0.8;
}
