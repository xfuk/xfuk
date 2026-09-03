// 通知ポリシー
//
// 「新しく検出された誤り」をいつ音で知らせるかを決める純粋なロジック。
// - 入力中の語(カーソルが誤りの範囲内または直後)は通知を保留する
// - 一度に多数の誤りが出た場合は 1 つのまとめ音にする
// - 解消した誤りには(設定により)確認音を返す

export class NotificationPolicy {
  constructor({ burstThreshold = 3, deferWhileTyping = true, announceResolved = true } = {}) {
    this.burstThreshold = burstThreshold;
    this.deferWhileTyping = deferWhileTyping;
    this.announceResolved = announceResolved;
    this.pending = new Map(); // key -> error (保留中)
  }

  /**
   * @param {{added: Array, resolved: Array}} diff ErrorTracker.update の結果
   * @param {{paragraphIndex:number, offset:number}|null} cursor カーソル位置(段落番号と段落内 offset)
   * @returns {{announce: Array, deferred: Array, resolved: Array, burst: boolean}}
   */
  decide(diff, cursor) {
    const resolvedKeys = new Set(diff.resolved.map((e) => e.key));
    for (const k of resolvedKeys) this.pending.delete(k);

    const candidates = [...this.pending.values(), ...diff.added];
    this.pending = new Map();
    const announce = [];
    const deferred = [];
    for (const e of candidates) {
      if (this.deferWhileTyping && isBeingTyped(e, cursor)) {
        deferred.push(e);
        this.pending.set(e.key, e);
      } else {
        announce.push(e);
      }
    }
    return {
      announce,
      deferred,
      resolved: this.announceResolved ? diff.resolved : [],
      burst: announce.length >= this.burstThreshold,
    };
  }

  clear() {
    this.pending.clear();
  }
}

/** カーソルが誤りの範囲内か、その直後(まだ区切り文字を打っていない)なら true */
export function isBeingTyped(error, cursor) {
  if (!cursor) return false;
  if (cursor.paragraphIndex !== error.paragraphIndex) return false;
  const start = error.offsetInParagraph ?? error.offset;
  const end = start + error.length;
  return cursor.offset >= start && cursor.offset <= end;
}
