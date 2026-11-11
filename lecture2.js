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

  /* ---------- 讲义目录 ----------
     线上 github.io 只有 ~20KB/s：老的 index.json 375KB 要等十几秒，还常赶上站点重建（Failed to fetch）。
     现在：① 优先读 pdfimg/idx.json（紧凑版，78KB） ② 读到的目录存本机 localStorage，下次秒开
           ③ 失败自动重试 3 次，仍失败给「重试」按钮，不再抛裸 TypeError。 */
  var IDX_CACHE = 'qbank.lec.idx.v2';
  function parseCompact(j) {
    IDX = j; BYKEY = {};
    var map = {}, srcs = j.s || [];
    (j.e || []).forEach(function (r) {
      var key = r && r[0], src = srcs[(r && r[1]) | 0], p = (r && r[2]) | 0, n = (r && r[3]) | 0;
      if (!key || !src || !p) return;
      var f = String(src).split('/').pop();
      BYKEY[key] = { src: src, p: p, n: n, f: f };
      var g = map[src] || (map[src] = { src: src, f: f, n: 0, pages: {} });
      g.n = Math.max(g.n || 0, n || 0, p);
      g.pages[p] = key;
    });
    FILES = Object.keys(map).sort(function (a, b) { return a.localeCompare(b, 'zh'); }).map(function (k) { return map[k]; });
    return IDX;
  }
  function parseLegacy(j) {
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
  }
  function applyIdx(j) { return (j && j.s && j.e) ? parseCompact(j) : parseLegacy(j); }

  /* 注意：404 也是可缓存响应。之前用 ?t=<今天日期> + force-cache，
     站点重建那几分钟里拿到过一次 404，就会被浏览器缓存一整天 → 一直“目录没读出来”。
     现在：版本号做 key；重试时带随机数 + no-store，绝不吃坏缓存。 */
  var LEC_VER = '20261111h';
  function fetchJson(url, tries, ms) {
    tries = tries || 1;
    return new Promise(function (resolve, reject) {
      var n = 0;
      function once() {
        n++;
        var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
        var tid = setTimeout(function () { if (ctl) try { ctl.abort(); } catch (e) {} }, ms || 20000);
        var u = url + (url.indexOf('?') < 0 ? '?' : '&') + 'v=' + LEC_VER;
        var opt = { cache: 'force-cache' };
        if (n > 1) { u += '&nc=' + Date.now() + Math.random().toString(36).slice(2, 7); opt = { cache: 'no-store' }; }
        if (ctl) opt.signal = ctl.signal;
        fetch(u, opt)
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) { clearTimeout(tid); resolve(j); })
          .catch(function (e) { clearTimeout(tid); if (n < tries) setTimeout(once, 700 * n); else reject(e); });
      }
      once();
    });
  }

  /* ---------- 资源线路（多路兜底） ----------
     同一个文件在三条线路上都有：本站 github.io、gh-proxy 镜像、ghfast 镜像。
     实测 github.io 只有 18KB/s（1.3MB 的文字块要 73 秒，经常断），
     两个镜像 87-97KB/s。所以：能走镜像就走镜像，走通哪条就记住哪条（30 分钟）。 */
  var GH_RAW = 'https://raw.githubusercontent.com/stain37/shuati-web/main/';
  var COS = 'https://123ttt-1312809820.cos.ap-guangzhou.myqcloud.com/';
  var BASES = [
    { id: 'cos', pre: COS },
    { id: 'ghproxy', pre: 'https://gh-proxy.com/' + GH_RAW },
    { id: 'ghfast', pre: 'https://ghfast.top/' + GH_RAW },
    { id: 'origin', pre: '' }
  ];
  var BASE_KEY = 'qbank.lec.base.v1';
  var CUR_BASE = 'origin';
  function baseOrder() {
    var saved = readLS(BASE_KEY, null);
    var id = (saved && saved.id && Date.now() - (saved.ts || 0) < 30 * 60e3) ? saved.id : '';
    var arr = BASES.slice();
    if (id) arr.sort(function (a, b) { return (b.id === id ? 1 : 0) - (a.id === id ? 1 : 0); });
    return arr;
  }
  function setBase(id) {
    if (CUR_BASE === id) return;
    CUR_BASE = id;
    try { writeLS(BASE_KEY, { id: id, ts: Date.now() }); } catch (e) {}
  }
  function baseUrl(b, rel) { return b.pre ? b.pre + rel : rel; }

  /* 取文本（不用 r.json()，方便看进度/兜底） */
  function fetchText(url, ms) {
    return new Promise(function (resolve, reject) {
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      var tid = setTimeout(function () { if (ctl) try { ctl.abort(); } catch (e) {} }, ms || 40000);
      var opt = { cache: 'no-store' };
      if (ctl) opt.signal = ctl.signal;
      fetch(url, opt).then(function (r) {
        clearTimeout(tid);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(resolve).catch(function (e) { clearTimeout(tid); reject(e); });
    });
  }

  /* 逐条线路试，成功即记住这条线路 */
  function fetchAsset(rel, o) {
    o = o || {};
    var list = baseOrder(), i = 0;
    function next(lastErr) {
      if (i >= list.length) return Promise.reject(lastErr || new Error('所有线路都不通'));
      var b = list[i++];
      var u = baseUrl(b, rel);
      if (o.json) {
        return fetchJson(u, o.tries || 1, o.timeout || 20000)
          .then(function (j) { setBase(b.id); return j; })
          .catch(next);
      }
      return fetchText(u, o.timeout || 40000)
        .then(function (t) { setBase(b.id); return t; })
        .catch(next);
    }
    return next(null);
  }

  function loadIndex(force) {
    if (IDX && !force) return Promise.resolve(IDX);
    if (!force) {
      var c = readLS(IDX_CACHE, null);
      if (c && c.raw) {
        try {
          applyIdx(JSON.parse(c.raw));
          /* 本机缓存 12 小时内直接用；更老的先用着，后台再刷 */
          if (Date.now() - (c.ts || 0) < 12 * 3600e3) return Promise.resolve(IDX);
          fetchAsset('pdfimg/idx.json', { json: true, timeout: 25000 }).then(function (j) {
            writeLS(IDX_CACHE, { ts: Date.now(), raw: JSON.stringify(j) });
            applyIdx(j); if (FILES && el.sel) { fillSelect(); paint(); }
          }).catch(function () {});
          return Promise.resolve(IDX);
        } catch (e) {}
      }
    }
    /* 同一个文件多放几个位置：某些网络对 pdfimg/ 这种大目录会 404 / 被中间层拦掉 */
    var urls = ['pdfimg/idx.json', 'data/lec-idx.json'], i = 0;
    function tryNext(lastErr) {
      if (i >= urls.length) return Promise.reject(lastErr || new Error('no url'));
      return fetchAsset(urls[i++], { json: true, tries: 2, timeout: 25000 }).then(function (j) {
        applyIdx(j);
        try { writeLS(IDX_CACHE, { ts: Date.now(), raw: JSON.stringify(j) }); } catch (e) {}
        return IDX;
      }).catch(tryNext);
    }
    return tryNext(null);
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
        '<button class="btn lec-hard" data-lec="hardreset" title="讲义一直加载不出来时点这个：清掉本站缓存再重载（题库/作答不受影响）">🧹 清缓存重载</button>' +
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
      if (a === 'imgretry') { IMG_TRIED = {}; return paint(); }
      if (a === 'retry') return ensureIndex(true);
      if (a === 'hardreset') return hardReset();
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

  var IMG_TRIED = {};
  function showEmpty(html) {
    if (!el.empty) return;
    el.empty.innerHTML = html;
    el.empty.style.display = '';
  }
  function setImg(rel) {
    if (!el.img) return;
    if (el.empty) el.empty.style.display = 'none';
    el.img.style.display = '';
    var list = baseOrder(), idx = 0, retried = false;
    function load() {
      var b = list[idx];
      if (!b) { fail(); return; }
      el.img.src = baseUrl(b, rel) + '?r=' + Date.now();
    }
    function fail() {
      el.img.style.display = 'none';
      showEmpty('这张页图没下来（网络慢或站点正在更新）。' +
        '<button class="btn tiny" data-lec="imgretry">重试</button>');
    }
    el.img.onload = function () {
      if (list[idx]) setBase(list[idx].id);
      if (el.empty) el.empty.style.display = 'none';
    };
    el.img.onerror = function () {
      if (!retried) { retried = true; load(); return; }   /* 同一线路再试一次 */
      retried = false; idx++;
      if (idx < list.length) { load(); return; }          /* 换下一条线路 */
      fail();
    };
    load();
  }

  /* 取「某份讲义第 N 页」对应的页图 key。
     个别旧缓存里的 FILES 项可能没有 pages 表（pages === null），
     以前这里直接 f.pages[p] 会抛 "Cannot read properties of null (reading '509')"，
     整个「定位到这题」就废了。现在无论如何都兜得住。 */
  function keyFor(src, p) {
    p = p | 0;
    var f = null;
    try { f = fileOf(src); } catch (e) { f = null; }
    if (f && f.pages && f.pages[p]) return f.pages[p];
    for (var k in BYKEY) {
      var o = BYKEY[k];
      if (o && o.src === src && (o.p | 0) === p) return k;
    }
    return null;
  }

  function paint() {
   try {
    var f = fileOf(CUR.src);
    if (!f) { if (el.img) el.img.removeAttribute('src'); return; }
    var n = f.n || 1;
    CUR.p = Math.max(1, Math.min(n, CUR.p | 0));
    if (el.sel) el.sel.value = CUR.src;
    if (el.page) el.page.value = CUR.p;
    if (el.total) el.total.textContent = '/ ' + n;
    if (el.meta) el.meta.textContent = f.f.replace(/\.pdf$/i, '').slice(0, 28);
    var key = keyFor(CUR.src, CUR.p);
    if (key) setImg('pdfimg/' + key + '.webp');
    else {
      el.img.removeAttribute('src');
      el.img.style.display = 'none';
      showEmpty('这份讲义还没有页图，点右下角「看整本 PDF」。');
    }
    remember();
    paintPin();
   } catch (e) { try { toast('这页没显示出来：' + (e && e.message ? e.message : e)); } catch (e2) {} }
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
  function findParts(raw) {
    var inc = [], exc = [];
    String(raw || '').split(/[\s,，、;；]+/).forEach(function (x) {
      x = String(x || '').trim();
      if (!x) return;
      if (/^[-－—]/.test(x)) { x = x.replace(/^[-－—]+/, '').trim(); if (x) exc.push(x); }
      else inc.push(x);
    });
    return { inc: inc, exc: exc };
  }
  function findTerms(raw) { return findParts(raw).inc; }
  function countOf(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  }
  function escHtml(x) {
    return String(x).replace(/[<>&]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]; });
  }
  function snippet(t, terms) {
    if (!(terms instanceof Array)) terms = [String(terms || '')];
    terms = terms.filter(function (x) { return x; });
    var low = t.toLowerCase(), at = -1, key = '';
    for (var k = 0; k < terms.length; k++) {
      var p = low.indexOf(terms[k].toLowerCase());
      if (p >= 0 && (at < 0 || p < at)) { at = p; key = terms[k]; }
    }
    if (at < 0) return escHtml(t.slice(0, 92)) + (t.length > 92 ? '…' : '');
    var a = Math.max(0, at - 32), b = Math.min(t.length, at + (key ? key.length : 2) + 52);
    var s2 = t.slice(a, b).replace(/\s+/g, ' ');
    var out = escHtml(s2);
    terms.forEach(function (w) {
      if (!w) return;
      try {
        var re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        out = out.replace(re, '<b class="hl">$1</b>');
      } catch (e) {}
    });
    return (a > 0 ? '…' : '') + out + (b < t.length ? '…' : '');
  }
  function doFind() {
    var raw = (el.find && el.find.value || '').trim();
    if (!raw) { hideHits(); return; }
    var parts = findParts(raw), terms = parts.inc, exc = parts.exc;
    if (!terms.length) { hideHits(); toast('至少写一个要搜的词（以 - 开头的算排除）'); return; }
    if (terms.join('').length < 2) toast('至少两个字，不然搜出来一大片');
    var all = !!(el.findAll && el.findAll.checked);
    (all ? loadText() : loadTextSubj()).then(function (rows) {
      var out = [];
      (rows || []).forEach(function (r) {
        if (!r || !r.t) return;
        if (!all && r.src !== CUR.src) return;
        var t = String(r.t), low = t.toLowerCase(), n = 0, ok = true;
        for (var b = 0; b < exc.length; b++) { if (low.indexOf(exc[b].toLowerCase()) >= 0) { ok = false; break; } }
        if (!ok) return;
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
      renderHits(terms, exc);
      if (!HITS.length) toast('没搜到「' + terms.join(' + ') + '」' + (all ? '' : '（试试勾「全部讲义」）') + '（扫描页没有文字，只能靠 📌 手动绑）');
    }).catch(function (e) { toast('讲义文字还没准备好：' + (e.message || e)); });
  }
  function renderHits(terms, exc) {
    if (!el.hits) return;
    if (!HITS.length) { el.hits.innerHTML = ''; el.hits.hidden = true; return; }
    if (typeof terms === 'string') terms = findTerms(terms);
    if (!(terms instanceof Array)) terms = [];
    exc = exc || [];
    var head = (el.findAll && el.findAll.checked ? '全部讲义 · ' : '本讲义 · ') +
      '找到 ' + HITS.length + ' 页' + (terms.length > 1 ? '（同时包含：' + terms.join(' / ') + '）' : '') +
      (exc.length ? '（排除：' + exc.join(' / ') + '）' : '');
    var h = '<div class="lec-hits-t">' + head + '（点一条跳过去）</div>';
    HITS.forEach(function (r, i) {
      h += '<button class="lec-hit" data-lec="hit" data-i="' + i + '">' +
        '<i class="hpage">第 ' + r.p + ' 页</i>' +
        '<em class="hfile">' + (r.same ? '本讲义' : String(r.f || r.src).replace(/\.pdf$/i, '')) + '</em>' +
        '<span class="htxt">' + snippet(r.t, terms) + '</span>' +
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
    /* 先把讲义抽屉收起来：抽屉的层级比阅读器高，不收会被盖住，看着像「PDF 打不开」 */
    try { close(); } catch (e) {}
    try {
      if (typeof aiPdfFullscreen === 'function') { aiPdfFullscreen(f.src, f.f, f.src, String(CUR.p)); return; }
    } catch (e) {}
    window.open(url, '_blank');
  }


  /* ---------- ② 按题干自动定位到最可能的讲义页 ---------- */
  var TXT = null, TXT_JOB = null, CAND = [], CAND_I = 0, HIT_ROWS = null;
  var TXT_CACHE = {}, MAN = null, MAN_JOB = null;
  var IDB_NAME = 'qbank-lec', IDB_STORE = 'kv';
  function idb(kind, k, v) {
    return new Promise(function (resolve) {
      var rq;
      try { rq = indexedDB.open(IDB_NAME, 1); } catch (e) { return resolve(null); }
      rq.onupgradeneeded = function () { try { rq.result.createObjectStore(IDB_STORE); } catch (e) {} };
      rq.onerror = function () { resolve(null); };
      rq.onsuccess = function () {
        var db = rq.result;
        try {
          var st = db.transaction(IDB_STORE, kind === 'get' ? 'readonly' : 'readwrite').objectStore(IDB_STORE);
          var q = (kind === 'get') ? st.get(k) : st.put(v, k);
          q.onsuccess = function () { resolve((kind === 'get') ? (q.result || null) : true); };
          q.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      };
    });
  }

  /* ---------- 讲义文字索引：按科目切成 ~1.3MB 的小块，弱网也能一块块下完 ---------- */
  function loadManifest() {
    if (MAN) return Promise.resolve(MAN);
    if (MAN_JOB) return MAN_JOB;
    MAN_JOB = fetchAsset('pdftext/t_index.json', { json: true, tries: 2, timeout: 15000 }).then(function (m) { MAN = m; return m; })
      .catch(function (e) { MAN_JOB = null; throw e; });
    return MAN_JOB;
  }
  function subjOf(src) { var p = String(src || '').split('/'); return p.length > 2 ? p[1] : ''; }
  /* 把一块原始数据收拾成行；任何坏行都跳过（老版本缓存 / 半截下载的文件都可能混进 null） */
  function rowsOf(arr) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (!r) continue;
      if (Array.isArray(r)) {
        var src0 = String(r[2] || '');
        out.push({ k: r[0], p: r[1], src: src0, f: src0.split('/').pop(), t: String(r[3] == null ? '' : r[3]) });
      } else if (typeof r === 'object') {
        var src1 = String(r.src || '');
        out.push({ k: r.k, p: r.p, src: src1, f: r.f || src1.split('/').pop(), t: String(r.t == null ? '' : r.t) });
      }
    }
    return out.filter(function (x) { return x.t; });
  }
  function loadPart(pid) {
    if (TXT_CACHE[pid]) return Promise.resolve(TXT_CACHE[pid]);
    return idb('get', 'part:' + pid).then(function (c) {
      var cached = (c && Array.isArray(c.rows)) ? c.rows.filter(Boolean) : null;
      if (cached && cached.length) { TXT_CACHE[pid] = cached; return cached; }
      return fetchAsset('pdftext/' + pid + '.json', { json: true, tries: 2, timeout: 45000 }).then(function (arr) {
        var rows = rowsOf(arr);
        if (!rows.length) throw new Error('这一块是空的');
        TXT_CACHE[pid] = rows;
        idb('set', 'part:' + pid, { ts: Date.now(), rows: rows });
        return rows;
      }).catch(function (e) {
        /* 缓存或网络坏了：把这一块的缓存删掉，下次重来 */
        idb('set', 'part:' + pid, null);
        throw e;
      });
    });
  }
  function partsFor(subj) {
    return loadManifest().then(function (m) {
      var ps = (m.parts || []).filter(function (p) { return !subj || p.subj === subj; });
      if (!ps.length && subj) ps = (m.parts || []);
      return ps;
    });
  }
  function loadRows(subj, label) {
    return partsFor(subj).then(function (ps) {
      var out = [];
      return ps.reduce(function (chain, p, i) {
        return chain.then(function () {
          if (label) toast('正在下载讲义文字 ' + (i + 1) + ' / ' + ps.length + '（' + p.subj + '）…');
          return loadPart(p.id).then(function (rows) { out = out.concat(rows); })
            .catch(function () { /* 某一块失败就跳过，别整个失败 */ });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }
  /* 本讲义所在科目的文字（定位 / 本讲义搜索用） */
  function loadTextSubj(subj) { return loadRows(subj || subjOf(CUR.src), true); }
  /* 全部科目（「全部讲义」搜索用） */
  function loadText() {
    if (TXT && TXT.length) return Promise.resolve(TXT);
    if (TXT_JOB) return TXT_JOB;
    TXT_JOB = loadRows('', true).then(function (rows) { TXT = rows; return rows; })
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
  function searchIn(TXT, qtext) {
    if (!TXT || !TXT.length) return [];
    var q = normText(qtext);
    if (q.length < 6) return [];
    var qg = grams(q);
    var keys = Object.keys(qg).slice(0, 260);
    if (!keys.length) return [];
    /* 文档频率 → idf：越少见的字对越有用（题库题干的常用词自动降权） */
    var df = {}, i, j;
    for (i = 0; i < TXT.length; i++) {
      if (!TXT[i]) continue;
      var t = TXT[i]._n || (TXT[i]._n = normText(TXT[i].t));
      for (j = 0; j < keys.length; j++) if (t.indexOf(keys[j]) >= 0) df[keys[j]] = (df[keys[j]] || 0) + 1;
    }
    var N = TXT.length, idf = {};
    keys.forEach(function (g) { idf[g] = Math.log(1 + N / (1 + (df[g] || 0))); });
    var scored = [];
    for (i = 0; i < TXT.length; i++) {
      if (!TXT[i] || !TXT[i]._n) continue;
      var n2 = TXT[i]._n, sc = 0, hit = 0;
      for (j = 0; j < keys.length; j++) {
        if (df[keys[j]] && n2.indexOf(keys[j]) >= 0) { sc += idf[keys[j]]; hit++; }
      }
      if (sc > 0) scored.push({ i: i, score: sc, hit: hit, len: n2.length });
    }
    scored.sort(function (a, b) { return b.score - a.score || b.hit - a.hit; });
    return scored.slice(0, 8);
  }
  /* ---------- 让 AI 从候选里挑一页（语义判断，替代人肉点「换个候选」） ----------
     候选是本地关键词粗筛出的前 8 页（带正文片段），交给模型只做一件事：
     判断哪一页最像这题的讲义依据。失败就退回关键词第一页，不影响使用。 */
  function aiPickPage(q, hits) {
    if (typeof window.aiChat !== 'function') return Promise.resolve(null);
    var rows = HIT_ROWS || [];
    var lines = hits.map(function (h, n) {
      var r = rows[h.i] || {};
      var f = String(r.f || r.src || '').replace(/\.pdf$/i, '');
      var t = String(r.t || '').replace(/\s+/g, ' ').slice(0, 200);
      return (n + 1) + '. 《' + f.slice(0, 24) + '》 第 ' + r.p + ' 页：' + t;
    }).join('\n');
    var msgs = [
      { role: 'system', content: '你是医学考研题库的讲义定位助手。用户给出一道题和若干候选讲义页（含文件名、页码、正文片段）。请判断哪一页最可能是这道题在讲义里的依据页（考点讲解、答案依据所在页）。只输出一行 JSON：{"i": 序号, "why": "不超过20字"}。没把握就选最相关的那页，也必须给一个序号。' },
      { role: 'user', content: '【题目】\n' + String(q).slice(0, 700) + '\n\n【候选页】\n' + lines }
    ];
    return window.aiChat(msgs, null, null, { stream: false, temp: 0, maxTokens: 80 }).then(function (txt) {
      var m = String(txt || '').match(/\{[\s\S]*?\}/);
      if (!m) return null;
      var o = null;
      try { o = JSON.parse(m[0]); } catch (e) { return null; }
      var i = (+o.i || 0) - 1;
      if (i < 0 || i >= hits.length) return null;
      return { i: i, why: String(o.why || '').slice(0, 24) };
    });
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
    loadTextSubj().then(function (rows) {
      HIT_ROWS = rows || [];
      var hits = searchIn(HIT_ROWS, q);
      if (!hits.length) { if (el.meta) el.meta.textContent = ''; toast('没在这批讲义里找到相关内容'); return; }
      CAND = hits; CAND_I = 0;
      jumpTo(hits[0]);                       /* 先用关键词第一页垫底，AI 选完再纠正 */
      if (el.meta) el.meta.textContent = 'AI 正在看这几页，挑最像的一页…';
      return aiPickPage(q, hits).then(function (pick) {
        if (!pick) { if (el.meta) el.meta.textContent = '定位：关键词最像的一页（没配 AI，或 AI 没回话）'; return; }
        CAND_I = pick.i;
        jumpTo(hits[pick.i]);
        if (el.meta) {
          var r = HIT_ROWS[hits[pick.i].i] || {};
          var f = fileOf(r.src);
          el.meta.textContent = 'AI 定位：' + (f ? f.f.replace(/\.pdf$/i, '').slice(0, 16) : '') + ' 第 ' + r.p + ' 页' + (pick.why ? ' · ' + pick.why : '');
        }
      }).catch(function () { if (el.meta) el.meta.textContent = '定位：关键词最像的一页（AI 不可用）'; });
    }).catch(function (e) {
      if (el.meta) el.meta.textContent = '';
      toast('页文字索引还没生成（' + e.message + '）');
    });
  }
  function jumpTo(hit) {
    /* 以前这里读全局 TXT，但 TXT 只有「全部讲义」搜索时才会填充；
       用「当前讲义 / 当前科目」搜索时它是 null → TXT[509] 抛
       "Cannot read properties of null (reading '509')"，整个定位就废了。 */
    var rec = (HIT_ROWS && HIT_ROWS[hit.i]) || (TXT && TXT[hit.i]);
    if (!rec) { toast('这一页的文字没读到，换一页试试'); return; }
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

  function hardReset() {
    if (!window.confirm('清掉本站缓存并重新载入？题库和作答记录不受影响。')) return;
    var jobs = [];
    try { jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    try { jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    Promise.all(jobs).catch(function () {}).then(function () {
      try { localStorage.removeItem('qbank.lec.idx.v2'); } catch (e) {}
      location.reload();
    });
  }

  function ensureIndex(force) {
    if (el.meta) el.meta.textContent = force ? '重新读讲义目录…' : '正在读讲义目录…';
    return loadIndex(force).then(function () {
      restore(); fillSelect(); paint(); applyBind();
    }).catch(function (e) {
      window.__lecLastErr = e || null;
      if (el.meta) {
        var why = (window.__lecLastErr && window.__lecLastErr.message) || '';
        el.meta.innerHTML = '目录没读出来' + (why ? '（' + why + '）' : '（网络慢，或站点正在更新）') +
          '<button class="lec-retry" data-lec="retry">重试</button>' +
          '<button class="lec-retry" data-lec="hardreset" title="清掉本站缓存再重新加载（修一切“改了没生效 / 一直失败”）">清缓存重载</button>';
      }
    });
  }

  function open() {
    build();
    if (!el.sheet) return;
    el.mask.classList.add('on'); el.sheet.classList.add('on');
    if (!FILES) { ensureIndex(false); return; }
    if (!CUR.src) restore();
    fillSelect(); paint(); applyBind();
  }

  function close() { unzoom(); if (el.mask) el.mask.classList.remove('on'); if (el.sheet) el.sheet.classList.remove('on'); }

  function close() { unzoom(); if (el.mask) el.mask.classList.remove('on'); if (el.sheet) el.sheet.classList.remove('on'); }

  /* 答题页的「📖 讲义」按钮：委托点击，不依赖 app.js 重新绑 */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#doLec');
    if (!b) return;
    ev.preventDefault();
    open();
  }, true);

  window.LECTURE = { open: open, close: close, load: loadIndex, locate: locate, search: function (q) { return TXT ? searchIn(TXT, q) : []; }, text: loadText, textSubj: loadTextSubj,
    bind: putBind, unbind: delBind, bound: getBind, binds: function () { return bindAll(); },
    find: function (q) { if (el.find) el.find.value = q || ''; doFind(); }, state: function () { return { src: CUR.src, p: CUR.p, files: (FILES || []).length }; },
    files: function () { return FILES; }, pageKey: keyFor };
})();
