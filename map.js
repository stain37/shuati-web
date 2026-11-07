/* ===== 相似题脑图（map.js，web320）=====
   从答题页「🗺 脑图」打开：把当前题、同题库里最像的几道题、以及它的考点摊成一张图。
   纯前端本地计算（2-gram TF-IDF 余弦 + 考点重合），不联网、不调用 AI。
   点图上的题 → 直接跳到那道题（QZ.cur + render），并以它为中心重画。

   web319（2026-11-08）第一批补齐：
     · 5 种布局（放射 / 环形 / 树形 / 分栏 / 力导向），顶栏可切换、按设备记住
     · 窗口：双击标题栏最大化、拖到左右边缘吸附半屏（带虚线预览）、Esc 逐层退
     · 聚焦辉光：选中节点后按距离线性变淡、与它相连的线发亮
   依赖（都在同一页、经典脚本的全局）：QZ、bankById、render、toast
   存储：qbank.mapwin.v1（窗口位置尺寸）、qbank.maplayout.v1（布局偏好） */
(function () {
  if (window.MAPQ) return;

  var WIN_KEY = 'qbank.mapwin.v1';
  var LAY_KEY = 'qbank.maplayout.v1';
  var LAYOUTS = [
    { k: 'radial', n: '放射' },
    { k: 'ring', n: '环形' },
    { k: 'tree', n: '树形' },
    { k: 'columns', n: '分栏' },
    { k: 'force', n: '力导向' }
  ];
  var S = { on: false, min: false, x: null, y: null, w: null, h: null, bankId: '', qid: '' };
  var V = { tx: 0, ty: 0, k: 1 };
  var DATA = { nodes: [], edges: [] };
  var LAY = { name: 'radial' };
  var MAXP = null;
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
    curTags.filter(function (x) { return !isBigTag(x); }).slice(0, 4).forEach(function (t, idx) {
      var id = 't' + idx;
      nodes.push({ id: id, type: 'tag', ref: t, label: t, x: 0, y: 0 });
      edges.push({ a: 'c', b: id, kind: 'tag', w: 0.5 });
    });
    return { nodes: nodes, edges: edges };
  }

  /* ---------- 布局 ---------- */
  function layoutPositions(name) {
    var ns = DATA.nodes;
    var c = ns.filter(function (n) { return n.type === 'center'; })[0];
    var sims = ns.filter(function (n) { return n.type === 'sim'; });
    var tags = ns.filter(function (n) { return n.type === 'tag'; });
    var out = {};
    if (c) out[c.id] = { x: 0, y: 0 };
    var R = 340;

    if (name === 'ring') {
      var all = sims.concat(tags);
      all.forEach(function (n, i) {
        var a = -Math.PI / 2 + i * Math.PI * 2 / Math.max(1, all.length);
        out[n.id] = { x: Math.cos(a) * R, y: Math.sin(a) * R };
      });
    } else if (name === 'tree') {
      sims.forEach(function (n, i) {
        var side = (i % 2) ? 1 : -1;
        var row = Math.floor(i / 2);
        out[n.id] = { x: side * 380, y: -60 + row * 150 };
      });
      tags.forEach(function (n, i) {
        out[n.id] = { x: (i - (tags.length - 1) / 2) * 190, y: -330 };
      });
    } else if (name === 'columns') {
      sims.forEach(function (n, i) { out[n.id] = { x: -400, y: (i - (sims.length - 1) / 2) * 132 }; });
      tags.forEach(function (n, i) { out[n.id] = { x: 400, y: (i - (tags.length - 1) / 2) * 132 }; });
    } else if (name === 'force') {
      var arr = sims.concat(tags);
      arr.forEach(function (n, i) {
        var a = (i / Math.max(1, arr.length)) * Math.PI * 2;
        out[n.id] = { x: Math.cos(a) * (R + i * 12), y: Math.sin(a) * (R + i * 12) };
      });
      /* 简单斥力迭代（一次性算，不做动画） */
      for (var it = 0; it < 140; it++) {
        arr.forEach(function (a) {
          var pa = out[a.id], fx = 0, fy = 0;
          arr.forEach(function (b) {
            if (a === b) return;
            var pb = out[b.id];
            var dx = pa.x - pb.x, dy = pa.y - pb.y;
            var d2 = Math.max(4000, dx * dx + dy * dy);
            var f = 260000 / d2;
            var d = Math.sqrt(d2);
            fx += dx / d * f; fy += dy / d * f;
          });
          /* 拉回圆环，避免飞散 */
          var r0 = Math.hypot(pa.x, pa.y) || 1;
          fx += (R - r0) * pa.x / r0 * 0.16;
          fy += (R - r0) * pa.y / r0 * 0.16;
          pa.x += fx; pa.y += fy;
        });
      }
      tags.forEach(function (n) { if (out[n.id]) out[n.id].y -= 40; });
    } else {
      sims.forEach(function (nd, i) {
        var a = (i / Math.max(1, sims.length)) * Math.PI * 2 + (Math.PI / 2);
        out[nd.id] = { x: Math.cos(a) * R, y: Math.sin(a) * R * 0.80 };
      });
      tags.forEach(function (nd, i) {
        var span = 0.86;
        var a = -Math.PI / 2 + (i - (tags.length - 1) / 2) * span;
        out[nd.id] = { x: Math.cos(a) * (R * 0.86), y: Math.sin(a) * (R * 0.86) - 90 };
      });
    }
    return out;
  }

  function applyLayout(name) {
    if (name && LAYOUTS.some(function (l) { return l.k === name; })) LAY.name = name;
    var pos = layoutPositions(LAY.name);
    DATA.nodes.forEach(function (n) { var p = pos[n.id]; if (p) { n.x = p.x; n.y = p.y; } });
    writeLS(LAY_KEY, LAY.name);
    var s = $('#mpLayout');
    if (s) s.value = LAY.name;
    render();
  }

  /* ---------- 外壳 ---------- */
  function ensure() {
    if (root) return root;
    var opts = LAYOUTS.map(function (l) { return '<option value="' + l.k + '">' + l.n + '</option>'; }).join('');
    document.body.insertAdjacentHTML('beforeend',
      '<div id="mpWrap" hidden>' +
        '<div id="mpBar"><i class="mp-grip">⠿</i><b id="mpTitle">相似题脑图</b><span class="mp-grow"></span>' +
          '<button id="mpBack" title="返回（Esc）" hidden>←</button>' +
          '<select id="mpLayout" title="换一种排法">' + opts + '</select>' +
          '<button id="mpGroups" title="知识组">组</button>' +
          '<button id="mpMax" title="最大化 / 还原（也可双击标题栏）">⤢</button>' +
          '<button id="mpMin" title="收成小条">—</button><button id="mpX" title="关掉">✕</button></div>' +
        '<div id="mpGrp">' +
          '<div class="mp-ghead"><input id="mpGQ" placeholder="搜组名 / 组里的题…" autocomplete="off">' +
            '<button id="mpGNew" title="以当前题新建一组">＋</button>' +
            '<button id="mpGAi" class="prim" title="一键 AI 分组">✨</button></div>' +
          '<div id="mpGList"></div>' +
          '<div id="mpGFoot"></div>' +
        '</div>' +
        '<div id="mpStage"><svg id="mpEdges"><g id="mpEdgeG"></g></svg><div id="mpNodes"></div></div>' +
        '<i id="mpRz" title="拖动改大小"></i>' +
      '</div>' +
      '<div id="mpSnap" hidden></div>' +
      '<div id="mpChip" hidden>🗺 相似题脑图</div>');
    document.body.insertAdjacentHTML('beforeend',
      '<div id="mpGMenu"></div>' +
      '<div id="mpAg"><div class="mp-agbox">' +
        '<div class="mp-aghd">✨ 一键 AI 分组<button id="mpAgX" title="关掉">✕</button></div>' +
        '<div class="mp-agbd">' +
          '<label>怎么分</label>' +
          '<select id="mpAgMode"><option value="tag">按知识点（每个考点一组）</option>' +
            '<option value="sim">按题干相似度（同题干的归一组）</option></select>' +
          '<label style="margin-top:10px">有特别要求就写在这儿（可留空）</label>' +
          '<textarea id="mpAgReq" style="height:64px;min-height:64px;max-height:64px" rows="3" placeholder="例如「按系统分，每组 3~5 题」「先分内科/外科，再按考点」"></textarea>' +
          '<div class="mp-agprev" id="mpAgPrev">点「开始分组」→ 先出方案，确认了才建组。</div>' +
        '</div>' +
        '<div class="mp-agft"><button id="mpAgCancel">取消</button><button id="mpAgGo" class="prim">开始分组</button>' +
          '<button id="mpAgOk" class="prim" hidden>就这样建组</button></div>' +
      '</div></div>');
    root = $('#mpWrap');
    var bk = $('#mpBack');
    if (bk) bk.onclick = function () { back(); };
    function syncBack() {
      var kp = document.getElementById('mpKp'), gp = $('#mpGrp'), b = $('#mpBack');
      if (!b) return;
      var show = !!(sel || (kp && (kp.classList.contains('show') || kp.classList.contains('full'))) || (gp && gp.classList.contains('show')));
      b.hidden = !show;
    }
    if (!window.__mpBackT) {
      window.__mpBackT = setInterval(function () {
        try { syncBack(); } catch (e) {}
      }, 400);
    }
    bindShell();
    try { bindNodeDrag(); bindCtx(); bindLinkClick(); bindPick(); } catch (e) {}
    try { filesEnsure(); } catch (e) {}
    try { applyFil(); } catch (e) {}
    gBind();
    agBind();
    return root;
  }

  /* 半屏吸附的落点矩形 */
  function halfRect(side) {
    var half = Math.round((innerWidth - 24) / 2);
    return { x: side === 'left' ? 8 : innerWidth - half - 8, y: 96, w: half, h: innerHeight - 104 };
  }
  function sideAt(x) { return x <= 34 ? 'left' : (x >= innerWidth - 34 ? 'right' : null); }
  function snapPrevShow(x) {
    var el = $('#mpSnap'); if (!el) return;
    var side = sideAt(x);
    if (!side) { el.hidden = true; return; }
    var r = halfRect(side);
    el.hidden = false;
    el.style.left = r.x + 'px'; el.style.top = (r.y - 38) + 'px';
    el.style.width = r.w + 'px'; el.style.height = (r.h + 38) + 'px';
    el.setAttribute('data-tip', side === 'left' ? '松手铺满左半边' : '松手铺满右半边');
  }

  function isMax() { return !!MAXP && S.w >= innerWidth - 40; }
  function setMax(on) {
    if (on) {
      if (isMax()) return;
      MAXP = { x: S.x, y: S.y, w: S.w, h: S.h };
      S.x = 8; S.y = 104; S.w = innerWidth - 16; S.h = innerHeight - 112;
    } else {
      if (!MAXP) return;
      S.x = MAXP.x; S.y = MAXP.y; S.w = MAXP.w; S.h = MAXP.h;
      MAXP = null;
    }
    apply(); save(); setTimeout(fit, 60);
  }

  function bindShell() {
    var bar = $('#mpBar'), wrap = $('#mpWrap'), rz = $('#mpRz'), stage = $('#mpStage');
    var d = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,select,input,label,textarea')) return;
      d = { x: e.clientX, y: e.clientY, ox: S.x, oy: S.y, moved: false };
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    bar.addEventListener('pointermove', function (e) {
      if (!d) return;
      if (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3) d.moved = true;
      S.x = d.ox + e.clientX - d.x; S.y = d.oy + e.clientY - d.y;
      apply();
      snapPrevShow(e.clientX);
    });
    bar.addEventListener('pointerup', function (e) {
      if (!d) return;
      var moved = d.moved; d = null;
      var sp = $('#mpSnap'); if (sp) sp.hidden = true;
      var side = moved ? sideAt(e.clientX) : null;
      if (side) {
        var r = halfRect(side);
        MAXP = null; S.x = r.x; S.y = r.y; S.w = r.w; S.h = r.h;
        apply(); save(); setTimeout(fit, 60);
      } else { save(); }
    });
    bar.addEventListener('dblclick', function (e) {
      if (e.target.closest('button,select,input,label,textarea')) return;
      setMax(!isMax());
    });

    rz.addEventListener('pointerdown', function (e) {
      d = { x: e.clientX, y: e.clientY, ow: S.w, oh: S.h, mode: 'rz' };
      try { rz.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    rz.addEventListener('pointermove', function (e) {
      if (!d || d.mode !== 'rz') return;
      S.w = Math.max(560, d.ow + e.clientX - d.x);
      S.h = Math.max(380, d.oh + e.clientY - d.y);
      MAXP = null;
      apply();
    });
    rz.addEventListener('pointerup', function () { if (d) { d = null; save(); fit(); } });

    $('#mpX').onclick = function () { close(); };
    $('#mpMin').onclick = function () { S.min = true; apply(); };
    $('#mpMax').onclick = function () { setMax(!isMax()); };
    $('#mpChip').onclick = function () { S.min = false; apply(); setTimeout(fit, 60); };
    $('#mpLayout').onchange = function () { applyLayout(this.value); setTimeout(fit, 40); };

    /* Esc：先退最大化，再取消选中，最后关窗口。
       挂在 window 的捕获阶段并 stopPropagation —— 否则事件会继续传给 app.js 的
       全局 Esc（退回上一路由，会把 hash 清掉、整页跳回首页）。 */
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !S.on) return;
      e.preventDefault(); e.stopPropagation();
      var sd = document.getElementById('mpSide');
      if (sd && sd.classList.contains('show')) { sideClose(); return; }
      var kp = document.getElementById('mpKp');
      if (kp && kp.classList.contains('full')) { kpFull(false); return; }
      if (isMax()) { setMax(false); return; }
      if (sel) { sel = null; render(); return; }
      close();
    }, true);

    /* 画布：拖空白平移 + 滚轮缩放 */
    var pg = null;
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.mp-node')) return;
      /* 点画布空白：把右侧知识点面板收起来（和样板一样） */
      var kp0 = document.getElementById('mpKp');
      if (kp0 && kp0.classList.contains('show')) { try { kpClose(); } catch (err) {} }
      try { sideClose(); } catch (err) {}
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
    if (!S.on) { wrap.hidden = true; chip.hidden = true; var sp0 = $('#mpSnap'); if (sp0) sp0.hidden = true; return; }
    if (S.w != null && !MAXP && S.w >= innerWidth - 40) { S.w = null; }
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

  /* 只重画连线（拖节点 / 改位置时用，不重渲染节点） */
  function drawEdges() {
    var g = $('#mpEdgeG'); if (!g) return;
    var nodesEl = $('#mpNodes'); if (!nodesEl) return;
    var pos = {}, fid = sel;
    DATA.nodes.forEach(function (n) { pos[n.id] = n; });
    /* 连线：量每张卡片的真实宽高，把端点正好落在边框上（不再猜尺寸） */
    var boxOf = {};
    nodesEl.querySelectorAll('.mp-node').forEach(function (el) {
      boxOf[el.dataset.id] = { w: el.offsetWidth || 200, h: el.offsetHeight || 64 };
    });
    function cut(n, ox, oy) {
      var b = boxOf[n.id] || { w: 200, h: 64 };
      var dx = ox - n.x, dy = oy - n.y, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len;
      var ex = (b.w / 2) / Math.max(0.2, Math.abs(ux));
      var ey = (b.h / 2) / Math.max(0.2, Math.abs(uy));
      var t2 = Math.min(ex, ey);
      return { x: n.x + ux * t2, y: n.y + uy * t2 };
    }
    var paths = DATA.edges.map(function (e) {
      var a = pos[e.a], b = pos[e.b];
      if (!a || !b) return '';
      var A = cut(a, b.x, b.y), B = cut(b, a.x, a.y);
      var hot = fid && (e.a === fid || e.b === fid);
      var w = hot ? (2.2 + (e.w || 0) * 2.2) : (1.2 + (e.w || 0) * 1.8);
      var op = hot ? 1 : (fid ? 0.38 : 0.85);
      var d = 'M' + A.x.toFixed(1) + ',' + A.y.toFixed(1) + ' L' + B.x.toFixed(1) + ',' + B.y.toFixed(1);
      return '<path d="' + d + '" class="mp-e ' + e.kind + (hot ? ' hot' : '') + '" stroke-width="' + w.toFixed(1) + '" style="opacity:' + op + '"/>';
    }).join('');
    g.innerHTML = paths;
  }

  function render() {
    var nodesEl = $('#mpNodes'), g = $('#mpEdgeG');
    if (!nodesEl) return;
    var pos = {};
    DATA.nodes.forEach(function (n) { pos[n.id] = n; });
    /* 聚焦辉光：选中节点按距离线性变淡，相连的线发亮 */
    var fid = sel && pos[sel] ? sel : null;
    var maxD = 1;
    if (fid) {
      DATA.nodes.forEach(function (n) { maxD = Math.max(maxD, Math.hypot(n.x - pos[fid].x, n.y - pos[fid].y)); });
    }

    /* 与选中节点直接相连的邻居：也发一点弱光（线亮、块微光） */
    var nearIds = {};
    if (fid) DATA.edges.forEach(function (e) {
      if (e.a === fid) nearIds[e.b] = 1;
      else if (e.b === fid) nearIds[e.a] = 1;
    });

    nodesEl.innerHTML = DATA.nodes.map(function (n) {
      var cls = 'mp-node ' + n.type + (sel === n.id ? ' sel' : '') + (nearIds[n.id] ? ' near' : '') + (n.pinned ? ' pinned' : '');
      var head = n.type === 'center' ? '中心题' : n.type === 'sim' ? '相似题' : '考点';
      var pill = n.type === 'sim' ? '<span class="mp-pill">相似 ' + n.score + '%</span>'
        : n.type === 'tag' ? '' : '<span class="mp-pill c">当前</span>';
      var text = n.type === 'tag' ? esc(n.label) : esc(String(n.label || '').slice(0, 52));
      var op = 1;
      if (fid) {
        var d0 = Math.hypot(n.x - pos[fid].x, n.y - pos[fid].y);
        op = n.id === fid ? 1 : (0.70 + 0.30 * (1 - d0 / maxD));
      }
      return '<div class="' + cls + '" data-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px;opacity:' + op.toFixed(3) + '">' +
        '<i class="mp-k">' + head + '</i><div class="mp-t">' + text + '</div>' + pill + '</div>';
    }).join('');

    nodesEl.querySelectorAll('.mp-node').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var n = DATA.nodes.find(function (x) { return x.id === el.dataset.id; });
        if (!n) return;
        if (n.type === 'tag') {
          sel = (sel === n.id) ? null : n.id;
          render();
          if (sel) { try { kpOpen(n); } catch (err) {} } else { try { kpClose(); } catch (err) {} }
          return;
        }
        sel = n.id;
        render();
        try { sideOpen(n); } catch (err) {}
      });
      el.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        var n = DATA.nodes.find(function (x) { return x.id === el.dataset.id; });
        if (!n || n.type !== 'sim') return;
        if (typeof QZ !== 'undefined') { QZ.cur = n.ref.id; }
        /* 注意：这里的 render 是本模块自己的，应用题的做法是 window.render */
        try { (window.render || render)(); } catch (err) {}
        setTimeout(function () { recenter(n.ref); }, 60);
      });
    });

    drawEdges();

    try { paintExtra(nodesEl, pos); } catch (e) {}

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



  /* ================= 批4：小笔记 / 搜索 / 拖入 / 精搜（web321） ================= */
  var B4_KEY = 'qbank.maphole.v1';
  var HOLD = (function () { var v = parseFloat(localStorage.getItem(B4_KEY) || ''); return (v >= 0.4 && v <= 5) ? v : 1.2; })();
  var DZ = { tid: 0, hot: false, armed: false };
  var B4 = { on: false };

  function notesOf() {
    var g = gCur(); if (!g) return [];
    if (!Array.isArray(g.notes)) g.notes = [];
    return g.notes;
  }
  function mdIn(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>');
  }
  function md2h(src) {
    var out = [], list = null;
    String(src == null ? '' : src).split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (!t) { if (list) { out.push('</' + list + '>'); list = null; } return; }
      if (/^#{1,4}\s+/.test(t)) {
        if (list) { out.push('</' + list + '>'); list = null; }
        var n = (t.match(/^#+/) || ['#'])[0].length, h = Math.min(4, Math.max(3, n + 1));
        out.push('<h' + h + '>' + mdIn(t.replace(/^#+\s+/, '')) + '</h' + h + '>'); return;
      }
      if (/^---+$/.test(t)) { if (list) { out.push('</' + list + '>'); list = null; } out.push('<hr>'); return; }
      if (/^>\s?/.test(t)) {
        if (list) { out.push('</' + list + '>'); list = null; }
        out.push('<blockquote>' + mdIn(t.replace(/^>\s?/, '')) + '</blockquote>'); return;
      }
      var mo = t.match(/^(\d+)[.、]\s+(.*)$/), mu = t.match(/^[-*•]\s+(.*)$/);
      if (mo || mu) {
        var tag = mo ? 'ol' : 'ul';
        if (list !== tag) { if (list) out.push('</' + list + '>'); out.push('<' + tag + '>'); list = tag; }
        out.push('<li>' + mdIn(mo ? mo[2] : mu[1]) + '</li>'); return;
      }
      if (list) { out.push('</' + list + '>'); list = null; }
      out.push('<p>' + mdIn(t) + '</p>');
    });
    if (list) out.push('</' + list + '>');
    return out.join('');
  }

  /* 点题目卡：底部弹出题目抽屉（题干/选项/答案/解析 + 跳到这道题 / 分析考点） */
  function sideEnsure() {
    var s = document.getElementById('mpSide');
    if (s) return s;
    s = document.createElement('div');
    s.id = 'mpSide';
    s.innerHTML = '<div class="mp-sdh"><b id="mpSdName">题目</b><i id="mpSdKick"></i><span class="mp-grow"></span>' +
      '<button id="mpSdJump" class="mp-sdbtn">跳到这道题</button>' +
      '<button id="mpSdAi" class="mp-sdbtn">分析考点</button>' +
      '<button id="mpSdX" class="mp-sdico" title="关掉">✕</button></div>' +
      '<div id="mpSdBody" class="mp-sdbody"></div>';
    document.body.appendChild(s);
    s.querySelector('#mpSdX').onclick = sideClose;
    s.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    return s;
  }
  function sideClose() {
    var s = document.getElementById('mpSide'); if (s) s.classList.remove('show');
  }
  function answerLetter(q) {
    var a = q && (q.answer != null ? q.answer : q.ans);
    if (Array.isArray(a)) return a.map(function (x) { return String(x).toUpperCase(); }).join('');
    if (typeof a === 'number') return String.fromCharCode(65 + a);
    return String(a || '').toUpperCase();
  }
  function sideOpen(n) {
    var s = sideEnsure();
    var q = (n.ref && typeof n.ref === 'object') ? n.ref : {};
    var bankId = (n.ref && n.ref._bank) || (DATA.bank && (DATA.bank.id || DATA.bank.bid)) || '';
    function esc2(x) { return String(x == null ? '' : x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    var typeName = n.type === 'center' ? '中心题' : n.type === 'sim' ? '相似题' : '题目';
    var kick = n.type === 'sim' ? ('相似 ' + (n.score == null ? '?' : n.score) + '%') : (n.type === 'center' ? '当前这题' : '');
    s.querySelector('#mpSdName').textContent = typeName;
    s.querySelector('#mpSdKick').textContent = kick;
    var alpha = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    var ans = answerLetter(q);
    var opts = Array.isArray(q.opts) ? q.opts : (Array.isArray(q.options) ? q.options : []);
    var html = '<div class="mp-sdq">' + esc2(q.stem || n.label || '') + '</div>';
    if (opts.length) {
      html += '<div class="mp-sdopts">' + opts.map(function (o, i) {
        var L = alpha[i] || String(i + 1);
        var ok = ans.indexOf(L) >= 0;
        return '<div class="mp-sdo' + (ok ? ' ok' : '') + '"><b>' + L + '</b>' + esc2(o) + (ok ? '<i>正确</i>' : '') + '</div>';
      }).join('') + '</div>';
    }
    var exp = q.exp || q.expl || q.analysis || '';
    if (exp) html += '<div class="mp-sdexp"><b>解析</b>' + esc2(exp) + '</div>';
    s.querySelector('#mpSdBody').innerHTML = html;
    s.querySelector('#mpSdJump').onclick = function () {
      try {
        if (typeof QZ !== 'undefined' && n.ref && n.ref.id) QZ.cur = n.ref.id;
        if (typeof (window.render) === 'function') window.render();
        if (bankId) location.hash = '#/bank/' + bankId;
        sideClose(); try { close(); } catch (e) {}
      } catch (e) {}
    };
    s.querySelector('#mpSdAi').onclick = function () {
      try {
        var tg = (typeof kpTags === 'function') ? kpTags(n.ref) : [];
        if (tg.length) { kpAiOpen(tg[0]); }
        else if (typeof toast === 'function') toast('这道题还没有考点标签，先在答题页打个标签', 2600);
      } catch (e) {}
    };
    s.classList.add('show');
  }

  /* 在画布层补画：小笔记 + 中心题旁的「精搜」按钮 */
  function paintExtra(nodesEl, pos) {
    if (!S.on) return;
    notesOf().forEach(function (nt) {
      /* 最小化态：只剩一个小方块，可拖、点一下还原 */
      if (nt.min) {
        var ch = document.createElement('div');
        ch.className = 'mp-chip';
        ch.dataset.note = nt.id;
        ch.style.left = nt.x + 'px';
        ch.style.top = nt.y + 'px';
        ch.title = String(nt.text || '口诀').replace(/[#*>`=\-]/g, ' ').slice(0, 40) || '口诀';
        ch.textContent = '📝';
        ch.onclick = function () {
          if (ch._moved) { ch._moved = false; return; }
          nt.min = false; try { saveCur(); } catch (e) {}
          render();
        };
        dragChip(ch, nt);
        nodesEl.appendChild(ch);
        return;
      }

      var el = document.createElement('div');
      el.className = 'mp-note';
      el.dataset.note = nt.id;
      el.style.left = nt.x + 'px';
      el.style.top = nt.y + 'px';
      el.style.width = (nt.w || 216) + 'px';
      el.innerHTML = '<div class="nh"><i>📝</i><b>口诀</b>' +
        '<button class="nm" title="最小化成小方块">－</button>' +
        '<button class="nx" title="删掉这张">✕</button></div>' +
        '<div class="nb">' + (nt.text ? md2h(nt.text) : '') + '</div>' +
        '<i class="nrz" title="拖动改宽"></i>';
      el.querySelector('.nx').onclick = function (e) { e.stopPropagation(); delNote(nt.id); };
      el.querySelector('.nm').onclick = function (e) {
        e.stopPropagation();
        nt.min = true; try { saveCur(); } catch (e) {}
        render();
      };
      el.querySelector('.nb').ondblclick = function (e) { e.stopPropagation(); openNoteEd(nt.id); };
      dragNote(el, nt);
      resizeNote(el, nt);
      nodesEl.appendChild(el);
    });
    var c = DATA.nodes.filter(function (n) { return n.type === 'center'; })[0];
    if (c && !document.querySelector('.mp-probe')) {
      var b = document.createElement('button');
      b.className = 'mp-probe'; b.type = 'button'; b.textContent = '✨ 精搜';
      b.title = '在整个题库里再找一遍相似题，够像的直接并进来';
      b.onclick = function (e) { e.stopPropagation(); probe(c); };
      var host = nodesEl.querySelector('.mp-node[data-id="' + c.id + '"]');
      if (host) host.appendChild(b);
    }
  }

  function dragNote(el, nt) {
    var d = null;
    el.querySelector('.nh').addEventListener('pointerdown', function (e) {
      if (e.target.closest('.nx')) return;
      e.stopPropagation(); e.preventDefault();
      d = { x: e.clientX, y: e.clientY, ox: nt.x, oy: nt.y };
      var mv = function (ev) {
        if (!d) return;
        nt.x = d.ox + (ev.clientX - d.x) / V.k;
        nt.y = d.oy + (ev.clientY - d.y) / V.k;
        el.style.left = nt.x + 'px'; el.style.top = nt.y + 'px';
      };
      var up = function () {
        d = null;
        document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
        try { saveCur(); } catch (e) {}
      };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
  }


  /* 小方块：拖动；拖过就不算点击 */
  function dragChip(el, nt) {
    var d = null;
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      d = { x: e.clientX, y: e.clientY, ox: nt.x, oy: nt.y, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      var mv = function (ev) {
        if (!d) return;
        var dx = ev.clientX - d.x, dy = ev.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        nt.x = d.ox + dx / V.k; nt.y = d.oy + dy / V.k;
        el.style.left = nt.x + 'px'; el.style.top = nt.y + 'px';
      };
      var up = function () {
        if (!d) return;
        if (d.moved) { el._moved = true; setTimeout(function () { el._moved = false; }, 350); }
        d = null;
        document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
        try { saveCur(); } catch (e) {}
      };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
  }

  /* 拖右边缘改宽（180–300 之间） */
  function resizeNote(el, nt) {
    var h = el.querySelector('.nrz');
    if (!h) return;
    h.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      var w0 = el.offsetWidth, x0 = e.clientX;
      var mv = function (ev) {
        var w = Math.max(180, Math.min(300, w0 + (ev.clientX - x0) / V.k));
        nt.w = Math.round(w);
        el.style.width = nt.w + 'px';
      };
      var up = function () {
        document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
        try { saveCur(); } catch (e) {}
      };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
  }

  function addNote() {
    var arr = notesOf();
    var c = DATA.nodes.filter(function (n) { return n.type === 'center'; })[0] || { x: 0, y: 0 };
    var offs = [[300, 8], [300, 190], [40, 250], [-320, 160], [-320, -160]];
    var pick = null;
    for (var i = 0; i < offs.length; i++) {
      var ox = c.x + offs[i][0], oy = c.y + offs[i][1], free = true;
      for (var j = 0; j < DATA.nodes.length; j++) {
        if (Math.abs(DATA.nodes[j].x - ox) < 245 && Math.abs(DATA.nodes[j].y - oy) < 150) { free = false; break; }
      }
      if (free) {
        var others = notesOf();
        for (var k = 0; k < others.length; k++) {
          if (Math.abs(others[k].x - ox) < 230 && Math.abs(others[k].y - oy) < 190) { free = false; break; }
        }
      }
      if (free) { pick = offs[i]; break; }
    }
    if (!pick) { var mr = 320; DATA.nodes.forEach(function (n) { mr = Math.max(mr, Math.hypot(n.x, n.y)); }); pick = [mr + 260, 0]; }
    var nt = { id: 'nt' + Date.now().toString(36), text: '', x: c.x + pick[0], y: c.y + pick[1] };
    arr.push(nt);
    try { saveCur(); } catch (e) {}
    render();
    setTimeout(function () { openNoteEd(nt.id); }, 30);
  }
  function delNote(id) {
    var g = gCur(); if (!g) return;
    g.notes = (g.notes || []).filter(function (x) { return x.id !== id; });
    try { saveCur(); } catch (e) {}
    render();
  }
  function openNoteEd(id) {
    var g = gCur(); if (!g) return;
    var nt = (g.notes || []).filter(function (x) { return x.id === id; })[0];
    if (!nt) return;
    var box = $('#mpNoteEd'); if (!box) return;
    box.dataset.edit = id;
    $('#mpNeTa').value = nt.text || '';
    box.classList.add('show');
    setTimeout(function () { $('#mpNeTa').focus(); }, 40);
  }
  function closeNoteEd() { var b = $('#mpNoteEd'); if (b) { b.classList.remove('show'); b.dataset.edit = ''; } }
  function saveNoteEd() {
    var box = $('#mpNoteEd'); if (!box) return;
    var id = box.dataset.edit; var g = gCur(); if (!g || !id) { closeNoteEd(); return; }
    var nt = (g.notes || []).filter(function (x) { return x.id === id; })[0];
    if (nt) { nt.text = String($('#mpNeTa').value || '').replace(/\r/g, ''); }
    try { saveCur(); } catch (e) {}
    closeNoteEd(); render();
  }

  /* ---------- 搜索：窗内左上角 ---------- */
  function findRows(q) {
    var kw = String(q || '').trim().toLowerCase();
    if (!kw) return [];
    var out = [];
    DATA.nodes.forEach(function (n) {
      var body = n.type === 'tag' ? String(n.label || '') : String(n.label || '');
      if (body.toLowerCase().indexOf(kw) >= 0) out.push({ kind: n.type === 'tag' ? '考点' : (n.type === 'center' ? '中心题' : '相似题'), id: n.id, text: body });
    });
    notesOf().forEach(function (nt) {
      if (String(nt.text || '').toLowerCase().indexOf(kw) >= 0) out.push({ kind: '笔记', note: nt.id, text: String(nt.text || '').slice(0, 40) });
    });
    return out;
  }
  function findRun() {
    var pop = $('#mpFindPop'); if (!pop) return;
    var rows = findRows($('#mpFindQ').value);
    if (!rows.length) { pop.innerHTML = '<div class="fgrp">没有匹配</div>'; pop.classList.add('show'); return; }
    var groups = {}, order = [];
    rows.forEach(function (r) { if (!groups[r.kind]) { groups[r.kind] = []; order.push(r.kind); } groups[r.kind].push(r); });
    pop.innerHTML = order.map(function (k) {
      return '<div class="fgrp">' + esc(k) + ' · ' + groups[k].length + '</div>' + groups[k].map(function (r) {
        return '<div class="frow" data-id="' + esc(r.id || '') + '" data-note="' + esc(r.note || '') + '">' + esc(r.text) + '</div>';
      }).join('');
    }).join('');
    pop.classList.add('show');
  }
  function findGo(row) {
    var pop = $('#mpFindPop'); if (pop) pop.classList.remove('show');
    var nid = row.dataset.id, note = row.dataset.note;
    if (nid) {
      sel = nid; render();
      var n = DATA.nodes.filter(function (x) { return x.id === nid; })[0];
      if (n && !S.min) {
        var r = stageRect();
        V.tx = r.width / 2 - n.x * V.k; V.ty = r.height / 2 - n.y * V.k; paintView();
      }
    } else if (note) {
      var g = gCur(); var nt = ((g && g.notes) || []).filter(function (x) { return x.id === note; })[0];
      if (nt && !S.min) { var r2 = stageRect(); V.tx = r2.width / 2 - nt.x * V.k; V.ty = r2.height / 2 - nt.y * V.k; paintView(); }
    }
  }

  /* ---------- 拖题进来：悬停够久才收 ---------- */
  function canTake(dt) {
    try { return !!(dt && (dt.types || []).some(function (t) { return /text\/(plain|qid)/.test(t); })); } catch (e) { return false; }
  }
  function dzArm() {
    var w = $('#mpWrap'); if (!w || DZ.armed) return;
    DZ.armed = true; w.classList.add('dzhover');
    clearTimeout(DZ.tid);
    DZ.tid = setTimeout(function () { DZ.hot = true; w.classList.add('dzhot'); }, Math.round(HOLD * 1000));
  }
  function dzReset() {
    clearTimeout(DZ.tid); DZ.armed = false; DZ.hot = false;
    var w = $('#mpWrap'); if (w) { w.classList.remove('dzhover'); w.classList.remove('dzhot'); }
  }
  function onDrop(e) {
    if (!DZ.hot) { if (typeof toast === 'function') toast('再停一会儿才接哦（现在 ' + HOLD + ' 秒）', 1600, 'warn'); dzReset(); return; }
    e.preventDefault(); e.stopPropagation();
    var qid = '';
    try { qid = e.dataTransfer.getData('text/qid') || e.dataTransfer.getData('text/plain'); } catch (err) {}
    dzReset();
    if (!qid) return;
    var bank = null; try { bank = bankById(S.bankId); } catch (err) {}
    var q = bank && (bank.questions || []).filter(function (x) { return String(x.id) === String(qid); })[0];
    if (!q) { if (typeof toast === 'function') toast('这道题不在当前题库里', 1800, 'warn'); return; }
    recenter(q);
    if (typeof toast === 'function') toast('已把这道题设成中心题', 1500, 'good');
  }
  function markDraggables() {
    try {
      var card = document.querySelector('#view .qcard') || document.querySelector('#view .stem');
      if (card && !card.dataset.mapdrag) {
        card.dataset.mapdrag = '1'; card.draggable = true; card.style.cursor = 'grab';
        card.addEventListener('dragstart', function (e) {
          try {
            e.dataTransfer.setData('text/qid', String(QZ.cur));
            e.dataTransfer.setData('text/plain', String(QZ.cur));
            e.dataTransfer.effectAllowed = 'copy';
          } catch (err) {}
        });
      }
    } catch (e) {}
  }

  /* ---------- 精搜：全库再扫一遍 ---------- */
  function bg(s) {
    var x = String(s || '').replace(/[\s\p{P}]/gu, '');
    var m = {};
    for (var i = 0; i < x.length - 1; i++) m[x.slice(i, i + 2)] = 1;
    return m;
  }
  function inter(a, b) { var n = 0; for (var k in a) if (b[k]) n++; return n; }
  function overlap(a, b) { var n = inter(a, b); var mn = Math.min(Object.keys(a).length, Object.keys(b).length) || 1; return n / mn; }
  function probe(centerNode) {
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) return;
    var q0 = (bank.questions || []).filter(function (x) { return x.id === centerNode.refId; })[0];
    if (!q0) return;
    var have = {}; DATA.nodes.forEach(function (n) { if (n.refId) have[n.refId] = 1; });
    var t0 = qTags(q0).map(function (s) { return String(s).toLowerCase(); });
    var s0 = bg(q0.stem), o0 = bg((q0.options || []).join(' '));
    var cand = [];
    (bank.questions || []).forEach(function (q) {
      if (q === q0 || have[q.id]) return;
      if (!q.stem) return;
      var t1 = qTags(q).map(function (s) { return String(s).toLowerCase(); });
      var tagHit = 0;
      if (t0.length) { tagHit = t0.filter(function (x) { return t1.indexOf(x) >= 0; }).length / t0.length; }
      var sc = 0.45 * tagHit + 0.35 * overlap(s0, bg(q.stem)) + 0.20 * overlap(o0, bg((q.options || []).join(' ')));
      if (sc >= 0.42) cand.push({ q: q, s: sc });
    });
    cand.sort(function (a, b) { return b.s - a.s; });
    cand = cand.slice(0, 5);
    if (!cand.length) { if (typeof toast === 'function') toast('全库扫了一遍，没有更像的了', 1800, 'ok'); return; }
    var maxR = 320;
    DATA.nodes.forEach(function (n) { maxR = Math.max(maxR, Math.hypot(n.x, n.y)); });
    var R = maxR + 90, n0 = DATA.nodes.length;
    cand.forEach(function (it, i) {
      var ang = (-Math.PI / 2) + (i - (cand.length - 1) / 2) * 0.5 + Math.PI * 0.12;
      var id = 'ps' + Date.now().toString(36) + i;
      DATA.nodes.push({ id: id, type: 'sim', ref: it.q, refId: it.q.id, label: String(it.q.stem || '').slice(0, 52), score: Math.round(60 + it.s * 40), x: Math.cos(ang) * R, y: Math.sin(ang) * R });
      DATA.edges.push({ a: centerNode.id, b: id, kind: 'sim', w: it.s });
    });
    try { saveCur(); } catch (e) {}
    render();
    if (typeof toast === 'function') toast('精搜：补进 ' + cand.length + ' 道更像的题', 1800, 'good');
  }

  /* ---------- 初始化（只跑一次） ---------- */
  function initB4() {
    if (B4.on) { markDraggables(); return; }
    B4.on = true;
    var wrap = $('#mpWrap'), bar = $('#mpBar');
    if (wrap && !$('#mpFind')) {
      var f = document.createElement('div');
      f.id = 'mpFind';
      f.innerHTML = '<input id="mpFindQ" placeholder="搜这张图：题干 / 考点 / 笔记" autocomplete="off"><div id="mpFindPop"></div>';
      wrap.appendChild(f);
      $('#mpFindQ').addEventListener('input', findRun);
      $('#mpFindQ').addEventListener('focus', findRun);
      $('#mpFindPop').addEventListener('click', function (e) { var r = e.target.closest('.frow'); if (r) findGo(r); });
      document.addEventListener('pointerdown', function (e) {
        if (!e.target.closest('#mpFind')) { var p = $('#mpFindPop'); if (p) p.classList.remove('show'); }
      }, true);
    }
    if (bar && !$('#mpNoteBtn')) {
      var nb = document.createElement('button');
      nb.id = 'mpNoteBtn'; nb.type = 'button'; nb.title = '在当前组里加一张口诀小笔记'; nb.textContent = '📝';
      var pk = document.createElement('button');
      pk.id = 'mpPickBtn'; pk.type = 'button'; pk.title = '换中心题（搜索本题库）'; pk.textContent = '🎯';
      pk.onclick = function () { pickOpen(); };
      var gb = $('#mpGroups');
      if (gb && gb.parentNode) { gb.parentNode.insertBefore(pk, gb); gb.parentNode.insertBefore(nb, gb); }
      else { bar.appendChild(pk); bar.appendChild(nb); }
      /* 过滤段：相似题 / 考点 / 变式，勾掉就不画那类节点 */
      if (bar && !$('#mpFil')) {
        var fil = document.createElement('span');
        fil.id = 'mpFil';
        fil.innerHTML = '<label><input type="checkbox" data-f="sim"> 相似题</label>' +
          '<label><input type="checkbox" data-f="tag"> 考点</label>' +
          '<label><input type="checkbox" data-f="var"> 变式</label>';
        if (gb && gb.parentNode) gb.parentNode.insertBefore(fil, gb); else bar.appendChild(fil);
        fil.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        fil.addEventListener('change', function (e) {
          var f = e.target.dataset.f; if (!f) return;
          FIL[f] = e.target.checked ? 1 : 0;
          try { writeLS('qbank.mapfil.v1', FIL); } catch (err) {}
          applyFil(); render();
        });
      }
      nb.onclick = function (e) { e.stopPropagation(); addNote(); };
    }
    if (bar && !$('#mpHoldBox')) {
      var hb = document.createElement('span');
      hb.id = 'mpHoldBox';
      hb.innerHTML = '<span>拖入停</span><input id="mpHold" type="number" min="0.4" max="5" step="0.1" value="' + HOLD + '"><span>秒</span>';
      var mx = $('#mpMax');
      if (mx && mx.parentNode) mx.parentNode.insertBefore(hb, mx); else bar.appendChild(hb);
      $('#mpHold').addEventListener('change', function () {
        var v = parseFloat(this.value); if (!(v >= 0.4 && v <= 5)) v = 1.2;
        this.value = v; HOLD = v; try { localStorage.setItem(B4_KEY, String(v)); } catch (e) {}
        if (typeof toast === 'function') toast('拖入要停 ' + v + ' 秒才收', 1500, 'ok');
      });
    }
    if (!document.getElementById('mpNoteEd')) {
      var ed = document.createElement('div');
      ed.id = 'mpNoteEd';
      ed.innerHTML = '<div class="mp-nebox"><div class="mp-nehd">📝 口诀 / 小笔记 <span class="sp"></span><button id="mpNeX" title="关掉">✕</button></div>' +
        '<textarea id="mpNeTa" placeholder="写点口诀、易混点、判断依据…&#10;&#10;支持 Markdown：**加粗**、`代码`、==高亮==、- 列表、&gt; 引用、--- 分隔线"></textarea>' +
        '<div class="mp-neft"><button id="mpNeCancel">取消</button><button id="mpNeSave" class="prim">保存</button></div></div>';
      document.body.appendChild(ed);
      $('#mpNeX').onclick = closeNoteEd;
      $('#mpNeCancel').onclick = closeNoteEd;
      $('#mpNeSave').onclick = saveNoteEd;
      ed.addEventListener('click', function (e) { if (e.target === ed) closeNoteEd(); });
      ed.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); closeNoteEd(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNoteEd(); }
      }, true);
    }
    if (wrap && !wrap.dataset.dzb) {
      wrap.dataset.dzb = '1';
      wrap.addEventListener('dragenter', function (e) { if (canTake(e.dataTransfer)) { e.preventDefault(); dzArm(); } });
      wrap.addEventListener('dragover', function (e) { if (canTake(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dzArm(); } });
      wrap.addEventListener('dragleave', function (e) { if (!wrap.contains(e.relatedTarget)) dzReset(); });
      wrap.addEventListener('drop', onDrop);
      window.addEventListener('dragend', dzReset);
      document.addEventListener('drop', function () { setTimeout(dzReset, 30); }, true);
    }
    markDraggables();
  }

  /* ================= 知识组（web320） ================= */
  var G_KEY = 'qbank.mapgroups.v1';
  var G = { active: null, list: [] };
  var AGP = null;

  function gLoad() {
    var d = readLS(G_KEY, null);
    if (d && Array.isArray(d.list)) { G.list = d.list; G.active = d.active || (d.list[0] && d.list[0].id) || null; }
    else { G.list = []; G.active = null; }
  }
  function gSave() { writeLS(G_KEY, { active: G.active, list: G.list }); }
  function gNewId() { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100); }
  function gCur() { var a = G.active; return G.list.filter(function (x) { return x.id === a; })[0] || null; }

  function serNode(n) {
    return { id: n.id, type: n.type, label: n.label, score: n.score, x: n.x, y: n.y,
      refId: n.type === 'tag' ? null : (n.ref && n.ref.id) };
  }
  function deNode(n, bank) {
    var out = { id: n.id, type: n.type, label: n.label, score: n.score, x: n.x, y: n.y };
    if (n.type === 'tag') out.ref = n.label;
    else {
      var q = ((bank && bank.questions) || []).filter(function (x) { return String(x.id) === String(n.refId); })[0];
      out.ref = q || { id: n.refId, stem: n.label };
    }
    return out;
  }
  function saveCur() {
    var g = gCur(); if (!g) return;
    g.bank = S.bankId; g.qid = S.qid; g.layout = LAY.name;
    g.nodes = DATA.nodes.map(serNode);
    g.edges = DATA.edges.map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; });
    gSave();
  }
  function loadGroup(g) {
    var bank = null; try { bank = bankById(g.bank); } catch (e) {}
    DATA = {
      nodes: (g.nodes || []).map(function (n) { return deNode(n, bank); }),
      edges: (g.edges || []).map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; })
    };
    LAY.name = (g.layout && LAYOUTS.some(function (l) { return l.k === g.layout; })) ? g.layout : 'radial';
    S.bankId = g.bank; S.qid = g.qid; sel = null;
    var s = $('#mpLayout'); if (s) s.value = LAY.name;
    render(); setTimeout(fit, 50);
  }
  function gSwitch(id) {
    if (id === G.active) return;
    saveCur(); G.active = id; gSave();
    var g = gCur(); if (g) loadGroup(g);
    renderGrp();
  }
  function gAddFrom(name, nodes, edges, bank, qid, layout) {
    saveCur();
    var g = { id: gNewId(), name: name, star: false, bank: bank, qid: qid, layout: layout || 'radial', nodes: nodes, edges: edges };
    G.list.unshift(g); G.active = g.id; gSave();
    loadGroup(g); renderGrp();
    return g;
  }
  function gNewFromCur() {
    if (!DATA.nodes.length) return;
    saveCur();
    var g = { id: gNewId(), name: String((DATA.nodes[0] || {}).label || '新组').slice(0, 14), star: false,
      bank: S.bankId, qid: S.qid, layout: LAY.name,
      nodes: DATA.nodes.map(serNode), edges: DATA.edges.map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; }) };
    G.list.unshift(g); G.active = g.id; gSave(); renderGrp();
    if (typeof toast === 'function') toast('已新建一组：' + g.name, 1400);
  }
  function gRename(id) {
    var g = G.list.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    var v = prompt('这一组叫什么名字？', g.name);
    if (v == null) return;
    v = String(v).trim().slice(0, 24); if (!v) return;
    g.name = v; g.auto = false; gSave(); renderGrp();
  }
  function gDup(id) {
    var g = G.list.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    var c = JSON.parse(JSON.stringify(g)); c.id = gNewId(); c.name = g.name + ' 副本'; c.star = false;
    G.list.unshift(c); gSave(); renderGrp();
    if (typeof toast === 'function') toast('已复制一组', 1200);
  }
  function gDel(id) {
    var g = G.list.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    if (!confirm('删掉「' + g.name + '」这一组？（只删这一组，不影响题库和标签）')) return;
    G.list = G.list.filter(function (x) { return x.id !== id; });
    if (G.active === id) {
      G.active = (G.list[0] && G.list[0].id) || null;
      var n = gCur(); if (n) loadGroup(n); else { DATA = { nodes: [], edges: [] }; render(); }
    }
    gSave(); renderGrp();
  }
  function gStar(id) {
    var g = G.list.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    g.star = !g.star; gSave(); renderGrp();
  }

  function gCount(g) {
    var n = (g.nodes || []).length, s = 0, t = 0;
    (g.nodes || []).forEach(function (x) { if (x.type === 'sim') s++; if (x.type === 'tag') t++; });
    return n + ' 节点 · 题 ' + (s + 1) + (t ? ' · 考点 ' + t : '');
  }
  function gHay(g) {
    var out = [g.name || ''];
    (g.nodes || []).forEach(function (n) { out.push(n.label || ''); if (n.type === 'tag') out.push(n.label || ''); });
    return norm(out.join(' '));
  }
  function renderGrp() {
    if (!root) return;
    var q = norm(($('#mpGQ') || {}).value || '');
    var list = G.list.slice();
    list.sort(function (a, b) { return ((b.star ? 1 : 0) - (a.star ? 1 : 0)) || ((a.ord || 0) - (b.ord || 0)); });
    var rows = list.filter(function (g) { return !q || gHay(g).indexOf(q) >= 0; }).map(function (g) {
      var on = g.id === G.active ? ' on' : '';
      return '<div class="mp-grow2' + on + '" data-g="' + g.id + '">' +
        '<i class="gst' + (g.star ? ' on' : '') + '" data-star="' + g.id + '">' + (g.star ? '★' : '☆') + '</i>' +
        '<div class="gmain"><b>' + esc(g.name || '未命名组') + '</b><span class="muted2">' + gCount(g) + '</span></div>' +
        '<button class="gmore" data-more="' + g.id + '" title="更多">⋯</button></div>';
    }).join('');
    $('#mpGList').innerHTML = rows || '<div class="mp-agrow" style="color:#8a86a0">还没有组，点「＋」用当前题建一组</div>';
    $('#mpGFoot').innerHTML = '<span>共 ' + G.list.length + ' 组' + (q ? '（筛出 ' + (list.filter(function (g) { return gHay(g).indexOf(q) >= 0; }).length) + ' 组）' : '') + '</span>' +
      '<span>点行切换 · ☆标星</span>';
  }

  function gRenameInline(row) {
    var id = row.getAttribute('data-g');
    var g = G.list.filter(function (x) { return x.id === id; })[0]; if (!g) return;
    var b = row.querySelector('.gmain b'); if (!b) return;
    var inp = document.createElement('input');
    inp.className = 'gren'; inp.value = g.name || '';
    b.replaceWith(inp);
    inp.focus(); inp.select();
    var done = function (ok) {
      if (ok) { var v = inp.value.trim(); if (v) g.name = v; try { gSave(); } catch (e) {} }
      renderGrp();
    };
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    inp.addEventListener('blur', function () { done(true); });
  }
  function gMenu(id, x, y) {
    var m = $('#mpGMenu'); if (!m) return;
    var g0 = G.list.filter(function (g) { return g.id === id; })[0] || {};
    var starTxt = g0.star ? '取消标星' : '☆ 标星置顶';
    m.innerHTML = '<button data-a="open">打开这一组</button>' +
      '<button data-a="rn">✎ 重命名</button><button data-a="dup">⧉ 复制一份</button>' +
      '<button data-a="star">' + starTxt + '</button>' +
      '<button data-a="del" class="bad">🗑 删除这一组</button>';
    m.dataset.id = id;
    m.style.left = Math.max(8, Math.min(innerWidth - 150, x)) + 'px';
    m.style.top = Math.max(8, Math.min(innerHeight - 170, y)) + 'px';
    m.classList.add('show');
  }
  function gMenuHide() { var m = $('#mpGMenu'); if (m) m.classList.remove('show'); }

  function gBind() {
    var p = $('#mpGroups'); if (p) p.onclick = function () {
      var g = $('#mpGrp'); var on = g.classList.toggle('show');
      p.classList.toggle('on', on);
      if (on) { renderGrp(); var i = $('#mpGQ'); if (i) { i.value = ''; setTimeout(function () { i.focus(); }, 30); } }
    };
    document.addEventListener('pointerdown', function (e) {
      var g = $('#mpGrp'); if (!g || !g.classList.contains('show')) return;
      if (e.target.closest('#mpGrp') || e.target.closest('#mpGroups')) return;
      g.classList.remove('show'); var p2 = $('#mpGroups'); if (p2) p2.classList.remove('on'); gMenuHide();
    }, true);
    var q = $('#mpGQ'); if (q) q.oninput = function () { renderGrp(); };
    var nb = $('#mpGNew'); if (nb) nb.onclick = function () { gNewFromCur(); };
    var ai = $('#mpGAi'); if (ai) ai.onclick = function () { agOpen(); };
    var list = $('#mpGList');
    if (list) list.onclick = function (e) {
      var st = e.target.closest('[data-star]');
      if (st) { e.stopPropagation(); gStar(st.getAttribute('data-star')); return; }
      var mo = e.target.closest('[data-more]');
      if (mo) { e.stopPropagation(); var r = mo.getBoundingClientRect(); gMenu(mo.getAttribute('data-more'), r.left - 120, r.bottom + 4); return; }
      var row = e.target.closest('[data-g]');
      if (row) gSwitch(row.getAttribute('data-g'));
    };
    if (list && !list.__gd) {
      list.__gd = 1;
      /* 双击改名 */
      list.addEventListener('dblclick', function (e) {
        var row = e.target.closest('[data-g]'); if (!row) return;
        e.stopPropagation();
        gRenameInline(row);
      });
      /* 右键菜单 */
      list.addEventListener('contextmenu', function (e) {
        var row = e.target.closest('[data-g]'); if (!row) return;
        e.preventDefault(); e.stopPropagation();
        gMenu(row.getAttribute('data-g'), e.clientX, e.clientY);
      });
      /* 拖动排序 */
      var dg = null;
      list.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button,i')) return;
        var row = e.target.closest('[data-g]'); if (!row) return;
        dg = { id: row.getAttribute('data-g'), row: row, y: e.clientY, on: false };
      });
      list.addEventListener('pointermove', function (e) {
        if (!dg) return;
        if (!dg.on && Math.abs(e.clientY - dg.y) < 5) return;
        if (!dg.on) { dg.on = true; dg.row.classList.add('drag'); }
        var rows = [].slice.call(list.querySelectorAll('[data-g]'));
        var tgt = rows.filter(function (r) { return e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2; }).pop();
        rows.forEach(function (r) { r.classList.remove('over'); });
        if (tgt && tgt !== dg.row) tgt.classList.add('over');
        dg.tgt = tgt ? tgt.getAttribute('data-g') : null;
      });
      list.addEventListener('pointerup', function () {
        if (!dg) return;
        var d = dg; dg = null;
        d.row.classList.remove('drag');
        [].slice.call(list.querySelectorAll('[data-g]')).forEach(function (r) { r.classList.remove('over'); });
        if (!d.on || !d.tgt || d.tgt === d.id) return;
        var from = -1, to = -1;
        G.list.forEach(function (g, i) { if (g.id === d.id) from = i; if (g.id === d.tgt) to = i; });
        if (from < 0 || to < 0) return;
        var moved = G.list.splice(from, 1)[0];
        G.list.splice(to, 0, moved);
        G.list.forEach(function (g, i) { g.ord = i; });
        try { gSave(); } catch (err) {}
        renderGrp();
      });
    }
    var menu = $('#mpGMenu');
    if (menu) menu.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var id = menu.dataset.id, a = b.getAttribute('data-a');
      gMenuHide();
      if (a === 'open') gSwitch(id);
      else if (a === 'rn') gRename(id);
      else if (a === 'dup') gDup(id);
      else if (a === 'star') gStar(id);
      else if (a === 'del') gDel(id);
    };
    document.addEventListener('pointerdown', function (e) {
      var m = $('#mpGMenu'); if (!m || !m.classList.contains('show')) return;
      if (e.target.closest('#mpGMenu') || e.target.closest('[data-more]')) return;
      gMenuHide();
    }, true);
  }

  /* ---------- 一键 AI 分组（本地规则，真站换成 AI） ---------- */
  function bankQs() {
    var b = null; try { b = bankById(S.bankId); } catch (e) {}
    return ((b && b.questions) || []).filter(function (q) { return q && q.stem; });
  }
  function qTags(q) {
    try {
      if (window.TAGS && TAGS.data) {
        var d = TAGS.data() || {}, v = d[S.bankId + '#' + q.id];
        if (v && v.length) return v;
      }
    } catch (e) {}
    return Array.isArray(q.tags) ? q.tags : [];
  }

  /* 大标签（科目/系统级）不进脑图：考点只认小知识点，比如「麦氏点压痛」而不是「外科」 */
  var BIG_TAGS = ('政治 外科 内科 儿科 妇产科 妇科 产科 生理 生化 病理 药理 人文 医学 护理 ' +
    '中医 诊断 解剖 免疫 影像 麻醉 急救 神经 精神 皮肤 眼科 口腔 耳鼻喉 全科 伦理 法规 ' +
    '统计 传染病 流行病 化学 数学 基础 临床 护理学').split(' ');
  function isBigTag(s) {
    s = String(s || '').trim();
    if (!s) return true;
    if (BIG_TAGS.indexOf(s) >= 0) return true;
    for (var i = 0; i < BIG_TAGS.length; i++) {
      var b = BIG_TAGS[i];
      if (b.length >= 2 && s.length > b.length && (s.indexOf(b) === 0 || s.indexOf(b) === s.length - b.length)) return true;
    }
    return false;
  }
  function kpTags(q) {
    return qTags(q).filter(function (x) { return !isBigTag(x); });
  }
  function agCluster(mode) {
    var qs = bankQs(), out = [], i, j;
    if (mode === 'tag') {
      var map = {}, order = [];
      qs.forEach(function (q) {
        var ts = kpTags(q); if (!ts.length) return;
        var t = ts[0];
        if (!map[t]) { map[t] = []; order.push(t); }
        map[t].push(q);
      });
      var rest = qs.filter(function (q) { return !kpTags(q).length; });
      order.forEach(function (t) { if (map[t].length >= 2) out.push({ name: t, qs: map[t].slice(0, 8) }); });
      if (rest.length >= 2) out.push({ name: '其他', qs: rest.slice(0, 8) });
      if (!out.length) out.push({ name: '全部题', qs: qs.slice(0, 8) });
      return out;
    }
    var pool = qs.map(function (q) { return { q: q, g: grams(norm(q.stem || '')) }; });
    var used = {};
    pool.forEach(function (a, ai) {
      if (used[ai]) return;
      var grp = [a.q]; used[ai] = 1;
      pool.forEach(function (b, bi) {
        if (used[bi] || bi === ai) return;
        var inter = 0, na = 0, nb = 0, k;
        for (k in a.g) na += a.g[k];
        for (k in b.g) nb += b.g[k];
        for (k in a.g) if (b.g[k]) inter += Math.min(a.g[k], b.g[k]);
        var j = (na + nb - inter) ? inter / (na + nb - inter) : 0;
        if (j >= 0.34) { used[bi] = 1; grp.push(b.q); }
      });
      if (grp.length >= 2) out.push({ name: String((grp[0].stem || '').slice(0, 10)), qs: grp.slice(0, 8) });
      else out.push({ name: '零散题', qs: grp });
    });
    /* 合并同名「零散题」 */
    var scatter = out.filter(function (x) { return x.name === '零散题'; });
    out = out.filter(function (x) { return x.name !== '零散题'; });
    if (scatter.length) out.push({ name: '零散题', qs: scatter.reduce(function (a, b) { return a.concat(b.qs); }, []).slice(0, 8) });
    return out;
  }
  function agNodesFor(c) {
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    var cq = c.qs[0];
    var nodes = [{ id: 'c', type: 'center', ref: cq, x: 0, y: 0, label: cq.stem }], edges = [];
    c.qs.slice(1).forEach(function (q, i) {
      var id = 's' + i;
      nodes.push({ id: id, type: 'sim', ref: q, label: q.stem, score: Math.round(52 + (i < 3 ? 24 - i * 6 : 6)), x: 0, y: 0 });
      edges.push({ a: 'c', b: id, kind: 'sim', w: 0.6 });
    });
    kpTags(cq).slice(0, 4).forEach(function (t, i) {
      nodes.push({ id: 't' + i, type: 'tag', ref: t, label: t, x: 0, y: 0 });
      edges.push({ a: 'c', b: 't' + i, kind: 'tag', w: 0.5 });
    });
    return { nodes: nodes, edges: edges };
  }
  function agOpen() {
    AGP = null;
    var m = $('#mpAg'); if (!m) return;
    m.classList.add('show');
    $('#mpAgOk').hidden = true;
    $('#mpAgPrev').textContent = '点「开始分组」→ 先出方案，确认了才建组。';
  }
  function agClose() { var m = $('#mpAg'); if (m) m.classList.remove('show'); }
  function agPreview() {
    var mode = ($('#mpAgMode') || {}).value || 'tag';
    AGP = agCluster(mode);
    var html = AGP.map(function (c, i) {
      return '<div class="mp-agrow"><b>' + esc(c.name) + '</b><span>' + esc(c.qs[0].stem || '') + '</span><i>' + c.qs.length + ' 题</i></div>';
    }).join('');
    $('#mpAgPrev').innerHTML = html + '<div class="mp-agrow" style="color:#8a86a0;border:0">确认后会新建 ' + AGP.length + ' 个知识组（原来的组保留）。</div>';
    $('#mpAgOk').hidden = false;
    $('#mpAgGo').hidden = true;
  }

  /* 给一批新节点摆好位置（复用当前布局算法） */
  function fillLayout(nodes) {
    if (!nodes || !nodes.length) return;
    var old = DATA;
    DATA = { nodes: nodes, edges: [] };
    var pos = layoutPositions(LAY.name);
    nodes.forEach(function (n) { var p = pos[n.id]; if (p) { n.x = p.x; n.y = p.y; } });
    DATA = old;
  }

  function agApply() {
    if (!AGP || !AGP.length) return;
    saveCur();
    AGP.forEach(function (c) {
      var nd = agNodesFor(c);
      fillLayout(nd.nodes);
      var g = { id: gNewId(), name: c.name, star: false, bank: S.bankId, qid: c.qs[0].id, layout: 'radial',
        nodes: nd.nodes.map(serNode), edges: nd.edges };
      G.list.unshift(g);
    });
    G.active = G.list[0].id;
    gSave();
    var g0 = gCur(); if (g0) loadGroup(g0);
    renderGrp();
    agClose();
    if (typeof toast === 'function') toast('已建 ' + AGP.length + ' 个知识组', 1800);
  }
  function agBind() {
    var x = $('#mpAgX'); if (x) x.onclick = agClose;
    var c = $('#mpAgCancel'); if (c) c.onclick = agClose;
    var go = $('#mpAgGo'); if (go) go.onclick = agPreview;
    var ok = $('#mpAgOk'); if (ok) ok.onclick = agApply;
    var m = $('#mpAg');
    if (m) m.addEventListener('pointerdown', function (e) { if (e.target === m) agClose(); });
  }


  /* ================= 批3：知识点工作台（web323） ================= */
  var KP = { node: null, page: 0, n: 8, q: '', rows: [] };

  function kpTagName(n) { return String(n && n.label || '').trim(); }

  /* 这个考点下的全部题（先看当前题库的标签表；没有就退回题目自带 tags） */
  function kpQsOf(name) {
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) return [];
    var td = {};
    try { td = (window.TAGS && TAGS.data) ? TAGS.data() : {}; } catch (e) { td = {}; }
    return (bank.questions || []).filter(function (q) {
      var arr = td[S.bankId + '#' + q.id] || q.tags || [];
      return Array.isArray(arr) && arr.indexOf(name) >= 0;
    });
  }

  function kpMd() {
    var g = gCur(); if (!g) return {};
    if (!g.kp || typeof g.kp !== 'object') g.kp = {};
    return g.kp;
  }

  function kpEnsure() {
    var w = $('#mpWrap'); if (!w || $('#mpKp')) return;
    w.insertAdjacentHTML('beforeend',
      '<div id="mpKp" class="mp-kp">' +
        '<div class="mp-kph"><b id="mpKpName">考点</b><span id="mpKpCnt" class="mp-kcnt"></span>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="mp-kico" id="mpKpAi" title="AI 一键分析考点">✨</button>' +
        '<button type="button" class="mp-kico" id="mpKpFull" title="局部全屏">⤢</button>' +
        '<button type="button" class="mp-kico" id="mpKpX" title="关闭">✕</button></div>' +
        '<div class="mp-kpq"><input id="mpKpQ" placeholder="在这几道题里找：题干 / 选项 / 解析">' +
        '<button type="button" class="mp-kbtn" id="mpKpAdd">生成提纲</button></div>' +
        '<div class="mp-kpl" id="mpKpList"></div>' +
        '<div class="mp-kpp"><button type="button" class="mp-kbtn" id="mpKpPrev">‹</button>' +
        '<span id="mpKpPg">第 1 / 1 页</span>' +
        '<button type="button" class="mp-kbtn" id="mpKpNext">›</button></div>' +
        '<div class="mp-kpsub">考点总结（Markdown，边写边渲染）</div>' +
        '<div class="mp-rtew"><div class="mp-rtebar" id="mpRteBar">' +
          '<button type="button" data-cmd="bold" title="加粗"><b>B</b></button>' +
          '<button type="button" data-cmd="italic" title="斜体"><i>I</i></button>' +
          '<button type="button" data-cmd="strikeThrough" title="删除线"><s>S</s></button>' +
          '<span class="mp-rseg"></span>' +
          '<button type="button" data-block="h2" title="标题">H</button>' +
          '<button type="button" data-block="quote" title="引用">❝</button>' +
          '<button type="button" data-block="ul" title="列表">•</button>' +
          '<button type="button" data-block="code" title="代码">&lt;/&gt;</button>' +
        '</div>' +
        '<div id="mpKpMd" class="mp-kpmd mp-rte" contenteditable="true" data-ph="# 一句话&#10;**考点**是什么、判据、易错点……"></div></div>' +
        '<div id="mpKpPrev2" class="mp-kprev"></div>' +
        '<div class="mp-kpsub">图与附件 <i class="mp-kpah">都在本地，跟着这个考点存</i></div>' +
        '<div id="mpKpAtt" class="mp-kpatt"></div>' +
        '<div class="mp-kpaf"><button type="button" class="mp-kbtn" id="mpKpUp">＋ 从资料柜选</button>' +
        '<span class="mp-kpah" id="mpKpUpTip">先把图片/资料放进左下角资料柜</span></div>' +
      '</div>');
    $('#mpKpX').onclick = kpClose;
    $('#mpKpFull').onclick = function () { kpFull(!$('#mpKp').classList.contains('full')); };
    $('#mpKpQ').addEventListener('input', function () { KP.q = this.value.trim(); KP.page = 0; kpPaint(); });
    $('#mpKpPrev').onclick = function () { if (KP.page > 0) { KP.page--; kpPaint(); } };
    $('#mpKpNext').onclick = function () { if ((KP.page + 1) * KP.n < KP.rows.length) { KP.page++; kpPaint(); } };
    $('#mpKpAdd').onclick = kpOutline;
    $('#mpKpAi').onclick = kpAiOpen;
    $('#mpKpUp').onclick = kpAttPick;
    var ta = $('#mpKpMd');
    ta.addEventListener('input', function () {
      var g = gCur(); if (!g) return;
      var m = kpMd(); m[kpTagName(KP.node)] = rteMd();
      try { if (typeof saveCur === 'function') saveCur(); } catch (e) {}
      $('#mpKpPrev2').innerHTML = md2h(rteMd());
      rteSlashCheck();
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { rteSlashHide(); }
      if (e.key === 'Enter' && !e.shiftKey) { setTimeout(rteSlashCheck, 20); }
    });
    rteBind();
  }

  /* ---------- 节点过滤：相似题 / 考点 / 变式 ---------- */
  var FIL = (function () {
    var d = { sim: 1, tag: 1, var: 1 };
    try { var s = readLS('qbank.mapfil.v1', null); if (s) { d.sim = s.sim ? 1 : 0; d.tag = s.tag ? 1 : 0; d.var = s.var ? 1 : 0; } } catch (e) {}
    return d;
  })();
  function applyFil() {
    var w = $('#mpWrap'); if (!w) return;
    w.classList.toggle('nf-sim', !FIL.sim);
    w.classList.toggle('nf-tag', !FIL.tag);
    w.classList.toggle('nf-var', !FIL.var);
    var box = $('#mpFil');
    if (box) [].slice.call(box.querySelectorAll('input')).forEach(function (i) { i.checked = !!FIL[i.dataset.f]; });
  }

  /* ---------- 富文本编辑器（contenteditable，存 Markdown） ---------- */
  function rteEl() { return document.getElementById('mpKpMd'); }
  function rteMd() {
    var el = rteEl(); if (!el) return '';
    try { if (typeof mdFromHtml === 'function') return mdFromHtml(el); } catch (e) {}
    return el.innerText || '';
  }
  function rteSet(md) {
    var el = rteEl(); if (!el) return;
    try { el.innerHTML = (typeof mdToHtml === 'function') ? mdToHtml(md || '') : md2h(md || ''); }
    catch (e) { el.textContent = md || ''; }
    var pv = document.getElementById('mpKpPrev2'); if (pv) pv.innerHTML = md2h(md || '');
  }
  function rteCmd(cmd) {
    var el = rteEl(); if (!el) return;
    el.focus();
    try { document.execCommand(cmd, false, null); } catch (e) {}
    el.dispatchEvent(new Event('input'));
  }
  function rteBlock(kind) {
    var el = rteEl(); if (!el) return;
    el.focus();
    var sel = window.getSelection();
    var line = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode) : null;
    while (line && line !== el && !/^(DIV|P|H1|H2|H3|LI|BLOCKQUOTE|PRE)$/.test(line.tagName)) line = line.parentNode;
    if (!line || line === el) line = null;
    var html = line ? line.innerHTML : '';
    var tag = kind === 'h2' ? 'h2' : kind === 'quote' ? 'blockquote' : kind === 'code' ? 'pre' : 'div';
    var wrap = document.createElement(tag);
    if (kind === 'ul') { wrap = document.createElement('div'); wrap.innerHTML = '<div>• ' + (html || '列表项') + '</div>'; }
    else wrap.innerHTML = html || '（在这里写）';
    if (line && line.parentNode) line.parentNode.replaceChild(wrap, line);
    else el.appendChild(wrap);
    try { var r = document.createRange(); r.selectNodeContents(wrap); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
    el.dispatchEvent(new Event('input'));
  }
  /* 行首 / 出块菜单 */
  function rteSlashHide() {
    var s = document.getElementById('mpSlash'); if (s) s.classList.remove('show');
  }
  function rteSlashCheck() {
    var el = rteEl(); if (!el) return;
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) { rteSlashHide(); return; }
    var node = sel.anchorNode; var line = node.nodeType === 3 ? node.parentNode : node;
    var txt = (line.textContent || '');
    if (!/^\s*\/$/.test(txt) && !/^\s*\/[^\s]{0,6}$/.test(txt)) { rteSlashHide(); return; }
    var s = document.getElementById('mpSlash');
    if (!s) {
      s = document.createElement('div'); s.id = 'mpSlash';
      s.innerHTML = ['标题|h2', '小标题|h3', '无序列表|ul', '有序列表|ol', '引用|quote', '代码块|code']
        .map(function (x) { var a = x.split('|'); return '<button type="button" data-b="' + a[1] + '">' + a[0] + '</button>'; }).join('');
      document.body.appendChild(s);
      s.addEventListener('mousedown', function (e) {
        var b = e.target.closest('[data-b]'); if (!b) return;
        e.preventDefault();
        rteBlock(b.dataset.b);
        var el2 = rteEl();
        if (el2) { var first = el2.querySelector('div,h1,h2,h3,blockquote,pre'); if (first) { first.textContent = first.textContent.replace(/^\s*\//, ''); } el2.dispatchEvent(new Event('input')); }
        rteSlashHide();
      });
    }
    var r = sel.getRangeAt(0).getBoundingClientRect();
    s.style.left = Math.max(8, r.left) + 'px';
    s.style.top = (r.bottom + 4) + 'px';
    s.classList.add('show');
  }
  function rteBind() {
    var bar = document.getElementById('mpRteBar');
    if (bar && !bar.__b) {
      bar.__b = 1;
      bar.addEventListener('mousedown', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        e.preventDefault();
        if (b.dataset.cmd) rteCmd(b.dataset.cmd);
        else if (b.dataset.block) rteBlock(b.dataset.block);
      });
    }
  }

  /* ---------- 考点附件（挂到资料柜里的文件） ---------- */
  function kpFilesBox() {
    var g = gCur(); if (!g) return null;
    g.files = g.files || {};
    var k = kpTagName(KP.node);
    g.files[k] = g.files[k] || [];
    return { g: g, k: k, list: g.files[k] };
  }
  function kpAttPaint() {
    var box = document.getElementById('mpKpAtt'); if (!box) return;
    var fb = kpFilesBox(); if (!fb) return;
    var fs = fb.list.map(fById).filter(Boolean);
    box.innerHTML = fs.length ? fs.map(function (f) {
      var m = String(f.mime || '');
      var thumb = m.indexOf('image') === 0
        ? '<img class="mp-kath" src="' + f.url + '">'
        : '<i class="mp-kati">' + fIcon(f) + '</i>';
      return '<div class="mp-kat" data-id="' + f.id + '">' + thumb +
        '<span class="mp-katn">' + esc(String(f.name).slice(0, 14)) + '</span>' +
        '<button type="button" class="mp-katx" data-del="1" title="从考点移除">✕</button></div>';
    }).join('') : '<i class="mp-kpa0">还没有图或附件——点下面「从资料柜选」</i>';
    if (!box.__bound) {
      box.__bound = 1;
      box.addEventListener('click', function (e) {
        var row = e.target.closest('.mp-kat'); if (!row) return;
        var fb2 = kpFilesBox(); if (!fb2) return;
        if (e.target.closest('[data-del]')) {
          fb2.list.splice(fb2.list.indexOf(row.dataset.id), 1);
          try { saveCur(); } catch (err) {}
          kpAttPaint(); return;
        }
        pvOpen(row.dataset.id);
      });
    }
  }
  function kpAttPick() {
    var fb = kpFilesBox(); if (!fb) return;
    if (!FILES.length) { toast('资料柜还是空的，先把文件拖进来或点左下角 ＋'); return; }
    var box = document.getElementById('mpKpAtt');
    box.classList.add('picking');
    box.innerHTML = FILES.map(function (f) {
      var has = fb.list.indexOf(f.id) >= 0;
      return '<div class="mp-kat pick' + (has ? ' on' : '') + '" data-pick="' + f.id + '">' +
        '<i class="mp-kati">' + fIcon(f) + '</i>' +
        '<span class="mp-katn">' + esc(String(f.name).slice(0, 14)) + '</span>' +
        '<span class="mp-katc">' + (has ? '已加' : '＋') + '</span></div>';
    }).join('') + '<div class="mp-kat pick done" data-pick="__done">走好了</div>';
    box.onclick = function (e) {
      var r = e.target.closest('[data-pick]'); if (!r) return;
      var id = r.dataset.pick;
      if (id === '__done') { box.classList.remove('picking'); box.onclick = null; kpAttPaint(); return; }
      var fb2 = kpFilesBox(); if (!fb2) return;
      var i = fb2.list.indexOf(id);
      if (i >= 0) fb2.list.splice(i, 1); else fb2.list.push(id);
      try { saveCur(); } catch (err) {}
      box.classList.remove('picking'); box.onclick = null; kpAttPaint();
      toast(i >= 0 ? '已从考点移出' : '已挂到这个考点');
    };
  }

  /* ---------- AI 一键分析考点 ---------- */
  function kpAiEnsure() {
    if (document.getElementById('mpAi')) return;
    var d = document.createElement('div');
    d.id = 'mpAi';
    d.innerHTML =
      '<div class="mp-ai">' +
        '<div class="mp-aih"><b>✨ AI 一键分析考点</b><button type="button" class="mp-aix" data-close="1">✕</button></div>' +
        '<div class="mp-aic">' +
          '<div class="mp-ais">提示词（想让 AI 怎么总结）</div>' +
          '<textarea id="mpAiP" class="mp-ait">把这几道题的共同考点、问法变化、最容易错的地方整理成复习提纲，300 字以内。</textarea>' +
          '<div class="mp-ais">参考哪些资料（可勾选，也可多选）</div>' +
          '<div id="mpAiFiles" class="mp-aif"></div>' +
        '</div>' +
        '<div class="mp-aif2"><button type="button" class="mp-kbtn" data-close="1">取消</button>' +
        '<button type="button" class="mp-kbtn pri" id="mpAiGo">开始分析</button></div>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close]')) d.classList.remove('show');
    });
    d.querySelector('#mpAiGo').addEventListener('click', kpAiRun);
  }
  function kpAiOpen() {
    kpAiEnsure();
    var d = document.getElementById('mpAi');
    var box = document.getElementById('mpAiFiles');
    box.innerHTML = FILES.length ? FILES.map(function (f) {
      return '<label class="mp-aiff"><input type="checkbox" value="' + f.id + '"> <i class="mp-kati">' + fIcon(f) + '</i>' +
        esc(String(f.name).slice(0, 16)) + '</label>';
    }).join('') : '<i class="mp-kpa0">资料柜是空的，先放点资料进来（不勾也能分析）</i>';
    d.classList.add('show');
  }
  function kpAiRun() {
    var fb = kpFilesBox(); if (!fb) return;
    if (!KP.node) { toast('先点一个考点'); return; }
    var rows = (KP.rows && KP.rows.length ? KP.rows : []).slice(0, 8);
    var name = kpTagName(KP.node);
    var pick = [].slice.call(document.querySelectorAll('#mpAiFiles input:checked')).map(function (x) { return fById(x.value); }).filter(Boolean);
    var L = [];
    L.push('# ' + name);
    L.push('> 由本地规则依据 ' + rows.length + ' 道同考点题整理' + (pick.length ? ('，参考资料：' + pick.map(function (f) { return f.name; }).join('、')) : '') + '（接 AI 后换成模型总结）');
    L.push('');
    L.push('## 一句话');
    var ans = rows[0] && answerText(rows[0]);
    L.push('这个考点反复只考一件事：**' + name + '**' + (ans ? ('（答案：' + ans + '）') : '') + '。');
    L.push('');
    L.push('## 题目其实在问什么');
    rows.forEach(function (q, i) {
      L.push((i + 1) + '. ' + String(q.stem || '').replace(/\s+/g, ' ').slice(0, 48) + (answerText(q) ? ('  → 答案 ' + answerText(q)) : ''));
    });
    L.push('');
    var neigh = [];
    rows.forEach(function (q) { (qTags(q) || []).forEach(function (x) { if (x !== name && !isBigTag(x) && neigh.indexOf(x) < 0) neigh.push(x); }); });
    if (neigh.length) { L.push('## 顺带考到的邻接考点'); L.push('- ' + neigh.slice(0, 5).join('\n- ')); L.push(''); }
    var exp = rows.map(function (q) { return String(q.exp || '').replace(/^解析[:：]/, '').trim(); }).filter(Boolean)[0];
    if (exp) { L.push('## 解析里反复出现的判据'); L.push('- ' + exp.slice(0, 120)); L.push(''); }
    L.push('## 口诀 / 记忆钩子');
    L.push('`' + (neigh.slice(0, 3).concat([name]).join('、')) + '` —— 顺序别记反。');
    var txt = L.join('\n');
    var m = kpMd(); m[name] = txt;
    try { saveCur(); } catch (e) {}
    rteSet(txt);
    var pv = document.getElementById('mpKpPrev2'); if (pv) pv.innerHTML = md2h(txt);
    document.getElementById('mpAi').classList.remove('show');
    toast('分析完了，已写进右侧编辑器（可以接着改）');
  }
  function answerText(q) {
    try {
      var a = q.answer || q.ans;
      if (Array.isArray(a)) return a.join('');
      if (typeof a === 'number') return 'ABCDEFGH'[a] || '';
      if (typeof a === 'string') return a.replace(/[^A-Ha-h]/g, '').toUpperCase().slice(0, 4);
    } catch (e) {}
    return '';
  }

  function kpOpen(n) {
    if (n && n.type === 'tag' && isBigTag(n.label)) {
      try { if (window.TR && TR.toast) TR.toast('「' + n.label + '」是科目大标签，不是考点；考点只认小知识点'); } catch (e) {}
      return;
    }
    KP.node = n; KP.page = 0; KP.q = '';
    kpEnsure();
    var p = $('#mpKp'); if (!p) return;
    p.classList.add('show');
    $('#mpKpName').textContent = kpTagName(n);
    var q = $('#mpKpQ'); if (q) q.value = '';
    var m = kpMd()[kpTagName(n)] || '';
    $('#mpKpMd').value = m;
    $('#mpKpPrev2').innerHTML = md2h(m);
    kpPaint();
  }

  /* 局部「居中全屏」：面板变成屏幕中间的大卡片，后面压一层遮罩 */
  function kpFull(on) {
    var p = $('#mpKp'); if (!p) return;
    var m = document.getElementById('mpKpMask');
    if (!m) {
      m = document.createElement('div'); m.id = 'mpKpMask';
      m.onclick = function () { kpFull(false); };
      document.body.appendChild(m);
    }
    p.classList.toggle('full', !!on);
    m.classList.toggle('show', !!on);
    /* .full 时把面板提到 body 上，否则会被 #mpWrap 的层叠上下文压到遮罩下面 */
    if (on) {
      if (!p._home) p._home = p.parentNode;
      if (p.parentNode !== document.body) document.body.appendChild(p);
      p.style.zIndex = '100';
    } else {
      if (p._home && p.parentNode === document.body && p._home.appendChild) p._home.appendChild(p);
      p.style.zIndex = '';
    }
  }

  function kpClose() {
    var p = $('#mpKp'); if (p) { p.classList.remove('show'); p.classList.remove('full'); }
    KP.node = null;
  }

  function kpPaint() {
    if (!KP.node) return;
    var all = kpQsOf(kpTagName(KP.node));
    var q = KP.q.toLowerCase();
    KP.rows = q ? all.filter(function (x) {
      var s = [x.stem, (x.options || []).join(' '), x.explain || ''].join(' ').toLowerCase();
      return s.indexOf(q) >= 0;
    }) : all;
    var total = Math.max(1, Math.ceil(KP.rows.length / KP.n));
    if (KP.page > total - 1) KP.page = total - 1;
    var start = KP.page * KP.n;
    var page = KP.rows.slice(start, start + KP.n);
    $('#mpKpCnt').textContent = q ? ('筛出 ' + KP.rows.length + ' / ' + all.length) : (all.length + ' 道题');
    $('#mpKpList').innerHTML = page.length ? page.map(function (x, i) {
      var ans = (function (q) {
        if (typeof q.ans === 'number') return String.fromCharCode(65 + Math.max(0, Math.min(25, q.ans)));
        var a = q.answer;
        if (Array.isArray(a)) return String(a[0] || '').toUpperCase();
        return String(a == null ? '' : a).toUpperCase().replace(/[^A-H]/g, '').slice(0, 1);
      })(x);
      return '<div class="mp-kq" data-qid="' + esc(x.id) + '">' +
        '<i>' + (start + i + 1) + '</i><span><b>' + esc(String(x.stem || '').slice(0, 40)) + '</b>' +
        '<em>答案 ' + (ans || '—') + '</em></span></div>';
    }).join('') : '<div class="mp-kempty">' + (q ? '没搜到' : '这个考点还没有题') + '</div>';
    $('#mpKpPg').textContent = '第 ' + (KP.page + 1) + ' / ' + total + ' 页';
    $('#mpKpPrev').disabled = KP.page <= 0;
    $('#mpKpNext').disabled = (KP.page + 1) >= total;
    $('#mpKpList').querySelectorAll('.mp-kq').forEach(function (el) {
      el.onclick = function () {
        var qid = el.dataset.qid;
        try { if (typeof QZ !== 'undefined') QZ.cur = qid; } catch (e) {}
        try { (window.render || render)(); } catch (e) {}
        setTimeout(function () { recenter({ id: qid, stem: el.textContent.slice(1) }); }, 60);
        kpClose();
      };
    });
  }

  /* 本地提纲：没接模型时也能用，接 AI 之后换成 aiChat 即可 */
  function kpOutline() {
    if (!KP.node) return;
    var name = kpTagName(KP.node);
    var qs = kpQsOf(name);
    var lines = ['# ' + name, '', '> 由本地规则依据 ' + qs.length + ' 道同考点题整理（接 AI 后换成模型总结）', ''];
    lines.push('## 一句话');
    lines.push('这个考点反复只考一件事：**' + name + '**。');
    if (qs.length) {
      lines.push('', '## 题目其实在问什么');
      qs.slice(0, 5).forEach(function (q, i) { lines.push((i + 1) + '. ' + String(q.stem || '').slice(0, 40)); });
      var exps = qs.map(function (q) { return String(q.explain || '').trim(); }).filter(Boolean);
      if (exps.length) { lines.push('', '## 解析里反复出现的判据'); lines.push(exps[0].slice(0, 120)); }
    }
    lines.push('', '---', '看完可以自己补：判据、易错点、复习动作。');
    var txt = lines.join('\n');
    rteSet(txt);
    $('#mpKpPrev2').innerHTML = md2h(txt);
    var g = gCur(); if (g) { kpMd()[name] = txt; try { saveCur(); } catch (e) {} }
  }

  /* 点相似题 → 跳到那道题，并在当前组里以它为中心重画 */
  function recenter(q) {
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) return;
    S.qid = q.id;
    DATA = build(bank, q);
    var g = gCur();
    if (g && g.auto !== false) { g.name = String(q.stem || '').slice(0, 14); }
    sel = null;
    applyLayout(LAY.name);
    saveCur(); renderGrp();
  }

  /* ---------- 对外 ---------- */
  /* 从别的页面（掌握度/统计）带着题库+题号打开 */
  function openFor(bankId, qid) {
    if (!bankId) return;
    var go = function () {
      try {
        if (typeof QZ !== 'undefined') {
          if (qid) QZ.cur = qid;
          else { var bk = bankById(bankId); QZ.cur = (bk && bk.questions && bk.questions[0] || {}).id; }
        }
      } catch (e) {}
      open();
    };
    var cur = '';
    try { cur = (typeof QZ !== 'undefined' && QZ.bankId) || ''; } catch (e) {}
    if (String(cur) !== String(bankId)) {
      try { location.hash = '#/bank/' + encodeURIComponent(bankId); } catch (e) {}
      setTimeout(go, 760);
    } else go();
  }

  function open() {
    /* 换窗口/换分辨率后，把上次存的窗口大小夹回可视范围，免得缩成一条 */
    try {
      var maxW = Math.max(560, innerWidth - 40), maxH = Math.max(420, innerHeight - 96);
      if (!S.w || S.w > maxW || !S.h || S.h > maxH) {
        S.w = Math.min(1120, maxW);
        S.h = Math.min(760, maxH);
        S.x = Math.round((innerWidth - S.w) / 2);
        S.y = Math.round(Math.max(96, (innerHeight - S.h) / 2));
        try { save(); } catch (e) {}
      }
    } catch (e) {}
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
    var lv = readLS(LAY_KEY, 'radial');
    LAY.name = LAYOUTS.some(function (l) { return l.k === lv; }) ? lv : 'radial';
    ensure();
    try { initB4(); } catch (e) {}
    gLoad();
    /* 先找「这道题」已有的组；没有就现建一组（自动名 = 题干前 14 字） */
    var g = G.list.filter(function (x) { return x.bank === bank.id && String(x.qid) === String(q.id); })[0];
    if (g) {
      G.active = g.id; gSave();
      loadGroup(g);
    } else {
      DATA = build(bank, q);
      sel = null;
      applyLayout(LAY.name);
      gAddFrom(String(q.stem || '').slice(0, 14), DATA.nodes.map(serNode),
        DATA.edges.map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; }), bank.id, q.id, LAY.name);
      var g1 = gCur(); if (g1) { g1.auto = true; gSave(); }
    }
    apply();
    renderGrp();
    setTimeout(fit, 80);
  }

  function close() { S.on = false; S.min = false; MAXP = null; sel = null; apply(); }
  function toggle() { if (S.on && !S.min) close(); else open(); }


  /* =========== 交互补全（对着样板补）：拖节点、右键菜单、撤销、返回、快捷键 =========== */
  var UNDO = [];
  var LINK = null;          /* 正在连线的起点 node id */
  function snap() {
    UNDO.push({
      nodes: DATA.nodes.map(function (n) { return Object.assign({}, n); }),
      edges: DATA.edges.map(function (e) { return Object.assign({}, e); })
    });
    if (UNDO.length > 30) UNDO.shift();
  }
  function undo() {
    var s = UNDO.pop();
    if (!s) { toast('没有可撤销的了'); return; }
    DATA.nodes = s.nodes; DATA.edges = s.edges; sel = null;
    try { saveCur(); } catch (e) {}
    render();
    toast('已撤销');
  }

  /* 拖节点：按住卡片拖动摆位置（固定住的不能拖） */
  /* ================= 资料柜 / 预览 / 放大（照样板 #files/#preview/#viewer） ================= */
  var FK = 'qbank.mapfiles.v1';
  var FILES = (function () { try { return JSON.parse(localStorage.getItem(FK) || '[]') || []; } catch (e) { return []; } })();
  function fSave() {
    try { localStorage.setItem(FK, JSON.stringify(FILES.slice(-12))); }
    catch (e) { toast('浏览器存储只有 5MB，先删几个大文件'); }
  }
  function filesEnsure() {
    if ($('#mpFiles')) { paintFiles(); return; }
    var d = document.createElement('div');
    d.id = 'mpFiles';
    d.innerHTML = '<div class="mfh"><b>资料柜</b><span class="mfc" id="mfcN">0</span>' +
      '<span class="mfg"></span>' +
      '<button type="button" id="mfAdd" title="上传资料（图片 / PDF / Word / HTML）">＋</button>' +
      '<button type="button" id="mfMin" title="收起">—</button></div>' +
      '<div class="mfl" id="mfList"></div>' +
      '<input type="file" id="mfInput" multiple hidden>';
    $('#mpWrap').appendChild(d);
    $('#mfAdd').onclick = function () { $('#mfInput').click(); };
    $('#mfMin').onclick = function () { d.classList.toggle('min'); };
    $('#mfInput').onchange = function () { [].slice.call(this.files).forEach(addFile); this.value = ''; };
    $('#mfList').addEventListener('click', function (e) {
      var r = e.target.closest('.mfrow'); if (!r) return;
      if (e.target.closest('.mfd')) { FILES = FILES.filter(function (f) { return f.id !== r.dataset.id; }); fSave(); paintFiles(); return; }
      pvOpen(r.dataset.id);
    });
    paintFiles();
  }
  function addFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      FILES.push({
        id: 'f' + Date.now() + Math.random().toString(36).slice(2, 6),
        name: file.name, mime: file.type || '', size: file.size, url: fr.result
      });
      fSave(); paintFiles(); toast('已放进资料柜：' + String(file.name).slice(0, 14));
    };
    fr.readAsDataURL(file);
  }
  function fIcon(f) {
    var m = String(f.mime || ''), n = String(f.name || '');
    if (m.indexOf('image') === 0) return 'PNG';
    if (m.indexOf('pdf') >= 0) return 'PDF';
    if (/\.(docx?|wps)$/i.test(n)) return 'DOC';
    if (/\.(html?|mht)$/i.test(n)) return 'HTM';
    return 'TXT';
  }
  function fSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function paintFiles() {
    var box = $('#mfList'); if (!box) return;
    var n = $('#mfcN'); if (n) n.textContent = FILES.length;
    box.innerHTML = FILES.length ? FILES.map(function (f) {
      return '<div class="mfrow" data-id="' + f.id + '">' +
        '<i class="mfi">' + fIcon(f) + '</i>' +
        '<span class="mfn">' + esc(String(f.name).slice(0, 16)) + '</span>' +
        '<span class="mfs">' + fSize(f.size || 0) + '</span>' +
        '<button type="button" class="mfd" title="删掉">✕</button></div>';
    }).join('') : '<div class="mfe">把图片 / PDF / HTML 拖进脑图，或点上面 ＋ 上传</div>';
  }
  function fById(id) { return FILES.filter(function (f) { return f.id === id; })[0]; }
  function pvHtml(f) {
    var m = String(f.mime || '');
    if (m.indexOf('image') === 0) return '<img class="mppi" src="' + f.url + '" alt="">';
    if (m.indexOf('pdf') >= 0 || /\.(pdf|html?|mht)$/i.test(f.name)) return '<iframe class="mppe" src="' + f.url + '"></iframe>';
    if (m.indexOf('text') === 0) return '<pre class="mppt">（点「放大」看全文）</pre>';
    return '<div class="mppe mppx">这种格式没法直接看，点「放大」后用系统打开</div>';
  }
  function pvOpen(id) {
    var f = fById(id); if (!f) return;
    var p = $('#mpPv');
    if (!p) {
      p = document.createElement('div');
      p.id = 'mpPv';
      p.innerHTML = '<div class="mpvh" id="mpPvH"><i class="mpvz"></i><b id="mpPvN"></b>' +
        '<span class="mfg"></span>' +
        '<button type="button" id="mpPvBig" title="放大">⤢</button>' +
        '<button type="button" id="mpPvX" title="关闭">✕</button></div>' +
        '<div class="mpvb" id="mpPvB"></div>';
      $('#mpWrap').appendChild(p);
      $('#mpPvX').onclick = function () { p.classList.remove('show'); };
      $('#mpPvBig').onclick = function () { var c = p.dataset.cur; if (c) vwOpen(c); };
      /* 拖标题栏 */
      var h = p.querySelector('#mpPvH'), drag = null;
      h.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button')) return;
        var r = p.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        p.style.right = 'auto'; p.style.bottom = 'auto';
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
      });
      h.addEventListener('pointermove', function (e) {
        if (!drag) return;
        p.style.left = Math.max(6, e.clientX - drag.dx) + 'px';
        p.style.top = Math.max(6, e.clientY - drag.dy) + 'px';
      });
      h.addEventListener('pointerup', function () { drag = null; });
    }
    p.dataset.cur = id;
    $('#mpPvN').textContent = String(f.name).slice(0, 22);
    $('#mpPvB').innerHTML = pvHtml(f);
    if (!p.style.left) { p.style.left = '18px'; p.style.bottom = '150px'; }
    p.classList.add('show');
  }
  function vwOpen(id) {
    var f = fById(id); if (!f) return;
    var v = $('#mpVw');
    if (!v) {
      v = document.createElement('div');
      v.id = 'mpVw';
      v.innerHTML = '<div class="mpvwh"><b id="mpVwN"></b><span class="mfg"></span>' +
        '<a id="mpVwOpen" target="_blank" rel="noreferrer">系统打开</a>' +
        '<button type="button" id="mpVwX" title="关闭">✕</button></div>' +
        '<div class="mpvwb" id="mpVwB"></div>';
      document.body.appendChild(v);
      $('#mpVwX').onclick = function () { v.classList.remove('show'); };
      v.addEventListener('click', function (e) { if (e.target === v) v.classList.remove('show'); });
    }
    $('#mpVwN').textContent = String(f.name).slice(0, 40);
    $('#mpVwOpen').href = f.url;
    $('#mpVwB').innerHTML = pvHtml(f);
    v.classList.add('show');
  }
  function vwClose() { var v = $('#mpVw'); if (v) v.classList.remove('show'); var p = $('#mpPv'); if (p) p.classList.remove('show'); }

  /* ================= 换中心题弹窗（照样板 #pick） ================= */
  var PICK = { ai: false, q: '' };
  function pickOpen() {
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) { toast('先打开一本题库'); return; }
    var m = document.getElementById('mpPick');
    if (!m) {
      m = document.createElement('div');
      m.id = 'mpPick';
      m.innerHTML =
        '<div class="mp-pk">' +
          '<div class="mp-pkh"><b>换中心题</b>' +
            '<button type="button" class="mp-pkx" data-close="1" title="关闭">✕</button></div>' +
          '<div class="mp-pkbar">' +
            '<input id="mpPickQ" class="mp-pkq" placeholder="搜题干 / 知识点，或直接说「我刚做错的那道」">' +
            '<button type="button" class="mp-pkai" id="mpPickAi">✨ AI 模式</button>' +
          '</div>' +
          '<div class="mp-pkl" id="mpPickList"></div>' +
        '</div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) {
        if (e.target === m || e.target.closest('[data-close]')) pickClose();
      });
      m.querySelector('#mpPickQ').addEventListener('input', function () { PICK.q = this.value.trim(); pickPaint(); });
      m.querySelector('#mpPickAi').addEventListener('click', function () {
        PICK.ai = !PICK.ai;
        this.classList.toggle('on', PICK.ai);
        toast(PICK.ai ? 'AI 模式：先按标签/题干模糊匹配' : 'AI 模式已关');
        pickPaint();
      });
      m.querySelector('#mpPickList').addEventListener('click', function (e) {
        var row = e.target.closest('.mp-pkitem');
        if (!row) return;
        if (row.classList.contains('dis')) { toast('AI 变式题不能当中心题'); return; }
        var q = (bankById(S.bankId) || { questions: [] }).questions.filter(function (x) { return String(x.id) === row.dataset.q; })[0];
        if (!q) return;
        pickClose();
        recenter(q);
        toast('已把「' + String(q.stem || '').slice(0, 12) + '」设为中心题');
      });
    }
    m.classList.add('show');
    PICK.q = '';
    var ip = document.getElementById('mpPickQ');
    if (ip) { ip.value = ''; setTimeout(function () { try { ip.focus(); } catch (e) {} }, 60); }
    pickPaint();
  }
  function pickClose() { var m = document.getElementById('mpPick'); if (m) m.classList.remove('show'); }
  function pickPaint() {
    var box = document.getElementById('mpPickList');
    if (!box) return;
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    var pool = (bank && bank.questions) || [];
    var q = PICK.q.toLowerCase();
    var rows = pool.filter(function (x) {
      if (!q) return true;
      var hay = String(x.stem || '') + ' ' + (qTags(x) || []).join(' ');
      if (hay.toLowerCase().indexOf(q) >= 0) return true;
      if (!PICK.ai) return false;
      var n = 0;
      for (var i = 0; i < q.length; i++) if (hay.indexOf(q[i]) >= 0) n++;
      return n >= Math.max(2, Math.ceil(q.length * 0.7));
    }).slice(0, 40);
    if (!rows.length) { box.innerHTML = '<div class="mp-pkempty">没有匹配的题目</div>'; return; }
    box.innerHTML = rows.map(function (x) {
      var isCur = String(x.id) === String(S.qid);
      var dis = x.variant || x.aiVar || x.from === 'ai';
      var tags = (qTags(x) || []).slice(0, 3).join(' / ');
      return '<div class="mp-pkitem' + (isCur ? ' cur' : '') + (dis ? ' dis' : '') + '" data-q="' + x.id + '">' +
        '<div class="mp-pkt">' + esc(String(x.stem || '').slice(0, 60)) + '</div>' +
        '<div class="mp-pkm">' + (dis ? 'AI 变式 · ' : '') + (tags || '未打标签') + '</div>' +
        (isCur ? '<i class="mp-pkcur">当前</i>' : '') + '</div>';
    }).join('');
  }
  function bindPick() {
    var st = document.getElementById('mpStage');
    if (st && !st.__pkb) {
      st.__pkb = 1;
      /* 双击画布空白也能换中心题 */
    }
  }

  function bindNodeDrag() {
    var st = $('#mpStage'); if (!st || st.__dgb) return; st.__dgb = 1;
    var d = null;
    st.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('.mp-node'); if (!el) return;
      if (e.target.closest('.mp-probe')) return;
      var n = DATA.nodes.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!n) return;
      if (n.pinned) { return; }
      d = { el: el, n: n, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }, true);
    st.addEventListener('pointermove', function (e) {
      if (!d) return;
      var dx = (e.clientX - d.sx) / V.k, dy = (e.clientY - d.sy) / V.k;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; snap(); }
      if (!d.moved) return;
      d.n.x = Math.round(d.ox + dx); d.n.y = Math.round(d.oy + dy);
      d.el.style.left = d.n.x + 'px'; d.el.style.top = d.n.y + 'px';
      drawEdges();
      e.stopPropagation();
    }, true);
    st.addEventListener('pointerup', function () {
      if (!d) return;
      var moved = d.moved, el = d.el; d = null;
      el.classList.remove('dragging');
      if (moved) { try { saveCur(); } catch (e) {} }
    }, true);
  }

  /* 连线：右键「从这里连线」→ 点目标节点 */
  function linkMode(on, fromId) {
    LINK = on ? fromId : null;
    var st = $('#mpStage'); if (st) st.style.cursor = on ? 'crosshair' : '';
    toast(on ? '点另一个节点完成连线（Esc 取消）' : '已取消连线');
  }

  /* 右键菜单 */
  var CTX = null;
  function ctxShow(x, y, n) {
    if (!CTX) {
      CTX = document.createElement('div');
      CTX.id = 'mpCtx';
      document.body.appendChild(CTX);
      CTX.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    }
    var isVar = n && n.type === 'variant';
    var isTag = n && n.type === 'tag';
    CTX.innerHTML = n ? (
      (isVar ? '<button disabled>变式题不能当中心</button>'
              : '<button data-c="center">🎯 以这道题为中心</button>') +
      '<button data-c="focus">🔍 聚焦到这里</button>' +
      '<button data-c="link">🔗 从这里连线</button>' +
      '<button data-c="pin">' + (n.pinned ? '📌 取消固定' : '📌 固定位置') + '</button>' +
      (isTag ? '<button data-c="kp">📚 打开考点工作台</button>' : '') +
      '<div class="sep"></div>' +
      '<button data-c="del" class="danger">🗑 删除节点</button>'
    ) : '<button data-c="fit">⛶ 适应窗口</button><button data-c="undo">↶ 撤销</button>';
    CTX.style.left = Math.min(x, innerWidth - 200) + 'px';
    CTX.style.top = Math.min(y, innerHeight - 260) + 'px';
    CTX.classList.add('show');
    CTX.onclick = function (ev) {
      var b = ev.target.closest('[data-c]'); if (!b) return;
      var act = b.dataset.c;
      CTX.classList.remove('show');
      if (!n) {
        if (act === 'fit') fit();
        else if (act === 'undo') undo();
        return;
      }
      if (act === 'center') {
        if (n.type === 'sim' && n.ref) { snap(); recenter(n.ref); }
        else if (n.type === 'center') { toast('它已经是中心题了'); }
        else toast('只有相似题能当中心');
      } else if (act === 'focus') {
        sel = n.id; render();
        var r = stageRect();
        V.tx = r.width / 2 - n.x * V.k;
        V.ty = r.height / 2 - n.y * V.k;
        paintView(); try { saveCur(); } catch (e) {}
      } else if (act === 'link') {
        linkMode(true, n.id);
      } else if (act === 'pin') {
        n.pinned = !n.pinned; try { saveCur(); } catch (e) {} render();
        toast(n.pinned ? '已固定位置' : '已取消固定');
      } else if (act === 'kp') {
        try { kpOpen(n); } catch (e) {}
      } else if (act === 'del') {
        snap();
        DATA.nodes = DATA.nodes.filter(function (x) { return x.id !== n.id; });
        DATA.edges = DATA.edges.filter(function (e) { return e.a !== n.id && e.b !== n.id; });
        if (sel === n.id) sel = null;
        try { saveCur(); } catch (e) {}
        render(); toast('已删除节点（Ctrl+Z 撤销）');
      }
    };
  }
  document.addEventListener('pointerdown', function (e) {
    if (CTX && !e.target.closest('#mpCtx')) CTX.classList.remove('show');
  }, true);
  function bindCtx() {
    var st = $('#mpStage'); if (!st || st.__cxb) return; st.__cxb = 1;
    st.addEventListener('contextmenu', function (e) {
      var el = e.target.closest('.mp-node');
      e.preventDefault();
      var n = el ? DATA.nodes.filter(function (x) { return x.id === el.dataset.id; })[0] : null;
      ctxShow(e.clientX, e.clientY, n || null);
    });
  }

  /* 连线点选：连上就加一条 manual 边 */
  function bindLinkClick() {
    var st = $('#mpStage'); if (!st || st.__lkb) return; st.__lkb = 1;
    st.addEventListener('click', function (e) {
      if (!LINK) return;
      var el = e.target.closest('.mp-node'); if (!el) return;
      e.stopPropagation(); e.preventDefault();
      var to = el.dataset.id;
      if (to !== LINK && !DATA.edges.some(function (x) { return (x.a === LINK && x.b === to) || (x.a === to && x.b === LINK); })) {
        snap();
        DATA.edges.push({ a: LINK, b: to, kind: 'manual', w: 0.5 });
        try { saveCur(); } catch (err) {}
        render(); toast('已连线');
      } else {
        toast('这两个节点已经连着了');
      }
      linkMode(false);
    }, true);
  }

  /* 键盘：F 适应 / Delete 删 / 方向键平移 / +- 缩放 / Ctrl+Z 撤销 / Esc 取消连线 */
  document.addEventListener('keydown', function (e) {
    if (!S.on) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    var st = $('#mpStage'); if (!st) return;
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape') {
      if (LINK) { e.stopPropagation(); linkMode(false); return; }
      var kp = document.getElementById('mpKp');
      if (kp && kp.classList.contains('full')) { e.stopPropagation(); kpFull(false); return; }
      if (sel) { e.stopPropagation(); sel = null; render(); }
      return;
    }
    if (e.key === 'f' || e.key === 'F') { fit(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      var n = DATA.nodes.filter(function (x) { return x.id === sel; })[0];
      if (n) {
        e.preventDefault(); snap();
        DATA.nodes = DATA.nodes.filter(function (x) { return x.id !== n.id; });
        DATA.edges = DATA.edges.filter(function (x) { return x.a !== n.id && x.b !== n.id; });
        sel = null; try { saveCur(); } catch (err) {} render(); toast('已删除节点');
      }
      return;
    }
    var step = 60;
    if (e.key === 'ArrowLeft') { V.tx += step; paintView(); }
    if (e.key === 'ArrowRight') { V.tx -= step; paintView(); }
    if (e.key === 'ArrowUp') { V.ty += step; paintView(); }
    if (e.key === 'ArrowDown') { V.ty -= step; paintView(); }
    if (e.key === '+' || e.key === '=') { var r0 = stageRect(); zoom(r0.left + r0.width / 2, r0.top + r0.height / 2, 1.15); }
    if (e.key === '-' || e.key === '_') { var r1 = stageRect(); zoom(r1.left + r1.width / 2, r1.top + r1.height / 2, 1 / 1.15); }
  }, true);

  /* 顶栏「← 返回」：一层层往回退（考点面板 → 知识组 → 选中 → 关窗） */
  function back() {
    var kp = document.getElementById('mpKp');
    if (kp && kp.classList.contains('full')) { kpFull(false); return; }
    if (kp && kp.classList.contains('show')) { kpClose(); return; }
    var gp = $('#mpGrp');
    if (gp && gp.classList.contains('show')) { gp.classList.remove('show'); return; }
    if (sel) { sel = null; render(); return; }
    close();
  }

  window.MAPQ = {
    kpOpen: function (n) { kpOpen(n); }, kpClose: kpClose,
    open: open, close: close, toggle: toggle,
    layout: function (k) { applyLayout(k); return LAY.name; },
    openFor: openFor,
    groups: function () { return { active: G.active, n: G.list.length, list: G.list.map(function (g) { return { id: g.id, name: g.name, star: !!g.star, n: (g.nodes || []).length }; }) }; },
    newGroup: gNewFromCur,
    state: function () { return { on: S.on, min: S.min, n: DATA.nodes.length, layout: LAY.name, sel: sel, max: isMax() }; }
  };
})();
