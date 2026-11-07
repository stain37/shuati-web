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
  /* 一道题能被搜到的全部文字（题干 + 选项 + 解析；站里的题字段有 opts/exp，也有 options/explain 的老写法） */
  function qText(q) {
    var opts = Array.isArray(q.opts) ? q.opts : (Array.isArray(q.options) ? q.options : []);
    return [q.stem || '', opts.join(' '), q.exp || q.expl || q.analysis || q.explain || ''].join(' ');
  }
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
          '<button id="mpMax" title="铺满整屏 / 还原（也可双击标题栏）">⤢</button>' +
          '<button id="mpMin" title="收成右下角的小条">–</button><button id="mpX" title="关掉">✕</button></div>' +
        '<div id="mpTools">' +
          '<select id="mpLayout" title="换一种排法">' + opts + '</select>' +
          '<button id="mpGroups" title="知识组：切换 / 搜索 / 批量管理">组</button>' +
          '<span class="mp-tgrow"></span>' +
        '</div>' +
        '<div id="mpGrp">' +
          '<div class="mp-ghead"><input id="mpGQ" placeholder="搜组名 / 组里的题…" autocomplete="off">' +
            '<button id="mpGQai" title="AI 模糊：拆字 / 错别字也能找到">✨</button>' +
            '<button id="mpGSel" title="多选：批量复制 / 删除">☑</button>' +
            '<button id="mpGDupCur" title="复制当前组">⧉</button>' +
            '<button id="mpGNew" title="以当前题新建一组">＋</button>' +
            '<button id="mpGAi" class="prim" title="一键 AI 分组">✨</button>' +
            '<button id="mpGFold" title="收起">«</button></div>' +
          '<div class="mp-gopts"><span>范围</span><select id="mpGScope" title="搜索范围">' +
              '<option value="both">组名 + 组内内容</option><option value="name">只搜组名</option><option value="content">只搜组内内容</option></select>' +
            '<span>排序</span><select id="mpGSort" title="排序方式">' +
              '<option value="manual">自定义</option><option value="name">名称</option><option value="size">节点数</option></select>' +
            '<span class="mp-grow3"></span></div>' +
          '<div id="mpGBulk" hidden><span id="mpGBulkN">已选 0 组</span>' +
            '<button type="button" data-b="all">全选</button>' +
            '<button type="button" data-b="none">清空</button>' +
            '<button type="button" data-b="dup">复制…</button>' +
            '<button type="button" data-b="del" class="bad">删除</button>' +
            '<button type="button" data-b="off">取消</button></div>' +
          '<div id="mpGList"></div>' +
          '<div id="mpGFoot"></div>' +
        '</div>' +
        '<div id="mpStage"><svg id="mpEdges"><g id="mpGlowG"></g><g id="mpEdgeG"></g></svg><div id="mpNodes"></div>' +
          '<div id="mpZoom"><button type="button" data-z="out" title="缩小（－）">−</button>' +
            '<span id="mpZVal">100%</span>' +
            '<button type="button" data-z="in" title="放大（＋）">+</button>' +
            '<button type="button" data-z="fit" title="适应窗口（F）">适应</button></div>' +
          '<div id="mpHint"><span><b>拖空白</b> 平移</span><span><b>滚轮</b> 缩放</span>' +
            '<span><b>拖节点</b> 摆位</span><span><b>右键</b> 菜单</span><span><b>Ctrl+Z</b> 撤销</span></div>' +
        '</div>' +
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

  /* ---------- 窗口换焦：点哪块哪块亮，其它开着的窗口淡一档（照样板） ---------- */
  var WINS = ['#mpKp', '#mpPv', '#mpSide', '#mpGrp', '#mpWrap'];
  var WIN_TOP = '';
  function winOpen(s) {
    var el = $(s); if (!el) return false;
    if (s === '#mpWrap') return !el.hidden;
    return el.classList.contains('show');
  }
  function winFocusPaint() {
    WINS.forEach(function (s) {
      var el = $(s); if (!el) return;
      var open = winOpen(s);
      if (!open) { el.classList.remove('wf', 'winblur'); return; }
      el.classList.toggle('wf', s === WIN_TOP);
      el.classList.toggle('winblur', !!WIN_TOP && s !== WIN_TOP);
    });
  }
  function bindWinFocus() {
    if (document.__mpWinF) return; document.__mpWinF = 1;
    document.addEventListener('pointerdown', function (e) {
      var hit = '';
      for (var i = 0; i < WINS.length; i++) {
        var el = $(WINS[i]);
        if (el && winOpen(WINS[i]) && el.contains(e.target)) { hit = WINS[i]; break; }
      }
      WIN_TOP = hit;
      winFocusPaint();
    }, true);
  }

  function bindShell() {
    try { bindWinFocus(); } catch (e) {}
    var bar = $('#mpBar'), wrap = $('#mpWrap'), rz = $('#mpRz'), stage = $('#mpStage');
    var d = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,select,input,label,textarea')) return;
      d = { x: e.clientX, y: e.clientY, ox: S.x, oy: S.y, moved: false };
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    /* 视口变窄（手机 / 转屏）时把窗口收进可视区，别让标题栏的 ✕ – 跑到屏幕外 */
    var rsT = 0;
    window.addEventListener('resize', function () {
      if (!S.on || S.min) return;
      try { apply(); } catch (err) {}
      /* 视口变了很多（宽屏↔手机）就顺手把图收进可视区 */
      clearTimeout(rsT);
      rsT = setTimeout(function () { try { fit(); } catch (e) {} }, 260);
    });
    window.addEventListener('orientationchange', function () {
      if (!S.on || S.min) return;
      setTimeout(function () { try { apply(); } catch (err) {} }, 220);
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

    /* 右下角缩放条：− / 百分比 / + / 适应 */
    var zb = $('#mpZoom');
    if (zb) zb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]'); if (!b) return;
      e.stopPropagation();
      var r = stageRect();
      if (b.dataset.z === 'in') zoom(r.left + r.width / 2, r.top + r.height / 2, 1.15);
      else if (b.dataset.z === 'out') zoom(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.15);
      else fit();
    });

    /* Esc：先退最大化，再取消选中，最后关窗口。
       挂在 window 的捕获阶段并 stopPropagation —— 否则事件会继续传给 app.js 的
       全局 Esc（退回上一路由，会把 hash 清掉、整页跳回首页）。 */
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !S.on) return;
      e.preventDefault(); e.stopPropagation();
      var sd = document.getElementById('mpSide');
      if (sd && sd.classList.contains('show')) { sideClose(); return; }
      var rq = document.getElementById('mpRq');
      if (rq && rq.classList.contains('show')) { rqClose(); return; }
      var tb = document.getElementById('mpRkTb');
      if (tb && tb.classList.contains('show')) { rkTbHide(); return; }
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
    var g = $('#mpEdgeG'), gg = $('#mpGlowG');
    /* SVG 的 transform 属性不认 px 单位，得用纯数字，否则整层不移动（线全跑左上角） */
    var s2 = 'translate(' + V.tx + ',' + V.ty + ') scale(' + V.k + ')';
    if (g) g.setAttribute('transform', s2);
    if (gg) gg.setAttribute('transform', s2);
    var zv = $('#mpZVal');
    if (zv) zv.textContent = Math.round(V.k * 100) + '%';
  }

  function apply() {
    var wrap = $('#mpWrap'), bar = $('#mpBar'), rz = $('#mpRz'), chip = $('#mpChip');
    if (!S.on) { wrap.hidden = true; chip.hidden = true; var sp0 = $('#mpSnap'); if (sp0) sp0.hidden = true; return; }
    /* 只在桌面宽度下才认为「上次是按整屏存的」，否则手机上每次 apply 都会把宽高和位置重置回默认 */
    if (S.w != null && !MAXP && innerWidth > 700 && S.w >= innerWidth - 40) { S.w = null; }
    if (S.w == null) {
      S.w = Math.min(1080, Math.round(innerWidth * 0.62));
      S.h = Math.min(820, Math.round(innerHeight * 0.82));
      S.x = innerWidth - S.w - 28;
      S.y = 104;
    }
    /* 窄屏（手机）别再按 560 的最小宽硬撑，否则标题栏的 ✕ / – 会被挤到屏幕外 */
    var minW = Math.min(560, Math.max(280, innerWidth - 16));
    var minH = Math.min(380, Math.max(240, innerHeight - 100));
    S.w = Math.max(minW, Math.min(innerWidth - 16, S.w));
    S.h = Math.max(minH, Math.min(innerHeight - 100, S.h));
    S.x = Math.max(4, Math.min(innerWidth - S.w - 4, S.x));
    S.y = Math.max(56, Math.min(innerHeight - S.h - 4, S.y));
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
      /* 相似题 / AI 变式带一点弧度（一堆直线交叉太碎），考点 / 笔记 / 资料走直线 */
      var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      var bend = (e.kind === 'sim' || e.kind === 'variant') ? Math.min(46, len * 0.085) : 0;
      var mx = (A.x + B.x) / 2 - (dy / len) * bend, my = (A.y + B.y) / 2 + (dx / len) * bend;
      var d = bend
        ? 'M' + A.x.toFixed(1) + ',' + A.y.toFixed(1) + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + B.x.toFixed(1) + ',' + B.y.toFixed(1)
        : 'M' + A.x.toFixed(1) + ',' + A.y.toFixed(1) + ' L' + B.x.toFixed(1) + ',' + B.y.toFixed(1);
      return '<path d="' + d + '" class="mp-e ' + e.kind + (hot ? ' hot' : '') + '" stroke-width="' + w.toFixed(1) + '" style="opacity:' + op + '"/>';
    }).join('');
    g.innerHTML = paths;
    /* 光晕层：只给连到当前选中节点的线描一层粗的，交给 CSS 模糊去发光 */
    var glow = $('#mpGlowG');
    if (glow) {
      glow.innerHTML = fid ? g.querySelectorAll('path.hot').length ? Array.prototype.map.call(g.querySelectorAll('path.hot'), function (p) {
        return '<path d="' + p.getAttribute('d') + '" class="' + p.getAttribute('class') + '" stroke-width="' + (5 + 5 * (fid ? 0.6 : 0.3)).toFixed(1) + '"/>';
      }).join('') : '' : '';
    }
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
      var head = n.type === 'center' ? '中心题' : n.type === 'sim' ? '相似题' : n.type === 'file' ? '资料' : '考点';
      var pill = n.type === 'sim' ? '<span class="mp-pill">相似 ' + n.score + '%</span>'
        : n.type === 'tag' ? '' : n.type === 'file' ? '<span class="mp-pill f">' + esc(String(n.ext || 'file').toUpperCase()) + '</span>' : '<span class="mp-pill c">当前</span>';
      var text = n.type === 'tag' ? esc(n.label) : n.type === 'file'
        ? '<i class="mp-fico">' + fileIco(n.ext) + '</i>' + esc(String(n.label || '').slice(0, 40))
        : esc(String(n.label || '').slice(0, 52));
      var op = 1;
      if (fid) {
        var d0 = Math.hypot(n.x - pos[fid].x, n.y - pos[fid].y);
        op = n.id === fid ? 1 : (0.70 + 0.30 * (1 - d0 / maxD));
      }
      return '<div class="' + cls + '" data-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px;opacity:' + op.toFixed(3) + '">' +
        '<i class="mp-k">' + head + '</i><div class="mp-t">' + text + '</div>' + pill + '</div>';
    }).join('');

    nodesEl.querySelectorAll('.mp-node').forEach(function (el) {
      el.addEventListener('dblclick', function (e) {
        if (e.target.closest('.mp-probe')) return;
        var n2 = DATA.nodes.find(function (x) { return x.id === el.dataset.id; });
        if (n2 && n2.type === 'file') { e.stopPropagation(); if (n2.fid) { try { vwOpen(n2.fid); } catch (err) {} } }
      });
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
      '<button id="mpSdFull" class="mp-sdico" title="就地看着这道题的完整版（不离开脑图）">⤢</button>' +
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

  /* ⤢ 就地看着这道题：在脑图里铺一张大卡（不离开地图，返回即回到刚才的组） */
  function rqEnsure() {
    var m = document.getElementById('mpRq');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'mpRq';
    m.innerHTML =
      '<div class="mp-rqh">' +
        '<button type="button" id="mpRqBack" class="mp-rqbk">‹ 返回</button>' +
        '<b id="mpRqBank">题库</b>' +
        '<span class="mp-grow"></span>' +
        '<span class="mp-rqhint" id="mpRqHint">从脑图打开的这一题</span>' +
        '<button type="button" id="mpRqX" class="mp-rqbk" title="关闭">✕</button>' +
      '</div>' +
      '<div class="mp-rqb"><div class="mp-rqc" id="mpRqCard"></div></div>';
    document.body.appendChild(m);
    m.querySelector('#mpRqBack').onclick = rqClose;
    m.querySelector('#mpRqX').onclick = rqClose;
    m.addEventListener('click', function (e) { if (e.target === m) rqClose(); });
    return m;
  }
  function rqClose() {
    var m = document.getElementById('mpRq');
    if (m) m.classList.remove('show');
    if (sel) { try { sideOpen(DATA.nodes.filter(function (x) { return x.id === sel; })[0] || {}); } catch (e) {} }
  }
  function rqOpen(n) {
    if (!n || !n.ref) return;
    var m = rqEnsure();
    var q = (typeof n.ref === 'object') ? n.ref : {};
    var esc3 = function (x) { return String(x == null ? '' : x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
    var g = gCur();
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    m.querySelector('#mpRqBank').textContent = (bank && (bank.title || bank.name)) || (g && g.name) || '题库';
    m.querySelector('#mpRqHint').textContent = n.type === 'sim' ? ('相似题 · ' + (n.score == null ? '?' : n.score) + '%') :
      n.type === 'center' ? '当前中心题' : (n.type === 'variant' ? 'AI 变式' : '题目');
    var alpha = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    var ans = answerLetter(q);
    var opts = Array.isArray(q.opts) ? q.opts : (Array.isArray(q.options) ? q.options : []);
    var tags = []; try { tags = kpTags(q) || []; } catch (e) {}
    var html = '<div class="mp-rqno">' + (n.type === 'center' ? '中心题' : n.type === 'sim' ? '相似题' : '题目') +
      (q.type ? ' · ' + esc3(q.type) : '') + '</div>' +
      '<div class="mp-rqstem">' + esc3(q.stem || n.label || '') + '</div>';
    if (opts.length) {
      html += '<div class="mp-rqopts">' + opts.map(function (o, i) {
        var L = alpha[i] || String(i + 1);
        var ok = ans.indexOf(L) >= 0;
        return '<div class="mp-rqo' + (ok ? ' ok' : '') + '"><b>' + L + '</b><span>' + esc3(o) + '</span>' +
          (ok ? '<i class="mp-rqok">正确</i>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (ans) html += '<div class="mp-rqans">答案：<b>' + esc3(ans) + '</b></div>';
    var exp = expText(q);
    if (exp) html += '<div class="mp-rqexp"><b>解析</b>' + esc3(exp) + '</div>';
    if (tags.length) html += '<div class="mp-rqtags">' + tags.map(function (t) { return '<span class="mp-pill">' + esc3(t) + '</span>'; }).join('') + '</div>';
    html += '<div class="mp-rqfoot"><span class="mp-grow"></span>' +
      '<button type="button" class="mp-sdbtn" id="mpRqAi">✨ 分析考点</button>' +
      '<button type="button" class="mp-sdbtn" id="mpRqGo">跳到这道题</button></div>';
    m.querySelector('#mpRqCard').innerHTML = html;
    m.querySelector('#mpRqAi').onclick = function () {
      try {
        var t = (typeof kpTags === 'function') ? kpTags(q) : [];
        if (!t.length) { toast('这道题还没挂考点，先在地图上给它连一个考点节点'); return; }
        rqClose(); kpAiOpen(t[0]);
      } catch (e) {}
    };
    m.querySelector('#mpRqGo').onclick = function () {
      try {
        if (typeof QZ !== 'undefined' && q.id) QZ.cur = q.id;
        if (typeof (window.render) === 'function') window.render();
        var bid = (n.ref && n.ref._bank) || (DATA.bank && (DATA.bank.id || DATA.bank.bid)) || '';
        if (bid) location.hash = '#/bank/' + bid;
        rqClose(); sideClose(); try { close(); } catch (e) {}
      } catch (e) {}
    };
    var sd = document.getElementById('mpSide'); if (sd) sd.classList.remove('show');
    m.classList.add('show');
    try { var b = m.querySelector('.mp-rqb'); if (b) b.scrollTop = 0; } catch (e) {}
  }
  function answerLetter(q) {
    var a = q && (q.answer != null ? q.answer : q.ans);
    if (Array.isArray(a)) return a.map(function (x) { return String(x).toUpperCase(); }).join('');
    if (typeof a === 'number') return String.fromCharCode(65 + a);
    return String(a || '').toUpperCase();
  }
  /* 解析正文：题库里不少解析原文自带「解析：」前缀，跟卡片上的小标题会重复，这里统一剥掉 */
  function expText(q) {
    var s = String((q && (q.exp || q.explain || q.expl || q.analysis)) || '');
    return s.replace(/^\s*【?解析】?\s*[:：]?\s*/, '');
  }
  function sideOpen(n) {
    var s = sideEnsure();
    var q = (n.ref && typeof n.ref === 'object') ? n.ref : {};
    var bankId = (n.ref && n.ref._bank) || (DATA.bank && (DATA.bank.id || DATA.bank.bid)) || '';
    function esc2(x) { return String(x == null ? '' : x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    /* 资料节点：抽屉里只给「就地看着 / 新标签打开」 */
    if (n && n.type === 'file') {
      var ff = (typeof fById === 'function') ? fById(n.fid) : null;
      s.querySelector('#mpSdName').textContent = '资料';
      s.querySelector('#mpSdKick').textContent = String(n.ext || (ff ? fileExtOf(ff) : '') || '文件').toUpperCase();
      s.querySelector('#mpSdJump').style.display = 'none';
      s.querySelector('#mpSdAi').style.display = 'none';
      var sdf = s.querySelector('#mpSdFull'); if (sdf) sdf.style.display = 'none';
      s.querySelector('#mpSdBody').innerHTML =
        '<div class="mp-sdq">' + esc2(n.label || (ff && ff.name) || '资料') + '</div>' +
        '<div class="mp-sdfile">' + (ff
          ? (fileIco(n.ext || fileExtOf(ff)) + ' ' + esc2(ff.name || '') + '<i>' + fSize(ff.size || 0) + '</i>')
          : '文件已经不在资料柜里了（可能被删了）') + '</div>' +
        (ff ? '<div class="mp-sdbtn2"><button class="mp-sdbtn" type="button" id="mpSdOpen">就地看着</button>' +
          '<button class="mp-sdbtn" type="button" id="mpSdTab">新标签打开</button></div>' : '');
      var bOpen = s.querySelector('#mpSdOpen'), bTab = s.querySelector('#mpSdTab');
      if (bOpen) bOpen.onclick = function () { try { vwOpen(ff.id); } catch (e) {} };
      if (bTab) bTab.onclick = function () { try { var w = window.open(ff.url, '_blank'); if (w) w.opener = null; } catch (e) {} };
      s.classList.add('show');
      return;
    }
    s.querySelector('#mpSdJump').style.display = '';
    s.querySelector('#mpSdAi').style.display = '';
    var sdf2 = s.querySelector('#mpSdFull');
    if (sdf2) { sdf2.style.display = ''; sdf2.onclick = function () { try { rqOpen(n); } catch (e) {} }; }
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
    var exp = expText(q);
    if (exp) html += '<div class="mp-sdexp"><b>解析</b>' + esc2(exp) + '</div>';
    if (n.draft && n.type === 'variant') {
      html += '<div class="mp-sdvar"><b>变式草稿 · 三种改法</b>' +
        '<ol><li>换问法：把「典型 / 最有意义 / 最早出现」这类词换掉，考的还是同一个点。</li>' +
        '<li>换选项：把一个正确项换成邻近疾病的特征性体征，干扰更强。</li>' +
        '<li>换场景：加一句病史或体征描述，问「最可能诊断」。</li></ol>' +
        '<i>这里不会替你自动编题目：改写后的题请照录原文再存进题库。</i></div>';
    }
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

  /* ---------- 搜索器（web330）：✨ AI 模糊 + 按类型分组 + 键盘上下选 ---------- */
  var SR = { rows: [], idx: -1, ai: false, type: 'all' };
  var SR_SYN = [['心梗', '心肌梗死'], ['心衰', '心力衰竭'], ['呼衰', '呼吸衰竭'], ['肾衰', '肾功能衰竭'], ['脑梗', '脑梗死'],
    ['甲亢', '甲状腺功能亢进'], ['甲减', '甲状腺功能减退'], ['激素', '糖皮质激素'], ['抗生', '抗生素'], ['利尿', '利尿剂'],
    ['降压', '降血压'], ['降糖', '降血糖'], ['脑出血', '脑溢血'], ['结核', '肺结核'], ['肺炎', '肺部感染']];
  function srHay(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。、；：？！“”‘’（）《》〈〉【】—…·,.;:?!"'()\[\]{}<>|\\\/\-_=+*~`^&%#@]/g, '');
  }
  function srSub(need, hay) {
    var i = 0;
    for (var j = 0; j < hay.length && i < need.length; j++) if (hay.charAt(j) === need.charAt(i)) i++;
    return i >= need.length;
  }
  function srAlts(qq) {
    var out = [qq];
    SR_SYN.forEach(function (p) {
      if (p.indexOf(qq) >= 0 || qq.indexOf(p[0]) >= 0) p.forEach(function (a) { if (out.indexOf(a) < 0) out.push(a); });
    });
    return out;
  }
  function srScore(text, q, ai) {
    var h = srHay(text), qq = srHay(q);
    if (!h || !qq) return 0;
    var at = h.indexOf(qq);
    if (at >= 0) return 1000 - Math.min(at, 400);
    if (!ai) return 0;
    var alts = srAlts(qq), best = 0;
    alts.forEach(function (a) {
      var k = h.indexOf(a);
      if (k >= 0) best = Math.max(best, 700 - Math.min(k, 200));
    });
    if (best) return best;
    var grams = [];
    for (var j = 0; j + 2 <= qq.length; j++) grams.push(qq.substr(j, 2));
    if (grams.length) {
      var hit = grams.filter(function (g) { return h.indexOf(g) >= 0; }).length;
      if (hit === grams.length) return 420 + hit * 6;
      if (hit >= Math.max(1, Math.ceil(grams.length * 0.6))) return 240 + hit * 8;
    }
    if (srSub(qq, h)) return 140;
    var seen = {}, uniq = 0, cov = 0;
    for (var c = 0; c < qq.length; c++) {
      var ch = qq.charAt(c);
      if (seen[ch]) continue;
      seen[ch] = 1; uniq++;
      if (h.indexOf(ch) >= 0) cov++;
    }
    if (!uniq) return 0;
    if (cov === uniq) return 90;
    /* 错别字：最多差一个字，其余字都对得上也算命中（如「麦式点」→「麦氏点」） */
    if (cov >= 2 && cov >= uniq - 1 && cov / uniq >= 0.6) return 72 + cov;
    if (uniq >= 3 && cov / uniq >= 0.75) return 50;
    return 0;
  }
  function srBody(n) {
    if (n.type === 'tag' || n.type === 'file') return String(n.label || '');
    var q = (n.ref && typeof n.ref === 'object') ? n.ref : {};
    var opts = Array.isArray(q.opts) ? q.opts : (Array.isArray(q.options) ? q.options : []);
    return [q.stem || n.label || '', opts.join(' '), q.exp || q.expl || q.analysis || q.explain || ''].join(' ').slice(0, 800);
  }
  function srKindOf(n) {
    if (n.type === 'tag') return 'tag';
    if (n.type === 'file') return 'file';
    return 'q';
  }
  var SR_KIND_NAME = { q: '题目', tag: '考点', note: '笔记', file: '资料' };
  var SR_ORDER = ['q', 'tag', 'note', 'file'];
  function findRows(q, ai, type) {
    var kw = String(q || '').trim();
    if (!kw) return [];
    ai = ai == null ? SR.ai : ai;
    type = type || 'all';
    var out = [], seenF = {};
    DATA.nodes.forEach(function (n) {
      var k = srKindOf(n);
      if (k === 'file') seenF[n.fid] = 1;
      var body = srBody(n);
      var sc = srScore(body + ' ' + (n.label || ''), kw, ai);
      if (!sc) return;
      out.push({ k: k, nodeId: n.id, fid: n.type === 'file' ? n.fid : '', text: (n.label || body || '').slice(0, 90), sc: sc });
    });
    notesOf().forEach(function (nt) {
      var sc = srScore(nt.text, kw, ai);
      if (!sc) return;
      out.push({ k: 'note', noteId: nt.id, text: String(nt.text || '').replace(/\s+/g, ' ').slice(0, 90), sc: sc });
    });
    FILES.forEach(function (f) {
      if (seenF[f.id]) return;
      var sc = srScore(String(f.name || ''), kw, ai);
      if (!sc) return;
      out.push({ k: 'file', fid: f.id, text: String(f.name || '').slice(0, 90), sc: sc - 60 });
    });
    out = out.filter(function (r) { return type === 'all' || r.k === type; });
    out.sort(function (a, b) { return b.sc - a.sc; });
    return out.slice(0, 24);
  }
  function srHi(text, q, ai) {
    var t = String(text || '');
    var qq = String(q || '').trim();
    if (!qq) return esc(t);
    var at = t.toLowerCase().indexOf(qq.toLowerCase());
    if (at < 0) {
      if (!ai) return esc(t);
      var alts = srAlts(srHay(qq));
      for (var i = 1; i < alts.length; i++) {
        var p = srHay(t).indexOf(alts[i]);
        if (p < 0) continue;
        /* 模糊命中不做精确定位，直接把整行标亮 */
        return '<b class="hi">' + esc(t) + '</b>';
      }
      return esc(t);
    }
    return esc(t.slice(0, at)) + '<b class="hi">' + esc(t.slice(at, at + qq.length)) + '</b>' + esc(t.slice(at + qq.length));
  }
  function findRun() {
    var pop = $('#mpFindPop'); if (!pop) return;
    var inp = $('#mpFindQ');
    var q = inp ? inp.value : '';
    var aiBtn = $('#mpFindAi');
    SR.ai = !!(aiBtn && aiBtn.classList.contains('on'));
    var sel2 = $('#mpFindType');
    SR.type = sel2 ? sel2.value : 'all';
    if (!String(q || '').trim()) { pop.classList.remove('show'); pop.innerHTML = ''; SR.rows = []; SR.idx = -1; return; }
    var rows = findRows(q, SR.ai, SR.type);
    if (!rows.length) {
      SR.rows = []; SR.idx = -1;
      pop.innerHTML = '<div class="fgrp">没有匹配' + (SR.ai ? '' : '，试试点 ✨ 开 AI 模糊') + '</div>';
      findPopPos(inp);
      pop.classList.add('show');
      return;
    }
    var groups = {}, order = [];
    rows.forEach(function (r) { if (!groups[r.k]) { groups[r.k] = []; order.push(r.k); } groups[r.k].push(r); });
    order.sort(function (a, b) { return SR_ORDER.indexOf(a) - SR_ORDER.indexOf(b); });
    /* 按分组后的视觉顺序重排，键盘上下选才跟眼前一致 */
    var flat = [];
    order.forEach(function (k) { flat = flat.concat(groups[k]); });
    SR.rows = flat; SR.idx = 0;
    pop.innerHTML = order.map(function (k) {
      return '<div class="fgrp">' + SR_KIND_NAME[k] + ' · ' + groups[k].length + '</div>' + groups[k].map(function (r) {
        var i = flat.indexOf(r);
        return '<div class="frow' + (i === SR.idx ? ' on' : '') + '" data-i="' + i + '">' +
          '<i class="fk">' + SR_KIND_NAME[r.k] + '</i>' + srHi(r.text, q, SR.ai) + '</div>';
      }).join('');
    }).join('');
    findPopPos(inp);
    pop.classList.add('show');
  }
  /* 搜索框现在排在工具条里，下拉层改成 position:fixed 跟着输入框走（不再被窗口裁掉） */
  function findPopPos(inp) {
    var pop = $('#mpFindPop'); if (!pop || !inp) return;
    var r = inp.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - 328, r.left)) + 'px';
    pop.style.top = Math.round(r.bottom + 6) + 'px';
  }
  function srPaintHi() {
    var pop = $('#mpFindPop'); if (!pop) return;
    [].slice.call(pop.querySelectorAll('.frow')).forEach(function (el) {
      el.classList.toggle('on', String(SR.idx) === el.getAttribute('data-i'));
    });
    var on = pop.querySelector('.frow.on');
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }
  function srGo(i) {
    var r = SR.rows[i]; if (!r) return;
    var pop = $('#mpFindPop'); if (pop) pop.classList.remove('show');
    if (r.nodeId) {
      sel = r.nodeId; render();
      var n = DATA.nodes.filter(function (x) { return x.id === r.nodeId; })[0];
      if (n && !S.min) {
        var rr = stageRect();
        V.tx = rr.width / 2 - n.x * V.k; V.ty = rr.height / 2 - n.y * V.k; paintView();
      }
      if (n && n.type === 'file') { try { sideOpen(n); } catch (e) {} }
    } else if (r.noteId) {
      var g = gCur(); var nt = ((g && g.notes) || []).filter(function (x) { return x.id === r.noteId; })[0];
      if (nt) { if (nt.min) { nt.min = false; try { saveCur(); } catch (e) {} render(); } }
      if (nt && !S.min) { var r2 = stageRect(); V.tx = r2.width / 2 - nt.x * V.k; V.ty = r2.height / 2 - nt.y * V.k; paintView(); }
    } else if (r.fid) {
      try { pvOpen(r.fid); } catch (e) {}
      if (typeof toast === 'function') toast('这张资料还没上画布，从资料柜拖进来就能挂到图上', 2400);
    }
  }
  function findGo(row) {
    var i = row && row.getAttribute ? row.getAttribute('data-i') : -1;
    if (i == null || i === '') srGo(SR.idx); else srGo(+i);
  }

  /* ---------- 拖题进来：悬停够久才收 ---------- */
  function canTake(dt) {
    try { return !!(dt && (dt.types || []).some(function (t) { return /text\/(plain|qid|fid)/.test(t); })); } catch (e) { return false; }
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
    var fidIn = '';
    try { fidIn = e.dataTransfer.getData('text/fid'); } catch (err) {}
    if (fidIn) {
      e.preventDefault(); e.stopPropagation(); dzReset();
      var of = fById(fidIn);
      if (!of) { if (typeof toast === 'function') toast('资料柜里找不到这个文件了', 1800, 'warn'); return; }
      addFileNode(of, e.clientX, e.clientY);
      return;
    }
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
  /* ---------- 资料拖到画布 = 挂成 file 节点 ---------- */
  function fileExtOf(f) {
    var n = String((f && f.name) || '');
    var m = n.match(/\.([a-z0-9]{1,5})$/i);
    if (m) return m[1].toLowerCase();
    var mi = String((f && f.mime) || '');
    if (mi.indexOf('pdf') >= 0) return 'pdf';
    if (mi.indexOf('image') === 0) return 'png';
    if (mi.indexOf('html') >= 0) return 'html';
    return 'file';
  }
  function fileIco(ext) {
    var e2 = String(ext || '').toLowerCase();
    if (e2 === 'pdf') return '📕';
    if (e2 === 'html' || e2 === 'htm' || e2 === 'mht') return '🌐';
    if (e2 === 'doc' || e2 === 'docx' || e2 === 'wps') return '📄';
    if (/^(png|jpg|jpeg|gif|webp|bmp)$/.test(e2)) return '🖼';
    return '📎';
  }
  function addFileNode(f, cx, cy) {
    if (!f) return null;
    var r = stageRect();
    var sx = (cx == null) ? (r.left + r.width / 2) : cx;
    var sy = (cy == null) ? (r.top + r.height / 2) : cy;
    var x = Math.round((sx - r.left - V.tx) / V.k);
    var y = Math.round((sy - r.top - V.ty) / V.k);
    var exist = DATA.nodes.filter(function (n) { return n.type === 'file' && n.fid === f.id; })[0];
    snap();
    if (exist) {
      exist.x = x; exist.y = y; sel = exist.id;
      try { saveCur(); } catch (e) {}
      render();
      if (typeof toast === 'function') toast('这张资料已经在图上了，挪到这儿了', 1600);
      return exist;
    }
    var id = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100);
    var node = { id: id, type: 'file', fid: f.id, ext: fileExtOf(f), label: String(f.name || '资料'), x: x, y: y };
    DATA.nodes.push(node);
    sel = id;
    try { saveCur(); } catch (e) {}
    render();
    if (typeof toast === 'function') toast('已把资料挂到画布：' + String(f.name || '').slice(0, 14), 1800, 'good');
    return node;
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
    var wrap = $('#mpWrap'), bar = $('#mpBar'), tools = $('#mpTools');
    if (wrap && !$('#mpFind')) {
      var f = document.createElement('div');
      f.id = 'mpFind';
      f.innerHTML = '<input id="mpFindQ" placeholder="搜这张图：题干 / 考点 / 笔记 / 资料" autocomplete="off">' +
        '<button type="button" id="mpFindAi" title="AI 模糊：错别字 / 近义 / 只记得几个字也能搜">✨</button>' +
        '<select id="mpFindType" title="只搜某一类">' +
          '<option value="all">全部</option><option value="q">题目</option>' +
          '<option value="tag">考点</option><option value="note">笔记</option><option value="file">资料</option></select>' +
        '<div id="mpFindPop"></div>';
      var tools0 = $('#mpTools');
      if (tools0) tools0.insertBefore(f, tools0.firstChild); else wrap.appendChild(f);
      var qEl = $('#mpFindQ');
      qEl.addEventListener('input', findRun);
      qEl.addEventListener('focus', findRun);
      qEl.addEventListener('keydown', function (e) {
        var pop = $('#mpFindPop'), n = SR.rows.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!n || !pop.classList.contains('show')) { findRun(); return; }
          e.preventDefault();
          SR.idx = e.key === 'ArrowDown' ? (SR.idx + 1) % n : (SR.idx - 1 + n) % n;
          srPaintHi();
        } else if (e.key === 'Enter') {
          if (!n) return;
          e.preventDefault();
          if (SR.idx < 0) SR.idx = 0;
          srGo(SR.idx);
        } else if (e.key === 'Escape') {
          pop.classList.remove('show');
        }
      });
      var aiB = $('#mpFindAi');
      if (aiB) aiB.onclick = function () { aiB.classList.toggle('on', !aiB.classList.contains('on')); findRun(); qEl.focus(); };
      var tyS = $('#mpFindType');
      if (tyS) tyS.onchange = function () { findRun(); };
      $('#mpFindPop').addEventListener('click', function (e) { var r = e.target.closest('.frow'); if (r) findGo(r); });
      document.addEventListener('pointerdown', function (e) {
        if (!e.target.closest('#mpFind')) { var p = $('#mpFindPop'); if (p) p.classList.remove('show'); }
      }, true);
    }
    if (tools && !$('#mpNoteBtn')) {
      var nb = document.createElement('button');
      nb.id = 'mpNoteBtn'; nb.type = 'button'; nb.title = '在当前组里加一张口诀小笔记'; nb.textContent = '📝';
      var pk = document.createElement('button');
      pk.id = 'mpPickBtn'; pk.type = 'button'; pk.title = '换中心题（搜索本题库）'; pk.textContent = '🎯';
      pk.onclick = function () { pickOpen(); };
      var tg = tools.querySelector('.mp-tgrow');
      if (tg && tg.parentNode) { tg.parentNode.insertBefore(pk, tg); tg.parentNode.insertBefore(nb, tg); }
      else { tools.appendChild(pk); tools.appendChild(nb); }
      /* 过滤段：相似题 / 考点 / 变式，勾掉就不画那类节点 */
      if (!$('#mpFil')) {
        var fil = document.createElement('span');
        fil.id = 'mpFil';
        fil.innerHTML = '<label><input type="checkbox" data-f="sim"> 相似题</label>' +
          '<label><input type="checkbox" data-f="tag"> 考点</label>' +
          '<label><input type="checkbox" data-f="var"> 变式</label>';
        if (tg && tg.parentNode) tg.parentNode.insertBefore(fil, tg); else tools.appendChild(fil);
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
    if (tools && !$('#mpHoldBox')) {
      var hb = document.createElement('span');
      hb.id = 'mpHoldBox';
      hb.innerHTML = '<span>拖入停</span><input id="mpHold" type="number" min="0.4" max="5" step="0.1" value="' + HOLD + '"><span>秒</span>';
      var tg2 = tools.querySelector('.mp-tgrow');
      if (tg2 && tg2.parentNode) tg2.parentNode.insertBefore(hb, tg2); else tools.appendChild(hb);
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
      refId: (n.type === 'tag' || n.type === 'file') ? null : (n.ref && n.ref.id),
      fid: n.fid || null, ext: n.ext || null };
  }
  function deNode(n, bank) {
    var out = { id: n.id, type: n.type, label: n.label, score: n.score, x: n.x, y: n.y };
    if (n.type === 'tag') out.ref = n.label;
    else if (n.type === 'file') { out.fid = n.fid || null; out.ext = n.ext || null; out.ref = null; }
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
    try { paintGrpBtn(); } catch (e) {}
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

  /* ---- 组多选（web330）：☑ 进多选 → 全选 / 复制 / 批量删除 ---- */
  var GSEL = {};
  var GSELMODE = false;
  function gSelIds() {
    return G.list.filter(function (g) { return !!GSEL[g.id]; }).map(function (g) { return g.id; });
  }
  function gSelClear() { GSEL = {}; }
  function gBulkSync() {
    var bar = $('#mpGBulk'); if (!bar) return;
    bar.hidden = !GSELMODE;
    var n = gSelIds().length;
    var nEl = $('#mpGBulkN'); if (nEl) nEl.textContent = '已选 ' + n + ' 组';
    [].slice.call(bar.querySelectorAll('[data-b]')).forEach(function (b) {
      var k = b.getAttribute('data-b');
      b.disabled = (k === 'del' || k === 'dup') && n === 0;
      b.style.opacity = b.disabled ? '0.45' : '';
      b.style.pointerEvents = b.disabled ? 'none' : '';
    });
    var sb = $('#mpGSel'); if (sb) sb.classList.toggle('on', GSELMODE);
  }
  function gDupMany(ids) {
    if (!ids.length) return 0;
    var added = 0;
    ids.slice().forEach(function (id) {
      var i = -1; G.list.forEach(function (g, k) { if (g.id === id) i = k; });
      if (i < 0) return;
      var c = JSON.parse(JSON.stringify(G.list[i]));
      c.id = gNewId(); c.name = String(G.list[i].name || '未命名组') + ' 副本'; c.star = false; delete c.ord;
      G.list.splice(i + 1, 0, c); added++;
    });
    G.list.forEach(function (g, k) { g.ord = k; });
    try { gSave(); } catch (e) {}
    gSelClear(); renderGrp();
    if (typeof toast === 'function') toast('已复制 ' + added + ' 组', 1600, 'good');
    return added;
  }
  function gDelMany(ids) {
    if (!ids.length) return 0;
    var names = ids.map(function (id) {
      var g = G.list.filter(function (x) { return x.id === id; })[0]; return g ? String(g.name || '未命名组') : '';
    }).filter(Boolean);
    var tip = '删掉这 ' + names.length + ' 组？\n' +
      names.slice(0, 8).map(function (s) { return '· ' + s; }).join('\n') +
      (names.length > 8 ? '\n…还有 ' + (names.length - 8) + ' 组' : '') +
      '\n\n只删组，不影响题库和标签。';
    if (!confirm(tip)) return 0;
    var act = G.active;
    G.list = G.list.filter(function (g) { return ids.indexOf(g.id) < 0; });
    G.list.forEach(function (g, k) { g.ord = k; });
    if (ids.indexOf(act) >= 0) {
      G.active = (G.list[0] && G.list[0].id) || null;
      var n = gCur(); if (n) loadGroup(n); else { DATA = { nodes: [], edges: [] }; render(); }
    }
    try { gSave(); } catch (e) {}
    gSelClear(); renderGrp();
    if (typeof toast === 'function') toast('已删除 ' + names.length + ' 组', 1600);
    return names.length;
  }

  function gCount(g) {
    var n = (g.nodes || []).length, s = 0, t = 0;
    (g.nodes || []).forEach(function (x) { if (x.type === 'sim') s++; if (x.type === 'tag') t++; });
    return n + ' 节点 · 题 ' + (s + 1) + (t ? ' · 考点 ' + t : '');
  }
  /* 工具条上的「组」按钮：显示当前组名 + 节点数（样板 grpName / grpCount） */
  function paintGrpBtn() {
    var b = $('#mpGroups'); if (!b) return;
    var g = gCur();
    if (!g) { b.innerHTML = '组'; return; }
    var n = (g.nodes || []).length;
    b.innerHTML = '🗂 ' + esc(String(g.name || '组').slice(0, 8)) + ' <i class="mp-gbn">' + n + '</i>';
    b.title = '当前组：' + String(g.name || '') + '（' + n + ' 节点）· 点开切换 / 搜索 / 批量管理';
  }
  function gHay(g) {
    var out = [g.name || ''];
    (g.nodes || []).forEach(function (n) {
      out.push(n.label || '');
      if (n.type === 'tag') out.push(n.label || '', String(n.md || ''));
      else if (n.type === 'note') out.push(String((n.text || '')));
      else if (n.ref && typeof n.ref === 'object') out.push(qText(n.ref));
    });
    (g.notes || []).forEach(function (nt) { out.push(String(nt.text || ''), String(nt.title || '')); });
    return norm(out.join(' '));
  }
  function gScope() { var s = $('#mpGScope'); return (s && s.value) || 'both'; }
  function gFuzzy() { var b = $('#mpGQai'); return !!(b && b.classList.contains('on')); }
  /* 范围只有「组名」时只比组名，「组内内容」时只比内容，默认两边都比；
     ✨ 开着时再走一遍 srScore 的模糊匹配（拆字 / 错别字 / 近义） */
  function gMatch(g, q) {
    if (!q) return true;
    var sc = gScope();
    var fuzzy = gFuzzy();
    if (sc !== 'content') {
      if (norm(g.name || '').indexOf(q) >= 0) return true;
      if (fuzzy && srScore(srHay(g.name || ''), q, true) > 0) return true;
    }
    if (sc !== 'name') {
      var hay = gHay(g);
      if (hay.indexOf(q) >= 0) return true;
      if (fuzzy && srScore(hay, q, true) > 0) return true;
    }
    return false;
  }
  function renderGrp() {
    if (!root) return;
    var q = norm(($('#mpGQ') || {}).value || '');
    var list = G.list.slice();
    var sm = (($('#mpGSort') || {}).value) || 'manual';
    if (sm === 'name') list.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'zh'); });
    else if (sm === 'size') list.sort(function (a, b) { return (b.nodes || []).length - (a.nodes || []).length; });
    else list.sort(function (a, b) { return ((b.star ? 1 : 0) - (a.star ? 1 : 0)) || ((a.ord || 0) - (b.ord || 0)); });
    var hitList = list.filter(function (g) { return gMatch(g, q); });
    var rows = hitList.map(function (g) {
      var on = g.id === G.active ? ' on' : '';
      var ck = GSELMODE ? '<i class="mp-gck' + (GSEL[g.id] ? ' on' : '') + '" data-ck="' + g.id + '"></i>' : '';
      return '<div class="mp-grow2' + on + (GSELMODE ? ' selmode' : '') + '" data-g="' + g.id + '">' + ck +
        '<i class="gst' + (g.star ? ' on' : '') + '" data-star="' + g.id + '">' + (g.star ? '★' : '☆') + '</i>' +
        '<div class="gmain"><b>' + esc(g.name || '未命名组') + '</b><span class="muted2">' + gCount(g) + '</span></div>' +
        '<button class="gmore" data-more="' + g.id + '" title="更多">⋯</button></div>';
    }).join('');
    $('#mpGList').innerHTML = rows || (q ? '<div class="mp-agrow" style="color:#8a86a0">没有匹配的组</div>'
      : '<div class="mp-agrow" style="color:#8a86a0">还没有组，点「＋」用当前题建一组</div>');
    $('#mpGFoot').innerHTML = '<span>共 ' + G.list.length + ' 组 · ' +
      G.list.reduce(function (a, g) { return a + (g.nodes || []).length; }, 0) + ' 节点' +
      (q ? '（筛出 ' + hitList.length + ' 组）' : '') + '</span>' +
      '<button type="button" id="mpGAll" title="清空搜索、退出多选，从头看">管理全部 ›</button>' +
      '<span>' + (GSELMODE ? '点行勾选 · 再点 ☑ 退出' : '点行切换 · ☆标星') + '</span>';
    try { gBulkSync(); } catch (e) {}
    try { paintGrpBtn(); } catch (e) {}
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
      if (on) { try { paintGrpBtn(); } catch (e0) {}; renderGrp(); var i = $('#mpGQ'); if (i) { i.value = ''; setTimeout(function () { i.focus(); }, 30); } }
    };
    document.addEventListener('pointerdown', function (e) {
      var g = $('#mpGrp'); if (!g || !g.classList.contains('show')) return;
      if (e.target.closest('#mpGrp') || e.target.closest('#mpGroups')) return;
      g.classList.remove('show'); var p2 = $('#mpGroups'); if (p2) p2.classList.remove('on'); gMenuHide();
    }, true);
    var q = $('#mpGQ'); if (q) q.oninput = function () { renderGrp(); };
    var gqa = $('#mpGQai');
    if (gqa) gqa.onclick = function (e) {
      e.stopPropagation();
      var on = gqa.classList.toggle('on');
      gqa.title = on ? 'AI 模糊：开（拆字 / 错别字 / 近义都能搜到）' : 'AI 模糊：拆字 / 错别字也能找到';
      renderGrp();
    };
    var gsc = $('#mpGScope'); if (gsc) gsc.onchange = function () { renderGrp(); };
    /* 排序偏好记在本机，下次开面板还是这个排法 */
    var gso = $('#mpGSort');
    if (gso) {
      try {
        var sv2 = localStorage.getItem('qbank.map.gsort.v1');
        if (sv2) gso.value = sv2;
      } catch (e) {}
      gso.onchange = function () {
        try { localStorage.setItem('qbank.map.gsort.v1', gso.value); } catch (e) {}
        renderGrp();
      };
    }
    var dupc = $('#mpGDupCur');
    if (dupc) dupc.onclick = function (e) { e.stopPropagation(); try { gDup(G.active); } catch (err) {} };
    var fold = $('#mpGFold');
    if (fold) fold.onclick = function (e) {
      e.stopPropagation();
      var g2 = $('#mpGrp'); if (g2) g2.classList.remove('show');
      var p3 = $('#mpGroups'); if (p3) p3.classList.remove('on');
    };
    var gal = $('#mpGFoot');
    if (gal && !gal.__gb) {
      gal.__gb = 1;
      gal.addEventListener('click', function (e) {
        var b = e.target.closest('#mpGAll'); if (!b) return;
        var qi = $('#mpGQ'); if (qi) { qi.value = ''; }
        GSELMODE = false; gSelClear();
        var gs = $('#mpGScope'); if (gs) gs.value = 'both';
        renderGrp();
        if (qi) qi.focus();
      });
    }
    var sb = $('#mpGSel');
    if (sb) sb.onclick = function (e) {
      e.stopPropagation();
      GSELMODE = !GSELMODE; gSelClear(); renderGrp();
      if (GSELMODE && typeof toast === 'function') toast('多选：点组勾选，再用「复制…」「删除」', 2200);
    };
    var bk = $('#mpGBulk');
    if (bk) bk.onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return;
      e.stopPropagation();
      var k = b.getAttribute('data-b');
      if (k === 'off') { GSELMODE = false; gSelClear(); renderGrp(); return; }
      if (k === 'none') { gSelClear(); renderGrp(); return; }
      if (k === 'all') {
        var qq = norm(($('#mpGQ') || {}).value || '');
        G.list.forEach(function (g) { if (gMatch(g, qq)) GSEL[g.id] = 1; });
        renderGrp(); return;
      }
      var ids = gSelIds(); if (!ids.length) return;
      if (k === 'dup') gDupMany(ids);
      else if (k === 'del') gDelMany(ids);
    };
    var nb = $('#mpGNew'); if (nb) nb.onclick = function () { gNewFromCur(); };
    var ai = $('#mpGAi'); if (ai) ai.onclick = function () { agOpen(); };
    var list = $('#mpGList');
    if (list) list.onclick = function (e) {
      var st = e.target.closest('[data-star]');
      if (st) { e.stopPropagation(); gStar(st.getAttribute('data-star')); return; }
      var mo = e.target.closest('[data-more]');
      if (mo) { e.stopPropagation(); var r = mo.getBoundingClientRect(); gMenu(mo.getAttribute('data-more'), r.left - 120, r.bottom + 4); return; }
      var row = e.target.closest('[data-g]');
      if (!row) return;
      if (GSELMODE) {
        var gid = row.getAttribute('data-g');
        if (GSEL[gid]) delete GSEL[gid]; else GSEL[gid] = 1;
        renderGrp();
        return;
      }
      gSwitch(row.getAttribute('data-g'));
    };
    if (list && !list.__gd) {
      list.__gd = 1;
      /* 双击改名 */
      list.addEventListener('dblclick', function (e) {
        var row = e.target.closest('[data-g]'); if (!row) return;
        e.stopPropagation();
        if (GSELMODE) return;
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
        if (GSELMODE) return;
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
        '<button type="button" class="mp-kbtn" id="mpKpQai" title="AI 模糊：拆字 / 近义 / 错别字">✨</button>' +
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
        '<i class="mp-kprz" id="mpKpRz" title="拖动改宽度"></i>' +
      '</div>');
    $('#mpKpX').onclick = kpClose;
    $('#mpKpFull').onclick = function () { kpFull(!$('#mpKp').classList.contains('full')); };
    $('#mpKpQ').addEventListener('input', function () { KP.q = this.value.trim(); KP.page = 0; kpPaint(); });
    var kqa = $('#mpKpQai');
    if (kqa) kqa.onclick = function () {
      var on = kqa.classList.toggle('on');
      kqa.title = on ? 'AI 模糊：开（拆字 / 错别字 / 近义都能搜到）' : 'AI 模糊：拆字 / 近义 / 错别字';
      kpPaint();
    };
    $('#mpKpPrev').onclick = function () { if (KP.page > 0) { KP.page--; kpPaint(); } };
    $('#mpKpNext').onclick = function () { if ((KP.page + 1) * KP.n < KP.rows.length) { KP.page++; kpPaint(); } };
    $('#mpKpAdd').onclick = kpOutline;
    $('#mpKpAi').onclick = kpAiOpen;
    $('#mpKpUp').onclick = kpAttPick;
    /* 左缘拖宽（样板 kpRz），宽度记在 localStorage */
    (function () {
      var rz = $('#mpKpRz'); if (!rz) return;
      var d = null;
      try { var w0 = +readLS('qbank.map.kpw.v1', 0); if (w0 > 200) $('#mpKp').style.width = w0 + 'px'; } catch (e0) {}
      rz.addEventListener('pointerdown', function (e) {
        var kp = $('#mpKp'); if (!kp) return;
        d = { x: e.clientX, w: kp.getBoundingClientRect().width };
        try { rz.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault(); e.stopPropagation();
      });
      rz.addEventListener('pointermove', function (e) {
        if (!d) return;
        var kp = $('#mpKp'); if (!kp) return;
        var w = Math.round(Math.max(280, Math.min(innerWidth - 60, d.w + (d.x - e.clientX))));
        kp.style.width = w + 'px';
      });
      rz.addEventListener('pointerup', function () {
        if (!d) return; d = null;
        try { writeLS('qbank.map.kpw.v1', Math.round($('#mpKp').getBoundingClientRect().width)); } catch (err) {}
      });
    })();
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
    /* 选中一段文字 → 光标旁浮出小工具条（照样板的 rkBar） */
    if (!document.__rktb) {
      document.__rktb = 1;
      document.addEventListener('selectionchange', function () {
        try { rkTbCheck(); } catch (e) {}
      });
      document.addEventListener('pointerdown', function (e) {
        var tb = document.getElementById('mpRkTb');
        if (tb && tb.classList.contains('show') && !e.target.closest('#mpRkTb')) {
          var el = rteEl();
          if (!el || !el.contains(e.target)) rkTbHide();
        }
      }, true);
    }
  }

  /* 选中文字浮条 */
  function rkTbEnsure() {
    var b = document.getElementById('mpRkTb');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'mpRkTb';
    b.innerHTML = [
      '<button type="button" data-cmd="bold" title="加粗（Ctrl+B）"><b>B</b></button>',
      '<button type="button" data-cmd="italic" title="斜体（Ctrl+I）"><i>I</i></button>',
      '<button type="button" data-cmd="underline" title="下划线（Ctrl+U）"><u>U</u></button>',
      '<span class="mp-rksep"></span>',
      '<button type="button" data-block="h2" title="换成小标题">H</button>',
      '<button type="button" data-block="ul" title="换成列表">☰</button>',
      '<button type="button" data-block="quote" title="换成引用">❝</button>',
      '<button type="button" data-block="code" title="换成代码块">{ }</button>',
      '<span class="mp-rksep"></span>',
      '<button type="button" data-cmd="removeFormat" title="清掉格式">⌫</button>'
    ].join('');
    document.body.appendChild(b);
    b.addEventListener('mousedown', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      e.preventDefault();
      if (btn.dataset.cmd) rteCmd(btn.dataset.cmd);
      else if (btn.dataset.block) rteBlock(btn.dataset.block);
      rkTbHide();
    });
    return b;
  }
  function rkTbHide() {
    var b = document.getElementById('mpRkTb');
    if (b) b.classList.remove('show');
  }
  function rkTbCheck() {
    var el = rteEl();
    var b = document.getElementById('mpRkTb');
    if (!el) { if (b) b.classList.remove('show'); return; }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { if (b) b.classList.remove('show'); return; }
    var node = sel.anchorNode;
    if (!node || !el.contains(node)) { if (b) b.classList.remove('show'); return; }
    if (!String(sel.toString() || '').trim()) { if (b) b.classList.remove('show'); return; }
    var r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r || (!r.width && !r.height)) { if (b) b.classList.remove('show'); return; }
    var tb = rkTbEnsure();
    tb.classList.add('show');
    var bw = tb.offsetWidth || 250, bh = tb.offsetHeight || 36;
    tb.style.left = Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2)) + 'px';
    var top = r.top - bh - 8;
    if (top < 64) top = r.bottom + 8;
    tb.style.top = top + 'px';
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
    var exp = rows.map(function (q) { return String(q.exp || q.explain || q.expl || '').replace(/^解析[:：]/, '').trim(); }).filter(Boolean)[0];
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
    var qa = $('#mpKpQai'); if (qa) qa.classList.remove('on');
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
    var raw = KP.q;
    var ai = !!($('#mpKpQai') && $('#mpKpQai').classList.contains('on'));
    var q = srHay(raw);
    KP.rows = q ? all.filter(function (x) {
      var opts = Array.isArray(x.opts) ? x.opts : (Array.isArray(x.options) ? x.options : []);
      var hay = [x.stem, opts.join(' '), x.exp || x.explain || x.expl || x.analysis || ''].join(' ');
      return srScore(hay, q, ai) > 0;
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
    }).join('') : '<div class="mp-kempty">' + (q ? ('没搜到「' + esc(raw) + '」' + (ai ? '' : '，可以试试 ✨')) : '这个考点还没有题') + '</div>';
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
    $('#mfList').addEventListener('dragstart', function (e) {
      var r = e.target.closest('.mfrow'); if (!r) { try { e.preventDefault(); } catch (err) {} return; }
      try {
        e.dataTransfer.setData('text/fid', r.dataset.id);
        e.dataTransfer.setData('text/plain', 'fid:' + r.dataset.id);
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) {}
    });
    $('#mfList').addEventListener('dragend', function () { try { dzReset(); } catch (e) {} });
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
      return '<div class="mfrow" data-id="' + f.id + '" draggable="true" title="拖到画布上 = 挂成资料节点">' +
        '<i class="mfi">' + fIcon(f) + '</i>' +
        '<span class="mfn">' + esc(String(f.name).slice(0, 16)) + '</span>' +
        '<span class="mfs">' + fSize(f.size || 0) + '</span>' +
        '<button type="button" class="mfd" title="删掉">✕</button></div>';
    }).join('') : '<div class="mfe">把图片 / PDF / HTML 拖进脑图，或点上面 ＋ 上传<br><i>放进资料柜后，还能把文件从柜子拖到画布上摆着</i></div>';
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
        '<span class="mpvzl" id="mpPvZL">100%</span>' +
        '<button type="button" id="mpPvOut" title="缩小">−</button>' +
        '<button type="button" id="mpPvIn" title="放大">+</button>' +
        '<button type="button" id="mpPvBig" title="铺满窗口看">⤢</button>' +
        '<a id="mpPvSys" target="_blank" rel="noreferrer" title="用系统默认程序打开这份资料">↗</a>' +
        '<a id="mpPvTab" target="_blank" rel="noreferrer" title="在新标签打开">新标签</a>' +
        '<button type="button" id="mpPvX" title="关闭">✕</button></div>' +
        '<div class="mpvb" id="mpPvB"></div>' +
        '<i class="mpvrz" id="mpPvRz" title="拖动改大小"></i>';
      $('#mpWrap').appendChild(p);
      $('#mpPvX').onclick = function () { p.classList.remove('show'); };
      $('#mpPvBig').onclick = function () { var c = p.dataset.cur; if (c) vwOpen(c); };
      /* 预览里缩放内容：− / + / 滚轮，比例记在数据集上 */
      var pvZ = function (v) {
        if (v == null) v = (+p.dataset.z || 1);
        v = Math.max(0.35, Math.min(3, v));
        p.dataset.z = v;
        var w = p.querySelector('.mpvwrap');
        if (w) w.style.zoom = v;
        var l = $('#mpPvZL'); if (l) l.textContent = Math.round(v * 100) + '%';
      };
      $('#mpPvOut').onclick = function () { pvZ((+p.dataset.z || 1) - 0.15); };
      $('#mpPvIn').onclick = function () { pvZ((+p.dataset.z || 1) + 0.15); };
      $('#mpPvB').addEventListener('wheel', function (e) {
        e.preventDefault();
        pvZ((+p.dataset.z || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      }, { passive: false });
      /* 右下角拖大小 */
      var rz = p.querySelector('#mpPvRz'), rzD = null;
      rz.addEventListener('pointerdown', function (e) {
        var r = p.getBoundingClientRect();
        rzD = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
        p.style.right = 'auto'; p.style.bottom = 'auto';
        try { rz.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault(); e.stopPropagation();
      });
      rz.addEventListener('pointermove', function (e) {
        if (!rzD) return;
        p.style.width = Math.max(240, Math.min(innerWidth - 40, rzD.w + e.clientX - rzD.x)) + 'px';
        p.style.height = Math.max(180, Math.min(innerHeight - 60, rzD.h + e.clientY - rzD.y)) + 'px';
      });
      rz.addEventListener('pointerup', function () { rzD = null; });
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
    p.dataset.z = 1;
    $('#mpPvN').textContent = String(f.name).slice(0, 22);
    $('#mpPvB').innerHTML = '<div class="mpvwrap" style="zoom:1">' + pvHtml(f) + '</div>';
    var zl = $('#mpPvZL'); if (zl) zl.textContent = '100%';
    try { $('#mpPvSys').href = f.url || ''; } catch (e) {}
    try { $('#mpPvTab').href = f.url || ''; } catch (e) {}
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
        '<span class="mpvzl" id="mpVwZL">100%</span>' +
        '<button type="button" id="mpVwOut" title="缩小">−</button>' +
        '<button type="button" id="mpVwIn" title="放大">+</button>' +
        '<button type="button" id="mpVwFit" title="铺满宽度">适应</button>' +
        '<a id="mpVwOpen" target="_blank" rel="noreferrer">↗ 系统打开</a>' +
        '<a id="mpVwTab" target="_blank" rel="noreferrer">新标签</a>' +
        '<button type="button" id="mpVwX" title="关闭">✕</button></div>' +
        '<div class="mpvwb" id="mpVwB"></div>';
      document.body.appendChild(v);
      $('#mpVwX').onclick = function () { v.classList.remove('show'); };
      v.addEventListener('click', function (e) { if (e.target === v) v.classList.remove('show'); });
      /* 大图里也能缩放：− / + / 适应 / 滚轮 */
      var vwZ = function (nv) {
        if (nv == null) nv = (+v.dataset.z || 1);
        nv = Math.max(0.25, Math.min(6, nv));
        v.dataset.z = nv;
        var w = v.querySelector('.mpvwrap2');
        if (w) w.style.zoom = nv;
        var l = $('#mpVwZL'); if (l) l.textContent = Math.round(nv * 100) + '%';
      };
      v.__z = vwZ;
      $('#mpVwOut').onclick = function () { vwZ((+v.dataset.z || 1) - 0.2); };
      $('#mpVwIn').onclick = function () { vwZ((+v.dataset.z || 1) + 0.2); };
      $('#mpVwFit').onclick = function () {
        var w = v.querySelector('.mpvwrap2'); if (!w) return;
        var img = w.querySelector('img');
        v.dataset.z = 1;
        if (img && img.naturalWidth) {
          var bw = $('#mpVwB').clientWidth - 28;
          vwZ(Math.max(0.25, Math.min(6, bw / img.naturalWidth)));
        } else { vwZ(1); }
      };
      $('#mpVwB').addEventListener('wheel', function (e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        vwZ((+v.dataset.z || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      }, { passive: false });
    }
    $('#mpVwN').textContent = String(f.name).slice(0, 40);
    $('#mpVwOpen').href = f.url;
    try { $('#mpVwTab').href = f.url; } catch (e) {}
    v.dataset.z = 1;
    $('#mpVwB').innerHTML = '<div class="mpvwrap2" style="zoom:1">' + pvHtml(f) + '</div>';
    var zl = $('#mpVwZL'); if (zl) zl.textContent = '100%';
    v.classList.add('show');
    try {
      var im = $('#mpVwB img');
      if (im) {
        im.addEventListener('dblclick', function () {
          var w = $('#mpVwB'); var cur = (+v.dataset.z || 1);
          if (v.__z) v.__z(cur > 1.05 ? 1 : Math.min(6, (w.clientWidth - 28) / (im.naturalWidth || w.clientWidth)));
        });
      }
    } catch (e) {}
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
          '<div class="mp-pknote" id="mpPickNote" hidden>AI 模式：允许错别字（兰尾→阑尾）、近义词（心梗→心肌梗死）和拆字匹配；变式题不能当中心题。</div>' +
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
        var nt = m.querySelector('#mpPickNote');
        if (nt) nt.hidden = !PICK.ai;
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
    var nt0 = m.querySelector('#mpPickNote');
    if (nt0) nt0.hidden = !PICK.ai;
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
    var qn = (typeof norm === 'function') ? norm(PICK.q) : q;
    /* AI 模式：先过同义/简写（心梗→心肌梗死…），再过拆字模糊，跟搜索器同一套 */
    var alts = [];
    if (PICK.ai && qn && typeof srAlts === 'function') { try { alts = srAlts(qn) || []; } catch (e) {} }
    var rows = pool.map(function (x) {
      var hay0 = String(x.stem || '') + ' ' + (qTags(x) || []).join(' ') + ' ' + String(x.explain || x.exp || '');
      var hay = hay0.toLowerCase();
      if (!q) return { x: x, s: 1 };
      if (hay.indexOf(q) >= 0) return { x: x, s: 100 };
      if (!PICK.ai) return null;
      var hn = (typeof norm === 'function') ? norm(hay0) : hay;
      for (var a = 0; a < alts.length; a++) if (alts[a] && hn.indexOf(norm(alts[a])) >= 0) return { x: x, s: 60 };
      var sc = (typeof srScore === 'function') ? srScore(hay, qn, true) : 0;
      return sc > 0 ? { x: x, s: sc } : null;
    }).filter(Boolean).sort(function (m1, m2) { return m2.s - m1.s; }).slice(0, 40).map(function (m) { return m.x; });
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
  /* 「出变式题」：不编题目内容（题库纪律：不自行改写题干 / 不造解析），
     只挂一张标了「草稿」的变式占位卡，点开就能看到这张卡该怎么改。 */
  function makeVarDraft(n) {
    if (!n || (n.type !== 'center' && n.type !== 'sim') || !n.ref) { toast('只有题目节点能出变式'); return; }
    var has = DATA.nodes.filter(function (x) { return x.type === 'variant' && x.ref === n.ref; });
    if (has.length) { toast('这类变式卡已经有一张了，点它看改法'); try { sideOpen(has[0]); } catch (e) {} return; }
    var ox = n.x + 250, oy = n.y + 150;
    for (var i = 0; i < 6; i++) {
      var free = true;
      for (var j = 0; j < DATA.nodes.length; j++) {
        if (Math.abs(DATA.nodes[j].x - ox) < 230 && Math.abs(DATA.nodes[j].y - oy) < 140) { free = false; break; }
      }
      if (free) break;
      ox += 230;
    }
    snap();
    var id = 'v' + Date.now().toString(36) + Math.floor(Math.random() * 99);
    DATA.nodes.push({ id: id, type: 'variant', ref: n.ref, refId: n.ref && n.ref.id, label: '变式草稿 · 换问法', x: ox, y: oy, draft: true, score: 0 });
    DATA.edges.push({ a: n.id, b: id, kind: 'variant' });
    try { saveCur(); } catch (e) {}
    render();
    toast('已挂一张「变式草稿」：点开看三种改法（不自动编题目）', 3000);
  }
  function ctxShow(x, y, n) {
    if (!CTX) {
      CTX = document.createElement('div');
      CTX.id = 'mpCtx';
      document.body.appendChild(CTX);
      CTX.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    }
    var isVar = n && n.type === 'variant';
    var isTag = n && n.type === 'tag';
    var isFile = n && n.type === 'file';
    var isCen = n && n.type === 'center';
    var isNote = n && n.type === 'note';
    var isQ = n && (n.type === 'center' || n.type === 'sim' || n.type === 'variant');
    /* 中心题给「换个中心题」，相似题给「以它为中心」，变式题不能当中心（跟样板一致） */
    var centerBtn = !n ? '' : isCen ? '<button data-c="pick">🔄 换个中心题（搜索 / AI）…</button>'
      : isVar ? '<button disabled>🎯 AI 变式题不能当中心题</button>'
        : (n.type === 'sim' ? '<button data-c="center">🎯 以这道题为中心</button>' : '');
    CTX.innerHTML = n ? (
      (isFile ? '<button data-c="view">📂 就地看着</button>' +
                '<button data-c="tab">↗ 新标签打开</button>'
              : centerBtn +
                (isQ ? '<button data-c="ai">✨ 分析考点（AI）</button>' +
                       '<button data-c="var">✨ 出变式题（AI）</button>' : '')) +
      (isNote ? '<button data-c="focus">🔍 聚焦到这里</button>' : '<button data-c="focus">🔍 聚焦到这里</button>') +
      '<button data-c="link">🔗 从这里连线</button>' +
      '<button data-c="pin">' + (n.pinned ? '📌 取消固定' : '📌 固定位置') + '</button>' +
      (isTag ? '<button data-c="kp">📚 打开考点工作台</button>' : '') +
      '<div class="sep"></div>' +
      '<button data-c="del" class="danger">🗑 ' + (isFile ? '从画布移除' : '删除节点') + '</button>'
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
      if (act === 'view' || act === 'tab') {
        var fv = (typeof fById === 'function') ? fById(n.fid) : null;
        if (!fv) { toast('文件已经不在资料柜里了', 2000, 'warn'); return; }
        if (act === 'view') { try { vwOpen(fv.id); } catch (e) {} }
        else { try { var wv = window.open(fv.url, '_blank'); if (wv) wv.opener = null; } catch (e) {} }
        return;
      }
      if (act === 'pick') {
        try { pickOpen(); } catch (e) {}
        return;
      }
      if (act === 'ai') {
        try {
          var tg2 = (typeof kpTags === 'function' && n.ref) ? kpTags(n.ref) : [];
          if (tg2.length) kpAiOpen(tg2[0]);
          else toast('这道题还没有考点标签，先在答题页打个标签', 2600);
        } catch (e) {}
        return;
      }
      if (act === 'var') {
        try { makeVarDraft(n); } catch (e) {}
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
