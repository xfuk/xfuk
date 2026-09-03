// ブラウザ版デモ: textarea を文書に見立てて中核コードを動かす
import { BuiltinChecker, LanguageToolChecker, CompositeChecker, parseDictionaryText, ERROR_TYPE_LABEL } from '../src/core/checker.js';
import { EarconPlayer, EARCON_PRESETS } from '../src/core/sound.js';
import { Speaker } from '../src/core/speech.js';
import { EvaluationLog, EventKind } from '../src/core/evalLog.js';
import { CheckSession, DEFAULT_SETTINGS, describeError } from '../src/core/session.js';
import { nthIndexOf } from '../src/core/tracker.js';

const SAMPLE_DICT = `teh,the
recieve,receive
tommorow,tomorrow
seperate,separate
こんにちわ,こんにちは
シュミレーション,シミュレーション`;

const $ = (id) => document.getElementById(id);
const settings = { ...DEFAULT_SETTINGS, soundStyle: true, pollIntervalMs: 800 };
let dictText = SAMPLE_DICT;

function buildChecker() {
  const builtin = new BuiltinChecker({ misspellings: parseDictionaryText(dictText) });
  if (settings.checker === 'builtin') return builtin;
  const lt = new LanguageToolChecker({ endpoint: settings.languageToolEndpoint, language: settings.language });
  return settings.checker === 'languagetool' ? lt : new CompositeChecker([builtin, lt]);
}

const player = new EarconPlayer({ preset: settings.soundPreset, volume: settings.volume });
const speaker = new Speaker({ rate: settings.speechRate });
const log = new EvaluationLog();
const session = new CheckSession({
  checker: buildChecker(),
  player,
  speaker,
  log,
  settings,
  announce: (t) => {
    if (!settings.liveRegion) return;
    const live = $('live');
    live.textContent = '';
    setTimeout(() => (live.textContent = t), 50);
  },
});
window.session = session;

// 文書(textarea)の読み取り
function readDoc() {
  const ta = $('doc');
  const texts = ta.value.split('\n');
  const end = ta.selectionEnd;
  let pos = 0;
  let cursor = null;
  for (let i = 0; i < texts.length; i++) {
    if (end <= pos + texts[i].length) {
      cursor = { paragraphIndex: i, offset: end - pos };
      break;
    }
    pos += texts[i].length + 1;
  }
  return { texts, cursor: document.activeElement === ta ? cursor : null };
}

let busy = false;
async function scan(manual) {
  if (busy) return;
  busy = true;
  try {
    const { texts, cursor } = readDoc();
    const r = await session.scan(texts, cursor);
    if (manual) $('status').textContent = r.errors.length ? `${r.errors.length}件の誤りがあります。` : '誤りは見つかりませんでした。';
  } catch (err) {
    $('status').textContent = `検査に失敗: ${err.message}`;
  } finally {
    busy = false;
  }
}

let selected = -1;
function render() {
  const list = $('error-list');
  list.innerHTML = '';
  session.errors.forEach((e, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === selected));
    li.dataset.index = i;
    li.innerHTML = `<span class="type ${e.type}">${ERROR_TYPE_LABEL[e.type]}</span><span class="word"></span><span class="msg"></span>`;
    li.querySelector('.word').textContent = e.text;
    li.querySelector('.msg').textContent = `${e.message}${e.suggestions.length ? ' → ' + e.suggestions.join(' / ') : ''}(行 ${e.paragraphIndex + 1})`;
    list.appendChild(li);
  });
  $('error-count').textContent = `${session.errors.length}件`;
}
session.onChange(render);

