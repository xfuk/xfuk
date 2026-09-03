// 誤り検出器（チェッカー）
//
// Office.js (Word JavaScript API) は Word 標準のスペルチェック/文章校正の結果
// (VBA/COM の Range.SpellingErrors に相当するもの) を公開していない。
// そのため本アドインでは、文書テキストを取得して独自に検査し、その結果を
// 音・読み上げ・注釈(下線)で通知する。
//
// すべてのチェッカーは次の形式の配列を返す。
//   {
//     type: 'spelling' | 'grammar' | 'style',
//     offset: number,        // 検査対象テキスト内の開始位置(UTF-16 コード単位)
//     length: number,        // 長さ
//     text: string,          // 誤り箇所の文字列
//     message: string,       // 説明(日本語)
//     suggestions: string[], // 修正候補
//     source: string         // 検出元('builtin', 'languagetool' など)
//   }

export const ErrorType = Object.freeze({
  SPELLING: 'spelling',
  GRAMMAR: 'grammar',
  STYLE: 'style',
});

export const ERROR_TYPE_LABEL = Object.freeze({
  spelling: 'スペル',
  grammar: '文法',
  style: '表記',
});

const LATIN_WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

function isAscii(s) {
  return /^[\x00-\x7F]*$/.test(s);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 内蔵ルールの定義。研究目的で差し替えやすいようデータとして持つ。
 * 各ルールは { id, type, pattern(RegExp, g フラグ必須), message, suggest?(match)=>string[] }
 */
export const DEFAULT_RULES = [
  {
    id: 'repeated-word',
    type: ErrorType.GRAMMAR,
    pattern: /\b([A-Za-z]+)\s+\1\b/gi,
    message: '同じ単語が連続しています',
    suggest: (m) => [m[1]],
  },
  {
    id: 'lowercase-sentence-start',
    type: ErrorType.GRAMMAR,
    pattern: /(?<=[.!?]\s+)([a-z][a-z']*)/g,
    message: '文頭が小文字です',
    suggest: (m) => [m[1].charAt(0).toUpperCase() + m[1].slice(1)],
  },
  {
    id: 'article-a-before-vowel',
    type: ErrorType.GRAMMAR,
    pattern: /\b(a)\s+(?=[aeiouAEIOU][a-z])/g,
    message: '母音の前の冠詞は an を使います',
    suggest: () => ['an'],
  },
  {
    id: 'article-an-before-consonant',
    type: ErrorType.GRAMMAR,
    pattern: /\b(an)\s+(?=[b-df-hj-np-tv-zB-DF-HJ-NP-TV-Z][a-z])/g,
    message: '子音の前の冠詞は a を使います',
    suggest: () => ['a'],
  },
  {
    id: 'double-space',
    type: ErrorType.STYLE,
    pattern: /(?<=\S) {2,}(?=\S)/g,
    message: '空白が連続しています',
    suggest: () => [' '],
  },
  {
    id: 'space-before-punct',
    type: ErrorType.STYLE,
    pattern: /(?<=\w) +(?=[,.!?;:])/g,
    message: '句読点の前に空白があります',
    suggest: () => [''],
  },
  {
    id: 'repeated-ja-punct',
    type: ErrorType.STYLE,
    pattern: /([、。，．])\1+/g,
    message: '句読点が連続しています',
    suggest: (m) => [m[1]],
  },
  {
    id: 'mixed-ja-punct',
    type: ErrorType.STYLE,
    pattern: /[、。][，．]|[，．][、。]/g,
    message: '全角の句読点の種類が混在しています',
  },
];

/**
 * 内蔵チェッカー。ネットワーク不要。
 * - rules: 正規表現ルール(既定 DEFAULT_RULES)
 * - misspellings: { 誤り: 正しい語 } の辞書。ASCII の語は単語単位、日本語などは部分一致で探す。
 *   評価実験で「意図的に埋め込む誤り」を確実に検出したい場合に便利。
 * - wordlist: 正しい語の集合(Set または配列)。指定するとこれに無い英単語をスペルミスとみなす。
 */
export class BuiltinChecker {
  constructor({ rules = DEFAULT_RULES, misspellings = {}, wordlist = null, minWordLength = 2 } = {}) {
    this.rules = rules;
    this.setMisspellings(misspellings);
    this.setWordlist(wordlist);
    this.minWordLength = minWordLength;
  }

  setMisspellings(misspellings) {
    this.misspellings = new Map();
    for (const [wrong, right] of Object.entries(misspellings || {})) {
      const w = wrong.trim();
      if (!w) continue;
      this.misspellings.set(isAscii(w) ? w.toLowerCase() : w, {
        original: w,
        right: Array.isArray(right) ? right : [right].filter(Boolean),
      });
    }
  }

  setWordlist(wordlist) {
    if (!wordlist) {
      this.wordlist = null;
      return;
    }
    this.wordlist = new Set([...wordlist].map((w) => String(w).toLowerCase()));
  }

  async check(text) {
    const errors = [];
    if (!text) return errors;

    // 1. 正規表現ルール
    for (const rule of this.rules) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        errors.push({
          type: rule.type,
          offset: m.index,
          length: m[0].length,
          text: m[0],
          message: rule.message,
          suggestions: rule.suggest ? rule.suggest(m) : [],
          source: 'builtin:' + rule.id,
        });
      }
    }

    // 2. 単語単位のスペル検査(英字)
    if (this.misspellings.size > 0 || this.wordlist) {
      let m;
      LATIN_WORD_RE.lastIndex = 0;
      while ((m = LATIN_WORD_RE.exec(text)) !== null) {
        const word = m[0];
        const lower = word.toLowerCase();
        const entry = this.misspellings.get(lower);
        if (entry) {
          errors.push({
            type: ErrorType.SPELLING,
            offset: m.index,
            length: word.length,
            text: word,
            message: `スペルの誤りの可能性: ${word}`,
            suggestions: entry.right.map((r) => matchCase(word, r)),
            source: 'builtin:dictionary',
          });
          continue;
        }
        if (this.wordlist && word.length >= this.minWordLength && !/^[A-Z0-9'’-]+$/.test(word)) {
          if (!this.wordlist.has(lower) && !this.wordlist.has(lower.replace(/'s$/, ''))) {
            errors.push({
              type: ErrorType.SPELLING,
              offset: m.index,
              length: word.length,
              text: word,
              message: `辞書にない語: ${word}`,
              suggestions: [],
              source: 'builtin:wordlist',
            });
          }
        }
      }
    }

    // 3. 部分一致辞書(日本語などの ASCII 以外の見出し)
    for (const [key, entry] of this.misspellings) {
      if (isAscii(key)) continue;
      const re = new RegExp(escapeRegExp(key), 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        errors.push({
          type: ErrorType.SPELLING,
          offset: m.index,
          length: key.length,
          text: key,
          message: `表記の誤りの可能性: ${key}`,
          suggestions: entry.right,
          source: 'builtin:dictionary',
        });
      }
    }

    return dedupe(errors);
  }
}

function matchCase(sample, replacement) {
  if (sample === sample.toUpperCase() && sample.length > 1) return replacement.toUpperCase();
  if (sample.charAt(0) === sample.charAt(0).toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * LanguageTool (https://languagetool.org) の HTTP API を使うチェッカー。
 * 公開 API のほか、自前サーバ(docker で起動可能)も指定できる。
 * 英語のスペル・文法に強い。日本語は限定的。
 */
export class LanguageToolChecker {
  constructor({
    endpoint = 'https://api.languagetool.org/v2/check',
    language = 'auto',
    fetchImpl = globalThis.fetch,
    apiKey = null,
    username = null,
    disabledRules = [],
    timeoutMs = 15000,
  } = {}) {
    this.endpoint = endpoint;
    this.language = language;
    this.fetchImpl = fetchImpl;
    this.apiKey = apiKey;
    this.username = username;
    this.disabledRules = disabledRules;
    this.timeoutMs = timeoutMs;
  }

  async check(text, { language } = {}) {
    if (!text || !text.trim()) return [];
    const params = new URLSearchParams();
    params.set('text', text);
    params.set('language', language || this.language || 'auto');
    if (this.disabledRules.length) params.set('disabledRules', this.disabledRules.join(','));
    if (this.apiKey && this.username) {
      params.set('apiKey', this.apiKey);
      params.set('username', this.username);
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller ? controller.signal : undefined,
      });
      if (!res.ok) throw new Error(`LanguageTool API error: HTTP ${res.status}`);
      const json = await res.json();
      return LanguageToolChecker.convert(json, text);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  static mapIssueType(issueType, categoryId) {
    const t = String(issueType || '').toLowerCase();
    const c = String(categoryId || '').toUpperCase();
    if (t === 'misspelling' || c === 'TYPOS') return ErrorType.SPELLING;
    if (['grammar', 'duplication', 'inconsistency', 'uncategorized'].includes(t) || c === 'GRAMMAR') {
      return ErrorType.GRAMMAR;
    }
    return ErrorType.STYLE;
  }

  static convert(json, text) {
    const matches = (json && json.matches) || [];
    return dedupe(
      matches.map((m) => ({
        type: LanguageToolChecker.mapIssueType(m.rule && m.rule.issueType, m.rule && m.rule.category && m.rule.category.id),
        offset: m.offset,
        length: m.length,
        text: text.substr(m.offset, m.length),
        message: m.shortMessage || m.message || '',
        suggestions: (m.replacements || []).slice(0, 5).map((r) => r.value),
        source: 'languagetool:' + (m.rule ? m.rule.id : 'unknown'),
      }))
    );
  }
}

/** 複数のチェッカーを順に実行し、重なる結果を統合する。 */
export class CompositeChecker {
  constructor(checkers) {
    this.checkers = checkers;
  }
  async check(text, opts) {
    const results = await Promise.allSettled(this.checkers.map((c) => c.check(text, opts)));
    const errors = [];
    const failures = [];
    for (const r of results) {
      if (r.status === 'fulfilled') errors.push(...r.value);
      else failures.push(r.reason);
    }
    if (errors.length === 0 && failures.length === this.checkers.length && failures.length > 0) {
      throw failures[0];
    }
    return dedupe(errors);
  }
}

/** 同じ位置・同じ型の重複を除去し、位置順に並べる。 */
export function dedupe(errors) {
  const seen = new Set();
  const out = [];
  for (const e of [...errors].sort((a, b) => a.offset - b.offset || b.length - a.length)) {
    const key = `${e.type}:${e.offset}:${e.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * 「誤り,正しい語」の行形式テキストを辞書オブジェクトに変換する。
 * 例:
 *   recieve,receive
 *   こんにちわ,こんにちは
 *   # で始まる行はコメント
 */
export function parseDictionaryText(textBlock) {
  const dict = {};
  for (const rawLine of String(textBlock || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.includes('\t') ? '\t' : line.includes('，') ? '，' : ',';
    const [wrong, ...rest] = line.split(sep).map((s) => s.trim());
    if (!wrong) continue;
    dict[wrong] = rest.filter(Boolean);
  }
  return dict;
}
