/* global Office, Word */
// Word 用タスクペイン: Word 文書との橋渡しと UI
import { BuiltinChecker, LanguageToolChecker, CompositeChecker, parseDictionaryText, ERROR_TYPE_LABEL } from '../core/checker.js';
import { EarconPlayer, EARCON_PRESETS } from '../core/sound.js';
import { Speaker } from '../core/speech.js';
import { EvaluationLog, EventKind } from '../core/evalLog.js';
import { CheckSession, DEFAULT_SETTINGS, describeError } from '../core/session.js';

const SETTINGS_KEY = 'wsa.settings.v1';
const DICT_KEY = 'wsa.dictionary.v1';
const SAMPLE_DICT = `# 誤り,正しい語
teh,the
recieve,receive
seperate,separate
definately,definitely
occured,occurred
enviroment,environment
こんにちわ,こんにちは
シュミレーション,シミュレーション
うる覚え,うろ覚え
的を得る,的を射る`;

// ---------- 設定の保存 ----------
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (_) {
    /* ignore */
  }
}
function loadDictionaryText() {
  try {
    return localStorage.getItem(DICT_KEY) ?? SAMPLE_DICT;
  } catch (_) {
    return SAMPLE_DICT;
  }
}

// ---------- チェッカーの組み立て ----------
function buildChecker(settings, dictText) {
  const builtin = new BuiltinChecker({ misspellings: parseDictionaryText(dictText) });
  if (settings.checker === 'builtin') return builtin;
  const lt = new LanguageToolChecker({ endpoint: settings.languageToolEndpoint, language: settings.language });
  if (settings.checker === 'languagetool') return lt;
  return new CompositeChecker([builtin, lt]);
}

// ---------- Word との橋渡し ----------
class WordBridge {
  constructor() {
    this.hasIds = isSet('WordApi', '1.6');
    this.hasEvents = isSet('WordApi', '1.6');
    this.hasAnnotations = isSet('WordApi', '1.7');
    this.annotationSignatures = new Map(); // paragraphKey -> signature
    this.handlers = [];
  }

  /** 段落テキストとカーソル位置をまとめて読む。 */
  async read() {
    return Word.run(async (context) => {
      const paras = context.document.body.paragraphs;
      paras.load(this.hasIds ? 'items/text,items/uniqueLocalId' : 'items/text');
      const sel = context.document.getSelection();
      const selPara = sel.paragraphs.getFirstOrNullObject();
      const upto = selPara.getRange('Start').expandTo(sel.getRange('End'));
      upto.load('text');
      selPara.load(this.hasIds ? 'uniqueLocalId,text' : 'text');
      await context.sync();

      const texts = paras.items.map((p) => p.text);
      const ids = this.hasIds ? paras.items.map((p) => p.uniqueLocalId) : texts.map((_, i) => String(i));
      let cursor = null;
      if (!selPara.isNullObject) {
        let idx = -1;
        if (this.hasIds) idx = ids.indexOf(selPara.uniqueLocalId);
        if (idx < 0) idx = texts.indexOf(selPara.text);
        if (idx >= 0) cursor = { paragraphIndex: idx, offset: upto.isNullObject ? 0 : upto.text.length };
      }
      return { texts, ids, cursor };
    });
  }

  /** 誤りの箇所を本文で選択する。 */
  async select(error, mode = 'Select') {
    return Word.run(async (context) => {
      const para = await this.resolveParagraph(context, error);
      if (!para) return false;
      const searchText = error.text.slice(0, 255);
      if (!searchText.trim()) {
        para.select('Start');
        await context.sync();
        return true;
      }
      const results = para.search(searchText, { matchCase: true });
      results.load('items');
      para.load('text');
      await context.sync();
      const n = countOccurrences(para.text.slice(0, error.offsetInParagraph), searchText);
      const target = results.items[n] || results.items[0];
      if (!target) {
        para.select('Start');
      } else {
        target.select(mode);
      }
      await context.sync();
      return !!target;
    });
  }

  /** 誤りの箇所を候補で置き換える。 */
  async replace(error, replacement) {
    return Word.run(async (context) => {
      const para = await this.resolveParagraph(context, error);
      if (!para) return false;
      const results = para.search(error.text.slice(0, 255), { matchCase: true });
      results.load('items');
      para.load('text');
      await context.sync();
      const n = countOccurrences(para.text.slice(0, error.offsetInParagraph), error.text);
      const target = results.items[n];
      if (!target) return false;
      target.insertText(replacement, 'Replace');
      await context.sync();
      return true;
    });
  }

