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
  var LAY_RINGS = [];   /* 分层（同心环）当前每一圈的半径与层号，画参考圈用 */
  /* 三种排法：网格（严格行列）、树形（横向思维导图，左右分叉）、放射（从中心往外散开）。
     分层 / 力导向已下线，老存盘里的名字统一映射到网格。 */
  var LAYOUTS = [
    { k: 'grid', n: '网格' },
    { k: 'tree', n: '树形' },
    { k: 'free', n: '自排' }
  ];
  /* 老存档里的名字映射到新名字（环形→放射、分栏→树形） */
  var LAY_ALIAS = { grid: 'grid', tree: 'tree', free: 'free', radial: 'free', ring: 'free', layer: 'grid', force: 'grid', columns: 'tree', matrix: 'grid', rows: 'grid' };
  function layName(k) { return LAY_ALIAS[k] || 'grid'; }
  var S = { on: false, min: false, x: null, y: null, w: null, h: null, bankId: '', qid: '' };
  var V = { tx: 0, ty: 0, k: 1 };
  var DATA = { nodes: [], edges: [] };
  var LAY = { name: 'grid' };
  var MAXP = null;
  var LAST_DRAG_AT = 0;
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
    var key = (q && q._bank ? q._bank : bankId) + '#' + (q && q.id);
    /* 站里的标签真正存在 qbank.tags.v1，入口是 window.tagsOf(key)；直接读 LS 在不同版本上会读空 */
    try { if (typeof window.tagsOf === 'function') { var a = window.tagsOf(key); if (a && a.length) return a.slice(); } } catch (e0) {}
    try { var all = readLS('qbank.tags.v1', {}) || {}; var t = all[key]; if (Array.isArray(t) && t.length) return t; } catch (e1) {}
    var fallbacks = [q && q.tags, q && q.kp, q && q.tag];
    for (var i = 0; i < fallbacks.length; i++) if (Array.isArray(fallbacks[i]) && fallbacks[i].length) return fallbacks[i];
    return [];
  }

  /* ---------- 数据：以某题为圆心算相似 ---------- */
  /* 全部题库的题摊平（相似题默认跨题库找）：每题带上 _bank / _bname，方便切中心和显示来源 */
  var QPOOL_CACHE = { sig: '', list: null };
  function allQPool() {
    var banks0 = [];
    try { banks0 = (typeof allBanks === 'function') ? allBanks() : []; } catch (e9) { banks0 = []; }
    var sig = banks0.map(function (b) { return b.id + ':' + ((b.questions || []).length); }).join(',');
    if (QPOOL_CACHE.list && QPOOL_CACHE.sig === sig) return QPOOL_CACHE.list;
    var out = [];
    var banks = [];
    try { banks = (typeof allBanks === 'function') ? allBanks() : []; } catch (e0) { banks = []; }
    if (!banks.length) { try { banks = [bankById(S.bankId)]; } catch (e1) {} }
    banks.forEach(function (b) {
      if (!b || !b.questions) return;
      if (b.questions[0] && b.questions[0]._bank) { b.questions.forEach(function (q) { out.push(q); }); return; }
      b.questions.forEach(function (q) {
        if (!q || !q.stem) return;
        if (!q._bank) { try { q._bank = b.id; q._bname = b.title || b.name || ''; } catch (e2) {} }
        out.push(q);
      });
    });
    QPOOL_CACHE = { sig: sig, list: out };
    return out;
  }

  /* 每题的 2-gram 向量缓存：按「题号 + 题干长度」做签名，题目没变就不重算 */
  var QVCACHE = Object.create(null);
  function qvec(q) {
    var sig = String(q.id) + ':' + String(q.stem || '').length;
    var c = QVCACHE[sig];
    if (!c) { c = { v: grams(norm(qText(q))) }; QVCACHE[sig] = c; if (Object.keys(QVCACHE).length > 4000) QVCACHE = Object.create(null); }
    return c.v;
  }

  function build(bank, q) {
    var pool = allQPool().filter(function (x) { return x && x.stem; });
    if (!pool.length) pool = (bank.questions || []).filter(function (x) { return x && x.stem; });
    var curG = grams(norm(qText(q))), curTags = tagList(q, bank.id);
    var df = Object.create(null), n = pool.length, vecs = [], i;
    for (i = 0; i < n; i++) {
      var v = qvec(pool[i]);
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

    var curG2 = grams(norm(qText(q)), true), curOpt = grams(norm((q.options || []).join(' ')));
    /* 页面上显示的那个百分比只按「题干」算：题干几乎一样的两道题，算出来就是 85–95%，
       不会因为解析长短把百分比稀释掉 */
    var curStem = grams(norm(String(q.stem || '')));
    var cand = [];
    for (i = 0; i < n; i++) {
      if (String(pool[i].id) === String(q.id)) continue;
      var sim = cos(curG, vecs[i]);
      var tj = jac(curTags, tagList(pool[i], (pool[i]._bank || bank.id)));
      /* 选项说法像不像：同考点题常把干扰项换个说法，题干余弦抓不到这层 */
      var oj = 0;
      try { oj = cos(curOpt, grams(norm((pool[i].options || []).join(' ')))); } catch (eO) { oj = 0; }
      var sc = sim + 0.35 * tj + 0.12 * oj;
      /* 显示的百分比 = 真实相似度（题干余弦为主，标签/选项各加一点），不是「跟最像的那道比」
         用户要求：低于 75% 的不上图 */
      var stC = 0;
      try { stC = cos(curStem, grams(norm(String(pool[i].stem || '')))); } catch (eS) { stC = sim; }
      var pct = Math.round(Math.max(0, Math.min(0.99, stC + 0.06 * tj)) * 100);
      if (pct >= 75) cand.push({ q: pool[i], sim: sim, score: sc, pct: pct });
    }
    cand.sort(function (a, b) { return b.score - a.score; });
    cand.sort(function (a, b) { return b.pct - a.pct; });
    cand = cand.slice(0, 6);
    var mx = cand.length ? cand[0].score : 1;

    var nodes = [{ id: 'c', type: 'center', ref: q, x: 0, y: 0, label: q.stem }];
    var edges = [];
    var simQ = [];   /* 相似题的题目对象：用来判断它和考点是不是同一个标签 */
    cand.forEach(function (it, idx) {
      var rel = it.pct / 100;
      var id = 's' + idx;
      nodes.push({ id: id, type: 'sim', ref: it.q, label: it.q.stem, xbk: (it.q._bank || bank.id), score: it.pct });
      edges.push({ a: 'c', b: id, kind: 'sim', w: rel });
      simQ.push({ id: id, q: it.q });
    });
    curTags.filter(function (x) { return !isBigTag(x); }).slice(0, 4).forEach(function (t, idx) {
      var id = 't' + idx;
      nodes.push({ id: id, type: 'tag', ref: t, label: t, x: 0, y: 0 });
      edges.push({ a: 'c', b: id, kind: 'tag', w: 0.5 });
    });
    /* 同一个考点的相似题，也要连到那个考点（之前只有中心题连，看着像别的题跟考点没关系） */
    var tagNodes = nodes.filter(function (n2) { return n2.type === 'tag'; });
    simQ.forEach(function (sn) {
      var st = tagList(sn.q, bank.id).map(norm);
      if (!st.length) return;
      tagNodes.forEach(function (tn) {
        if (st.indexOf(norm(tn.label)) >= 0) edges.push({ a: sn.id, b: tn.id, kind: 'tag', w: 0.42 });
      });
    });
    return { nodes: nodes, edges: edges };
  }

  /* ---------- 布局 ---------- */
  /* ---- 力学布局内核（照 d3-force 的写法：alpha 衰减 + 弹簧 / 库伦斥力 / 矩形碰撞 / 径向约束）----
     参考的两个方案：force.js 的 F=k/r^2 与 k(d-L) 弹簧，d3 的 forceCollide/forceLink/forceRadial。
     节点用「卡片真实尺寸」参与斥力和碰撞：大卡自然把旁边的小卡推得更开。 */
  function mpSim(nodesArr, edges, radial, ticks) {
    var N = nodesArr.length, idx = Object.create(null);
    nodesArr.forEach(function (n, i) { idx[n.id] = i; n.vx = 0; n.vy = 0; });
    var links = [];
    (edges || []).forEach(function (e) {
      var s = idx[e.a], t = idx[e.b];
      if (s == null || t == null || s === t) return;
      links.push({ s: s, t: t, w: (e.w == null ? 0.5 : e.w) });
    });
    var deg = new Array(N); for (var z = 0; z < N; z++) deg[z] = 0;
    links.forEach(function (l) { deg[l.s]++; deg[l.t]++; });
    var alpha = 1, decay = 1 - Math.pow(0.0015, 1 / Math.max(60, ticks || 300));
    var iters = ticks || 300;
    for (var it = 0; it < iters; it++) {
      alpha += (0 - alpha) * decay;

      /* 弹簧：相似度越高、期望长度越短；两端连接多的节点被拉得轻一点（d3 forceLink 的做法） */
      links.forEach(function (l) {
        var A = nodesArr[l.s], B = nodesArr[l.t];
        var dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
        var want = 330 - 150 * l.w;
        var k = (d - want) / d * alpha * 0.55 / Math.max(1, Math.min(deg[l.s], deg[l.t]));
        A.vx += dx * k; A.vy += dy * k;
        B.vx -= dx * k; B.vy -= dy * k;
      });

      /* 斥力 + 矩形碰撞：斥力按两张卡的面积加权（大卡推得远） */
      for (var i = 0; i < N; i++) {
        var A2 = nodesArr[i];
        for (var j = i + 1; j < N; j++) {
          var B2 = nodesArr[j];
          var dx2 = B2.x - A2.x, dy2 = B2.y - A2.y;
          var d2 = dx2 * dx2 + dy2 * dy2, dd = Math.sqrt(d2) || 1;
          var area = (A2.w * A2.h + B2.w * B2.h) / 90000;
          var f = area * alpha * 1500 / Math.max(900, d2);
          A2.vx -= dx2 / dd * f; A2.vy -= dy2 / dd * f;
          B2.vx += dx2 / dd * f; B2.vy += dy2 / dd * f;
          var ox = (A2.w + B2.w) / 2 + 16 - Math.abs(dx2);
          var oy = (A2.h + B2.h) / 2 + 12 - Math.abs(dy2);
          if (ox > 0 && oy > 0) {
            if (ox < oy) { var mx = ox / 2 + 0.5, sx2 = dx2 >= 0 ? 1 : -1; A2.x -= sx2 * mx; B2.x += sx2 * mx; }
            else { var my = oy / 2 + 0.5, sy2 = dy2 >= 0 ? 1 : -1; A2.y -= sy2 * my; B2.y += sy2 * my; }
            A2.vx *= 0.6; A2.vy *= 0.6; B2.vx *= 0.6; B2.vy *= 0.6;
          }
        }
      }

      /* 径向约束：每层的卡片被拉回自己那一圈（d3 forceRadial） */
      for (var q = 0; q < N; q++) {
        var n = nodesArr[q], rr = radial[n.id];
        if (rr != null) {
          var rd = Math.hypot(n.x, n.y) || 1;
          var k2 = (rr - rd) * alpha * 0.30;
          n.vx += n.x / rd * k2; n.vy += n.y / rd * k2;
        }
        /* 限速：弹簧/斥力在某些极端图上会数值发散，夹住就好 */
        n.vx = Math.max(-80, Math.min(80, n.vx));
        n.vy = Math.max(-80, Math.min(80, n.vy));
        n.x += n.vx; n.y += n.vy;
        if (!isFinite(n.x) || !isFinite(n.y)) { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; }
        n.x = Math.max(-40000, Math.min(40000, n.x));
        n.y = Math.max(-40000, Math.min(40000, n.y));
        n.vx *= 0.58; n.vy *= 0.58;
      }
    }
  }

  /* 收尾：只把互相压住的卡片沿最短方向推开，不再加别的力（层、半径都不动） */
  function finalCollide(arr, iters) {
    for (var t = 0; t < (iters || 120); t++) {
      var hit = false;
      for (var i = 0; i < arr.length; i++) {
        for (var j = i + 1; j < arr.length; j++) {
          var A = arr[i], B = arr[j];
          var dx = B.x - A.x, dy = B.y - A.y;
          var ox = (A.w + B.w) / 2 + 14 - Math.abs(dx);
          var oy = (A.h + B.h) / 2 + 10 - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy) {
            var mx = (ox / 2 + 0.5) * (dx >= 0 ? 1 : -1);
            A.x -= mx; B.x += mx;
          } else {
            var my = (oy / 2 + 0.5) * (dy >= 0 ? 1 : -1);
            A.y -= my; B.y += my;
          }
          hit = true;
        }
      }
      if (!hit) break;
    }
  }

  function layoutPositions(name) {
    var ns = DATA.nodes;
    /* 自排：谁也不动，就按现在的位置（自己一张张挪）。只有刚加进来、还没坐标的才先随便找个圈放 */
    if (name === 'free') {
      var fo = {}, fn = 0, fx = 0;
      ns.forEach(function (n) { if (isFinite(n.x) && isFinite(n.y)) { fo[n.id] = { x: n.x, y: n.y }; fn++; fx += n.x; } });
      var fmiss = ns.filter(function (n) { return !fo[n.id]; });
      var fcx = fn ? fx / fn : 0, fcy = 0;
      fmiss.forEach(function (n, i) {
        var a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, fmiss.length);
        fo[n.id] = { x: Math.round(fcx + Math.cos(a) * 420), y: Math.round(fcy + Math.sin(a) * 420) };
      });
      return fo;
    }
    var c = ns.filter(function (n) { return n.type === 'center'; })[0];
    var sims = ns.filter(function (n) { return n.type === 'sim'; });
    var tags = ns.filter(function (n) { return n.type === 'tag'; });
    var out = {};
    if (c) out[c.id] = { x: 0, y: 0 };
    var R = 340;

    if (name === 'tree') {
      /* 树形 = 横向「思维导图」：根在最左，每往下一层就向右一列；
         兄弟按相似度从上往下排，父节点永远落在它孩子们的正中间（Reingold–Tilford 的简化版）。
         连线只往右走，不会像径向树那样绕回去，所以看着干净。 */
      var tNodesAll = DATA.nodes;
      var tTags = tNodesAll.filter(function (n) { return n.type === 'tag'; });
      var tQ = tNodesAll.filter(function (n) { return n.type !== 'tag'; });
      var tBy = Object.create(null);
      tNodesAll.forEach(function (n) { tBy[n.id] = n; });
      var tAdj = Object.create(null);
      tQ.forEach(function (n) { tAdj[n.id] = []; });
      DATA.edges.forEach(function (e) {
        if (!tAdj[e.a] || !tAdj[e.b]) return;
        tAdj[e.a].push(e.b); tAdj[e.b].push(e.a);
      });
      var tRoot = c ? c.id : (tQ[0] ? tQ[0].id : '');
      var tPar = Object.create(null), tDep = Object.create(null), tOrd = [];
      if (tRoot) { tDep[tRoot] = 0; tOrd.push(tRoot); }
      for (var ti = 0; ti < tOrd.length; ti++) {
        var tcur = tOrd[ti];
        var tns = (tAdj[tcur] || []).slice();
        tns.sort(function (p, q2) {
          var sp = (tBy[p] && tBy[p].score) || 0, sq = (tBy[q2] && tBy[q2].score) || 0;
          return sq - sp;
        });
        for (var tn2 = 0; tn2 < tns.length; tn2++) {
          var nx2 = tns[tn2];
          if (tDep[nx2] != null) continue;
          tDep[nx2] = tDep[tcur] + 1; tPar[nx2] = tcur; tOrd.push(nx2);
        }
      }
      var tMaxDep = 0;
      tQ.forEach(function (n) {
        if (tDep[n.id] == null) { tDep[n.id] = 0; tPar[n.id] = null; }
        tMaxDep = Math.max(tMaxDep, tDep[n.id]);
      });
      var tKids = Object.create(null);
      tQ.forEach(function (n) { tKids[n.id] = []; });
      tQ.forEach(function (n) { var p2 = tPar[n.id]; if (p2 && tKids[p2]) tKids[p2].push(n.id); });
      var rLeafCnt = Object.create(null);
      var leafCountOf = function (id) {
        var ks = tKids[id] || [];
        if (!ks.length) { rLeafCnt[id] = 1; return 1; }
        var sum2 = 0; ks.forEach(function (k2) { sum2 += leafCountOf(k2); });
        rLeafCnt[id] = sum2; return sum2;
      };
      if (tRoot) leafCountOf(tRoot);
      /* 后序：叶子按顺序往下排，父节点取孩子的中位 */
      var tY = Object.create(null), tCursor = 0, LEAFG = 96;
      var tPlace = function (id) {
        var ks = tKids[id] || [];
        if (!ks.length) { tY[id] = tCursor; tCursor += LEAFG; return tY[id]; }
        var ys = ks.map(tPlace);
        var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
        tY[id] = (lo + hi) / 2; return tY[id];
      };
      if (tRoot) tPlace(tRoot);
      /* 没挂上的人单独摆一列，别丢 */
      var tLoose = tQ.filter(function (n) { return tY[n.id] == null; });
      tLoose.forEach(function (n) { tY[n.id] = tCursor; tCursor += LEAFG; tDep[n.id] = 1; });
      /* 左右分会：第 1 层的分支一半往左、一半往右，整棵树高度减半，也才像张开的树 */
      var tSide = Object.create(null);
      var roots1 = (tKids[tRoot] || []).slice();
      /* 左右两边按「叶子数」均衡分（贪心），不然一边压得满满当当、另一边空着 */
      roots1.sort(function (p, q3) { return (rLeafCnt[q3] || 0) - (rLeafCnt[p] || 0); });
      var sideLoad = { '1': 0, '-1': 0 };
      roots1.forEach(function (id) {
        var sd0 = (sideLoad['1'] <= sideLoad['-1']) ? 1 : -1;
        tSide[id] = sd0; sideLoad[sd0] += (rLeafCnt[id] || 1);
      });
      var sideOf = function (id) {
        var cur3 = id, guard = 0;
        while (cur3 && tSide[cur3] == null && guard++ < 40) cur3 = tPar[cur3];
        return (cur3 && tSide[cur3] != null) ? tSide[cur3] : 1;
      };
      var COLX = 332;
      var tMaxY = 0;
      tQ.forEach(function (n) {
        var sd = (n.id === tRoot) ? 1 : sideOf(n.id);
        out[n.id] = { x: Math.round(tDep[n.id] * COLX * sd), y: Math.round(tY[n.id]) };
        tMaxY = Math.max(tMaxY, tY[n.id]);
      });
      /* 考点：最右一列，等距排齐 */
      if (tTags.length) {
        var tagX = (tMaxDep + 1) * COLX;
        var gapT = Math.max(96, Math.round((tMaxY || 1) / Math.max(1, tTags.length)));
        tTags.forEach(function (n, i2) {
          out[n.id] = { x: tagX, y: Math.round(i2 * gapT) };
        });
      }
      /* 整体居中 */
      var txs = [], tys = [];
      Object.keys(out).forEach(function (id) { txs.push(out[id].x); tys.push(out[id].y); });
      var tcx = (Math.min.apply(null, txs) + Math.max.apply(null, txs)) / 2;
      var tcy = (Math.min.apply(null, tys) + Math.max.apply(null, tys)) / 2;
      Object.keys(out).forEach(function (id) { out[id] = { x: Math.round(out[id].x - tcx), y: Math.round(out[id].y - tcy) }; });
      LAY_RINGS.length = 0;
    } else if (name === 'layer') {
      /* 分层 = 同心环：第 k 层是从中心往外点 k 下的那一圈（k-hop），四面铺开、不挤在一行；
         同层顺序按「上一层邻居的平均角度」排（Sugiyama 重心法 / GNN 邻域聚合的顺序版），
         这样每个孩子都落在它父母所在的方位，线基本不交叉。 */
      var tagNodes = DATA.nodes.filter(function (n) { return n.type === 'tag'; });
      var qnodes = DATA.nodes.filter(function (n) { return n.type !== 'tag'; });
      var adj = Object.create(null);
      qnodes.forEach(function (n) { adj[n.id] = []; });
      DATA.edges.forEach(function (e) {
        if (!adj[e.a] || !adj[e.b]) return;
        adj[e.a].push(e.b); adj[e.b].push(e.a);
      });
      var depth = Object.create(null), queue = [c ? c.id : 'c'];
      if (!adj[queue[0]]) queue = (qnodes[0] ? [qnodes[0].id] : []);
      if (queue.length) depth[queue[0]] = 0;
      for (var qi = 0; qi < queue.length; qi++) {
        var cur = queue[qi], dcur = depth[cur];
        (adj[cur] || []).forEach(function (nx) {
          if (depth[nx] == null) { depth[nx] = dcur + 1; queue.push(nx); }
        });
      }
      var maxD = 0;
      qnodes.forEach(function (n) { if (depth[n.id] == null) depth[n.id] = -1; else maxD = Math.max(maxD, depth[n.id]); });
      qnodes.forEach(function (n) { if (depth[n.id] === -1) depth[n.id] = maxD + 1; });

      var widthOf = function (n) {
        if (n.type === 'center') return 300;
        if (n.type === 'tag') return 168;
        if (n.type === 'variant') return 250;
        if (n.type === 'note') return 210;
        if (n.type === 'file') return 190;
        return 268;
      };
      var byDepth = Object.create(null);
      qnodes.forEach(function (n) { n._d = depth[n.id]; (byDepth[depth[n.id]] = byDepth[depth[n.id]] || []).push(n); });

      LAY_RINGS.length = 0;
      var ang = Object.create(null);
      var ringLists = [];
      var prevR = 0;
      var applyRing = function (rl) {
        var step = Math.PI * 2 / rl.nodes.length;
        rl.nodes.forEach(function (n, i) {
          var a = rl.start + step * i;
          out[n.id] = { x: Math.round(Math.cos(a) * rl.r), y: Math.round(Math.sin(a) * rl.r) };
          ang[n.id] = a;
        });
      };
      var depths = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
      depths.forEach(function (d) {
        var list = byDepth[d];
        if (!list || !list.length) return;
        if (d === 0) {
          out[list[0].id] = { x: 0, y: 0 };
          ang[list[0].id] = -Math.PI / 2;
          return;
        }
        /* 每个节点：先算它父母所在方位的「圆弧平均角」 */
        list.forEach(function (n) {
          var ns = adj[n.id] || [], sx = 0, sy = 0, cnt = 0;
          ns.forEach(function (id) {
            if (ang[id] != null && depth[id] != null && depth[id] < d) {
              sx += Math.cos(ang[id]); sy += Math.sin(ang[id]); cnt++;
            }
          });
          n._ba = cnt ? Math.atan2(sy, sx) : null;
        });
        list.sort(function (a, b) {
          if (a._ba == null && b._ba == null) return (b.score || 0) - (a.score || 0);
          if (a._ba == null) return 1;
          if (b._ba == null) return -1;
          return a._ba - b._ba;
        });
        /* 半径：至少要放得下这一圈卡片的宽度，且比里圈大一圈 */
        var wsum = 0;
        list.forEach(function (n) { wsum += widthOf(n) + 34; });
        var needR = wsum / (Math.PI * 2) * 1.12 + 90;
        if (needR < 380) needR = 380;
        var Rr = Math.max(prevR + 300, Math.round(needR));
        var step0 = Math.PI * 2 / list.length;
        var sx2 = 0, sy2 = 0, mc = 0;
        list.forEach(function (n) { if (n._ba != null) { sx2 += Math.cos(n._ba); sy2 += Math.sin(n._ba); mc++; } });
        var startA = -Math.PI / 2;
        if (mc) startA = Math.atan2(sy2, sx2) - step0 * (list.length - 1) / 2;
        var rl = { r: Rr, d: d, nodes: list, start: startA };
        applyRing(rl);
        ringLists.push(rl);
        LAY_RINGS.push({ r: Rr, d: d });
        prevR = Rr;
      });

      /* 考点：不参与分层，接在最外一圈外面，按名字整齐排圈 */
      if (tagNodes.length) {
        /* 考点按「它连着的题所在方位的平均角」排，而不是按名字：
           名字排序会让每根点线横穿整张图；按方位排后考点就落在相关题那一侧，线短、几乎不交叉 */
        var tagAng = Object.create(null);
        tagNodes.forEach(function (n) {
          var sx = 0, sy = 0, cnt = 0;
          DATA.edges.forEach(function (e) {
            if (e.kind !== 'tag') return;
            var other = e.a === n.id ? e.b : (e.b === n.id ? e.a : null);
            if (other == null || ang[other] == null) return;
            sx += Math.cos(ang[other]); sy += Math.sin(ang[other]); cnt++;
          });
          tagAng[n.id] = cnt ? Math.atan2(sy, sx) : Math.PI / 2;
        });
        tagNodes.sort(function (a, b) { return tagAng[a.id] - tagAng[b.id]; });
        var ti = 0, tagRing = 0;
        while (ti < tagNodes.length) {
          var Rt = Math.max(prevR + 300, 430) + tagRing * 250;
          var fit = Math.max(4, Math.floor((Math.PI * 2 * Rt) / 200));
          var chunk = tagNodes.slice(ti, ti + fit);
          var rlT = { r: Rt, d: 'tag' + (tagRing ? ' ' + (tagRing + 1) : ''), nodes: chunk, start: -Math.PI / 2 };
          applyRing(rlT);
          LAY_RINGS.push({ r: Rt, d: rlT.d });
          ti += fit; tagRing++;
          prevR = Rt;
        }
      }

      /* 局部搜索：同一圈里相邻两张卡对调，线变少了就留着（Sugiyama 的 transpose 步） */
      try {
        var crossNow = function () {
          var pts = DATA.nodes.filter(function (n) { return out[n.id]; });
          var seg = [];
          DATA.edges.forEach(function (e) { if (out[e.a] && out[e.b]) seg.push([out[e.a], out[e.b]]); });
          var ccw = function (a, b, c) { return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x); };
          var hit = function (s, t) {
            return ccw(s[0], t[0], s[1]) !== ccw(s[0], t[1], s[1]) && ccw(t[0], s[0], t[1]) !== ccw(t[0], s[1], t[1]);
          };
          var c = 0;
          for (var i0 = 0; i0 < seg.length; i0++) for (var j0 = i0 + 1; j0 < seg.length; j0++) if (hit(seg[i0], seg[j0])) c++;
          return c;
        };
        var best = crossNow();
        for (var pass = 0; !window.__LAYNAIVE && pass < 14 && best > 0; pass++) {
          var moved = false;
          ringLists.forEach(function (rl) {
            for (var k = 0; k + 1 < rl.nodes.length; k++) {
              var a0 = rl.nodes[k], b0 = rl.nodes[k + 1];
              rl.nodes[k] = b0; rl.nodes[k + 1] = a0; applyRing(rl);
              var c2 = crossNow();
              if (c2 < best) { best = c2; moved = true; }
              else { rl.nodes[k] = a0; rl.nodes[k + 1] = b0; applyRing(rl); }
            }
          });
          if (!moved) break;
        }
      } catch (eX) {}
    } else if (name === 'grid') {
      /* 网格：严格的行列对齐（规则图形），行 = 从中心点第几下（k-hop），
         列 = 同层里按「父母的平均列位」排（Sugiyama 重心法），交叉最少、也最整齐 */
      var gTag = DATA.nodes.filter(function (n) { return n.type === 'tag'; });
      var gQ = DATA.nodes.filter(function (n) { return n.type !== 'tag'; });
      var gAdj = Object.create(null);
      gQ.forEach(function (n) { gAdj[n.id] = []; });
      DATA.edges.forEach(function (e) {
        if (!gAdj[e.a] || !gAdj[e.b]) return;
        gAdj[e.a].push(e.b); gAdj[e.b].push(e.a);
      });
      var gDep = Object.create(null), gQ2 = [c ? c.id : 'c'];
      if (!gAdj[gQ2[0]]) gQ2 = (gQ[0] ? [gQ[0].id] : []);
      if (gQ2.length) gDep[gQ2[0]] = 0;
      for (var gi = 0; gi < gQ2.length; gi++) {
        var gcur = gQ2[gi], gd = gDep[gcur];
        (gAdj[gcur] || []).forEach(function (nx) {
          if (gDep[nx] == null) { gDep[nx] = gd + 1; gQ2.push(nx); }
        });
      }
      var gMax = 0;
      gQ.forEach(function (n) { if (gDep[n.id] == null) gDep[n.id] = 1; else gMax = Math.max(gMax, gDep[n.id]); });
      LAY_RINGS.length = 0;
      var byRow = Object.create(null);
      gQ.forEach(function (n) { (byRow[gDep[n.id]] = byRow[gDep[n.id]] || []).push(n); });
      var COLG = 300, ROWG = 178;
      var colOf = Object.create(null);
      var rows = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; });
      var widest = 0;
      rows.forEach(function (r) { widest = Math.max(widest, byRow[r].length); });
      rows.forEach(function (r) {
        var list = byRow[r];
        /* 同层排序：父母的平均列位（没有父母的按相似度） */
        list.forEach(function (n) {
          var ns = gAdj[n.id] || [], sum = 0, cnt = 0;
          ns.forEach(function (id) { if (colOf[id] != null) { sum += colOf[id]; cnt++; } });
          n._bc = cnt ? sum / cnt : 1e6;
        });
        list.sort(function (a, b) {
          if (a._bc !== b._bc) return a._bc - b._bc;
          return (b.score || 0) - (a.score || 0);
        });
        var off = (widest - list.length) / 2;
        list.forEach(function (n, i) {
          var col = i + off;
          colOf[n.id] = col;
          out[n.id] = { x: Math.round(col * COLG), y: Math.round(r * ROWG) };
        });
      });
      /* 考点：最后一行，等距排齐 */
      if (gTag.length) {
        var gRow = gMax + 2, gOff = (widest - gTag.length) / 2;
        gTag.sort(function (a, b) { return String(a.label || '').localeCompare(String(b.label || ''), 'zh'); });
        gTag.forEach(function (n, i) {
          out[n.id] = { x: Math.round((i + gOff) * 168), y: Math.round(gRow * ROWG) };
        });
      }
      /* 整体居中 */
      var gxs = [], gys = [];
      Object.keys(out).forEach(function (id) { gxs.push(out[id].x); gys.push(out[id].y); });
      var gcx = (Math.min.apply(null, gxs) + Math.max.apply(null, gxs)) / 2;
      var gcy = (Math.min.apply(null, gys) + Math.max.apply(null, gys)) / 2;
      Object.keys(out).forEach(function (id) { out[id] = { x: Math.round(out[id].x - gcx), y: Math.round(out[id].y - gcy) }; });
      (function gridCollide() {
        var pk = DATA.nodes.filter(function (n) { return out[n.id]; }).map(function (n) {
          var w = n.type === 'center' ? 300 : n.type === 'tag' ? 168 : 268;
          return { id: n.id, x: out[n.id].x, y: out[n.id].y, w: w, h: n.type === 'center' ? 112 : 100 };
        });
        finalCollide(pk, 90);
        pk.forEach(function (a) { out[a.id] = { x: Math.round(a.x), y: Math.round(a.y) }; });
      })();
    } else if (name === 'force') {
      /* 力导向：中心钉住，其余交给力学内核（弹簧 + 面积加权斥力 + 矩形碰撞） */
      var arrF = sims.concat(tags);
      arrF.forEach(function (n, i) {
        var a = (i / Math.max(1, arrF.length)) * Math.PI * 2;
        out[n.id] = { x: Math.cos(a) * (R + i * 8), y: Math.sin(a) * (R + i * 8) };
      });
      var WofF = function (n) {
        if (n.type === 'center') return 300;
        if (n.type === 'tag') return 168;
        if (n.type === 'variant') return 250;
        return 268;
      };
      var packF = arrF.map(function (n) {
        return { id: n.id, x: out[n.id].x, y: out[n.id].y, w: WofF(n), h: 104 };
      });
      if (c && out[c.id]) packF.push({ id: c.id, x: 0, y: 0, w: 300, h: 116 });
      var radF = Object.create(null);
      var arcF = 0;
      packF.forEach(function (a) { arcF += a.w + 26; });
      var RF = Math.round(Math.max(360, arcF / (Math.PI * 2)));
      packF.forEach(function (a) { radF[a.id] = (a.id === (c && c.id)) ? 0 : RF; });
      mpSim(packF, DATA.edges, radF, 300);
      finalCollide(packF, 160);
      packF.forEach(function (a) { if (a.id !== (c && c.id)) out[a.id] = { x: Math.round(a.x), y: Math.round(a.y) }; });
    } else {
      /* 放射：所有卡片围成一圈，半径按「卡宽总和 / 2π」算，保证不叠 */
      var Wr = function (n) {
        if (n.type === 'center') return 300;
        if (n.type === 'tag') return 168;
        if (n.type === 'variant') return 250;
        if (n.type === 'note') return 210;
        if (n.type === 'file') return 190;
        return 268;
      };
      /* 放射 = 一圈圈往外放光：每层单独算「半径要多大才放得下这一层的卡」，
         同层均匀铺满整圈、并逐层旋转半个步长（错开相位），所以看着是一束束射线，不是死板的同心圆。 */
      var gNodes = sims.concat(tags);
      var gAdj2 = Object.create(null);
      gNodes.forEach(function (n) { gAdj2[n.id] = []; });
      DATA.edges.forEach(function (e) {
        if (!gAdj2[e.a] || !gAdj2[e.b]) return;
        gAdj2[e.a].push(e.b); gAdj2[e.b].push(e.a);
      });
      var rootG = c ? c.id : (gNodes[0] ? gNodes[0].id : '');
      var gPar = Object.create(null), gDep = Object.create(null), gOrd = [];
      if (rootG) { gDep[rootG] = 0; gOrd.push(rootG); }
      for (var gii = 0; gii < gOrd.length; gii++) {
        var gcc = gOrd[gii];
        (gAdj2[gcc] || []).forEach(function (nx) {
          if (gDep[nx] != null) return;
          gDep[nx] = gDep[gcc] + 1; gPar[nx] = gcc; gOrd.push(nx);
        });
      }
      gNodes.forEach(function (n) { if (gDep[n.id] == null) { gDep[n.id] = 1; gPar[n.id] = rootG || null; } });
      LAY_RINGS.length = 0;
      var gBy = Object.create(null);
      gNodes.forEach(function (n) { (gBy[gDep[n.id]] = gBy[gDep[n.id]] || []).push(n); });
      var gAng = Object.create(null);
      if (rootG) { out[rootG] = { x: 0, y: 0 }; gAng[rootG] = -Math.PI / 2; }
      var prevR2 = 0;
      Object.keys(gBy).map(Number).sort(function (p, q2) { return p - q2; }).forEach(function (d) {
        var list = gBy[d];
        if (!list) return;
        if (d === 0) return;
        /* 同层排序：跟着父母所在的方位走，这样每条射线是连贯的 */
        list.forEach(function (n) {
          var p4 = gPar[n.id];
          n._ga = (p4 && gAng[p4] != null) ? gAng[p4] : (d * 0.9);
        });
        list.sort(function (p, q2) { return p._ga - q2._ga; });
        /* 一层人太多就拆成两圈（内外各一半），整张图不会越铺越大 */
        var PER = 12;
        var groups = [];
        for (var g0 = 0; g0 < list.length; g0 += PER) groups.push(list.slice(g0, g0 + PER));
        var baseR = Math.max(prevR2 + 195, 320);
        groups.forEach(function (gp, gi2) {
          var cnt = gp.length;
          var step2 = Math.PI * 2 / cnt;
          var needR2 = (250 * cnt) / (Math.PI * 2) * 0.86;
          var Rr2 = Math.max(baseR + gi2 * 210, Math.round(needR2) + gi2 * 210);
          var off2 = -Math.PI / 2 + (d % 2 ? step2 / 2 : 0) + d * 0.22 + gi2 * (step2 / 2);
          gp.forEach(function (n, i) {
            var a2 = off2 + step2 * i;
            gAng[n.id] = a2;
            out[n.id] = { x: Math.round(Math.cos(a2) * Rr2), y: Math.round(Math.sin(a2) * Rr2) };
          });
          baseR = Rr2;
        });
        prevR2 = baseR;
      });
      (function radCollide() {
        var pk = gNodes.filter(function (n) { return out[n.id]; }).map(function (n) {
          return { id: n.id, x: out[n.id].x, y: out[n.id].y, w: Wr(n), h: 104 };
        });
        finalCollide(pk, 140);
        pk.forEach(function (aa) { out[aa.id] = { x: Math.round(aa.x), y: Math.round(aa.y) }; });
      })();
    }
    return out;
  }

  /* 换排法时让卡片「滑」到新位置，而不是啪一下跳过去 */
  function animLayout(oldPos) {
    var ns = $('#mpNodes'); if (!ns) return;
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (eRM) {}
    ns.querySelectorAll('.mp-node').forEach(function (el) {
      var id = el.dataset.id, o = oldPos[id]; if (!o) return;
      var nx = parseFloat(el.style.left) || 0, ny = parseFloat(el.style.top) || 0;
      var dx = o[0] - nx, dy = o[1] - ny;
      if (!dx && !dy) return;
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      try {
        /* 卡片本身靠 translate(-50%,-50%) 居中，补位移时必须把它带上，否则动画期间会偏半张卡 */
        el.animate(
          [{ transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px)' },
           { transform: 'translate(-50%,-50%) translate(0,0)' }],
          { duration: 420, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'none' }
        );
      } catch (e) {}
    });
  }

  function applyLayout(name) {
    if (name) name = layName(name);
    if (name && LAYOUTS.some(function (l) { return l.k === name; })) LAY.name = name;
    var oldPos = {};
    var hadNodes = !!((DATA.nodes || []).length);
    DATA.nodes.forEach(function (n) { oldPos[n.id] = [n.x, n.y]; });
    var pos = layoutPositions(LAY.name);
    DATA.nodes.forEach(function (n) { var p = pos[n.id]; if (p) { n.x = p.x; n.y = p.y; } });
    writeLS(LAY_KEY, LAY.name);
    var s = $('#mpLayout');
    if (s) s.value = LAY.name;
    var wrap = $('#mpWrap');
    if (wrap) {
      wrap.classList.toggle('lay-layer', LAY.name === 'layer');
      wrap.classList.toggle('lay-grid', LAY.name === 'grid');
      wrap.classList.toggle('lay-tree', LAY.name === 'tree');
      wrap.classList.toggle('lay-free', LAY.name === 'free');
    }
    render();
    if (hadNodes) { try { animLayout(oldPos); } catch (eA) {} }
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
            '<span>逻辑</span><select id="mpGLogic" title="并集＝命中任意一个词就算；交集＝每个词都得命中（更准）">' +
              '<option value="or">并集</option><option value="and">交集</option></select>' +
            '<span>类型</span><select id="mpGKind" title="路径组＝在路径模式下沿着相似题一层层展开出来的组（中心不动）">' +
              '<option value="all">全部</option><option value="path">🧭 路径组</option><option value="tree">普通组（本题库）</option></select>' +
            '<span class="mp-grow3"></span></div>' +
          '<div id="mpGBulk" hidden><span id="mpGBulkN">已选 0 组</span>' +
            '<button type="button" data-b="all">全选</button>' +
            '<button type="button" data-b="none">清空</button>' +
            '<button type="button" data-b="dup">复制…</button>' +
            '<button type="button" data-b="exp" title="把选中的组导出成 JSON 文件">导出…</button>' +
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
      var show = !!(sel || (typeof NAV !== 'undefined' && NAV.length) || (kp && (kp.classList.contains('show') || kp.classList.contains('full'))) || (gp && gp.classList.contains('show')));
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
  function sideAt(x) { return x <= 40 ? 'left' : (x >= innerWidth - 40 ? 'right' : null); }
  /* 第 24 轮：只做二分。顶部不再有「放大到整屏」的预览——双击标题栏就能最大化，
     拖窗口稍碰顶边就整屏反而是误触。 */
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
  var SNAPB = null;   /* 吸附/最大化前那块矩形，拖离吸附位时用它还原 */
  function setMax(on) {
    if (on) {
      if (isMax()) return;
      MAXP = { x: S.x, y: S.y, w: S.w, h: S.h }; SNAPB = { x: S.x, y: S.y, w: S.w, h: S.h };
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
  var WIN_STACK = [];
  /* 层级统一在这里算，不再各自往上加数字（第 26 轮那个「青色标题栏残留旧层级」就是这么来的）：
     聚焦中的窗口拿 30070，开着但没聚焦的一律 30010，关掉的清掉内联值回落 CSS。
     #mpKp.full 的 30090 是 !important，不受影响，所以全屏永远压在遮罩上。 */
  function winZ(s, focused) {
    var el = $(s); if (!el) return;
    if (!winOpen(s)) { el.style.zIndex = ''; return; }
    el.style.zIndex = focused ? '30070' : '30010';
  }
  function winFocus(s) {
    if (!s) return;
    var i = WIN_STACK.indexOf(s);
    if (i >= 0) WIN_STACK.splice(i, 1);
    WIN_STACK.push(s);
    WIN_TOP = s;
    winFocusPaint();
  }
  function winOpen(s) {
    var el = $(s); if (!el) return false;
    if (s === '#mpWrap') return !el.hidden;
    return el.classList.contains('show');
  }
  function winFocusPaint() {
    /* 焦点栈：关掉的窗口自动出栈，焦点回到上一个还开着的窗口，不会「全都失焦」 */
    WIN_STACK = WIN_STACK.filter(function (x) { return winOpen(x); });
    if (WIN_TOP && !winOpen(WIN_TOP)) WIN_TOP = WIN_STACK.length ? WIN_STACK[WIN_STACK.length - 1] : '';
    if (WIN_TOP) winFocus2(WIN_TOP);
    WINS.forEach(function (s) {
      var el = $(s); if (!el) return;
      var open = winOpen(s);
      if (!open) { el.classList.remove('wf', 'winblur'); winZ(s, false); return; }
      el.classList.toggle('wf', s === WIN_TOP);
      el.classList.toggle('winblur', !!WIN_TOP && s !== WIN_TOP);
      winZ(s, s === WIN_TOP);
    });
  }
  function winFocus2(s) { if (!s) return; var i = WIN_STACK.indexOf(s); if (i >= 0) WIN_STACK.splice(i, 1); WIN_STACK.push(s); }
  function bindWinFocus() {
    if (document.__mpWinF) return; document.__mpWinF = 1;
    document.addEventListener('pointerdown', function (e) {
      var hit = '';
      for (var i = 0; i < WINS.length; i++) {
        var el = $(WINS[i]);
        if (el && winOpen(WINS[i]) && el.contains(e.target)) { hit = WINS[i]; break; }
      }
      if (hit) winFocus(hit); else { WIN_TOP = ''; winFocusPaint(); }
    }, true);
  }

    /* 标题栏按钮：直接用 pointerdown 触发，不依赖 click。
     手机上 click 可能因为长按/拖动判定、被父层吞掉而根本不来，
     上一轮用户报「✕ 和 – 都用不了」就是这个原因。 */
  function pressBind(el, fn) {
    if (!el) return;
    var last = 0;
    var fire = function (e) {
      /* 只认左键 / 触摸：触摸在个别浏览器会给 -1，也算左键 */
      try {
        if (e && e.button != null && e.button !== 0) {
          var touchish = (e.pointerType === 'touch' || e.pointerType === 'pen') && e.button === -1;
          if (!touchish) return;
        }
      } catch (err) {}
      if (e && e.cancelable) { try { e.preventDefault(); } catch (err) {} }
      try { e.stopPropagation(); } catch (err) {}
      var now = Date.now(); if (now - last < 320) return; last = now;
      try { fn(); } catch (err) {}
    };
    el.addEventListener('pointerdown', fire, true);
    el.addEventListener('mousedown', function (e) { if (!window.PointerEvent) fire(e); }, true);
    el.addEventListener('touchstart', function (e) { if (!window.PointerEvent) fire(e); }, { capture: true, passive: false });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') fire(e); });
    el.addEventListener('click', function (e) { fire(e); });
  }

function bindShell() {
    try { bindWinFocus(); } catch (e) {}
  try { bindAway(); } catch (e) {}
    var bar = $('#mpBar'), wrap = $('#mpWrap'), rz = $('#mpRz'), stage = $('#mpStage');
    var d = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,select,input,label,textarea')) return;
      /* 吸附/最大化状态下按住标题栏往外拖：先把窗口还原成吸附前的尺寸，再跟着手指走 */
      if (SNAPB) {
        var pr = SNAPB; SNAPB = null; MAXP = null;
        var ratio = Math.min(1, Math.max(0, (e.clientX - S.x) / Math.max(1, S.w)));
        S.w = pr.w; S.h = pr.h;
        S.x = Math.round(e.clientX - ratio * S.w);
        S.y = Math.max(4, Math.round(e.clientY - 18));
        try { apply(); } catch (err0) {}
      }
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
      LAST_DRAG_AT = Date.now();
      var sp = $('#mpSnap'); if (sp) sp.hidden = true;
      var side = moved ? sideAt(e.clientX) : null;
      if (side) {
        var r = halfRect(side);
        SNAPB = { x: S.x, y: S.y, w: S.w, h: S.h };
        MAXP = null; S.x = r.x; S.y = r.y; S.w = r.w; S.h = r.h;
        apply(); save(); setTimeout(fit, 60);
      } else { save(); }
    });
    bar.addEventListener('dblclick', function (e) {
      if (e.target.closest('button,select,input,label,textarea')) return;
      /* 拖完手一松浏览器还会补一个 click，紧接着双击会误触发最大化 */
      if (Date.now() - LAST_DRAG_AT < 350) return;
      setMax(!isMax());
    });

    rz.addEventListener('pointerdown', function (e) {
      d = { x: e.clientX, y: e.clientY, ow: S.w, oh: S.h, mode: 'rz' };
      try { rz.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    rz.addEventListener('pointermove', function (e) {
      if (!d || d.mode !== 'rz') return;
    SNAPB = null;
      S.w = Math.max(560, d.ow + e.clientX - d.x);
      S.h = Math.max(380, d.oh + e.clientY - d.y);
      MAXP = null;
      apply();
    });
    rz.addEventListener('pointerup', function () { if (d) { d = null; save(); fit(); } });

    pressBind($('#mpX'), function () { close(); });
    pressBind($('#mpMin'), function () { S.min = true; apply(); });
    pressBind($('#mpMax'), function () { setMax(!isMax()); });
    /* 最小化胶囊：可以拖着走（位置记住），点一下才还原；拖动不算点击 */
  (function bindChip() {
    var c = $('#mpChip'); if (!c || c.__cb) return; c.__cb = 1;
    var pos = null;
    try { pos = JSON.parse(localStorage.getItem('qbank.map.chip.v1') || 'null'); } catch (e) {}
    if (pos && typeof pos.x === 'number') {
      c.style.left = pos.x + 'px'; c.style.top = pos.y + 'px';
      c.style.right = 'auto'; c.style.bottom = 'auto';
    }
    var d = null;
    c.addEventListener('pointerdown', function (e) {
      var r = c.getBoundingClientRect();
      d = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    c.addEventListener('pointermove', function (e) {
      if (!d) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (!d.moved) return;
      var nx = Math.max(4, Math.min(innerWidth - 70, d.l + dx));
      var ny = Math.max(4, Math.min(innerHeight - 40, d.t + dy));
      c.style.left = nx + 'px'; c.style.top = ny + 'px';
      c.style.right = 'auto'; c.style.bottom = 'auto';
    });
    c.addEventListener('pointerup', function () {
      if (!d) return;
      var moved = d.moved; d = null;
      if (moved) {
        var r = c.getBoundingClientRect();
        try { localStorage.setItem('qbank.map.chip.v1', JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) {}
        return;
      }
      S.min = false; apply(); setTimeout(fit, 60);
    });
  })();
    $('#mpLayout').onchange = function () { applyLayout(this.value); setTimeout(fit, 40); };

    /* 右下角缩放条：− / 百分比 / + / 适应 —— 和标题栏一样用 pointerdown 触发，
       这样手机上被其它层挡一下或者 click 没合成出来，也还能用 */
    var zb = $('#mpZoom');
    if (zb) {
      pressBind(zb.querySelector('[data-z="out"]'), function () {
        var r = stageRect(); zoom(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.15);
      });
      pressBind(zb.querySelector('[data-z="in"]'), function () {
        var r = stageRect(); zoom(r.left + r.width / 2, r.top + r.height / 2, 1.15);
      });
      pressBind(zb.querySelector('[data-z="fit"]'), function () { fit(); });
    }

    /* Esc：先退最大化，再取消选中，最后关窗口。
       挂在 window 的捕获阶段并 stopPropagation —— 否则事件会继续传给 app.js 的
       全局 Esc（退回上一路由，会把 hash 清掉、整页跳回首页）。 */
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !S.on) return;
      var _vh = document.getElementById('mpVar');
      if (_vh && !_vh.hidden) { varClose(); e.preventDefault(); return; }
    /* 焦点在站里别处（侧栏/题库管理器）时，Esc 归站点自己处理 */
    if ($('#mpWrap') && $('#mpWrap').classList.contains('mp-away')) return;
      e.preventDefault(); e.stopPropagation();
      var sdset = document.getElementById('mpSdSet');
  if (sdset && sdset.classList.contains('show')) { sdset.classList.remove('show'); return; }
  var pop = document.getElementById('mpFindPop');
      if (pop && pop.classList.contains('show')) {          /* 先关搜索下拉，别一路把关窗口也走掉 */
        pop.classList.remove('show');
        var fq = document.getElementById('mpFindQ');
        if (fq && document.activeElement === fq) fq.blur();
        return;
      }
      var cx = document.getElementById('mpCtx');
    if (cx && cx.classList.contains('show')) { cx.classList.remove('show'); return; }
    var vw = document.getElementById('mpVw');
    if (vw && vw.classList.contains('show')) { try { vwClose(); } catch (e) {} return; }
    var pv = document.getElementById('mpPv');
    if (pv && pv.classList.contains('show')) { try { pvClose(); } catch (e) {} return; }
    var sd = document.getElementById('mpSide');
      if (sd && sd.classList.contains('show')) { sideClose(); return; }
      var pk = document.getElementById('mpPick');
      if (pk && pk.classList.contains('show')) { pickClose(); return; }
      var aim = document.getElementById('mpAi');
      if (aim && aim.classList.contains('show')) { aim.classList.remove('show'); return; }
      var agm = document.getElementById('mpAg');
      if (agm && agm.classList.contains('show')) { agClose(); return; }
      var ned = document.getElementById('mpNoteEd');
      if (ned && ned.classList.contains('show')) { closeNoteEd(); return; }
      var rq = document.getElementById('mpRq');
      if (rq && rq.classList.contains('show')) { rqClose(); return; }
      var tb = document.getElementById('mpRkTb');
      if (tb && tb.classList.contains('show')) { rkTbHide(); return; }
      var kp = document.getElementById('mpKp');
      if (kp && kp.classList.contains('full')) { kpFull(false); return; }
    var gp2 = document.getElementById('mpGrp');
    if (gp2 && gp2.classList.contains('show')) {
      gp2.classList.remove('show');
      var gb2 = document.getElementById('mpGroups'); if (gb2) gb2.classList.remove('on');
      return;
    }
    if (kp && kp.classList.contains('show')) { try { kpClose(); } catch (e) {} return; }
      if (isMax()) { setMax(false); return; }
      if (sel) { sel = null; render(); return; }
      close();
    }, true);

    /* 画布：拖空白平移 + 滚轮缩放 + 双指捏合缩放 */
    var pg = null, PTS = {}, pinch = null;
    /* 只认真实的双指触摸：鼠标永远参与不了捏合。
       以前把鼠标指针也记进 PTS，一旦某次 pointerup 丢了（比如在窗口外松手），
       这条记录就永远留在表里 —— 之后单指/单鼠标拖动会被当成「双指在拉开」= 莫名其妙地缩放。 */
    function ptLive(p) { return p && p.type !== 'mouse' && (Date.now() - p.t) < 4000; }
    function ptCount() { var n = 0, k; for (k in PTS) if (ptLive(PTS[k])) n++; return n; }
    function ptIds() { var out = [], k; for (k in PTS) { if (ptLive(PTS[k])) out.push(k); } return out; }
    function pinchState() {
      var ids = ptIds(); if (ids.length < 2) return null;
      var a = PTS[ids[0]], b = PTS[ids[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    function ptUp(e) {
      try { delete PTS[e.pointerId]; } catch (err) {}
      if (ptCount() < 2) pinch = null;
      if (e.pointerType === 'mouse') { try { delete PTS[e.pointerId]; } catch (err2) {} pinch = null; }
      if (!ptCount() && pg) { pg = null; stage.style.cursor = ''; }
      if (!ptCount() && stage && stage.classList.contains('mp-pan')) {
        stage.classList.remove('mp-pan');
        try { var sel1 = window.getSelection(); if (sel1) sel1.removeAllRanges(); } catch (err3) {}
      }
    }
    stage.addEventListener('pointerdown', function (e) {
      PTS[e.pointerId] = { x: e.clientX, y: e.clientY, type: e.pointerType || 'mouse', t: Date.now() };
      if (ptCount() >= 2) { pinch = pinchState(); pg = null; stage.style.cursor = 'grabbing'; return; }
      if (e.target.closest('.mp-node')) return;
      /* 点画布空白：把右侧知识点面板收起来（和样板一样） */
      var kp0 = document.getElementById('mpKp');
      if (kp0 && kp0.classList.contains('show')) { try { kpClose(); } catch (err) {} }
      try { sideClose(); } catch (err) {}
      pg = { x: e.clientX, y: e.clientY, tx: V.tx, ty: V.ty };
      stage.style.cursor = 'grabbing';
      /* 平移画布时把文字选择关掉：不然手指划过卡片，会顺手把卡片里的字选上（看着像被复制了） */
      stage.classList.add('mp-pan');
      try { var sel0 = window.getSelection(); if (sel0) sel0.removeAllRanges(); } catch (err1) {}
      try { e.preventDefault(); } catch (err2) {}
    });
    window.addEventListener('pointermove', function (e) {
      if (PTS[e.pointerId]) { PTS[e.pointerId].x = e.clientX; PTS[e.pointerId].y = e.clientY; PTS[e.pointerId].t = Date.now(); }
      /* 鼠标按键已经松了还留着记录 = 脏数据，直接清掉，别让它把平移当成捏合 */
      if (e.pointerType === 'mouse' && e.buttons === 0) { try { delete PTS[e.pointerId]; } catch (err0) {} }
      if (ptCount() >= 2) {
        var s2 = pinchState();
        if (pinch && s2 && s2.d > 6 && pinch.d > 6) {
          var f2 = s2.d / pinch.d;
          if (Math.abs(f2 - 1) > 0.004) zoom(s2.cx, s2.cy, f2);
        }
        pinch = s2;
        return;
      }
      if (!pg) return;
      V.tx = pg.tx + e.clientX - pg.x;
      V.ty = pg.ty + e.clientY - pg.y;
      if (Math.abs(e.clientX - pg.x) + Math.abs(e.clientY - pg.y) > 4) CLICK_GUARD = Date.now() + 350;
      clampView();
      paintView();
    });
    window.addEventListener('pointerup', ptUp);
    window.addEventListener('blur', function () { for (var k in PTS) delete PTS[k]; pinch = null; pg = null; });
    document.addEventListener('visibilitychange', function () { if (document.hidden) { for (var k in PTS) delete PTS[k]; pinch = null; pg = null; } });
    window.addEventListener('pointercancel', ptUp);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom(e.clientX, e.clientY, f);
    }, { passive: false });
  }

  var CLICK_GUARD = 0;

  /* 点站里别的地方（侧栏、题库管理器…）= 脑图让出焦点：沉到站点弹层下面并变淡 */
  function mapAway(on) {
    var w = $('#mpWrap'); if (!w) return;
    w.classList.toggle('mp-away', !!on);
    /* 让焦时不再把整块沉到侧栏下面（那样标题栏会被站内顶栏吃掉、找不到），
       改成：脑图保持 30000，侧栏用 CSS 提到 30010 压在上面（只压左侧 248px），
       右半边连标题栏一起照样看得见、点得回。 */
    w.style.zIndex = '30000';
    var b = $('#mpBar'); if (b) b.style.zIndex = '30001';
    var c = $('#mpChip'); if (c) c.style.zIndex = '30002';
  }
  /* 反过来：脑图拿到焦点时，侧栏退成半透明，两边不会都像「当前」 */
  function mapFocus(on) {
    try { document.body.classList.toggle('mp-focus', !!on); } catch (e) {}
  }
  function bindAway() {
    if (document.__awayB) return; document.__awayB = 1;
    document.addEventListener('pointerdown', function (e) {
      var away = !e.target.closest('#mpWrap') && !e.target.closest('#mpChip');
      mapAway(away); mapFocus(!away);
      /* 小窗（pip）也是站内的一块浮窗：点它就把 #pipLayer 抬到脑图上面，
         点回脑图再放回去 —— 否则小窗永远埋在大白板底下，看着像「没反应」 */
      var onPip = !!e.target.closest('.pip-win, #pipLayer, iframe.pip-frame');
      try { document.body.classList.toggle('pip-top', onPip); } catch (e2) {}
    }, true);
  }

  function stageRect() { var st = $('#mpStage'); return st ? st.getBoundingClientRect() : { left: 0, top: 0, width: 900, height: 600 }; }
  function zoom(cx, cy, f) {
    var r = stageRect();
    /* 缩放夹在 50%–180%：再小字看不清，再大一张图就散了 */
    var k2 = Math.max(0.5, Math.min(1.8, V.k * f));
    var px = cx - r.left, py = cy - r.top;
    V.tx = px - (px - V.tx) * (k2 / V.k);
    V.ty = py - (py - V.ty) * (k2 / V.k);
    V.k = k2;
    clampView();
    paintView();
  }

  /* 画布内容的粗包围盒（节点半径留一点余量），用来拦「把整张图甩到天边」 */
  function contentBox() {
    if (!DATA || !DATA.nodes || !DATA.nodes.length) return null;
    var x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    DATA.nodes.forEach(function (n) {
      if (n.x < x1) x1 = n.x; if (n.x > x2) x2 = n.x;
      if (n.y < y1) y1 = n.y; if (n.y > y2) y2 = n.y;
    });
    return { x1: x1 - 120, y1: y1 - 50, x2: x2 + 120, y2: y2 + 50 };
  }
  /* 至少留 120px 内容在视口里，四个方向都回弹 */
  function clampView() {
    var r = stageRect(), b = contentBox();
    if (!b || !r.width) return;
    var keep = 120;
    var L = b.x1 * V.k + V.tx, R = b.x2 * V.k + V.tx;
    var T = b.y1 * V.k + V.ty, B = b.y2 * V.k + V.ty;
    if (R < keep) V.tx += keep - R;
    else if (L > r.width - keep) V.tx -= L - (r.width - keep);
    if (B < keep) V.ty += keep - B;
    else if (T > r.height - keep) V.ty -= T - (r.height - keep);
  }
  /* 分级显示（LOD）：缩得越小，文字越少；图很大时关掉光晕，省重绘 */
  function paintLOD() {
    var w = $('#mpWrap'); if (!w) return;
    /* 分级显示：只在真的很小的时候才把题干藏掉，50% 左右还要能读一行 */
    w.classList.toggle('lod1', V.k < 0.86);
    w.classList.toggle('lod2', V.k < 0.62);
    w.classList.toggle('lod3', V.k <= 0.30);
  }
  function paintView() {
    var stage = $('#mpStage'); if (!stage) return;
    stage.style.setProperty('--k', V.k);
    try { paintLOD(); } catch (eL) {}
    var nodesEl = $('#mpNodes'), svg = $('#mpEdges');
    var tf = 'translate(' + V.tx + 'px,' + V.ty + 'px) scale(' + V.k + ')';
    nodesEl.style.transform = tf;
    var g = $('#mpEdgeG'), gg = $('#mpGlowG');
    /* SVG 的 transform 属性不认 px 单位，得用纯数字，否则整层不移动（线全跑左上角） */
    var s2 = 'translate(' + V.tx + ',' + V.ty + ') scale(' + V.k + ')';
    if (g) g.setAttribute('transform', s2);
    if (gg) gg.setAttribute('transform', s2);
    /* 分层参考线的层号：反向缩回去，缩到 40% 也还能看清 */
    if (svg) svg.style.setProperty('--iz', (1 / Math.max(0.2, V.k)).toFixed(3));
    var zv = $('#mpZVal');
    if (zv) zv.textContent = Math.round(V.k * 100) + '%';
  }

  function apply() {
    var wrap = $('#mpWrap'), bar = $('#mpBar'), rz = $('#mpRz'), chip = $('#mpChip');
    /* 关窗时必须把 display 也写成 none：样式表里 #mpWrap 是 display:flex，
       单靠 hidden 属性压不住（id 选择器比 [hidden] 优先级高），窗口就会「看着还在」，
       于是 ✕ / – / ⤢ / 适应 点了都像没反应。 */
    if (!S.on) {
      wrap.hidden = true; wrap.style.display = 'none';
      bar.style.display = 'none'; rz.style.display = 'none';
      chip.hidden = true; var sp0 = $('#mpSnap'); if (sp0) sp0.hidden = true;
      return;
    }
    /* 只在桌面宽度下才认为「上次是按整屏存的」，否则手机上每次 apply 都会把宽高和位置重置回默认 */
    if (S.w != null && !MAXP && innerWidth > 700 && S.w >= innerWidth - 40) { S.w = null; }
    if (S.w == null) {
      S.w = Math.min(1080, Math.round(innerWidth * 0.62));
      S.h = Math.min(820, Math.round(innerHeight * 0.82));
      S.x = innerWidth - S.w - 28;
      S.y = 104;
    }
    /* 手机：直接铺满整屏，别留边（边距一留，面板和工具条就都挤不全） */
    var PH = innerWidth <= 760;
    wrap.classList.toggle('mp-ph', PH);
    if (PH) {
      S.w = innerWidth; S.h = innerHeight; S.x = 0; S.y = 0; MAXP = null;
      wrap.hidden = false;
      wrap.style.left = '0px'; wrap.style.top = '0px';
      wrap.style.width = S.w + 'px'; wrap.style.height = S.h + 'px';
      bar.style.left = '0px'; bar.style.top = '0px'; bar.style.width = S.w + 'px';
      rz.style.display = 'none';
      wrap.style.display = S.min ? 'none' : 'flex';
      bar.style.display = S.min ? 'none' : '';
      chip.hidden = !S.min;
      return;
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
    wrap.style.display = S.min ? 'none' : 'flex';
    bar.style.display = S.min ? 'none' : '';
    rz.style.display = S.min ? 'none' : '';
    chip.hidden = !S.min;
  }
  function save() { writeLS(WIN_KEY, { x: S.x, y: S.y, w: S.w, h: S.h }); }

  /* ---------- 渲染 ---------- */

  /* 只重画连线（拖节点 / 改位置时用，不重渲染节点） */
  function filShow(n) {
    if (!n) return false;
    if (n.type === 'sim' && !FIL.sim) return false;
    if (n.type === 'tag' && !FIL.tag) return false;
    if (n.type === 'variant' && !FIL.var) return false;
    return true;
  }
  /* 点哪个节点，镜头就往哪边走一段；越「不重要」走得越少：
     相似题 0.92 / 中心题 0.8 / 变式题 0.6 / 考点 0.26 / 资料 0.18 */
  var CAM_T = 0;
  function camWeight(n) {
    if (!n) return 0.5;
    if (n.type === 'sim') return 0.92;
    if (n.type === 'center') return 0.8;
    if (n.type === 'variant') return 0.6;
    if (n.type === 'tag') return 0.26;
    if (n.type === 'file') return 0.18;
    return 0.4;
  }
  function camToNode(n, w) {
    if (!n || !isFinite(n.x) || !isFinite(n.y)) return;
    var r; try { r = stageRect(); } catch (e0) { return; }
    if (!r || !r.width) return;
    w = (w == null) ? camWeight(n) : w;
    var k = V.k;
    var tx0 = V.tx, ty0 = V.ty;
    var tx1 = tx0 + (r.width / 2 - (tx0 + n.x * k)) * w;
    var ty1 = ty0 + (r.height / 2 - (ty0 + n.y * k)) * w;
    if (Math.abs(tx1 - tx0) < 2 && Math.abs(ty1 - ty0) < 2) return;
    try {
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
        V.tx = tx1; V.ty = ty1; paintView(); return;
      }
    } catch (e1) {}
    if (CAM_T) { try { cancelAnimationFrame(CAM_T); } catch (e2) {} CAM_T = 0; }
    var t0 = performance.now(), dur = 400;
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      V.tx = tx0 + (tx1 - tx0) * e;
      V.ty = ty0 + (ty1 - ty0) * e;
      try { paintView(); } catch (e3) {}
      if (p < 1) CAM_T = requestAnimationFrame(step); else CAM_T = 0;
    }
    CAM_T = requestAnimationFrame(step);
  }

  function drawEdges() {
    var g = $('#mpEdgeG'); if (!g) return;
    var nodesEl = $('#mpNodes'); if (!nodesEl) return;
    var pos = {}, fid = sel;
    DATA.nodes.forEach(function (n) { pos[n.id] = n; });
    /* 连线：量每张卡片的真实宽高，把端点正好落在边框上（不再猜尺寸） */
    var boxOf = {};
    var HEAVY = (DATA.nodes.length > 18);   /* 大图：动画和光晕都省掉，先保流畅 */
    nodesEl.querySelectorAll('.mp-node').forEach(function (el, _ni) {
      /* 入场动画：bounce-in + 交错（每个节点只播一次，重绘不闪） */
      try {
        if (ANIM_ONCE && !HEAVY && !el.dataset.an) {
          el.dataset.an = '1';
          el.style.setProperty('--ad', Math.min(420, _ni * 45) + 'ms');
          el.classList.add('in');
          /* 中心题以下的卡片走 fade-in-up（从下往上淡入），不弹跳 */
          try {
            var nd0 = pos[el.dataset.id];
            if (nd0) {
              var cn0 = DATA.nodes.filter(function (x) { return x.type === 'center'; })[0];
              if (cn0 && nd0.y > cn0.y + 20) el.classList.add('inb');
            }
          } catch (e0) {}
          el.addEventListener('animationend', function () { el.classList.remove('in', 'inb'); }, { once: true });
          /* 相似度百分数：从 0 滚上去（counter-roll） */
          var pl = el.querySelector('.mp-pill');
          if (pl) {
            var mm = /(\d+)/.exec(pl.textContent || '');
            if (mm) {
              var target = parseInt(mm[1], 10), pre = (pl.textContent || '').split(mm[1])[0], suf = (pl.textContent || '').split(mm[1])[1] || '%';
              var t0 = null;
              var step = function (ts) {
                if (!document.body.contains(el)) return;
                if (t0 === null) t0 = ts;
                var p = Math.min(1, (ts - t0) / 620);
                var e = 1 - Math.pow(1 - p, 3);
                pl.textContent = pre + Math.round(target * e) + suf;
                if (p < 1) requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            }
          }
        }
      } catch (e0) {}
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
    var maxD = 1;
    if (fid && pos[fid]) DATA.nodes.forEach(function (n) { maxD = Math.max(maxD, Math.hypot(n.x - pos[fid].x, n.y - pos[fid].y)); });
    var glowList = [];
    var paths = DATA.edges.map(function (e) {
      var a = pos[e.a], b = pos[e.b];
      if (!a || !b) return '';
      /* 过滤勾掉的那类节点，连线也要跟着消失（否则只剩一堆悬空的线） */
      if (!filShow(a) || !filShow(b)) return '';
      var A = cut(a, b.x, b.y), B = cut(b, a.x, a.y);
      var hot = fid && (e.a === fid || e.b === fid);
      var w = hot ? (2.2 + (e.w || 0) * 2.2) : (1.2 + (e.w || 0) * 1.8);
      /* 不亮的线也按「离焦点多远」线性变淡（越远越淡，焦点附近仍留一点） */
      var op = 0.85;
      if (fid) {
        var far = hot ? 0 : Math.max(0, Math.hypot(b.x - pos[fid].x, b.y - pos[fid].y) / maxD);
        op = hot ? 1 : (0.52 - 0.30 * Math.min(1, far));
        if (op < 0.16) op = 0.16;
      }
      /* 相似题 / AI 变式带一点弧度（一堆直线交叉太碎），考点 / 笔记 / 资料走直线 */
      var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      /* 跨半张图的长连线最碍眼：压暗压细，让近处的边先说话 */
      if (len > 760) { w *= 0.7; op *= 0.5; }
      var bend = (e.kind === 'sim' || e.kind === 'variant') ? Math.min(46, len * 0.085) : 0;
      var mx = (A.x + B.x) / 2 - (dy / len) * bend, my = (A.y + B.y) / 2 + (dx / len) * bend;
      /* 环形/径向布局：弧线一律往外鼓（背向圆心），线不往中心扎堆，交叉看起来少很多 */
      if (bend && (LAY.name === 'radial' || LAY.name === 'layer' || LAY.name === 'tree')) {
        var mx0 = (A.x + B.x) / 2, my0 = (A.y + B.y) / 2, r0 = Math.hypot(mx0, my0) || 1;
        var push = bend * 1.5;
        mx = mx0 + (mx0 / r0) * push;
        my = my0 + (my0 / r0) * push;
      }
      var d = bend
        ? 'M' + A.x.toFixed(1) + ',' + A.y.toFixed(1) + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + B.x.toFixed(1) + ',' + B.y.toFixed(1)
        : 'M' + A.x.toFixed(1) + ',' + A.y.toFixed(1) + ' L' + B.x.toFixed(1) + ',' + B.y.toFixed(1);
      /* 光晕层按相似度（e.w）线性给粗细和亮度：96% 的线明显比 52% 的粗亮 */
      if (hot) glowList.push({ d: d, kind: e.kind, gc: e.kind === 'sim' ? 0 : 1, wt: (e.w == null ? 0.6 : e.w) });
      return '<path d="' + d + '" class="mp-e ' + e.kind + (hot ? ' hot' : '') + '" stroke-width="' + w.toFixed(1) + '" style="opacity:' + op.toFixed(2) + '"/>';
    }).join('');
    g.innerHTML = paths;
    /* 光晕层：连到焦点的线各描一层粗的，宽度/亮度跟着相似度走，交给 CSS blur 去发光 */
    var glow = $('#mpGlowG');
    var PERF = (DATA && DATA.nodes && (DATA.nodes.length > 28 || DATA.edges.length > 90));
    if (glow && !PERF) {
      glow.innerHTML = fid ? glowList.map(function (x) {
        var gw = (4.5 + 6.5 * x.wt).toFixed(1);
        var go = (0.34 + 0.40 * x.wt).toFixed(2);
        return '<path d="' + x.d + '" class="mp-e gh ' + x.kind + '" stroke-width="' + gw + '" style="opacity:' + go + '"/>';
      }).join('') : '';
    } else if (glow) { glow.innerHTML = ''; }
    try { drawLayerGuides(); } catch (eLG) {}
  }

  /* 分层布局下画「层」参考线 + 层号：借 GNN 的 k-hop 概念，第 k 层 = 从中心题往外点 k 下 */
  function drawLayerGuides() {
    var g = $('#mpEdgeG'); if (!g) return;
    if ((LAY.name !== 'layer' && LAY.name !== 'tree') || !DATA || !DATA.nodes) return;
    var byY = Object.create(null);
    DATA.nodes.forEach(function (n) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') return;
      if (!filShow(n)) return;
      var k = Math.round(n.y);
      (byY[k] = byY[k] || []).push(n);
    });
    var svgNS = 'http://www.w3.org/2000/svg';
    var frag = document.createDocumentFragment();
    var seenD = Object.create(null);
    /* 同心环模式：画层圈 + 圈号，不再画水平线 */
    if (LAY_RINGS.length) {
      LAY_RINGS.forEach(function (ring) {
        var ci = document.createElementNS(svgNS, 'circle');
        ci.setAttribute('cx', '0'); ci.setAttribute('cy', '0'); ci.setAttribute('r', ring.r);
        ci.setAttribute('class', 'mp-layring');
        frag.appendChild(ci);
        var lab = typeof ring.d === 'string' && ring.d.indexOf('tag') === 0 ? '考点' : (ring.d === 0 ? '中心题' : '第 ' + ring.d + ' 层');
        var tx0 = document.createElementNS(svgNS, 'text');
        var ang0 = -Math.PI * 0.75;
        tx0.setAttribute('x', (Math.cos(ang0) * ring.r).toFixed(0));
        tx0.setAttribute('y', (Math.sin(ang0) * ring.r - 8).toFixed(0));
        tx0.setAttribute('class', 'mp-laytxt');
        tx0.textContent = lab;
        frag.appendChild(tx0);
      });
      g.appendChild(frag);
      return;
    }
    Object.keys(byY).map(Number).sort(function (a, b) { return a - b; }).forEach(function (y) {
      var arr = byY[y];
      var tagRow = arr.every(function (n) { return n.type === 'tag'; });
      var d = (arr[0] && arr[0]._d != null) ? arr[0]._d : null;
      var label = tagRow ? '考点' : (d === 0 ? '中心题' : (d != null ? '第 ' + d + ' 层' : ''));
      /* 同一层折成多行时只在第一行标一次 */
      if (!tagRow && d != null && seenD[d]) label = '';
      if (!tagRow && d != null) seenD[d] = 1;
      var minX = Infinity, maxX = -Infinity;
      arr.forEach(function (n) { minX = Math.min(minX, n.x - 150); maxX = Math.max(maxX, n.x + 150); });
      if (!isFinite(minX)) return;
      var ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('x1', (minX - 66).toFixed(0)); ln.setAttribute('y1', (y + 96).toFixed(0));
      ln.setAttribute('x2', (maxX + 66).toFixed(0)); ln.setAttribute('y2', (y + 96).toFixed(0));
      ln.setAttribute('class', 'mp-layline');
      frag.appendChild(ln);
      if (label) {
        var tx = document.createElementNS(svgNS, 'text');
        tx.setAttribute('x', (minX - 72).toFixed(0)); tx.setAttribute('y', (y + 100).toFixed(0));
        tx.setAttribute('class', 'mp-laytxt');
        tx.textContent = label;
        frag.appendChild(tx);
      }
    });
    g.appendChild(frag);
  }

  /* noFit=true：画完不要自动「适应窗口」。从资料柜拖文件进来时必须这样，
     否则刚放到鼠标位置的那张卡会被 fit() 的重新取景带走，看着就是「拖过去偏了」。 */
  function render(noFit) {
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
      var isImgF = n.type === 'file' && /^(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(n.ext || ''));
      var cls = 'mp-node ' + n.type + (isImgF ? ' imgnode' : '') + (sel === n.id ? ' sel' : '') + (nearIds[n.id] ? ' near' : '') + (n.pinned ? ' pinned' : '') + (n.draft ? ' draft' : '');
      var head = n.type === 'center' ? (PATHM.on ? '中心题 · 路径起点' : '中心题') : n.type === 'sim' ? (n.draft && n.score == null ? '相关题 · 草稿' : (n.xbk && String(n.xbk) !== String(S.bankId) ? (n.ai ? '相似题 · 他库 · AI' : '相似题 · 他库') : (n.ai ? '相似题 · AI 精搜' : '相似题'))) : n.type === 'variant' ? (n.variantAi ? '变式题 · AI' : '变式题 · 草稿') : n.type === 'file' ? '资料' : n.type === 'idea' ? '分析' : (n.draft ? '考点 · 草稿' : '考点');
      var pill = n.type === 'sim' ? (n.score == null
        ? '<span class="mp-pill d">待定</span>'
        : '<span class="mp-pill">相似 ' + n.score + '%</span>')
        : n.type === 'variant' ? (n.variantAi ? '<span class="mp-pill v">AI</span>' : '')
        : n.type === 'tag' ? '' : n.type === 'file' ? '<span class="mp-pill f">' + esc(String(n.ext || 'file').toUpperCase()) + '</span>' : '<span class="mp-pill c">当前</span>';
      var text = n.type === 'tag' ? esc(n.label) : n.type === 'file'
        ? (isImgF
          ? '<div class="mp-fimg" data-thumb="' + esc(String(n.fid || '')) + '"></div><span class="mp-fnm">' + esc(String(n.label || '').slice(0, 40)) + '</span>'
          : '<i class="mp-fico">' + fileIco(n.ext) + '</i>' + esc(String(n.label || '').slice(0, 40)))
        : esc(String(n.label || '').slice(0, 52));
      var op = 1;
      if (fid) {
        var d0 = Math.hypot(n.x - pos[fid].x, n.y - pos[fid].y);
        op = n.id === fid ? 1 : (0.70 + 0.30 * (1 - d0 / maxD));
      }
      var depAttr = (n._d != null && n._d > 0) ? ' data-dep="' + n._d + '"' : '';
      var why = (n.aiWhy ? '<div class="mp-why">AI：' + esc(String(n.aiWhy).slice(0, 40)) + '</div>' : '');
      return '<div class="' + cls + '" data-id="' + n.id + '"' + depAttr + ' style="left:' + n.x + 'px;top:' + n.y + 'px;opacity:' + op.toFixed(3) + '">' +
        '<i class="mp-k">' + head + '</i><div class="mp-t">' + text + '</div>' + why + pill + '</div>';
    }).join('');

    /* 图片资料：画布上直接出缩略图（本体在 IDB，先取 blob 再换上去） */
    try {
      nodesEl.querySelectorAll('.mp-fimg[data-thumb]').forEach(function (ph) {
        var f0 = fById(ph.getAttribute('data-thumb'));
        if (!f0) { ph.remove(); return; }
        var put = function () {
          if (!f0.url) return;
          var im = document.createElement('img');
          im.className = 'mp-fimg';
          im.alt = '';
          im.src = f0.url;
          if (ph.parentNode) ph.parentNode.replaceChild(im, ph);
        };
        if (f0.url) put(); else ensureUrl(f0, put);
      });
    } catch (eTh) {}
    try { filNote(); } catch (eFN3) {}
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
          if (sel) { try { kpOpen(n); } catch (err) {} try { camToNode(n); } catch (eC1) {} }
          else { try { kpClose(); } catch (err) {} }
          return;
        }
        sel = n.id;
        render();
        try { camToNode(n); } catch (eC2) {}
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
    if (!noFit) fit();
  }

  function fit() {
    if (!S.on || S.min) return;
    var r = stageRect();
    var good = DATA.nodes.filter(function (n) { return isFinite(n.x) && isFinite(n.y); });
    var xs = good.map(function (n) { return n.x; }), ys = good.map(function (n) { return n.y; });
    if (!xs.length) return;
    /* 手机屏窄，卡片本身还有宽度，边距按屏宽缩放；最小缩放也放宽，否则两侧卡片会被切掉 */
    var ph = innerWidth <= 760;
    /* 卡片本身有宽度（最宽 300），取景时至少留半个卡宽，否则最外圈的卡会被切掉 */
    var padX = ph ? 96 : 156, padY = ph ? 78 : (LAY.name === 'layer' ? 122 : 92);
    /* 底部的提示条是浮在画布上的，取景时要把它让出来，否则最后一层卡片会被它压住 */
    var hb = document.getElementById('mpHint');
    var padB = (hb && !hb.hidden) ? (hb.offsetHeight + 22) : 0;
    var minX = Math.min.apply(null, xs) - padX, maxX = Math.max.apply(null, xs) + padX;
    var minY = Math.min.apply(null, ys) - padY, maxY = Math.max.apply(null, ys) + padY + padB;
    /* 分层布局是竖着堆的，允许缩得更小，否则最上面一层会顶到工具条后面 */
    /* 各布局的实际跨度差别很大：能缩到把整张图装进窗口为止，缩放下限按布局给 */
    var kmin = ph ? 0.22 : (LAY.name === 'grid' ? 0.20
      : (LAY.name === 'radial' || LAY.name === 'force' ? 0.20 : (LAY.name === 'layer' ? 0.30 : 0.24))), kmax = ph ? 1.0 : 1.25;
    var k = Math.min(kmax, Math.max(kmin, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    V.k = k;
    V.tx = r.width / 2 - ((minX + maxX) / 2) * k;
    V.ty = r.height / 2 - ((minY + maxY) / 2) * k - padB / 2;
    paintView();
  }



  /* ================= 批4：小笔记 / 搜索 / 拖入 / 精搜（web321） ================= */
  var B4_KEY = 'qbank.maphole.v1';
  var HOLD = (function () { var v = parseFloat(localStorage.getItem(B4_KEY) || ''); return (v >= 0.4 && v <= 5) ? v : 1.2; })();
  /* 长按多久算「展开」（短按就是打开抽屉看题） */
  var LKEY = 'qbank.map.long.v1';
  var LONG_MS = (function () { var v = parseInt(localStorage.getItem(LKEY) || '', 10); return (v >= 300 && v <= 3000) ? v : 800; })();
  var DZ = { tid: 0, hot: false, armed: false };
  /* 只在「刚打开脑图」和「换中心题」时播一次入场弹跳，其余重绘不动 */
  var ANIM_ONCE = false;
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
    s.innerHTML = '<div class="mp-sdh" id="mpSdh"><b id="mpSdName">题目</b><i id="mpSdKick"></i><span class="mp-grow"></span>' +
      '<button id="mpSdGear" class="mp-sdico" title="下拉手势：多快算「甩掉」">⚙</button>' +
      '<button id="mpSdFull" class="mp-sdico mp-sdico2" title="跳到题库里的这道题（真全屏）">⤢</button>' +
      '<button id="mpSdX" class="mp-sdico" title="关掉">✕</button>' +
      '<div class="mp-sdrow2" id="mpSdRow2"><button id="mpSdAi" class="mp-sdbtn" title="生成这道题的解析，写进原解析下面">✨ 解析这道题</button>' +
      '<button id="mpSdVar" class="mp-sdbtn">✨ 出变式题</button>' +
      '<button id="mpSdEdit" class="mp-sdbtn" title="改题干 / 选项 / 答案 / 解析（内置题库改的是本机补丁）">✎ 改这道题</button></div></div>' +
      '<div id="mpSdBody" class="mp-sdbody"></div>';
    (document.getElementById('mpWrap') || document.body).appendChild(s);
    s.querySelector('#mpSdX').onclick = sideClose;
    var gear = s.querySelector('#mpSdGear');
    if (gear) gear.onclick = function (e) { e.stopPropagation(); sdSetOpen(); };
    s.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    /* 点抽屉里的空白（不是选项 / 按钮 / 解析块）就收起，和样板一致。
       但「拖一下」不能算点：记下按下的位置，松手时位移 > 8px 就当拖动，忽略这次 click。 */
    var SDD = null;
    s.addEventListener('pointerdown', function (e) {
      SDD = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, true);
    s.addEventListener('click', function (e) {
      var moved = SDD ? Math.hypot(e.clientX - SDD.x, e.clientY - SDD.y) : 0;
      var quick = SDD ? (Date.now() - SDD.t) < 600 : true;
      SDD = null;
      if (moved > 8 || !quick) return;              /* 拖动 / 长按：不收起 */
      if (e.target.id === 'mpSdBody' || (e.target.classList && e.target.classList.contains('mp-sdbody'))) sideClose();
    });
    /* 抓标题条往上拖 = 拉高；往下甩过 90px = 收起；高度记住 */
    (function () {
      var hd = s.querySelector('#mpSdh');
      if (!hd) return;
      var dd = null;
      hd.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button,input,select')) return;
        dd = { y: e.clientY, h: s.getBoundingClientRect().height, t: Date.now(), dy: 0 };
        try { hd.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault(); e.stopPropagation();
      });
      hd.addEventListener('pointermove', function (e) {
        if (!dd) return;
        var nh = dd.h + (dd.y - e.clientY);
        var maxH = Math.round(Math.min(innerHeight - 120, window.innerHeight * 0.86));
        nh = Math.max(180, Math.min(maxH, nh));
        dd.dy = Math.max(dd.dy, e.clientY - dd.y);
        dd.nh = dd.h + (dd.y - e.clientY);      /* 未夹紧的目标高度，用来判断「拖到底」 */
        s.style.height = nh + 'px';
        s.style.maxHeight = 'none';
      });
      hd.addEventListener('pointerup', function (e) {
        if (!dd) return;
        var dy = Math.max(dd.dy, e.clientY - dd.y);
        var dt = Math.max(1, Date.now() - dd.t);
        var hh = s.getBoundingClientRect().height;
        var raw = (dd.nh === undefined) ? dd.h : dd.nh;   /* 未夹紧的目标高度 */
        dd = null;
        /* ① 速度：慢慢往下拉 = 改高度；快速往下一甩 = 收起（阈值可在 ⚙ 里设，默认 1.2 px/ms）
           ② 拖到底：一路压到很矮（< 140px）再松手，不管快慢都收起 —— 拖到底就「自己消失」 */
        var vel = dy / dt;                       /* px / ms */
        var vth = sdVel();
        var flick = dy > 36 && vel >= vth;
        var bottom = raw < 140 && dy > 40;
        if (flick || bottom) { s.style.height = ''; s.style.maxHeight = ''; sideClose(); return; }
        hh = Math.max(180, Math.min(Math.round(Math.min(innerHeight - 120, window.innerHeight * 0.86)), hh));
        s.style.height = hh + 'px';
        try { localStorage.setItem('qbank.map.sdh.v1', String(hh)); } catch (err) {}
      });
      hd.addEventListener('pointercancel', function () { dd = null; });
    })();
    return s;
  }
  /* 下拉手势阈值：px/ms，越大越不容易被「甩掉」 */
  function sdVel() {
    var v = 0;
    try { v = parseFloat(localStorage.getItem('qbank.map.sdvel.v1') || ''); } catch (e) {}
    if (!isFinite(v) || v <= 0) v = 1.2;
    return Math.max(0.3, Math.min(4, v));
  }
  function sdSetOpen() {
    var p = document.getElementById('mpSdSet');
    if (!p) {
      p = document.createElement('div'); p.id = 'mpSdSet';
      p.innerHTML = '<div class="mp-sds-h">下拉手势</div>' +
        '<div class="mp-sds-r"><span>多快算「甩掉」</span><b id="mpSdSetV"></b></div>' +
        '<input type="range" id="mpSdSetR" min="0.4" max="3" step="0.1">' +
        '<div class="mp-sds-t">慢慢往下拉 = 改高度；快速往下一甩 = 收起。数值越小越容易关掉。</div>' +
        '<div class="mp-sds-b"><button id="mpSdSetRst">恢复默认 1.2</button><button id="mpSdSetX">好了</button></div>';
      (document.getElementById('mpWrap') || document.body).appendChild(p);
      var r = p.querySelector('#mpSdSetR'), vv = p.querySelector('#mpSdSetV');
      var paint = function () {
        var v = sdVel(); r.value = String(v); vv.textContent = v.toFixed(1) + ' px/ms';
      };
      paint();
      r.oninput = function () {
        var v = Math.max(0.4, Math.min(3, parseFloat(r.value) || 1.2));
        try { localStorage.setItem('qbank.map.sdvel.v1', String(v)); } catch (e) {}
        vv.textContent = v.toFixed(1) + ' px/ms';
      };
      p.querySelector('#mpSdSetRst').onclick = function () {
        try { localStorage.removeItem('qbank.map.sdvel.v1'); } catch (e) {}
        paint();
      };
      p.querySelector('#mpSdSetX').onclick = function () { p.classList.remove('show'); };
    }
    p.classList.add('show');
    /* 挂在 ⚙ 下面，别飘到左上角 */
    try {
      var g = document.getElementById('mpSdGear'); var gr = g ? g.getBoundingClientRect() : null;
      var pw = p.offsetWidth || 280, ph = p.offsetHeight || 170;
      if (gr) {
        p.style.left = Math.round(Math.max(8, Math.min(innerWidth - pw - 8, gr.right - pw))) + 'px';
        p.style.top = Math.round(Math.min(innerHeight - ph - 8, gr.bottom + 6)) + 'px';
      }
    } catch (e) {}
  }
  function sideClose() {
    var s = document.getElementById('mpSide'); if (s) s.classList.remove('show');
  }

  /* ⤢ 真全屏：真的跳到题库里的这道题（走站里自己的路由），
     站里左上角「‹ 返回」把 hash 退回后，自动把组别 / 选中 / 视口还原 */
  var MP_RET = null;
  function jumpBank(n) {
    try { saveCur(); } catch (eSv) {}   /* 跳走前先存档：不然刚展开的路径会丢 */
    var bid = S.bankId || (DATA.bank && (DATA.bank.id || DATA.bank.bid)) || '';
    var qid = (n && n.ref && n.ref.id) || '';
    try {
      sessionStorage.setItem('qbank.map.ret.v1', JSON.stringify({
        bid: bid, gid: G.active, sel: sel, tx: V.tx, ty: V.ty, k: V.k, qid: qid,
        /* 从哪儿来的：主页就回主页，答到第几题就回第几题 */
        fromHash: String(location.hash || '#/'),
        qcur: (typeof QZ !== 'undefined' && QZ && QZ.cur) ? QZ.cur : ''
      }));
    } catch (e) {}
    try {
      if (typeof QZ !== 'undefined' && QZ && qid) { QZ.bankId = bid; QZ.cur = qid; }
      if (typeof window.render === 'function') window.render();
    } catch (e) {}
    try { sideClose(); close(); } catch (e) {}
    if (bid) { try { location.hash = '#/bank/' + encodeURIComponent(bid); } catch (e) {} }
    mpReturnWatch();
  }
  function mpReturnWatch() {
    if (MP_RET) return;
    MP_RET = function () {
      var h = String(location.hash || '');
      if (h.indexOf('#/bank') === 0) return;
      window.removeEventListener('hashchange', MP_RET); MP_RET = null;
      var snap = null;
      try {
        snap = JSON.parse(sessionStorage.getItem('qbank.map.ret.v1') || 'null');
        sessionStorage.removeItem('qbank.map.ret.v1');
      } catch (e) {}
      if (!snap || !snap.bid) return;
      /* 有组就先把那一组原样读回来（路径展开的节点都在存档里）；
         读不到才退回「按中心题重建」，否则一进题库再回来，刚铺的路径就没了 */
      var restored = false;
      if (snap.gid) {
        try {
          var g0 = (G.list || []).filter(function (x) { return x.id === snap.gid; })[0];
          if (g0) { G.active = g0.id; if (g0.bank) S.bankId = g0.bank; loadGroup(g0); restored = true; }
        } catch (eG0) {}
      }
      if (!restored) { try { openFor(snap.bid, snap.qid || ''); } catch (e) { return; } }
      setTimeout(function () {
        try {
          if (!restored && snap.gid) {
            var gg = (G.list || []).filter(function (x) { return x.id === snap.gid; })[0];
            if (gg) { G.active = gg.id; loadGroup(gg); }
          }
        } catch (e) {}
        setTimeout(function () {
          try { V.tx = snap.tx; V.ty = snap.ty; V.k = snap.k; paintView(); } catch (e) {}
          /* 关键：把底下的页面也送回原来的位置 —— 从主页点进来的就回主页，
             从第 3 题点进来的就回第 3 题，而不是一律停在答题页 */
          try {
            if (snap.qcur && typeof QZ !== 'undefined' && QZ) QZ.cur = snap.qcur;
            var fh = String(snap.fromHash || '');
            /* '' / '#' / '#/' 都算主页；否则回到原来那个页面（含原来那道题） */
            var target = (!fh || fh === '#') ? '#/' : fh;
            if (target !== String(location.hash || '')) {
              if (typeof window.render === 'function') { try { window.render(); } catch (e1) {} }
              try { location.hash = target; } catch (e2) {}
            }
          } catch (e) {}
          try {
            if (snap.sel) {
              var nd = (DATA.nodes || []).filter(function (x) { return x.id === snap.sel; })[0];
              if (nd) { sel = nd.id; sideOpen(nd); render(true); }
            }
          } catch (e) {}
          if (typeof toast === 'function') toast('回到刚才那一组了', 1600, 'good');
        }, 420);
      }, 900);
    };
    window.addEventListener('hashchange', MP_RET);
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
    /* 解析里可能已经追加过「【AI 解析】」段，这里只留原解析，AI 段单独渲染 */
    s = s.split('【AI 解析】')[0];
    return s.replace(/^\s*【?解析】?\s*[:：]?\s*/, '').trim();
  }
  /* ---- 题目级 AI 解析：写在「原解析」下面，跟着这道题存 ---- */
  function qAiNote(q) {
    if (!q) return '';
    if (q.__aiExp) return String(q.__aiExp).replace(/^\s*【AI 解析】\s*/, '');
    try {
      var g = gCur();
      if (g && g.aiq && g.aiq[q.id]) return String(g.aiq[q.id]).replace(/^\s*【AI 解析】\s*/, '');
    } catch (e0) {}
    var ex = String(q.explain || q.exp || '');
    var i = ex.indexOf('【AI 解析】');
    return i >= 0 ? ex.slice(i).replace(/^\s*【AI 解析】\s*/, '') : '';
  }

  function qAiBuild(q, tagName) {
    var letters = 'ABCDEFGHIJKL'.split('');
    var ans = answerLetter(q);
    var opts = Array.isArray(q.opts) ? q.opts : (Array.isArray(q.options) ? q.options : []);
    var exp = expText(q).trim();
    var tg = (tagName ? [tagName] : []).concat(
      (typeof kpTags === 'function' ? kpTags(q) : []).filter(function (t) { return t !== tagName; })
    ).filter(function (t) { return t && !isBigTag(t); });

    var L = [];
    L.push('【AI 解析】');
    L.push('**正确答案：' + (ans || '—') + '**' +
      (ans && opts[letters.indexOf(ans[0])] ? ('（' + String(opts[letters.indexOf(ans[0])]).replace(/^[A-H][.、\s]*/, '') + '）') : ''));
    L.push('');
    L.push('**为什么是它**：' + (exp ? exp.split(/[。；]/)[0] + '。'
      : ('题干问的是「' + (tg[0] || '这个知识点') + '」，正确项直接对上了这个判据。')));
    if (opts.length) {
      L.push('');
      L.push('**逐项看**：');
      opts.forEach(function (o, i) {
        var Lt = letters[i] || String(i + 1);
        var isOk = ans.indexOf(Lt) >= 0;
        var body = String(o).replace(/^[A-H][.、\s]*/, '');
        L.push('- ' + Lt + ' ' + body + (isOk ? ' —— **对**：它符合题干问的' + (tg[0] ? '「' + tg[0] + '」' : '判据') + '。'
          : ' —— 错：换个疾病/换个部位/换个机制才对得上，题目没问这个。'));
      });
    }
    if (tg.length) { L.push(''); L.push('**考点**：' + tg.slice(0, 4).join('、')); }
    var multi = (ans || '').length > 1;
    L.push('');
    L.push('**易错**：' + (multi
      ? '这题是多选（' + ans + '），只选一个必然漏分；把每个选项都拿题干里的判据过一遍。'
      : '干扰项通常换的是「部位 / 时间 / 机制」中的一个字，读题时先把题干里的限定词圈出来。'));
    return L.join('\n');
  }

  function qAiRun(n) {
    var q = (n && n.ref) ? n.ref : null;
    if (!q) { toast('这道题没有题面数据'); return; }
    var tg = [];
    try { tg = (typeof kpTags === 'function') ? kpTags(q) : []; } catch (e1) {}
    var tgSmall = tg.filter(function (t) { return !isBigTag(t); });
    toast('正在写解析…', 900);
    var txt = qAiBuild(q, tgSmall[0] || '');
    var bid = (q._bank) || (DATA.bank && (DATA.bank.id || DATA.bank.bid)) || S.bankId;
    var oldExp = String(q.explain || q.exp || '');
    var merged = oldExp.replace(/\n\n【AI 解析】[\s\S]*$/, '') + (oldExp ? '\n\n' : '') + txt;
    var saved = false;
    try {
      if (typeof window.updateBankQuestion === 'function' && bid) {
        var r = window.updateBankQuestion(bid, q.id, { explain: merged });
        saved = !!(r && r.ok);
      }
    } catch (e2) {}
    if (saved) {
      q.explain = merged;
      q.__aiExp = txt;
      toast('已写进这道题的解析下面（题库里也存了）');
    } else {
      /* 内置题库只读：存到当前组里，照样显示在原解析下面 */
      try {
        var g = gCur(); if (g) { g.aiq = g.aiq || {}; g.aiq[q.id] = txt; saveCur(); }
        q.__aiExp = txt;
        toast('这道题在内置题库里（只读），AI 解析先存在这张图里');
      } catch (e3) { toast('没存下来：' + (e3 && e3.message ? e3.message : e3)); }
    }
    try { sideOpen(n); } catch (e4) {}
    try {
      var box = document.querySelector('#mpSdBody .mp-sdai');
      if (box) {
        box.classList.add('flash');
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(function () { box.classList.remove('flash'); }, 1400);
      }
    } catch (e5) {}
  }

  function sideOpen(n) {
    var s = sideEnsure();
    try {
      var savedH = parseInt(localStorage.getItem('qbank.map.sdh.v1') || '0', 10);
      if (savedH > 160) { s.style.height = savedH + 'px'; s.style.maxHeight = 'none'; }
    } catch (e0) {}
    var q = (n.ref && typeof n.ref === 'object') ? n.ref : {};
    /* 老存档只存了 {id, stem}：点开时按 id 去所有题库里把整道题捞回来（选项/答案/解析都在里面） */
    if ((n.type === 'sim' || n.type === 'center' || n.type === 'variant') && !n.type.match(/^file$/) &&
        q && !(Array.isArray(q.options) && q.options.length) && !(Array.isArray(q.opts) && q.opts.length)) {
      var full = findQAny((n.ref && n.ref.id) || n.refId, n.xbk || (n.ref && n.ref._bank));
      if (full) {
        n.ref = full; q = full;
        if (!n.xbk) n.xbk = full._bank || bankOfQ(full) || null;
      }
    }
    var bankId = (n.ref && n.ref._bank) || (DATA.bank && (DATA.bank.id || DATA.bank.bid)) || '';
    function esc2(x) { return String(x == null ? '' : x).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    /* 资料节点：抽屉里只给「就地看着 / 新标签打开」 */
    if (n && n.type === 'file') {
      var ff = (typeof fById === 'function') ? fById(n.fid) : null;
      s.querySelector('#mpSdName').textContent = '资料';
      s.querySelector('#mpSdKick').textContent = String(n.ext || (ff ? fileExtOf(ff) : '') || '文件').toUpperCase();
    var r2 = document.getElementById('mpSdRow2'); if (r2) r2.style.display = 'none';
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
      try { winFocus('#mpSide'); } catch (e0) {}
      return;
    }
    var isVariant = (n.type === 'variant');
    var varBtn = s.querySelector('#mpSdVar');
    if (varBtn) varBtn.style.display = isVariant ? 'none' : '';
    var r2b = document.getElementById('mpSdRow2'); if (r2b) r2b.style.display = isVariant ? 'none' : '';
    s.querySelector('#mpSdAi').style.display = '';
    var sdf2 = s.querySelector('#mpSdFull');
    /* AI 变式题不能当中心题，也就不给「跳到题库这道题」的 ⤢ */
    if (sdf2) { sdf2.style.display = isVariant ? 'none' : ''; if (!isVariant) sdf2.onclick = function () { try { jumpBank(n); } catch (e) {} }; }
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
    /* 题目级 AI 解析：生成后追加在原解析下面，跟着这道题一起存 */
    var aiqTxt = qAiNote(q);
    if (aiqTxt) html += '<div class="mp-sdexp mp-sdai"><b>AI 解析</b>' + md2h(aiqTxt) + '</div>';
    if (n.draft && n.type === 'variant') {
      html += '<div class="mp-sdvar"><b>变式草稿 · 三种改法</b>' +
        '<ol><li>换问法：把「典型 / 最有意义 / 最早出现」这类词换掉，考的还是同一个点。</li>' +
        '<li>换选项：把一个正确项换成邻近疾病的特征性体征，干扰更强。</li>' +
        '<li>换场景：加一句病史或体征描述，问「最可能诊断」。</li></ol>' +
        '<i>这里不会替你自动编题目：改写后的题请照录原文再存进题库。</i></div>';
    }
    s.querySelector('#mpSdBody').innerHTML = html;
    var vb2 = s.querySelector('#mpSdVar');
    if (vb2) vb2.onclick = function () { try { openVarPanel(n); } catch (e) {} };
    s.querySelector('#mpSdAi').onclick = function () { try { qAiRun(n); } catch (eQ0) {} };
    var edBtn = s.querySelector('#mpSdEdit');
    if (edBtn) {
      var canEditQ = (n.type === 'sim' || n.type === 'center' || n.type === 'variant');
      edBtn.style.display = (canEditQ && typeof window.openQEditor === 'function') ? '' : 'none';
      edBtn.onclick = function () {
        try {
          var host = s.querySelector('#mpSdEditHost');
          if (!host) {
            host = document.createElement('div');
            host.id = 'mpSdEditHost';
            host.className = 'mp-sdedit';
            s.querySelector('#mpSdBody').appendChild(host);
          }
          if (host.dataset.on === '1') { host.innerHTML = ''; host.dataset.on = '0'; return; }
          var qid0 = (q && q.id != null) ? q.id : n.refId;
          var bid = (q && q._bank) || n.xbk || (n.ref && n.ref._bank) || bankOfQ(q) || S.bankId;
          var fk = (typeof window.favKey === 'function') ? window.favKey({ id: bid }, q) : (bid + '#' + qid0);
          var tgt = { bankId: bid, qid: qid0, title: (q && q._bname) || '', patch: true };
          host.dataset.dbg = JSON.stringify({ bid: bid, qid: qid0, xbk: n.xbk || null, qb: (q && q._bank) || null });
          host.dataset.on = '1';
          window.openQEditor(host, fk, q, tgt, function () {
            /* 保存后把这张卡的题面换成新的，选项/解析立刻跟着变 */
            var fresh = findQAny(n.refId || (q && q.id), bid);
            if (fresh) { n.ref = fresh; n.label = fresh.stem; }
            host.dataset.on = '0'; host.innerHTML = '';
            try { sideOpen(n); } catch (eR) {}
            try { render(true); } catch (eR2) {}
            toast('改好了，这张卡已经用上新题面');
          });
          winFocus('#mpSdEditHost');
        } catch (eEd) { toast('改题面板没打开：' + eEd.message); }
      };
    }
    s.classList.add('show');
    try { winFocus('#mpSide'); } catch (e0) {}
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
    ANIM_ONCE = false;
    var c = DATA.nodes.filter(function (n) { return n.type === 'center'; })[0];
    if (c && !document.querySelector('.mp-probe')) {
      var b = document.createElement('button');
      b.className = 'mp-probe'; b.type = 'button'; b.textContent = PROBING ? '精搜中…' : '✨ AI 精搜';
      b.title = '全库再找一遍相似题，够像的直接并进来';
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
    try { winFocus('#mpPv'); } catch (e0) {}
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
    try { winFocus('#mpWrap'); } catch (e0) {}
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
    /* 题目卡拖进来：松手立即换中心，不走「停 1.2 秒」那道门（那道门是给误拖兜底的） */
    var qid0 = '';
    try { qid0 = e.dataTransfer.getData('text/qid') || ''; } catch (err) {}
    if (!qid0 && !DZ.hot) { if (typeof toast === 'function') toast('再停一会儿才接哦（现在 ' + HOLD + ' 秒）', 1600, 'warn'); dzReset(); return; }
    e.preventDefault(); e.stopPropagation();
    var qid = qid0;
    if (!qid) { try { qid = e.dataTransfer.getData('text/qid') || ''; } catch (err) {} }
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
      render(true);
      if (typeof toast === 'function') toast('这张资料已经在图上了，挪到这儿了', 1600);
      return exist;
    }
    var id = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100);
    var node = { id: id, type: 'file', fid: f.id, ext: fileExtOf(f), label: String(f.name || '资料'), x: x, y: y };
    DATA.nodes.push(node);
    sel = id;
    try { saveCur(); } catch (e) {}
    render(true);
    if (typeof toast === 'function') toast('已把资料挂到画布：' + String(f.name || '').slice(0, 14), 1800, 'good');
    return node;
  }

  function markDraggables() {
    try {
      var card = document.querySelector('#view .qcard') || document.querySelector('#view .stem');
      if (card && !card.dataset.mapdrag) {
        card.dataset.mapdrag = '1'; card.draggable = true; card.style.cursor = 'grab';
        try {
        d.addEventListener('pointerdown', function () {
          try { document.body.classList.add('pip-top'); } catch (e3) {}
        }, true);
      } catch (e4) {}
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

  /* ---------- 小窗（iframe ?pip=1）里的题卡也能拖进来换成中心 ----------
     小窗是独立文档，map.js 的 markDraggables() 够不到它；同一来源下可以直接进去挂拖拽。
     拿不到题目 id 时就按题干文字在题库里反查。 */
  function qidByStem(txt) {
    var t = String(txt || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!t) return '';
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) return '';
    var qs = bank.questions || [];
    for (var i = 0; i < qs.length; i++) {
      var st = String(qs[i].stem || '').replace(/\s+/g, ' ').trim();
      if (st && (st.slice(0, 60) === t || st === t)) return String(qs[i].id);
    }
    return '';
  }
  function hookPip(ifr) {
    if (!ifr || ifr.__pipHooked) return;
    ifr.__pipHooked = 1;
    var once = function () {
      var d = null;
      try { d = ifr.contentDocument; } catch (e) { return; }
      if (!d || d.__pipDragHooked) return;
      d.__pipDragHooked = 1;
      /* 小窗里「下一题」会重建题卡，所以 draggable 用委托：指到/按到哪张卡就标哪张；
         dragstart 时再按当下这张卡的题干反查题目 id */
      var mark = function (el) {
        var c = el && el.closest ? el.closest('#view .qcard, #view .stem') : null;
        if (c && !c.__md) { c.__md = 1; c.draggable = true; c.style.cursor = 'grab'; }
      };
      d.addEventListener('pointerover', function (e) { mark(e.target); }, true);
      d.addEventListener('pointerdown', function (e) {
        mark(e.target);
        try { document.body.classList.add('pip-top'); } catch (e3) {}
      }, true);
      d.addEventListener('dragstart', function (e) {
        var stem = '';
        try { var s1 = d.querySelector('#view .qcard .stem') || d.querySelector('#view .stem'); stem = s1 ? s1.textContent : ''; } catch (err) {}
        var qid = qidByStem(stem);
        try {
          if (qid) e.dataTransfer.setData('text/qid', qid);
          e.dataTransfer.setData('text/plain', qid || '');
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) {}
      }, true);
    };
    try { ifr.addEventListener('load', function () { setTimeout(once, 260); }); } catch (e) {}
    setTimeout(once, 320);
  }
  function hookPips() {
    try {
      var fs = document.querySelectorAll('iframe.pip-frame, iframe[src*="pip=1"]');
      for (var i = 0; i < fs.length; i++) hookPip(fs[i]);
    } catch (e) {}
  }

  /* ---------- 拖「小窗」压到脑图上：边缘发光 + 右上角倒计时，停够时间就换中心 ----------
     小窗是整块窗口在跟着鼠标走（不是 HTML5 拖拽），所以用「窗口矩形和脑图矩形重叠面积」判断，
     而不是光标位置——光标永远在小窗自己身上。 */
  var PIPD = null;
  function pipOverlap(wr) {
    var w = $('#mpWrap'); if (!w) return 0;
    var r = w.getBoundingClientRect();
    var ox = Math.max(0, Math.min(wr.right, r.right) - Math.max(wr.left, r.left));
    var oy = Math.max(0, Math.min(wr.bottom, r.bottom) - Math.max(wr.top, r.top));
    var area = Math.max(1, wr.width * wr.height);
    return (ox * oy) / area;
  }
  function pipTip(show, txt) {
    var t = document.getElementById('mpPipTip');
    if (!t) {
      t = document.createElement('div'); t.id = 'mpPipTip';
      (document.getElementById('mpWrap') || document.body).appendChild(t);
    }
    t.textContent = txt || '';
    t.classList.toggle('show', !!show);
  }
  function pipQidNow() {
    try {
      var ifr = document.querySelector('iframe.pip-frame, iframe[src*="pip=1"]');
      if (!ifr) return '';
      var d = ifr.contentDocument; if (!d) return '';
      var s1 = d.querySelector('#view .qcard .stem') || d.querySelector('#view .stem');
      return s1 ? qidByStem(s1.textContent) : '';
    } catch (e) { return ''; }
  }
  function bindPipDrop() {
    if (document.__pipDropB) return; document.__pipDropB = 1;
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest || !e.target.closest('.pip-win')) return;
      PIPD = { armed: false, left: false };
      /* 一按住小窗：小窗立刻升到最前（拖起来的时候不能被脑图压着） */
      var pl = document.getElementById('pipLayer');
      if (pl) pl.style.zIndex = '30060';
      try { document.body.classList.add('pip-top'); } catch (e0) {}
      /* 同时脑图先亮「准备接收」的静态光边（还没进窗就有反馈） */
      var w = $('#mpWrap'); if (w) w.classList.add('dzarm');
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!PIPD) return;
      /* 拖动过程中反复确认层级（别的模块可能顺手改掉） */
      var lp = document.getElementById('pipLayer');
      if (lp && lp.style.zIndex !== '30060') lp.style.zIndex = '30060';
      var pw = document.querySelector('.pip-win.on') || document.querySelector('.pip-win');
      if (!pw) return;
      var ov = pipOverlap(pw.getBoundingClientRect());
      var inside = ov >= 0.34;
      if (inside && !PIPD.armed) {
        PIPD.armed = true; PIPD.left = false;
        var ww = $('#mpWrap'); if (ww) ww.classList.add('dzpull');
        dzArm();
        /* 倒计时显示：0.8s 这样往下跳 */
        var t0 = Date.now();
        clearInterval(PIPD.iv);
        var iv = null;
        iv = setInterval(function () {
          if (!PIPD) { clearInterval(iv); return; }
          var left = Math.max(0, HOLD - (Date.now() - t0) / 1000);
          pipTip(true, left > 0 ? ('停一下换中心 · ' + left.toFixed(1) + ' 秒') : '松手就换成中心题');
          if (left <= 0) { clearInterval(iv); clearInterval(PIPD && PIPD.iv); }
        }, 80);
        PIPD.iv = iv;
      } else if (!inside && PIPD.armed) {
        PIPD.armed = false; PIPD.left = true;
        clearInterval(PIPD.iv); pipTip(false);
        dzReset();
        var wz = $('#mpWrap'); if (wz) wz.classList.remove('dzpull');
      }
    }, true);
    document.addEventListener('pointerup', function (e) {
      if (!PIPD) return;
      var wasHot = DZ.hot, armed = PIPD.armed;
      try { clearInterval(PIPD.iv); } catch (e0) {}
      PIPD = null;
      pipTip(false);
      var wEnd = $('#mpWrap');
      if (wEnd) { wEnd.classList.remove('dzarm'); wEnd.classList.remove('dzpull'); }
      /* 松手后交还给 CSS（body.pip-top 决定它该在哪一层） */
      try { var lz = document.getElementById('pipLayer'); if (lz) lz.style.zIndex = ''; } catch (e1) {}
      if (wasHot && armed) {
        dzReset();
        if (wEnd) { wEnd.classList.add('dzflash'); setTimeout(function () { wEnd.classList.remove('dzflash'); }, 420); }
        var qid = pipQidNow();
        var bank = null; try { bank = bankById(S.bankId); } catch (err) {}
        var q = bank && (bank.questions || []).filter(function (x) { return String(x.id) === String(qid); })[0];
        if (q) {
          recenter(q);
          if (typeof toast === 'function') toast('已把这道题设成中心题', 1500, 'good');
        } else if (typeof toast === 'function') {
          toast('这道题不在当前题库里', 1600, 'warn');
        }
      } else {
        dzReset();
      }
    }, true);
    document.addEventListener('pointercancel', function () {
      if (PIPD) {
        clearInterval(PIPD.iv); PIPD = null; pipTip(false); dzReset();
        var wc = $('#mpWrap'); if (wc) { wc.classList.remove('dzarm'); wc.classList.remove('dzpull'); }
      }
    }, true);
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
  var PROBING = false;
  function probe(centerNode) {
    if (PROBING) return;
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) return;
    PROBING = true; render(true);
    try {
      var w0 = document.getElementById('mpWrap');
      if (w0 && !document.getElementById('mpProbeBar')) {
        var pb = document.createElement('i');
        pb.id = 'mpProbeBar';
        w0.appendChild(pb);
      }
    } catch (e1) {}
    setTimeout(function () { probeRun(centerNode); }, 30);
  }
  /* AI 精排：完全照站里 sim.js 的那套来（同一份 aiChat 调用方式、同一种 JSON 格式），
     所以参数名必须是 temp / maxTokens，格式必须是 {"picks":[{"i":1,"why":"…"}]}。 */
  function aiReady() {
    try {
      if (typeof window.aiChat !== 'function') return false;
      var c = (typeof aiCfg === 'function') ? aiCfg() : null;
      return !!(c && c.model);
    } catch (e) { return false; }
  }

  function aiRerank(centerQ, cands) {
    return new Promise(function (resolve) {
      if (!aiReady() || !cands.length) { resolve(null); return; }
      var cut = function (s, n) { s = String(s || '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };
      var lines = cands.map(function (c, i) {
        var tg = qTags(c.q).slice(0, 3).join('·');
        return (i + 1) + '. [' + tg + '] ' + cut(c.q.stem, 120)
          + '\n   选项：' + cut((c.q.options || []).join(' / '), 70);
      }).join('\n');
      var sys = '你是医学题库的助教。用户给了 1 道「当前题」和若干「候选题」，'
        + '请挑出与当前题考查同一知识点、或容易混淆的候选，最多 5 个，按相关度从高到低。'
        + '只输出一行 JSON：{"picks":[{"i":候选序号,"why":"不超过 18 个字说明为什么像"}]}。'
        + '不要输出别的任何文字；一条都不像就输出 {"picks":[]}。';
      var user = '当前题：\n' + cut(centerQ.stem, 220)
        + '\n选项：' + (centerQ.options || []).map(function (o, i) { return 'ABCDEFGH'[i] + '.' + cut(o, 24); }).join(' ')
        + '\n\n候选题：\n' + lines;

      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var done = false;
      var fin = function (v) { if (done) return; done = true; clearTimeout(t); resolve(v); };
      var t = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e0) {} fin(null); }, 20000);
      var p;
      try {
        p = window.aiChat([{ role: 'system', content: sys }, { role: 'user', content: user }],
          null, ctl ? ctl.signal : null, { stream: false, temp: 0.2, maxTokens: 600 });
      } catch (e1) { fin(null); return; }
      Promise.resolve(p).then(function (txt) {
        try {
          var m = String(txt || '').match(/\{[\s\S]*\}/);
          var o = m ? JSON.parse(m[0]) : null;
          var picks = (o && o.picks) || [];
          var out = [];
          picks.forEach(function (pk) {
            var i = (typeof pk.i === 'number' ? pk.i : parseInt(pk.i || pk.index || pk.n, 10)) - 1;
            if (i >= 0 && i < cands.length) out.push({ i: i, why: String(pk.why || pk.reason || '').slice(0, 40) });
          });
          fin(out.length ? out : []);
        } catch (e2) { fin(null); }
      }).catch(function () { fin(null); });
    });
  }

  function probeRun(centerNode) {
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    PROBING = false;
    try {
      var pb0 = document.getElementById('mpProbeBar');
      if (pb0) setTimeout(function () { try { pb0.remove(); } catch (e9) {} }, 380);
    } catch (e0) {}
    if (!bank) { render(true); return; }
    /* 中心节点只存 ref（题目对象），没有 refId —— 老写法在这里静默 return，按钮看着「没反应」 */
    var cid = centerNode.refId || (centerNode.ref && centerNode.ref.id);
    var q0 = (bank.questions || []).filter(function (x) { return String(x.id) === String(cid); })[0];
    if (!q0) { render(true); if (typeof toast === 'function') toast('中心题不在这个题库里了', 1800, 'warn'); return; }
    var have = {}; DATA.nodes.forEach(function (n) { var k = n.refId || (n.ref && n.ref.id); if (k) have[k] = 1; });
    var t0 = qTags(q0).map(function (s) { return String(s).toLowerCase(); });
    var s0 = bg(q0.stem), o0 = bg((q0.options || []).join(' '));
    var cand = [];
    /* AI 精搜也跨题库：默认那批相似题是「全库初筛」，这一步相当于再筛一遍 */
    var probePool = allQPool();
    if (!probePool.length) probePool = (bank.questions || []);
    probePool.forEach(function (q) {
      if (q === q0 || have[q.id]) return;
      if (!q.stem) return;
      var t1 = qTags(q).map(function (s) { return String(s).toLowerCase(); });
      var tagHit = 0;
      if (t0.length) { tagHit = t0.filter(function (x) { return t1.indexOf(x) >= 0; }).length / t0.length; }
      var sc = 0.45 * tagHit + 0.35 * overlap(s0, bg(q.stem)) + 0.20 * overlap(o0, bg((q.options || []).join(' ')));
      if (sc >= 0.42) cand.push({ q: q, s: sc });
    });
    cand.sort(function (a, b) { return b.s - a.s; });
    cand = cand.slice(0, 8);
    if (!cand.length) {
      render(true);
      if (typeof toast === 'function') toast('全库里没有更相似的题了', 1800, 'ok');
      return;
    }

    var place = function (list, byAi) {
      var maxR = 320;
      DATA.nodes.forEach(function (n) { maxR = Math.max(maxR, Math.hypot(n.x, n.y)); });
      var R = maxR + 90;
      list.forEach(function (it, i) {
        var ang = (-Math.PI / 2) + (i - (list.length - 1) / 2) * 0.5 + Math.PI * 0.12;
        var id = 'ps' + Date.now().toString(36) + i;
        DATA.nodes.push({ id: id, type: 'sim', ref: it.q, refId: it.q.id, xbk: (it.q._bank || S.bankId), label: String(it.q.stem || '').slice(0, 52), score: Math.round(60 + it.s * 40), ai: true, aiPick: !!byAi, aiWhy: it.why || '', x: Math.cos(ang) * R, y: Math.sin(ang) * R });
        DATA.edges.push({ a: centerNode.id, b: id, kind: 'sim', w: it.s });
      });
      try { saveCur(); } catch (e) {}
      render();
      setTimeout(fit, 60);
      if (typeof toast === 'function') {
        toast(byAi ? ('AI 精搜：模型筛后留下 ' + list.length + ' 道，已并入本组') : ('AI 精搜：新增 ' + list.length + ' 道高相似题，已并入本组'), 2200, 'good');
      }
    };

    try { if (typeof toast === 'function') toast('AI 正在判定这 ' + cand.length + ' 道……', 1600, 'ok'); } catch (eS0) {}
    aiRerank(q0, cand).then(function (picks) {
      if (picks === null) {
        if (typeof toast === 'function') toast('模型没回话（或没配模型），先用本地结果', 2200, 'warn');
        place(cand.slice(0, 5), false);
        return;
      }
      var keep = picks.map(function (p) {
        var it = cand[p.i];
        return it ? { q: it.q, s: it.s, why: p.why } : null;
      }).filter(Boolean);
      if (!keep.length) {
        render(true);
        if (typeof toast === 'function') toast('AI 认为这几道都不算同一个考点，这次没加', 2400, 'ok');
        return;
      }
      place(keep, true);
    });
  }

  /* 新点开的图：本地先上图，AI 在后台复核一遍「是不是同一个考点」，不太像的撤掉。
     老组不动（用户明确：只对新点开的图生效，不回头补）。 */
  function aiReviewFresh(gid, bank, q) {
    try {
      var g = (G.list || []).filter(function (x) { return x.id === gid; })[0];
      if (!g || g.aiRev) return;
      if (typeof window.aiChat !== 'function') return;
      var sims = DATA.nodes.filter(function (n) { return n.type === 'sim' && n.ref && !n.aiPick; });
      if (sims.length < 2) return;
      g.aiRev = 1; gSave();
      var cands = sims.map(function (n) { return { q: n.ref, s: (n.score || 0) / 100, node: n }; });
      aiRerank(q, cands).then(function (picks) {
        if (picks === null) return;
        var keepIdx = {};
        picks.forEach(function (p) { keepIdx[p.i] = 1; });
        var drop = {};
        cands.forEach(function (c, i) { if (!keepIdx[i]) drop[c.node.id] = 1; });
        var nDrop = Object.keys(drop).length;
        if (!nDrop) return;
        DATA.nodes = DATA.nodes.filter(function (n) { return !drop[n.id]; });
        DATA.edges = DATA.edges.filter(function (e) { return !drop[e.a] && !drop[e.b]; });
        try { applyLayout(LAY.name); } catch (e0) { render(); }
        try { saveCur(); } catch (e1) {}
        if (typeof toast === 'function') toast('AI 复核：去掉 ' + nDrop + ' 道不太像的，其余按 AI 选留下', 2400, 'ok');
      });
    } catch (eA) {}
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
          applyFil(); render(true);
          try { drawEdges(); } catch (err2) {}
        });
        /* 建段时先按已存的过滤状态勾好，别出现「画面没有变式、勾选框却是空的」 */
        try { applyFil(); } catch (err) {}
      }
      /* 路径模式：点相似题就地延伸，中心不动（最多 10 步） */
      if (!$('#mpPath')) {
        var pb2 = document.createElement('button');
        pb2.id = 'mpPath';
        pb2.type = 'button';
        pb2.title = '路径模式：点相似题就地延伸，中心不动（最多 ' + PATHM.max + ' 步）';
        pb2.textContent = '🧭 路径';
        var anchor = $('#mpFil');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(pb2, anchor);
        else if (tg && tg.parentNode) tg.parentNode.insertBefore(pb2, tg);
        else tools.appendChild(pb2);
        pb2.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        pb2.onclick = function (e) { e.stopPropagation(); pathSet(!PATHM.on); };
        try { paintPath(); } catch (e1) {}
      }
      /* 保存：路径模式里改完点这里，这一组才进「🧭 路径组」；平时点就是存一下这一组 */
      if (!$('#mpSave')) {
        var sb = document.createElement('button');
        sb.id = 'mpSave';
        sb.type = 'button';
        sb.title = '保存这一组（路径模式里点它 = 存成路径组）';
        sb.textContent = '💾 保存';
        var an2 = $('#mpPath') || $('#mpFil');
        if (an2 && an2.parentNode) an2.parentNode.insertBefore(sb, an2.nextSibling);
        else if (tg && tg.parentNode) tg.parentNode.insertBefore(sb, tg);
        else tools.appendChild(sb);
        sb.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        sb.onclick = function (e) {
          e.stopPropagation();
          var g = gCur();
          if (!g) { if (typeof toast === 'function') toast('先打开一张导图再保存', 1600, 'warn'); return; }
          var asPath = !!PATHM.on;
          if (asPath) g.path = 1;
          try { saveCur(); } catch (eS0) {}
          try { if (typeof gSaveNow === 'function') gSaveNow(); } catch (eS1) {}
          try { renderGrp(); } catch (eS2) {}
          if (typeof toast === 'function') toast(asPath ? '已存成路径组（组别里 🧭 那栏能翻到）' : '已保存这一组', 1800, 'good');
        };
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
    if (tools && !$('#mpLongBox')) {
      var lb = document.createElement('span');
      lb.id = 'mpLongBox';
      lb.innerHTML = '<span>长按</span><input id="mpLong" type="number" min="0.3" max="3" step="0.1" value="' + (LONG_MS / 1000).toFixed(1) + '"><span>秒</span>';
      var hb2 = $('#mpHoldBox');
      if (hb2 && hb2.parentNode) hb2.parentNode.insertBefore(lb, hb2.nextSibling);
      else { var tg3 = tools.querySelector('.mp-tgrow'); if (tg3 && tg3.parentNode) tg3.parentNode.insertBefore(lb, tg3); else tools.appendChild(lb); }
      $('#mpLong').addEventListener('change', function () {
        var v = Math.round(parseFloat(this.value) * 1000);
        if (!(v >= 300 && v <= 3000)) v = 800;
        this.value = (v / 1000).toFixed(1);
        LONG_MS = v;
        try { localStorage.setItem(LKEY, String(v)); } catch (e) {}
        if (typeof toast === 'function') toast('长按 ' + (v / 1000).toFixed(1) + ' 秒展开相似题与考点', 1600, 'ok');
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
      /* 发光只属于「小窗拖进来」这一路（bindPipDrop），题卡/资料柜拖拽不发光 */
    wrap.addEventListener('dragenter', function (e) { if (canTake(e.dataTransfer)) { e.preventDefault(); } });
      wrap.addEventListener('dragover', function (e) { if (canTake(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      wrap.addEventListener('dragleave', function (e) { if (!wrap.contains(e.relatedTarget)) dzReset(); });
      wrap.addEventListener('drop', onDrop);
      window.addEventListener('dragend', dzReset);
      document.addEventListener('drop', function () { setTimeout(dzReset, 30); }, true);
    }
    markDraggables();
    bindPipDrop();
    hookPips(); setTimeout(hookPips, 900); setTimeout(hookPips, 2200);
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
  /* 存档合并写：一次交互里常常连着调好几次 gSave，每次都把「所有组」序列化进 localStorage
     是打开卡顿的主因之一 —— 合并到 140ms 一次，关窗/切后台再强制刷一次。 */
  var GSAVE_T = null;
  function gSaveNow() {
    try { clearTimeout(GSAVE_T); GSAVE_T = null; } catch (e0) {}
    try { writeLS(G_KEY, { active: G.active, list: G.list }); } catch (e1) {}
  }
  function gSave() {
    try { clearTimeout(GSAVE_T); } catch (e0) {}
    GSAVE_T = setTimeout(gSaveNow, 140);
  }
  try { window.addEventListener('pagehide', gSaveNow); document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') gSaveNow(); }); } catch (e2) {}
  function gNewId() { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100); }
  function gCur() { var a = G.active; return G.list.filter(function (x) { return x.id === a; })[0] || null; }

  function serNode(n) {
    return { id: n.id, type: n.type, label: n.label, score: n.score, x: n.x, y: n.y,
      refId: (n.type === 'tag' || n.type === 'file') ? null : (n.ref && n.ref.id),
      xb: n.xbk || (n.ref && n.ref._bank) || null,
      fid: n.fid || null, ext: n.ext || null,
      lv: (n.lv == null ? null : n.lv), path: n.path ? 1 : 0,
      va: n.variantAi ? 1 : 0, src: n.srcQid || null };
  }
  /* 跨题库找题：先按存的题库 id 找，再退回「哪个库有这道题就用哪个库」。
     老存档没存题库时，题只会退化成 {id, stem} 的空壳（抽屉里就只剩一行题干）。 */
  /* 这道题到底属于哪个题库：先看引用是否同一个对象，再看 id + 题干是否一致 */
  function bankOfQ(q) {
    if (!q) return null;
    if (q._bank) return q._bank;
    var banks0 = [];
    try { banks0 = (typeof allBanks === 'function') ? allBanks() : []; } catch (e0) { banks0 = []; }
    for (var i = 0; i < banks0.length; i++) {
      var list = (banks0[i] && banks0[i].questions) || [];
      for (var k = 0; k < list.length; k++) {
        if (list[k] === q) return banks0[i].id;
      }
    }
    for (var j = 0; j < banks0.length; j++) {
      var l2 = (banks0[j] && banks0[j].questions) || [];
      for (var m = 0; m < l2.length; m++) {
        if (String(l2[m].id) === String(q.id) && String(l2[m].stem || '') === String(q.stem || '')) return banks0[j].id;
      }
    }
    return null;
  }
  function findQAny(refId, bankId) {
    if (refId == null || refId === '') return null;
    var banks0 = [];
    try { banks0 = (typeof allBanks === 'function') ? allBanks() : []; } catch (e0) { banks0 = []; }
    var order = [];
    if (bankId) {
      var b0 = banks0.filter(function (b) { return String(b && b.id) === String(bankId); })[0];
      if (b0) order.push(b0);
    }
    banks0.forEach(function (b) {
      if (order.indexOf(b) < 0) order.push(b);
    });
    for (var i = 0; i < order.length; i++) {
      var list = (order[i] && order[i].questions) || [];
      for (var k = 0; k < list.length; k++) {
        if (String(list[k].id) === String(refId)) return list[k];
      }
    }
    return null;
  }
  function deNode(n, bank) {
    var out = { id: n.id, type: n.type, label: n.label, score: n.score, x: n.x, y: n.y };
    if (n.lv != null) out.lv = n.lv;
    if (n.path) out.path = true;
    if (n.va) out.variantAi = true;
    if (n.src) out.srcQid = n.src;
    if (n.type === 'tag') out.ref = n.label;
    else if (n.type === 'file') { out.fid = n.fid || null; out.ext = n.ext || null; out.ref = null; }
    else {
      var q = ((bank && bank.questions) || []).filter(function (x) { return String(x.id) === String(n.refId); })[0];
      if (!q && n.xb) {
        var b2 = (typeof bankById === 'function') ? bankById(n.xb) : null;
        q = ((b2 && b2.questions) || []).filter(function (x) { return String(x.id) === String(n.refId); })[0];
      }
      if (!q) q = findQAny(n.refId, n.xb);
      if (q) out.xbk = n.xb || q._bank || bankOfQ(q) || null;
      out.ref = q || { id: n.refId, stem: n.label };
    }
    return out;
  }
  var NEED_SAVE = false;
  function saveCur() {
    var g = gCur(); if (!g) return;
    if (LOADING_G) { NEED_SAVE = true; return; }
    g.bank = S.bankId; g.qid = S.qid; g.layout = LAY.name;
    /* 路径组：开着路径模式、或图里已经有「路径展开」出来的节点（带 lv / path） */
    /* 路径组只由「💾 保存」决定（路径模式下点保存才置 1），别自己推断，
       否则临时开一下路径模式、长按几次就被算成路径组了 */
    g.path = g.path ? 1 : 0;
    /* 草稿节点不进存档：没确认的 AI 结果刷新就没了，别污染这一组 */
    var live = {};
    DATA.nodes.forEach(function (n) { if (!n.draft) live[n.id] = 1; });
    g.nodes = DATA.nodes.filter(function (n) { return !n.draft; }).map(serNode);
    g.edges = DATA.edges.filter(function (e) { return live[e.a] && live[e.b]; })
      .map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; });
    g.path = g.path ? 1 : 0;
    dedupeGroups(g);
    gSave();
  }
  /* 打开导图前先把历史遗留的重复组收一次：同一道题 + 同一类（路径/普通）只留节点最多的那一组，
     其余组的节点/连线并过去 */
  function dedupeAll() {
    var byKey = Object.create(null), keepList = [], changed = 0;
    /* 节点多的优先当「主组」，再按顺序 */
    var arr = G.list.slice().sort(function (a, b) {
      return ((b && b.nodes ? b.nodes.length : 0) - (a && a.nodes ? a.nodes.length : 0));
    });
    arr.forEach(function (g) {
      if (!g || g.qid == null) { keepList.push(g); return; }
      var k = String(g.bank) + '#' + String(g.qid) + '#' + (g.path ? 1 : 0);
      var host = byKey[k];
      if (!host) { byKey[k] = g; keepList.push(g); return; }
      var have = Object.create(null);
      (host.nodes || []).forEach(function (n) { have[n.id] = 1; });
      (g.nodes || []).forEach(function (n) { if (!have[n.id]) { host.nodes.push(n); have[n.id] = 1; } });
      var he = Object.create(null);
      (host.edges || []).forEach(function (e) { he[e.a + '>' + e.b] = 1; });
      (g.edges || []).forEach(function (e) { var kk = e.a + '>' + e.b; if (!he[kk]) { host.edges.push(e); he[kk] = 1; } });
      changed++;
    });
    if (changed) {
      /* 保持原顺序 */
      var order = Object.create(null);
      keepList.forEach(function (g, i) { order[g.id] = i; });
      G.list = G.list.filter(function (g) { return order[g.id] != null; });
      gSave();
      try { toast('合并了 ' + changed + ' 个重复的组（同一道题的路径组/普通组各留一个）'); } catch (e0) {}
    }
    return changed;
  }

  /* 一道题最多两组：一个普通组 + 一个路径组。同类里出现第二组时，保留当前这组（刚存的那组），
     把旧的同名同题同类组丢掉——它们的节点都已经被并到当前这组了 */
  function dedupeGroups(keep) {
    if (!keep || keep.qid == null) return 0;
    var dropped = 0;
    var kind = keep.path ? 1 : 0;
    G.list = G.list.filter(function (x) {
      if (!x || x.id === keep.id) return true;
      if (x.bank !== keep.bank) return true;
      if (String(x.qid) !== String(keep.qid)) return true;
      if ((x.path ? 1 : 0) !== kind) return true;
      /* 旧的同类组：节点并过来（按 id 去重），然后丢掉 */
      var have = Object.create(null);
      (keep.nodes || []).forEach(function (n) { have[n.id] = 1; });
      (x.nodes || []).forEach(function (n) { if (!have[n.id]) { keep.nodes.push(n); have[n.id] = 1; } });
      var he = Object.create(null);
      (keep.edges || []).forEach(function (e) { he[e.a + '>' + e.b] = 1; });
      (x.edges || []).forEach(function (e) { var k = e.a + '>' + e.b; if (!he[k]) { keep.edges.push(e); he[k] = 1; } });
      dropped++;
      return false;
    });
    if (dropped) { try { toast('同一道题只剩一个' + (kind ? '路径组' : '普通组') + '（合并了 ' + dropped + ' 个旧的）'); } catch (e0) {} }
    return dropped;
  }
  /* ===== 路径模式：在已有关系网上就地延伸，中心题永远不动 ===== */
  var PATHM = { on: false, max: 10 };
  try { PATHM.on = readLS('qbank.map.path.v1', false) === true; } catch (eP) {}
  function pathSet(on) {
    PATHM.on = !!on;
    try { writeLS('qbank.map.path.v1', PATHM.on); } catch (e1) {}
    /* 关掉路径模式 = 结束路径：这一组转回普通组（节点都留着），否则下次保存又会算成路径组 */
    if (!PATHM.on && pathIsOn()) {
      try { paintPath(); } catch (eP0) {}
      try { pathToNormal(true); } catch (eP1) {}
      return;
    }
    paintPath();
    render(true);
    toast(PATHM.on ? '路径模式已开：点相似题就地延伸，中心不动（最多 ' + PATHM.max + ' 步）' : '路径模式已关');
  }
  /* 现在这组算不算「路径组」：开关开着，或者图里已经有路径展开出来的节点 */
  function pathIsOn() {
    if (PATHM.on) return true;
    return DATA.nodes.some(function (n) { return !!(n.path || (n.lv != null && n.lv > 0)); });
  }
  /* 结束路径 / 转成普通组：节点都留着，只是不再算路径组（会自动并到这道题已有的普通组） */
  function pathToNormal(noAsk) {
    if (!pathIsOn()) { try { toast('这组本来就是普通组'); } catch (e0) {} return false; }
    var go = function () {
      PATHM.on = false;
      try { writeLS('qbank.map.path.v1', false); } catch (e1) {}
      DATA.nodes.forEach(function (n) {
        if (n.path) { try { delete n.path; } catch (e2) {} }
        if (n.lv != null) { try { delete n.lv; } catch (e3) {} }
      });
      try { paintPath(); } catch (e4) {}
      try { saveCur(); } catch (e5) {}
      try { render(true); } catch (e6) {}
      try { renderGrp(); } catch (e7) {}
      try { toast('已转成普通组（路径展开的节点都留着）'); } catch (e8) {}
    };
    if (noAsk) { go(); return true; }
    try {
      mpAsk({
        title: '转成普通组？',
        text: '路径展开出来的节点都会留着，只是这组以后按普通组算；同一道题只有普通组/路径组各一个，转过去会自动并到已有的普通组。',
        ok: '转成普通组'
      }).then(function (ok) { if (ok) go(); });
    } catch (eA) { go(); }
    return true;
  }

  function paintPath() {
    var b = $('#mpPath'); if (!b) return;
    b.classList.toggle('on', PATHM.on);
    b.textContent = PATHM.on ? '🧭 路径中' : '🧭 路径';
    b.title = PATHM.on ? '路径模式已开：点相似题就地延伸（最多 ' + PATHM.max + ' 步），再点一下关闭' : '路径模式：点相似题就地延伸，中心不动（最多 ' + PATHM.max + ' 步）';
  }
  /* 拿一道题的「邻居」：题干相似度 + 考点重合，排除已经在本组里的题 */
  function pathNeighbors(q, bank, limit) {
    var pool = (bank.questions || []).filter(function (x) { return x && x.stem && String(x.id) !== String(q.id); });
    if (!pool.length) return [];
    var have = Object.create(null);
    DATA.nodes.forEach(function (m) { if (m.ref && m.ref.id) have[String(m.ref.id)] = 1; });
    var curG = grams(norm(qText(q))), curTags = tagList(q, bank.id);
    var df = Object.create(null), n = pool.length, vecs = [], i;
    for (i = 0; i < n; i++) {
      var v = grams(norm(qText(pool[i]))); vecs.push(v);
      for (var k in v) df[k] = (df[k] || 0) + 1;
    }
    var idf = Object.create(null);
    for (var kk in df) idf[kk] = Math.log(1 + n / df[kk]);
    var idf0 = Math.log(1 + n);
    function cos(a, b) {
      var dot = 0, na = 0, nb = 0, key, wa, wb;
      for (key in a) { wa = a[key] * (idf[key] == null ? idf0 : idf[key]); na += wa * wa; }
      for (key in b) { wb = b[key] * (idf[key] == null ? idf0 : idf[key]); nb += wb * wb; }
      for (key in a) { if (b[key]) dot += (a[key] * (idf[key] == null ? idf0 : idf[key])) * (b[key] * (idf[key] == null ? idf0 : idf[key])); }
      return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
    }
    function jac(a, b) {
      if (!a.length || !b.length) return 0;
      var s1 = a.map(norm), s2 = b.map(norm), inter = 0;
      s1.forEach(function (x) { if (s2.indexOf(x) >= 0) inter++; });
      return inter / (s1.length + s2.length - inter);
    }
    var out = [];
    for (i = 0; i < n; i++) {
      if (have[String(pool[i].id)]) continue;
      var sim = cos(curG, vecs[i]);
      var sc = sim + 0.35 * jac(curTags, tagList(pool[i], bank.id));
      if (sc > 0.04) out.push({ q: pool[i], sim: sim, score: sc });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, limit || 4);
  }
  /* 给一个新节点补「考点线」：命中已有考点就接过去，没有就新建一个考点节点 */
  /* ===== 一键理顺：合并重复连线 + 分层重排（中心 → 相似题一圈 → 考点外圈） ===== */
  function tidyGraph() {
    var nodesEl = $('#mpNodes');
    var pos = Object.create(null);
    DATA.nodes.forEach(function (n) { pos[n.id] = n; });
    /* 1) 合并重复连线：同一对节点只留权重最高的一条；指向不存在节点的线丢掉 */
    var keep = Object.create(null), merged = 0, dropped = 0, edges = [];
    DATA.edges.forEach(function (e) {
      if (!pos[e.a] || !pos[e.b]) { dropped++; return; }
      var k = (String(e.a) < String(e.b)) ? (e.a + '>' + e.b) : (e.b + '>' + e.a);
      if (keep[k] != null) {
        var pe = edges[keep[k]];
        if ((e.w == null ? 0.4 : e.w) > (pe.w == null ? 0.4 : pe.w)) edges[keep[k]] = e;
        merged++;
        return;
      }
      keep[k] = edges.length; edges.push(e);
    });
    DATA.edges = edges;

    /* 2) 分层重排：中心归零，相似题按当前角度排序后均匀铺在一圈，考点按连线方向推到外圈 */
    var c = DATA.nodes.filter(function (n) { return n.type === 'center'; })[0];
    if (c) { c.x = 0; c.y = 0; }
    var cx = c ? c.x : 0, cy = c ? c.y : 0;
    var ring = DATA.nodes.filter(function (n) { return n.type === 'sim' || n.type === 'variant'; });
    ring.sort(function (a, b) {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
    /* 按「度数 + 相似度」排一遍：连接多的题分散开摆，避免高亮线全挤在一侧 */
    var deg = {};
    DATA.edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    ring.sort(function (a, b) {
      var da = (deg[a.id] || 0) + (a.score || 0) / 40;
      var db = (deg[b.id] || 0) + (b.score || 0) / 40;
      if (db !== da) return db - da;
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
    var n = ring.length;
    /* 卡片实测尺寸（长题干会到 230~280px 宽），按圆周能放下的数量分圈，别再挤成一坨 */
    var boxSize = {};
    var maxW = 236, maxH = 107;
    try {
      nodesEl.querySelectorAll('.mp-node').forEach(function (el) {
        var w = el.offsetWidth || 0, h = el.offsetHeight || 0;
        if (w > 40) { boxSize[el.dataset.id] = { w: w, h: h }; if (w > maxW) maxW = w; if (h > maxH) maxH = h; }
      });
    } catch (eS) {}
    var R = 560;
    var cap1 = Math.max(6, Math.floor(2 * Math.PI * R / (maxW + 26)));
    if (n <= cap1) {
      ring.forEach(function (nd, i) {
        var a0 = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, n);
        nd.x = Math.round(cx + Math.cos(a0) * R);
        nd.y = Math.round(cy + Math.sin(a0) * R);
      });
    } else {
      var R2 = 980;
      var cap2 = Math.max(6, Math.floor(2 * Math.PI * R2 / (maxW + 26)));
      ring.forEach(function (nd, i) {
        if (i < cap1) {
          var a1 = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, cap1);
          nd.x = Math.round(cx + Math.cos(a1) * R);
          nd.y = Math.round(cy + Math.sin(a1) * R);
        } else {
          var k2 = i - cap1;
          var a2 = -Math.PI / 2 + Math.PI / Math.max(1, Math.min(cap2, n - cap1)) + k2 * 2 * Math.PI / Math.max(1, Math.min(cap2, n - cap1));
          nd.x = Math.round(cx + Math.cos(a2) * R2);
          nd.y = Math.round(cy + Math.sin(a2) * R2);
        }
      });
      R = R2;
    }

    var tags = DATA.nodes.filter(function (m) { return m.type === 'tag'; });
    var infos = tags.map(function (tn) {
      var sx = 0, sy = 0, cnt = 0;
      DATA.edges.forEach(function (e) {
        var oid = e.a === tn.id ? e.b : (e.b === tn.id ? e.a : null);
        if (!oid || !pos[oid]) return;
        var o = pos[oid];
        var dx = o.x - cx, dy = o.y - cy, len = Math.hypot(dx, dy) || 1;
        sx += dx / len; sy += dy / len; cnt++;
      });
      return { tn: tn, ang: cnt ? Math.atan2(sy, sx) : -Math.PI / 2, cnt: cnt };
    });
    /* 3) 松弛：卡片按近似尺寸互相推开，避免任何两张叠在一起（只推 X/Y，不动层级） */
    try {
      var boxes = DATA.nodes.filter(function (m) { return m.type === 'sim' || m.type === 'variant' || m.type === 'tag' || m.type === 'center'; });
      var sz = function (m) { var b = boxSize[m.id] || {}; return { w: (b.w || 200) / 2 + 12, h: (b.h || 90) / 2 + 12 }; };
      var relaxIt = function (rounds) {
        for (var it2 = 0; it2 < rounds; it2++) {
          for (var i2 = 0; i2 < boxes.length; i2++) {
            for (var j2 = i2 + 1; j2 < boxes.length; j2++) {
              var p1 = boxes[i2], p2 = boxes[j2];
              var s1 = sz(p1), s2 = sz(p2);
              var ox = (s1.w + s2.w) - Math.abs(p2.x - p1.x), oy = (s1.h + s2.h) - Math.abs(p2.y - p1.y);
              if (ox > 0 && oy > 0) {
                var sx2 = (p2.x >= p1.x) ? 1 : -1, sy2 = (p2.y >= p1.y) ? 1 : -1;
                if (ox < oy) { p1.x -= sx2 * ox / 2; p2.x += sx2 * ox / 2; }
                else { p1.y -= sy2 * oy / 2; p2.y += sy2 * oy / 2; }
              }
            }
          }
        }
      };
      relaxIt(50);
      /* 力导向微调：连线像弹簧拉近、节点互相排斥，让线更短、交叉更少 */
      var idx = {};
      boxes.forEach(function (b) { idx[b.id] = b; });
      var links = DATA.edges.filter(function (e) { return idx[e.a] && idx[e.b]; }).map(function (e) {
        return { a: idx[e.a], b: idx[e.b], w: (e.w == null ? 0.4 : e.w) };
      });
      for (var itF = 0; itF < 90; itF++) {
        for (var li = 0; li < links.length; li++) {
          var L = links[li], dxL = L.b.x - L.a.x, dyL = L.b.y - L.a.y;
          var dL = Math.hypot(dxL, dyL) || 1;
          var want = 260 - 90 * L.w;
          var f = (dL - want) * 0.012 * (0.4 + L.w);
          var uxL = dxL / dL, uyL = dyL / dL;
          L.a.x += uxL * f; L.a.y += uyL * f;
          L.b.x -= uxL * f; L.b.y -= uyL * f;
        }
        for (var i3 = 0; i3 < boxes.length; i3++) {
          for (var j3 = i3 + 1; j3 < boxes.length; j3++) {
            var q1 = boxes[i3], q2 = boxes[j3];
            var dxR = q2.x - q1.x, dyR = q2.y - q1.y;
            var dR = Math.hypot(dxR, dyR) || 1;
            if (dR > 620) continue;
            var rep = 26000 / (dR * dR);
            var uxR = dxR / dR, uyR = dyR / dR;
            q1.x -= uxR * rep; q1.y -= uyR * rep;
            q2.x += uxR * rep; q2.y += uyR * rep;
          }
        }
      }
      /* 力导向会把卡片拉近，最后再推一遍，保证没有重叠 */
      relaxIt(70);
      boxes.forEach(function (b) { b.x = Math.round(b.x); b.y = Math.round(b.y); });
    } catch (eR) {}

    infos.sort(function (a, b) { return a.ang - b.ang; });
    /* 同角度的考点往两边错开，别叠在一起 */
    infos.forEach(function (it, i) {
      var off = (i - (infos.length - 1) / 2) * 0.30;
      var R2 = R + 300;
      it.tn.x = Math.round(cx + Math.cos(it.ang + off) * R2);
      it.tn.y = Math.round(cy + Math.sin(it.ang + off) * R2);
    });

    render();
    saveCur();
    toast('已理顺：合并 ' + merged + ' 条重复线' + (dropped ? '、清掉 ' + dropped + ' 条悬空线' : '') + '，按 中心→相似题→考点 重排');
    return true;
  }

  /* 把一个考点节点跟图上「所有带这个考点的题」连起来（含已经在图上的老题） */
  function linkTagAll(tn, bank) {
    if (!tn || tn.type !== 'tag') return 0;
    var nm = norm(tn.label), added = 0;
    DATA.nodes.forEach(function (m) {
      if (!(m.type === 'sim' || m.type === 'center' || m.type === 'variant')) return;
      if (!m.ref || !m.ref.stem) return;
      var has = tagList(m.ref, bank.id).map(norm).indexOf(nm) >= 0;
      if (!has) return;
      var dup = DATA.edges.some(function (e) { return (e.a === m.id && e.b === tn.id) || (e.a === tn.id && e.b === m.id); });
      if (dup) return;
      DATA.edges.push({ a: m.id, b: tn.id, kind: 'tag', w: 0.42 });
      added++;
    });
    return added;
  }
  function pathTagLink(node, bank, list, noCreate) {
    var tags = tagList(node.ref, bank.id).filter(function (x) { return !isBigTag(x); }).slice(0, 3);
    tags.forEach(function (t, ti) {
      var nrm = norm(t);
      var tn = DATA.nodes.filter(function (m) { return m.type === 'tag' && norm(m.label) === nrm; })[0];
      if (!tn && noCreate) return;
      if (!tn) {
        tn = { id: 'pt' + Date.now().toString(36) + ti + Math.floor(Math.random() * 999), type: 'tag', ref: t, label: t,
          x: node.x + 150, y: node.y + (ti * 90) - 45, lv: (node.lv || 0) };
        DATA.nodes.push(tn);
        list.push(tn);
      }
      var dup = DATA.edges.some(function (e) { return (e.a === node.id && e.b === tn.id) || (e.a === tn.id && e.b === node.id); });
      if (!dup) DATA.edges.push({ a: node.id, b: tn.id, kind: 'tag', w: 0.42 });
    });
  }
  function pathExpand(n) {
    if (!n) return false;
    var bank = null; try { bank = bankById(S.bankId); } catch (e0) {}
    if (!bank) { toast('当前没有打开的题库'); return true; }
    var lv = (n.lv || 0) + 1;
    if (PATHM.on && lv > PATHM.max) { toast('路径最多延伸 ' + PATHM.max + ' 步，先换个起点吧'); return true; }
    var picks, fromTag = false;
    if (n.type === 'tag') {
      fromTag = true;
      var nm = norm(n.label);
      var haveT = Object.create(null);
      DATA.nodes.forEach(function (m) { if (m.ref && m.ref.id) haveT[String(m.ref.id)] = 1; });
      picks = (bank.questions || []).filter(function (x) {
        return x && x.stem && !haveT[String(x.id)] && tagList(x, bank.id).map(norm).indexOf(nm) >= 0;
      }).slice(0, 4).map(function (x) { return { q: x, sim: 0, score: 0.3 }; });
    } else {
      if (!n.ref || !n.ref.stem) { toast('这一张不是题目节点'); return true; }
      picks = pathNeighbors(n.ref, bank, 4);
    }
    if (!picks.length) { toast('这条路上没有更多新题了'); return true; }
    var mx = picks[0].score || 1;
    /* 朝「远离已有中心」的方向排开，别再压到中心题上 */
    var cn = DATA.nodes.filter(function (m) { return m.type === 'center'; })[0] || { x: 0, y: 0 };
    var base = Math.atan2(n.y - cn.y, n.x - cn.x);
    if (!isFinite(base) || (Math.abs(n.x - cn.x) < 1 && Math.abs(n.y - cn.y) < 1)) base = -Math.PI / 2;
    var R = 285, added = [];
    picks.forEach(function (it, i) {
      var ang = base + (i - (picks.length - 1) / 2) * 0.52;
      var id = 'pn' + Date.now().toString(36) + i + Math.floor(Math.random() * 999);
      var nd = {
        id: id, type: 'sim', ref: it.q, label: it.q.stem, lv: lv, path: true,
        score: Math.round(38 + (mx ? (it.score / mx) : 0.5) * 56),
        x: n.x + Math.cos(ang) * R, y: n.y + Math.sin(ang) * R
      };
      DATA.nodes.push(nd); added.push(nd);
      DATA.edges.push({ a: n.id, b: id, kind: 'sim', w: mx ? (it.score / mx) : 0.5 });
      pathTagLink(nd, bank, added, true);
    });
    if (fromTag) added.forEach(function (nd2) { pathTagLink(nd2, bank, added, true); });
    saveCur();
    /* 分层模式下新展开出来的题也要按「同心环的第 k 层」摆，不能散在原节点旁边 */
    if (LAY.name === 'layer') { try { applyLayout('layer'); } catch (eL1) { render(true); } }
    else render(true);
    toast((PATHM.on ? '路径延伸第 ' + lv + ' 步：' : '展开：') + '+' + picks.length + ' 题（中心题没动）');
    /* 被点对象自己的考点：还没在图上时问一句要不要挂出来 */
    try {
      var ownTags = (n.type === 'sim' && n.ref && n.ref.stem) ? tagList(n.ref, bank.id).filter(function (x) { return !isBigTag(x); }) : (n.type === 'tag' ? [n.label] : []);
      /* 已经在图上的考点：把它跟图上所有同类题连一遍（老题、新题都连） */
      ownTags.forEach(function (t) {
        var ex = DATA.nodes.filter(function (m) { return m.type === 'tag' && norm(m.label) === norm(t); })[0];
        if (ex) { if (linkTagAll(ex, bank) > 0) { saveCur(); render(true); } }
      });
      var missing = ownTags.filter(function (t) {
        return !DATA.nodes.some(function (m) { return m.type === 'tag' && norm(m.label) === norm(t); });
      });
      if (missing.length) {
        var showTag = function (t) {
          var tNode = DATA.nodes.filter(function (m) { return m.type === 'tag' && norm(m.label) === norm(t); })[0];
          if (!tNode) {
            /* 摆到「离整张图质心最远的一侧」，别再压到已有卡片上 */
            var sx = 0, sy = 0;
            DATA.nodes.forEach(function (m) { sx += m.x; sy += m.y; });
            sx = sx / Math.max(1, DATA.nodes.length); sy = sy / Math.max(1, DATA.nodes.length);
            var ang0 = Math.atan2(n.y - sy, n.x - sx);
            if (!isFinite(ang0) || (Math.abs(n.y - sy) < 1 && Math.abs(n.x - sx) < 1)) ang0 = -Math.PI / 2;
            /* 在 12 个方向 × 3 个半径里挑「离所有卡片最远」的位置，避免压住别的题 */
            var best = null;
            [300, 380, 460].forEach(function (rr) {
              for (var ai = 0; ai < 12; ai++) {
                var a2 = ang0 + (ai - 6) * 0.52;
                var px2 = n.x + Math.cos(a2) * rr, py2 = n.y + Math.sin(a2) * rr;
                var mn = 1e9;
                DATA.nodes.forEach(function (m) {
                  if (m === n) return;
                  mn = Math.min(mn, Math.hypot(m.x - px2, m.y - py2));
                });
                var score2 = mn - Math.abs(ai - 6) * 6 - (rr - 300) * 0.12;
                if (!best || score2 > best.s) best = { x: px2, y: py2, s: score2 };
              }
            });
            tNode = { id: 'pt' + Date.now().toString(36) + Math.floor(Math.random() * 999), type: 'tag', ref: t, label: t,
              x: (best ? best.x : n.x + 300), y: (best ? best.y : n.y - 300), lv: lv };
            DATA.nodes.push(tNode);
          }
          linkTagAll(tNode, bank);
          saveCur(); render();
        };
        if (missing.length === 1) {
          mpAsk({ title: '要把这个考点也挂出来吗？', text: '「' + missing[0] + '」还没在图上。挂出来后，图上其他带这个考点的题也会连到它。', ok: '显示考点', no: '先不用' })
            .then(function (ok) { if (ok) showTag(missing[0]); });
        } else {
          showTag(missing[0]);
          toast('已把这个考点挂出来：' + missing[0]);
        }
      }
    } catch (eT) {}
    return true;
  }

  /* 老存档里只有「中心题 → 考点」这一根线；补上「同一考点的相似题 → 考点」 */
  /* AI 变式题（variant.js → qbank.var.v1，按 bankId#qid 存）在图上表现为「变式题」节点 */
  /* variant.js 的键是「bankId#qid」，不是裸 qid —— 传错会永远读不到变式题 */
  function varListOf(qid, bid) {
    /* 键是「这道题所属题库的 id」+ # + qid：他库相似题的变式挂在它自己的库下，用当前库 id 会读空 */
    var b = String(bid || S.bankId), k = b + '#' + qid, out = [];
    try { if (typeof window.varqList === 'function') out = window.varqList(k) || []; } catch (e0) {}
    if (out.length) return out;
    /* 兜底：题库 id 对不上（改过名 / 合集 / 云同步换了 id）时，按「#qid」后缀把所有同题号的变式收进来 */
    try {
      var m = readLS('qbank.var.v1', {}) || {};
      Object.keys(m).forEach(function (kk) {
        if (kk === k) return;
        if (kk.slice(-(String(qid).length + 1)) === '#' + qid) out = out.concat(m[kk] || []);
      });
    } catch (e1) {}
    return out;
  }
  /* variant.js 存的是 {t, o, a, e}（题干 / 选项 / 答案 / 解析），不是 {stem, options…}，两种都认 */
  function varRefOf(v, vid, bid) {
    v = v || {};
    return {
      id: vid,
      stem: String(v.t || v.stem || ''),
      options: v.o || v.options || [],
      answer: v.a || v.answer || [],
      explain: v.e || v.explain || v.exp || '',
      tags: v.tags || v.tag || [],
      _bank: bid
    };
  }
  function qidOfNode(n) {
    if (!n || !n.ref) return '';
    if (n.ref.id != null) return String(n.ref.id);
    if (n.ref.qid != null) return String(n.ref.qid);
    return '';
  }
  /* 把每道题下面的 AI 变式题同步成画布上的变式节点（增删都管） */
  function syncVariants(noRender) {
    var changed = false;
    var parents = DATA.nodes.filter(function (n) { return n.type === 'sim' || n.type === 'center'; });
    var want = {};
    parents.forEach(function (n) {
      var qid = qidOfNode(n);
      if (!qid) return;
      var bid = n.xbk || S.bankId;
      var list = varListOf(qid, bid);
      list.forEach(function (v, i) {
        var vid = 'v:' + qid + ':' + i;
        want[vid] = 1;
        var exist = DATA.nodes.filter(function (x) { return x.id === vid; })[0];
        if (exist) {
          exist.type = 'variant'; exist.variantAi = true; exist.srcQid = qid;
          exist.srcBank = bid;
          exist.label = String(v.t || v.stem || exist.label || '变式题');
          exist.ref = varRefOf(v, vid, bid);
          return;
        }
        DATA.nodes.push({
          id: vid, type: 'variant', lv: (n.lv || 0), variantAi: true, srcQid: qid, srcBank: bid,
          ref: varRefOf(v, vid, bid),
          label: String(v.t || v.stem || '变式题'),
          score: null,
          /* 先给个有限坐标：布局还没来得及摆它时，别让 fit() 算出 NaN */
          x: (typeof n.x === 'number' ? n.x : 0) + 260,
          y: (typeof n.y === 'number' ? n.y : 0) + 70
        });
        DATA.edges.push({ a: n.id, b: vid, kind: 'variant', w: 0.5 });
        changed = true;
      });
    });
    var drop = DATA.nodes.filter(function (n) { return n.type === 'variant' && n.variantAi && !want[n.id]; });
    if (drop.length) {
      var ids = {}; drop.forEach(function (n) { ids[n.id] = 1; });
      DATA.nodes = DATA.nodes.filter(function (n) { return !ids[n.id]; });
      DATA.edges = DATA.edges.filter(function (e) { return !(ids[e.a] || ids[e.b]); });
      changed = true;
    }
    /* 图上有变式题、但「变式」这个过滤勾选还关着 → 打开，别让人以为没同步 */
    if (changed && !FIL.var) {
      FIL.var = 1;
      try { writeLS('qbank.mapfil.v1', FIL); } catch (eF) {}
      try { applyFil(); } catch (eF2) {}
    }
    if (changed && !noRender) { try { saveCur(); } catch (e1) {} }
    return changed;
  }

  /* 在别的页面（答题页的「AI 变式题」）新生成的变式，回到脑图时要能自动冒出来：
     窗口重新获得焦点 / 从后台回来时对一次，3 秒内不重复跑 */
  var VAR_SYNC_T = 0;
  function varSyncLazy() {
    if (!S.on) return;
    if (Date.now() - VAR_SYNC_T < 3000) return;
    VAR_SYNC_T = Date.now();
    setTimeout(function () {
      try {
        if (syncVariants(true)) {
          try { applyLayout(LAY.name); } catch (e0) { render(true); }
          try { saveCur(); } catch (e1) {}
        }
      } catch (e2) {}
    }, 120);
  }
  try { window.addEventListener('focus', varSyncLazy); } catch (eV0) {}
  try {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) varSyncLazy();
    });
  } catch (eV1) {}

  /* 老存档里可能只有题、没有考点节点：按题目现在的小标签把考点补齐（不重复建） */
  /* 一道题该有哪些考点：先按「题库#题号」读；读不到（老存档只存了题干、跨库、题库改名）就按题干去所有题库里找同一道题 */
  function nodeTags(n) {
    var ts = [];
    try { ts = kpTags(n.ref); } catch (e0) { ts = []; }
    if (ts.length) return ts;
    var stem = String((n.ref && n.ref.stem) || n.label || '').trim();
    if (stem.length < 6) return ts;
    var banks = [];
    try { banks = (typeof allBanks === 'function') ? allBanks() : []; } catch (e1) { banks = []; }
    for (var i = 0; i < banks.length; i++) {
      var qs = (banks[i] && banks[i].questions) || [];
      for (var j = 0; j < qs.length; j++) {
        var q = qs[j];
        if (!q || !q.stem) continue;
        if (String(q.stem).trim() !== stem) continue;
        try { ts = kpTags(q); } catch (e2) { ts = []; }
        if (ts.length) { try { n.xbk = n.xbk || banks[i].id; } catch (e3) {} return ts; }
      }
    }
    return ts;
  }

  function ensureTagNodes(bank) {
    var added = 0;
    var qs = DATA.nodes.filter(function (n) { return n.type === 'sim' || n.type === 'center' || n.type === 'variant'; });
    qs.forEach(function (n) {
      if (!n.ref || n.type === 'variant') return;
      var tags = [];
      try { tags = nodeTags(n).slice(0, 4); } catch (e0) { return; }
      tags.forEach(function (t) {
        var nrm = norm(t);
        var tn = DATA.nodes.filter(function (m) { return m.type === 'tag' && norm(m.label) === nrm; })[0];
        if (!tn) {
          tn = { id: 't_' + nrm.slice(0, 12) + '_' + Math.floor(Math.random() * 999), type: 'tag', ref: t, label: t, x: n.x + 180, y: n.y + 80 };
          DATA.nodes.push(tn);
          added++;
        }
        var dup = DATA.edges.some(function (e) {
          return (e.a === n.id && e.b === tn.id) || (e.a === tn.id && e.b === n.id);
        });
        if (!dup) { DATA.edges.push({ a: n.id, b: tn.id, kind: 'tag', w: 0.42 }); added++; }
      });
    });
    return added;
  }

  function relinkTags(bank) {
    if (!bank || !DATA || !DATA.nodes || !DATA.nodes.length) return;
    var tags = DATA.nodes.filter(function (n) { return n.type === 'tag' && n.label; });
    if (!tags.length) return;
    var has = Object.create(null);
    DATA.edges.forEach(function (e) { has[e.a + '>' + e.b] = 1; });
    DATA.nodes.forEach(function (n) {
      if (n.type !== 'sim' && n.type !== 'center') return;
      var q = n.ref && n.ref.stem ? n.ref : null;
      if (!q) return;
      var st = tagList(q, bank.id).map(norm);
      if (!st.length) return;
      tags.forEach(function (tn) {
        if (st.indexOf(norm(tn.label)) < 0) return;
        var key = n.id + '>' + tn.id;
        if (has[key]) return;
        has[key] = 1;
        DATA.edges.push({ a: n.id, b: tn.id, kind: 'tag', w: 0.42 });
      });
    });
  }
  var LOADING_G = false;
  function loadGroup(g) {
    LOADING_G = true;
    setTimeout(function () { LOADING_G = false; if (NEED_SAVE) { NEED_SAVE = false; try { saveCur(); } catch (eNS) {} } }, 0);
    var bank = null; try { bank = bankById(g.bank); } catch (e) {}
    DATA = {
      nodes: (g.nodes || []).map(function (n) { return deNode(n, bank); }),
      edges: (g.edges || []).map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; })
    };
    LAY.name = layName(g.layout || 'tree');
    S.bankId = g.bank; S.qid = g.qid; sel = null;
    /* 这三件事都是「补数据」，不需要卡在打开画布之前做：
       先让画布出来，空闲时再补齐考点/变式，用户看到的就不再是转圈。 */
    try {
      var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 60); };
      idle(function () {
        try { relinkTags(bank); } catch (e0) {}
        try { if (ensureTagNodes(bank)) { try { saveCur(); } catch (eT) {} } } catch (eT2) {}
        try { if (syncVariants(true)) { try { saveCur(); } catch (e0b) {} } } catch (e0c) {}
        try { render(true); } catch (eR0) {}
      });
    } catch (eI0) {}
    var s = $('#mpLayout'); if (s) s.value = LAY.name;
    /* 打开的是路径组：自动把路径模式打开，接着往下一层延伸就行 */
    try {
      if (g.path) { PATHM.on = true; writeLS('qbank.map.path.v1', true); }
      else { PATHM.on = false; try { writeLS('qbank.map.path.v1', false); } catch (ePG) {} }
      paintPath();
    } catch (eP0) {}
    render(); setTimeout(fit, 50);
    try { paintGrpBtn(); } catch (e) {}
  }
  function gSwitch(id) {
    var same = (id === G.active);
    if (!same) { saveCur(); G.active = id; gSave(); }
    var g = gCur();
    try { if (g) loadGroup(g); } catch (e0) {}
    renderGrp();
    /* 切换必须给个回声：之前什么都不提示，看起来就像「点了没反应」 */
    if (g) toast('已切到「' + String(g.name || '').slice(0, 14) + '」· ' + DATA.nodes.length + ' 个节点');
    else toast('这一组读不出来（题库可能被删了）');
  }
  function gAddFrom(name, nodes, edges, bank, qid, layout) {
    saveCur();
    var g = { id: gNewId(), name: name, star: false, bank: bank, qid: qid, layout: layout || 'grid', nodes: nodes, edges: edges };
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
    mpAsk({ title: '删掉这一组？', text: '「' + String(g.name || '未命名组') + '」· 只删这一组，不影响题库和标签。', ok: '删除', danger: true })
      .then(function (ok) { if (ok) doDel(); });
    function doDel() {
      G.list = G.list.filter(function (x) { return x.id !== id; });
      if (G.active === id) {
        G.active = (G.list[0] && G.list[0].id) || null;
        var n = gCur(); if (n) loadGroup(n); else { DATA = { nodes: [], edges: [] }; render(); }
      }
      gSave(); renderGrp();
    }
  }
  /* 站里那种自定义确认框（不再用浏览器原生 confirm，样式跟面板一致） */
  function mpAsk(o) {
    return new Promise(function (resolve) {
      var d = document.createElement('div');
      d.className = 'mp-ask';
      d.innerHTML = '<div class="mp-askc" role="dialog">' +
        '<b>' + esc(o.title || '确认') + '</b>' +
        (o.text ? '<p>' + esc(o.text) + '</p>' : '') +
        (o.list && o.list.length ? '<ul>' + o.list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="mp-askb"><button type="button" data-no>取消</button>' +
        '<button type="button" data-yes class="' + (o.danger ? 'bad' : 'prim') + '">' + esc(o.ok || '确定') + '</button></div></div>';
      document.body.appendChild(d);
      function done(v) {
        try { d.remove(); } catch (e) { if (d.parentNode) d.parentNode.removeChild(d); }
        document.removeEventListener('keydown', key, true);
        resolve(v);
      }
      function key(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      }
      document.addEventListener('keydown', key, true);
      d.addEventListener('click', function (e) {
        if (e.target.closest('[data-yes]')) return done(true);
        if (e.target.closest('[data-no]') || e.target === d) return done(false);
      });
      try { d.querySelector('[data-yes]').focus(); } catch (e) {}
    });
  }

  function gStar(id) {    var g = G.list.filter(function (x) { return x.id === id; })[0]; if (!g) return;
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
  /* 照侧栏「导出」：把选中的组导成 JSON 文件，换台机器也能再导回来 */
  function gExpMany(ids) {
    var out = (ids || []).map(function (id) { var g = G.list.filter(function (x) { return x.id === id; })[0]; return g; }).filter(Boolean);
    if (!out.length) { toast('先勾几组'); return; }
    var pack = { kind: 'shuati.mapgroups', v: 1, at: new Date().toISOString(), groups: out };
    try {
      var blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '知识组-' + out.length + '组-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1500);
      toast('已导出 ' + out.length + ' 组');
    } catch (e) { toast('导出失败：' + (e && e.message)); }
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
    mpAsk({
      title: '删掉这 ' + names.length + ' 组？',
      text: '只删组，不影响题库和标签。',
      list: names.slice(0, 8).concat(names.length > 8 ? ['…还有 ' + (names.length - 8) + ' 组'] : []),
      ok: '删除', danger: true
    }).then(function (ok) { if (ok) doDel(); });
    return names.length;
    function doDel() {
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
    }
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
    /* 照侧边栏题库管理器的「并集 / 交集」：空格分词，交集＝每个词都得命中 */
    var parts = String(q).split(/\s+/).filter(Boolean);
    var and = (($('#mpGLogic') || {}).value) === 'and';
    var one = function (q1) { return gMatchOne(g, norm(q1)); };
    return and ? parts.every(one) : parts.some(one);
  }
  function gMatchOne(g, q) {
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
    var qraw = String(($('#mpGQ') || {}).value || '').trim();
    var kind = (($('#mpGKind') || {}).value) || 'all';
    var hitList = list.filter(function (g) {
      if (kind === 'path' && !g.path) return false;
      /* 普通组：同一题库里的所有普通组都能搜到（不是只当前这道题） */
      if (kind === 'tree' && (g.path || (S.bankId && g.bank && String(g.bank) !== String(S.bankId)))) return false;
      return gMatch(g, qraw || q);
    });
    var rows = hitList.map(function (g) {
      var on = g.id === G.active ? ' on' : '';
      var ck = GSELMODE ? '<i class="mp-gck' + (GSEL[g.id] ? ' on' : '') + '" data-ck="' + g.id + '"></i>' : '';
      return '<div class="mp-grow2' + on + (GSELMODE ? ' selmode' : '') + '" data-g="' + g.id + '">' + ck +
        '<i class="gst' + (g.star ? ' on' : '') + '" data-star="' + g.id + '">' + (g.star ? '★' : '☆') + '</i>' +
        '<div class="gmain"><b>' + esc(g.name || '未命名组') + '</b>' +
          (g.path ? '<i class="gpath" title="路径组：沿着相似题一层层展开">🧭</i>' : '') +
          '<span class="muted2">' + gCount(g) + '</span></div>' +
        '<button class="gmore" data-more="' + g.id + '" title="更多">⋯</button></div>';
    }).join('');
    /* 重画列表时把滚动位置留住：滚到下面点一条，重画后跳回顶部，
       高亮那条会「跑到上面去」，看起来就像点错了行。 */
    var __sc0 = 0; try { __sc0 = $('#mpGList').scrollTop || 0; } catch (eSc) {}
    $('#mpGList').innerHTML = rows || (q || kind !== 'all' ? '<div class="mp-agrow" style="color:#8a86a0">没有匹配的组<button type="button" class="mp-kbtn" id="mpGClear" style="margin-left:8px">清空筛选</button></div>'
      : '<div class="mp-agrow" style="color:#8a86a0">还没有组，点「＋」用当前题建一组</div>');
    (function () {
      var b = document.getElementById('mpGClear'); if (!b) return;
      b.onclick = function (ev) {
        if (ev) ev.stopPropagation();
        var qq = $('#mpGQ'); if (qq) qq.value = '';
        var kk = $('#mpGKind'); if (kk) { kk.value = 'all'; try { writeLS('qbank.mapgkind.v1', 'all'); } catch (e1) {} }
        renderGrp();
      };
    })();
    try { if (__sc0) $('#mpGList').scrollTop = __sc0; } catch (eSc2) {}
    var __sig = hitList.map(function (g) { return g.id; }).join('|') + '#' + (GSELMODE ? 1 : 0) + '#' + hitList.length;
    var __anim = (window.__grpSig !== __sig);
    window.__grpSig = __sig;
    var nPath = G.list.filter(function (g) { return g.path; }).length;
    $('#mpGFoot').innerHTML = '<span>共 ' + G.list.length + ' 组（🧭 ' + nPath + ' 路径 / ' + (G.list.length - nPath) + ' 普通）· ' +
      G.list.reduce(function (a, g) { return a + (g.nodes || []).length; }, 0) + ' 节点' +
      (q ? '（筛出 ' + hitList.length + ' 组）' : '') + '</span>' +
      '<button type="button" id="mpGAll" title="清空搜索、退出多选，从头看">管理全部 ›</button>' +
      '<span>' + (GSELMODE ? '点行勾选 · 再点 ☑ 退出' : '点行切换 · ☆标星') + '</span>';
    try {
      window.__grpSeen = window.__grpSeen || {};
      var __seen = window.__grpSeen, __ix = 0;
      $('#mpGList').querySelectorAll('.mp-grow2').forEach(function (r) {
        var gid = r.getAttribute('data-g');
        if (!gid || __seen[gid]) return;
        __seen[gid] = 1;
        r.style.setProperty('--ad', Math.min(300, __ix * 35) + 'ms'); __ix++;
        r.classList.add('gin');
        r.addEventListener('animationend', function () { r.classList.remove('gin'); }, { once: true });
      });
    } catch (e0) {}
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
      '<button data-a="redo">↺ 一键重做（回到最初）</button>' +
      '<button data-a="star">' + starTxt + '</button>' +
      '<button data-a="del" class="bad">🗑 删除这一组</button>';
    m.dataset.id = id;
    m.style.left = Math.max(8, Math.min(innerWidth - 150, x)) + 'px';
    m.style.top = Math.max(8, Math.min(innerHeight - 170, y)) + 'px';
    m.classList.add('show');
  }
  /* 一键重做：回到这张图刚生成时的样子（丢掉路径展开 / 手动加进来的节点） */
  function gRedo(id) {
    var g0 = (G.list || []).filter(function (g) { return g.id === id; })[0];
    if (!g0) return;
    if (typeof mpAsk === 'function') {
      mpAsk({ title: '一键重做这一组？', text: '会回到「以「' + String(g0.name || '').slice(0, 16) + '」为中心」刚生成的样子：路径展开的、手动加进来的节点都会清掉（题目本身不受影响）。', ok: '重做', no: '算了' })
        .then(function (ok) { if (ok) gRedoDo(g0); });
      return;
    }
    gRedoDo(g0);
  }
  function gRedoDo(g0) {
    try {
      saveCur();
      G.active = g0.id;
      var bid = g0.bank || S.bankId, qid = g0.qid || '';
      if (qid) openFor(bid, qid);
      else { loadGroup(g0); }
      try { saveCur(); } catch (e1) {}
      renderGrp();
      if (typeof toast === 'function') toast('已重做：回到最初的中心题', 1800, 'good');
    } catch (e2) {
      if (typeof toast === 'function') toast('重做失败：这一组的中心题可能不在了', 2200, 'warn');
    }
  }
  function gMenuHide() { var m = $('#mpGMenu'); if (m) m.classList.remove('show'); }

  function gBind() {
    var p = $('#mpGroups'); if (p) p.onclick = function () {
      var g = $('#mpGrp'); var on = g.classList.toggle('show');
      p.classList.toggle('on', on);
      window.__grpSeen = {};
      if (on) { try { winFocus('#mpGrp'); } catch (e0) {}; try { paintGrpBtn(); } catch (e0) {}; renderGrp(); var i = $('#mpGQ'); if (i) { i.value = ''; setTimeout(function () { i.focus(); }, 30); } }
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
        var qq = String(($('#mpGQ') || {}).value || '').trim();
        G.list.forEach(function (g) { if (gMatch(g, qq)) GSEL[g.id] = 1; });
        renderGrp(); return;
      }
      var ids = gSelIds(); if (!ids.length) return;
      if (k === 'dup') gDupMany(ids);
      else if (k === 'exp') gExpMany(ids);
      else if (k === 'del') gDelMany(ids);
    };
    var nb = $('#mpGNew'); if (nb) nb.onclick = function () { gNewFromCur(); };
    var ai = $('#mpGAi'); if (ai) ai.onclick = function () { agOpen(); };
    var glog = $('#mpGLogic'); if (glog) glog.onchange = function () { renderGrp(); };
    var gk = $('#mpGKind');
    if (gk) {
      try { var kv = readLS('qbank.mapgkind.v1', 'all'); if (kv) gk.value = kv; } catch (eK) {}
      gk.onchange = function () { try { writeLS('qbank.mapgkind.v1', gk.value); } catch (eK2) {} renderGrp(); };
    }
    var list = $('#mpGList');
    if (list) list.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('[data-g]'); if (!row) return;
      e.preventDefault(); e.stopPropagation();
      gMenu(row.getAttribute('data-g'), Math.min(e.clientX, innerWidth - 190), Math.min(e.clientY, innerHeight - 200));
    });
    if (list) list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      var rows = [].slice.call(list.querySelectorAll('[data-g]')); if (!rows.length) return;
      var cur = rows.findIndex(function (r) { return r.classList.contains('on'); });
      if (e.key === 'Enter') { if (cur >= 0) { e.preventDefault(); gOpen(rows[cur].getAttribute('data-g')); } return; }
      e.preventDefault();
      var nx = cur + (e.key === 'ArrowDown' ? 1 : -1);
      if (nx < 0) nx = rows.length - 1;
      if (nx >= rows.length) nx = 0;
      rows.forEach(function (r, i) { r.classList.toggle('on', i === nx); });
      rows[nx].scrollIntoView({ block: 'nearest' });
      if (GSELMODE) return;  /* 多选时上下键只挪高亮，别切组 */
      rows[nx].click();      /* 走和鼠标点行完全相同的那条路 */
    });
    var dgGuard = 0;   /* 刚拖动排序过：这一次 click 是「拖完松手」带的，不能当成点行 */
    if (list) list.onclick = function (e) {
      if (Date.now() < dgGuard) { dgGuard = 0; return; }
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
        if (!dg.on && Math.abs(e.clientY - dg.y) < 9) return;
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
        /* 重排后 DOM 换了一批节点，松手时浏览器补发的 click 会落到「换到这儿的那一行」上，
           看起来就像「点下面切到上面」。给这次 click 打个短暂屏蔽。 */
        dgGuard = Date.now() + 350;
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
      else if (a === 'redo') gRedo(id);
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
    var key = (q && q._bank ? q._bank : S.bankId) + '#' + (q && q.id);
    try { if (typeof window.tagsOf === 'function') { var a = window.tagsOf(key); if (a && a.length) return a.slice(); } } catch (e0) {}
    try { if (window.TAGS && TAGS.of) { var b = TAGS.of(key); if (b && b.length) return b.slice(); } } catch (e1) {}
    try {
      if (window.TAGS && TAGS.data) { var d = TAGS.data() || {}, v = d[key]; if (v && v.length) return v; }
    } catch (e2) {}
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
      var g = { id: gNewId(), name: c.name, star: false, bank: S.bankId, qid: c.qs[0].id, layout: 'grid',
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
  /* 某个考点下有哪些题：**跨题库**找（以前只看当前题库 + TAGS.data() 的 S.bankId 键，
     他库/内置库的题就全漏了，表现成「输血 11 题，导图里 0 道》） */
  function kpQsOf(name) {
    var nm = norm(name), out = [], seen = Object.create(null);
    var banks = [];
    try { banks = (typeof allBanks === 'function') ? allBanks() : []; } catch (e0) { banks = []; }
    if (!banks.length) { try { var cb = bankById(S.bankId); if (cb) banks = [cb]; } catch (e1) {} }
    banks.forEach(function (b) {
      if (!b || !b.questions) return;
      b.questions.forEach(function (q) {
        if (!q || !q.stem) return;
        /* qTags 靠 q._bank 决定标签键，先把归属补上再读 */
        if (!q._bank) { try { q._bank = b.id; q._bname = b.title || b.name || ''; } catch (e2) {} }
        var ts = [];
        try { ts = qTags(q); } catch (e3) { ts = []; }
        if (!ts.length) return;
        var hit = false;
        for (var i = 0; i < ts.length; i++) { if (norm(ts[i]) === nm) { hit = true; break; } }
        if (!hit) return;
        var key = (q._bank || b.id) + '#' + q.id;
        if (seen[key]) return;
        seen[key] = 1;
        out.push(q);
      });
    });
    return out;
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
        '<div class="mp-kph"><button type="button" class="mp-kico" id="mpKpBack" title="返回上一个焦点">‹</button><b id="mpKpName">考点</b><span id="mpKpCnt" class="mp-kcnt"></span>' +
        '<span style="flex:1"></span>' +
        '<button type="button" class="mp-kico" id="mpKpAi" title="AI 一键分析考点">✨</button>' +
        '<button type="button" class="mp-kico" id="mpKpFull" title="局部全屏">⤢</button>' +
        '<button type="button" class="mp-kico" id="mpKpX" title="关闭">✕</button></div>' +
        '<div class="mp-kpq"><input id="mpKpQ" placeholder="在这几道题里找：题干 / 选项 / 解析">' +
        '<button type="button" class="mp-kbtn" id="mpKpQai" title="AI 模糊：拆字 / 近义 / 错别字">✨</button>' +
        '</div>' +
        '<div class="mp-kpl" id="mpKpList"></div>' +
        '<div class="mp-kpp"><button type="button" class="mp-kbtn" id="mpKpPrev">‹</button>' +
        '<span id="mpKpPg">第 1 / 1 页</span>' +
        '<button type="button" class="mp-kbtn" id="mpKpNext">›</button></div>' +
        '<div class="mp-kpsub">考点总结（点进去直接改，边改边存）<span class="mp-kstat" id="mpKpStat">所见即所得 · 选中文字出工具条 · 行首打 / 换块</span></div>' +
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
        '</div>' +
        '<div class="exp rich-edit mp-kprich" id="mpKpMd" contenteditable="true" spellcheck="false" data-note-for="kp" title="点进来就能改：支持 Markdown（**加粗**、## 标题、- 列表、```代码```、$公式$、颜色），选中文字会出工具条；Ctrl+V 可以直接粘截图"></div>' +
        '<div id="mpKpPrev2" class="mp-kprev" hidden></div>' +
        '<div class="mp-kpsub">图与附件 <i class="mp-kpah">都在本地，跟着这个考点存</i></div>' +
        '<div id="mpKpAtt" class="mp-kpatt"></div>' +
        '<div class="mp-kpaf"><button type="button" class="mp-kbtn" id="mpKpUp">＋ 从资料柜选</button>' +
        '<span class="mp-kpah" id="mpKpUpTip">图片会缩略显示，PDF / Word / HTML 点开就能看</span></div>' +
        '<i class="mp-kprz" id="mpKpRz" title="拖动改宽度"></i>' +
      '</div>');
    $('#mpKpX').onclick = kpClose;
    var kpb = $('#mpKpBack');
    if (kpb) kpb.onclick = function () { back(); };
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
    var kpT = 0;
    var kpStatus = function (t) { var e0 = document.getElementById('mpKpStat'); if (e0) e0.textContent = t; };
    ta.addEventListener('input', function () {
      var g = gCur(); if (!g) return;
      var m = kpMd(); m[kpTagName(KP.node)] = rteMd();
      $('#mpKpPrev2').innerHTML = md2h(rteMd());
      if (ta.tagName !== 'TEXTAREA') rteSlashCheck();
      kpStatus('未保存…');
      clearTimeout(kpT);
      kpT = setTimeout(function () {
        try { if (typeof saveCur === 'function') saveCur(); } catch (e) {}
        kpStatus('已保存');
      }, 600);
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { rteSlashHide(); }
      if (e.key === 'Enter' && !e.shiftKey) { setTimeout(rteSlashCheck, 20); }
    });
    try { if (typeof richImgInitOnce === 'function') richImgInitOnce(); } catch (e0) {}
    rteBind();
  }

  /* ---------- 节点过滤：相似题 / 考点 / 变式 ---------- */
  var FIL = (function () {
    var d = { sim: 1, tag: 1, var: 1 };
    try { var s = readLS('qbank.mapfil.v1', null); if (s) { d.sim = s.sim ? 1 : 0; d.tag = s.tag ? 1 : 0; d.var = s.var ? 1 : 0; } } catch (e) {}
    return d;
  })();
  /* 过滤掉节点后，画布左下角留一句提示 + 一键全显示，免得「我明明有考点却不显示」 */
  function filNote() {
    var w = document.getElementById('mpWrap'); if (!w) return;
    var box = document.getElementById('mpFilNote');
    if (!box) {
      box = document.createElement('div');
      box.id = 'mpFilNote';
      box.hidden = true;
      box.onclick = function () {
        FIL.sim = 1; FIL.tag = 1; FIL.var = 1;
        try { writeLS('qbank.mapfil.v1', FIL); } catch (e0) {}
        try {
          var boxes = document.querySelectorAll('#mpTools input[type=checkbox][data-f]');
          for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
        } catch (e1) {}
        applyFil(); render(true);
      };
      (w || document.body).appendChild(box);
    }
    var hidden = [];
    if (!FIL.tag) { var nt = DATA.nodes.filter(function (n) { return n.type === 'tag'; }).length; if (nt) hidden.push('考点 ' + nt); }
    if (!FIL.sim) { var ns = DATA.nodes.filter(function (n) { return n.type === 'sim'; }).length; if (ns) hidden.push('相似题 ' + ns); }
    if (!FIL.var) { var nv = DATA.nodes.filter(function (n) { return n.type === 'variant'; }).length; if (nv) hidden.push('变式 ' + nv); }
    if (!hidden.length) { box.hidden = true; return; }
    box.textContent = '已隐藏：' + hidden.join(' · ') + '（点这里全部显示）';
    box.hidden = false;
  }

  function applyFil() {
    var w = $('#mpWrap'); if (!w) return;
    try { filNote(); } catch (eFN) {}
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
    if (el.tagName === 'TEXTAREA') return el.value || '';
    try { if (typeof mdFromHtml === 'function') return mdFromHtml(el); } catch (e) {}
    return el.innerText || '';
  }
  function rteSet(md) {
    var el = rteEl(); if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      el.value = md || '';
      var pv0 = document.getElementById('mpKpPrev2');
      if (pv0) pv0.innerHTML = md2h(md || '');
      return;
    }
    try { el.innerHTML = (typeof mdToHtml === 'function') ? mdToHtml(md || '') : md2h(md || ''); }
    catch (e) { el.textContent = md || ''; }
    var pv = document.getElementById('mpKpPrev2'); if (pv) pv.innerHTML = md2h(md || '');
  }
  function mdWrap(before, after) {
    var el = rteEl(); if (!el || el.tagName !== 'TEXTAREA') return false;
    el.focus();
    var s0 = el.selectionStart, e0 = el.selectionEnd, v = el.value;
    var mid = v.slice(s0, e0) || '文字';
    el.value = v.slice(0, s0) + before + mid + after + v.slice(e0);
    el.selectionStart = s0 + before.length;
    el.selectionEnd = s0 + before.length + mid.length;
    el.dispatchEvent(new Event('input'));
    return true;
  }
  var MD_CMD = { bold: ['**', '**'], italic: ['*', '*'], strikeThrough: ['~~', '~~'] };
  var MD_BLK = { h2: ['## ', ''], quote: ['> ', ''], ul: ['- ', ''], code: ['```\n', '\n```'] };
  function rteCmd(cmd) {
    var el = rteEl(); if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      var p = MD_CMD[cmd]; if (!p) return;
      mdWrap(p[0], p[1]);
      return;
    }
    el.focus();
    try { document.execCommand(cmd, false, null); } catch (e) {}
    el.dispatchEvent(new Event('input'));
  }
  function rteBlock(kind) {
    var el = rteEl(); if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      var b = MD_BLK[kind] || ['', ''];
      var s1 = el.selectionStart, v1 = el.value;
      var ls = v1.lastIndexOf('\n', s1 - 1) + 1;
      el.value = v1.slice(0, ls) + b[0] + v1.slice(ls);
      el.selectionStart = el.selectionEnd = s1 + b[0].length;
      el.dispatchEvent(new Event('input'));
      return;
    }
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
    }).join('') : '<i class="mp-kpa0">还没有图或附件。点下面上传：图片会缩略显示，PDF / Word / HTML 点开就能看；这些附件跟着这个知识点一起存。</i>';
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
          '<div class="mp-ais">参考哪些知识库</div>' +
          '<div id="mpAiKb" class="mp-aikb"></div>' +
          '<div class="mp-ais">参考哪些资料（可勾选，也可多选）</div>' +
          '<div id="mpAiFiles" class="mp-aif"></div>' +
          '<label class="mp-aiup" for="mpAiUp">＋ 上传资料</label>' +
          '<input type="file" id="mpAiUp" multiple hidden>' +
          '<div class="mp-ainote"><span id="mpAiNote"></span></div>' +
        '</div>' +
        '<div class="mp-aif2"><button type="button" class="mp-kbtn" data-close="1">取消</button>' +
        '<button type="button" class="mp-kbtn pri" id="mpAiGo">开始分析</button></div>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close]')) d.classList.remove('show');
    });
    d.querySelector('#mpAiGo').addEventListener('click', kpAiRun);
    d.querySelector('#mpAiUp').addEventListener('change', function () {
      var fs = [].slice.call(this.files || []); this.value = '';
      if (!fs.length) return;
      fs.forEach(addFile);
      aiNote('已把 ' + fs.length + ' 份资料放进资料柜…');
      setTimeout(function () { kpAiFilesPaint(); aiNote(''); }, 700);
    });
  }
  /* 参考知识库（读 kb.js 存在 localStorage 里的目录，勾选只记在内存里，不动知识库本身的选择） */
  var AIKB = null;
  var AI_TAG = null;
  function kpKbList() {
    var l = [];
    try { l = readLS('qbank.kb.list.v1', []) || []; } catch (e) { l = []; }
    return Array.isArray(l) ? l.filter(function (k) { return k && k.name; }) : [];
  }
  function aiKbSel() {
    if (AIKB) return AIKB;
    var ids = null;
    try { ids = readLS('qbank.kb.sel.v1', null); } catch (e) { ids = null; }
    AIKB = {};
    kpKbList().forEach(function (k) { AIKB[k.id || k.name] = !ids || ids.indexOf(k.id) >= 0; });
    return AIKB;
  }
  function aiNote(t) { var n = document.getElementById('mpAiNote'); if (n) n.textContent = t || ''; }
  function kpAiKbPaint() {
    var box = document.getElementById('mpAiKb'); if (!box) return;
    var list = kpKbList(), sel = aiKbSel();
    box.innerHTML = list.length ? list.map(function (k) {
      var key = k.id || k.name, on = !!sel[key];
      return '<span class="mp-aik' + (on ? ' on' : '') + '" data-k="' + esc(key) + '" title="' + esc(k.name) + '">📚 ' + esc(String(k.name).slice(0, 14)) + '</span>';
    }).join('') : '<i class="mp-kpa0">还没有知识库，先去「知识库」页加一点资料</i>';
  }
  function kpAiFilesPaint() {
    var box = document.getElementById('mpAiFiles'); if (!box) return;
    box.innerHTML = FILES.length ? FILES.map(function (f) {
      return '<label class="mp-aiff"><input type="checkbox" value="' + f.id + '"> <i class="mp-kati">' + fIcon(f) + '</i>' +
        esc(String(f.name).slice(0, 16)) + '</label>';
    }).join('') : '<i class="mp-kpa0">资料柜是空的，先放点资料进来（不勾也能分析）</i>';
  }
  function kpAiOpen() {
    kpAiEnsure();
    if (KP.node) AI_TAG = kpTagName(KP.node);
    var d = document.getElementById('mpAi');
    kpAiFilesPaint();
    kpAiKbPaint();
    aiNote('');
    var kb = document.getElementById('mpAiKb');
    if (kb && !kb.__bound) {
      kb.__bound = 1;
      kb.addEventListener('click', function (e) {
        var c = e.target.closest('.mp-aik'); if (!c) return;
        var sel = aiKbSel(), k = c.dataset.k;
        sel[k] = !sel[k];
        c.classList.toggle('on', !!sel[k]);
      });
    }
    d.classList.add('show');
  }
  /* ===== 分析考点 → 先落一簇「草稿节点」（考点 + 相关题），确认后才进存档 ===== */
  var DRAFT_IDS = [];
  function draftBarShow(n) {
    var bar = document.getElementById('mpDraft');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mpDraft';
      bar.innerHTML = '<span id="mpDraftN"></span>' +
        '<button type="button" id="mpDraftKeep">保留这些草稿</button>' +
        '<button type="button" id="mpDraftDrop">撤销</button>';
      document.getElementById('mpWrap').appendChild(bar);
      document.getElementById('mpDraftKeep').onclick = draftKeep;
      document.getElementById('mpDraftDrop').onclick = draftDrop;
    }
    var t = document.getElementById('mpDraftN');
    if (t) t.textContent = '已生成 ' + n + ' 个草稿节点（虚线框）';
    bar.classList.add('show');
  }
  function draftHide() { var b = document.getElementById('mpDraft'); if (b) b.classList.remove('show'); }
  function draftKeep() {
    DATA.nodes.forEach(function (n) { if (n.draft) n.draft = false; });
    DRAFT_IDS = [];
    try { saveCur(); } catch (e) {}
    render();
    draftHide();
    toast('草稿已保留，存进这一组了', 1800, 'good');
  }
  function draftDrop() {
    var ids = {};
    DATA.nodes.forEach(function (n) { if (n.draft) ids[n.id] = 1; });
    DATA.nodes = DATA.nodes.filter(function (n) { return !ids[n.id]; });
    DATA.edges = DATA.edges.filter(function (e) { return !ids[e.a] && !ids[e.b]; });
    DRAFT_IDS = [];
    try { saveCur(); } catch (e) {}
    render(true);
    draftHide();
    toast('草稿已撤掉');
  }
  function aiDrafts(name, rows) {
    var src = DATA.nodes.filter(function (n) { return n.id === sel; })[0] ||
      DATA.nodes.filter(function (n) { return n.type === 'center'; })[0];
    if (!src) return 0;
    /* 只搬「已有的东西」：题目自带的标签 + 同考点的题，不自己编考点内容 */
    var tags = [];
    (rows || []).forEach(function (q) {
      (qTags(q) || []).forEach(function (t) { if (t !== name && !isBigTag(t) && tags.indexOf(t) < 0) tags.push(t); });
    });
    if (name && tags.indexOf(name) < 0) tags.unshift(name);
    var have = {};
    DATA.nodes.forEach(function (n) { if (n.type === 'tag') have['t:' + n.label] = 1; });
    tags = tags.filter(function (t) { return !have['t:' + t]; }).slice(0, 4);
    var used = {};
    DATA.nodes.forEach(function (n) { if (n.ref && n.ref.id) used[String(n.ref.id)] = 1; });
    var qs = (rows || []).filter(function (q) { return !used[String(q.id)]; }).slice(0, 4);
    var items = tags.map(function (t) { return { type: 'tag', label: t }; })
      .concat(qs.map(function (q) {
        return { type: 'sim', ref: q, label: String(q.stem || '').slice(0, 40), score: null };
      }));
    if (!items.length) return 0;
    snap();
    var R = 250, n0 = items.length;
    items.forEach(function (it, i) {
      var a = (-Math.PI / 2) + (i / n0) * Math.PI * 2;
      var id = 'd' + Date.now().toString(36) + i + Math.floor(Math.random() * 90 + 10);
      DATA.nodes.push(Object.assign({ id: id, x: Math.round(src.x + Math.cos(a) * R), y: Math.round(src.y + Math.sin(a) * R), draft: true }, it));
      DATA.edges.push({ a: src.id, b: id, kind: it.type === 'sim' ? 'sim' : 'tag' });
      DRAFT_IDS.push(id);
    });
    render(true);
    draftBarShow(items.length);
    return items.length;
  }

  function kpAiRun() {
    /* 以前这里第一步就 `if (!fb) return;`——没有当前组时直接静默返回，
       表现就是「按钮点了没反应」。现在每一步都给人看得见的结果。 */
    var go = document.getElementById('mpAiGo');
    var note = document.getElementById('mpAiNote');
    function say(t) { if (note) note.textContent = t; toast(t); }
    try { kpFilesBox(); } catch (e0) {}
    var g0 = null; try { g0 = gCur(); } catch (e1) {}
    if (!g0) { say('先打开一张导图再分析'); return; }
    var name = KP.node ? kpTagName(KP.node) : (AI_TAG || '');
    if (!name) {
      /* 兜底：用当前选中节点上的标签，或中心题的第一个小考点 */
      try {
        var sn = DATA.nodes.filter(function (x) { return x.id === sel; })[0];
        var cq = (DATA.nodes.filter(function (x) { return x.type === 'center'; })[0] || {}).ref;
        var pool = (sn && sn.ref ? tagList(sn.ref, S.bankId) : (cq ? tagList(cq, S.bankId) : [])) || [];
        for (var i = 0; i < pool.length; i++) { if (!isBigTag(pool[i])) { name = pool[i]; break; } }
      } catch (e2) {}
    }
    if (!name) { say('先点一个考点（标题栏那一排标签）再来分析'); return; }
    if (go) { go.disabled = true; go.textContent = '分析中…'; }
    try { kpAiDo(name); } catch (e3) { say('分析没跑完：' + (e3 && e3.message ? e3.message : e3)); }
    finally { if (go) { go.disabled = false; go.textContent = '开始分析'; } }
  }

  /* 真·模型生成：把考点、这批题的题干/选项/答案/解析、选定的知识库与提示词一起发给模型，
     让它写「知识点是什么 / 怎么认 / 这批题卡在哪 / 还没考到的延伸 / 口诀」。
     本地规则那版先垫在编辑器里，模型回来再覆盖——这样点一下立刻有东西看，不是干等。 */
  function kpAiModel(name, rows, fileNames, kbNames) {
    return new Promise(function (resolve) {
      if (!aiReady()) { resolve(null); return; }
      var cut = function (s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
      var ansTxt = function (q) {
        var a = q.answer || q.ans;
        if (Array.isArray(a)) return a.join('');
        if (typeof a === 'number') return 'ABCDEFGH'[a] || '';
        return String(a == null ? '' : a).toUpperCase().replace(/[^A-H]/g, '').slice(0, 4);
      };
      var qLines = rows.slice(0, 10).map(function (q, i) {
        var opts = (q.options || []).map(function (o, j) { return 'ABCDEFGH'[j] + '.' + cut(o, 30); }).join(' ');
        var exp = cut(q.exp || q.explain || q.expl || '', 160);
        return (i + 1) + '. ' + cut(q.stem, 160) + (opts ? ('\n   选项：' + opts) : '')
          + '\n   答案：' + (ansTxt(q) || '未标') + (exp ? ('\n   原解析：' + exp) : '');
      }).join('\n');
      var userAsk = '';
      try { var p0 = document.getElementById('mpAiP'); userAsk = p0 ? String(p0.value || '').trim() : ''; } catch (eP) {}
      if (!userAsk) userAsk = '总结';

      var sys = '你是医学考试的助教，帮用户把一个「考点」整理成能直接复习的小结。'
        + '只依据下面给的题目与解析；资料没写到的医学细节不要编造，宁可写「题库里没覆盖，建议自己补」。'
        + '输出 Markdown（不要代码块包裹），固定这几节：'
        + '「## 知识点是什么」「## 怎么认（判据）」「## 这批题卡在哪」「## 还没考到的延伸」「## 口诀 / 记忆钩子」。'
        + '要具体、可背：判据写成「看到 X 就想到 Y」这种；不要空话、不要重复题干。';
      var user = '考点：' + name
        + '\n用户希望：' + cut(userAsk, 60)
        + (kbNames.length ? ('\n可参考知识库：' + kbNames.slice(0, 4).join('、')) : '')
        + (fileNames.length ? ('\n用户选了资料：' + fileNames.join('、')) : '')
        + '\n这批题（共 ' + rows.length + ' 道，下面是前 ' + Math.min(10, rows.length) + ' 道）：\n' + (qLines || '（题库里没有命中这个考点的题）');

      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var done = false;
      var fin = function (v) { if (done) return; done = true; clearTimeout(t); resolve(v); };
      var t = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e0) {} fin(null); }, 60000);
      var p;
      try {
        p = window.aiChat([{ role: 'system', content: sys }, { role: 'user', content: user }],
          null, ctl ? ctl.signal : null, { stream: false, temp: 0.4, maxTokens: 1400 });
      } catch (e1) { fin(null); return; }
      Promise.resolve(p).then(function (txt) {
        var out = String(txt || '').trim().replace(/^```(?:md|markdown)?\s*/i, '').replace(/```\s*$/, '').trim();
        if (!out || out.length < 40) { fin(null); return; }
        fin(out);
      }).catch(function () { fin(null); });
    });
  }

  function kpAiDo(name) {
    /* 这块是「考点的小结」，不是「题目清单」：
       知识点是什么 → 怎么认 → 这批题卡在哪 → 还没考到的延伸 → 口诀 */
    var bank = null; try { bank = bankById(S.bankId); } catch (e0) {}
    var all = (bank && bank.questions) ? bank.questions : [];
    var rows = all.filter(function (q) { return (qTags(q) || []).indexOf(name) >= 0; });
    if (!rows.length) rows = (KP.rows || []).slice();
    var pick = [].slice.call(document.querySelectorAll('#mpAiFiles input:checked')).map(function (x) { return fById(x.value); }).filter(Boolean);
    var ksel = aiKbSel();
    var kbs = kpKbList().filter(function (k) { return ksel[k.id || k.name]; }).map(function (k) { return String(k.name).slice(0, 20); });
    var onMap = DATA.nodes.filter(function (n) { return n.type === 'sim' || n.type === 'center' || n.type === 'variant'; }).length;

    /* 大标签（科目 / 系统）：取出现最多的那个 */
    var big = '';
    rows.forEach(function (q) { (qTags(q) || []).forEach(function (t) { if (isBigTag(t) && !big) big = t; }); });
    /* 邻接小考点 */
    var neigh = [];
    rows.forEach(function (q) { (qTags(q) || []).forEach(function (t) { if (t !== name && !isBigTag(t) && neigh.indexOf(t) < 0) neigh.push(t); }); });
    /* 解析：当作「判据」的原材料 */
    var exps = rows.map(function (q) { return String(q.exp || q.explain || q.expl || '').replace(/^解析[:：]/, '').trim(); }).filter(Boolean);
    /* 问法分布：题干尾部的疑问词 */
    var askMap = {};
    rows.forEach(function (q) {
      var s = String(q.stem || '');
      var m = s.match(/(最典型|最有意义|最可能|最常见|最早|最晚|首先|提示什么|提示|说明|诊断是|治疗是|机制是|为什么|下列哪[一项些]|错误的是|正确的是)/);
      var k = m ? m[1] : '普通问法';
      askMap[k] = (askMap[k] || 0) + 1;
    });
    /* 干扰项高频词：选项里出现 ≥2 次的词 */
    var optWord = {};
    rows.forEach(function (q) {
      (q.options || []).forEach(function (o) {
        String(o).replace(/^[A-H][.、\s]*/, '').split(/[，,。；;、\s]/).forEach(function (w) {
          w = w.trim(); if (w.length >= 2 && w.length <= 6) optWord[w] = (optWord[w] || 0) + 1;
        });
      });
    });
    var optTop = Object.keys(optWord).filter(function (w) { return optWord[w] >= 2 && w !== name; })
      .sort(function (a, b) { return optWord[b] - optWord[a]; }).slice(0, 5);
    /* 还没考到的延伸：同科目下其它小考点里，这批题一个都没碰的 */
    var ext = [];
    all.forEach(function (q) {
      (qTags(q) || []).forEach(function (t) {
        if (isBigTag(t) || t === name) return;
        if (big && (qTags(q) || []).indexOf(big) < 0) return;
        if (rows.some(function (r) { return (qTags(r) || []).indexOf(t) >= 0; })) return;
        if (ext.indexOf(t) < 0) ext.push(t);
      });
    });

    var L = [];
    L.push('# ' + name);
    L.push('> 考点小结 · 本库 ' + rows.length + ' 道题命中它，图上 ' + onMap + ' 道' +
      (kbs.length ? ('；参考知识库：' + kbs.slice(0, 3).join('、') + (kbs.length > 3 ? (' 等 ' + kbs.length + ' 个') : '')) : '') +
      (pick.length ? ('；资料：' + pick.map(function (f) { return f.name; }).join('、')) : ''));
    L.push('');
    L.push('## 知识点是什么');
    if (big) L.push('- 归属：**' + big + '**');
    if (neigh.length) L.push('- 常一起出现：' + neigh.slice(0, 4).join('、'));
    L.push('- 一句话：**' + name + '**' + (exps[0] ? (' —— ' + exps[0].split(/[。；]/)[0].slice(0, 60)) : '（还没写解析，下面可以自己补）'));
    L.push('');
    L.push('## 怎么认（判据）');
    if (exps.length) {
      exps.slice(0, 2).forEach(function (t) { L.push('- ' + t.slice(0, 110)); });
    } else {
      L.push('- 题干里出现「' + name + '」时，先定位它属于哪个结构 / 哪一步机制，再排除同类干扰。');
    }
    L.push('');
    L.push('## 这批题卡在哪');
    L.push('- 题量：**' + rows.length + '** 道（单选 ' + rows.filter(function (q) { return (q.answer || []).length <= 1; }).length +
      ' / 多选 ' + rows.filter(function (q) { return (q.answer || []).length > 1; }).length + '）');
    var asks = Object.keys(askMap).sort(function (a, b) { return askMap[b] - askMap[a]; });
    if (asks.length) {
      L.push('- 问法分布：');
      asks.forEach(function (k) { L.push('  - 「' + k + '」× ' + askMap[k]); });
    }
    if (optTop.length) L.push('- 高频干扰项：' + optTop.join('、'));
    var miss = rows.filter(function (q) { return !String(q.exp || q.explain || q.expl || '').trim(); });
    if (miss.length) L.push('- 有 **' + miss.length + '** 道还没有解析，建议先补解析再背。');
    L.push('');
    L.push('## 还没考到的延伸');
    if (ext.length) {
      L.push('- 同一科目下这些考点这批题一个没碰：' + ext.slice(0, 8).join('、') + (ext.length > 8 ? (' 等 ' + ext.length + ' 个') : ''));
      L.push('- 复习顺序：先吃透「' + name + '」的判据，再用上面这些做横向对比，避免只认关键词。');
    } else {
      L.push('- 这个科目能挖的考点基本都在这一组里了，重点转到「换问法」上。');
    }
    L.push('');
    L.push('## 口诀 / 记忆钩子');
    L.push('`' + (neigh.slice(0, 3).concat([name]).join('、')) + '` —— 顺序别记反。');

    var txt = L.join('\n');
    var m = kpMd(); m[name] = txt;
    try { saveCur(); } catch (e) {}
    rteSet(txt);
    var pv = document.getElementById('mpKpPrev2'); if (pv) pv.innerHTML = md2h(txt);
    var aiEl = document.getElementById('mpAi'); if (aiEl) aiEl.classList.remove('show');
    var nd = 0;
    try { nd = aiDrafts(name, rows.slice(0, 8)); } catch (e) {}
    var st = document.getElementById('mpKpStat');
    if (!aiReady()) {
      if (st) st.textContent = '本地规则生成 · 没配模型（设置里填 API 才是真 AI）';
      toast(nd ? ('分析完了：写进编辑器，另外挂了 ' + nd + ' 个草稿节点（确认后才会存）')
        : '分析完了，已写进右侧编辑器（可以接着改；这是本地规则版，配了模型会换成 AI 写）');
      return;
    }
    if (st) st.textContent = '本地草稿 · AI 正在写…';
    var pickNames = pick.map(function (f) { return String(f.name || '').slice(0, 24); });
    kpAiModel(name, rows, pickNames, kbs).then(function (out) {
      if (!out) {
        if (st) st.textContent = 'AI 没回话，先用本地规则版（可以点 ✨ 重试）';
        toast('模型没回话，先用本地规则版');
        return;
      }
      var m2 = kpMd(); m2[name] = out;
      try { saveCur(); } catch (e2) {}
      try { rteSet(out); } catch (e3) {}
      var pv2 = document.getElementById('mpKpPrev2'); if (pv2) pv2.innerHTML = md2h(out);
      if (st) st.textContent = 'AI 生成 · 改完自动保存';
      toast('AI 写完了：' + name);
    });
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
    try { sideClose(); } catch (e) {}   /* 换成考点面板时，题目抽屉让位，别停在旧题上 */
    var p = $('#mpKp'); if (!p) return;
    p.classList.add('show');
    try { winFocus('#mpKp'); } catch (e0) {}
    $('#mpKpName').textContent = kpTagName(n);
    var q = $('#mpKpQ'); if (q) q.value = '';
    var qa = $('#mpKpQai'); if (qa) qa.classList.remove('on');
    var m = kpMd()[kpTagName(n)] || '';
    /* contenteditable 不能用 .value 赋值（web337 的 bug：重开考点编辑器是空的，一打字就把旧内容冲掉） */
    if (typeof rteSet === 'function') rteSet(m);
    else { var ed0 = $('#mpKpMd'); if (ed0) ed0.innerHTML = md2h(m); $('#mpKpPrev2').innerHTML = md2h(m); }
    var st0 = document.getElementById('mpKpStat');
    if (st0) st0.textContent = m ? '已保存' : 'Markdown 源码 · 上面写，下面实时显示';
    kpPaint();
    /* 面板从右边盖上来，画布往左让一段，正在看的考点不会被糊住 */
    if (!KP.shift) {
      var pr = p.getBoundingClientRect();
      var sh = Math.max(0, Math.round(Math.min(pr.width * 0.64, innerWidth * 0.32, 300)));
      if (sh > 40) { KP.shift = sh; try { V.tx -= sh; paintView(); } catch (e) {} }
    }
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
    /* 全屏时把「拖宽」留下的内联宽度让出来，否则 432px 的记录会压过 1000px 的中心浮卡 */
    if (on) { if (p._w === undefined) p._w = p.style.width || ''; p.style.width = ''; }
    else if (p._w !== undefined) { p.style.width = p._w; p._w = undefined; }
    /* .full 时把面板提到 body 上，否则会被 #mpWrap 的层叠上下文压到遮罩下面 */
    if (on) {
      if (!p._home) p._home = p.parentNode;
      if (p.parentNode !== document.body) document.body.appendChild(p);
      p.style.zIndex = '30090';
    } else {
      if (p._home && p.parentNode === document.body && p._home.appendChild) p._home.appendChild(p);
      p.style.zIndex = '';
    }
  }

  function kpClose() {
    var p = $('#mpKp'); if (p) { p.classList.remove('show'); p.classList.remove('full'); }
    KP.node = null;
    /* 面板收起时把画布让出来的那一段挪回去 */
    if (KP.shift) {
      try { V.tx += KP.shift; KP.shift = 0; paintView(); } catch (e) {}
    }
  }

  /* 标签有、但题找不到时给一句人话（题库可能没加载 / 标签存在别的方案里） */
  function kpEmptyNote(name) {
    var banks = 0, tagged = 0;
    try { banks = (typeof allBanks === 'function') ? allBanks().length : 0; } catch (e0) {}
    try {
      var all = readLS('qbank.tags.v1', {}) || {};
      tagged = Object.keys(all).length;
    } catch (e1) {}
    return '「' + esc(name) + '」这个考点下面没找到题（扫了 ' + banks + ' 个题库、' + tagged + ' 条标签记录）。' +
      '如果考点页里有题，可能是标签存在别的题库方案里，切回去再看。';
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
    }).join('') : '<div class="mp-kempty">' + (q ? ('没搜到「' + esc(raw) + '」' + (ai ? '' : '，可以试试 ✨')) : kpEmptyNote(kpTagName(KP.node))) + '</div>';
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
  /* 换中心题：先把每张卡「停在原来的位置」，再一起滑到新位置（FLIP），
     不然整张图会啪地闪一下重排，看着很跳。 */
  function flipFrom(oldPos) {
    var nodesEl = $('#mpNodes'); if (!nodesEl) return;
    var moved = [];
    DATA.nodes.forEach(function (n) {
      var o = oldPos[n.id]; if (!o) return;
      if (o.x === n.x && o.y === n.y) return;
      var el = nodesEl.querySelector('.mp-node[data-id="' + n.id + '"]');
      if (el) moved.push({ el: el, ox: o.x, oy: o.y, nx: n.x, ny: n.y });
    });
    if (!moved.length) return;
    var g = $('#mpEdgeG'), glow = $('#mpGlowG');
    if (g) g.style.opacity = '0';
    if (glow) glow.style.opacity = '0';
    moved.forEach(function (m) {
      m.el.style.transition = 'none';
      m.el.style.left = m.ox + 'px'; m.el.style.top = m.oy + 'px';
    });
    void nodesEl.offsetWidth;   /* 强制回流，否则起点不生效 */
    moved.forEach(function (m) {
      m.el.style.transition = 'left .38s cubic-bezier(.22,.61,.36,1), top .38s cubic-bezier(.22,.61,.36,1)';
      m.el.style.left = m.nx + 'px'; m.el.style.top = m.ny + 'px';
    });
    clearTimeout(flipFrom.__t);
    flipFrom.__t = setTimeout(function () {
      moved.forEach(function (m) { m.el.style.transition = ''; });
      try { drawEdges(); } catch (e) {}
      if (g) g.style.opacity = '';
      if (glow) glow.style.opacity = '';
    }, 400);
  }

  function recenter(q, noNav) {
    ANIM_ONCE = true;
    /* 相似题可能来自别的题库：先跟着换过去，否则这道题在新题库里找不到 */
    if (q && q._bank && String(q._bank) !== String(S.bankId)) {
      try {
        var nb = bankById(q._bank);
        if (nb) { S.bankId = String(q._bank); if (typeof QZ !== 'undefined') { QZ.bankId = String(q._bank); } }
      } catch (eB0) {}
    }
    var bank = null; try { bank = bankById(S.bankId); } catch (e) {}
    if (!bank) return;
    if (!noNav) navPush();
    var oldPos = {};
    (DATA.nodes || []).forEach(function (n) { oldPos[n.id] = { x: n.x, y: n.y }; });
    S.qid = q.id;
      DATA = build(bank, q);
      try { syncVariants(true); } catch (eVS2) {}
    try { syncVariants(true); } catch (eVS) {}
    /* 相似题自己带的考点也摆上来（build 只摆中心题的） */
    try { ensureTagNodes(bank); } catch (eTN0) {}
    var g = gCur();
    if (g && g.auto !== false) { g.name = String(q.stem || '').slice(0, 14); }
    sel = null;
    applyLayout(LAY.name);
    saveCur(); renderGrp();
    try { if ((DATA.nodes || []).length <= 40) flipFrom(oldPos); } catch (e) {}
    /* 结构不变时位置本来就一样，加一层很轻的淡入，看起来像「换」而不是「闪」 */
    try {
      var ns = document.querySelectorAll('#mpNodes .mp-node');
      for (var i = 0; i < ns.length; i++) ns[i].classList.add('fadein');
      setTimeout(function () {
        for (var j = 0; j < ns.length; j++) { try { ns[j].classList.remove('fadein'); } catch (e2) {} }
      }, 300);
    } catch (e) {}
  }

  /* ---------- 对外 ---------- */
  /* 从别的页面（掌握度/统计）带着题库+题号打开 */
  function openFor(bankId, qid) {
    ANIM_ONCE = true;
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
    ANIM_ONCE = true;
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
    var lv = readLS(LAY_KEY, 'grid');
    /* 老版本默认是「放射」，一次性迁到「树形」；之后用户自己选放射就尊重 */
    try {
      if (lv === 'radial' && !localStorage.getItem('qbank.mapdef.tree.v1')) {
        lv = 'tree'; localStorage.setItem('qbank.mapdef.tree.v1', '1'); writeLS(LAY_KEY, 'tree');
      }
    } catch (eM) {}
    LAY.name = layName(lv);
    ensure();
    try { initB4(); } catch (e) {}
    gLoad();
    try { dedupeAll(); } catch (eDA) {}
    /* 先找「这道题」已有的组；没有就现建一组（自动名 = 题干前 14 字） */
    var wantPath = PATHM.on ? 1 : 0;
    var sameQ = G.list.filter(function (x) { return x.bank === bank.id && String(x.qid) === String(q.id); });
    var g = sameQ.filter(function (x) { return (x.path ? 1 : 0) === wantPath; })[0] || sameQ[0];
    if (g) {
      G.active = g.id; gSave();
      loadGroup(g);
    } else {
      DATA = build(bank, q);
      try { ensureTagNodes(bank); } catch (eTN1) {}
      sel = null;
      applyLayout(LAY.name);
      gAddFrom(String(q.stem || '').slice(0, 14), DATA.nodes.map(serNode),
        DATA.edges.map(function (e) { return { a: e.a, b: e.b, kind: e.kind, w: e.w }; }), bank.id, q.id, LAY.name);
      var g1 = gCur(); if (g1) { g1.auto = true; gSave(); }
      if (g1) setTimeout(function () { try { aiReviewFresh(g1.id, bank, q); } catch (eAR) {} }, 700);
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
    /* 只存元数据：文件本体在 IndexedDB 里 */
    try {
      var meta = FILES.slice(-40).map(function (f) {
        return { id: f.id, name: f.name, mime: f.mime, size: f.size };
      });
      localStorage.setItem(FK, JSON.stringify(meta));
    } catch (e) { toast('本地存储写不进去了，先删几个文件'); }
  }
  function filesEnsure() {
    if ($('#mpFiles')) { paintFiles(); return; }
    try { filesHydrate(); } catch (e0) {}    var d = document.createElement('div');
    d.id = 'mpFiles';
    d.innerHTML = '<div class="mfh"><b>资料柜</b><span class="mfc" id="mfcN">0</span>' +
      '<span class="mfg"></span>' +
      '<button type="button" id="mfAdd" title="上传资料（图片 / PDF / Word / HTML）">＋</button>' +
      '<button type="button" id="mfMin" title="收起">—</button></div>' +
      '<div class="mfq"><input id="mfQ" placeholder="搜资料名…"><select id="mfType" title="只看某一类">' +
      '<option value="all">全部</option><option value="img">图片</option><option value="pdf">PDF</option>' +
      '<option value="doc">Word</option><option value="html">网页</option><option value="txt">其它</option></select></div>' +
      '<div class="mfl" id="mfList"></div>' +
      '<input type="file" id="mfInput" multiple hidden>';
    $('#mpWrap').appendChild(d);
    $('#mfAdd').onclick = function () { $('#mfInput').click(); };
    $('#mfMin').onclick = function () { d.classList.toggle('min'); };
    $('#mfQ').addEventListener('input', function () { paintFiles(); });
    $('#mfType').addEventListener('change', function () { paintFiles(); });
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
      if (e.target.closest('.mfd')) { var delId = r.dataset.id; FILES = FILES.filter(function (f) { return f.id !== delId; }); try { idbDel(delId); } catch (err) {} fSave(); paintFiles(); return; }
      pvOpen(r.dataset.id);
    });
    paintFiles();
  }
  /* ===== 文件本体放 IndexedDB（localStorage 只留元数据）=====
     localStorage 只有 5MB，一张扫描件就能顶满；文件本体改存 IDB，
     打开时换成 blob: URL，预览 / 拖到画布 / 新标签打开 都不受影响。 */
  var MF_DB = 'shuati-mapfiles';
  function idbOpen() {
    return new Promise(function (res, rej) {
      var r;
      try { r = indexedDB.open(MF_DB, 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = function () { try { r.result.createObjectStore('files'); } catch (e) {} };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbTx(mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('files', mode), s = t.objectStore('files'), out;
        try { out = fn(s); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }
  function idbPut(id, blob) { return idbTx('readwrite', function (s) { s.put(blob, id); }); }
  function idbGet(id) { return idbTx('readonly', function (s) { return s.get(id); }); }
  function idbDel(id) { return idbTx('readwrite', function (s) { s.delete(id); }); }
  function blobUrl(blob) { try { return URL.createObjectURL(blob); } catch (e) { return ''; } }
  /* 老数据（dataURL 塞在 localStorage 里）迁到 IDB，顺手把 localStorage 瘦下来 */
  function filesHydrate() {
    var list = FILES.slice();
    list.forEach(function (f) {
      if (f.url) return;
      idbGet(f.id).then(function (b) {
        if (b) { f.url = blobUrl(b); f.__dirty = 1; paintFiles(); }
      }).catch(function () {});
    });
    /* 迁移：url 还是 data: 的，转成 Blob 存进 IDB */
    var legacy = list.filter(function (f) { return /^data:/.test(String(f.url || '')); });
    if (!legacy.length) { if (FILES.some(function (f) { return f.url && !/^(data:|blob:)/.test(f.url); })) fSave(); return; }
    legacy.forEach(function (f) {
      try {
        fetch(f.url).then(function (r) { return r.blob(); }).then(function (b) {
          return idbPut(f.id, b).then(function () {
            f.url = blobUrl(b); f.__migrated = 1;
            if (legacy.every(function (x) { return x.__migrated; })) { fSave(); paintFiles(); }
          });
        }).catch(function () {});
      } catch (e) {}
    });
  }
  function addFile(file) {
    var id = 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
    var meta = { id: id, name: file.name, mime: file.type || '', size: file.size, url: blobUrl(file) };
    FILES.push(meta);
    idbPut(id, file).catch(function () {
      /* IDB 不可用（隐私模式等）就退回 dataURL，只在本次会话里用 */
      var fr = new FileReader();
      fr.onload = function () { meta.url = fr.result; paintFiles(); };
      fr.readAsDataURL(file);
    });
    fSave(); paintFiles(); toast('已放进资料柜：' + String(file.name).slice(0, 14));
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
  function fKind(f) {
    var m = String(f.mime || ''), n = String(f.name || '');
    if (m.indexOf('image') === 0) return 'img';
    if (m.indexOf('pdf') >= 0 || /\.pdf$/i.test(n)) return 'pdf';
    if (/\.(docx?|wps)$/i.test(n)) return 'doc';
    if (m.indexOf('html') >= 0 || /\.(html?|mht)$/i.test(n)) return 'html';
    return 'txt';
  }
  function fHay(f) { return String(f.name || '').toLowerCase(); }
  function fileRows() {
    var qi = $('#mfQ'), ti = $('#mfType');
    var q = qi ? srHay(qi.value || '') : '';
    var t = ti ? ti.value : 'all';
    return FILES.filter(function (f) {
      if (t !== 'all' && fKind(f) !== t) return false;
      if (q && fHay(f).indexOf(q) < 0) return false;
      return true;
    });
  }
  function paintFiles() {
    var box = $('#mfList'); if (!box) return;
    var n = $('#mfcN'); if (n) n.textContent = FILES.length;
    var rows = fileRows();
    box.innerHTML = rows.length ? rows.map(function (f) {
      return '<div class="mfrow" data-id="' + f.id + '" draggable="true" title="拖到画布上 = 挂成资料节点">' +
        '<i class="mfi">' + fIcon(f) + '</i>' +
        '<span class="mfn">' + esc(String(f.name).slice(0, 16)) + '</span>' +
        '<span class="mfs">' + fSize(f.size || 0) + '</span>' +
        '<button type="button" class="mfd" title="删掉">✕</button></div>';
    }).join('') : (FILES.length ? '<div class="mfe">没有匹配的资料<i>换个关键字，或者把类型切回「全部」</i></div>'
      : '<div class="mfe">把图片 / PDF / HTML 拖进脑图，或点上面 ＋ 上传<br><i>放进资料柜后，还能把文件从柜子拖到画布上摆着</i></div>');
  }
  function fById(id) { return FILES.filter(function (f) { return f.id === id; })[0]; }
  /* 文件本体在 IDB 里，用到时再取（老数据也顺手迁一下） */
  function ensureUrl(f, cb) {
    if (!f) return;
    if (f.url) { cb(f); return; }
    idbGet(f.id).then(function (b) {
      if (!b) { toast('文件本体读不出来了，可能没存进去'); return; }
      f.url = blobUrl(b); cb(f);
    }).catch(function () { toast('文件本体读不出来了'); });
  }
  function pvHtml(f) {
    var m = String(f.mime || '');
    if (m.indexOf('image') === 0) return '<img class="mppi" src="' + f.url + '" alt="">';
    /* HTML 用 sandbox 隔离：允许脚本跑，但不给 same-origin —— 它读不到题库和资料柜的数据 */
    if (m.indexOf('html') >= 0 || /\.(html?|htm)$/i.test(f.name)) {
      return '<iframe class="mppe" sandbox="allow-scripts allow-popups allow-forms allow-modals" src="' + f.url + '"></iframe>';
    }
    if (m.indexOf('pdf') >= 0 || /\.pdf$/i.test(f.name)) return '<div class="mp-pdf" data-pdf="1"><i class="mp-pdfld">PDF 加载中…</i></div>';
    if (/\.mht$/i.test(f.name)) return '<iframe class="mppe" sandbox="allow-scripts allow-popups" src="' + f.url + '"></iframe>';
    if (m.indexOf('text') === 0) return '<pre class="mppt">（点「放大」看全文）</pre>';
    /* Word：浏览器排不了 docx，给一张说明卡，指到标题栏的 ↗ 系统打开 */
    if (/\.(docx?|wps|rtf)$/i.test(String(f.name || '')) || m.indexOf('word') >= 0 || m.indexOf('officedocument') >= 0) {
      return '<div class="mppd"><b>Word 文档</b>' +
        '<span>浏览器没法直接排版 .docx，点标题栏的 <i>↗</i> 用系统默认程序（Word / WPS）打开</span>' +
        '<em>' + esc(String(f.name || '')) + '</em></div>';
    }
    return '<div class="mppe mppx">这种格式没法直接看，点标题栏的 ↘ 用系统打开</div>';
  }
  /* 图只有 1×1（占位图）或压根加载不出来时，别给用户留一块莫名其妙的白板 */
  /* PDF 走站内 pdf.js 阅读器（手机浏览器不认内嵌 PDF，iframe 直接白板） */
  var PDF_URLS = [];
  /* 站内 pdf.js 阅读器塞进 iframe 只画出上半页，剩下的地方是白的。
     这里直接用 pdf.js 把每一页画成 canvas，按顺序叠起来滚着看，页数多也不会缺。 */
  function pvPdf(box, f) {
    if (!box) return;
    var wrap = box.querySelector('.mp-pdf[data-pdf]'); if (!wrap) return;
    if (wrap.dataset.on === '1') return;
    wrap.dataset.on = '1';
    var u = String(f.url || '');
    if (!u) {
      wrap.innerHTML = '<div class="mpvph"><b>文件本体还没读出来</b><br>稍等一会儿再点开，或者重新上传一次</div>';
      return;
    }
    var paint = function (url) {
      import('./pdfjs/build/pdf.mjs').then(function (lib) {
        try { lib.GlobalWorkerOptions.workerSrc = './pdfjs/build/pdf.worker.mjs'; } catch (e0) {}
        return lib.getDocument({ url: url, isEvalSupported: false }).promise;
      }).then(function (doc) {
        /* 预览窗是刚插进 DOM 的，clientWidth 可能还是 0：按面板宽度兜一个下限，
           再让页面自己撑满，别画成一张小邮票 */
        var hostW = Math.max(box.clientWidth || 0, wrap.clientWidth || 0, 420);
        var vw = Math.max(360, hostW - 26);
        wrap.innerHTML = '';
        var i = 1;
        var shown = 0;
        var NEXT_BATCH = 12;   /* 页太多就分批画，别一次卡死 */
        var more = null;
        var next = function () {
          if (i > doc.numPages) {
            if (more) more.remove();
            return Promise.resolve();
          }
          if (shown >= NEXT_BATCH) {
            if (!more) {
              more = document.createElement('button');
              more.type = 'button';
              more.className = 'mp-pdfmore';
              more.textContent = '继续往下看（已画 ' + shown + ' / ' + doc.numPages + ' 页）';
              wrap.appendChild(more);
              more.onclick = function () { shown = 0; more.remove(); more = null; next(); };
            }
            return Promise.resolve();
          }
          shown++;
          var pn = i++;
          return doc.getPage(pn).then(function (page) {
            var base = page.getViewport({ scale: 1 });
            /* 别把 A4 画成 1200×1700 的巨幅 canvas（一页 8MB，十页就上百兆） */
            var sc = Math.min(2.2, Math.max(0.35, vw / base.width), 1000 / base.width);
            var vp = page.getViewport({ scale: sc });
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(vp.width));
            cv.height = Math.max(1, Math.round(vp.height));
            cv.className = 'mp-pdfp';
            wrap.appendChild(cv);
            return page.render({ canvasContext: cv.getContext('2d'), viewport: vp, canvas: cv }).promise;
          }).then(next, function () { return next(); });
        };
        return next().then(function () {
          var t = document.createElement('div');
          t.className = 'mp-pdfn';
          t.textContent = '共 ' + doc.numPages + ' 页' + (doc.numPages > 1 ? ' · 往下滚看下一页' : '');
          wrap.appendChild(t);
        });
      }).catch(function () {
        wrap.innerHTML = '<div class="mpvph"><b>PDF 读不出来</b><br>点标题栏的「新标签」用浏览器打开</div>';
      });
    };
    var later = function (fn) { setTimeout(fn, 70); };
    if (/^data:/.test(u)) {
      try {
        fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
          var bu = blobUrl(b); PDF_URLS.push(bu); later(function () { paint(bu); });
        }).catch(function () { later(function () { paint(u); }); });
      } catch (e) { later(function () { paint(u); }); }
    } else later(function () { paint(u); });
  }
  function pvGuard(box, f) {
    if (!box) return;
    var im = box.querySelector('img.mppi');
    if (!im) return;
    var done = false;
    var nm = esc(String(f.name || ''));
    var tiny = function () {
      if (done) return; done = true;
      box.innerHTML = '<div class="mpvph"><b>这张图只有 ' + im.naturalWidth + '×' + im.naturalHeight + ' 像素</b><br>' +
        '多半是占位图或缩略图，换一张正常大小的图就能看了<br><i>' + nm + '</i></div>';
    };
    var fail = function () {
      if (done) return; done = true;
      box.innerHTML = '<div class="mpvph"><b>图片没能加载出来</b><br>' +
        '也许这份资料已经被删掉，或者文件本身坏了<br><i>' + nm + '</i></div>';
    };
    im.addEventListener('load', function () {
      if (im.naturalWidth <= 2 || im.naturalHeight <= 2) tiny();
    });
    im.addEventListener('error', fail);
    if (im.complete) {
      if (!im.naturalWidth || !im.naturalHeight) fail();
      else if (im.naturalWidth <= 2 || im.naturalHeight <= 2) tiny();
    }
  }
  function pvOpen(id) {
    var f = fById(id); if (!f) return;
    if (!f.url) { ensureUrl(f, function () { pvOpen(id); }); return; }
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
        /* 用 offsetLeft/offsetTop + 指针位移，避免把「视口坐标」当「相对窗口坐标」用（会和 #mpWrap 的偏移叠加） */
        drag = { px: p.offsetLeft, py: p.offsetTop, x: e.clientX, y: e.clientY };
        p.dataset.moved = '1';
        p.style.right = 'auto'; p.style.bottom = 'auto';
        p.style.left = drag.px + 'px'; p.style.top = drag.py + 'px';
        p.style.width = p.style.width || (Math.round(r.width) + 'px');
        p.style.height = p.style.height || (Math.round(r.height) + 'px');
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
      });
      h.addEventListener('pointermove', function (e) {
        if (!drag) return;
        p.style.left = Math.max(6, drag.px + e.clientX - drag.x) + 'px';
        p.style.top = Math.max(6, drag.py + e.clientY - drag.y) + 'px';
      });
      h.addEventListener('pointerup', function () { drag = null; });
    }
    p.dataset.cur = id;
    p.dataset.z = 1;
    $('#mpPvN').textContent = String(f.name).slice(0, 22);
    $('#mpPvB').innerHTML = '<div class="mpvwrap" style="zoom:1">' + pvHtml(f) + '</div>';
    pvGuard($('#mpPvB'), f);
    pvPdf($('#mpPvB'), f);
    pvPdf($('#mpPvB'), f);
    var zl = $('#mpPvZL'); if (zl) zl.textContent = '100%';
    try { $('#mpPvSys').href = f.url || ''; } catch (e) {}
    try { $('#mpPvTab').href = f.url || ''; } catch (e) {}
    /* 默认贴在窗口右侧（和样板一样），拖动过就留在拖到的位置 */
    if (!p.dataset.moved) {
      p.style.left = 'auto'; p.style.top = ''; p.style.bottom = '';
      p.style.right = '12px';
      p.style.width = 'min(520px,44vw)';
      p.style.height = 'min(560px,calc(100% - 96px))';
      p.style.top = '52px';
    }
    p.classList.add('show');
  }
  function vwOpen(id) {
    var f = fById(id); if (!f) return;
    if (!f.url) { ensureUrl(f, function () { vwOpen(id); }); return; }
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
    pvGuard($('#mpVwB'), f);
    pvPdf($('#mpVwB'), f);
    pvPdf($('#mpVwB'), f);
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

  /* 长按进度：从左上角起绕一圈的蓝光 */
  var RING = null;
  function ringHide() {
    if (RING && RING.parentNode) RING.parentNode.removeChild(RING);
    RING = null;
  }
  function ringShow(el, ms) {
    ringHide();
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    if (!r.width) return;
    var d = Math.max(r.width, r.height) + 26;
    var R = d / 2 - 3, C = 2 * Math.PI * R;
    var box = document.createElement('div');
    box.id = 'mpRing';
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:30075;' +
      'left:' + Math.round(r.left + r.width / 2 - d / 2) + 'px;top:' + Math.round(r.top + r.height / 2 - d / 2) + 'px;' +
      'width:' + d + 'px;height:' + d + 'px;';
    box.innerHTML = '<svg width="' + d + '" height="' + d + '" viewBox="0 0 ' + d + ' ' + d + '" ' +
      'style="transform:rotate(-135deg);overflow:visible">' +
      '<circle cx="' + (d / 2) + '" cy="' + (d / 2) + '" r="' + R + '" fill="none" stroke="rgba(79,140,255,.16)" stroke-width="3"/>' +
      '<circle class="mpr-arc" cx="' + (d / 2) + '" cy="' + (d / 2) + '" r="' + R + '" fill="none" stroke="#4f8cff" stroke-width="3" ' +
      'stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '" ' +
      'style="transition:stroke-dashoffset ' + ms + 'ms linear;filter:drop-shadow(0 0 6px rgba(79,140,255,.95))"/></svg>';
    document.body.appendChild(box);
    RING = box;
    requestAnimationFrame(function () {
      var a = box.querySelector('.mpr-arc');
      if (a) a.setAttribute('stroke-dashoffset', '0');
    });
  }
  /* 长按到底：就地展开这道题的相似题与考点（中心题不动） */
  function longPressNode(n) {
    if (!n) return;
    /* 长按中心题：路径模式下 = 结束路径、转回普通组（用户要的四种切换方式之一） */
    if (n.type === 'center') {
      if (pathIsOn()) { pathToNormal(); return; }
      try { toast('长按中心题：路径模式下会转成普通组'); } catch (eC) {}
      return;
    }
    if (n.type === 'tag') { try { kpOpen(n); } catch (e) {} return; }
    /* 非路径模式：长按不展开相似题（免得一级一级长出二级相似题）；要展开先点 🧭 路径 */
    if (!PATHM.on) {
      try { toast('长按展开只在路径模式里用：先点工具条的 🧭 路径'); } catch (eN) {}
      return;
    }
    try { pathExpand(n); } catch (e) { if (typeof toast === 'function') toast('展开失败：' + (e && e.message)); }
  }

  function bindNodeDrag() {
    var st = $('#mpStage'); if (!st || st.__dgb) return; st.__dgb = 1;
    var d = null;
    /* 拖完浏览器还会补一个 click —— 不吞掉的话，拖节点会误开抽屉、拖画布会误选中 */
    st.addEventListener('click', function (e) {
      if (Date.now() >= CLICK_GUARD) return;
      CLICK_GUARD = 0;
      e.stopPropagation(); e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }, true);
    st.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('.mp-node'); if (!el) return;
      if (e.target.closest('.mp-probe')) return;
      var n = DATA.nodes.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!n) return;
      if (n.pinned) { return; }
      d = { el: el, n: n, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false, cx: e.clientX, cy: e.clientY, raf: 0, lp: 0 };
      /* 鼠标左键按住：进度环；到点展开相似题与考点（短按仍然是打开底部抽屉） */
      if ((e.pointerType === 'mouse' || !e.pointerType) && e.button === 0) {
        ringShow(el, LONG_MS);
        d.lp2 = setTimeout(function () {
          if (!d || d.moved) return;
          var dd = d; d = null;
          ringHide();
          CLICK_GUARD = Date.now() + 1500;
          try { dd.el.classList.remove('dragging'); } catch (err) {}
          longPressNode(dd.n);
        }, LONG_MS);
      }
      /* 触屏没有右键：按住 0.52 秒不动 = 打开节点菜单（iOS 不会为普通元素触发 contextmenu） */
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        d.lp = setTimeout(function () {
          if (!d || d.moved) return;
          var dd = d; d = null;
          try { dd.el.classList.remove('dragging'); } catch (err) {}
          try { ctxShow(dd.cx, dd.cy, dd.n); } catch (err) {}
        }, 520);
      }
      /* 拖的时候必须挂上 .dragging：.mp-node 上有 left/top 的 0.32s 过渡，
         不关掉的话卡片会一路「追」手指，看着就像位置偏了。 */
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }, true);
    st.addEventListener('pointermove', function (e) {
      if (!d) return;
      /* 触摸会合并移动事件，取最后一个点，跟手更紧 */
      var ev = e;
      try { var co = e.getCoalescedEvents && e.getCoalescedEvents(); if (co && co.length) ev = co[co.length - 1]; } catch (err) {}
      d.cx = ev.clientX; d.cy = ev.clientY;
      if (d.lp && (Math.abs(d.cx - d.sx) + Math.abs(d.cy - d.sy)) > 6) { clearTimeout(d.lp); d.lp = 0; }
      if (d.lp2 && (Math.abs(d.cx - d.sx) + Math.abs(d.cy - d.sy)) > 6) { clearTimeout(d.lp2); d.lp2 = 0; ringHide(); }
      var dx = (d.cx - d.sx) / V.k, dy = (d.cy - d.sy) / V.k;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) { d.moved = true; snap(); }
      if (!d.moved) return;
      e.stopPropagation();
      if (d.raf) return;
      d.raf = requestAnimationFrame(function () {
        var dd = d; if (!dd) return;
        dd.raf = 0;
        var ddx = (dd.cx - dd.sx) / V.k, ddy = (dd.cy - dd.sy) / V.k;
        dd.n.x = Math.round(dd.ox + ddx); dd.n.y = Math.round(dd.oy + ddy);
        dd.el.style.left = dd.n.x + 'px'; dd.el.style.top = dd.n.y + 'px';
        drawEdges();
      });
    }, true);
    st.addEventListener('pointerup', function () {
      if (!d) return;
      var moved = d.moved, el = d.el;
      if (d.lp) { clearTimeout(d.lp); d.lp = 0; }
      if (d.lp2) { clearTimeout(d.lp2); d.lp2 = 0; }
      ringHide();
      if (d.raf) { try { cancelAnimationFrame(d.raf); } catch (e) {} }
      d = null;
      el.classList.remove('dragging');
      if (moved) { CLICK_GUARD = Date.now() + 350; try { saveCur(); } catch (e) {} }
    }, true);
    st.addEventListener('pointercancel', function () {
      if (!d) return;
      if (d.lp) { clearTimeout(d.lp); d.lp = 0; }
      if (d.lp2) { clearTimeout(d.lp2); d.lp2 = 0; }
      ringHide();
      if (d.raf) { try { cancelAnimationFrame(d.raf); } catch (e) {} }
      try { d.el.classList.remove('dragging'); } catch (e) {}
      d = null;
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
  /* ===== 站里那套「AI 变式题」面板（variant.js 的 openVariant）挂进脑图窗口 =====
     不再自己造草稿节点：出变式题 = 调库里的同一个功能，生成/保存/对比都在这个面板里。 */
  function varHost() {
    var wrap = $('#mpWrap'); if (!wrap) return null;
    var h = document.getElementById('mpVar');
    if (!h) {
      h = document.createElement('div');
      h.id = 'mpVar';
      wrap.appendChild(h);
    }
    return h;
  }
  function varClose() {
    var h = document.getElementById('mpVar');
    if (h) { h.hidden = true; h.innerHTML = ''; }
    /* 面板里可能刚生成了变式题：收起来时把它们同步到画布上 */
    try { if (syncVariants(true)) { applyLayout(LAY.name); saveCur(); } } catch (eVC) {}
  }
  function openVarPanel(n) {
    if (typeof window.openVariant !== 'function') { toast('变式题模块没加载（variant.js）'); return; }
    var q = (n && n.ref) || (function () {
      var c = DATA.nodes.filter(function (x) { return x.type === 'center'; })[0];
      return c && c.ref;
    })();
    if (!q) { toast('这道题不在题库里，出不了变式'); return; }
    var h = varHost(); if (!h) return;
    /* 抽屉先收起来：变式面板要占右侧一大块，两个叠在一起谁也看不清 */
    try { sideClose(); } catch (eS) {}
    h.hidden = false; h.innerHTML = '';
    try {
      window.openVariant(h, S.bankId + '#' + q.id, q);
    } catch (e) {
      toast('打不开变式题面板：' + (e && e.message));
      return;
    }
    try { winFocus('#mpVar'); } catch (e1) {}
    /* 面板自己的「收起」只清内容，这里顺手把壳也藏起来 */
    var cl = h.querySelector('.vclose');
    if (cl) cl.addEventListener('click', function () { setTimeout(varClose, 0); });
  }

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
    /* 分层模式下，新挂出来的变式题也要按分层排（否则会散在画布上） */
    if (LAY.name === 'layer') { try { applyLayout('layer'); } catch (eL0) { render(); } }
    else render();
    toast('已挂一张「变式草稿」：点开看三种改法（不自动编题目）', 3000);
  }
  /* ===== 现场加题：从题库里挑一道，摆到这张图上（和中心题连一条线） ===== */
  function qAddOpen() {
    var bank = bankById(S.bankId); if (!bank) { toast('题库没打开'); return; }
    var have = {};
    DATA.nodes.forEach(function (m) { if (m.ref && m.ref.id) have[String(m.ref.id)] = 1; });

    /* 有中心题就借 pathNeighbors 的打分，列出「最像的」在前 */
    var scoreMap = {};
    try {
      var cq = (DATA.nodes.filter(function (x) { return x.type === 'center'; })[0] || {}).ref;
      if (cq) pathNeighbors(cq, bank, 9999).forEach(function (it) { scoreMap[String(it.q.id)] = it.score; });
    } catch (eS) {}

    var pool = (bank.questions || []).filter(function (q) { return !have[String(q.id)]; })
      .map(function (q) { return { q: q, sc: scoreMap[String(q.id)] || 0 }; })
      .sort(function (a, b) { return b.sc - a.sc; });

    var ov = document.getElementById('mpQAdd');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'mpQAdd';
      document.body.appendChild(ov);
    }
    function rows(kw) {
      var k = String(kw || '').trim();
      var list = k ? pool.filter(function (it) { return String(it.q.stem || '').indexOf(k) >= 0; }) : pool;
      list = list.slice(0, 80);
      if (!list.length) return '<div class="qa0">' + (pool.length ? '没有匹配的题' : '这张图已经把题库里的题都摆上了') + '</div>';
      return list.map(function (it) {
        return '<div class="qar" data-qid="' + esc(String(it.q.id)) + '">' +
          '<b>' + esc(String(it.q.stem || '').slice(0, 54)) + '</b>' +
          '<i>' + (it.sc ? '相似 ' + Math.round(it.sc * 100) + '%' : '还没算相似度') + '</i></div>';
      }).join('');
    }
    ov.innerHTML =
      '<div class="qac">' +
        '<div class="qah"><b>添加题目到这张图</b><span class="grow"></span>' +
          '<button class="qax" type="button">关闭</button></div>' +
        '<input class="qaq" type="search" placeholder="搜题干里的词…">' +
        '<div class="qal">' + rows('') + '</div>' +
      '</div>';
    ov.classList.add('show');
    var q = ov.querySelector('.qaq'), box = ov.querySelector('.qal');
    q.addEventListener('input', function () { box.innerHTML = rows(q.value); });
    ov.querySelector('.qax').onclick = function () { ov.classList.remove('show'); };
    ov.addEventListener('pointerdown', function (e) { if (e.target === ov) ov.classList.remove('show'); });
    box.addEventListener('click', function (e) {
      var r = e.target.closest('.qar'); if (!r) return;
      var qid = r.dataset.qid;
      var it = pool.filter(function (x) { return String(x.q.id) === String(qid); })[0];
      if (!it) return;
      ov.classList.remove('show');
      addQNode(it.q, it.sc);
    });
    setTimeout(function () { try { q.focus({ preventScroll: true }); } catch (e) {} }, 30);
  }

  /* 把一道题摆到图上：围在中心题外面，自动算角度和半径 */
  function addQNode(q, sc) {
    var c = DATA.nodes.filter(function (x) { return x.type === 'center'; })[0];
    var nSim = DATA.nodes.filter(function (x) { return x.type === 'sim'; }).length;
    var a = -Math.PI / 2 + (Math.PI * 2 / Math.max(4, nSim + 1)) * nSim;
    var n = {
      id: 'q' + q.id, type: 'sim', lv: 1, ref: q,
      score: sc ? Math.round(sc * 100) : null,
      x: (c ? c.x : 0) + Math.cos(a) * 420,
      y: (c ? c.y : 0) + Math.sin(a) * 420
    };
    DATA.nodes.push(n);
    if (c) DATA.edges.push({ a: c.id, b: n.id, kind: 'sim', w: Math.min(0.96, (sc || 0.5)) });
    try { saveCur(); } catch (e1) {}
    try { render(true); } catch (e2) {}
    try { toast('已加到图上：' + String(q.stem || '').slice(0, 16) + '…'); } catch (e3) {}
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
      (isCen && pathIsOn() ? '<button data-c="tonormal">🧭 结束路径（转普通组）</button>' : '') +
      '<button data-c="link">🔗 从这里连线</button>' +
      '<button data-c="pin">' + (n.pinned ? '📌 取消固定' : '📌 固定位置') + '</button>' +
      (isTag ? '<button data-c="kp">📚 打开考点工作台</button>' : '') +
      '<div class="sep"></div>' +
      (isCen ? '<button disabled>🗑 中心题不能删（换个中心题就行）</button>'
             : '<button data-c="del" class="danger">🗑 ' + (isFile ? '从画布移除' : (isQ ? '从图上移除这道题（题库里还在）' : '删除节点')) + '</button>')
    ) : '<button data-c="addq">＋ 添加题目到这张图…</button>' +
        '<button data-c="fit">⛶ 适应窗口</button><button data-c="undo">↶ 撤销</button>';
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
        else if (act === 'addq') { try { qAddOpen(); } catch (e5) {} }
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
          /* 题目节点：AI 解析这道题本身（写进原解析下面），不是去做考点小结 */
          if (n.type !== 'tag') { qAiRun(n); return; }
          var tg2 = (typeof kpTags === 'function' && n.ref) ? kpTags(n.ref) : [];
          if (tg2.length) kpAiOpen(tg2[0]);
          else toast('这道题还没有考点标签，先在答题页打个标签', 2600);
        } catch (e) {}
        return;
      }
      if (act === 'var') {
        try { openVarPanel(n); } catch (e) {}
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
      } else if (act === 'tonormal') {
        pathToNormal();
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
  /* 返回栈：换中心题 / 从考点跳题目之前，先把「看的是哪张图、视口在哪」压栈，
     这样 ← 返回 能退回上一个焦点（点考点 → 跳到题目 → 返回 → 回到考点） */
  var NAV = [];
  function navPush() {
    try {
      NAV.push({ qid: S.qid, gid: G.active, tx: V.tx, ty: V.ty, k: V.k, sel: sel });
      if (NAV.length > 20) NAV.shift();
    } catch (e) {}
  }
  function navBack() {
    if (!NAV.length) return false;
    var s = NAV.pop(), bk = null;
    try { bk = bankById(S.bankId); } catch (e) {}
    if (!bk) return false;
    var q = (bk.questions || []).filter(function (x) { return String(x.id) === String(s.qid); })[0];
    if (!q) return false;
    if (s.gid && s.gid !== G.active) { try { G.active = s.gid; loadGroup(s.gid); } catch (e) {} }
    recenter(q, true);
    V.tx = s.tx; V.ty = s.ty; V.k = s.k;
    try { paintView(); } catch (e) {}
    if (s.sel) {
      var n = DATA.nodes.filter(function (x) { return x.id === s.sel; })[0];
      if (n) {
        sel = n.id; render();
        try { if (n.type === 'tag') kpOpen(n); else sideOpen(n); } catch (e) {}
      }
    }
    return true;
  }

  function back() {
    var kp = document.getElementById('mpKp');
    if (kp && kp.classList.contains('full')) { kpFull(false); return; }
    if (kp && kp.classList.contains('show')) { kpClose(); return; }
    var gp = $('#mpGrp');
    if (gp && gp.classList.contains('show')) { gp.classList.remove('show'); return; }
    /* 还有上一层焦点就退回去，再没有才取消选中 */
    if (navBack()) return;
    if (sel) { sel = null; render(); return; }
    close();
  }

  window.MAPQ = {
    kpOpen: function (n) { kpOpen(n); }, kpClose: kpClose,
    open: open, close: close, toggle: toggle,
    layout: function (k) { applyLayout(k); return LAY.name; },
    /* 调试/自检用：手动放一个进度环、手动触发一次长按展开 */
    ring: function (id, ms) {
      var el = id ? document.querySelector('.mp-node[data-id="' + id + '"]') : document.querySelector('.mp-node');
      ringShow(el, ms || LONG_MS);
      return { ms: ms || LONG_MS, on: !!RING };
    },
    ringOff: function () { ringHide(); return true; },
    longPress: function (id) {
      var n = DATA.nodes.filter(function (x) { return x.id === id; })[0];
      if (!n) return false;
      longPressNode(n);
      return true;
    },
    longMs: function () { return LONG_MS; },
    save: function () { try { saveCur(); } catch (e) { return String(e); } return 'ok'; },
    pathState: function () {
      return {
        on: PATHM.on, isOn: pathIsOn(),
        lv: DATA.nodes.filter(function (n) { return n.lv != null || n.path; }).length
      };
    },
    openFor: openFor,
    nodes: function () { return DATA.nodes.map(function (n) { return { id: n.id, type: n.type, refId: n.refId, xbk: n.xbk || null, label: String(n.label || '').slice(0, 18), opts: (n.ref && n.ref.options || []).length, rid: (n.ref && n.ref.id) || null, rbank: (n.ref && n.ref._bank) || null }; }); },
    groups: function () { return { active: G.active, n: G.list.length, list: G.list.map(function (g) { return { id: g.id, name: g.name, star: !!g.star, n: (g.nodes || []).length }; }) }; },
    newGroup: gNewFromCur,
    state: function () { return { on: S.on, min: S.min, n: DATA.nodes.length, layout: LAY.name, sel: sel, max: isMax() }; }
  };
})();
