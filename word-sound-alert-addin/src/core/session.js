// 検査セッション(Office 非依存の中核)
//
// 段落テキストとカーソル位置を受け取り、
//   検査 -> 差分判定 -> 通知判断 -> 音/読み上げ/画面通知 -> ログ
// を一巡させる。Word 用タスクペインとブラウザ用デモページの両方から使う。

import { joinParagraphs, ErrorTracker } from './tracker.js';
import { NotificationPolicy } from './policy.js';
import { positionToPan } from './sound.js';
import { buildUtterances, buildBurstUtterance, buildResolvedUtterance } from './speech.js';
import { EventKind } from './evalLog.js';

export const DEFAULT_SETTINGS = Object.freeze({
  checker: 'builtin', // 'builtin' | 'languagetool' | 'both'
  languageToolEndpoint: 'https://api.languagetool.org/v2/check',
  language: 'auto',
  soundEnabled: true,
  soundPreset: 'default',
  volume: 0.8,
  soundSpelling: true,
  soundGrammar: true,
  soundStyle: false,
  soundResolved: true,
  stereoPan: false,
  speechMode: 'word', // none | type | word | spell
  speechRate: 1.1,
  liveRegion: true,
  annotations: true,
  deferWhileTyping: true,
  burstThreshold: 3,
  minIntervalMs: 350,
  pollIntervalMs: 1500,
  participant: '',
  condition: '',
});