  async resolveParagraph(context, error) {
    const paras = context.document.body.paragraphs;
    paras.load(this.hasIds ? 'items/uniqueLocalId' : 'items/text');
    await context.sync();
    let idx = -1;
    if (this.hasIds && error.paragraphId) idx = paras.items.findIndex((p) => p.uniqueLocalId === error.paragraphId);
    if (idx < 0 && error.paragraphIndex < paras.items.length) idx = error.paragraphIndex;
    return idx >= 0 ? paras.items[idx] : null;
  }

  /**
   * 段落ごとの誤りを注釈(批評)として挿入する。WordApi 1.7 が必要。
   * @param {string[]} ids 段落 ID(または index 文字列)
   * @param {Array} errors
   */
  async annotate(ids, errors) {
    if (!this.hasAnnotations) return;
    const byPara = new Map();
    for (const e of errors) {
      const k = e.paragraphId ?? String(e.paragraphIndex);
      if (!byPara.has(k)) byPara.set(k, []);
      byPara.get(k).push(e);
    }
    const dirty = [];
    for (let i = 0; i < ids.length; i++) {
      const k = ids[i];
      const list = byPara.get(k) || [];
      const sig = list.map((e) => `${e.type}:${e.offsetInParagraph}:${e.length}`).join(',');
      if (this.annotationSignatures.get(k) !== sig) {
        dirty.push({ index: i, key: k, list, sig });
      }
    }
    for (const k of [...this.annotationSignatures.keys()]) {
      if (!ids.includes(k)) this.annotationSignatures.delete(k);
    }
    if (dirty.length === 0) return;
    try {
      await Word.run(async (context) => {
        const paras = context.document.body.paragraphs;
        paras.load(this.hasIds ? 'items/uniqueLocalId' : 'items/text');
        await context.sync();
        const targets = dirty.filter((d) => d.index < paras.items.length).map((d) => ({ ...d, para: paras.items[d.index] }));
        const annSets = targets.map((t) => {
          const anns = t.para.getAnnotations();
          anns.load('items/id');
          return anns;
        });
        await context.sync();
        for (const anns of annSets) for (const a of anns.items) a.delete();
        await context.sync();
        for (const t of targets) {
          if (t.list.length === 0) continue;
          t.para.insertAnnotations({
            critiques: t.list.map((e) => ({
              colorScheme: colorSchemeFor(e.type),
              start: e.offsetInParagraph,
              length: e.length,
              popupOptions: {
                brandingTextResourceId: 'Annotation.Branding',
                titleResourceId: 'Annotation.Title',
                subtitleResourceId: 'Annotation.Subtitle',
                suggestions: (e.suggestions || []).slice(0, 3),
              },
            })),
          });
        }
        await context.sync();
        for (const t of targets) this.annotationSignatures.set(t.key, t.sig);
      });
    } catch (err) {
      console.warn('注釈の挿入に失敗しました。注釈機能を無効にします。', err);
      this.hasAnnotations = false;
    }
  }

  async clearAnnotations() {
    if (!isSet('WordApi', '1.7')) return;
    this.annotationSignatures.clear();
    try {
      await Word.run(async (context) => {
        const paras = context.document.body.paragraphs;
        paras.load(this.hasIds ? 'items/uniqueLocalId' : 'items/text');
        await context.sync();
        const sets = paras.items.map((p) => {
          const a = p.getAnnotations();
          a.load('items/id');
          return a;
        });
        await context.sync();
        for (const s of sets) for (const a of s.items) a.delete();
        await context.sync();
      });
    } catch (_) {
      /* ignore */
    }
  }

  /** 文書変更イベントを購読する。 */
  async subscribe(onChange, onPopupAction) {
    if (!this.hasEvents) return false;
    try {
      await Word.run(async (context) => {
        const doc = context.document;
        this.handlers.push(doc.onParagraphChanged.add(onChange));
        this.handlers.push(doc.onParagraphAdded.add(onChange));
        this.handlers.push(doc.onParagraphDeleted.add(onChange));
        if (this.hasAnnotations && onPopupAction) {
          this.handlers.push(doc.onAnnotationPopupAction.add(onPopupAction));
        }
        await context.sync();
      });
      return true;
    } catch (err) {
      console.warn('イベント購読に失敗。ポーリングのみで動作します。', err);
      this.hasEvents = false;
      return false;
    }
  }

  async unsubscribe() {
    const hs = this.handlers;
    this.handlers = [];
    for (const h of hs) {
      try {
        await Word.run(h.context, async (context) => {
          h.remove();
          await context.sync();
        });
      } catch (_) {
        /* ignore */
      }
    }
  }

