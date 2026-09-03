// 評価用ログ
//
// 誤りの検出・通知・解消・ナビゲーションなどの出来事を時刻付きで記録し、
// 「通知から修正までの時間」などの指標を算出する。
// 条件(音の有無、読み上げモードなど)と参加者 ID を付与して CSV/JSON で書き出せる。

export const EventKind = Object.freeze({
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
  SCAN: 'scan',
  DETECTED: 'error_detected',
  NOTIFIED: 'error_notified',
  DEFERRED: 'error_deferred',
  RESOLVED: 'error_resolved',
  NAVIGATE: 'navigate',
  REPLACE: 'replace',
  SETTING: 'setting_changed',
  NOTE: 'note',
});

export class EvaluationLog {
  constructor({ now = () => Date.now(), participant = '', condition = '' } = {}) {
    this.now = now;
    this.participant = participant;
    this.condition = condition;
    this.events = [];
  }

  setContext({ participant, condition }) {
    if (participant !== undefined) this.participant = participant;
    if (condition !== undefined) this.condition = condition;
  }

  log(kind, data = {}) {
    const ev = {
      t: this.now(),
      participant: this.participant,
      condition: this.condition,
      kind,
      key: data.key || '',
      type: data.type || '',
      text: data.text || '',
      paragraphIndex: data.paragraphIndex ?? '',
      detail: data.detail || '',
    };
    this.events.push(ev);
    return ev;
  }

  clear() {
    this.events = [];
  }

  /** 誤りごとの検出・通知・解消時刻と所要時間 */
  perError() {
    const map = new Map();
    for (const ev of this.events) {
      if (!ev.key) continue;
      const rec = map.get(ev.key) || { key: ev.key, type: ev.type, text: ev.text, condition: ev.condition, participant: ev.participant };
      if (ev.kind === EventKind.DETECTED && rec.detectedAt === undefined) rec.detectedAt = ev.t;
      if (ev.kind === EventKind.NOTIFIED && rec.notifiedAt === undefined) rec.notifiedAt = ev.t;
      if (ev.kind === EventKind.RESOLVED) rec.resolvedAt = ev.t;
      map.set(ev.key, rec);
    }
    for (const rec of map.values()) {
      if (rec.notifiedAt !== undefined && rec.resolvedAt !== undefined) {
        rec.timeToFixFromNotifyMs = rec.resolvedAt - rec.notifiedAt;
      }
      if (rec.detectedAt !== undefined && rec.resolvedAt !== undefined) {
        rec.timeToFixFromDetectMs = rec.resolvedAt - rec.detectedAt;
      }
    }
    return [...map.values()];
  }

  summary() {
    const recs = this.perError();
    const fixed = recs.filter((r) => r.timeToFixFromNotifyMs !== undefined);
    const times = fixed.map((r) => r.timeToFixFromNotifyMs).sort((a, b) => a - b);
    const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const median = times.length ? (times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2) : null;
    return {
      participant: this.participant,
      condition: this.condition,
      detected: recs.length,
      notified: recs.filter((r) => r.notifiedAt !== undefined).length,
      resolved: recs.filter((r) => r.resolvedAt !== undefined).length,
      unresolved: recs.filter((r) => r.resolvedAt === undefined).length,
      meanTimeToFixMs: mean,
      medianTimeToFixMs: median,
      events: this.events.length,
    };
  }

  toJSON() {
    return { participant: this.participant, condition: this.condition, events: this.events, perError: this.perError(), summary: this.summary() };
  }

  toCSV() {
    const cols = ['t', 'iso', 'participant', 'condition', 'kind', 'key', 'type', 'text', 'paragraphIndex', 'detail'];
    const lines = [cols.join(',')];
    for (const ev of this.events) {
      const row = { ...ev, iso: new Date(ev.t).toISOString() };
      lines.push(cols.map((c) => csvCell(row[c])).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  perErrorCSV() {
    const cols = ['participant', 'condition', 'key', 'type', 'text', 'detectedAt', 'notifiedAt', 'resolvedAt', 'timeToFixFromNotifyMs', 'timeToFixFromDetectMs'];
    const lines = [cols.join(',')];
    for (const r of this.perError()) lines.push(cols.map((c) => csvCell(r[c])).join(','));
    return lines.join('\r\n') + '\r\n';
  }
}

export function csvCell(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
