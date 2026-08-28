/*
 * app.js - 情報処理技術者試験 模擬検定システム（スクリーンリーダ対応）
 *
 * 視覚障害者向け「日商PC検定3級」模擬検定システムのキー操作を参考に、
 * 情報処理技術者試験の形式（四肢択一）へ割り当て直したもの。
 * すべての操作は Alt との同時押し、または固定キー方式（Alt を押して離してから単独押し）。
 */
(function (global) {
  'use strict';

  var Keymap = global.IPExamKeymap;
  var Speaker = global.IPExamSpeaker;

  var CHOICE_LABELS = ['ア', 'イ', 'ウ', 'エ'];
  var SETTINGS_KEY = 'ipexam.settings.v1';
  var SESSION_KEY = 'ipexam.session.v1';
  var QUIT_CONFIRM_MS = 15000;
  var STICKY_MS = 5000;

  var App = {
    /* ---- 状態 ------------------------------------------------------- */
    screen: 'start',           // 'start' | 'exam' | 'result'
    exam: null,                // 読み込んだ問題セット
    answers: [],               // 各問の選択（0-3 または null）
    current: 0,
    sentenceCursor: 0,         // Alt+[ 用のセンテンス位置
    figureCursor: 0,           // Alt+] 用の図の位置
    startedAt: 0,
    endsAt: 0,                 // 0 なら時間制限なし
    timerId: null,
    warned: {},
    quitPendingUntil: 0,
    stickyArmedUntil: 0,
    _altSolo: false,

    settings: {
      speechMode: 'sr',        // 'sr' | 'tts' | 'both'
      rate: 1.3,
      sticky: false,           // 固定キー方式
      directKeys: false,       // Alt なしでも操作（スクリーンリーダ利用時は非推奨）
      appMode: true,           // role="application"（スクリーンリーダのキー操作を無効化）
      autoRead: 'full',        // 'full' | 'number' 問題移動時の読み上げ
      layout: 'auto',          // 'auto' | 'jis' | 'us'
      timeLimitMin: 30,
      contrast: 'normal',      // 'normal' | 'high'
      fontScale: 1
    },

    /* ---- 初期化 ----------------------------------------------------- */
    init: function () {
      this.el = {
        screens: {
          start: document.getElementById('screen-start'),
          exam: document.getElementById('screen-exam'),
          result: document.getElementById('screen-result')
        },
        examApp: document.getElementById('exam-app'),
        examTitle: document.getElementById('exam-title'),
        qHeading: document.getElementById('question-heading'),
        qProgress: document.getElementById('question-progress'),
        qText: document.getElementById('question-text'),
        qFigures: document.getElementById('question-figures'),
        choices: document.getElementById('choice-list'),
        answerState: document.getElementById('answer-state'),
        timer: document.getElementById('timer'),
        unansweredCount: document.getElementById('unanswered-count'),
        stickyIndicator: document.getElementById('sticky-indicator'),
        resultSummary: document.getElementById('result-summary'),
        resultList: document.getElementById('result-list'),
        keyTables: document.getElementById('key-tables'),
        keyTablesStart: document.getElementById('key-tables-start'),
        log: document.getElementById('speech-log'),
        fileInput: document.getElementById('exam-file'),
        fileStatus: document.getElementById('exam-file-status'),
        resumeBtn: document.getElementById('btn-resume'),
        resumeInfo: document.getElementById('resume-info')
      };

      Speaker.init({
        politeA: document.getElementById('live-a'),
        politeB: document.getElementById('live-b'),
        assertive: document.getElementById('live-assertive'),
        log: this.el.log
      });

      this.loadSettings();
      this.bindSettingsUI();
      this.applySettings();
      this.renderKeyTables(this.el.keyTables);
      this.renderKeyTables(this.el.keyTablesStart);
      this.bindButtons();
      this.bindKeys();
      this.exam = this.normalizeExam(global.IPExamSampleData);
      this.showResumeOption();
      this.show('start');
    },

    /* ---- 設定 ------------------------------------------------------- */
    loadSettings: function () {
      try {
        var raw = global.localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          for (var k in saved) {
            if (Object.prototype.hasOwnProperty.call(this.settings, k)) this.settings[k] = saved[k];
          }
        }
      } catch (e) { /* localStorage が使えない環境では既定値のまま */ }
    },

    saveSettings: function () {
      try {
        global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      } catch (e) { /* 無視 */ }
    },

    bindSettingsUI: function () {
      var self = this;

      function radios(name, prop, cast) {
        var list = document.querySelectorAll('input[name="' + name + '"]');
        Array.prototype.forEach.call(list, function (input) {
          input.checked = String(self.settings[prop]) === input.value;
          input.addEventListener('change', function () {
            if (!input.checked) return;
            self.settings[prop] = cast ? cast(input.value) : input.value;
            self.applySettings();
            self.saveSettings();
          });
        });
      }

      function checkbox(id, prop) {
        var input = document.getElementById(id);
        if (!input) return;
        input.checked = !!self.settings[prop];
        input.addEventListener('change', function () {
          self.settings[prop] = input.checked;
          self.applySettings();
          self.saveSettings();
        });
      }

      function number(id, prop, cast) {
        var input = document.getElementById(id);
        if (!input) return;
        input.value = self.settings[prop];
        input.addEventListener('change', function () {
          var v = cast(input.value);
          if (!isNaN(v)) {
            self.settings[prop] = v;
            self.applySettings();
            self.saveSettings();
          }
        });
      }

      radios('speech-mode', 'speechMode');
      radios('auto-read', 'autoRead');
      radios('layout', 'layout');
      radios('contrast', 'contrast');
      checkbox('opt-sticky', 'sticky');
      checkbox('opt-direct', 'directKeys');
      checkbox('opt-appmode', 'appMode');
      number('opt-time-limit', 'timeLimitMin', parseInt);
      number('opt-rate', 'rate', parseFloat);
      number('opt-font-scale', 'fontScale', parseFloat);

      var ttsNote = document.getElementById('tts-note');
      if (ttsNote && !Speaker.ttsAvailable()) {
        ttsNote.textContent = 'このブラウザは音声合成（Web Speech API）に対応していません。スクリーンリーダでの読み上げをご利用ください。';
      }
    },

    applySettings: function () {
      Speaker.mode = this.settings.speechMode;
      Speaker.rate = this.settings.rate;
      document.documentElement.setAttribute('data-contrast', this.settings.contrast);
      document.documentElement.style.setProperty('--font-scale', this.settings.fontScale);
      if (this.el.examApp) {
        if (this.settings.appMode && this.screen === 'exam') {
          this.el.examApp.setAttribute('role', 'application');
        } else {
          this.el.examApp.removeAttribute('role');
        }
      }
      if (this.el.stickyIndicator) {
        this.el.stickyIndicator.hidden = !this.settings.sticky;
      }
    },

    /* ---- 問題セット ------------------------------------------------- */
    normalizeExam: function (data) {
      if (!data || !Array.isArray(data.questions) || !data.questions.length) {
        throw new Error('問題データが不正です。');
      }
      var questions = data.questions.map(function (q, i) {
        var text = Array.isArray(q.text) ? q.text.slice()
          : String(q.text || '').split(/(?<=。)/).filter(function (s) { return s.trim(); });
        var choices = (q.choices || []).slice(0, 4);
        while (choices.length < 4) choices.push('（選択肢なし）');
        return {
          number: i + 1,
          text: text,
          figures: Array.isArray(q.figures) ? q.figures : [],
          choices: choices,
          answer: typeof q.answer === 'number' ? q.answer : null,
          explanation: q.explanation || ''
        };
      });
      return {
        title: data.title || '模擬検定',
        timeLimitSec: typeof data.timeLimitSec === 'number' ? data.timeLimitSec : null,
        questions: questions
      };
    },

    loadExamFile: function (file) {
      var self = this;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          self.exam = self.normalizeExam(data);
          // 問題セットが制限時間を持っていれば、設定欄の初期値として反映する
          if (self.exam.timeLimitSec) {
            self.settings.timeLimitMin = Math.round(self.exam.timeLimitSec / 60);
            var input = document.getElementById('opt-time-limit');
            if (input) input.value = self.settings.timeLimitMin;
            self.saveSettings();
          }
          self.el.fileStatus.textContent =
            '読み込みました。' + self.exam.title + '（' + self.exam.questions.length + '問）';
          Speaker.speak('問題ファイルを読み込みました。' + self.exam.title + '、' +
            self.exam.questions.length + '問です。', { assertive: true });
        } catch (e) {
          self.el.fileStatus.textContent = '読み込みに失敗しました: ' + e.message;
          Speaker.speak('問題ファイルの読み込みに失敗しました。' + e.message, { assertive: true });
        }
      };
      reader.readAsText(file, 'utf-8');
    },

    /* ---- 画面遷移 --------------------------------------------------- */
    show: function (name) {
      this.screen = name;
      for (var k in this.el.screens) {
        this.el.screens[k].hidden = (k !== name);
      }
      this.applySettings();
    },

    /* ---- 試験の開始・再開・終了 -------------------------------------- */
    start: function (resumed) {
      var n = this.exam.questions.length;
      if (!resumed) {
        this.answers = new Array(n).fill(null);
        this.current = 0;
        this.startedAt = Date.now();
        var limit = this.settings.timeLimitMin > 0 ? this.settings.timeLimitMin * 60 * 1000 : 0;
        this.endsAt = limit ? this.startedAt + limit : 0;
        this.warned = {};
      }
      this.quitPendingUntil = 0;
      this.sentenceCursor = 0;
      this.figureCursor = 0;
      this.el.examTitle.textContent = this.exam.title;
      this.show('exam');
      this.el.examApp.focus();
      this.startTimer();
      this.render();
      this.saveSession();

      var intro = resumed ? '試験を再開します。' : '試験を開始します。';
      intro += this.exam.title + '。全' + n + '問。';
      intro += this.endsAt ? '制限時間は' + Math.round((this.endsAt - Date.now()) / 60000) + '分です。' : '時間制限はありません。';
      intro += 'キー一覧は Alt プラス H で読み上げます。';
      Speaker.speak(intro + ' ' + this.questionSpeech(true), { assertive: true });
    },

    startTimer: function () {
      var self = this;
      this.stopTimer();
      this.timerId = global.setInterval(function () { self.tick(); }, 1000);
      this.tick();
    },

    stopTimer: function () {
      if (this.timerId) { global.clearInterval(this.timerId); this.timerId = null; }
    },

    tick: function () {
      if (this.screen !== 'exam') return;
      if (!this.endsAt) {
        this.el.timer.textContent = '時間制限なし';
        return;
      }
      var remain = Math.max(0, Math.round((this.endsAt - Date.now()) / 1000));
      this.el.timer.textContent = '残り ' + this.clockText(remain);
      [600, 300, 60].forEach(function (mark) {
        if (remain <= mark && !this.warned[mark]) {
          this.warned[mark] = true;
          Speaker.speak('残り時間' + (mark >= 60 ? (mark / 60) + '分' : mark + '秒') + 'です。', { assertive: true });
        }
      }, this);
      if (remain === 0) {
        Speaker.speak('時間になりました。試験を終了します。', { assertive: true });
        this.finish(true);
      }
    },

    clockText: function (sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    },

    finish: function (auto) {
      this.stopTimer();
      this.quitPendingUntil = 0;
      this.clearSession();
      this.renderResult();
      this.show('result');
      var h = document.getElementById('result-heading');
      if (h) h.focus();
      Speaker.speak((auto ? '時間終了です。' : '試験を終了しました。') + ' ' + this.resultSpeech(), { assertive: true });
    },

    /* ---- セッション保存 ---------------------------------------------- */
    saveSession: function () {
      try {
        global.localStorage.setItem(SESSION_KEY, JSON.stringify({
          title: this.exam.title,
          count: this.exam.questions.length,
          answers: this.answers,
          current: this.current,
          endsAt: this.endsAt,
          savedAt: Date.now()
        }));
      } catch (e) { /* 無視 */ }
    },

    clearSession: function () {
      try { global.localStorage.removeItem(SESSION_KEY); } catch (e) { /* 無視 */ }
    },

    showResumeOption: function () {
      var raw = null;
      try { raw = global.localStorage.getItem(SESSION_KEY); } catch (e) { /* 無視 */ }
      if (!raw) return;
      try {
        var s = JSON.parse(raw);
        if (!s || s.count !== this.exam.questions.length) return;
        if (s.endsAt && s.endsAt < Date.now()) { this.clearSession(); return; }
        this._resume = s;
        this.el.resumeBtn.hidden = false;
        var answered = s.answers.filter(function (a) { return a !== null; }).length;
        this.el.resumeInfo.textContent =
          '前回の続き（' + s.title + '、' + answered + ' / ' + s.count + '問 解答済み）を再開できます。';
      } catch (e) { /* 無視 */ }
    },

    resume: function () {
      var s = this._resume;
      if (!s) return;
      this.answers = s.answers;
      this.current = s.current || 0;
      this.endsAt = s.endsAt || 0;
      this.warned = {};
      this.start(true);
    },

    /* ---- 描画 ------------------------------------------------------- */
    render: function () {
      var q = this.exam.questions[this.current];
      var total = this.exam.questions.length;

      this.el.qHeading.textContent = '問 ' + q.number;
      this.el.qProgress.textContent = (this.current + 1) + ' / ' + total + ' 問';

      this.el.qText.textContent = '';
      q.text.forEach(function (s, i) {
        var p = document.createElement('p');
        p.className = 'sentence';
        var num = document.createElement('span');
        num.className = 'sentence-no';
        num.setAttribute('aria-hidden', 'true');
        num.textContent = (i + 1) + '.';
        p.appendChild(num);
        p.appendChild(document.createTextNode(s));
        this.el.qText.appendChild(p);
      }, this);

      this.el.qFigures.textContent = '';
      this.el.qFigures.hidden = !q.figures.length;
      q.figures.forEach(function (f) {
        var fig = document.createElement('figure');
        var cap = document.createElement('figcaption');
        cap.textContent = f.label || '図';
        var p = document.createElement('p');
        p.textContent = f.description || '';
        fig.appendChild(cap);
        fig.appendChild(p);
        this.el.qFigures.appendChild(fig);
      }, this);

      this.el.choices.textContent = '';
      q.choices.forEach(function (c, i) {
        var li = document.createElement('li');
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'choice';
        input.id = 'choice-' + i;
        input.value = String(i);
        input.checked = this.answers[this.current] === i;
        var self = this;
        input.addEventListener('change', function () {
          if (input.checked) self.setAnswer(i, true);
        });
        var label = document.createElement('label');
        label.setAttribute('for', input.id);
        label.textContent = CHOICE_LABELS[i] + '　' + c;
        li.appendChild(input);
        li.appendChild(label);
        this.el.choices.appendChild(li);
      }, this);

      this.updateStatusLine();
      this.sentenceCursor = 0;
      this.figureCursor = 0;
    },

    updateStatusLine: function () {
      var a = this.answers[this.current];
      this.el.answerState.textContent = a === null ? '未解答' : CHOICE_LABELS[a] + ' を選択中';
      var un = this.unansweredNumbers();
      this.el.unansweredCount.textContent = un.length ? '未解答 ' + un.length + ' 問' : 'すべて解答済み';
    },

    renderKeyTables: function (container) {
      if (!container) return;
      container.textContent = '';
      Keymap.grouped().forEach(function (g) {
        var section = document.createElement('section');
        section.className = 'key-group';
        var h = document.createElement('h3');
        h.textContent = g.group;
        section.appendChild(h);
        var table = document.createElement('table');
        var caption = document.createElement('caption');
        caption.className = 'visually-hidden';
        caption.textContent = g.group + 'のキー割当て';
        table.appendChild(caption);
        var thead = document.createElement('thead');
        thead.innerHTML = '<tr><th scope="col">キー</th><th scope="col">動作</th></tr>';
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        g.entries.forEach(function (e) {
          var tr = document.createElement('tr');
          var th = document.createElement('th');
          th.setAttribute('scope', 'row');
          th.innerHTML = '<kbd>Alt</kbd> + <kbd>' + e.keyLabel
            .replace('&', '&amp;').replace('<', '&lt;') + '</kbd>';
          var td = document.createElement('td');
          td.textContent = e.desc;
          tr.appendChild(th);
          tr.appendChild(td);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        section.appendChild(table);
        container.appendChild(section);
      });
    },

    renderResult: function () {
      var qs = this.exam.questions;
      var scored = qs.filter(function (q) { return q.answer !== null; });
      var correct = 0;
      qs.forEach(function (q, i) {
        if (q.answer !== null && this.answers[i] === q.answer) correct++;
      }, this);
      var answered = this.answers.filter(function (a) { return a !== null; }).length;
      var pct = scored.length ? Math.round(correct / scored.length * 100) : 0;

      this.el.resultSummary.textContent = '';
      [
        ['問題数', qs.length + ' 問'],
        ['解答数', answered + ' 問'],
        ['正解数', correct + ' 問'],
        ['得点率', pct + ' %']
      ].forEach(function (row) {
        var dt = document.createElement('dt'); dt.textContent = row[0];
        var dd = document.createElement('dd'); dd.textContent = row[1];
        this.el.resultSummary.appendChild(dt);
        this.el.resultSummary.appendChild(dd);
      }, this);

      this.el.resultList.textContent = '';
      qs.forEach(function (q, i) {
        var mine = this.answers[i];
        var ok = q.answer !== null && mine === q.answer;
        var li = document.createElement('li');
        li.className = ok ? 'correct' : 'incorrect';
        var h = document.createElement('h3');
        h.textContent = '問 ' + q.number + '：' + (q.answer === null ? '採点対象外'
          : ok ? '正解' : (mine === null ? '未解答（不正解）' : '不正解'));
        li.appendChild(h);
        var p1 = document.createElement('p');
        p1.textContent = q.text.join(' ');
        li.appendChild(p1);
        var p2 = document.createElement('p');
        p2.textContent = 'あなたの解答：' + (mine === null ? 'なし' : CHOICE_LABELS[mine]) +
          '　正解：' + (q.answer === null ? '—' : CHOICE_LABELS[q.answer]);
        li.appendChild(p2);
        if (q.explanation) {
          var p3 = document.createElement('p');
          p3.className = 'explanation';
          p3.textContent = '解説：' + q.explanation;
          li.appendChild(p3);
        }
        this.el.resultList.appendChild(li);
      }, this);

      this._score = { correct: correct, total: scored.length, answered: answered, pct: pct };
    },

    resultSpeech: function () {
      var s = this._score;
      return '結果です。' + this.exam.questions.length + '問中、' + s.answered + '問に解答し、' +
        s.correct + '問正解、得点率' + s.pct + 'パーセントです。' +
        '各問の正誤と解説を画面に表示しています。Alt プラス Q で最初の画面に戻ります。';
    },

    /* ---- 読み上げ用テキスト ------------------------------------------ */
    q: function () { return this.exam.questions[this.current]; },

    positionSpeech: function () {
      return '問' + this.q().number + '、' + this.exam.questions.length + '問中。';
    },

    answerSpeech: function () {
      var a = this.answers[this.current];
      return a === null ? '未解答です。' : CHOICE_LABELS[a] + 'を選択中。';
    },

    questionSpeech: function (withText) {
      var s = this.positionSpeech() + this.answerSpeech();
      if (withText && this.settings.autoRead === 'full') s += ' ' + this.fullTextSpeech();
      return s;
    },

    fullTextSpeech: function () {
      var q = this.q();
      var s = q.text.join(' ');
      if (q.figures.length) {
        s += ' 図が' + q.figures.length + '個あります。Alt プラス 右角かっこ で図の説明を読みます。';
      }
      s += ' 選択肢。';
      q.choices.forEach(function (c, i) { s += CHOICE_LABELS[i] + '、' + c + ' '; });
      return s;
    },

    unansweredNumbers: function () {
      var list = [];
      this.answers.forEach(function (a, i) {
        if (a === null) list.push(this.exam.questions[i].number);
      }, this);
      return list;
    },

    /* ---- 操作（アクション） ------------------------------------------ */
    actions: {
      readAll: function () {
        this.sentenceCursor = 0;
        Speaker.speak(this.positionSpeech() + ' ' + this.fullTextSpeech());
      },
      readSentence1: function () { this.readSentence(0); },
      readSentence2: function () { this.readSentence(1); },
      readSentence3: function () { this.readSentence(2); },
      readSentence4: function () { this.readSentence(3); },
      readSentence5: function () { this.readSentence(4); },

      readNextSentence: function () {
        var q = this.q();
        if (this.sentenceCursor >= q.text.length) {
          this.sentenceCursor = 0;
          Speaker.speak('問題文は以上です。もう一度押すと1センテンス目から読みます。');
          return;
        }
        var i = this.sentenceCursor++;
        Speaker.speak((i + 1) + '文目。' + q.text[i]);
      },

      readNextFigure: function () {
        var q = this.q();
        if (!q.figures.length) { Speaker.speak('この問題に図はありません。'); return; }
        if (this.figureCursor >= q.figures.length) this.figureCursor = 0;
        var f = q.figures[this.figureCursor++];
        Speaker.speak((f.label || ('図' + this.figureCursor)) + '。' + f.description +
          (q.figures.length > 1 ? ' 図は全部で' + q.figures.length + '個です。' : ''));
      },

      readChoice0: function () { this.readChoice(0); },
      readChoice1: function () { this.readChoice(1); },
      readChoice2: function () { this.readChoice(2); },
      readChoice3: function () { this.readChoice(3); },

      answer0: function () { this.setAnswer(0); },
      answer1: function () { this.setAnswer(1); },
      answer2: function () { this.setAnswer(2); },
      answer3: function () { this.setAnswer(3); },

      clearAnswer: function () {
        if (this.quitPendingUntil > Date.now()) {
          this.quitPendingUntil = 0;
          Speaker.speak('終了を取り消しました。試験を続けます。', { assertive: true });
          return;
        }
        if (this.answers[this.current] === null) { Speaker.speak('まだ解答していません。'); return; }
        this.answers[this.current] = null;
        this.render();
        this.saveSession();
        Speaker.speak('選択を解除しました。' + this.positionSpeech() + '未解答です。');
      },

      nextQuestion: function () {
        if (this.current >= this.exam.questions.length - 1) {
          Speaker.speak('最終問題です。これより後の問題はありません。');
          return;
        }
        this.goTo(this.current + 1);
      },
      prevQuestion: function () {
        if (this.current <= 0) { Speaker.speak('問1です。これより前の問題はありません。'); return; }
        this.goTo(this.current - 1);
      },
      firstQuestion: function () { this.goTo(0, '問題1番へ移動しました。'); },
      lastQuestion: function () { this.goTo(this.exam.questions.length - 1, '最終問題へ移動しました。'); },
      nextUnanswered: function () { this.gotoUnanswered(1); },
      prevUnanswered: function () { this.gotoUnanswered(-1); },

      readStatus: function () {
        Speaker.speak(this.positionSpeech() + this.answerSpeech());
      },

      readTime: function () {
        if (!this.endsAt) {
          var elapsed = Math.round((Date.now() - this.startedAt) / 1000);
          Speaker.speak('時間制限はありません。経過時間は' + this.spokenDuration(elapsed) + 'です。');
          return;
        }
        var remain = Math.max(0, Math.round((this.endsAt - Date.now()) / 1000));
        Speaker.speak('残り時間、' + this.spokenDuration(remain) + 'です。');
      },

      readUnanswered: function () {
        var list = this.unansweredNumbers();
        if (!list.length) { Speaker.speak('未解答の問題はありません。'); return; }
        Speaker.speak('未解答は' + list.length + '問です。' +
          list.map(function (n) { return n + '番'; }).join('、') + '。');
      },

      readKeyHelp: function () {
        Speaker.speak(Keymap.helpText());
        var det = document.getElementById('key-help-details');
        if (det) det.open = true;
      },

      quit: function () {
        if (this.screen === 'result') { this.backToStart(); return; }
        if (this.quitPendingUntil > Date.now()) { this.finish(false); return; }
        this.quitPendingUntil = Date.now() + QUIT_CONFIRM_MS;
        var un = this.unansweredNumbers();
        Speaker.speak('試験を終了しますか。' +
          (un.length ? '未解答が' + un.length + '問あります。' : 'すべて解答済みです。') +
          '終了する場合は、もう一度 Alt プラス Q を押してください。取り消すには Alt プラス C を押してください。',
          { assertive: true });
      }
    },

    readSentence: function (i) {
      var q = this.q();
      if (i >= q.text.length) {
        Speaker.speak((i + 1) + '文目はありません。この問題文は' + q.text.length + '文です。');
        return;
      }
      this.sentenceCursor = i + 1;
      Speaker.speak((i + 1) + '文目。' + q.text[i]);
    },

    readChoice: function (i) {
      var q = this.q();
      Speaker.speak('選択肢' + CHOICE_LABELS[i] + '。' + q.choices[i]);
    },

    setAnswer: function (i, fromUI) {
      this.answers[this.current] = i;
      if (!fromUI) {
        var input = document.getElementById('choice-' + i);
        if (input) input.checked = true;
      }
      this.updateStatusLine();
      this.saveSession();
      Speaker.speak(CHOICE_LABELS[i] + 'を選択しました。');
    },

    goTo: function (index, prefix) {
      this.current = index;
      this.quitPendingUntil = 0;
      this.render();
      this.saveSession();
      Speaker.speak((prefix || '') + this.questionSpeech(true));
    },

    /**
     * 現在位置から dir 方向へ、最初に見つかった未解答問題へ移動する（末尾で折り返す）。
     * 現在の問題自身は対象にしない。
     */
    gotoUnanswered: function (dir) {
      var n = this.exam.questions.length;
      for (var step = 1; step < n; step++) {
        var i = ((this.current + dir * step) % n + n) % n;
        if (this.answers[i] === null) {
          this.goTo(i, (dir > 0 ? '後ろの' : '前の') + '未解答問題へ移動しました。');
          return;
        }
      }
      Speaker.speak(this.answers[this.current] === null
        ? 'この問題以外に未解答の問題はありません。'
        : '未解答の問題はありません。');
    },

    spokenDuration: function (sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      if (m === 0) return s + '秒';
      return m + '分' + s + '秒';
    },

    backToStart: function () {
      this.stopTimer();
      Speaker.stop();
      this.show('start');
      var h = document.getElementById('start-heading');
      if (h) h.focus();
      Speaker.speak('最初の画面に戻りました。開始するボタンで試験を始めます。', { assertive: true });
    },

    /* ---- キー入力 ---------------------------------------------------- */
    bindKeys: function () {
      var self = this;

      global.addEventListener('keydown', function (ev) {
        if (ev.key === 'Alt') {
          self._altSolo = true;
          if (self.settings.sticky) ev.preventDefault();  // メニューバーへのフォーカスを防ぐ
          return;
        }
        self._altSolo = false;
        self.handleKey(ev);
      }, true);

      global.addEventListener('keyup', function (ev) {
        if (ev.key !== 'Alt') return;
        if (self.settings.sticky && self._altSolo) {
          self.armSticky();
          ev.preventDefault();
        }
        self._altSolo = false;
      }, true);
    },

    armSticky: function () {
      this.stickyArmedUntil = Date.now() + STICKY_MS;
      var el = this.el.stickyIndicator;
      if (el) {
        el.hidden = false;
        el.textContent = '固定キー：入力待ち';
        el.classList.add('armed');
        var self = this;
        global.setTimeout(function () {
          if (Date.now() >= self.stickyArmedUntil) {
            el.classList.remove('armed');
            el.textContent = '固定キー：有効（Alt を押して離してからキー）';
          }
        }, STICKY_MS + 50);
      }
    },

    handleKey: function (ev) {
      if (ev.ctrlKey || ev.metaKey) return;               // Ctrl+Alt（AltGr）は対象外
      var target = ev.target;
      var inField = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) &&
        !(target.type === 'radio' || target.type === 'checkbox' || target.type === 'button');

      var sticky = this.settings.sticky && Date.now() < this.stickyArmedUntil;
      var direct = this.settings.directKeys && !inField;
      if (!ev.altKey && !sticky && !direct) return;
      if (inField && !ev.altKey && !sticky) return;

      var action = Keymap.resolve(ev, this.settings.layout);
      if (!action) return;

      if (sticky) {
        this.stickyArmedUntil = 0;
        var el = this.el.stickyIndicator;
        if (el) {
          el.classList.remove('armed');
          el.textContent = '固定キー：有効（Alt を押して離してからキー）';
        }
      }

      // 画面ごとに使えるキーを絞る
      var alwaysOk = { readKeyHelp: 1, quit: 1, readTime: 1 };
      if (this.screen !== 'exam' && !alwaysOk[action]) {
        ev.preventDefault();
        if (this.screen === 'start') {
          Speaker.speak('試験がまだ始まっていません。開始するボタンを押すか、Alt プラス H でキー一覧を確認してください。');
        } else {
          Speaker.speak('試験は終了しています。Alt プラス Q で最初の画面に戻ります。');
        }
        return;
      }
      if (this.screen !== 'exam' && action === 'readTime') {
        ev.preventDefault();
        Speaker.speak(this.screen === 'start' ? '試験がまだ始まっていません。' : '試験は終了しています。');
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();

      if (action !== 'quit' && action !== 'clearAnswer') this.quitPendingUntil = 0;
      var fn = this.actions[action];
      if (fn) fn.call(this);
    },

    /* ---- ボタン ------------------------------------------------------ */
    bindButtons: function () {
      var self = this;
      document.getElementById('btn-start').addEventListener('click', function () { self.start(false); });
      this.el.resumeBtn.addEventListener('click', function () { self.resume(); });
      document.getElementById('btn-finish').addEventListener('click', function () {
        if (global.confirm('試験を終了して採点します。よろしいですか。')) self.finish(false);
      });
      document.getElementById('btn-retry').addEventListener('click', function () { self.backToStart(); });
      document.getElementById('btn-prev').addEventListener('click', function () { self.actions.prevQuestion.call(self); });
      document.getElementById('btn-next').addEventListener('click', function () { self.actions.nextQuestion.call(self); });
      document.getElementById('btn-read').addEventListener('click', function () { self.actions.readAll.call(self); });
      this.el.fileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) self.loadExamFile(this.files[0]);
      });
    }
  };

  global.IPExamApp = App;
  document.addEventListener('DOMContentLoaded', function () { App.init(); });
})(window);
