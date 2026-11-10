/* lecture.js —— 讲义页（预渲染页图，秒开）
   数据来自 pdfimg/index.json：{ "<key>": { f: 文件名, p: 页码, n: 总页数, src: "pdf/内科/xxx.pdf" } }
   用法：答题页点「📖 讲义」→ 选讲义 → 翻页 / 放大 / 看整本 PDF
   2026-11-10 起：内科 75 份讲义的全部 539 页已预渲染为 1200px webp，直接出图不走 PDF。 */
(function () {
  if (window.LECTURE) return;
  var LS = 'qbank.lec.v1';       /* { bankId: { src, p } } */
  var IDX = null, FILES = null, BYKEY = {};
  var CUR = { src: '', p: 1, n: 1 };
  var el = {};

  function $(s, r) { return (r || document).querySelector(s); }
  function ce(t, c, h) { var d = document.createElement(t); if (c) d.className = c; if (h != null) d.innerHTML = h; return d; }
  function readLS(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(t) {
    try { if (typeof T === 'function') return T(t, 2400); } catch (e) {}
    var d = $('#lecToast');
    if (!d) { d = ce('div'); d.id = 'lecToast'; d.className = 'lec-toast'; document.body.appendChild(d); }
    d.textContent = t; d.classList.add('on');
    clearTimeout(d._t); d._t = setTimeout(function () { d.classList.remove('on'); }, 2400);
  }

  function loadIndex() {
    if (IDX) return Promise.resolve(IDX);
    return fetch('pdfimg/index.json?t=' + new Date().toISOString().slice(0, 10), { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        IDX = j; BYKEY = {};
        var map = {};
        Object.keys(j).forEach(function (k) {
          var o = j[k] || {}; if (!o.src) return;
          BYKEY[k] = o;
          var g = map[o.src] || (map[o.src] = { src: o.src, f: o.f, n: 0, pages: {} });
          g.n = Math.max(g.n || 0, o.n || 0, o.p || 0);
          g.pages[o.p] = k;
          if ((o.n || 0) > g.n) g.n = o.n;
        });
        FILES = Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'zh'); }).map(function (k) { return map[k]; });
        return IDX;
      });
  }

  function subjects() {
    var s = {};
    (FILES || []).forEach(function (f) { var t = (f.src.split('/')[1] || '其他'); (s[t] || (s[t] = [])).push(f); });
    return s;
  }

  function fileOf(src) {
    for (var i = 0; i < (FILES || []).length; i++) if (FILES[i].src === src) return FILES[i];
    return null;
  }

  function bankKey() {
    try { if (typeof QZ !== 'undefined' && QZ && QZ.bankId) return QZ.bankId; } catch (e) {}
    return '';
  }

  /* ---------- 题 → 讲义页 绑定（人工校正） ---------- */
  var BINDS = 'qbank.lec.bind.v1';   /* { "bankId#qid": { src, p, f, n, ts } } */
  function qid() {
    try { if (typeof QZ !== 'undefined' && QZ && QZ.cur != null && QZ.cur !== '') return String(QZ.cur); } catch (e) {}
    return '';
  }
  function qKey() { var b = bankKey(), q = qid(); return (b && q) ? (b + '#' + q) : ''; }
  function bindAll() { return readLS(BINDS, {}); }
  function getBind() { var m = bindAll(), k = qKey(); return k ? (m[k] || null) : null; }
  function putBind(src, p) {
    var k = qKey(); if (!k) { toast('先在答题页选一道题，再来绑讲义页'); return null; }
    var f = fileOf(src); if (!f) { toast('这份讲义不在目录里'); return null; }
    var m = bindAll();
    m[k] = { src: src, p: (p | 0) || 1, f: f.f, n: f.n, ts: Date.now() };
    writeLS(BINDS, m);
    return m[k];
  }
  function delBind() { var m = bindAll(), k = qKey(); if (!k || !m[k]) return false; delete m[k]; writeLS(BINDS, m); return true; }

  function remember() {
    var m = readLS(LS, {});
    var k = bankKey(); if (!k) return;
    m[k] = { src: CUR.src, p: CUR.p };
    writeLS(LS, m);
  }

  function restore() {
    var m = readLS(LS, {});
    var rec = m[bankKey()];
    if (rec && fileOf(rec.src)) { CUR.src = rec.src; CUR.p = rec.p || 1; return; }
    var nk = fileOf('pdf/内科/内科 1.1  COPD  精编版（已勘误）    .pdf');
    var subj = subjects();
    var first = (subj['内科'] && subj['内科'][0]) || (FILES && FILES[0]);
    CUR.src = (nk || first || {}).src || '';
    CUR.p = 1;
  }

  function build() {
    if (el.sheet) return;
    var mask = ce('div', 'lec-mask'); mask.id = 'lecMask';
    var sheet = ce('div', 'lec-sheet'); sheet.id = 'lecSheet';
    sheet.innerHTML =
      '<div class="lec-head"><b>讲义页</b><span id="lecMeta" class="lec-meta"></span>' +
        '<button class="lec-loc" data-lec="loc" title="按当前这道题的题干，自动翻到最像的那一页">🔍 定位到这题</button>' +
        '<button class="lec-pin" data-lec="pin" title="把这一页记成当前这道题的讲义页，以后打开直接到这儿">📌 就用这页</button>' +
        '<span id="lecPinState" class="lec-pinstate"></span>' +
        '<button class="lec-x" data-lec="close" title="关闭（Esc）">×</button></div>' +
      '<div class="lec-bar">' +
        '<select id="lecFile" class="lec-sel" title="换一份讲义"></select>' +
        '<div class="lec-pager">' +
          '<button data-lec="prev" title="上一页（←）">‹</button>' +
          '<input id="lecPage" type="number" min="1" step="1" inputmode="numeric" title="跳到第几页">' +
          '<span id="lecTotal" class="lec-total"></span>' +
          '<button data-lec="next" title="下一页（→）">›</button>' +
        '</div>' +
      '</div>' +
      '<div class="lec-find"><input id="lecFind" type="search" placeholder="搜讲义里的字…（空格分隔＝都要有）" title="多个词用空格隔开，只出同时包含这些词的页"><button data-lec="find" title="搜一下（回车也行）">🔎</button>' +
        '<label class="lec-fa" title="勾上＝在这套题库相关的全部讲义里找；不勾＝只找当前这份"><input type="checkbox" id="lecFindAll">全部讲义</label></div>' +
      '<div class="lec-hits" id="lecHits" hidden></div>' +
      '<div class="lec-body" id="lecBody"><img id="lecImg" alt="讲义原页"><div id="lecEmpty" class="lec-empty">这份讲义还没有页图，点右下角「看整本 PDF」。</div></div>' +
      '<div class="lec-foot">' +
        '<button class="btn" data-lec="zoom">⤢ 放大看</button>' +
        '<button class="btn" data-lec="pdf">📄 看整本 PDF</button>' +
      '</div>';
    var zoom = ce('div', 'lec-zoom'); zoom.id = 'lecZoom'; zoom.innerHTML = '<img alt="讲义原页（放大）"><button data-lec="unzoom">×</button>';
    document.body.appendChild(mask); document.body.appendChild(sheet); document.body.appendChild(zoom);
    el = { mask: mask, sheet: sheet, meta: $('#lecMeta'), sel: $('#lecFile'), page: $('#lecPage'), total: $('#lecTotal'), img: $('#lecImg'), empty: $('#lecEmpty'), zoom: zoom,
      hits: $('#lecHits'), find: $('#lecFind'), findAll: $('#lecFindAll') };

    mask.addEventListener('click', close);
    sheet.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-lec]'); if (!b) return;
      var a = b.getAttribute('data-lec');
      if (a === 'close') return close();
      if (a === 'loc') return locate();
      if (a === 'pin') return pinNow();
      if (a === 'unpin') return unpinNow();
      if (a === 'alt') return nextCand();
      if (a === 'prev') return go(CUR.p - 1);
      if (a === 'next') return go(CUR.p + 1);
      if (a === 'zoom') return doZoom();
      if (a === 'unzoom') return unzoom();
      if (a === 'pdf') return openPdf();
      if (a === 'find') return doFind();
      if (a === 'hit') return goHit(b.getAttribute('data-i'));
    });
    zoom.addEventListener('click', function (ev) { if (ev.target.closest('[data-lec="unzoom"]') || ev.target === zoom) unzoom(); });
    el.sel.addEventListener('change', function () { CUR.src = el.sel.value; CUR.p = 1; paint(); remember(); });
    el.page.addEventListener('change', function () { go(parseInt(el.page.value, 10) || 1); });
    if (el.find) {
      el.find.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); doFind(); }
        else if (ev.key === 'Escape') { hideHits(); ev.stopPropagation(); }
      });
      el.find.addEventListener('input', function () { if (!el.find.value.trim()) hideHits(); });
      if (el.findAll) el.findAll.addEventListener('change', function () { if (el.find.value.trim()) doFind(); });
    }
    document.addEventListener('keydown', function (ev) {
      if (!el.sheet || !el.sheet.classList.contains('on')) return;
      if (ev.key === 'Escape') { unzoom(); close(); }
      else if (ev.key === 'ArrowLeft') { go(CUR.p - 1); ev.preventDefault(); }
      else if (ev.key === 'ArrowRight') { go(CUR.p + 1); ev.preventDefault(); }
    });
    /* 图片点一下也放大 */
    el.img.addEventListener('click', doZoom);
  }

  function fillSelect() {
    if (!el.sel) return;
    var subj = subjects();
    var html = '';
    Object.keys(subj).sort(function (a, b) { return a.localeCompare(b, 'zh'); }).forEach(function (s) {
      html += '<optgroup label="' + s + '（' + subj[s].length + ' 份）">';
      subj[s].forEach(function (f) {
        var label = f.f.replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim();
        if (label.length > 34) label = label.slice(0, 34) + '…';
        html += '<option value="' + f.src.replace(/"/g, '&quot;') + '">' + label + ' · ' + f.n + ' 页</option>';
      });
      html += '</optgroup>';
    });
    el.sel.innerHTML = html;
  }

  function paint() {
    var f = fileOf(CUR.src);
    if (!f) { if (el.img) el.img.removeAttribute('src'); return; }
    var n = f.n || 1;
    CUR.p = Math.max(1, Math.min(n, CUR.p | 0));
    if (el.sel) el.sel.value = CUR.src;
    if (el.page) el.page.value = CUR.p;
    if (el.total) el.total.textContent = '/ ' + n;
    if (el.meta) el.meta.textContent = f.f.replace(/\.pdf$/i, '').slice(0, 28);
    var key = f.pages[CUR.p];
    if (key) {
      el.img.src = 'pdfimg/' + key + '.webp';
      el.img.style.display = '';
      if (el.empty) el.empty.style.display = 'none';
    } else {
      el.img.removeAttribute('src');
      el.img.style.display = 'none';
      if (el.empty) el.empty.style.display = '';
    }
    remember();
    paintPin();
  }

  function paintPin() {
    var sp = $('#lecPinState'); if (!sp) return;
    sp.innerHTML = '';
    if (!qKey()) { sp.className = 'lec-pinstate'; sp.textContent = '（没在答题页）'; return; }
    var b = getBind();
    if (b && fileOf(b.src)) {
      var lab = String(b.f || '').replace(/\.pdf$/i, '');
      sp.className = 'lec-pinstate on';
      sp.appendChild(document.createTextNode('📌 已绑定 ' + lab.slice(0, 16) + ' 第 ' + b.p + ' 页 '));
      var u = document.createElement('button');
      u.className = 'lec-unpin'; u.setAttribute('data-lec', 'unpin'); u.textContent = '解绑';
      sp.appendChild(u);
    } else {
      sp.className = 'lec-pinstate';
      sp.textContent = '还没绑定';
    }
  }

  function pinNow() {
    var b = putBind(CUR.src, CUR.p);
    if (!b) return;
    CAND = []; var alt = $('#lecAlt'); if (alt) alt.style.display = 'none';
    toast('已绑定：' + String(b.f).replace(/\.pdf$/i, '').slice(0, 18) + ' 第 ' + b.p + ' 页');
    paintPin();
  }
  function unpinNow() {
    if (!delBind()) { toast('这题还没绑定'); return; }
    toast('已解绑，以后这题改按文字自动定位');
    paintPin();
  }

  function applyBind() {
    var b = getBind();
    if (b && fileOf(b.src)) { CUR.src = b.src; CUR.p = b.p; paint(); return true; }
    return false;
  }

  /* ---------- 搜文字找页（页图上没法高亮，所以给「页码 + 上下文」，点一下跳过去） ---------- */
  var HITS = [];
  function hideHits() { HITS = []; if (el.hits) { el.hits.hidden = true; el.hits.innerHTML = ''; } }
  function snippet(t, q) {
    var i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return t.slice(0, 90);
    var a = Math.max(0, i - 34), b = Math.min(t.length, i + q.length + 46);
    return (a > 0 ? '…' : '') + t.slice(a, b).replace(/\s+/g, ' ') + (b < t.length ? '…' : '');
  }
  function findTerms(raw) {
    return String(raw || '').split(/[\s,，、;；]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 0; });
  }
  function countOf(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }
  function doFind() {
    var raw = (el.find && el.find.value || '').trim();
    if (!raw) { hideHits(); return; }
    var terms = findTerms(raw);
    if (!terms.length) { hideHits(); return; }
    if (terms.join('').length < 2) toast('至少两个字，不然搜出来一大片');
    var all = !!(el.findAll && el.findAll.checked);
    loadText().then(function (rows) {
      var out = [];
      (rows || []).forEach(function (r) {
        if (!r || !r.t) return;
        if (!all && r.src !== CUR.src) return;
        var t = String(r.t), low = t.toLowerCase(), n = 0, ok = true;
        for (var k = 0; k < terms.length; k++) {
          var w = terms[k].toLowerCase(), c = countOf(low, w);
          if (!c) { ok = false; break; }
          n += c;
        }
        if (!ok) return;
        out.push({ src: r.src, p: r.p, f: r.f, t: t, n: n, same: r.src === CUR.src });
      });
      out.sort(function (a, b) { return (b.same ? 1 : 0) - (a.same ? 1 : 0) || b.n - a.n || a.p - b.p; });
      HITS = out.slice(0, 30);
      renderHits(terms);
      if (!HITS.length) toast('没搜到「' + terms.join(' + ') + '」' + (all ? '' : '（试试勾「全部讲义」）') + '（扫描页没有文字，只能靠 📌 手动绑）');
    }).catch(function (e) { toast('讲义文字还没准备好：' + (e.message || e)); });
  }
  function renderHits(terms) {
    if (!el.hits) return;
    if (!HITS.length) { el.hits.hidden = true; return; }
    if (typeof terms === 'string') terms = findTerms(terms);
    var head = (el.findAll && el.findAll.checked ? '全部讲义 · ' : '本讲义 · ') +
      '找到 ' + HITS.length + ' 页' + (terms.length > 1 ? '（同时包含：' + terms.join(' / ') + '）' : '');
    var h = '<div class="lec-hits-t">' + head + '（点一条跳过去）</div>';
    HITS.forEach(function (r, i) {
      h += '<button class="lec-hit" data-lec="hit" data-i="' + i + '">' +
        '<i class="hpage">第 ' + r.p + ' 页</i>' +
        '<em class="hfile">' + (r.same ? '本讲义' : String(r.f || r.src).replace(/\.pdf$/i, '')) + '</em>' +
        '<span class="htxt">' + snippet(r.t, terms[0]).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; }) + '</span>' +
        '</button>';
    });
    el.hits.innerHTML = h;
    el.hits.hidden = false;
    el.hits.scrollTop = 0;
  }
  function goHit(i) {
    var r = HITS[parseInt(i, 10)]; if (!r) return;
    if (r.src !== CUR.src) { var f = fileOf(r.src); CUR.src = r.src; if (f) { CUR.n = f.n || CUR.n; var o = el.sel && el.sel.querySelector('option[value="' + r.src + '"]'); if (!o && el.sel) { fillSelect(); o = el.sel.querySelector('option[value="' + r.src + '"]'); } if (o) el.sel.value = r.src; } }
    CUR.p = r.p;
    paint(); remember();
    hideHits();
  }
  function go(p) { CUR.p = p; paint(); }

  function doZoom() {
    if (!el.img || !el.img.getAttribute('src')) return;
    var z = $('#lecZoom'); if (!z) return;
    z.querySelector('img').src = el.img.src;
    z.classList.add('on');
  }
  function unzoom() { var z = $('#lecZoom'); if (z) z.classList.remove('on'); }

  function openPdf() {
    var f = fileOf(CUR.src); if (!f) return;
    var url = f.src + (CUR.p ? '#page=' + CUR.p : '');
    try {
      if (typeof aiPdfFullscreen === 'function') { aiPdfFullscreen(f.src, f.f, f.src, String(CUR.p)); return; }
    } catch (e) {}
    window.open(url, '_blank');
  }


  /* ---------- ② 按题干自动定位到最可能的讲义页 ---------- */
  var TXT = null, TXT_JOB = null, CAND = [], CAND_I = 0;
  function loadText() {
    if (TXT) return Promise.resolve(TXT);
    if (TXT_JOB) return TXT_JOB;
    TXT_JOB = fetch('pdftext/all.json?t=' + new Date().toISOString().slice(0, 10))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { TXT = j || []; return TXT; })
      .catch(function (e) { TXT_JOB = null; throw e; });
    return TXT_JOB;
  }
  function normText(t) {
    return String(t || '').replace(/[\s\u3000]+/g, '')
      .replace(/[，。；：、！？（）()《》【】\[\]“”"'’‘·—…\-,.;:!?\/\\|]/g, '');
  }
  function grams(s) {
    var out = {}, i, n = s.length;
    for (i = 0; i < n - 1; i++) { var g = s.substr(i, 2); out[g] = (out[g] || 0) + 1; }
    return out;
  }
  function questionText() {
    var parts = [];
    var stem = document.querySelector('#qBody .stem, #qBody .gstem, .stem');
    if (stem) parts.push(stem.textContent || '');
    Array.prototype.forEach.call(document.querySelectorAll('#qBody .opt, .opts .opt'), function (el) {
      var t = (el.textContent || '').replace(/^[A-H][\s.、]?/, '').trim();
      if (t) parts.push(t);
    });
    return parts.join(' ');
  }
  function search(qtext) {
    if (!TXT || !TXT.length) return [];
    var q = normText(qtext);
    if (q.length < 6) return [];
    var qg = grams(q);
    var keys = Object.keys(qg).slice(0, 260);
    if (!keys.length) return [];
    /* 文档频率 → idf：越少见的字对越有用（题库题干的常用词自动降权） */
    var df = {}, i, j;
    for (i = 0; i < TXT.length; i++) {
      var t = TXT[i]._n || (TXT[i]._n = normText(TXT[i].t));
      for (j = 0; j < keys.length; j++) if (t.indexOf(keys[j]) >= 0) df[keys[j]] = (df[keys[j]] || 0) + 1;
    }
    var N = TXT.length, idf = {};
    keys.forEach(function (g) { idf[g] = Math.log(1 + N / (1 + (df[g] || 0))); });
    var scored = [];
    for (i = 0; i < TXT.length; i++) {
      var n2 = TXT[i]._n, sc = 0, hit = 0;
      for (j = 0; j < keys.length; j++) {
        if (df[keys[j]] && n2.indexOf(keys[j]) >= 0) { sc += idf[keys[j]]; hit++; }
      }
      if (sc > 0) scored.push({ i: i, score: sc, hit: hit, len: n2.length });
    }
    scored.sort(function (a, b) { return b.score - a.score || b.hit - a.hit; });
    return scored.slice(0, 8);
  }
  function locate() {
    var bd = getBind();
    if (bd && fileOf(bd.src)) {
      CUR.src = bd.src; CUR.p = bd.p; CAND = [];
      var alt0 = $('#lecAlt'); if (alt0) alt0.style.display = 'none';
      paint();
      if (el.meta) el.meta.textContent = '📌 已绑定：' + String(bd.f || '').replace(/\.pdf$/i, '').slice(0, 18) + ' 第 ' + bd.p + ' 页';
      toast('这题已绑过讲义页（想重新自动定位，先点「解绑」）');
      return;
    }
    var q = questionText();
    if (normText(q).length < 8) { toast('这题文字太少，没法定位'); return; }
    if (el.meta) el.meta.textContent = '正在翻讲义找这一页…';
    loadText().then(function () {
      var hits = search(q);
      if (!hits.length) { if (el.meta) el.meta.textContent = ''; toast('没在这批讲义里找到相关内容'); return; }
      CAND = hits; CAND_I = 0;
      jumpTo(hits[0]);
    }).catch(function (e) {
      if (el.meta) el.meta.textContent = '';
      toast('页文字索引还没生成（' + e.message + '）');
    });
  }
  function jumpTo(hit) {
    var rec = TXT[hit.i];
    if (!rec) return;
    if (fileOf(rec.src)) {
      CUR.src = rec.src; CUR.p = rec.p; paint();
      var f = fileOf(CUR.src);
      if (el.meta) el.meta.textContent = '定位：' + (f ? f.f.replace(/\.pdf$/i, '').slice(0, 18) : '') + ' 第 ' + rec.p + ' 页';
    } else {
      toast('这页的讲义文件不在目录里：' + rec.f);
    }
    if (CAND.length > 1) {
      var b = $('#lecAlt');
      if (!b) {
        b = ce('button', 'lec-alt'); b.id = 'lecAlt'; b.setAttribute('data-lec', 'alt');
        b.title = '这不是那页？看下一个可能的页'; b.textContent = '换个候选';
        var bar = $('.lec-bar'); if (bar) bar.appendChild(b);
      }
      b.textContent = '换个候选 ' + (CAND_I + 1) + '/' + CAND.length;
      b.style.display = '';
    }
  }
  function nextCand() {
    if (!CAND.length) return;
    CAND_I = (CAND_I + 1) % CAND.length;
    jumpTo(CAND[CAND_I]);
    toast('候选 ' + (CAND_I + 1) + '/' + CAND.length + '：' + (CAND[CAND_I].hit || 0) + ' 处命中');
  }

  function open() {
    build();
    if (!el.sheet) return;
    el.mask.classList.add('on'); el.sheet.classList.add('on');
    if (!FILES) {
      if (el.meta) el.meta.textContent = '正在读讲义目录…';
      loadIndex().then(function () { restore(); fillSelect(); paint(); applyBind(); })
        .catch(function (e) { if (el.meta) el.meta.textContent = '讲义目录没读出来：' + e; });
      return;
    }
    if (!CUR.src) restore();
    fillSelect(); paint(); applyBind();
  }

  function close() { unzoom(); if (el.mask) el.mask.classList.remove('on'); if (el.sheet) el.sheet.classList.remove('on'); }

  /* 答题页的「📖 讲义」按钮：委托点击，不依赖 app.js 重新绑 */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#doLec');
    if (!b) return;
    ev.preventDefault();
    open();
  }, true);

  window.LECTURE = { open: open, close: close, load: loadIndex, locate: locate, search: search, text: loadText,
    bind: putBind, unbind: delBind, bound: getBind, binds: function () { return bindAll(); },
    find: function (q) { if (el.find) el.find.value = q || ''; doFind(); }, state: function () { return { src: CUR.src, p: CUR.p, files: (FILES || []).length }; },
    files: function () { return FILES; }, pageKey: function (src, p) { var f = fileOf(src); return f && f.pages[p]; } };
})();
