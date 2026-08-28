/*
 * keymap.js - キー割当ての定義と解決
 *
 * すべて Alt との同時押し（固定キー方式では Alt を押して離してから単独押し）。
 * Chrome / Edge を前提とし、ブラウザが奪う Alt+D（アドレスバー）、Alt+E / Alt+F
 * （メニュー）、Alt+Home、Alt+左右矢印 は使用しない。
 *
 * 照合は次の順で行う:
 *   1. event.key（文字）… JIS でも US でもほぼこれで解決できる
 *   2. event.code（物理キー）… macOS の Option 合成文字や IME 環境の保険。
 *      記号キーは JIS と US で位置が違うため、layout 設定（auto/jis/us）で切替える。
 */
(function (global) {
  'use strict';

  /**
   * @type {Array<{group:string, action:string, keyLabel:string, desc:string,
   *               keys:string[], code?:string, codeJis?:string, codeUs?:string}>}
   */
  var ENTRIES = [
    // ── 問題文（上段、左から右へ） ────────────────────────────────
    { group: '問題文', action: 'readAll',        keyLabel: 'Y', desc: '問題文の全文を読む',           keys: ['y'], code: 'KeyY' },
    { group: '問題文', action: 'readSentence1',  keyLabel: 'U', desc: '問題文の1センテンス目',        keys: ['u'], code: 'KeyU' },
    { group: '問題文', action: 'readSentence2',  keyLabel: 'I', desc: '問題文の2センテンス目',        keys: ['i'], code: 'KeyI' },
    { group: '問題文', action: 'readSentence3',  keyLabel: 'O', desc: '問題文の3センテンス目',        keys: ['o'], code: 'KeyO' },
    { group: '問題文', action: 'readSentence4',  keyLabel: 'P', desc: '問題文の4センテンス目',        keys: ['p'], code: 'KeyP' },
    { group: '問題文', action: 'readSentence5',  keyLabel: '@', desc: '問題文の5センテンス目',        keys: ['@'], codeJis: 'BracketLeft',  codeUs: 'Quote' },
    { group: '問題文', action: 'readNextSentence', keyLabel: '[', desc: '次のセンテンスを読む（6文目以降はここで送る）', keys: ['['], codeJis: 'BracketRight', codeUs: 'BracketLeft' },
    { group: '問題文', action: 'readNextFigure',   keyLabel: ']', desc: '図の説明を読む（図が複数あれば押すたびに次の図へ）', keys: [']'], codeJis: 'Backslash',    codeUs: 'BracketRight' },

    // ── 選択肢を読む（中段） ──────────────────────────────────────
    { group: '選択肢を読む', action: 'readChoice0', keyLabel: 'J', desc: '選択肢アを読む', keys: ['j'], code: 'KeyJ' },
    { group: '選択肢を読む', action: 'readChoice1', keyLabel: 'K', desc: '選択肢イを読む', keys: ['k'], code: 'KeyK' },
    { group: '選択肢を読む', action: 'readChoice2', keyLabel: 'L', desc: '選択肢ウを読む', keys: ['l'], code: 'KeyL' },
    { group: '選択肢を読む', action: 'readChoice3', keyLabel: ';', desc: '選択肢エを読む', keys: [';'], code: 'Semicolon' },

    // ── 解答する（下段） ──────────────────────────────────────────
    { group: '解答する', action: 'answer0', keyLabel: 'M', desc: '解答アを選択', keys: ['m'], code: 'KeyM' },
    { group: '解答する', action: 'answer1', keyLabel: ',', desc: '解答イを選択', keys: [','], code: 'Comma' },
    { group: '解答する', action: 'answer2', keyLabel: '.', desc: '解答ウを選択', keys: ['.'], code: 'Period' },
    { group: '解答する', action: 'answer3', keyLabel: '/', desc: '解答エを選択', keys: ['/'], code: 'Slash' },
    { group: '解答する', action: 'clearAnswer', keyLabel: 'C', desc: '選択を解除', keys: ['c'], code: 'KeyC' },

    // ── 移動（左手） ──────────────────────────────────────────────
    { group: '移動', action: 'nextQuestion',      keyLabel: 'N', desc: '次の問題',           keys: ['n'], code: 'KeyN' },
    { group: '移動', action: 'prevQuestion',      keyLabel: 'B', desc: '前の問題',           keys: ['b'], code: 'KeyB' },
    { group: '移動', action: 'firstQuestion',     keyLabel: 'A', desc: '問題1番へ',          keys: ['a'], code: 'KeyA' },
    { group: '移動', action: 'lastQuestion',      keyLabel: 'S', desc: '最終問題へ',          keys: ['s'], code: 'KeyS' },
    { group: '移動', action: 'nextUnanswered',    keyLabel: 'X', desc: '後ろの未回答問題へ',   keys: ['x'], code: 'KeyX' },
    { group: '移動', action: 'prevUnanswered',    keyLabel: 'Z', desc: '前の未回答問題へ',     keys: ['z'], code: 'KeyZ' },

    // ── 情報を聞く ────────────────────────────────────────────────
    { group: '情報を聞く', action: 'readStatus',    keyLabel: 'R', desc: '現在の状態を読む（例「問23、100問中。イを選択中」）', keys: ['r'], code: 'KeyR' },
    { group: '情報を聞く', action: 'readTime',      keyLabel: 'T', desc: '残り時間',            keys: ['t'], code: 'KeyT' },
    { group: '情報を聞く', action: 'readUnanswered', keyLabel: 'G', desc: '未回答問題の番号をすべて聞く', keys: ['g'], code: 'KeyG' },
    { group: '情報を聞く', action: 'readKeyHelp',   keyLabel: 'H', desc: 'キー一覧を読む',       keys: ['h'], code: 'KeyH' },
    { group: '情報を聞く', action: 'quit',          keyLabel: 'Q', desc: '終了',               keys: ['q'], code: 'KeyQ' }
  ];

  var GROUP_ORDER = ['問題文', '選択肢を読む', '解答する', '移動', '情報を聞く'];

  /* ブラウザに予約されていて使ってはいけない組み合わせ（説明・検証用） */
  var RESERVED = [
    { keyLabel: 'D', reason: 'アドレスバーへ移動' },
    { keyLabel: 'E', reason: 'ブラウザメニュー' },
    { keyLabel: 'F', reason: 'ブラウザメニュー' },
    { keyLabel: 'Home', reason: 'ホームページへ移動' },
    { keyLabel: '←', reason: '戻る' },
    { keyLabel: '→', reason: '進む' }
  ];

  /* ---- 照合テーブルの構築 -------------------------------------------- */
  var byKey = Object.create(null);
  ENTRIES.forEach(function (e) {
    e.keys.forEach(function (k) { byKey[k] = e; });
  });

  function codeFor(entry, layout) {
    if (entry.code) return entry.code;
    return layout === 'us' ? entry.codeUs : entry.codeJis;
  }

  /** レイアウト自動判定の結果（'jis' | 'us' | null） */
  var detectedLayout = null;

  /**
   * 押されたキーから物理配列を推定する。記号キーの key と code の対応で判る。
   * 例: key='@' かつ code='BracketLeft' なら JIS、key='[' かつ code='BracketLeft' なら US。
   * 判定材料が現れるたびに更新する（配列を切り替えた場合に追随できるように）。
   */
  function detectLayout(ev) {
    if (ev.code === 'BracketLeft') {
      if (ev.key === '@') detectedLayout = 'jis';
      else if (ev.key === '[') detectedLayout = 'us';
    } else if (ev.code === 'BracketRight') {
      if (ev.key === '[') detectedLayout = 'jis';
      else if (ev.key === ']') detectedLayout = 'us';
    }
    return detectedLayout;
  }

  /**
   * KeyboardEvent から実行すべき action 名を返す。該当なしなら null。
   * @param {KeyboardEvent} ev
   * @param {'auto'|'jis'|'us'} layoutSetting
   */
  function resolve(ev, layoutSetting) {
    detectLayout(ev);

    // 1) 文字での照合
    if (typeof ev.key === 'string' && ev.key.length === 1) {
      var hit = byKey[ev.key.toLowerCase()];
      if (hit) return hit.action;
    }

    // 2) 物理キーでの照合
    var layout = layoutSetting === 'auto' ? (detectedLayout || 'jis') : layoutSetting;
    for (var i = 0; i < ENTRIES.length; i++) {
      if (codeFor(ENTRIES[i], layout) === ev.code) return ENTRIES[i].action;
    }
    return null;
  }

  /** グループごとにまとめた一覧を返す（画面表示・読み上げ用） */
  function grouped() {
    return GROUP_ORDER.map(function (g) {
      return {
        group: g,
        entries: ENTRIES.filter(function (e) { return e.group === g; })
      };
    });
  }

  /** キー一覧の読み上げ文を組み立てる */
  function helpText() {
    var parts = ['キー一覧です。すべて Alt キーと同時に押します。'];
    grouped().forEach(function (g) {
      parts.push(g.group + '。');
      g.entries.forEach(function (e) {
        parts.push('Alt プラス ' + spoken(e.keyLabel) + '、' + e.desc + '。');
      });
    });
    return parts.join(' ');
  }

  /** 記号キーは音声で判りにくいので読みを補う */
  var SPOKEN = {
    '@': 'アットマーク', '[': '左角かっこ', ']': '右角かっこ',
    ';': 'セミコロン', ',': 'カンマ', '.': 'ピリオド', '/': 'スラッシュ'
  };
  function spoken(label) { return SPOKEN[label] || label; }

  global.IPExamKeymap = {
    entries: ENTRIES,
    grouped: grouped,
    resolve: resolve,
    helpText: helpText,
    spoken: spoken,
    reserved: RESERVED,
    get detectedLayout() { return detectedLayout; }
  };
})(window);
