/* The Foundry — Vaulty voice in/out (v2.23.0).
   IN: a mic button driven by the Web Speech recognition API — only
   ever shown when the API exists, and it asks for the microphone
   permission by starting recognition on an explicit tap. Denied or
   errored → the button hides and Vaulty says why, once.
   OUT: optional spoken replies via speechSynthesis — OFF by default,
   toggled in the panel, persisted on-device. Spoken text is the
   answer's plain text, trimmed hard: nobody wants a dossier read
   aloud verbatim. */
(function () {
  'use strict';

  var REPLY_KEY = 'tv-voice-replies';
  function recogCtor() {
    return (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
  }
  function available() { return !!recogCtor(); }
  function speechAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }
  function repliesOn() {
    try { return localStorage.getItem(REPLY_KEY) === '1'; } catch (e) { return false; }
  }
  function setReplies(on) {
    try { localStorage.setItem(REPLY_KEY, on ? '1' : '0'); } catch (e) {}
    if (!on) { try { window.speechSynthesis.cancel(); } catch (e) {} }
  }
  function stripText(html) {
    return String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }
  function speakAnswer(html) {
    if (!repliesOn() || !speechAvailable()) return;
    try {
      var text = stripText(html);
      if (!text || text.length < 12) return;
      if (text.length > 340) text = text.slice(0, 340).replace(/\s+\S*$/, '') + '.';
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.04;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* wire a mic button: tap → listen → final transcript goes to onFinal.
     Interim results stream into the input so the Tenno sees it work. */
  function attachMic(btn, input, onFinal, onDenied) {
    if (!btn) return;
    var Ctor = recogCtor();
    if (!Ctor) { btn.style.display = 'none'; return; }
    var rec = null, listening = false;
    btn.addEventListener('click', function () {
      if (listening && rec) { try { rec.stop(); } catch (e) {} return; }
      try {
        rec = new Ctor();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onresult = function (ev) {
          var finalTxt = '', interim = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            if (ev.results[i].isFinal) finalTxt += ev.results[i][0].transcript;
            else interim += ev.results[i][0].transcript;
          }
          if (input) input.value = (finalTxt || interim || '').trim();
          if (finalTxt && typeof onFinal === 'function') onFinal(finalTxt.trim());
        };
        rec.onend = function () {
          listening = false;
          if (btn.classList) btn.classList.remove('listening');
        };
        rec.onerror = function (ev) {
          listening = false;
          if (btn.classList) btn.classList.remove('listening');
          if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) {
            btn.style.display = 'none';
            if (typeof onDenied === 'function') onDenied();
          }
        };
        listening = true;
        if (btn.classList) btn.classList.add('listening');
        rec.start();
      } catch (e) {
        listening = false;
        btn.style.display = 'none';
        if (typeof onDenied === 'function') onDenied();
      }
    });
  }

  window.TVVoice = {
    available: available,
    speechAvailable: speechAvailable,
    repliesOn: repliesOn,
    setReplies: setReplies,
    speakAnswer: speakAnswer,
    attachMic: attachMic,
    _stripText: stripText
  };
})();
