/* ===== 相似题脑图（map.js，web317）=====
   从答题页「🗺 脑图」打开：把当前题、同题库里最像的几道题、以及它的考点摊成一张图。
   纯前端本地计算（2-gram TF-IDF 余弦 + 考点重合），不联网、不调用 AI。
   点图上的题 → 直接跳到那道题（QZ.cur + render），并以它为中心重画。

   依赖（都在同一页、经典脚本的全局）：QZ、bankById、render、toast
   存储：qbank.mapwin.v1（窗口位置尺寸） */
(function () {
  if (window.MAPQ) return;

  var WIN_KEY = 'qbank.mapwin.v1';
  var S = { on: false, min: false, x: null, y: null, w: null, h: null, bankId: '', qid: '' };
  var V = { tx: 0, ty: 0, k: 1 };
  var DATA = { nodes: [], edges: [] };
  var sel = null;
  var root = null;

  /* ---------- 小工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function readLS(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s，。、；：？！“”‘’（）()【】\[\]<>《》,.;:!?"'`~@#$%^&*_+=|\\\/-]+/g, ''); }
  function grams(s) {
    var out = Object.create(null), n = s.length;
    for (var i = 0; i < n - 1; i++) out[s.substr(i, 2)] = (out[s.substr(i, 2)] || 0) + 1;
    if (n === 1) out[s] = 1;
    return out;
  }
  function qText(q) { return [q.stem || '', (q.options || []).join(' '), q.explain || ''].join(' '); }
  function tagList(q, bankId) {
    var all = readLS('qbank.tags.v1', {}) || {};
    var t = all[bankId + '#' + q.id];
    if (Array.isArray(t) && t.length) return t;
    return Array.isArray(q.tags) ? q.tags : [];
  }

  /* ---------- 数据：以某题为圆心算相似 ---------- */
  function build(bank, q) {
    var pool = (bank.questions || []).filter(function (x) { return x && x.stem; });
    var curG = grams(norm(qText(q))), curTags = tagList(q, bank.id);
    var df = Object.create(null), n = pool.length, vecs = [], i;
    for (i = 0; i < n; i++) {
      var v = grams(norm(qText(pool[i])));
      vecs.push(v);
      for (var k in v) df[k] = (df[k] || 0) + 1;
    }
    var idf = Object.create(null);
    for (var kk in df) idf[kk] = Math.log(1 + n / df[kk]);
    function cos(a, b) {
      var dot = 0, na = 0, nb = 0, key;
      for (key in a) { na += (a[key] * idf[key]) * (a[key] * idf[key]); }
      for (key in b) { nb += (b[key] * idf[key]) * (b[key] * idf[key]); }
      for (key in a) { if (b[key]) dot += (a[key] * idf[key]) * (b[key] * idf[key]); }
      return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
    }
    function jac(a, b) {
      if (!a.length || !b.length) return 0;
      var s1 = a.map(norm), s2 = b.map(norm), inter = 0;
      s1.forEach(function (x) { if (s2.indexOf(x) >= 0) inter++; });
      return inter / (s1.length + s2.length - inter);
    }

    var cand = [];
    for (i = 0; i < n; i++) {
      if (String(pool[i].id) === String(q.id)) continue;
      var sim = cos(curG, vecs[i]);
      var tj = jac(curTags, tagList(pool[i], bank.id));
      var sc = sim + 0.35 * tj;
      if (sc > 0.02) cand.push({ q: pool[i], sim: sim, score: sc });
    }
    cand.sort(function (a, b) { return b.score - a.score; });
    cand = cand.slice(0, 6);
    var mx = cand.length ? cand[0].score : 1;

    var nodes = [{ id: 'c', type: 'center', ref: q, x: 0, y: 0, label: q.stem }];
    var edges = [];
    cand.forEach(function (it, idx) {
      var rel = mx > 0 ? it.score / mx : 0;
      var id = 's' + idx;
      nodes.push({ id: id, type: 'sim', ref: it.q, label: it.q.stem, score: Math.round(36 + rel * 60) });
      edges.push({ a: 'c', b: id, kind: 'sim', w: rel });
    });
    curTags.slice(0, 4).forEach(function (t, idx) {
      var id = 't' + idx;
      nodes.push({ id: id, type: 'tag', ref: t, label: t, x: 0, y: 0 });
      edges.push({ a: 'c', b: id, kind: 'tag', w: 0.5 });
    });

    /* 放射布局：题在左右两侧，考点在上下 */
    var sims = nodes.filter(function (x) { return x.type === 'sim'; });
    var tags = nodes.filter(function (x) { return x.type === 'tag'; });
    var R = 340;
    sims.forEach(function (nd, i) {
      var a = (i / Math.max(1, sims.length)) * Math.PI * 2 + (Math.PI / 2);
      nd.x = Math.cos(a) * R;
      nd.y = Math.sin(a) * R * 0.80;
    });
    tags.forEach(function (nd, i) {
      var span = 0.86;
      var a = -Math.PI / 2 + (i - (tags.length - 1) / 2) * span;
      nd.x = Math.cos(a) * (R * 0.86);
      nd.y = Math.sin(a) * (R * 0.86) - 90;
    });
    return { nodes: nodes, edges: edges };
  }

  /* ---------- 外壳 ---------- */
  function ensure() {
    if (root) return root;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="mpWrap" hidden>' +
        '<div id="mpBar"><i class="mp-grip">⠿</i><b id="mpTitle">相似题脑图</b><span class="mp-grow"></span>' +
          '<button id="mpMin" title="收成小条">—</button><button id="mpX" title="关掉">✕</button></div>' +
        '<div id="mpStage"><svg id="mpEdges"><g id="mpEdgeG"></g></svg><div id="mpNodes"></div></div>' +
        '<i id="mpRz" title="拖动改大小"></i>' +
      '</div>' +
      '<div id="mpChip" hidden>🗺 相似题脑图</div>');
    root = $('#mpWrap');
    bindShell();
    return root;
  }

  function bindShell() {
    var bar = $('#mpBar'), wrap = $('#mpWrap'), rz = $('#mpRz'), stage = $('#mpStage');
    var d = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      d = { x: e.clientX, y: e.clientY, ox: S.x, oy: S.y };
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    bar.addEventListener('pointermove', function (e) {
      if (!d) return;
      S.x = d.ox + e.clientX - d.x; S.y = d.oy + e.clientY - d.y;
      apply();
    });
    bar.addEventListener('pointerup', function () { if (d) { d = null; save(); } });
    rz.addEventListener('pointerdown', function (e) {
      d = { x: e.clientX, y: e.clientY, ow: S.w, oh: S.h, mode: 'rz' };
      try { rz.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    rz.addEventListener('pointermove', function (e) {
      if (!d || d.mode !== 'rz') return;
      S.w = Math.max(560, d.ow + e.clientX - d.x);
      S.h = Math.max(380, d.oh + e.clientY - d.y);
      apply();
    });
    rz.addEventListener('pointerup', function () { if (d) { d = null; save(); fit(); } });

    $('#mpX').onclick = function () { close(); };
    $('#mpMin').onclick = function () { S.min = true; apply(); };
    $('#mpChip').onclick = function () { S.min = false; apply(); setTimeout(fit, 60); };

    /* 画布：拖空白平移 + 滚轮缩放 */
    var pg = null;
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.mp-node')) return;
      pg = { x: e.clientX, y: e.clientY, tx: V.tx, ty: V.ty };
      stage.style.cursor = 'grabbing';
    });
    window.addEventListener('pointermove', function (e) {
      if (!pg) return;
      V.tx = pg.tx + e.clientX - pg.x;
      V.ty = pg.ty + e.clientY - pg.y;
      paintView();
    });
    window.addEventListener('pointerup', function () { if (pg) { pg = null; stage.style.cursor = ''; } });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom(e.clientX, e.clientY, f);
    }, { passive: false });
  }

  function stageRect() { var st = $('#mpStage'); return st ? st.getBoundingClientRect() : { left: 0, top: 0, width: 900, height: 600 }; }
  function zoom(cx, cy, f) {
    var r = stageRect();
    var k2 = Math.max(0.5, Math.min(1.8, V.k * f));
    var px = cx - r.left, py = cy - r.top;
    V.tx = px - (px - V.tx) * (k2 / V.k);
    V.ty = py - (py - V.ty) * (k2 / V.k);
    V.k = k2;
    paintView();
  }
  function paintView() {
    var stage = $('#mpStage'); if (!stage) return;
    stage.style.setProperty('--k', V.k);
    var nodesEl = $('#mpNodes'), svg = $('#mpEdges');
    var tf = 'translate(' + V.tx + 'px,' + V.ty + 'px) scale(' + V.k + ')';
    nodesEl.style.transform = tf;
    var g = $('#mpEdgeG');
    /* SVG 的 transform 属性不认 px 单位，得用纯数字，否则整层不移动（线全跑左上角） */
    if (g) g.setAttribute('transform', 'translate(' + V.tx + ',' + V.ty + ') scale(' + V.k + ')');
  }

  function apply() {
    var wrap = $('#mpWrap'), bar = $('#mpBar'), rz = $('#mpRz'), chip = $('#mpChip');
    if (!S.on) { wrap.hidden = true; chip.hidden = true; return; }
    if (S.w == null) {
      S.w = Math.min(1080, Math.round(innerWidth * 0.62));
      S.h = Math.min(820, Math.round(innerHeight * 0.82));
      S.x = innerWidth - S.w - 28;
      S.y = 104;
    }
    S.w = Math.max(560, Math.min(innerWidth - 24, S.w));
    S.h = Math.max(380, Math.min(innerHeight - 120, S.h));
    S.x = Math.max(8, Math.min(innerWidth - S.w - 8, S.x));
    S.y = Math.max(96, Math.min(innerHeight - S.h - 8, S.y));
    wrap.hidden = false;
    wrap.style.left = S.x + 'px'; wrap.style.top = S.y + 'px';
    wrap.style.width = S.w + 'px'; wrap.style.height = S.h + 'px';
    bar.style.left = S.x + 'px'; bar.style.top = (S.y - 38) + 'px'; bar.style.width = S.w + 'px';
    rz.style.left = (S.x + S.w - 18) + 'px'; rz.style.top = (S.y + S.h - 18) + 'px';
    wrap.style.display = S.min ? 'none' : '';
    bar.style.display = S.min ? 'none' : '';
    rz.style.display = S.min ? 'none' : '';
    chip.hidden = !S.min;
  }
  function save() { writeLS(WIN_KEY, { x: S.x, y: S.y, w: S.w, h: S.h }); }

  /* ---------- 渲染 ---------- */
  function render() {
    var nodesEl = $('#mpNodes'), g = $('#mpEdgeG');
    if (!nodesEl) return;
    var pos = {};
    DATA.nodes.forEach(function (n) { pos[n.id] = n; });
    /* 端点按卡片半径缩一点（卡片大约 210×70），线就不会被卡片盖住 */
    function cut(n, ox, oy, hw, hh) {
      var dx = ox - n.x, dy = oy - n.y, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len;
      var ex = hw / Math.max(0.2, Math.abs(ux)), ey = hh / Math.max(0.2, Math.abs(uy));
      var t2 = Math.min(ex, ey);
      return { x: n.x + ux * t2, y: n.y + uy * t2 };
    }
    var paths = DATA.edges.map(function (e) {
      var a = pos[e.a], b = pos[e.b];
      if (!a || !b) return '';
      var A = cut(a, b.x, b.y, a.type === 'center' ? 120 : 108, a.type === 'tag' ? 22 : 44);
      var B = cut(b, a.x, a.y, b.type === 'center' ? 120 : 108, b.type === 'tag' ? 22 : 44);
      var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - Math.abs(B.x - A.x) * 0.06;
      var d = 'M' + A.x.toFixed(1) + ',' + A.y.toFixed(1) + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + B.x.toFixed(1) + ',' + B.y.toFixed(1);
      return '<path d="' + d + '" class="mp-e ' + e.kind + '" stroke-width="' + (1.2 + (e.w || 0) * 1.8).toFixed(1) + '"/>';
    }).join('');
    g.innerHTML = paths;

    nodesEl.innerHTML = DATA.nodes.map(function (n) {
      var cls = 'mp-node ' + n.type + (sel === n.id ? ' sel' : '');
      var head = n.type === 'center' ? '中心题' : n.type === 'sim' ? '相似题' : '考点';
      var pill = n.type === 'sim' ? '<span class="mp-pill">相似 ' + n.score + '%</span>'
        : n.type === 'tag' ? '' : '<span class="mp-pill c">当前</span>';
      var text = n.type === 'tag' ? esc(n.label) : esc(String(n.label || '').slice(0, 52));
      return '<div class="' + cls + '" data-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px">' +
        '<i class="mp-k">' + head + '</i><div class="mp-t">' + text + '</div>' + pill + '</div>';
    }).join('');

    nodesEl.querySelectorAll('.mp-node').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var n = DATA.nodes.find(function (x) { return x.id === el.dataset.id; });
        if (!n) return;
        if (n.type === 'sim') {
          if (typeof QZ !== 'undefined') { QZ.cur = n.ref.id; }
          /* 注意：这里的 render 是本模块自己的，应用题的做法是 window.render */
          try { (window.render || render)(); } catch (err) {}
          setTimeout(function () { open(); }, 60);   /* 以新题为圆心重画 */
        } else {
          sel = n.id;
          nodesEl.querySelectorAll('.mp-node').forEach(function (x) { x.classList.toggle('sel', x.dataset.id === n.id); });
        }
      });
    });

    var qb = DATA.nodes.filter(function (n) { return n.type === 'center'; })[0];
    $('#mpTitle').textContent = '相似题脑图 · ' + String((qb && qb.label) || '').slice(0, 26);
    fit();
  }

  function fit() {
    if (!S.on || S.min) return;
    var r = stageRect();
    var xs = DATA.nodes.map(function (n) { return n.x; }), ys = DATA.nodes.map(function (n) { return n.y; });
    if (!xs.length) return;
    var minX = Math.min.apply(null, xs) - 110, maxX = Math.max.apply(null, xs) + 110;
    var minY = Math.min.apply(null, ys) - 86, maxY = Math.max.apply(null, ys) + 86;
    var k = Math.min(1.25, Math.max(0.6, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    V.k = k;
    V.tx = r.width / 2 - ((minX + maxX) / 2) * k;
    V.ty = r.height / 2 - ((minY + maxY) / 2) * k;
    paintView();
  }

  /* ---------- 对外 ---------- */
  function open() {
    var bank = null, q = null;
    try {
      bank = bankById(QZ.bankId);
      var pool = (bank && bank.questions) || [];
      q = pool.filter(function (x) { return String(x.id) === String(QZ.cur); })[0] || pool[0];
    } catch (e) {}
    if (!bank || !q) { if (typeof toast === 'function') toast('这一页没有题目，先打开一个题库再点脑图', 2000, 'warn'); return; }
    S.on = true; S.min = false; S.bankId = bank.id; S.qid = q.id;
    var old = readLS(WIN_KEY, null);
    if (old && old.w) { S.x = old.x; S.y = old.y; S.w = old.w; S.h = old.h; }
    DATA = build(bank, q);
    sel = null;
    ensure();
    apply();
    render();
    setTimeout(fit, 80);
  }

  function close() { S.on = false; S.min = false; apply(); }
  function toggle() { if (S.on && !S.min) close(); else open(); }

  window.MAPQ = { open: open, close: close, toggle: toggle, state: function () { return { on: S.on, min: S.min, n: DATA.nodes.length }; } };
})();