  /** 注釈のポップアップで候補が選ばれたときに置換する。 */
  async applyPopupSuggestion(args) {
    if (!args || args.action !== 'Accept' || !args.critiqueSuggestion) return false;
    return Word.run(async (context) => {
      const ann = context.document.getAnnotationById(args.id);
      ann.load('critiqueAnnotation');
      await context.sync();
      const range = ann.critiqueAnnotation.range;
      range.insertText(args.critiqueSuggestion, 'Replace');
      await context.sync();
      return true;
    });
  }
}

function isSet(name, version) {
  try {
    return Office.context.requirements.isSetSupported(name, version);
  } catch (_) {
    return false;
  }
}
function colorSchemeFor(type) {
  if (type === 'spelling') return Word.CritiqueColorScheme.red;
  if (type === 'grammar') return Word.CritiqueColorScheme.blue;
  return Word.CritiqueColorScheme.green;
}
function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = -1;
  while ((i = hay.indexOf(needle, i + 1)) >= 0) n++;
  return n;
}

// ---------- アプリ本体 ----------
class App {
  constructor() {
    this.settings = loadSettings();
    this.dictText = loadDictionaryText();
    this.bridge = new WordBridge();
    this.player = new EarconPlayer({ preset: this.settings.soundPreset, volume: this.settings.volume });
    this.speaker = new Speaker({ rate: this.settings.speechRate });
    this.log = new EvaluationLog({ participant: this.settings.participant, condition: this.settings.condition });
    this.session = new CheckSession({
      checker: buildChecker(this.settings, this.dictText),
      player: this.player,
      speaker: this.speaker,
      log: this.log,
      announce: (t) => this.announce(t),
      settings: this.settings,
    });
    this.monitoring = false;
    this.busy = false;
    this.timer = null;
    this.debounceTimer = null;
    this.selectedIndex = -1;
    this.$ = (id) => document.getElementById(id);
  }

  init() {
    this.bindSettingsUI();
    this.bindButtons();
    this.session.onChange(() => this.renderErrors());
    this.renderErrors();
    this.$('dictionary').value = this.dictText;
    this.$('env').textContent = `WordApi: 段落ID/イベント ${this.bridge.hasIds ? '対応' : '非対応'}、注釈 ${this.bridge.hasAnnotations ? '対応' : '非対応'}、読み上げ ${this.speaker.available ? '対応' : '非対応'}`;
    this.setStatus('「サウンドを有効化」を押してから「監視を開始」してください。');
    this.log.log(EventKind.SESSION_START, { detail: navigator.userAgent });
  }

  // ---- UI ----
  bindSettingsUI() {
    const presetSel = this.$('soundPreset');
    for (const [name, p] of Object.entries(EARCON_PRESETS)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = p.label;
      presetSel.appendChild(o);
    }
    for (const el of document.querySelectorAll('[data-setting]')) {
      const key = el.dataset.setting;
      const v = this.settings[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
      el.addEventListener('change', () => {
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'number' || el.type === 'range') val = Number(el.value);
        else val = el.value;
        this.applySetting(key, val);
      });
    }
  }

  applySetting(key, val) {
    this.settings[key] = val;
    saveSettings(this.settings);
    this.session.updateSettings({ [key]: val });
    this.log.log(EventKind.SETTING, { detail: `${key}=${val}` });
    if (['checker', 'languageToolEndpoint', 'language'].includes(key)) {
      this.session.checker = buildChecker(this.settings, this.dictText);
    }
    if (key === 'pollIntervalMs' && this.monitoring) this.startTimer();
    if (key === 'annotations' && !val) this.bridge.clearAnnotations();
    if (key === 'liveRegion') this.$('live').setAttribute('aria-live', val ? 'assertive' : 'off');
  }