function jumpTo(i) {
  const e = session.errors[i];
  if (!e) return;
  selected = i;
  render();
  const ta = $('doc');
  const texts = ta.value.split('\n');
  let start = 0;
  for (let k = 0; k < e.paragraphIndex; k++) start += texts[k].length + 1;
  const lineStart = start;
  const occ = countBefore(texts[e.paragraphIndex].slice(0, e.offsetInParagraph), e.text);
  const idx = nthIndexOf(texts[e.paragraphIndex], e.text, occ);
  const at = lineStart + (idx >= 0 ? idx : e.offsetInParagraph);
  ta.focus();
  ta.setSelectionRange(at, at + e.length);
  log.log(EventKind.NAVIGATE, e);
  $('status').textContent = describeError(e);
}
function countBefore(hay, needle) {
  let n = 0;
  let i = -1;
  while ((i = hay.indexOf(needle, i + 1)) >= 0) n++;
  return n;
}

// UI
for (const [name, p] of Object.entries(EARCON_PRESETS)) {
  const o = document.createElement('option');
  o.value = name;
  o.textContent = p.label;
  $('soundPreset').appendChild(o);
}
for (const el of document.querySelectorAll('[data-setting]')) {
  const key = el.dataset.setting;
  if (el.type === 'checkbox') el.checked = !!settings[key];
  else el.value = settings[key] ?? '';
  el.addEventListener('change', () => {
    const val = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
    settings[key] = val;
    session.updateSettings({ [key]: val });
    if (['checker', 'languageToolEndpoint'].includes(key)) session.checker = buildChecker();
    if (key === 'pollIntervalMs' && timer) startTimer();
  });
}
$('dictionary').value = dictText;
$('btn-dict-apply').addEventListener('click', () => {
  dictText = $('dictionary').value;
  session.checker = buildChecker();
  scan(false);
});
$('btn-unlock').addEventListener('click', async () => {
  const ok = await player.unlock();
  if (ok) player.play('test');
  $('status').textContent = ok ? 'サウンドを有効にしました。' : '効果音を再生できません。';
});
$('btn-check').addEventListener('click', () => scan(true));
$('btn-test').addEventListener('click', async () => {
  await player.unlock();
  for (const k of ['spelling', 'grammar', 'style', 'resolved']) {
    const d = player.play(k);
    await new Promise((r) => setTimeout(r, d * 1000 + 300));
  }
});
let timer = null;
function startTimer() {
  clearInterval(timer);
  timer = setInterval(() => scan(false), settings.pollIntervalMs);
}
$('btn-toggle').addEventListener('click', () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    $('btn-toggle').textContent = '監視を開始';
    $('btn-toggle').setAttribute('aria-pressed', 'false');
    $('status').textContent = '監視を停止しました。';
  } else {
    startTimer();
    $('btn-toggle').textContent = '監視を停止';
    $('btn-toggle').setAttribute('aria-pressed', 'true');
    $('status').textContent = '監視中です。';
    scan(false);
  }
});
$('doc').addEventListener('input', () => {
  if (timer) {
    clearTimeout(window.__deb);
    window.__deb = setTimeout(() => scan(false), 300);
  }
});
$('error-list').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (li) jumpTo(Number(li.dataset.index));
});
$('error-list').addEventListener('keydown', (ev) => {
  const n = session.errors.length;
  if (!n) return;
  if (ev.key === 'ArrowDown') { ev.preventDefault(); selected = (selected + 1) % n; render(); }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); selected = (selected - 1 + n) % n; render(); }
  if (ev.key === 'Enter') { ev.preventDefault(); jumpTo(selected); }
});
$('btn-log-summary').addEventListener('click', () => ($('log-output').textContent = JSON.stringify(log.summary(), null, 2) + '\n\n' + log.perErrorCSV()));
$('btn-log-csv').addEventListener('click', () => ($('log-output').textContent = log.toCSV()));
$('btn-log-download').addEventListener('click', () => {
  const blob = new Blob([log.toCSV()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `log_${settings.participant || 'P'}_${settings.condition || 'C'}.csv`;
  a.click();
});
$('btn-log-clear').addEventListener('click', () => {
  log.clear();
  $('log-output').textContent = '';
});
log.log(EventKind.SESSION_START, { detail: 'demo' });
render();
