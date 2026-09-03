// 音声読み上げ(Web Speech API)
//
// イヤコンだけでは「どの語が」誤っているか分からないため、
// 設定に応じて種別・語・綴りを読み上げる。
// 読み上げモード:
//   'none'  読み上げない
//   'type'  種別のみ(「スペル」「文法」)
//   'word'  種別と語
//   'spell' 種別と語と、英字の場合は 1 文字ずつの綴り

import { ERROR_TYPE_LABEL } from './checker.js';

export const SPEECH_MODES = ['none', 'type', 'word', 'spell'];

export function isAsciiWord(s) {
  return /^[\x00-\x7F]+$/.test(s);
}

/** 読み上げる発話の列を作る(純粋関数。テストしやすいように分離)。 */
export function buildUtterances(error, mode, { jaLang = 'ja-JP', enLang = 'en-US' } = {}) {
  if (mode === 'none') return [];
  const label = ERROR_TYPE_LABEL[error.type] || '誤り';
  const out = [{ text: label, lang: jaLang }];
  if (mode === 'type') return out;
  const word = (error.text || '').trim();
  if (!word) return out;
  const wordLang = isAsciiWord(word) ? enLang : jaLang;
  out.push({ text: word, lang: wordLang });
  if (mode === 'spell' && isAsciiWord(word)) {
    out.push({ text: word.replace(/\s+/g, ' ').split('').join(', '), lang: enLang, rate: 0.9 });
  }
  return out;
}

export function buildBurstUtterance(count, { jaLang = 'ja-JP' } = {}) {
  return [{ text: `${count}件の誤りがあります`, lang: jaLang }];
}

export function buildResolvedUtterance({ jaLang = 'ja-JP' } = {}) {
  return [{ text: '修正されました', lang: jaLang }];
}

export class Speaker {
  constructor({ synth = globalThis.speechSynthesis, rate = 1.1, volume = 1.0, pitch = 1.0 } = {}) {
    this.synth = synth || null;
    this.rate = rate;
    this.volume = volume;
    this.pitch = pitch;
    this.mode = 'word';
    this.spoken = [];
  }

  get available() {
    return !!this.synth && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
  }

  cancel() {
    if (this.synth) this.synth.cancel();
  }

  /** 発話列を順に読み上げる。すべて終わると resolve する。 */
  speak(utterances) {
    this.spoken.push(...utterances);
    if (!this.available || utterances.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let remaining = utterances.length;
      const done = () => {
        remaining--;
        if (remaining <= 0) resolve();
      };
      for (const u of utterances) {
        const ut = new SpeechSynthesisUtterance(u.text);
        ut.lang = u.lang;
        ut.rate = u.rate || this.rate;
        ut.volume = this.volume;
        ut.pitch = this.pitch;
        ut.onend = done;
        ut.onerror = done;
        this.synth.speak(ut);
      }
      // onend が呼ばれない環境への保険
      setTimeout(resolve, 8000 * utterances.length);
    });
  }
}
