/*
 * speech.js - 読み上げ（スクリーンリーダ向け aria-live と、音声合成の2系統）
 *
 * mode:
 *   'sr'   … aria-live のみ。スクリーンリーダ利用者の既定（二重読みを避ける）
 *   'tts'  … Web Speech API の音声合成のみ。スクリーンリーダを使わない利用者向け
 *   'both' … 両方
 */
(function (global) {
  'use strict';

  var Speaker = {
    mode: 'sr',
    rate: 1.3,
    volume: 1.0,
    voice: null,
    _regions: [],
    _regionIndex: 0,
    _logEl: null,
    _log: [],
    _onLog: null,

    /**
     * @param {{politeA:HTMLElement, politeB:HTMLElement, assertive:HTMLElement, log:HTMLElement}} els
     */
    init: function (els) {
      // 同じ文言を続けて読ませるため、2つの live region を交互に使う
      this._regions = [els.politeA, els.politeB];
      this._assertive = els.assertive;
      this._logEl = els.log;
      this._loadVoices();
      if ('speechSynthesis' in global) {
        global.speechSynthesis.addEventListener('voiceschanged', this._loadVoices.bind(this));
      }
    },

    _loadVoices: function () {
      if (!('speechSynthesis' in global)) return;
      var voices = global.speechSynthesis.getVoices() || [];
      var ja = voices.filter(function (v) { return /^ja/i.test(v.lang); });
      this.voice = ja[0] || null;
    },

    ttsAvailable: function () { return 'speechSynthesis' in global; },

    /**
     * 読み上げる。
     * @param {string} text
     * @param {{assertive?:boolean, interrupt?:boolean, silent?:boolean}} [opts]
     */
    speak: function (text, opts) {
      opts = opts || {};
      if (!text) return;
      this._appendLog(text);
      if (opts.silent) return;

      if (this.mode === 'sr' || this.mode === 'both') this._live(text, !!opts.assertive);
      if (this.mode === 'tts' || this.mode === 'both') this._tts(text, opts.interrupt !== false);
    },

    _live: function (text, assertive) {
      if (assertive && this._assertive) {
        this._assertive.textContent = '';
        var a = this._assertive;
        global.setTimeout(function () { a.textContent = text; }, 30);
        return;
      }
      var regions = this._regions;
      if (!regions.length) return;
      var cur = regions[this._regionIndex];
      var other = regions[1 - this._regionIndex];
      other.textContent = '';
      this._regionIndex = 1 - this._regionIndex;
      cur.textContent = '';
      global.setTimeout(function () { cur.textContent = text; }, 30);
    },

    _tts: function (text, interrupt) {
      if (!this.ttsAvailable()) return;
      if (interrupt) global.speechSynthesis.cancel();
      var u = new global.SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = this.rate;
      u.volume = this.volume;
      if (this.voice) u.voice = this.voice;
      global.speechSynthesis.speak(u);
    },

    /** 読み上げを止める */
    stop: function () {
      if (this.ttsAvailable()) global.speechSynthesis.cancel();
    },

    _appendLog: function (text) {
      this._log.push(text);
      if (this._log.length > 30) this._log.shift();
      if (!this._logEl) return;
      var li = document.createElement('li');
      li.textContent = text;
      this._logEl.appendChild(li);
      while (this._logEl.children.length > 30) {
        this._logEl.removeChild(this._logEl.firstChild);
      }
      this._logEl.scrollTop = this._logEl.scrollHeight;
    },

    clearLog: function () {
      this._log = [];
      if (this._logEl) this._logEl.textContent = '';
    }
  };

  global.IPExamSpeaker = Speaker;
})(window);