  bindButtons() {
    this.$('btn-unlock').addEventListener('click', async () => {
      const ok = await this.player.unlock();
      if (ok) {
        this.player.play('test');
        this.setStatus('サウンドを有効にしました。');
      } else {
        this.setStatus('この環境では効果音を再生できません。読み上げまたはライブリージョンをお使いください。');
      }
    });
    this.$('btn-toggle').addEventListener('click', () => (this.monitoring ? this.stop() : this.start()));
    this.$('btn-check').addEventListener('click', () => this.scan(true));
    this.$('btn-next').addEventListener('click', () => this.move(1));
    this.$('btn-prev').addEventListener('click', () => this.move(-1));
    this.$('btn-replace').addEventListener('click', () => this.replaceSelected());
    this.$('btn-test').addEventListener('click', async () => {
      await this.player.unlock();
      for (const k of ['spelling', 'grammar', 'style', 'resolved']) {
        const d = this.player.play(k);
        await sleep(d * 1000 + 300);
      }
    });
    this.$('btn-dict-apply').addEventListener('click', () => {
      this.dictText = this.$('dictionary').value;
      try {
        localStorage.setItem(DICT_KEY, this.dictText);
      } catch (_) {
        /* ignore */
      }
      this.session.checker = buildChecker(this.settings, this.dictText);
      this.setStatus(`辞書を適用しました(${Object.keys(parseDictionaryText(this.dictText)).length}語)。`);
      this.scan(false);
    });
    this.$('btn-dict-sample').addEventListener('click', () => {
      this.$('dictionary').value = SAMPLE_DICT;
    });
    this.$('btn-log-summary').addEventListener('click', () => {
      this.$('log-output').textContent = JSON.stringify(this.log.summary(), null, 2) + '\n\n' + this.log.perErrorCSV();
    });
    this.$('btn-log-copy').addEventListener('click', async () => {
      const ok = await copyText(this.log.toCSV());
      this.setStatus(ok ? 'CSV をクリップボードにコピーしました。' : 'コピーできませんでした。下の出力欄から手動でコピーしてください。');
      if (!ok) this.$('log-output').textContent = this.log.toCSV();
    });
    this.$('btn-log-download').addEventListener('click', () => this.download(`log_${this.fileStem()}.csv`, this.log.toCSV(), 'text/csv'));
    this.$('btn-log-json').addEventListener('click', () => this.download(`log_${this.fileStem()}.json`, JSON.stringify(this.log.toJSON(), null, 2), 'application/json'));
    this.$('btn-log-clear').addEventListener('click', () => {
      this.log.clear();
      this.$('log-output').textContent = '';
      this.setStatus('ログを消去しました。');
    });
    const list = this.$('error-list');
    list.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); this.selectIndex(this.selectedIndex + 1, false); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.selectIndex(this.selectedIndex - 1, false); }
      else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.jumpTo(this.selectedIndex); }
      else if (ev.key === 'Home') { ev.preventDefault(); this.selectIndex(0, false); }
      else if (ev.key === 'End') { ev.preventDefault(); this.selectIndex(this.session.errors.length - 1, false); }
    });
    list.addEventListener('click', (ev) => {
      const li = ev.target.closest('li');
      if (li) this.jumpTo(Number(li.dataset.index));
    });
  }

  fileStem() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${this.settings.participant || 'P'}_${this.settings.condition || 'C'}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  download(name, content, type) {
    try {
      const blob = new Blob([content], { type: type + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.setStatus(`${name} を保存しました(保存できない場合は「CSV をコピー」を使ってください)。`);
    } catch (err) {
      this.$('log-output').textContent = content;
      this.setStatus('保存できませんでした。出力欄の内容をコピーしてください。');
    }
  }

  setStatus(text) {
    this.$('status').textContent = text;
  }

  /** ライブリージョンへ通知。同じ文を続けて読ませるため一度空にする。 */
  announce(text) {
    if (!this.settings.liveRegion) return;
    const live = this.$('live');
    live.textContent = '';
    setTimeout(() => {
      live.textContent = text;
    }, 50);
  }

  renderErrors() {
    const list = this.$('error-list');
    const errors = this.session.errors;
    list.innerHTML = '';
    errors.forEach((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      li.id = `err-${i}`;
      li.setAttribute('aria-selected', String(i === this.selectedIndex));
      const label = ERROR_TYPE_LABEL[e.type] || e.type;
      li.innerHTML = `<span class="type ${e.type}">${label}</span><span class="word"></span><span class="msg"></span>`;
      li.querySelector('.word').textContent = e.text;
      li.querySelector('.msg').textContent = `${e.message}${e.suggestions && e.suggestions.length ? ' → ' + e.suggestions.slice(0, 3).join(' / ') : ''}(段落 ${e.paragraphIndex + 1})`;
      li.setAttribute('aria-label', `${label} ${e.text}。${e.message}。段落${e.paragraphIndex + 1}`);
      list.appendChild(li);
    });
    if (this.selectedIndex >= errors.length) this.selectedIndex = errors.length - 1;
    if (this.selectedIndex >= 0) list.setAttribute('aria-activedescendant', `err-${this.selectedIndex}`);
    else list.removeAttribute('aria-activedescendant');
    this.$('error-count').textContent = `${errors.length}件`;
    this.$('btn-replace').disabled = !(errors[this.selectedIndex] && errors[this.selectedIndex].suggestions && errors[this.selectedIndex].suggestions.length);
    if (this.session.lastError) this.setStatus(`検査エラー: ${this.session.lastError.message}`);
  }

  selectIndex(i, jump = true) {
    const errors = this.session.errors;
    if (errors.length === 0) {
      this.selectedIndex = -1;
      this.renderErrors();
      return;
    }
    this.selectedIndex = ((i % errors.length) + errors.length) % errors.length;
    this.renderErrors();
    const e = errors[this.selectedIndex];
    this.announce(`${this.selectedIndex + 1}件目。${describeError(e)}`);
    if (jump) this.jumpTo(this.selectedIndex);
  }

  async jumpTo(i) {
    const e = this.session.errors[i];
    if (!e) return;
    this.selectedIndex = i;
    this.renderErrors();
    try {
      const ok = await this.bridge.select(e);
      this.log.log(EventKind.NAVIGATE, { ...e, detail: ok ? 'selected' : 'not-found' });
      this.setStatus(`${describeError(e)} を選択しました。`);
    } catch (err) {
      this.setStatus(`移動できませんでした: ${err.message}`);
    }
  }

  move(delta) {
    if (this.session.errors.length === 0) {
      this.announce('誤りはありません');
      this.setStatus('誤りはありません。');
      return;
    }
    this.selectIndex(this.selectedIndex + delta, true);
  }

  async replaceSelected() {
    const e = this.session.errors[this.selectedIndex];
    if (!e || !e.suggestions || !e.suggestions.length) return;
    try {
      const ok = await this.bridge.replace(e, e.suggestions[0]);
      this.log.log(EventKind.REPLACE, { ...e, detail: ok ? e.suggestions[0] : 'failed' });
      this.setStatus(ok ? `「${e.text}」を「${e.suggestions[0]}」に置き換えました。` : '置き換える箇所が見つかりませんでした。');
      this.announce(ok ? `${e.suggestions[0]} に置き換えました` : '置き換えられませんでした');
      await this.scan(false);
    } catch (err) {
      this.setStatus(`置換に失敗: ${err.message}`);
    }
  }

  // ---- 監視 ----
  async start() {
    this.monitoring = true;
    const btn = this.$('btn-toggle');
    btn.textContent = '監視を停止';
    btn.setAttribute('aria-pressed', 'true');
    await this.bridge.subscribe(
      () => this.scheduleScan(),
      async (args) => {
        try {
          if (await this.bridge.applyPopupSuggestion(args)) {
            this.log.log(EventKind.REPLACE, { detail: `popup:${args.critiqueSuggestion}` });
            this.scheduleScan();
          }
        } catch (err) {
          console.warn(err);
        }
      }
    );
    this.startTimer();
    this.setStatus(`監視中です(${this.bridge.hasEvents ? 'イベント+' : ''}${this.settings.pollIntervalMs}ms 間隔)。`);
    this.announce('監視を開始しました');
    this.log.log(EventKind.NOTE, { detail: 'monitor:start' });
    await this.scan(false);
  }

  async stop() {
    this.monitoring = false;
    const btn = this.$('btn-toggle');
    btn.textContent = '監視を開始';
    btn.setAttribute('aria-pressed', 'false');
    clearInterval(this.timer);
    this.timer = null;
    await this.bridge.unsubscribe();
    this.setStatus('監視を停止しました。');
    this.announce('監視を停止しました');
    this.log.log(EventKind.NOTE, { detail: 'monitor:stop' });
  }

  startTimer() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.scan(false), Math.max(300, this.settings.pollIntervalMs));
  }

  scheduleScan() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.scan(false), 400);
  }

  async scan(manual) {
    if (this.busy) return;
    this.busy = true;
    try {
      const { texts, ids, cursor } = await this.bridge.read();
      const result = await this.session.scan(texts, cursor, { paragraphIds: ids });
      if (this.settings.annotations) await this.bridge.annotate(ids, result.errors);
      if (manual) {
        const n = result.errors.length;
        this.setStatus(n === 0 ? '誤りは見つかりませんでした。' : `${n}件の誤りがあります。`);
        if (n === 0) this.announce('誤りは見つかりませんでした');
        else if (result.decision.announce.length === 0) this.announce(`${n}件の誤りがあります`);
      }
    } catch (err) {
      console.error(err);
      this.setStatus(`検査に失敗しました: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

Office.onReady((info) => {
  const app = new App();
  window.app = app;
  if (info.host !== Office.HostType.Word) {
    document.getElementById('status').textContent = 'このアドインは Word 専用です。';
    return;
  }
  app.init();
});
