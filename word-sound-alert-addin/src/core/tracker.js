// 誤りの追跡
//
// 検査のたびに得られる誤りの一覧と前回の一覧を比較し、
// 「新しく現れた誤り」「解消した誤り」を判定する。
// キーは (種別, 文字列, 文書内での出現順) で作り、位置(offset)は使わない。
// これにより、誤りより前の位置で文字を入力しても同じ誤りが再通知されない。

export class ErrorTracker {
  constructor() {
    this.current = new Map(); // key -> error
  }

  /**
   * @param {Array} errors 文書全体の誤り。各要素は offset, length, type, text に加えて
   *   paragraphIndex, paragraphId, offsetInParagraph を持つことを想定(無くても動く)。
   * @returns {{added: Array, resolved: Array, current: Array}}
   */
  update(errors) {
    const counts = new Map();
    const next = new Map();
    const sorted = [...errors].sort((a, b) => (a.paragraphIndex ?? 0) - (b.paragraphIndex ?? 0) || a.offset - b.offset);
    for (const e of sorted) {
      const base = `${e.type}|${e.text}`;
      const n = counts.get(base) || 0;
      counts.set(base, n + 1);
      const key = `${base}|${n}`;
      next.set(key, { ...e, key });
    }
    const added = [];
    const resolved = [];
    for (const [key, e] of next) {
      if (!this.current.has(key)) added.push(e);
    }
    for (const [key, e] of this.current) {
      if (!next.has(key)) resolved.push(e);
    }
    // 位置情報は最新のものに更新しておく
    this.current = next;
    return { added, resolved, current: [...next.values()] };
  }

  reset() {
    const resolved = [...this.current.values()];
    this.current = new Map();
    return resolved;
  }

  get size() {
    return this.current.size;
  }

  list() {
    return [...this.current.values()];
  }
}

/**
 * 段落ごとのテキストを結合した文書全体テキストと、
 * 文書全体の offset を段落番号・段落内 offset に変換する表を作る。
 */
export function joinParagraphs(paragraphTexts, separator = '\n') {
  const starts = [];
  let pos = 0;
  const parts = [];
  paragraphTexts.forEach((t, i) => {
    starts.push(pos);
    parts.push(t);
    pos += t.length + (i < paragraphTexts.length - 1 ? separator.length : 0);
  });
  const text = parts.join(separator);
  const locate = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { paragraphIndex: lo, offsetInParagraph: offset - (starts[lo] || 0) };
  };
  return { text, starts, locate };
}

/** 文字列 sub が text の中で n 番目(0 始まり)に現れる位置を返す。無ければ -1。 */
export function nthIndexOf(text, sub, n) {
  let idx = -1;
  for (let i = 0; i <= n; i++) {
    idx = text.indexOf(sub, idx + 1);
    if (idx < 0) return -1;
  }
  return idx;
}
