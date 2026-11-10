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
          var g = map[o.src] || (map[o.src] = { src: o.src, f: o.f, n: o.n || 0, pages: {} });
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
      '<div class="lec-body" id="lecBody"><img id="lecImg" alt="讲义原页"><div id="lecEmpty" class="lec-empty">这份讲义还没有页图，点右下角「看整本 PDF」。</div></div>' +
      '<div class="lec-foot">' +
        '<button class="btn" data-lec="zoom">⤢ 放大看</button>' +
        '<button class="btn" data-lec="pdf">📄 看整本 PDF</button>' +
      '</div>';
    var zoom = ce('div', 'lec-zoom'); zoom.id = 'lecZoom'; zoom.innerHTML = '<img alt="讲义原页（放大）"><button data-lec="unzoom">×</button>';
    document.body.appendChild(mask); document.body.appendChild(sheet); document.body.appendChild(zoom);
    el = { mask: mask, sheet: sheet, meta: $('#lecMeta'), sel: $('#lecFile'), page: $('#lecPage'), total: $('#lecTotal'), img: $('#lecImg'), empty: $('#lecEmpty'), zoom: zoom };

    mask.addEventListener('click', close);
    sheet.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-lec]'); if (!b) return;
      var a = b.getAttribute('data-lec');
      if (a === 'close') return close();
      if (a === 'prev') return go(CUR.p - 1);
      if (a === 'next') return go(CUR.p + 1);
      if (a === 'zoom') return doZoom();
      if (a === 'unzoom') return unzoom();
      if (a === 'pdf') return openPdf();
    });
    zoom.addEventListener('click', function (ev) { if (ev.target.closest('[data-lec="unzoom"]') || ev.target === zoom) unzoom(); });
    el.sel.addEventListener('change', function () { CUR.src = el.sel.value; CUR.p = 1; paint(); remember(); });
    el.page.addEventListener('change', function () { go(parseInt(el.page.value, 10) || 1); });
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

  function open() {
    build();
    if (!el.sheet) return;
    el.mask.classList.add('on'); el.sheet.classList.add('on');
    if (!FILES) {
      if (el.meta) el.meta.textContent = '正在读讲义目录…';
      loadIndex().then(function () { restore(); fillSelect(); paint(); })
        .catch(function (e) { if (el.meta) el.meta.textContent = '讲义目录没读出来：' + e; });
      return;
    }
    if (!CUR.src) restore();
    fillSelect(); paint();
  }

  function close() { unzoom(); if (el.mask) el.mask.classList.remove('on'); if (el.sheet) el.sheet.classList.remove('on'); }

  /* 答题页的「📖 讲义」按钮：委托点击，不依赖 app.js 重新绑 */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#doLec');
    if (!b) return;
    ev.preventDefault();
    open();
  }, true);

  window.LECTURE = { open: open, close: close, load: loadIndex, state: function () { return { src: CUR.src, p: CUR.p, files: (FILES || []).length }; },
    files: function () { return FILES; }, pageKey: function (src, p) { var f = fileOf(src); return f && f.pages[p]; } };
})();