export class CheckSession {
  /**
   * @param {object} deps
   * @param {{check(text, opts): Promise<Array>}} deps.checker
   * @param {import('./sound.js').EarconPlayer} deps.player
   * @param {import('./speech.js').Speaker} deps.speaker
   * @param {import('./evalLog.js').EvaluationLog} deps.log
   * @param {(text:string)=>void} [deps.announce] 画面上のライブリージョンなどへの通知
   * @param {object} [deps.settings]
   * @param {() => number} [deps.now]
   */
  constructor({ checker, player, speaker, log, announce = () => {}, settings = {}, now = () => Date.now(), sleep = defaultSleep }) {
    this.checker = checker;
    this.player = player;
    this.speaker = speaker;
    this.log = log;
    this.announce = announce;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.now = now;
    this.sleep = sleep;
    this.tracker = new ErrorTracker();
    this.policy = new NotificationPolicy({
      burstThreshold: this.settings.burstThreshold,
      deferWhileTyping: this.settings.deferWhileTyping,
      announceResolved: this.settings.soundResolved,
    });
    this.queue = Promise.resolve();
    this.lastResult = null;
    this.lastError = null;
    this.listeners = new Set();
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this.policy.burstThreshold = this.settings.burstThreshold;
    this.policy.deferWhileTyping = this.settings.deferWhileTyping;
    this.policy.announceResolved = this.settings.soundResolved;
    if (this.player) {
      this.player.setPreset(this.settings.soundPreset);
      this.player.setVolume(this.settings.volume);
      this.player.enabled = this.settings.soundEnabled;
    }
    if (this.speaker) this.speaker.rate = this.settings.speechRate;
    this.log.setContext({ participant: this.settings.participant, condition: this.settings.condition });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  /** 現在追跡中の誤り一覧(位置順) */
  get errors() {
    return this.tracker.list();
  }

  /**
   * 1 回の検査サイクル。
   * @param {string[]} paragraphTexts
   * @param {{paragraphIndex:number, offset:number}|null} cursor
   * @param {{paragraphIds?: string[]}} [meta]
   */
  async scan(paragraphTexts, cursor = null, meta = {}) {
    const { text, locate } = joinParagraphs(paragraphTexts);
    let raw;
    try {
      raw = await this.checker.check(text, { language: this.settings.language });
      this.lastError = null;
    } catch (err) {
      this.lastError = err;
      this.emit();
      throw err;
    }
    const errors = raw.map((e) => {
      const loc = locate(e.offset);
      return {
        ...e,
        paragraphIndex: loc.paragraphIndex,
        offsetInParagraph: loc.offsetInParagraph,
        paragraphId: meta.paragraphIds ? meta.paragraphIds[loc.paragraphIndex] : undefined,
        paragraphLength: paragraphTexts[loc.paragraphIndex].length,
      };
    });
    const diff = this.tracker.update(errors);
    this.log.log(EventKind.SCAN, { detail: `paragraphs=${paragraphTexts.length};errors=${errors.length};added=${diff.added.length};resolved=${diff.resolved.length}` });
    for (const e of diff.added) this.log.log(EventKind.DETECTED, e);
    for (const e of diff.resolved) this.log.log(EventKind.RESOLVED, e);

    const decision = this.policy.decide(diff, cursor);
    for (const e of decision.deferred) this.log.log(EventKind.DEFERRED, e);

    const result = { diff, decision, errors: diff.current };
    this.lastResult = result;
    this.emit();
    this.enqueueNotifications(decision);
    return result;
  }

  /** 通知を直列に(音が重ならないように)実行する。 */
  enqueueNotifications(decision) {
    this.queue = this.queue.then(() => this.notify(decision)).catch(() => {});
    return this.queue;
  }

  async notify(decision) {
    const s = this.settings;
    const toAnnounce = decision.announce.filter((e) => this.soundEnabledFor(e.type) || s.speechMode !== 'none' || s.liveRegion);
    if (toAnnounce.length === 0 && decision.resolved.length === 0) return;

    if (toAnnounce.length > 0 && decision.burst) {
      const n = toAnnounce.length;
      if (s.soundEnabled) await this.wait(this.player.play('multiple'));
      this.announce(`${n}件の誤りがあります`);
      if (s.speechMode !== 'none' && this.speaker) await this.speaker.speak(buildBurstUtterance(n));
      for (const e of toAnnounce) this.log.log(EventKind.NOTIFIED, { ...e, detail: 'burst' });
    } else {
      for (const e of toAnnounce) {
        const pan = s.stereoPan ? positionToPan(e.offsetInParagraph, e.paragraphLength) : 0;
        let dur = 0;
        if (s.soundEnabled && this.soundEnabledFor(e.type)) dur = this.player.play(e.type, { pan });
        this.announce(describeError(e));
        this.log.log(EventKind.NOTIFIED, e);
        await this.wait(dur);
        if (s.speechMode !== 'none' && this.speaker) await this.speaker.speak(buildUtterances(e, s.speechMode));
        await this.sleep(s.minIntervalMs);
      }
    }

    if (decision.resolved.length > 0 && s.soundResolved) {
      if (s.soundEnabled) await this.wait(this.player.play('resolved'));
      if (s.speechMode !== 'none' && this.speaker && decision.announce.length === 0) {
        await this.speaker.speak(buildResolvedUtterance());
      }
      this.announce(decision.resolved.length === 1 ? '修正されました' : `${decision.resolved.length}件が修正されました`);
    }
  }

  soundEnabledFor(type) {
    const s = this.settings;
    if (type === 'spelling') return s.soundSpelling;
    if (type === 'grammar') return s.soundGrammar;
    if (type === 'style') return s.soundStyle;
    return true;
  }

  async wait(seconds) {
    if (seconds > 0) await this.sleep(Math.round(seconds * 1000));
  }

  reset() {
    this.tracker.reset();
    this.policy.clear();
    this.lastResult = null;
    this.emit();
  }
}

export function describeError(e) {
  const label = { spelling: 'スペル', grammar: '文法', style: '表記' }[e.type] || '誤り';
  const sug = e.suggestions && e.suggestions.length ? `。候補: ${e.suggestions.slice(0, 3).join('、')}` : '';
  return `${label}: ${e.text}${e.message ? '(' + e.message + ')' : ''}${sug}`;
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
