/* search.js — 全局笔记搜索（悬浮窗 + Ctrl/Cmd+K + Notion 式预览） */
(function () {
  'use strict';
  var ITEMS = [], READY = false, LOADING = null;
  var SUBJ = ['全部', '内科', '外科', '病理', '生理', '生化', '政治', '人文', '我的笔记'];
  var CUR_SUBJ = '全部';

  /* ---------- 数据 ---------- */
  function subjectOf(s) {
    var t = String(s || '');
    if (/内科/.test(t)) return '内科';
    if (/外科/.test(t)) return '外科';
    if (/病理/.test(t)) return '病理';
    if (/生理/.test(t)) return '生理';
    if (/生化|生物化学/.test(t)) return '生化';
    if (/政治|马原|毛中特|史纲|思修|习思想/.test(t)) return '政治';
    if (/人文|伦理|心理|卫生法/.test(t)) return '人文';
    return '其他';
  }

  function niceName(raw) {
    var s = String(raw || '');
    for (var i = 0; i < 3; i++) {
      try { var d = decodeURIComponent(s); if (d === s) break; s = d; } catch (e) { break; }
    }
    s = s.replace(/^#\/?(tag|bank)?\/?/, '').replace(/^tg[:%]?3?A?/i, '');
    try { s = decodeURIComponent(s); } catch (e2) {}
    return s || raw;
  }

  function pushNoteItems() {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      var md = localStorage.getItem(k) || '';
      if (k.indexOf('kbdoc.tag.') === 0) {
        var tag = k.slice(10);
        if (!md.trim()) continue;
        ITEMS.push({ id: 'note:' + k, t: niceName(tag), s: '我的笔记', g: '知识点笔记', x: md, src: '我的笔记', kind: 'tag', key: k, tagId: tag });
      } else if (k.indexOf('kbdoc.doc.') === 0) {
        var title = k.slice(10);
        ITEMS.push({ id: 'note:' + k, t: title, s: '我的笔记', g: '自由笔记', x: md, src: '我的笔记', kind: 'doc', key: k, tagId: '' });
      }
    }
  }

  function loadKuangs() {
    return fetch('资料/狂背/索引.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (idx) {
        var list = Array.isArray(idx) ? idx : (idx.items || idx.list || []);
        return Promise.all(list.map(function (it) {
          var f = String(it.file || '').replace(/\\/g, '/');
          return fetch(f, { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (txt) {
              if (!txt) return null;
              return {
                id: 'kb:' + f, t: it.chapter || f.replace(/\.md$/, ''),
                s: subjectOf(it.subject || f), g: it.subject || '', x: txt, src: '狂背',
                page: (it.pageStart && it.pageEnd) ? ('原书第 ' + it.pageStart + '–' + it.pageEnd + ' 页') : ''
              };
            });
        }));
      })
      .then(function (arr) { arr.forEach(function (x) { if (x) ITEMS.push(x); }); })
      .catch(function () {});
  }

  function loadKbDocs() {
    var kbs = window.__KBS__ || [];
    kbs.forEach(function (bank) {
      (bank.docs || []).forEach(function (d, i) {
        if (!d || !d.text) return;
        ITEMS.push({
          id: 'kbd:' + bank.id + ':' + i, t: d.name || ('文档' + i),
          s: subjectOf(bank.name || bank.id), g: bank.name || '', x: d.text, src: '资料库'
        });
      });
    });
  }

  function ensureData() {
    if (READY) return Promise.resolve();
    if (LOADING) return LOADING;
    LOADING = loadKuangs().then(function () {
      loadKbDocs();
      pushNoteItems();
      READY = true;
    });
    return LOADING;
  }

  /* ---------- 相似度 ---------- */
  function bigrams(s) {
    var m = {};
    for (var i = 0; i < s.length - 1; i++) { var g = s.substr(i, 2); m[g] = (m[g] || 0) + 1; }
    return m;
  }
  function sim(a, b) {
    if (!a || !b) return 0;
    var A = bigrams(a), B = bigrams(b), inter = 0, n = 0;
    for (var k in A) { if (B[k]) inter += Math.min(A[k], B[k]); n += A[k]; }
    for (var k2 in B) n += 0;
    return n ? inter / n : 0;
  }
  function score(item, q, ql) {
    var t = item.t.toLowerCase(), x = item.x.toLowerCase();
    var s = 0;
    if (t.indexOf(ql) >= 0) s += 80;
    var idx = x.indexOf(ql);
    if (idx >= 0) s += 40;
    var cnt = 0, pos = 0;
    while (cnt < 5) { var p = x.indexOf(ql, pos); if (p < 0) break; cnt++; pos = p + ql.length; }
    s += cnt * 6;
    if (q.length >= 2) s += sim(ql, x.substr(Math.max(0, idx), 200)) * 25;
    return s;
  }
  function snippet(item, ql, n) {
    var x = item.x, i = x.toLowerCase().indexOf(ql);
    if (i < 0) i = 0;
    var a = Math.max(0, i - Math.floor(n / 3)), b = Math.min(x.length, a + n);
    var s = x.slice(a, b).replace(/\s+/g, ' ');
    return (a > 0 ? '…' : '') + s + (b < x.length ? '…' : '');
  }

  /* ---------- UI ---------- */
  var CSS = [
    '#gsBtn{position:fixed;right:22px;bottom:96px;z-index:20000;width:60px;height:60px;border-radius:50%;border:1px solid rgba(148,163,184,.35);background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.22);cursor:grab;font-size:26px;touch-action:none;user-select:none;display:flex;align-items:center;justify-content:center}',
    '#gsWrap{position:fixed;inset:0;z-index:20010;display:none;background:rgba(15,23,42,.35);backdrop-filter:blur(3px)}',
    '#gsWrap.on{display:block}',
    '#gsBox{position:absolute;left:50%;top:12vh;transform:translateX(-50%);width:min(720px,92vw);max-height:70vh;background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;font:14px/1.6 system-ui,"PingFang SC","Microsoft YaHei"}',
    '#gsIn{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #eef2f7}',
    '#gsQ{flex:1;border:0;outline:0;font-size:16px}',
    '#gsSub{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #f1f5f9}',
    '#gsSub span{padding:4px 10px;border-radius:999px;background:#f1f5f9;color:#475569;cursor:pointer;font-size:12px}',
    '#gsSub span.on{background:#2563eb;color:#fff}',
    '#gsList{overflow:auto;padding:6px}',
    '.gsItem{padding:10px 12px;border-radius:10px;cursor:pointer}', '.gsItem:hover{background:#f5f8ff}',
    '.gsItem b{font-weight:600}', '.gsItem i{font-style:normal;color:#94a3b8;font-size:12px;margin-left:6px}',
    '.gsItem p{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.5}',
    '#gsEmpty{padding:24px;text-align:center;color:#94a3b8}',
    '#gsPeek{position:fixed;inset:0;z-index:20020;display:none;background:rgba(15,23,42,.45)}',
    '#gsPeek.on{display:block}',
    '#gsCard{position:absolute;left:50%;top:6vh;transform:translateX(-50%);width:min(820px,94vw);height:84vh;background:#fff;border-radius:18px;box-shadow:0 30px 90px rgba(15,23,42,.3);display:flex;flex-direction:column;overflow:hidden}',
    '#gsCard h3{margin:0;padding:16px 20px;border-bottom:1px solid #eef2f7;font-size:16px;display:flex;align-items:center;gap:8px}',
    '#gsCard h3 span{margin-left:auto;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1}',
    '#gsBody{overflow:auto;padding:18px 24px 40px;font:15px/1.75 system-ui,"PingFang SC","Microsoft YaHei"}',
    '#gsBody h1{font-size:24px;margin:10px 0 14px}', '#gsBody h2{font-size:19px;margin:18px 0 8px}', '#gsBody h3{font-size:16px;margin:14px 0 6px}',
    '#gsBody blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid #cbd5e1;color:#64748b;background:#f8fafc}',
    '#gsBody li{margin:3px 0}', '#gsBody code{background:#f1f5f9;padding:1px 5px;border-radius:4px}'
  ].join('\n');

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function mdToHtml(md) {
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var lines = String(md || '').split(/\r?\n/), out = [], list = false;
    function closeList() { if (list) { out.push('</ul>'); list = false; } }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { closeList(); return; }
      if (/^###\s+/.test(t)) { closeList(); out.push('<h3>' + esc(t.slice(4)) + '</h3>'); return; }
      if (/^##\s+/.test(t)) { closeList(); out.push('<h2>' + esc(t.slice(3)) + '</h2>'); return; }
      if (/^#\s+/.test(t)) { closeList(); out.push('<h1>' + esc(t.slice(2)) + '</h1>'); return; }
      if (/^>\s?/.test(t)) { closeList(); out.push('<blockquote>' + esc(t.replace(/^>\s?/, '')) + '</blockquote>'); return; }
      if (/^[-*]\s+/.test(t)) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + esc(t.replace(/^[-*]\s+/, '')) + '</li>'); return; }
      closeList(); out.push('<p>' + esc(t) + '</p>');
    });
    closeList();
    var html = out.join('\n');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return html || '<p style="color:#94a3b8">（空白）</p>';
  }

  var wrap, box, input, sub, list, peek, card, cardTitle, cardBody;

  function build() {
    if (document.getElementById('gsWrap')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var btn = el('button', null, '🔍'); btn.id = 'gsBtn'; btn.title = '搜索全部笔记（Ctrl+K）— 可拖动';
    try {
      var saved = JSON.parse(localStorage.getItem('gs.pos') || 'null');
      if (saved && saved.x != null) { btn.style.left = saved.x + 'px'; btn.style.top = saved.y + 'px'; btn.style.right = 'auto'; btn.style.bottom = 'auto'; }
    } catch (e) {}
    var drag = { on: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    btn.addEventListener('pointerdown', function (e) {
      drag.on = true; drag.moved = false;
      drag.sx = e.clientX; drag.sy = e.clientY;
      var r = btn.getBoundingClientRect(); drag.ox = r.left; drag.oy = r.top;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      btn.style.cursor = 'grabbing';
    });
    btn.addEventListener('pointermove', function (e) {
      if (!drag.on) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      var x = Math.max(6, Math.min(window.innerWidth - 66, drag.ox + dx));
      var y = Math.max(6, Math.min(window.innerHeight - 66, drag.oy + dy));
      btn.style.left = x + 'px'; btn.style.top = y + 'px';
      btn.style.right = 'auto'; btn.style.bottom = 'auto';
    });
    btn.addEventListener('pointerup', function () {
      drag.on = false; btn.style.cursor = 'grab';
      if (drag.moved) {
        var r2 = btn.getBoundingClientRect();
        localStorage.setItem('gs.pos', JSON.stringify({ x: Math.round(r2.left), y: Math.round(r2.top) }));
      }
    });
    btn.onclick = function () { if (drag.moved) { drag.moved = false; return; } open(); };
    document.body.appendChild(btn);

    wrap = el('div'); wrap.id = 'gsWrap';
    box = el('div'); box.id = 'gsBox';
    var row = el('div'); row.id = 'gsIn';
    input = el('input'); input.id = 'gsQ'; input.placeholder = '搜索笔记 / 考点 / 讲义…（模糊匹配）';
    var x = el('span', null, '✕'); x.style.cursor = 'pointer'; x.style.color = '#94a3b8'; x.onclick = close;
    row.appendChild(input); row.appendChild(x);
    sub = el('div'); sub.id = 'gsSub';
    SUBJ.forEach(function (s) {
      var c = el('span', s === CUR_SUBJ ? 'on' : '', s);
      c.onclick = function () { CUR_SUBJ = s; Array.prototype.forEach.call(sub.children, function (n) { n.classList.remove('on'); }); c.classList.add('on'); run(); };
      sub.appendChild(c);
    });
    list = el('div'); list.id = 'gsList';
    box.appendChild(row); box.appendChild(sub); box.appendChild(list);
    wrap.appendChild(box);
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
    document.body.appendChild(wrap);

    peek = el('div'); peek.id = 'gsPeek';
    card = el('div'); card.id = 'gsCard';
    cardTitle = el('h3');
    cardBody = el('div'); cardBody.id = 'gsBody';
    card.appendChild(cardTitle); card.appendChild(cardBody);
    peek.appendChild(card);
    peek.onclick = function (e) { if (e.target === peek) closePeek(); };
    document.body.appendChild(peek);

    input.oninput = run;
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
      else if (e.key === 'Escape') { if (peek.classList.contains('on')) closePeek(); else close(); }
    });
  }

  function open() {
    build();
    wrap.classList.add('on');
    input.value = ''; run(); setTimeout(function () { input.focus(); }, 30);
    ensureData().then(run);
  }
  function close() { if (wrap) wrap.classList.remove('on'); }
  function closePeek() { if (peek) peek.classList.remove('on'); }

  var PDFIDX = (window.__PDFIDX && typeof window.__PDFIDX === 'object') ? window.__PDFIDX : null;
  var PDFNORM = {};
  function buildNorm() {
    for (var k in PDFIDX) PDFNORM[String(k).replace(/\s+/g, '')] = PDFIDX[k];
  }
  function ensurePdfIdx() {
    if (PDFIDX) { buildNorm(); return Promise.resolve(PDFIDX); }
    return fetch('pdf-index.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { PDFIDX = j || {}; buildNorm(); return PDFIDX; })
      .catch(function () { PDFIDX = {}; return PDFIDX; });
  }
  function resolvePdf(name) {
    if (!PDFIDX) return '';
    var n = String(name || '').trim();
    var keys = [n, n.replace(/\.pdf$/i, ''), n.replace(/\s+/g, ''), n.replace(/\.pdf$/i, '').replace(/\s+/g, '')];
    for (var i = 0; i < keys.length; i++) if (PDFIDX[keys[i]]) return PDFIDX[keys[i]];
    var core = n.replace(/\.pdf$/i, '').split('_')[0];
    for (var k in PDFIDX) if (k.indexOf(core) === 0 && core.length >= 4) return PDFIDX[k];
    var nk = n.replace(/\s+/g, '').replace(/\.pdf$/i, '');
    for (var k2 in PDFNORM) if (k2.indexOf(nk) === 0 && nk.length >= 6) return PDFNORM[k2];
    return '';
  }
  function pdfPage(name) {
    var m = String(name || '').match(/_(\d+)(?:-\d+)?\.pdf$/i);
    return m ? m[1] : '';
  }

  function openPeek(item) {
    cardTitle.innerHTML = '<span>' + esc2(item.t) + '</span><i style="font-style:normal;color:#94a3b8;font-size:12px">' + esc2(item.src + (item.page ? ' · ' + item.page : '')) + '</i><span>✕</span>';
    cardTitle.querySelector('span:last-child').onclick = closePeek;
    cardBody.innerHTML = mdToHtml(item.x);
    cardBody.scrollTop = 0;
    peek.classList.add('on');
    if (item.src === '资料库') {
      ensurePdfIdx().then(function () {
        var p = resolvePdf(item.t);
        if (!p) return;
        var pg = pdfPage(item.t);
        var src = encodeURI(p) + (pg ? '#page=' + pg : '');
        cardBody.innerHTML = '<p style="margin:0 0 10px"><a style="display:inline-block;background:#2f6fed;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;text-decoration:none" href="' + src + '" target="_blank" rel="noopener">📄 打开 PDF（新标签页）</a></p>'
          + '<iframe src="' + src + '" style="width:100%;height:60vh;border:0;border-radius:10px;background:#f8fafc"></iframe>';
      });
    }
  }
  function esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }


  function openNote(item) {
    close();
    if (!window.KbDoc) { alert('编辑器还没加载好，稍等一秒再点'); return; }
    if (item.kind === 'tag') window.KbDoc.openTag(item.tagId, item.t, item.x);
    else window.KbDoc.open(item.t, item.x);
  }

  function delNote(item, ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (!confirm('删除笔记「' + item.t + '」？删了就找不回来了。')) return;
    try { localStorage.removeItem(item.key); } catch (e) {}
    ITEMS = ITEMS.filter(function (x) { return x.key !== item.key; });
    run();
  }

  function newNote() {
    var title = prompt('新笔记的标题（保存后可在「我的笔记」里找到）', '未命名笔记');
    if (title == null) return;
    title = String(title).trim();
    if (!title) return;
    var key = 'kbdoc.doc.' + title;
    if (localStorage.getItem(key) != null) { alert('已经有同名笔记了'); return; }
    localStorage.setItem(key, '');
    var item = { id: 'note:' + key, t: title, s: '我的笔记', g: '自由笔记', x: '', src: '我的笔记', kind: 'doc', key: key, tagId: '' };
    ITEMS.push(item);
    openNote(item);
  }

  function run() {
    if (!list) return;
    var q = (input.value || '').trim().toLowerCase();
    var res = ITEMS.filter(function (it) {
      if (CUR_SUBJ === '我的笔记') return it.src === '我的笔记';
      if (CUR_SUBJ !== '全部' && it.s !== CUR_SUBJ) return false;
      return true;
    });
    if (q) {
      res = res.map(function (it) { return { it: it, s: score(it, q, q) }; })
        .filter(function (o) { return o.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 60).map(function (o) { return o.it; });
    } else {
      res = res.slice(0, 30);
    }
    list.innerHTML = '';
    if (CUR_SUBJ === '我的笔记') {
      var bar = el('div', 'gsItem');
      bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;position:sticky;top:0;background:#fff;z-index:2;border-bottom:1px solid #f1f5f9';
      bar.innerHTML = '<b style="font-size:13px">我的笔记 · ' + res.length + ' 篇</b><span style="flex:1"></span>';
      var add = el('span', null, '＋ 新建笔记');
      add.style.cssText = 'background:#2563eb;color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer';
      add.onclick = function (e) { e.stopPropagation(); newNote(); };
      bar.appendChild(add);
      list.appendChild(bar);
    }
    if (!res.length) {
      list.appendChild(el('div', null, '<div id="gsEmpty">' + (READY ? '还没有笔记，点上面的「＋ 新建笔记」写一篇' : '正在加载笔记…') + '</div>'));
      return;
    }
    res.forEach(function (it) {
      var d = el('div', 'gsItem');
      var note = it.kind === 'tag' || it.kind === 'doc';
      d.innerHTML = '<b>' + esc2(it.t) + '</b><i>' + esc2(it.src + (it.page ? ' · ' + it.page : '')) + '</i>'
        + (note ? '<i style="float:right;color:#ef4444;cursor:pointer;font-size:12px" data-del="1">删除</i>' : '')
        + '<p>' + esc2(q ? snippet(it, q, 90) : it.x.replace(/\s+/g, ' ').slice(0, 90)) + '</p>';
      d.onclick = function (e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-del')) { delNote(it, e); return; }
        if (note) { openNote(it); return; }
        openPeek(it);
      };
      list.appendChild(d);
    });
  }

  function boot() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.GS = { open: open, close: close };
})();
