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
  var IDX_CACHE = 'qbank.lec.idx.v3';
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
  var LEC_VER = '20261112a';
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
  var BINDS = 'qbank.lec.bind.v1';   /* { "bankId#qid": { v:2, list:[{ src, p, f, n, ts }], ts } }（旧格式是单个对象，读取时自动兼容） */
  function qid() {
    try { if (typeof QZ !== 'undefined' && QZ && QZ.cur != null && QZ.cur !== '') return String(QZ.cur); } catch (e) {}
    return '';
  }
  function qKey() { var b = bankKey(), q = qid(); return (b && q) ? (b + '#' + q) : ''; }
  function bindAll() { return readLS(BINDS, {}); }
  function normBinds(v) {
    if (!v) return [];
    if (v.list && typeof v.list.length === 'number') return v.list.filter(function (x) { return x && x.src; });
    if (v.src) return [{ src: v.src, p: v.p || 1, f: v.f || '', n: v.n || 0, ts: v.ts || Date.now() }];
    return [];
  }
  function getBinds() { var m = bindAll(), k = qKey(); return k ? normBinds(m[k]) : []; }
  function getBind() { return getBinds()[0] || null; }
  function putBind(src, p) {
    var k = qKey(); if (!k) { toast('先在答题页选一道题，再来绑讲义页'); return null; }
    var f = fileOf(src); if (!f) { toast('这份讲义不在目录里'); return null; }
    var m = bindAll(), list = normBinds(m[k]);
    var pg = (p | 0) || 1;
    var item = { src: src, p: pg, f: f.f, n: f.n, ts: Date.now() };
    var dup = -1;
    list.forEach(function (x, i) { if (x.src === src && (x.p | 0) === pg) dup = i; });
    if (dup >= 0) { list[dup] = item; } else { list.push(item); }
    if (list.length > 10) list = list.slice(list.length - 10);
    m[k] = { v: 2, list: list, ts: Date.now() };
    writeLS(BINDS, m);
    return { item: item, total: list.length, dup: dup >= 0 };
  }
  function delBindAt(i) {
    var m = bindAll(), k = qKey(); if (!k) return false;
    var list = normBinds(m[k]);
    if (i < 0 || i >= list.length) return false;
    list.splice(i, 1);
    if (list.length) { m[k] = { v: 2, list: list, ts: Date.now() }; } else { delete m[k]; }
    writeLS(BINDS, m);
    return true;
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
        '<button id="lecScopeBtn" class="lec-scope" data-lec="scope" title="定位范围（自动 / 指定讲义 / 指定科目）">🎯 自动</button>' +
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
        '<button class="btn" data-lec="notes" title="打开知识点笔记">📚 我的笔记</button>' +
        '<button class="btn lec-hard" data-lec="hardreset" title="讲义一直加载不出来时点这个：清掉本站缓存再重载（题库/作答不受影响）">🧹 清缓存重载</button>' +
      '</div>';
    var zoom = ce('div', 'lec-zoom'); zoom.id = 'lecZoom';
    zoom.innerHTML = '<div class="lec-zbar"><b>讲义原页 · 放大</b><span>点空白处、按 Esc 或点右上角关闭</span>' +
      '<button class="lec-zx" data-lec="unzoom" title="关闭（Esc）">×</button></div>' +
      '<img alt="讲义原页（放大）">';
    document.body.appendChild(mask); document.body.appendChild(sheet); document.body.appendChild(zoom);
    el = { mask: mask, sheet: sheet, meta: $('#lecMeta'), sel: $('#lecFile'), page: $('#lecPage'), total: $('#lecTotal'), img: $('#lecImg'), empty: $('#lecEmpty'), zoom: zoom,
      hits: $('#lecHits'), find: $('#lecFind'), findAll: $('#lecFindAll') };

    /* 背景点击不关闭：避免误触退出（只认右上角 × 和 Esc） */
    sheet.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-lec]'); if (!b) return;
      var a = b.getAttribute('data-lec');
      if (a === 'close') { REOPEN_ON_CLOSE = true; return close(); }
      if (a === 'notes') { close(); location.hash = '#/notes'; return; }
      if (a === 'loc') return locate();
      if (a === 'scope') return openScope();
      if (a === 'scopeok') return pickScope(b.getAttribute('data-v'), b.getAttribute('data-subj'), b.getAttribute('data-src'));
      if (a === 'pin') return pinNow();
      if (a === 'unpin') return unpinNow();
      if (a === 'gobind') return goBindNow(parseInt(b.getAttribute('data-i'), 10) || 0);
      if (a === 'delbind') { ev.stopPropagation(); return delBindNow(parseInt(b.getAttribute('data-i'), 10) || 0); }
      if (a === 'alt') return openCands();
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
      /* Esc 的优先级：范围弹层 → 放大图 → 讲义抽屉本身。谁在最上面就只关谁，
         否则会一路冒泡到 app 的「返回上一页」，表现成退出了讲义。 */
      if (ev.key === 'Escape') {
        if (document.getElementById('lecWebMask')) { closeWeb(); ev.preventDefault(); ev.stopImmediatePropagation(); return; }
        if (document.getElementById('lecCandMask')) { closeCands(); ev.preventDefault(); ev.stopImmediatePropagation(); return; }
        if (document.getElementById('lecScopeMask')) { closeScope(); ev.preventDefault(); ev.stopImmediatePropagation(); return; }
        var z = document.getElementById('lecZoom');
        if (z && z.classList.contains('on')) { unzoom(); ev.preventDefault(); ev.stopImmediatePropagation(); return; }
      }
      if (!el.sheet || !el.sheet.classList.contains('on')) return;
      if (ev.key === 'Escape') { close(); ev.stopImmediatePropagation(); }
      else if (ev.key === 'ArrowLeft') { go(CUR.p - 1); ev.preventDefault(); }
      else if (ev.key === 'ArrowRight') { go(CUR.p + 1); ev.preventDefault(); }
    }, true);
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
    if (el.meta) {
      el.meta.textContent = (CUR.label && CUR.labelSrc === CUR.src && CUR.labelP === CUR.p)
        ? CUR.label
        : f.f.replace(/\.pdf$/i, '').slice(0, 28);
    }
    var key = keyFor(CUR.src, CUR.p);
    if (key) setImg('pdfimg/' + key + '.webp');
    else {
      el.img.removeAttribute('src');
      el.img.style.display = 'none';
      showEmpty('这份讲义还没有页图，点右下角「看整本 PDF」。');
    }
    remember();
    paintPin(); paintBinds();
   } catch (e) { try { toast('这页没显示出来：' + (e && e.message ? e.message : e)); } catch (e2) {} }
  }

  function paintPin() {
    var sp = $('#lecPinState'); if (!sp) return;
    sp.innerHTML = '';
    if (!qKey()) { sp.className = 'lec-pinstate'; sp.textContent = '（没在答题页）'; return; }
    var list = getBinds(), b = list[0];
    if (b && fileOf(b.src)) {
      var lab = String(b.f || '').replace(/\.pdf$/i, '');
      sp.className = 'lec-pinstate on';
      sp.appendChild(document.createTextNode('📌 已绑定 ' + list.length + ' 页 · ' + lab.slice(0, 12) + ' 第 ' + b.p + ' 页 '));
      var u = document.createElement('button');
      u.className = 'lec-unpin'; u.setAttribute('data-lec', 'unpin'); u.textContent = '全解绑';
      sp.appendChild(u);
    } else {
      sp.className = 'lec-pinstate';
      sp.textContent = '还没绑定';
    }
  }

  function pinNow() {
    var r = putBind(CUR.src, CUR.p);
    if (!r) return;
    CAND = []; var alt = $('#lecAlt'); if (alt) alt.style.display = 'none';
    toast(r.dup ? ('这页已经绑过了（共 ' + r.total + ' 页）') : ('已绑定第 ' + r.item.p + ' 页（这题共 ' + r.total + ' 页）'));
    paintPin(); paintBinds();
  }
  function goBindNow(i) {
    var b = getBinds()[i]; if (!b) return;
    jumpToSrc(b.src, b.p, '📌 绑定 ' + (i + 1) + '：第 ' + b.p + ' 页');
  }
  function delBindNow(i) {
    if (!delBindAt(i)) return;
    toast('已移除这一页绑定');
    paintPin(); paintBinds();
  }
  function unpinNow() {
    if (!delBind()) { toast('这题还没绑定'); return; }
    toast('已全部解绑，以后这题改按文字自动定位');
    paintPin(); paintBinds();
  }

  function applyBind() {
    var b = getBind();
    if (b && fileOf(b.src)) { CUR.src = b.src; CUR.p = b.p; paint(); return true; }
    return false;
  }

  /* 绑定页的小卡片行：点一下跳过去，× 移除 */
  function paintBinds() {
    var host = $('#lecBinds');
    if (!host) {
      host = ce('div', 'lec-binds'); host.id = 'lecBinds';
      var bar = $('.lec-bar');
      if (bar && bar.parentNode) bar.parentNode.insertBefore(host, bar.nextSibling); else return;
    }
    var list = getBinds();
    host.innerHTML = '';
    host.hidden = !list.length;
    list.forEach(function (b, i) {
      var chip = ce('button', 'lec-bchip');
      chip.setAttribute('data-lec', 'gobind'); chip.setAttribute('data-i', String(i));
      chip.title = b.src + ' 第 ' + b.p + ' 页';
      var num = ce('em'); num.textContent = String(i + 1);
      var txt = ce('span'); txt.textContent = String(b.f || b.src || '').replace(/\.pdf$/i, '').slice(0, 9) + ' · ' + b.p + '页';
      var x = ce('i'); x.className = 'lec-bx'; x.setAttribute('data-lec', 'delbind'); x.setAttribute('data-i', String(i)); x.textContent = '×';
      chip.appendChild(num); chip.appendChild(txt); chip.appendChild(x);
      host.appendChild(chip);
    });
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
    return idb('get', 'part:' + LEC_VER + ':' + pid).then(function (c) {
      var cached = (c && Array.isArray(c.rows)) ? c.rows.filter(Boolean) : null;
      if (cached && cached.length) { TXT_CACHE[pid] = cached; return cached; }
      return fetchAsset('pdftext/' + pid + '.json', { json: true, tries: 2, timeout: 45000 }).then(function (arr) {
        var rows = rowsOf(arr);
        if (!rows.length) throw new Error('这一块是空的');
        TXT_CACHE[pid] = rows;
        idb('set', 'part:' + LEC_VER + ':' + pid, { ts: Date.now(), rows: rows });
        return rows;
      }).catch(function (e) {
        /* 缓存或网络坏了：把这一块的缓存删掉，下次重来 */
        idb('set', 'part:' + LEC_VER + ':' + pid, null);
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
  var QP = { stem: '', opts: [] };   /* 最近一次读取的题干与选项 */
  function questionText() {
    var parts = [];
    QP = { stem: '', opts: [] };
    if (window.__QTEST && window.__QTEST.stem) {
      QP.stem = window.__QTEST.stem;
      QP.opts = (window.__QTEST.opts || []).slice();
      return QP.stem + ' ' + QP.opts.join(' ');
    }
    var stem = document.querySelector('#qBody .stem, #qBody .gstem, .stem');
    if (stem) { QP.stem = (stem.textContent || '').trim(); parts.push(QP.stem); }
    Array.prototype.forEach.call(document.querySelectorAll('#qBody .opt, .opts .opt'), function (el) {
      var t = (el.textContent || '').replace(/^[A-H][\s.．、:：)）\]]?/, '').trim();
      if (t) { QP.opts.push(t); parts.push(t); }
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
  function withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
      Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                              function () { if (!done) { done = true; clearTimeout(t); resolve(null); } });
    });
  }
  /* ---------- 语义挑页（向量）：本地 bge 这类嵌入服务，纯本地、免费、快 ---------- */
  function cosSim(a, b) {
    var d = 0, na = 0, nb = 0, n = Math.min(a.length, b.length);
    for (var i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return 0;
    return d / Math.sqrt(na * nb);
  }
  function pickByEmbedding(q, hits) {
    if (typeof window.aiEmbed !== 'function') return Promise.resolve(null);
    var rows = HIT_ROWS || [];
    hits = hits.slice(0, 6);          /* 本地 bge 偏慢：6 条够用，再多只会等更久 */
    var texts = hits.map(function (h) {
      var r = rows[h.i] || {};
      return String(r.f || '') + ' ' + String(r.t || '').replace(/\s+/g, ' ').slice(0, 160);
    });
    var model = 'bge-small-zh-v1.5';
    try {
      var c = (typeof window.aiCfg === 'function') ? window.aiCfg() : null;
      if (c && c.embModel) model = c.embModel;
    } catch (e) {}
    return window.aiEmbed([String(q).slice(0, 500)].concat(texts), { model: model }).then(function (vs) {
      if (!vs || vs.length !== texts.length + 1) return null;
      var best = -1, bi = -1;
      for (var i = 1; i < vs.length; i++) {
        var sc = cosSim(vs[0], vs[i]);
        if (sc > best) { best = sc; bi = i - 1; }
      }
      if (bi < 0 || best < 0.2) return null;
      return { i: bi, why: '语义相似度 ' + best.toFixed(2) };
    }).catch(function () { return null; });
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
    return window.aiChat(msgs, null, null, { stream: false, temp: 0, maxTokens: 420 }   /* deepseek-flash 是推理模型：思考也占 token，80 太少会拿到空内容 */).then(function (txt) {
      var m = String(txt || '').match(/\{[\s\S]*?\}/);
      if (!m) return null;
      var o = null;
      try { o = JSON.parse(m[0]); } catch (e) { return null; }
      var i = (+o.i || 0) - 1;
      if (i < 0 || i >= hits.length) return null;
      return { i: i, why: String(o.why || '').slice(0, 24) };
    });
  }

  /* ---------- 复用「AI 解析」的资料检索（kb.js）----------
     用户在 m25065 明确要求：讲义定位就用 AI 解析里找参考资料那套，别再自己拿关键词拼。
     同一套管道 = 知识库（讲义按页切好的 docs）→ BM25 + 向量 + kbRerank 重排，
     命中的每一条都带 file / pdfp（PDF 内页码），直接拿来跳页。 */
  function normName(x) {
    return String(x || '').replace(/\\/g, '/').split('/').pop()
      .replace(/\.pdf$/i, '').replace(/[\s\u3000]+/g, '')
      .replace(/\uff08/g, '(').replace(/\uff09/g, ')')
      .replace(/\u3010/g, '[').replace(/\u3011/g, ']')
      .toLowerCase();
  }
  function fileByHit(h) {
    var want = normName(h.file || h.doc || '');
    if (!want) return null;
    var i, f, a;
    for (i = 0; i < FILES.length; i++) { f = FILES[i]; if (normName(f.src) === want || normName(f.f) === want) return f; }
    for (i = 0; i < FILES.length; i++) { f = FILES[i]; a = normName(f.src); if (a.indexOf(want) >= 0 || want.indexOf(a) >= 0) return f; }
    return null;
  }
  /* ---------- 定位范围：自动 / 指定讲义 / 指定科目 ---------- */
  var SCOPE_KEY = 'qbank.lec.scope.v1';
  var SCOPE = readLS(SCOPE_KEY, null) || { mode: 'auto' };
  function scopeSave() { try { writeLS(SCOPE_KEY, SCOPE); } catch (e) {} }
  function scopeLabel() {
    if (SCOPE.mode === 'file') {
      var f = fileOf(SCOPE.src);
      return f ? ('📄 ' + f.f.replace(/\.pdf$/i, '').slice(0, 10)) : '📄 指定讲义';
    }
    if (SCOPE.mode === 'subj') return '📚 ' + (SCOPE.subj || '科目');
    return '🎯 自动';
  }
  function scopePaint() {
    var b = $('#lecScopeBtn');
    if (!b) return;
    b.textContent = scopeLabel();
    b.title = '定位范围：' + (SCOPE.mode === 'auto' ? '全库（AI 资料检索）' : (SCOPE.mode === 'file' ? SCOPE.src : SCOPE.subj)) + '（点这里改）';
    b.classList.toggle('on', SCOPE.mode !== 'auto');
  }
  function rankPages(pages, q) {
    if (!pages || !pages.length) return Promise.resolve([]);
    if (typeof window.aiEmbed !== 'function') return Promise.resolve(kwRank(pages, q));
    var texts = pages.map(function (r) { return String(r.t || '').replace(/\s+/g, ' ').slice(0, 400); });
    var model = 'bge-small-zh-v1.5';
    try { var c = (typeof window.aiCfg === 'function') ? window.aiCfg() : null; if (c && c.embModel) model = c.embModel; } catch (e) {}
    return withTimeout(window.aiEmbed([String(q).slice(0, 500)].concat(texts), { model: model }), 20000).then(function (vs) {
      if (!vs || vs.length !== texts.length + 1) return kwRank(pages, q);
      var out = [];
      for (var i = 1; i < vs.length; i++) out.push({ src: pages[i - 1].src, p: pages[i - 1].p, score: cosSim(vs[0], vs[i]) });
      out.sort(function (a, b) { return b.score - a.score; });
      return out;
    }).catch(function () { return kwRank(pages, q); });
  }
  /* 在一个科目/一组文件里逐页比语义：页数太多先做关键词粗筛 */
  function rankScope(q, rows) {
    var pages = (rows || []).filter(function (r) { return r && r.t; });
    if (pages.length > 240) {
      var hs = searchIn(pages, q) || [];
      if (hs.length) pages = hs.slice(0, 240).map(function (h) { return pages[h.i]; });
      else pages = pages.slice(0, 240);
    }
    return rankPages(pages, q);
  }
  /* ---------- 鉴别/多选型：候选页按「概念覆盖 + 对照表」重排 ---------- */
  var DIFF_KEY = 'qbank.lec.diff.v1';
  var DIFF = readLS(DIFF_KEY, true);
  function diffOn() { return DIFF !== false; }
  function diffSet(v) { DIFF = !!v; try { writeLS(DIFF_KEY, DIFF); } catch (e) {} }
  var DIFF_ASK = /有$|包括|属于|常增高|常降低|最常见于|鉴别|哪些|以下|下列|正确的有/;
  var TBL_IND = ['血清铁', '转铁蛋白饱和度', '总铁结合力', '血清铁蛋白', '骨髓细胞内铁', '骨髓细胞外铁',
    'MCV', 'MCH', '网织红细胞', '抗核抗体', '补体C3', '铁蛋白'];
  var QPAGE = /真题解析·|真题解析：|习惯一读|读完所有选项|选择最佳答案/;
  function commonAffix(arr) {
    var pre = '', suf = '', i, c;
    var minLen = arr[0].length;
    for (i = 1; i < arr.length; i++) if (arr[i].length < minLen) minLen = arr[i].length;
    for (i = 0; i < minLen; i++) {
      c = arr[0].charAt(i);
      var all = true;
      for (var j = 1; j < arr.length; j++) if (arr[j].charAt(i) !== c) { all = false; break; }
      if (!all) break;
      pre += c;
    }
    for (i = 1; i <= minLen - pre.length; i++) {
      c = arr[0].charAt(arr[0].length - i);
      var all2 = true;
      for (var k = 1; k < arr.length; k++) if (arr[k].charAt(arr[k].length - i) !== c) { all2 = false; break; }
      if (!all2) break;
      suf = c + suf;
    }
    return [pre, suf];
  }
  function stripAffix(o, pre, suf) {
    var a = pre ? o.indexOf(pre) === 0 ? pre.length : 0 : 0;
    var b = suf ? o.lastIndexOf(suf) === o.length - suf.length ? o.length - suf.length : o.length : o.length;
    if (b <= a) return o;
    return o.slice(a, b);
  }
  var OPT_SUF = ['性贫血', '细胞贫血', '贫血', '综合征', '症', '病'];
  function optVariants(opt, pre, suf) {
    var o = String(opt || '').replace(/[（(].*?[）)]/g, '').trim();
    if (o.length < 2) return [];
    var out = [o];
    for (var i = 0; i < OPT_SUF.length; i++) {
      var sf = OPT_SUF[i];
      if (o.length - sf.length >= 2 && o.slice(-sf.length) === sf) out.push(o.slice(0, -sf.length));
    }
    if (pre && o.indexOf(pre) === 0 && o.length - pre.length >= 2) out.push(o.slice(pre.length));
    var core = stripAffix(o, pre, suf);
    if (core !== o) {
      out.push(core);
      if (/性$/.test(core) && core.length > 3) out.push(core.slice(0, -1));
    }
    if (o.indexOf('地中海贫血') >= 0 || o.indexOf('珠蛋白生成障碍') >= 0) out.push('地中海贫血', '珠蛋白生成障碍性贫血', '地贫');
    var seen = {}, res = [];
    out.forEach(function (x) {
      if (!x || x.length < 2 || x === pre || x === suf) return;
      if (!seen[x]) { seen[x] = 1; res.push(x); }
    });
    return res;
  }
  /* 判断是不是「多个并列概念」的鉴别/多选型题目；是则返回重排方案 */
  /* ---------- 真题页识别 + 病例题扩写 ---------- */
  var Q_PENALTY = 0.15;   /* 定位到「印着原题的页」时，相关度直接砍到一成半 */

  /* 讲义里每节末尾都有「真题解析」，把原题+选项+答案一字不差印出来。
     这种页对「查知识点」几乎没用，命中它要重罚。 */
  function isQPage(t) {
    var x = lecClean(t);
    if (!x) return false;
    var sec = /真题解析[·：]/.test(x);
    var nopt = (x.match(/[A-F][．.]/g) || []).length;
    var ans = /(答案|参考答案)/.test(x);
    var stem = /(下列|以下|关于|正确的是|错误的是|首选|最可能|不应|除了)/.test(x);
    if (sec && (nopt >= 2 || ans)) return true;
    if (nopt >= 3 && ans && stem) return true;
    return false;
  }

  function caseLike(stem) {
    var s0 = String(stem || '');
    if (s0.length < 24) return false;
    var hit = /患者|(?:男|女)[，,]\s*\d+\s*岁|\d+\s*岁|主诉|查体|既往\S{0,4}史|入院|就诊|化验|实验室检查|血压\s*\d|心率\s*\d/.test(s0);
    return hit && !/^(?:下列|以下|关于)/.test(s0);
  }

  /* AI 不可用时的兜底：抠疾病名 + 最后一句问什么 */
  function ruleExpand(stem) {
    var t = String(stem || '');
    var segs = t.split(/[，,。；;！？\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
    var NARR = /(\d+\s*岁|患者|主诉|查体|既往|入院|就诊|化验|血压|心率|发热|咳嗽|咳痰|疼痛|乏力|体检|实验室)/;
    var keep = segs.filter(function (x) { return !NARR.test(x) && x.length >= 4; });
    var tail = keep.length ? keep.slice(-2).join('、') : segs.slice(-1)[0];
    var names = (t.match(/[\u4e00-\u9fa5]{2,8}(?:病|癌|炎|综合征|贫血|梗死|衰竭|感染|肿瘤|障碍|中毒|结石|溃疡|疝)/g) || []);
    var uniq = [];
    names.forEach(function (n) {
      if (/的|是|考虑|诊断|可能|最|查体|表现|患者|病史|发热/.test(n)) return;
      if (uniq.indexOf(n) < 0 && uniq.length < 6) uniq.push(n);
    });
    return (String(tail || '').slice(0, 60) + ' ' + uniq.join('、')).replace(/\s+/g, ' ').trim().slice(0, 140);
  }

  /* 病例题：先把「病例故事」扩写成知识点（疾病/机制/鉴别/检查/治疗），再拿去检索。
     搜讲义是搜知识点，不是搜病历原文——病历里的「男，58 岁，发热三天」对讲义毫无意义。 */
  function expandQuery(stem) {
    var s0 = String(stem || '');
    if (!caseLike(s0)) return Promise.resolve('');
    if (typeof window.aiChat !== 'function') return Promise.resolve(ruleExpand(s0));
    var msgs = [
      { role: 'system', content: '你是医学考研讲义检索助手。用户给出一道病例题，请把它改写成用于在讲义里查找「知识点」的关键词：涉及的疾病名、病理机制、典型表现、鉴别诊断要点、关键检查、治疗原则。只输出一行，用中文顿号分隔，不要解释、不要编号、不要重复题目原文，不超过 70 字。' },
      { role: 'user', content: s0.slice(0, 900) }
    ];
    return withTimeout(window.aiChat(msgs, null, null, { stream: false, temp: 0, maxTokens: 300 }), 9000)
      .then(function (txt) {
        var t = String(txt || '').replace(/[\r\n]+/g, ' ').replace(/^[：:、\s]+/, '').trim();
        return (t.length >= 6 ? t.slice(0, 160) : ruleExpand(s0));
      })
      .catch(function () { return ruleExpand(s0); });
  }

  /* ---------- 「解题所需知识」：先想清这题要用什么知识，再按这个算相关性 ---------- */
  var KNOW_KEY = 'qbank.lec.know.v2';        /* 规范缓存：题面 -> {ts, spec} */
  var KNOW_ON_KEY = 'qbank.lec.knowon.v1';
  function knowOn() { var v = readLS(KNOW_ON_KEY, true); return v !== false; }
  function knowSet(v) { writeLS(KNOW_ON_KEY, !!v); }
  var KNOW_CACHE = readLS(KNOW_KEY, {}) || {};
  function knowKey(stem, opts) { return (String(stem || '').slice(0, 120) + '|' + (opts || []).join('/')).slice(0, 300); }

  /* ---------- 题目「问的落点」：分期/分级/分型/诊断标准/首选检查/治疗… ---------- */
  var ATTRS = [
    { id: 'stage', words: ['分期', '几期', '哪一期', '第几期', '属于哪期'], kw: ['分期', '分级'],
      test: function (t) {
        if (!/分期|分级/.test(t)) return false;
        var rom = (t.match(/[ⅠⅡⅢⅣ]/g) || []).length;
        /* OCR 常把罗马数字识别成 I / l / L，后面跟冒号 */
        var lat = (t.match(/(?:^|[\s、，,；;（）()])(I{1,4}|l{1,4}|L{1,4})\s*[:：]/g) || []).length;
        var romAny = (t.match(/\b(I{1,3}V?|V?I{1,3})\b/g) || []).length;
        return (rom + lat) >= 1 || romAny >= 2;
      } },
    { id: 'type', words: ['分型', '类型是', '属于哪型'], kw: ['分型', '类型'],
      test: function (t) { return /分型/.test(t) || (/型/.test(t) && (t.match(/[ⅠⅡⅢⅣ]/g) || []).length >= 2); } },
    { id: 'dx', words: ['诊断标准', '诊断依据', '标准是', '符合标准'], kw: ['诊断标准', '分类标准'],
      test: function (t) { return /诊断标准|分类标准|诊断依据/.test(t); } },
    { id: 'exam', words: ['首选检查', '首选辅助检查', '最有价值', '最有助于', '确诊'], kw: ['首选', '检查'],
      test: function (t) { return /(首选|最有价值|最有助于)[^。；]{0,8}(检查|试验|化验|影像)/.test(t) || /检查首选/.test(t); } },
    { id: 'tx', words: ['首选治疗', '治疗首选', '治疗方案', '最佳治疗'], kw: ['首选', '治疗'],
      test: function (t) { return /(首选|最佳)[^。；]{0,8}(治疗|药物|手术)|治疗首选/.test(t); } },
    { id: 'diff', words: ['鉴别', '鉴别诊断', '区别'], kw: ['鉴别'],
      test: function (t) { return /鉴别诊断|鉴别/.test(t); } },
    { id: 'patho', words: ['机制', '发病机制', '病理'], kw: ['机制'],
      test: function (t) { return /发病机制|病理机制|机制/.test(t); } }
  ];
  function askedAttr(stem) {
    var s0 = String(stem || '');
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      for (var j = 0; j < a.words.length; j++) if (s0.indexOf(a.words[j]) >= 0) return a;
    }
    return null;
  }
  /* 题目在问哪个病：分期/分级必须和这个病同页，否则别的病的分期会抢答 */
  var ENT_STOP = /患者|下列|以下|关于|最可能|诊断|治疗|检查|哪一|属于|正确的|错误的|首选/;
  function entityOf(stem, opts) {
    var s0 = String(stem || '') + ' ' + (opts || []).join(' ');
    var re = /[\u4e00-\u9fa5A-Za-z]{2,14}(?:关节炎|动脉炎|血管炎|脑病|肾病|肾炎|肺炎|哮喘|贫血|白血病|淋巴瘤|骨髓瘤|综合征|梗死|衰竭|感染|肿瘤|溃疡|结石|疝|病|炎|癌|瘤)/g;
    var m, cands = [];
    while ((m = re.exec(s0))) {
      var w = m[0];
      if (w.length < 3 || ENT_STOP.test(w)) continue;
      if (cands.indexOf(w) < 0) cands.push(w);
    }
    cands.sort(function (a, b) { return b.length - a.length; });
    return cands.length ? cands[0] : '';
  }
  /* 从候选讲义文件名里取「干净的病名」，比从题干里正则截更可靠（文件名是人工整理的） */
  function entFromNames(srcs, stem, opts) {
    var q = String(stem || '') + ' ' + (opts || []).join(' ');
    var hits = [];
    (srcs || []).forEach(function (src) {
      var nm = String(src || '').split('/').pop().replace(/\.pdf$/i, '')
        .replace(/精编版|已勘误|重排版|不带导图|勘误|【[^】]*】|\([^)]*\)|（[^）]*）/g, ' ');
      var re = /[\u4e00-\u9fa5]{3,12}(?:关节炎|动脉炎|血管炎|脑病|肾病|肾炎|肺炎|哮喘|贫血|白血病|淋巴瘤|骨髓瘤|综合征|梗死|衰竭|感染|肿瘤|溃疡|结石|疝|病|炎|癌|瘤)/g;
      var m;
      while ((m = re.exec(nm))) {
        var w = m[0];
        for (var cut = 0; cut <= 4 && w.length - cut >= 3; cut++) {
          var ww = w.slice(cut);
          if (q.indexOf(ww) >= 0) { hits.push(ww); break; }
        }
      }
    });
    hits.sort(function (a, b) { return b.length - a.length; });
    return hits.length ? hits[0] : '';
  }
  function entHit(t, ent) {
    if (!ent) return true;
    if (t.indexOf(ent) >= 0) return true;
    if (ent.length >= 6 && t.indexOf(ent.slice(0, 4)) >= 0) return true;
    if (ent.length >= 5 && t.indexOf(ent.slice(-4)) >= 0) return true;
    return false;
  }
  function fileHasEnt(src, ask) {
    if (!ask || !ask.ent) return false;
    return normName(src).indexOf(ask.ent) >= 0;
  }
  function attrTest(t, ask) {
    if (!ask || !t) return false;
    if (!entHit(t, ask.ent)) return false;
    try { return !!ask.test(t); } catch (e) { return false; }
  }
  function attrScore(t, ask) {
    if (!ask || !t) return 0;
    if (attrTest(t, ask)) return 1;
    if (ask.ent && !entHit(t, ask.ent)) return 0;   /* 不是这个病，别给分 */
    for (var i = 0; i < ask.kw.length; i++) if (t.indexOf(ask.kw[i]) >= 0) return 0.45;
    return 0;
  }

  function ruleKnow(stem, opts) {
    var need = [], diff = [], clean = [];
    (opts || []).forEach(function (o) {
      var t = String(o || '').replace(/^[A-H][\s.．、:：)）\]]?/, '').replace(/\s+/g, '');
      if (t && t.length <= 16) clean.push(t);
    });
    var core = String(stem || '').replace(/(最可能的诊断是|下列|以下|关于|正确的是|错误的是|首选|不应|除了|哪些|包括)/g, ' ').trim();
    var raw = [];
    if (core) raw.push(core.slice(0, 24));
    clean.forEach(function (c) { if (raw.indexOf(c) < 0) raw.push(c); if (diff.indexOf(c) < 0) diff.push(c); });
    var wneed = raw.slice(0, 8).map(function (t, i) { return { k: t, w: i === 0 ? 5 : 3 }; });
    return { goal: core.slice(0, 20), need: wneed, diff: diff.slice(0, 6), src: 'rule' };
  }

  function parseKnow(txt) {
    var m = String(txt || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      var o = JSON.parse(m[0]);
      function arr(v) {
        return (v || []).map(function (x) { return String(x || '').replace(/\s+/g, '').slice(0, 18); })
          .filter(function (x) { return x.length >= 2; }).slice(0, 8);
      }
      var need = [], diff = arr(o.diff);
      (o.need || []).forEach(function (x) {
        var k2 = '', w2 = 3;
        if (x && typeof x === 'object') { k2 = String(x.k || x.v || '').replace(/\s+/g, ''); w2 = +x.w || 3; }
        else k2 = String(x || '').replace(/\s+/g, '');
        k2 = k2.slice(0, 18);
        if (k2.length < 2) return;
        if (w2 < 1) w2 = 1; if (w2 > 5) w2 = 5;
        need.push({ k: k2, w: w2 });
      });
      need = need.slice(0, 8);
      if (!need.length && !diff.length) return null;
      return {
        goal: String(o.goal || o.subject || '').slice(0, 40),
        subject: String(o.subject || '').slice(0, 30),
        ask: String(o.ask || '').slice(0, 10),
        need: need, diff: diff, src: 'ai'
      };
    } catch (e) { return null; }
  }

  function knowSpec(stem, opts, ask) {
    if (!knowOn()) return Promise.resolve(null);
    var k = knowKey(stem, opts), c = KNOW_CACHE[k];
    if (c && c.spec && (Date.now() - (c.ts || 0)) < 7 * 864e5) return Promise.resolve(c.spec);
    var fb = ruleKnow(stem, opts);
    if (typeof window.aiChat !== 'function') return Promise.resolve(fb);
    var msgs = [
      { role: 'system', content: '你是医学考研命题老师。按三步做题：①先判断这题考的是哪个病、哪个考点（subject）；②再拆出解题必需的知识点，并按「对本题的重要性」打权重 1-5（5=不知道就做不出来，3=需要，1=锦上添花）；③最后写选项之间的判别依据。只输出 JSON，不要解释：{"subject":"考什么：病名+考点，≤16字","ask":"题目问的落点（如 分期/分级/首选检查/诊断标准），≤8字","goal":"这道题要判断什么，≤24字","need":[{"k":"知识点，用讲义里的术语，≤14字，不要照抄选项","w":5}],"diff":["选项之间的判别依据，2-4个，每个≤14字"]}' },
      { role: 'user', content: '题干：' + String(stem || '').slice(0, 800) + '\n选项：' + (opts || []).join(' / ') + (ask ? ('\n注意：这道题问的是「' + (ask.ent ? ask.ent + '的' : '') + ask.words[0] + '」，need 里必须包含回答它的判断标准/依据（例如分期标准、各期表现）。') : '') }
    ];
    return withTimeout(window.aiChat(msgs, null, null, { stream: false, temp: 0, maxTokens: 420 }), 12000)
      .then(function (txt) {
        var spec = parseKnow(txt) || fb;
        KNOW_CACHE[k] = { ts: Date.now(), spec: spec };
        try { writeLS(KNOW_KEY, KNOW_CACHE); } catch (e) {}
        return spec;
      })
      .catch(function () { return fb; });
  }

  function knowTerms(spec) {
    if (!spec) return [];
    var out = [], seen = {};
    (spec.need || []).concat(spec.diff || []).forEach(function (x) {
      var t = String((x && typeof x === 'object' ? (x.k || x.v) : x) || '').replace(/\s+/g, '');
      if (t.length < 2 || t.length > 20) return;
      if (seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }

  /* 加权知识点：w=5 的是「不知道就做不出来」的那条 */
  function knowWeighted(spec) {
    var out = [], seen = {};
    ((spec && spec.need) || []).forEach(function (x) {
      var k2, w2;
      if (x && typeof x === 'object') { k2 = x.k || x.v; w2 = +x.w || 3; }
      else { k2 = x; w2 = 3; }
      k2 = String(k2 || '').replace(/\s+/g, '');
      if (k2.length < 2 || k2.length > 20 || seen[k2]) return;
      seen[k2] = 1;
      if (w2 < 1) w2 = 1; if (w2 > 5) w2 = 5;
      out.push({ k: k2, w: w2 });
    });
    out.sort(function (a, b) { return b.w - a.w; });
    return out;
  }

  /* 按「这页讲到了多少解题必需的知识点」重排：相似度 0.6 + 知识覆盖 0.4 */
  function knowRerank(list, spec, ask) {
    if (!list || !list.length) return list;
    var W = knowWeighted(spec);
    var terms = W.map(function (x) { return x.k; });
    var totW = 0;
    W.forEach(function (x) { totW += x.w; });
    var topK = W.length ? W[0].k : '';
    var rows = [], bestCov = 0, anyAttr = 0;
    list.forEach(function (x) {
      var t = lecClean(x.t), covW = 0, hitN = 0;
      W.forEach(function (e) { if (t && t.indexOf(e.k) >= 0) { covW += e.w; hitN++; } });
      var cov = totW ? (covW / totW) : 0;
      var at = fileHasEnt(x.src, ask) ? (ask && ask.test ? attrScore(t, ask) : 0) : attrScore(t, ask);
      var topHit = (topK && t && t.indexOf(topK) >= 0) ? 1 : 0;
      if (cov > bestCov) bestCov = cov;
      if (at >= 1) anyAttr++;
      rows.push({ x: x, cov: cov, hitN: hitN, at: at, top: topHit });
    });
    if (bestCov < 0.28 && !anyAttr) return list;
    rows.forEach(function (r) {
      var sim = r.x.score || 0;
      var s2;
      if (ask) {
        s2 = (r.at >= 1)
          ? (0.48 + r.cov * 0.32 + r.top * 0.10 + sim * 0.10)
          : (r.cov * 0.22 + sim * 0.18);
      } else {
        s2 = r.cov * 0.60 + sim * 0.40;
      }
      r.x.know = r.hitN; r.x.knowN = terms.length; r.x.attr = r.at;
      r.x.kw = Math.round(r.cov * 100); r.x.topk = r.top;
      r.x.score = s2;
    });
    rows.sort(function (a, b) { return (b.x.score || 0) - (a.x.score || 0); });
    return rows.map(function (r) { return r.x; });
  }

  function diffPlan(stem, opts) {
    if (!diffOn() || !opts || opts.length < 3) return null;
    var clean = [];
    opts.forEach(function (o) {
      var t = String(o || '').replace(/\s+/g, '');
      if (t && t.length <= 16 && !/[0-9．.，,；;：:]/.test(t)) clean.push(t);
    });
    if (clean.length < 3) return null;
    if (!DIFF_ASK.test(String(stem || ''))) return null;
    var ax = commonAffix(clean);
    var vs = [];
    clean.forEach(function (o) {
      var v = optVariants(o, ax[0], ax[1]);
      if (v.length) vs.push(v);
    });
    if (vs.length < 3) return null;
    return { opts: clean, vs: vs };
  }
  /* 去掉讲义页眉（每页都有的导航行），否则「真题解析」四个字会误伤所有页 */
  function lecClean(t) {
    var x = String(t || '');
    x = x.replace(/每日计划[\s\S]{0,120}?考点补充/, '');
    return x.replace(/\s+/g, '');
  }

  function tableBoost(t) {
    var n = 0;
    for (var i = 0; i < TBL_IND.length; i++) if (t.indexOf(TBL_IND[i]) >= 0) n++;
    if (t.indexOf('鉴别诊断') >= 0 && n >= 3) return 0.38;
    if (n >= 5) return 0.34;
    if (n >= 3) return 0.20;
    return 0;
  }
  function diffRerank(list, plan) {
    if (!plan || !list || !list.length) return list;
    var rows = [];
    list.forEach(function (x) {
      var t = lecClean(x.t);
      var cover = 0;
      if (t) {
        plan.vs.forEach(function (g) {
          for (var i = 0; i < g.length; i++) if (t.indexOf(g[i]) >= 0) { cover++; return; }
        });
      }
      var s = (x.score || 0) * 0.65 + (cover / plan.vs.length) * 0.35 + tableBoost(t) - (t && QPAGE.test(t) ? 0.5 : 0);
      rows.push({ x: x, s: t ? s : s - 0.2, cover: cover });
    });
    var best = 0;
    rows.forEach(function (r) { if (r.cover > best) best = r.cover; });
    /* 保守：没有任何一页同时讲到 >=3 个选项时，说明这不是「几个病/几个概念的对照」，
       保持原相似度排序，避免把判别性线索（题干里的特征词）挤掉 */
    if (best < 3) return list;
    rows.sort(function (a, b) { return b.s - a.s; });
    return rows.map(function (r) { r.x.diff = r.cover; return r.x; });
  }

  var LOC_CACHE = {};    /* 同一题 10 分钟内重复定位直接用上次结果：key -> {ts,list,tag} */
  function LOCKEY() { var q = ''; try { q = questionText(); } catch (e) {} return (qKey() || '') + '|' + String(q).slice(0, 90); }
  function applyCands(list, tag) {
    list = (list || []).slice(0, 18);
    if (!list.length) return false;
    try { LOC_CACHE[LOCKEY()] = { ts: Date.now(), list: list, tag: tag }; } catch (e) {}
    CAND2 = list; CAND_I = 0;
    var top = list[0];
    var f = fileOf(top.src);
    var hint = (top.score > 0 && top.score <= 1) ? ' · 相似度 ' + top.score.toFixed(2) : '';
    if (top.know) hint += ' · 知识点 ' + top.know + '/' + (top.knowN || '') + (top.kw ? ('（重点覆盖 ' + top.kw + '%）') : '');
    if (top.attr >= 1) hint += ' · 命中「问的落点」';
    jumpToSrc(top.src, top.p, tag + '：' + (f ? f.f.replace(/\.pdf$/i, '').slice(0, 18) : '') + ' 第 ' + localPage(f, top.p) + ' 页' + hint);
    return true;
  }
  var CAND2 = [];   /* 语义排序后的候选页 [{src,p,score}] */
  function altBtn(n) {
    var b = $('#lecAlt');
    if (!b) {
      b = ce('button', 'lec-alt'); b.id = 'lecAlt'; b.setAttribute('data-lec', 'alt');
      b.title = '看全部候选页（按相关度排序），点一条直接跳过去'; b.textContent = '候选';
      var bar = $('.lec-bar'); if (bar) bar.appendChild(b);
    }
    if (n > 1) { b.style.display = ''; b.textContent = '候选 ' + (CAND_I + 1) + '/' + n + ' ▾'; }
    else b.style.display = 'none';
  }
  /* 单章 PDF 是从大书里切出来的：文字层里的页码是「原书页码」（如 189），
     PDF 自己的页只有 3 页 → 显示/跳转前要减回去。文件名末尾就有 "_189-191" */
  function pageRange(f) {
    var m = String((f && f.f) || '').match(/_(\d+)\s*[-–—]\s*(\d+)\.pdf$/i);
    return m ? { a: +m[1], b: +m[2] } : null;
  }
  function localPage(f, p) {
    var r = pageRange(f), n = (f && f.n) || 0;
    var v = p;
    if (r && p >= r.a && (!r.b || p <= r.b)) v = p - r.a + 1;
    if (v < 1) v = 1;
    if (n && v > n) v = n;
    return v;
  }

  function jumpToSrc(src, p, label) {
    var f = fileOf(src);
    if (!f) return false;
    CUR.src = src;
    CUR.p = Math.max(1, Math.min(f.n || 9999, localPage(f, (p | 0) || 1)));
    CUR.label = label || ''; CUR.labelSrc = src; CUR.labelP = CUR.p;
    CAND = [];
    paint();
    try { remember(); } catch (e) {}
    if (el.meta) el.meta.textContent = label;
    altBtn(CAND2.length);
    return true;
  }

  /* ---------- 第二步：在这份 PDF 里逐页算语义相似度，排序 ---------- */
  function kwRank(pages, q) {
    var hits = searchIn(pages, q) || [];
    return hits.map(function (h) { var r = pages[h.i] || {}; return { p: r.p, score: h.score || 0 }; });
  }
  function embedRank(src, q) {
    return loadTextSubj().then(function (rows) {
      var pages = (rows || []).filter(function (r) { return r && r.src === src && r.t; });
      if (!pages.length) return [];
      return rankPages(pages, q);
    });
  }
  function kbLocate(q) {
    if (typeof kbSearch !== 'function') return Promise.resolve(null);
    /* 知识库的文件是 4MB 级分片，第一次打开要下载+解压；这期间 kbSelected() 可能是空的，
       所以先等它挂上（最多 6 秒），实在没有就从目录 kbList() 兜底。 */
    function idsNow() {
      var ids = [];
      try { ids = (typeof kbSelected === 'function') ? (kbSelected() || []) : []; } catch (e) { ids = []; }
      if (ids && ids.length) return ids;
      try {
        var l = (typeof kbList === 'function') ? (kbList() || []) : [];
        ids = l.map(function (x) { return (x && x.id) || x; }).filter(Boolean);
      } catch (e) {}
      return ids || [];
    }
    function use(hs) {
      var first = null;
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i] || {};
        var f = fileByHit(h);
        if (!f) continue;
        var pg = +(h.pdfp || h.page || 0);
        var nm = String(h.file || f.f).replace(/\.pdf$/i, '');
        if (pg && (!f.n || pg <= f.n)) return Promise.resolve({ src: f.src, p: pg, name: nm });
        if (!first) first = { f: f, name: nm };
      }
      if (!first) return Promise.resolve(null);
      /* 这条没带页码（整份讲义切块常见）：在这份文件里用关键词选页 */
      return loadTextSubj().then(function (rows) {
        var sub = (rows || []).filter(function (r) { return r && r.src === first.f.src; });
        var hs2 = searchIn(sub, q);
        var pg2 = hs2.length ? ((sub[hs2[0].i] || {}).p || 1) : 1;
        return { src: first.f.src, p: pg2, name: first.name };
      }).catch(function () { return { src: first.f.src, p: 1, name: first.name }; });
    }
    function start() {
      var ids = idsNow();
      if (!ids.length) return Promise.resolve(null);
      return kbSearch(String(q).slice(0, 600), ids, 8).then(function (hits) {
        hits = hits || [];
        if (typeof kbRerank === 'function' && hits.length > 1) {
          try {
            var r = kbRerank(String(q).slice(0, 600), hits, 6);
            if (r && typeof r.then === 'function') return Promise.resolve(r).then(use, function () { return use(hits); });
            if (r && r.length) return use(r);
          } catch (e) {}
        }
        return use(hits);
      });
    }
    var pre = (typeof kbEnsureFilesLoaded === 'function')
      ? Promise.resolve(kbEnsureFilesLoaded()).catch(function () {}) : Promise.resolve();
    return pre.then(function () {
      if (idsNow().length) return start();
      return new Promise(function (res) {
        var n = 0;
        (function tick() {
          if (idsNow().length) return res(start());
          if (++n > 75) return res(null);
          setTimeout(tick, 200);
        })();
      });
    }).catch(function () { return null; });
  }

  /* ---------- 范围选择弹层 ---------- */
  function openScope() {
    closeScope();
    var mask = ce('div', 'lec-smask'); mask.id = 'lecScopeMask';
    var sheet = ce('div', 'lec-ssheet');
    var subs = {};
    try { subs = subjects() || {}; } catch (e) { subs = {}; }
    var names = Object.keys(subs).filter(function (k) { return (subs[k] || []).length; });
    var curName = (CUR.src && (fileOf(CUR.src) || {}).f) || '当前这份';
    var h = '<div class="lec-shead"><b>去哪儿找这题的讲义页</b><button class="lec-sx" data-sc="x" title="关闭（Esc）">×</button></div>';
    h += '<div class="lec-sbody">';
    h += '<button class="lec-sopt' + (SCOPE.mode === 'auto' ? ' on' : '') + '" data-sc="pick" data-v="auto">' +
      '<i>🎯</i><div><b>自动（推荐）</b><span>先用 AI 解析的资料库判断是哪一份讲义，再进去逐页比语义</span></div></button>';
    h += '<button class="lec-sopt' + (SCOPE.mode === 'file' ? ' on' : '') + '" data-sc="pick" data-v="file" data-src="' + String(CUR.src || '').replace(/"/g, '&quot;') + '">' +
      '<i>📄</i><div><b>只在这份里找</b><span>' + String(curName).replace(/</g, '&lt;') + '</span></div></button>';
    h += '<div class="lec-slabel">按科目找</div><div class="lec-schips">';
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      var on = (SCOPE.mode === 'subj' && SCOPE.subj === nm) ? ' on' : '';
      h += '<button class="lec-schip' + on + '" data-sc="pick" data-v="subj" data-subj="' + nm + '">' + nm + '<em>' + subs[nm].length + '</em></button>';
    }
    h += '</div>';
    h += '<div class="lec-srow"><label><input type="checkbox" id="lecKnowChk"' + (knowOn() ? ' checked' : '') + ' data-sc="know">优先「解题所需知识」</label><span>先让模型写出这题要用哪些知识点，再按这个算相关性</span></div>';
    h += '<div class="lec-srow"><label><input type="checkbox" id="lecDiffChk"' + (diffOn() ? ' checked' : '') + ' data-sc="diff">鉴别题优先「对照表」</label><span>选项是多个并列概念时，先推讲这几项区别的那一页</span></div>';
    h += '<div class="lec-sfoot">只影响「🔍 定位到这题」，不会换掉你正在看的讲义</div>';
    sheet.innerHTML = h;
    mask.appendChild(sheet);
    mask.addEventListener('click', function (ev) {
      if (ev.target === mask) return closeScope();
      var b = ev.target.closest('[data-sc]'); if (!b) return;
      var a = b.getAttribute('data-sc');
      if (a === 'x') return closeScope();
      if (a === 'pick') return pickScope(b.getAttribute('data-v'), b.getAttribute('data-subj'), b.getAttribute('data-src'));
      if (a === 'diff') { diffSet(b.checked); toast(b.checked ? '已开启：鉴别题优先「对照表」' : '已关闭：鉴别题重排'); return; }
      if (a === 'know') { knowSet(b.checked); toast(b.checked ? '已开启：按解题所需知识排序' : '已关闭：只按字面相似度'); return; }
    });
    document.body.appendChild(mask);
    window.__closeLecScope = function () { try { mask.parentNode.removeChild(mask); } catch (e) {} };
  }
  function closeScope() { if (window.__closeLecScope) window.__closeLecScope(); }
  function pickScope(v, subj, src) {
    if (v === 'auto') SCOPE = { mode: 'auto' };
    else if (v === 'file') {
      if (!src) { toast('先在上面选一份讲义'); return; }
      SCOPE = { mode: 'file', src: src };
    } else if (v === 'subj') { SCOPE = { mode: 'subj', subj: subj }; }
    scopeSave(); scopePaint(); closeScope();
    toast('定位范围：' + scopeLabel());
  }
  /* 只在一份讲义里找 */
  function fileLocate(q) {
    var src = SCOPE.src, f = fileOf(src);
    if (!f) { toast('这份讲义不在目录里了，换成「自动」再试'); SCOPE = { mode: 'auto' }; scopeSave(); return; }
    if (el.meta) el.meta.textContent = '只在这份《' + f.f.replace(/\.pdf$/i, '').slice(0, 16) + '》里逐页比对…';
    withTimeout(embedRank(src, q), 20000).then(function (list) {
      if (!applyCands(list, '📄 这份讲义')) {
        if (el.meta) el.meta.textContent = '这份讲义里没找到相关页';
        toast('这份讲义里没找到相关页');
      }
    }).catch(function () { if (el.meta) el.meta.textContent = '比对失败，换个范围试试'; });
  }
  /* 在某个科目里找 */
  function subjLocate(q) {
    var sb = SCOPE.subj;
    if (el.meta) el.meta.textContent = '在「' + sb + '」的讲义里逐页比对…';
    loadTextSubj(sb).then(function (rows) {
      var inScope = (rows || []).filter(function (r) { return r && subjOf(r.src) === sb; });
      if (!inScope.length) { if (el.meta) el.meta.textContent = '这个科目还没有文字索引：' + sb; toast('这个科目还没有文字索引'); return; }
      return withTimeout(rankScope(q, inScope), 25000).then(function (list) {
        if (!applyCands(list, '📚 ' + sb)) { if (el.meta) el.meta.textContent = '这个科目里没找到相关页'; }
      });
    }).catch(function (e) { toast('定位失败：' + (e && e.message || e)); });
  }

  /* 知识库检索：多份讲义一起找（AI 解析用的就是这套）*/
  function kbRows(q) {
    if (typeof kbSearch !== 'function') return Promise.resolve([]);
    function idsNow() {
      var ids = [];
      try { ids = (typeof kbSelected === 'function') ? (kbSelected() || []) : []; } catch (e) { ids = []; }
      if (ids && ids.length) return Promise.resolve(ids);
      var n = 0;
      return new Promise(function (res) {
        (function tick() {
          var l = [];
          try { l = (typeof kbList === 'function') ? (kbList() || []) : []; } catch (e) { l = []; }
          var x = l.map(function (o) { return (o && o.id) || o; }).filter(Boolean);
          if (x.length) return res(x);
          if (++n > 40) return res([]);
          setTimeout(tick, 250);
        })();
      });
    }
    return withTimeout(idsNow(), 12000).then(function (ids) {
      if (!ids || !ids.length) return [];
      return kbSearch(String(q).slice(0, 600), ids, 12);
    }).then(function (hs) {
      var out = [];
      (hs || []).forEach(function (h) {
        var f = null;
        try { f = fileByHit(h); } catch (e) { f = null; }
        if (!f) return;
        var pg = (h.pdfp | 0) || (h.page | 0) || 0;
        if (pg > (f.n || 9999)) pg = 0;   /* 页码不可信就别当第 1 页用，交给「在这份里找页」 */
        if (pg > 0) pg = localPage(f, pg);   /* 原书页码 → 这份 PDF 自己的页码 */
        var sc = (h.rr != null ? +h.rr : +h.score) || 0;
        out.push({ src: f.src, p: pg, score: sc, name: f.f });
      });
      return out;
    }).catch(function () { return []; });
  }

  /* 多份讲义一起找：
     ① 知识库命中给出「哪几份 PDF」+「可能哪页」（可能只给到文件，没页码）
     ② 每一份都在这份自己的正文里按关键词补候选页
     ③ 每份内部用语义相似度排，取前 3 页
     ④ 全部页按相似度排，再按这份的最高分排「份」 */

  function fileOfName(nm) {
    var want = normName(nm || '');
    if (!want) return null;
    var L = (typeof FILES !== 'undefined' && FILES) ? FILES : [];
    for (var i = 0; i < L.length; i++) { if (normName(L[i].src) === want) return L[i]; }
    for (var j = 0; j < L.length; j++) {
      var a = normName(L[j].src), b = normName(L[j].f);
      if (want.length > 5 && (a.indexOf(want) >= 0 || want.indexOf(a) >= 0)) return L[j];
      if (b && (b === want || (want.length > 5 && b.indexOf(want) >= 0))) return L[j];
    }
    return null;
  }

  function kbRaw(q, topK) {
    if (typeof kbSearch !== 'function') return Promise.resolve([]);
    var ids = [];
    try { ids = (typeof kbSelected === 'function') ? (kbSelected() || []) : []; } catch (e) { ids = []; }
    if (!ids.length) return Promise.resolve([]);
    return kbSearch(String(q).slice(0, 600), ids, topK || 24).then(function (hs) {
      var out = [];
      (hs || []).forEach(function (h) {
        var f = null; try { f = fileByHit(h) || fileOfName(h.file || h.doc || h.name || h.path); } catch (e) { f = fileOfName(h.file || h.doc || h.name); }
        if (!f) return;
        var pg = (h.pdfp | 0) || (h.page | 0) || 0;
        if (pg > (f.n || 9999)) pg = 0;
        if (pg > 0) pg = localPage(f, pg);
        out.push({ src: f.src, p: pg, score: (h.rr != null ? +h.rr : +h.score) || 0, name: f.f, head: h.head || '' });
      });
      return out;
    }).catch(function () { return []; });
  }

  function pageText(rows, src, p) {
    var fo = fileOf(src) || {};
    var want = normName(src);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      if (r.src !== src && normName(r.src) !== want) continue;
      if (localPage(fo, r.p) === p) return r.t || '';
    }
    return '';
  }
  /* ---------- 定位：①向量库定 PDF ②AI 定考点/关键知识点 ③每份 PDF 内按知识点排序（web762 重写） ---------- */
  var SUBROWS = {};
  function rowsFor(subj) {
    if (SUBROWS[subj]) return Promise.resolve(SUBROWS[subj]);
    return loadRows(subj, true).then(function (rows) { SUBROWS[subj] = rows || []; return SUBROWS[subj]; });
  }

  /* 取某科目的「带正文的行」：先用文字索引（一定有 t），失败再退回 rowsFor */
  /* 全库文字行（按科目一遍拿齐，缓存）；「全讲义找知识点」用它取句子 */
  var ALLROWS = null;
  function allTextRows() {
    if (ALLROWS) return Promise.resolve(ALLROWS);
    var subs = ['病理', '内科', '生化', '生理', '外科', '其他'];
    return Promise.all(subs.map(function (s) {
      return Promise.resolve().then(function () { return loadTextSubj(s); }).catch(function () { return []; });
    })).then(function (lists) {
      var all = [];
      lists.forEach(function (l) { if (l && l.length) all = all.concat(l); });
      ALLROWS = all;
      return all;
    });
  }

  var TEXTROWS = {};
  function textRowsFor(subj) {
    if (TEXTROWS[subj]) return Promise.resolve(TEXTROWS[subj]);
    return Promise.resolve().then(function () {
      return (typeof loadTextSubj === 'function') ? loadTextSubj(subj) : null;
    }).then(function (rows) {
      if (rows && rows.length) { TEXTROWS[subj] = rows; return rows; }
      return rowsFor(subj).then(function (r2) { TEXTROWS[subj] = r2 || []; return TEXTROWS[subj]; });
    }).catch(function () { return rowsFor(subj).catch(function () { return []; }); });
  }

  function multiLocate(q, opts) {
    opts = opts || QP.opts || [];
    var stem = q || QP.stem || '';
    var mustIdx = (FILES && FILES.length) ? Promise.resolve() : loadIndex();
    var kbP = mustIdx.catch(function () { return null; }).then(function () { return Promise.resolve(); })
      .then(function () {
        if (typeof kbEnsureFilesLoaded === 'function') return kbEnsureFilesLoaded();
        return null;
      })
      .then(function () { return (typeof kbRows === 'function') ? kbRows(q) : []; })
      .catch(function () { return []; });
    var spP = knowSpec(stem, opts, null).catch(function () { return null; });
    return Promise.all([kbP, spP]).then(function (rp) {
      var hits = rp[0] || [], spec = rp[1] || {};
      var pts = knowWeighted(spec).slice(0, 6);
      var tp = String((spec.subject || '') + ' ' + (spec.goal || '')).replace(/\s+/g, ' ').trim();
      var fileScore = {}, subs = {}, pageBoost = {};
      (hits || []).forEach(function (h) {
        var src = h.src || ((fileByHit(h) || {}).src);
        if (!src) return;
        var sc0 = Math.max(1, Number(h.score || h.rr || 1));
        fileScore[src] = (fileScore[src] || 0) + sc0;
        var p0 = h.p | 0;
        if (p0 > 0) { var gk = src + '#' + p0; pageBoost[gk] = Math.max(pageBoost[gk] || 0, sc0); }
        var sb = subjOf(src); if (sb) subs[sb] = 1;
      });
      var cs = subjOf(CUR.src); if (cs) subs[cs] = 1;
      var sks = Object.keys(subs);
      return Promise.all(sks.map(function (s) { return rowsFor(s).catch(function () { return []; }); })).then(function () {
        var files = Object.keys(fileScore).sort(function (a, b) { return fileScore[b] - fileScore[a]; }).slice(0, 8);
        try { window.__M1 = { nh: (hits || []).length, nfs: Object.keys(fileScore).length, h0: ((hits || [])[0] || {}).src, f0: ((hits || [])[0] || {}).src || null, files: files.slice(0, 5), pts: pts.map(function (x) { return x.k + ':' + x.w; }) }; } catch (e9) {}
        if (!files.length) {
          files = (FILES || []).filter(function (f) { return subjOf(f.src) === cs; }).slice(0, 6).map(function (f) { return f.src; });
        }
        var qEmb = (tp + ' ' + stem + ' ' + pts.slice(0, 4).map(function (x) { return x.k; }).join(' ')).slice(0, 400);
        var jobs = files.map(function (src) {
          var rows = (SUBROWS[subjOf(src)] || []).filter(function (r) { return r.src === src && r.t && String(r.t).length > 20; });
          if (!rows.length) return Promise.resolve([]);
          var scored = rows.map(function (r) {
            var t = lecClean(r.t), w = 0;
            pts.forEach(function (p2) { if (p2.k && t.indexOf(p2.k) >= 0) w += p2.w; });
            return { r: r, cov: w, isq: (typeof isQPage === 'function' && isQPage(r.t)) ? 1 : 0 };
          });
          var byPage = {}, byQ = {};
          scored.forEach(function (x) { byPage[x.r.p] = x.cov; if (x.isq) byQ[x.r.p] = 1; });
          scored.sort(function (a, b) { return b.cov - a.cov; });
          var pick = scored.slice(0, 24).map(function (x) { return x.r; });
          var seenP = {}; pick.forEach(function (r) { seenP[r.p] = 1; });
          rows.forEach(function (r) { if (!seenP[r.p] && pageBoost[src + '#' + r.p]) { pick.push(r); seenP[r.p] = 1; } });
          return rankPages(pick, qEmb).then(function (ranked) {
            var out = [];
            (ranked || []).forEach(function (x) {
              var cov = byPage[x.p] || 0;
              var covN = pts.length ? Math.min(1, cov / 5) : 0;
              var hitP = pageBoost[src + '#' + x.p] ? 0.18 : 0;
              var raw0 = Math.min(0.99, 0.62 * (x.score || 0) + 0.38 * covN + hitP);
              var pen0 = byQ[x.p] ? 0.15 : 1;
              out.push({ src: src, p: x.p, score: raw0 * pen0, covN: covN, knowNum: pts.length, kbpage: hitP ? 1 : 0, isq: byQ[x.p] ? 1 : 0 });
            });
            out.sort(function (a, b) { return b.score - a.score; });
            return out.slice(0, 3);
          }).catch(function () { return []; });
        });
        return Promise.all(jobs).then(function (lists) {
          var all = [];
          lists.forEach(function (l) { (l || []).forEach(function (x) { all.push(x); }); });
          all.sort(function (a, b) { return b.score - a.score; });
          all.forEach(function (x) {
            var f = fileOf(x.src) || {};
            x.f = f.f || String(x.src).split('/').pop();
            x.n = f.n || 0;
            x.know = tp ? ('考点 ' + tp.slice(0, 36)) : '';
          });
          return all;
        });
      });
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
    var lk = LOCKEY(), lc = LOC_CACHE[lk];
    if (lc && lc.list && lc.list.length && (Date.now() - lc.ts) < 600000) {
      if (applyCands(lc.list, lc.tag)) {
        if (el.meta) el.meta.textContent = (el.meta.textContent || '') + ' · 10 分钟内同题缓存';
        return;
      }
    }
    if (SCOPE.mode === 'file') return fileLocate(q);
    var tag = (SCOPE.mode === 'subj') ? ('📚 ' + (SCOPE.subj || '这一科')) : '📚 多份检索';
    if (el.meta) el.meta.textContent = '正在多份讲义里一起找这一页…';
    /* 首选：多份 PDF 一起检索（知识库命中的每一份 + 当前位置），按相似度排 */
    withTimeout(multiLocate(q, QP.opts), 45000).then(function (list) {
      if (list && list.length) { applyCands(list, tag); return null; }
      if (el.meta) el.meta.textContent = '正在用「AI 解析」的资料检索找这一页…';
      /* 退路：和 AI 解析共用同一套资料检索（kb.js）→ 在这份 PDF 里逐页排序 */
      return withTimeout(kbLocate(q), 25000).then(function (fd) {
        if (!fd) { legacyLocate(q); return null; }
        if (el.meta) el.meta.textContent = '已定到《' + fd.name.slice(0, 20) + '》，正在这份里逐页比对…';
        return withTimeout(embedRank(fd.src, q), 14000).then(function (l2) {
          l2 = l2 || [];
          if (!l2.length) { jumpToSrc(fd.src, fd.p, '📚 资料检索：' + fd.name.slice(0, 20) + ' 第 ' + fd.p + ' 页'); return null; }
          applyCands(l2.map(function (x) { return { src: x.src || fd.src, p: x.p, score: x.score }; }), '📚 资料检索');
          return null;
        });
      });
    }).catch(function () { legacyLocate(q); });
  }
  /* 旧链路：当前科目关键词 → 向量/聊天选页 → 关键词第一页 */
  function legacyLocate(q) {
    if (el.meta) el.meta.textContent = '正在翻讲义找这一页…';
    loadTextSubj().then(function (rows) {
      HIT_ROWS = rows || [];
      var hits = searchIn(HIT_ROWS, q);
      if (!hits.length) { if (el.meta) el.meta.textContent = ''; toast('没在这批讲义里找到相关内容'); return; }
      CAND = hits; CAND_I = 0;
      jumpTo(hits[0]);                       /* 先用关键词第一页垫底，AI 选完再纠正 */
      if (el.meta) el.meta.textContent = 'AI 正在看这几页，挑最像的一页…';
      /* 先试向量（本地嵌入服务：免费、快、不需要聊天模型），不行再试聊天模型 */
      return withTimeout(pickByEmbedding(q, hits), 15000).then(function (pv) {
        if (pv) return pv;
        if (el.meta) el.meta.textContent = '语义模型没及时回话，换聊天模型再试…';
        return withTimeout(aiPickPage(q, hits), 20000);
      }).then(function (pick) {
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
  /* 候选页列表：按相关度从小到大排，点一条直接跳 */
  function openCands() {
    closeCands();
    if (!CAND2.length) { toast('还没有候选：先点「🔍 定位到这题」'); return; }
    var mask = ce('div', 'lec-smask'); mask.id = 'lecCandMask';
    var sheet = ce('div', 'lec-ssheet lec-ssheet-wide');
    /* 按讲义分组：一组一份 PDF，组内按这页的相关度排；组与组之间按各份的最高分排 */
    var groups = [], gi = {};
    for (var j = 0; j < CAND2.length; j++) {
      var c0 = CAND2[j], g0 = gi[c0.src];
      if (!g0) { g0 = gi[c0.src] = { src: c0.src, rows: [] }; groups.push(g0); }
      g0.rows.push({ i: j, c: c0 });
    }
    groups.forEach(function (g) {
      g.rows.sort(function (a, b) { return (b.c.score || 0) - (a.c.score || 0); });
      g.best = Math.max.apply(null, g.rows.map(function (r) { return r.c.score || 0; }));
    });
    groups.sort(function (a, b) { return b.best - a.best; });
    var h = '<div class="lec-shead"><b>候选讲义 · ' + groups.length + ' 份 / ' + CAND2.length + ' 页</b>'
      + '<button class="lec-sx" data-cd="x" title="关闭（Esc）">×</button></div>';
    h += '<div class="lec-sbody">';
    groups.forEach(function (g) {
      var f = fileOf(g.src) || {};
      var nm = String(f.f || g.src || '').replace(/\.pdf$/i, '');
      h += '<div class="lec-cgrp"><div class="lec-cgh"><b>' + nm.replace(/</g, '&lt;') + '</b>'
        + '<span>最像 ' + g.best.toFixed(2) + ' · ' + g.rows.length + ' 页候选</span></div>';
      g.rows.forEach(function (r, gi2) {
        var c = r.c, i = r.i;
        var sc = (c.score > 0 && c.score <= 1) ? c.score.toFixed(2) : '';
        h += '<button class="lec-crow' + (i === CAND_I ? ' on' : '') + '" data-cd="go" data-i="' + i + '">' +
          '<em>' + (gi2 + 1) + '</em>' +
          '<div><b>第 ' + localPage(f, c.p) + ' 页</b>' + (c.isq ? '<u class="lec-qtag">真题页</u>' : '') + '</div>' +
          (sc ? '<i class="lec-cbar"><u style="width:' + Math.round(Math.max(6, Math.min(100, c.score * 100))) + '%"></u></i><s>' + sc + '</s>' : '') +
          '</button>';
      });
      h += '</div>';
    });
    h += '</div><div class="lec-sfoot">在全部讲义里按相似度排；点一条直接跳过去</div>';
    sheet.innerHTML = h;
    mask.appendChild(sheet);
    mask.addEventListener('click', function (ev) {
      if (ev.target === mask) return closeCands();
      var b = ev.target.closest('[data-cd]'); if (!b) return;
      if (b.getAttribute('data-cd') === 'x') return closeCands();
      var i = parseInt(b.getAttribute('data-i'), 10) || 0;
      var c = CAND2[i]; if (!c) return;
      CAND_I = i;
      closeCands();
      jumpToSrc(c.src, c.p, '📚 候选 ' + (i + 1) + '/' + CAND2.length + '：第 ' + localPage(fileOf(c.src) || {}, c.p) + ' 页' + (c.score <= 1 ? ' · 相似度 ' + c.score.toFixed(2) : ''));
    });
    document.body.appendChild(mask);
    window.__closeLecCands = function () { try { mask.parentNode.removeChild(mask); } catch (e) {} };
  }
  function closeCands() { if (window.__closeLecCands) window.__closeLecCands(); }
  function nextCand() {
    if (CAND2.length) {
      CAND_I = (CAND_I + 1) % CAND2.length;
      var c = CAND2[CAND_I];
      jumpToSrc(c.src, c.p, '📚 资料检索：第 ' + c.p + ' 页（候选 ' + (CAND_I + 1) + '/' + CAND2.length + '）');
      toast('换到第 ' + c.p + ' 页（相似度 ' + (c.score <= 1 ? c.score.toFixed(2) : c.score) + '）');
      return;
    }
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
      try { localStorage.removeItem('qbank.lec.idx.v3'); localStorage.removeItem('qbank.lec.idx.v2'); } catch (e) {}
      location.reload();
    });
  }

  function ensureIndex(force) {
    if (el.meta) el.meta.textContent = force ? '重新读讲义目录…' : '正在读讲义目录…';
    return loadIndex(force).then(function () {
      restore(); fillSelect(); paint(); applyBind(); try { scopePaint(); } catch (e) {}
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
    fillSelect(); paint(); applyBind(); try { scopePaint(); } catch (e) {}
  }

  var REOPEN_ON_CLOSE = false;
  function close() {
    unzoom();
    if (el.mask) el.mask.classList.remove('on');
    if (el.sheet) el.sheet.classList.remove('on');
    if (REOPEN_ON_CLOSE) {
      REOPEN_ON_CLOSE = false;
      var nb = NOTE_LAST || window.__LEC_LASTNOTE;
      if (nb) setTimeout(function () { renderNote(nb, true); }, 80);
    }
  }

  /* AI 解析的「参考资料」里点「📖 在讲义里看这页」：按知识库命中的文件名找到讲义 →
     直接跳到那一页（找不到就明说，不要静默什么都不做） */
  function openHit(h) {
    if (!h) return false;
    var go = function () {
      var f = null;
      try { f = fileByHit(h); } catch (e) { f = null; }
      if (!f) { toast('这份讲义不在讲义库里：' + String(h.doc || h.file || '')); return; }
      var pg = (h.pdfp | 0) || (h.page | 0) || 1;
      pg = Math.max(1, Math.min(f.n || 9999, pg));
      CAND2 = [];
      jumpToSrc(f.src, pg, '📖 ' + (h.doc || f.name || '资料原文') + ' 第 ' + pg + ' 页');
    };
    var n = 0;
    var wait = function () {
      if (FILES && FILES.length) go();
      else if (++n < 40) setTimeout(wait, 120);
      else toast('讲义目录还没读出来，等它加载完再点一次');
    };
    open();
    setTimeout(wait, 80);
    return true;
  }

  /* 答题页的「📖 讲义」按钮：委托点击，不依赖 app.js 重新绑 */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#doLec');
    if (!b) return;
    ev.preventDefault();
    open();
  }, true);


  /* ===== 选中文字 → 在所有讲义里找这个知识点（右键菜单） ===== */
  function askKeys(sel, qtext) {
    var fallback = (function () {
      var s0 = String(sel).replace(/\s+/g, ''), cands = [];
      s0.split(/[，,。；;：:、\n]/).forEach(function (seg) {
        seg = seg.trim();
        if (seg.length < 2) return;
        if (seg.length > 6) { cands.push(seg.slice(0, 4)); cands.push(seg.slice(0, 6)); cands.push(seg.slice(-4)); }
        else cands.push(seg);
      });
      cands = cands.filter(function (x, i, a) { return x && x.length >= 2 && a.indexOf(x) === i; }).slice(0, 4);
      if (!cands.length) cands = [s0.slice(0, 6)];
      return { keys: cands, why: '' };
    })();
    if (typeof window.aiChat !== 'function') return Promise.resolve(fallback);
    var msgs = [
      { role: 'system', content: '你是医学讲义检索助手。用户选中了题目里的一句话，你要给出「在讲义里找它」用的检索短语。只输出 JSON：{"keys":["2-4个短语，用讲义术语，每个≤14字"],"why":"这段在解题里起什么作用，≤20字"}。短语要能匹配讲义原词（例如「血清铁」「转铁蛋白饱和度」），不要整句照抄。' },
      { role: 'user', content: '整道题：' + String(qtext || '').slice(0, 500) + '\n选中的文字：' + String(sel).slice(0, 300) }
    ];
    return withTimeout(window.aiChat(msgs, null, null, { stream: false, temp: 0, maxTokens: 300 }), 9000).then(function (txt) {
      var s = String(txt || '').replace(/```json/gi, '').replace(/```/g, '');
      var a = s.indexOf('{'), b2 = s.lastIndexOf('}');
      if (a < 0 || b2 < a) return fallback;
      var o = JSON.parse(s.slice(a, b2 + 1));
      var keys = (o.keys || []).map(function (x) { return String(x || '').replace(/\s+/g, ''); }).filter(function (x) { return x.length >= 2 && x.length <= 20; });
      if (!keys.length) return fallback;
      return { keys: keys.slice(0, 4), why: String(o.why || '').slice(0, 30) };
    }).catch(function () { return fallback; });
  }

  function closeWeb() { var m = $('#lecWebMask'); if (m) m.remove(); }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function sentsOf(t, keys) {
    var text = String(t || '').replace(/每日计划[\s\S]{0,60}?考点补充/, '');
    var parts = text.split(/[。！？；\n]+/), out = [];
    parts.forEach(function (s) {
      s = s.replace(/\s+/g, ' ').trim();
      if (s.length < 10 || s.length > 170) return;
      var hits = [];
      keys.forEach(function (k) {
        if (!k) return;
        if (s.indexOf(k) >= 0) { hits.push(k); return; }
        var sh = k.length > 3 ? k.slice(0, 3) : '';
        if (sh && s.indexOf(sh) >= 0) hits.push(sh);
        else { var sh2 = k.length > 2 ? k.slice(0, 2) : ''; if (sh2 && s.indexOf(sh2) >= 0) hits.push(sh2); }
      });
      if (!hits.length) return;
      var w = 0;
      hits.forEach(function (k) { w += keys.indexOf(k) === 0 ? 2 : 1; });
      out.push({ t: s, hits: hits, w: w });
    });
    out.sort(function (a, b) { return b.w - a.w || b.t.length - a.t.length; });
    return out.slice(0, 2);
  }

  function markSents(s, hits) {
    var html = esc(s);
    (hits || []).forEach(function (k) {
      if (!k) return;
      var kk = esc(k);
      html = html.split(kk).join('<mark>' + kk + '</mark>');
    });
    return html;
  }

  /* 一次「全讲义找知识点」= 一份笔记：选中的话 + AI 说明 + 关键词 + 命中页/句子 */
  function buildNote(sel, spec, pages) {
    var items = [];
    pages.forEach(function (x) {
      var ss = sentsOf(x.raw || x.snip || '', (spec.keys || []).slice(0, 4));
      if (!ss.length) return;
      items.push({ src: x.src, name: String(x.f || '').replace(/\.pdf$/i, ''), p: x.p, score: x.score, sents: ss });
    });
    var note = {
      v: 1, id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sel: String(sel).slice(0, 200), why: spec.why || '', keys: (spec.keys || []).slice(0, 6),
      q: (function () { try { var s = (QP.stem || '').slice(0, 60); return s; } catch (e) { return ''; } })(),
      ts: Date.now(), items: items
    };
    return note;
  }

  function noteHtml(note) {
    var order = [], map = {};
    note.items.forEach(function (x) { if (!map[x.src]) { map[x.src] = []; order.push(x.src); } map[x.src].push(x); });
    order.sort(function (a, b) { return (map[b][0].score || 0) - (map[a][0].score || 0); });
    var body = '';
    order.forEach(function (src) {
      var arr = map[src];
      body += '<div class="lec-cgrp"><b>' + esc(arr[0].name || '').slice(0, 40) + '</b><span>' + arr.length + ' 页 · ' + Math.round((arr[0].score || 0) * 100) + '%</span></div>';
      arr.forEach(function (x) {
        x.sents.forEach(function (s, si) {
          body += '<button class="lec-nsent" data-web="go" data-src="' + esc(x.src) + '" data-p="' + x.p + '">'
            + '<u>第 ' + x.p + ' 页</u><i>' + markSents(s.t, s.hits) + '</i></button>';
        });
      });
    });
    return body || '<div class="lec-srow">这段在各份讲义里没找到成句的表述</div>';
  }

  /* 一键总结（接地版）：模型只看带编号的原句，输出要点必须指回某一条原句，
     这样每条要点都能点开对应讲义页，而不是凭空写一段话 */
  function parseSum(text, note, L) {
    var out = [], s = String(text || '').trim(), arr = null;
    var m = s.match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch (e) {} }
    if (!arr) { try { var o = JSON.parse(s); if (o && o.sum) arr = o.sum; } catch (e) {} }
    if (Array.isArray(arr)) {
      arr.forEach(function (x) {
        if (!x) return;
        var tt = String(x.t || x.text || '').trim();
        if (tt.length < 3) return;
        var i = Math.max(1, Math.min(L.length, parseInt(x.i, 10) || 1));
        var it = L[i - 1];
        out.push({ t: tt, q: String(x.q || '').slice(0, 90), src: it.src, p: it.p, name: it.name });
      });
    }
    if (!out.length) {
      String(text || '').split(/\n+/).forEach(function (ln) {
        ln = ln.replace(/^\s*[-*·•\d.、)）]+\s*/, '').trim();
        if (!ln || ln.length < 6) return;
        var mm = ln.match(/第\s*(\d+)\s*页/);
        var pg = mm ? +mm[1] : 0;
        var hit = null;
        L.forEach(function (x) { if (!hit && pg && x.p === pg) hit = x; });
        if (!hit) hit = L[0];
        out.push({ t: ln.replace(/[【(（]?\s*第\s*\d+\s*页\s*[】)）]?/g, '').replace(/【\s*】/g, '').trim(), q: '', src: hit.src, p: hit.p, name: hit.name });
      });
    }
    return out.slice(0, 6);
  }

  /* ===== 知识点总览：全库合并成一份，每条挂「哪份讲义第几页」 ===== */
  var OV_MODE = 'mid';
  var OV_ST = null;
  var OV_LAST = null;

  function collectSources(keys, cap) {
    var q = keys.join(' ');
    var prep = Promise.resolve();
    try { prep = prep.then(function () { return (FILES && FILES.length) ? null : loadIndex(); }); } catch (e) {}
    try { if (typeof kbEnsureFilesLoaded === 'function') prep = prep.then(function () { return kbEnsureFilesLoaded(); }).catch(function () { return null; }); } catch (e) {}
    return prep.then(function () { return kbRaw(q, 80); }).then(function (rows) {
      var bySrc = {}, order = [];
      (rows || []).forEach(function (r) { if (!r.src) return; if (!bySrc[r.src]) { bySrc[r.src] = 1; order.push(r.src); } });
      var srcs = order.slice(0, 6);
      return Promise.all(srcs.map(function (src) {
        return textRowsFor(subjOf(src)).then(function (all) {
          var out = [], keys2 = keys.slice(0, 4);
          (all || []).forEach(function (r) {
            if (!r.t) return;
            if (r.src !== src && normName(r.src) !== normName(src)) return;
            var ss = sentsOf(lecClean(r.t), keys2);
            ss.forEach(function (s) {
              out.push({ src: src, name: String((fileOf(src) || {}).f || '').replace(/\.pdf$/i, ''), p: r.p, t: s.t, hits: s.hits, w: s.w, isq: (typeof isQPage === 'function' && isQPage(r.t)) ? 1 : 0 });
            });
          });
          out.sort(function (a, b) { return b.w - a.w; });
          return out.filter(function (x) { return !x.isq; }).slice(0, 5);
        }).catch(function () { return []; });
      })).then(function (lists) {
        var all = [];
        lists.forEach(function (l) { all = all.concat(l || []); });
        all.sort(function (a, b) { return b.w - a.w; });
        all = all.slice(0, cap || 36);
        all.forEach(function (x, i) { x.i = i + 1; });
        return all;
      });
    });
  }

  function ovPrompt(sel, keys, sources, mode) {
    var list = sources.map(function (x) {
      return '[' + x.i + ']（' + x.name + '·第' + x.p + '页）' + x.t;
    }).join('\n');
    var num = mode === 'long' ? '30–40' : '12–18';
    var sys = '你是医学考研讲义的整理助手。给你一个知识点，和一组带编号的讲义原句。把原句合并成一份有结构的总览，只输出 JSON：'
      + '{"sections":[{"h":"一、小节标题","items":[{"t":"一句要点（≤40字）","c":[编号,…],"cov":["讲义简称"]}],"conflict":"（可选）不同讲义说法不一致之处"}],"conflict":"（可选）"}。'
      + '规则：1) 每条 item 的 c 至少 1 个编号，只能引用给定编号，禁止编造；2) 正文按主流说法合并，确有不一致时正文照主流写、同时在 conflict 里写清「A说…，B说…」；'
      + '3) 分节按医学逻辑（定义/机制/对比/例子/易错/考点）；4) 这次写 ' + num + ' 条；5) 不要开场白、不要解释。';
    var user = '知识点：' + sel + '\n讲义原句：\n' + list;
    return withTimeout(aiChat([{ role: 'system', content: sys }, { role: 'user', content: user }], null, null, { stream: false, temp: 0.1, maxTokens: mode === 'long' ? 2200 : 1400 }), mode === 'long' ? 45000 : 30000);
  }

  function parseOverview(text, sources) {
    var s = String(text || '').replace(/```json/gi, '').replace(/```/g, '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    var o;
    try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    var out = { sections: [], conflict: String(o.conflict || '') };
    (o.sections || []).forEach(function (sec) {
      var items = [];
      (sec.items || []).forEach(function (it) {
        var cs = (it.c || []).map(function (n) { return sources[(+n || 0) - 1]; }).filter(Boolean);
        if (!cs.length) return;
        items.push({ t: String(it.t || '').slice(0, 120), cites: cs, cov: (it.cov || []).slice(0, 5) });
      });
      if (items.length) out.sections.push({ h: String(sec.h || '').slice(0, 30), items: items, conflict: String(sec.conflict || '') });
    });
    return out.sections.length ? out : null;
  }

  function ovHtml(st) {
    var keys = st.keys || [];
    var h = '';
    if (!st.ov) h += '<div class="lec-srow">还没有生成，点右下角「生成」</div>';
    else {
      st.ov.sections.forEach(function (sec) {
        h += '<div class="lec-ovh">' + esc(sec.h) + '</div><div class="lec-ovbody">';
        sec.items.forEach(function (it) {
          h += '<div class="lec-ovli">' + markSents(it.t, keys)
            + it.cites.map(function (c) {
              return '<button class="lec-ovcite" data-web="go" data-src="' + esc(c.src) + '" data-p="' + c.p + '">📖 ' + esc(String(c.name).slice(0, 16)) + ' · 第 ' + c.p + ' 页</button>';
            }).join('')
            + (it.cov && it.cov.length ? '<span class="lec-ovcov">' + it.cov.map(function (x) { return '<i>' + esc(x) + '</i>'; }).join('') + '</span>' : '')
            + '</div>';
        });
        h += '</div>';
        if (sec.conflict) h += '<div class="lec-ovwarn">⚠️ ' + esc(sec.conflict) + '</div>';
      });
      if (st.ov.conflict) h += '<div class="lec-ovwarn">⚠️ 说法不一致：' + esc(st.ov.conflict) + '</div>';
    }
    return h;
  }

  function renderOverview(st) {
    OV_ST = st;
    var old = document.getElementById('lecWebMask'); if (old) old.remove();
    OV_LAST = st;
    var mask = document.createElement('div');
    mask.className = 'lec-smask';
    mask.id = 'lecWebMask';
    var n = (st.ov && st.ov.sections) ? st.ov.sections.reduce(function (a, s) { return a + s.items.length; }, 0) : 0;
    mask.innerHTML = '<div class="lec-ssheet"><div class="lec-shead"><b>🧩 知识点总览</b>'
      + '<button class="lec-sx" data-web="close">×</button></div>'
      + '<div class="lec-slaber">「' + esc(st.sel.slice(0, 46)) + '」<br>· 全库 ' + (st.sources || []).length + ' 条原句合并 · ' + n + ' 条要点</div>'
      + '<div class="lec-sbody">' + ovHtml(st) + '</div>'
      + '<div class="lec-sfoot">'
      + '<button class="lec-ovmode' + (st.mode === 'mid' ? ' on' : '') + '" data-web="mode" data-m="mid">中版</button>'
      + '<button class="lec-ovmode' + (st.mode === 'long' ? ' on' : '') + '" data-web="mode" data-m="long">长版</button>'
      + '<button class="lec-nsum2" data-web="gen">' + (st.ov ? '↻ 重新生成' : '✨ 生成') + '</button>'
      + '<button class="lec-nsave" data-web="saveov">💾 存成笔记</button></div></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-web]');
      if (!b) { if (ev.target === mask) return; return; }
      var a = b.getAttribute('data-web');
      if (a === 'close') { ev.stopPropagation(); return mask.remove(); }
      if (a === 'mode') {
        ev.stopPropagation();
        st.mode = b.getAttribute('data-m'); OV_MODE = st.mode;
        renderLoading('正在生成' + (st.mode === 'long' ? '长版' : '中版') + '总览…', '把全库原句合并成一份');
        return runOverview(st.sel, st.keys, st.mode, st);
      }
      if (a === 'gen') {
        ev.stopPropagation();
        renderLoading('正在重新生成…', '重扫全库原句');
        return runOverview(st.sel, st.keys, st.mode, st);
      }
      if (a === 'saveov') {
        ev.stopPropagation();
        if (!window.LECNOTES || !window.LECNOTES.saveOverview) { toast('笔记模块没加载', 1600, 'bad'); return; }
        var r = window.LECNOTES.saveOverview(st);
        toast(r && r.dup ? '这份已经存过了' : '已存进「📚 知识点笔记」', 1800, 'ok');
        return;
      }
      if (a === 'go') {
        ev.stopPropagation();
        var src = b.getAttribute('data-src'), pg = +b.getAttribute('data-p') || 1;
        jumpFromNote({ sel: st.sel, items: [] }, src, pg);
        return;
      }
    });
  }

  function runOverview(sel, keys, mode, keep) {
    var st = keep || { sel: sel, keys: keys, mode: mode, sources: [], ov: null };
    st.mode = mode;
    var p1 = st.sources && st.sources.length ? Promise.resolve(st.sources) : collectSources(keys, mode === 'long' ? 40 : 36);
    return p1.then(function (srcs) {
      st.sources = srcs;
      if (!srcs.length) { st.ov = { sections: [], conflict: '' }; st.sources = []; renderOverview(st); toast('全库没捞到原句', 2000, 'bad'); return; }
      return ovPrompt(sel, keys, srcs, mode).then(function (txt) {
        var ov = parseOverview(txt, srcs);
        if (!ov) { toast('AI 没给出结构化的总览', 2200, 'bad'); return; }
        st.ov = ov;
        renderOverview(st);
      });
    }).catch(function (e) { toast('生成失败：' + (e && e.message || e), 2400, 'bad'); });
  }

  function overview(sel, keysHint) {
    sel = String(sel || '').trim().slice(0, 300);
    if (!sel) return Promise.resolve(false);
    var qtext = ''; try { qtext = questionText(); } catch (e) {}
    renderLoading('正在扫全库…', '先从所有讲义里把讲这个知识点的句子捞出来');
    return (keysHint && keysHint.length ? Promise.resolve({ keys: keysHint }) : askKeys(sel, qtext)).then(function (spec) {
      var keys = (spec.keys && spec.keys.length ? spec.keys : [sel]).slice(0, 4);
      return runOverview(sel, keys, OV_MODE);
    });
  }

  function summarize(note) {
    if (!window.aiChat) return Promise.reject(new Error('没配 AI'));
    var L = [];
    (note.items || []).forEach(function (x) {
      (x.sents || []).forEach(function (s) {
        if (L.length >= 14) return;
        L.push({ src: x.src, p: x.p, name: x.name, t: String(s.t || '').slice(0, 180) });
      });
    });
    if (!L.length) return Promise.reject(new Error('没有可总结的句子'));
    var lines = L.map(function (x, i) { return '[' + (i + 1) + ']（第' + x.p + '页）' + x.t; }).join('\n');
    var msgs = [
      { role: 'system', content: '你是医学考研讲义的整理助手。用户给出带编号的原句，请写 3–5 条要点帮考生回忆这个知识点。只输出 JSON，不要任何解释或代码块标记，格式：{"sum":[{"t":"要点，不超过30字","i":原句编号,"q":"支撑这条要点的原句片段，不超过40字，尽量原样摘录"}]}。i 必须是给定编号中的一个；不要编造片段里没有的内容；要点之间不要重复。' },
      { role: 'user', content: '知识点：' + note.sel + '\n' + (note.why ? ('说明：' + note.why + '\n') : '') + '原句：\n' + lines }
    ];
    return withTimeout(aiChat(msgs, null, null, { stream: false, temp: 0.1, maxTokens: 800 }), 20000).then(function (txt) {
      var r = parseSum(String(txt || ''), note, L);
      if (!r.length) throw new Error('模型没给出可用的要点');
      return r;
    });
  }

  function sumHtml(note) {
    if (!note.sum || !note.sum.length) return '';
    var h = '<div class="lec-nsum"><b>✨ 总结 <i class="lec-nsum-h">点一条跳到原句那页</i></b>';
    note.sum.forEach(function (x) {
      h += '<button class="lec-nsum-item" data-web="go" data-src="' + esc(x.src) + '" data-p="' + x.p + '">'
        + '<em>' + markSents(x.t, note.keys || []) + '</em>'
        + (x.q ? '<q>' + markSents(x.q, note.keys || []) + '</q>' : '')
        + '<u>' + esc(String(x.name || '').slice(0, 12)) + ' · 第 ' + x.p + ' 页</u></button>';
    });
    return h + '</div>';
  }

  /* 存笔记：统一入口（按钮 / 委托 / 外部调用都走它） */
  function saveNoteNow() {
    var n = NOTE_LAST;
    if (!n) { toast('还没有可存的汇总', 1600, 'bad'); return; }
    if (!window.LECNOTES || !window.LECNOTES.save) { toast('笔记模块没加载', 1600, 'bad'); return; }
    if (!n.items || !n.items.length) { toast('还没截到成句的内容，先别存', 1800, 'bad'); return; }
    var r0 = window.LECNOTES.save(n);
    toast(r0 && r0.dup ? '这份已经存过了' : '已存进「📚 知识点笔记」', 1800, 'ok');
  }
  if (!window.__lecNoteClick) {
    window.__lecNoteClick = 1;
    document.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('[data-web="save"]');
      if (!b) return;
      var m = document.getElementById('lecWebMask');
      if (!m || !m.contains(b)) return;
      ev.preventDefault(); ev.stopPropagation();
      saveNoteNow();
    }, true);
  }

  /* 加载动画面板（检索/逐页比对期间显示，避免空白等待） */
  function renderLoading(title, sub) {
    var old = document.getElementById('lecWebMask');
    if (old) old.parentNode.removeChild(old);
    var mask = document.createElement('div');
    mask.className = 'lec-smask';
    mask.id = 'lecWebMask';
    mask.innerHTML = '<div class="lec-ssheet lec-loadsheet">'
      + '<div class="lec-load"><i></i><i></i><i></i></div>'
      + '<b>' + esc(title || '正在检索…') + '</b>'
      + '<span>' + esc(sub || '') + '</span></div>';
    document.body.appendChild(mask);
  }

  function reuseHtml(note) {
    if (!note.__reuse) return '';
    return '<div class="lec-reuse">♻️ 已命中存过的同类汇总（相似 ' + note.__reuse.sim + '%）'
      + '<button data-web="refetch">重新检索</button></div>';
  }

  function renderNote(note, reuse) {
    var ob = document.getElementById('lecBackRes'); if (ob) ob.remove();
    var old = document.getElementById('lecWebMask');
    if (old) old.parentNode.removeChild(old);
    NOTE_LAST = note;
    var mask = document.createElement('div');
    mask.className = 'lec-smask';
    mask.id = 'lecWebMask';
    mask.innerHTML = '<div class="lec-ssheet"><div class="lec-shead"><b>📚 知识点汇总</b>'
      + '<button class="lec-sx" data-web="close">×</button></div>'
      + '<div class="lec-slaber">「' + esc(note.sel.slice(0, 46)) + (note.sel.length > 46 ? '…' : '') + '」'
      + (note.why ? ('<br>· ' + esc(note.why)) : '') + '</div>'
      + '<div class="lec-sbody">' + reuseHtml(note) + sumHtml(note) + noteHtml(note) + '</div>'
      + '<div class="lec-sfoot"><span>' + Object.keys(note.items.reduce(function (o, x) { o[x.src] = 1; return o; }, {})).length + ' 份讲义 / ' + note.items.length + ' 句</span>'
      + '<button class="lec-nsum2" data-web="ov">🧩 知识点总览</button>'
      + '<button class="lec-nsave" data-web="save">💾 存成笔记</button></div></div>';
    document.body.appendChild(mask);
    var ub = mask.querySelector('.lec-nsum2');
    if (ub && ub.getAttribute('data-web') === 'ov') ub.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      overview(note.sel, note.keys);
    });
    if (ub && ub.getAttribute('data-web') !== 'ov') ub.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (!window.aiChat) { toast('设置里先配好 AI', 1800, 'bad'); return; }
      ub.textContent = '总结中…'; ub.disabled = true;
      summarize(note).then(function (sum) {
        if (!sum.length) { toast('AI 没给出要点', 1600, 'bad'); ub.textContent = '✨ AI 一键总结'; ub.disabled = false; return; }
        note.sum = sum;
        renderNote(note, true);
        toast('已总结 ' + sum.length + ' 条', 1400, 'ok');
      }).catch(function (e) {
        toast('总结失败：' + (e && e.message || e), 2200, 'bad');
        ub.textContent = '✨ AI 一键总结'; ub.disabled = false;
      });
    });
    var sb = mask.querySelector('.lec-nsave');
    if (sb) sb.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (!window.LECNOTES || !window.LECNOTES.save) { toast('笔记模块没加载', 1600, 'bad'); return; }
      if (!note.items || !note.items.length) { toast('还没截到成句的内容，先别存', 1800, 'bad'); return; }
      var r0 = window.LECNOTES.save(note);
      toast(r0 && r0.dup ? '这份已经存过了' : '已存进「📚 知识点笔记」', 1800, 'ok');
    });
    mask.addEventListener('click', function (ev) {
      var t2 = ev.target.closest('[data-web]');
      if (!t2) { return; }
      var a = t2.getAttribute('data-web');
      if (a === 'close') { ev.stopPropagation(); return mask.parentNode.removeChild(mask); }
      if (a === 'refetch') { ev.stopPropagation(); var rs = note.__reuse ? note.__reuse.sel : note.sel; try { delete note.__reuse; } catch (e) {} renderLoading('正在重新检索…', '忽略已有汇总，这次去知识库里重新找'); return searchWeb(rs, { force: true }); }
      if (a === 'save') {
        ev.stopPropagation();
        if (!window.LECNOTES || !window.LECNOTES.save) { toast('笔记模块没加载', 1600, 'bad'); return; }
        var r0 = window.LECNOTES.save(note);
        toast(r0 && r0.dup ? '这份已经存过了' : '已存进「📚 知识点笔记」', 1800, 'ok');
        return;
      }
      if (a === 'go') {
        ev.stopPropagation();
        var src = t2.getAttribute('data-src'), pg = +t2.getAttribute('data-p') || 1;
        jumpFromNote(note, src, pg);
      }
    });
  }

  /* 跳走之后仍能回来：记住当前笔记，抽屉里放一个「‹ 返回汇总」 */
  function jumpFromNote(note, src, pg) {
    NOTE_LAST = note; window.__LEC_LASTNOTE = note;
    var m = document.getElementById('lecWebMask');
    if (m) m.parentNode.removeChild(m);
    var ready = (FILES && FILES.length) ? Promise.resolve() : loadIndex();
    ready.catch(function () { return null; }).then(function () {
      var sheet = document.getElementById('lecSheet');
      if (!sheet || !sheet.classList.contains('on')) { try { open(); } catch (e) {} }
      return new Promise(function (r2) { setTimeout(r2, 60); });
    }).then(function () {
      try { jumpToSrc(src, pg, '📖 知识点：' + note.sel.slice(0, 12)); } catch (e) {}
      showResBack(note);
    });
  }

  function showResBack(note) {
    var old = document.getElementById('lecBackRes');
    if (old) old.parentNode.removeChild(old);
    var b = document.createElement('button');
    b.id = 'lecBackRes';
    b.className = 'lec-resback';
    b.innerHTML = '‹ 返回汇总';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      b.parentNode.removeChild(b);
      if (OV_ST) { renderOverview(OV_ST); } else { renderNote(note, true); }
    });
    document.body.appendChild(b);
  }

  /* ---------- 相似知识点复用：以前存过的同类汇总直接唤起，省一次检索 ---------- */
  var K_SIM = 0.6;
  function nk(s) { return String(s || '').toLowerCase().replace(/[\s、，,。；;：:（）()【】]/g, ''); }
  function keyOverlap(a, b) {
    var A = (a || []).map(nk).filter(Boolean), B = (b || []).map(nk).filter(Boolean);
    if (!A.length || !B.length) return 0;
    var hit = 0;
    A.forEach(function (x) {
      if (B.some(function (y) { return y.indexOf(x) >= 0 || x.indexOf(y) >= 0; })) hit++;
    });
    return hit / Math.max(A.length, B.length);
  }
  function findSimilarNote(keys) {
    try {
      var list = (window.LECNOTES && window.LECNOTES.list) ? window.LECNOTES.list() : [];
      var best = null;
      list.forEach(function (n) {
        if (!n || !n.items || !n.items.length) return;
        var sim = keyOverlap(keys, n.keys);
        if (!best || sim > best.sim) best = { note: n, sim: sim };
      });
      if (best && best.sim >= K_SIM) return best;
    } catch (e) {}
    return null;
  }

  function searchWeb(sel, opts) {
    sel = String(sel || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!sel) return Promise.resolve(false);
    var qtext = '';
    try { qtext = questionText(); } catch (e) { qtext = ''; }
    var mustIdx = (FILES && FILES.length) ? Promise.resolve() : loadIndex();
    return mustIdx.catch(function () { return null; }).then(function () {
      if (typeof kbEnsureFilesLoaded === 'function') return kbEnsureFilesLoaded();
      return null;
    }).then(function () { return askKeys(sel, qtext); }).then(function (spec) {
      var keys = (spec.keys && spec.keys.length ? spec.keys : [sel]).slice(0, 4);
      var query = keys.join(' ').slice(0, 240);
      var simHit = (typeof opts === 'undefined' || !opts || !opts.force) ? findSimilarNote(keys) : null;
      if (simHit) {
        simHit.note.__reuse = { sim: Math.round(simHit.sim * 100), sel: sel };
        renderNote(simHit.note, true);
        toast('命中已有汇总（相似 ' + Math.round(simHit.sim * 100) + '%）', 1600, 'ok');
        return false;
      }
      renderLoading('正在全讲义里找这个知识点…', '先定位相关讲义，再把命中句逐条排出来');
      return kbRaw(query, 48).then(function (rows) {
        if (!rows.length) { toast('讲义库里没搜到这句', 2000, 'bad'); return false; }
        var bySrc = {};
        rows.forEach(function (r) { if (!r.src || !r.p) return; (bySrc[r.src] = bySrc[r.src] || []).push(r); });
        var srcs = Object.keys(bySrc).slice(0, 8);
        return Promise.all(srcs.map(function (src) {
          return textRowsFor(subjOf(src)).then(function (all) {
            var out = [];
            (all || []).forEach(function (r) {
              if (!r.t) return;
              if (r.src !== src && normName(r.src) !== normName(src)) return;
              var tx = lecClean(r.t), w = 0, den = 0;
              keys.forEach(function (k, ki) { var w0 = ki === 0 ? 2 : 1; den += w0; if (tx.indexOf(k) >= 0) w += w0; });
              if (!w) return;
              var s0 = w / Math.max(1, den);
              if (typeof isQPage === 'function' && isQPage(r.t)) s0 *= 0.45;
              out.push({ src: src, p: r.p, score: s0, raw: tx, f: (fileOf(src) || {}).f });
            });
            out.sort(function (a, b) { return b.score - a.score || a.p - b.p; });
            var keep = out.slice(0, 5);
            keep.forEach(function (x) { x.score = Math.min(0.99, 0.5 + 0.49 * x.score); });
            return keep;
          }).catch(function () { return []; });
        })).then(function (lists) {
          var all = [];
          lists.forEach(function (l) { (l || []).forEach(function (x) { all.push(x); }); });
          all.sort(function (a, b) { return b.score - a.score; });
          var per = {}, keep = [];
          all.forEach(function (x) { per[x.src] = (per[x.src] || 0) + 1; if (per[x.src] <= 4) keep.push(x); });
          keep = keep.slice(0, 26);
          var note = buildNote(sel, { keys: keys, why: spec.why || '' }, keep);
          if (!note.items.length) { toast('找到了页，但没截到成句的表述', 2200, 'bad'); }
          renderNote(note);
          return note;
        });
      });
    }).catch(function (e) { toast('检索失败：' + (e && e.message || e), 2400, 'bad'); return false; });
  }

  window.LECTURE = { fileOfName: fileOfName, open: open, close: close, load: loadIndex, locate: locate, search: function (q) { return TXT ? searchIn(TXT, q) : []; }, text: loadText, textSubj: loadTextSubj,
    bind: putBind, unbind: delBind, bound: getBind, binds: function () { return bindAll(); },
    openHit: openHit,
    find: function (q) { if (el.find) el.find.value = q || ''; doFind(); }, state: function () { return { src: CUR.src, p: CUR.p, files: (FILES || []).length }; },
    files: function () { return FILES; }, pageKey: keyFor,
    diff: { on: diffOn, set: diffSet, plan: diffPlan, rerank: diffRerank, text: pageText },
    multi: multiLocate, rowsFor: rowsFor, searchWeb: searchWeb, kbRaw: kbRaw, note: function () { return NOTE_LAST; }, saveNote: saveNoteNow, overview: overview, renderNote: renderNote, jumpFromNote: jumpFromNote, _fbh: fileByHit, _nm: normName, _kb: function (q) { return kbRows(q); }, spec: function () { return knowSpec(QP.stem, QP.opts, null); }, cont: function () { return CAND2; },
  };
})();
