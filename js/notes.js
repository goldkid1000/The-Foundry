/* The Foundry — personal notes. Saved in localStorage, no account needed.
   Write down favorite builds, farm reminders, anything. */
(function () {
  'use strict';

  var LS_KEY = 'tv-notes';

  function getNotes() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch (e) { return []; }
  }
  function saveNotes(notes) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(notes)); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render() {
    var list = document.getElementById('tv-notes-list');
    if (!list) return;
    var notes = getNotes();
    if (!notes.length) {
      list.innerHTML = '<p class="muted small tv-notes-empty">No notes yet — your favorite builds and reminders will live here.</p>';
      return;
    }
    /* newest first */
    list.innerHTML = notes.map(function (n, i) {
      var idx = notes.length - 1 - i;
      var note = notes[idx];
      return '<div class="tv-note-card" data-idx="' + idx + '">' +
        '<div class="tv-note-head"><b>' + esc(note.title || 'Untitled') + '</b>' +
        '<span class="tv-note-date">' + esc(note.date || '') + '</span>' +
        '<button class="tv-note-del" aria-label="Delete note">🗑️</button></div>' +
        '<p class="tv-note-body">' + esc(note.text || '').replace(/\n/g, '<br>') + '</p>' +
        '</div>';
    }).join('');
    list.querySelectorAll('.tv-note-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.tv-note-card');
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        var notes = getNotes();
        notes.splice(idx, 1);
        saveNotes(notes);
        render();
      });
    });
  }

  function init() {
    var titleEl = document.getElementById('tv-note-title');
    var textEl = document.getElementById('tv-note-text');
    var saveBtn = document.getElementById('tv-note-save');
    if (!titleEl || !textEl || !saveBtn) return;

    saveBtn.addEventListener('click', function () {
      var title = titleEl.value.trim();
      var text = textEl.value.trim();
      if (!title && !text) return;
      var notes = getNotes();
      var d = new Date();
      notes.push({
        title: title || 'Untitled',
        text: text,
        date: d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      saveNotes(notes);
      titleEl.value = '';
      textEl.value = '';
      render();
      /* little confirmation */
      saveBtn.textContent = '✅ Saved!';
      setTimeout(function () { saveBtn.textContent = '💾 Save note'; }, 1500);
    });
    /* Enter in title jumps to text */
    titleEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); textEl.focus(); }
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
