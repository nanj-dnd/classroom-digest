// Local-app layer over the dashboard: a toolbar (sync, settings), and a drawer
// where the study buttons talk to Claude. Loaded only by `npm start`.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  // Markdown, escaped first so nothing in a reply (or a course file it quotes)
  // can inject HTML into a page that holds your Claude key.
  function md(src) {
    const blocks = [];
    let s = esc(src).replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(`<pre><code>${code}</code></pre>`) - 1}\u0000`);
    const inline = (t) => t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1<i>$2</i>');
    const out = [];
    for (const para of s.split(/\n{2,}/)) {
      const lines = para.split('\n');
      if (/^\u0000\d+\u0000$/.test(para.trim())) { out.push(blocks[+para.trim().slice(1, -1)]); continue; }
      if (lines.every((l) => /^\s*[-*] /.test(l))) { out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`); continue; }
      if (lines.every((l) => /^\s*\d+[.)] /.test(l))) { out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)] /, ''))}</li>`).join('')}</ol>`); continue; }
      if (lines.length > 1 && lines.every((l) => /^\|.*\|$/.test(l.trim()))) {
        const rows = lines.filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim())).map((l) => l.trim().slice(1, -1).split('|').map((c) => inline(c.trim())));
        out.push(`<table>${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`);
        continue;
      }
      const h = para.match(/^(#{1,4}) (.*)$/);
      if (h && lines.length === 1) { out.push(`<h${h[1].length < 3 ? 3 : 4}>${inline(h[2])}</h${h[1].length < 3 ? 3 : 4}>`); continue; }
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
    return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  }

  // Maths in replies, if KaTeX loads; plain $...$ text if it doesn't.
  function maths(el) {
    if (window.renderMathInElement) {
      window.renderMathInElement(el, { delimiters: [
        { left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false },
      ], throwOnError: false });
    }
  }
  for (const [tag, attrs] of [
    ['link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css' }],
    ['script', { src: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js', defer: true }],
    ['script', { src: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js', defer: true }],
  ]) document.head.appendChild(Object.assign(document.createElement(tag), attrs));

  // ── toolbar ──────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = '<span class="grow" id="sync-status"></span><button id="sync-now">Sync now</button><button id="open-settings">Settings</button>';
  document.body.prepend(bar);

  let state = null, wasRunning = false;
  async function refresh() {
    try { state = await (await fetch('/api/status')).json(); } catch { return; }
    const s = state.sync, el = $('#sync-status');
    if (s.running) el.innerHTML = `<span class="spin"></span>Syncing with Classroom… ${esc((s.log.at(-1) || '').trim().slice(0, 80))}`;
    else if (s.error) el.innerHTML = `<span style="color:var(--red)">Sync failed: ${esc(s.error.split('\n').at(-1))}</span>`;
    else if (s.finishedAt) el.textContent = `Synced ${new Date(s.finishedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    else el.textContent = state.hasData ? '' : 'No data yet. Press Sync now.';
    $('#sync-now').disabled = s.running;
    // A finished sync means new data: reload to show it, unless a chat is open.
    if (wasRunning && !s.running && !s.error && !drawer.classList.contains('open')) location.reload();
    wasRunning = s.running;
    if (!state.hasData && !s.running && !s.error && !document.querySelector('.task,.line')) {
      $('#app').innerHTML = '<p class="empty">No data yet. Press <b>Sync now</b> to pull your courses.</p>';
    } else if (!state.hasData && s.running) {
      $('#app').innerHTML = '<h1>Getting your courses…</h1><p class="sub">The first sync downloads every brief and reading, so it can take a few minutes.</p>';
    }
  }
  setInterval(refresh, 2500);
  refresh();
  $('#sync-now').onclick = async () => { await post('/api/sync'); refresh(); };

  // ── settings ─────────────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<div class="card">
    <h3>Settings</h3>
    <label for="key">Claude API key</label>
    <input id="key" type="password" autocomplete="off" placeholder="sk-ant-…">
    <div class="help" id="key-help"></div>
    <label for="excl">Hide courses whose name contains</label>
    <input id="excl" placeholder="e.g. Spring 2026, Orientation">
    <div class="help">Comma-separated. Classroom keeps old semesters marked active. Takes effect on the next sync.</div>
    <div class="row"><button class="link" id="signout">Sign out of Google</button>
      <span><button id="cancel">Cancel</button> <button class="primary" id="save">Save</button></span></div>
  </div>`;
  document.body.appendChild(modal);
  function openSettings(why) {
    $('#key', modal).value = '';
    $('#key-help', modal).innerHTML = (why ? `<b style="color:var(--amber)">${esc(why)}</b><br>` : '') +
      (state?.hasKey ? 'A key is saved. Paste a new one to replace it.' : 'Needed for the study buttons. Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>; you pay Anthropic per use.') +
      ' It is stored only in this folder\'s .env file.';
    $('#excl', modal).value = state?.excludeCourses || '';
    modal.classList.add('open');
    $('#key', modal).focus();
  }
  $('#open-settings').onclick = () => openSettings();
  $('#cancel', modal).onclick = () => modal.classList.remove('open');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
  $('#save', modal).onclick = async () => {
    state = await (await post('/api/settings', { anthropicKey: $('#key', modal).value, excludeCourses: $('#excl', modal).value })).json();
    modal.classList.remove('open');
    if (pending) { const p = pending; pending = null; start(p); }
  };
  $('#signout', modal).onclick = async () => { await post('/api/signout'); location.reload(); };

  // ── tutor drawer ─────────────────────────────────────────────────────────
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.innerHTML = `<header><span class="title"></span><button title="Close" aria-label="Close">×</button></header>
    <div class="msgs"></div>
    <form class="compose"><textarea rows="1" placeholder="Answer, or ask anything…"></textarea><button>Send</button></form>`;
  document.body.appendChild(drawer);
  const msgs = $('.msgs', drawer), input = $('textarea', drawer), send = $('.compose button', drawer);
  $('header button', drawer).onclick = () => { drawer.classList.remove('open'); if (busy) busy.abort(); };

  let convo = null, busy = null, pending = null;

  function bubble(cls, html) {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.innerHTML = html;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  async function turn() {
    const el = bubble('bot', '<span class="thinking"><span class="spin"></span>Reading your files and thinking…</span>');
    let text = '';
    busy = new AbortController();
    send.disabled = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', signal: busy.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: convo.action, target: convo.target, history: convo.history }),
      });
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const ev = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (ev.t === 'text') { text += ev.v; el.innerHTML = md(text); msgs.scrollTop = msgs.scrollHeight; }
          // The API's own content blocks go back verbatim on the next turn.
          else if (ev.t === 'done') convo.history.push({ role: 'assistant', content: ev.content });
          else if (ev.t === 'error') {
            el.className = 'msg err';
            el.textContent = ev.v;
            if (ev.needKey) { pending = convo; convo = null; drawer.classList.remove('open'); openSettings('Add your Claude API key to use the study buttons.'); }
            if (convo && !convo.history.length) convo.dead = true;
          }
        }
      }
      maths(el);
    } catch (e) {
      if (e.name !== 'AbortError') { el.className = 'msg err'; el.textContent = `Lost the connection to the app: ${e.message}`; }
    } finally {
      busy = null;
      send.disabled = false;
      input.focus();
    }
  }

  function start({ action, target, label }) {
    if (busy) busy.abort();
    convo = { action, target, label, history: [] };
    $('.title', drawer).textContent = label;
    msgs.innerHTML = '';
    drawer.classList.add('open');
    if (state && !state.hasKey) {
      pending = convo; convo = null; drawer.classList.remove('open');
      openSettings('Add your Claude API key to use the study buttons.');
      return;
    }
    turn();
  }

  $('.compose', drawer).onsubmit = (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v || busy || !convo || convo.dead) return;
    input.value = '';
    input.style.height = '';
    bubble('user', esc(v));
    convo.history.push({ role: 'user', content: v });
    turn();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.compose', drawer).requestSubmit(); }
  });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${input.scrollHeight}px`; });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.act');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const { act, label, link, file, course } = b.dataset;
    start({ action: act, label, target: act === 'help' ? { link } : act === 'quiz' ? { file } : { course } });
  }, true);
})();
