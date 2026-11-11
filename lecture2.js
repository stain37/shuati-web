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
        '<button class="btn lec-hard" data-lec="hardreset" title="讲义一直加载不出来时点这个：清掉本站缓存再重载（题库/作答不受影响）">🧹 清缓存重载</button>' +
      '</div>';
    var zoom = ce('div', 'lec-zoom'); zoom.id = 'lecZoom';
    zoom.innerHTML = '<div class="lec-zbar"><b>讲义原页 · 放大</b><span>点空白处、按 Esc 或点右上角关闭</span>' +
      '<button class="lec-zx" data-lec="unzoom" title="关闭（Esc）">×</button></div>' +
      '<img alt="讲义原页（放大）">';
    document.body.appendChild(mask); document.body.appendChild(sheet); document.body.appendChild(zoom);
    el = { mask: mask, sheet: sheet, meta: $('#lecMeta'), sel: $('#lecFile'), page: $('#lecPage'), total: $('#lecTotal'), img: $('#lecImg'), empty: $('#lecEmpty'), zoom: zoom,
      hits: $('#lecHits'), find: $('#lecFind'), findAll: $('#lecFindAll') };

    mask.addEventListener('click', close);
    sheet.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-lec]'); if (!b) return;
      var a = b.getAttribute('data-lec');
      if (a === 'close') return close();
      if (a === 'loc') return locate();
      if (a === 'scope') return openScope();
      if (a === 'scopeok') return pickScope(b.getAttribute('data-v'), b.getAttribute('data-subj'), b.getAttribute('data-src'));
      if (a === 'pin') return pinNow();
      if (a === 'unpin') return unpinNow();
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
  var Q_PENALTY = 0.30;   /* 定位到「印着原题的页」时，相关度直接砍到三成 */

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

  function applyCands(list, tag) {
    list = (list || []).slice(0, 18);
    if (!list.length) return false;
    CAND2 = list; CAND_I = 0;
    var top = list[0];
    var f = fileOf(top.src);
    var hint = (top.score > 0 && top.score <= 1) ? ' · 相似度 ' + top.score.toFixed(2) : '';
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
  function multiLocate(q, opts) {
    var plan = diffPlan(QP.stem, opts);
    var scopeSubj = (SCOPE.mode === 'subj') ? SCOPE.subj : subjOf(CUR.src);
    var prevP = loadTextSubj(scopeSubj).catch(function () { return []; });
    var expP = expandQuery(QP.stem).catch(function () { return ''; });
    return Promise.all([kbRows(q), prevP, expP]).then(function (r) {
      var kb = r[0] || [], prev = r[1] || [];
      var extraQ = String(r[2] || '').trim();
      var qAll = extraQ ? (q + ' ' + extraQ) : q;
      var bySrc = {};
      function addRows(rows) {
        (rows || []).forEach(function (x) {
          if (!x || !x.src) return;
          (bySrc[x.src] || (bySrc[x.src] = [])).push(x);
        });
      }
      addRows(prev);

      var fileScore = {}, kbPages = {};
      function bumpFile(src, sc) { if (!fileScore[src] || sc > fileScore[src]) fileScore[src] = sc; }
      function bumpPage(src, p, sc) {
        var m = kbPages[src] || (kbPages[src] = {});
        m[p] = Math.max(m[p] || 0, sc);
      }
      kb.forEach(function (x) {
        var sc = x.score || 0;
        bumpFile(x.src, sc);
        if (x.p > 0) bumpPage(x.src, x.p, sc);
      });
      function kwBump(rows) {
        var hs = (searchIn(rows, qAll) || []).slice(0, 80);
        hs.forEach(function (h) {
          var rr = rows[h.i]; if (!rr || !rr.src) return;
          var sc = Math.max(0.05, (h.score || 0) * 0.45);
          bumpFile(rr.src, sc);
          bumpPage(rr.src, localPage(fileOf(rr.src) || {}, rr.p), sc);
        });
      }
      if (prev.length) kwBump(prev);

      var files = Object.keys(fileScore)
        .sort(function (a, b) { return fileScore[b] - fileScore[a]; }).slice(0, 6);
      if (!files.length) return [];

      /* 命中文件不在当前科目的文字块里：把它所属科目的文字也读进来，才能按页比对 */
      var needSubj = {};
      files.forEach(function (src) {
        if (!bySrc[src] || !bySrc[src].length) { var sj = subjOf(src); if (sj) needSubj[sj] = 1; }
      });
      var extraP = Object.keys(needSubj).map(function (sj) {
        return loadTextSubj(sj).then(function (rows) { return rows || []; }).catch(function () { return []; });
      });
      return Promise.all(extraP).then(function (ex) {
        ex.forEach(function (rows) { if (rows.length) { addRows(rows); kwBump(rows); } });

        var jobs = files.map(function (src) {
          var rows = bySrc[src] || [];
          var cand = {};
          Object.keys(kbPages[src] || {}).forEach(function (p) { cand[p] = kbPages[src][p]; });
          var fobj = fileOf(src) || {};
          var hs = rows.length ? (searchIn(rows, qAll) || []).slice(0, 10) : [];
          hs.forEach(function (h) {
            var rr = rows[h.i]; if (!rr) return;
            var lp = localPage(fobj, rr.p);
            cand[lp] = Math.max(cand[lp] || 0, Math.max(0.05, (h.score || 0) * 0.4));
          });
          var pages = Object.keys(cand).map(function (p) {
            var page = +p, row = null;
            for (var i = 0; i < rows.length; i++) { if (localPage(fobj, rows[i].p) === page) { row = rows[i]; break; } }
            return { src: src, p: page, k: cand[p], t: row && row.t };
          }).sort(function (a, b) { return b.k - a.k; }).slice(0, 10);

          function fallback() {
            return pages.slice(0, 3).map(function (x) { return { src: x.src, p: x.p, score: Math.min(0.99, x.k) }; });
          }
          var withT = pages.filter(function (x) { return x.t && x.p > 0; });
          if (withT.length >= 2) {
            return withTimeout(rankPages(withT, qAll), 11000).then(function (rk) {
              var got = (rk || []).slice(0, 3);
              return got.length ? got : fallback();
            }).catch(fallback);
          }
          return Promise.resolve(fallback());
        });

        return Promise.all(jobs).then(function (all) {
          var out = [];
          all.forEach(function (arr) { (arr || []).forEach(function (x) { if (x && x.p > 0) out.push(x); }); });
          out.forEach(function (x) {
            if (!x.t) x.t = pageText(bySrc[x.src] || [], x.src, x.p);
            if (isQPage(x.t)) { x.score = (x.score || 0) * Q_PENALTY; x.isq = 1; }
          });
          out.sort(function (a, b) { return b.score - a.score; });
          if (plan) out = diffRerank(out, plan);
          return out;
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
          '<div><b>第 ' + localPage(f, c.p) + ' 页</b></div>' +
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

  function close() { unzoom(); if (el.mask) el.mask.classList.remove('on'); if (el.sheet) el.sheet.classList.remove('on'); }

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

  window.LECTURE = { open: open, close: close, load: loadIndex, locate: locate, search: function (q) { return TXT ? searchIn(TXT, q) : []; }, text: loadText, textSubj: loadTextSubj,
    bind: putBind, unbind: delBind, bound: getBind, binds: function () { return bindAll(); },
    openHit: openHit,
    find: function (q) { if (el.find) el.find.value = q || ''; doFind(); }, state: function () { return { src: CUR.src, p: CUR.p, files: (FILES || []).length }; },
    files: function () { return FILES; }, pageKey: keyFor,
    diff: { on: diffOn, set: diffSet, plan: diffPlan, rerank: diffRerank, text: pageText },
  };
})();
