/* ============================================================
   diagram.js — 站内 AI 回复里的轻量图表渲染器（离线、无依赖）
   ------------------------------------------------------------
   只做两件事：
     1. 思维导图：缩进大纲 → 左右分叉的树，圆角节点 + 贝塞尔连线
     2. 流程图：mermaid 的一个子集（graph TD/LR、A[文本]、B{判断}、
        A --> B、-->|标签|、-.->、==>），按层排布
   不做：任意 JS、外部请求、eval。输入只当纯文本解析，输出只拼 SVG。

   用法（collection.js 的 mdToHtml 里调）：
     DIAGRAM.render('diagram' | 'mermaid' | 'mindmap', 源码)
     → { html, kind, w, h } | null（解析不了返回 null，调用方降级成源码）
   ============================================================ */
(function () {
  'use strict';

  var FS = 13;          /* 节点字号 */
  var LH = 17;          /* 行高 */
  var PADX = 10;
  var PADY = 8;
  var HGAP = 34;        /* 同层水平间距 */
  var VGAP = 14;        /* 同层垂直间距 */
  var COL_GAP = 64;     /* 流程图层间距 */
  var ROW_GAP = 42;
  var uid = 0;
  var CACHE = {};       /* key → { w, h, body }，body 里用 __MID__ 占位 marker id */
  var CACHE_N = 0;
  var SRC = {};         /* hash → 源码，给「复制源码」用 */

  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  /* 宽度按「全角 2、半角 1」估，够排版用，不需要真的量字 */
  function units(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n += (s.charCodeAt(i) >= 0x2e80 ? 2 : 1);
    return n;
  }
  function wrapLabel(s, maxUnits) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!s) return [''];
    var lines = [], cur = '', w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), u = units(ch);
      if (w + u > maxUnits && cur) { lines.push(cur); cur = ''; w = 0; }
      cur += ch; w += u;
    }
    if (cur) lines.push(cur);
    /* 末行只剩一个字（全角 1 单位）就并回上一行，别让节点里挂个孤字 */
    if (lines.length > 1 && lines[lines.length - 1].length <= 1) {
      lines[lines.length - 2] += lines.pop();
    }
    if (lines.length > 3) {
      lines = lines.slice(0, 3);
      lines[2] = lines[2].slice(0, Math.max(1, lines[2].length - 1)) + '…';
    }
    return lines;
  }
  function measureLabel(text, maxUnits) {
    var lines = wrapLabel(text, maxUnits), maxU = 0;
    lines.forEach(function (l) { maxU = Math.max(maxU, units(l)); });
    return {
      lines: lines,
      w: Math.max(58, Math.min(240, maxU * 6.9 + PADX * 2)),
      h: Math.max(32, lines.length * LH + PADY * 2)
    };
  }

  /* ---------------- SVG 原子 ---------------- */
  function textEl(x, y, lines) {
    var top = y - (lines.length - 1) * LH / 2;
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      out += '<text class="dgm-t" x="' + r1(x) + '" y="' + r1(top + i * LH) + '"'
        + ' text-anchor="middle" dominant-baseline="central">' + esc(lines[i]) + '</text>';
    }
    return out;
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  function shapeEl(n, cls) {
    var x = n.x - n.w / 2, y = n.y - n.h / 2;
    var out = '';
    if (n.shape === 'decision') {
      out += '<polygon class="' + cls + '" points="'
        + r1(n.x) + ',' + r1(y) + ' ' + r1(x + n.w) + ',' + r1(n.y) + ' '
        + r1(n.x) + ',' + r1(y + n.h) + ' ' + r1(x) + ',' + r1(n.y) + '"/>';
    } else if (n.shape === 'circle') {
      out += '<ellipse class="' + cls + '" cx="' + r1(n.x) + '" cy="' + r1(n.y) + '"'
        + ' rx="' + r1(n.w / 2) + '" ry="' + r1(n.h / 2) + '"/>';
    } else {
      var rx = n.shape === 'stadium' ? n.h / 2 : (n.shape === 'round' ? 14 : 9);
      out += '<rect class="' + cls + '" x="' + r1(x) + '" y="' + r1(y) + '"'
        + ' width="' + r1(n.w) + '" height="' + r1(n.h) + '" rx="' + r1(rx) + '"/>';
    }
    return out;
  }

  function linkEl(d, style) {
    var cls = 'dgm-link' + (style && style !== 'solid' ? (' ' + style) : '');
    var mk = style === 'open' ? '' : ' marker-end="url(#__MID__)"';
    return '<path class="' + cls + '" d="' + d + '"' + mk + '/>';
  }

  function svgDoc(w, h, body) {
    var mid = 'dgmA' + (++uid);
    var defs = '<defs><marker id="' + mid + '" viewBox="0 0 10 10" refX="9" refY="5"'
      + ' markerWidth="7" markerHeight="7" orient="auto">'
      + '<path class="dgm-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>';
    return '<svg class="dgm-svg" viewBox="0 0 ' + Math.ceil(w) + ' ' + Math.ceil(h) + '"'
      + ' width="' + Math.ceil(w) + '" height="' + Math.ceil(h) + '" role="img">'
      + defs + '<g>' + body.replace(/__MID__/g, mid) + '</g></svg>';
  }

  function card(kind, src, svg) {
    var key = 's' + hash(kind + '\u0000' + src);
    SRC[key] = src;
    if (Object.keys(SRC).length > 160) SRC = {};
    return '<div class="dgm-card" data-dgm="' + kind + '">'
      + '<div class="dgm-head"><span class="dgm-kind">'
      + (kind === 'mind' ? '🧠 思维导图' : '🧭 流程图') + '</span>'
      + '<button type="button" class="dgm-copy" data-dgm-copy="' + key + '">复制源码</button>'
      + '</div><div class="dgm-body">' + svg + '</div></div>';
  }

  /* ============================================================
     思维导图：缩进 / 列表 / # 标题 → 左右分叉的树
     ============================================================ */
  function stripShape(t) {
    var n = 0;
    while (n < 3 && /^[\(\[]/.test(t) && /[\)\]]$/.test(t) && t.length > 2) {
      t = t.slice(1, -1).trim(); n++;
    }
    return t;
  }
  /* mermaid 的节点写法：root((文字)) / A[文字] / B{判断} —— 以前只剥括号不剥 id，
     「root(("合成酶"))」整串被当成标签画进框里（用户报「思维导图变成源码」）。 */
  function mindLabel(t) {
    var s = String(t == null ? '' : t).trim();
    var P = '(?:[A-Za-z_][\\w\\-]*)?\\s*';
    var forms = [
      new RegExp('^' + P + '\\(\\(([\\s\\S]*)\\)\\)$'),
      new RegExp('^' + P + '\\[\\[([\\s\\S]*)\\]\\]$'),
      new RegExp('^' + P + '\\[\\(' + '([\\s\\S]*)\\)\\]$'),
      new RegExp('^' + P + '\\{\\{([\\s\\S]*)\\}\\}$'),
      new RegExp('^' + P + '\\[([\\s\\S]*)\\]$'),
      new RegExp('^' + P + '\\(([\\s\\S]*)\\)$'),
      new RegExp('^' + P + '\\{([\\s\\S]*)\\}$')
    ];
    for (var k = 0; k < 3; k++) {
      var done = false;
      for (var j = 0; j < forms.length; j++) {
        var m = forms[j].exec(s);
        if (m && m[1] && m[1].trim()) { s = m[1].trim(); done = true; break; }
      }
      if (!done) break;
    }
    s = s.replace(/^["'“”]+/, '').replace(/["'“”]+$/, '').trim();
    return stripShape(s);
  }

  function parseMindRows(src) {
    var rows = [];
    var lines = String(src || '').replace(/\r/g, '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].replace(/\t/g, '  ');
      if (!raw.trim()) continue;
      if (/^\s*%%/.test(raw)) continue;
      if (/^\s*mindmap\b/i.test(raw)) continue;
      var indent = raw.match(/^\s*/)[0].length;
      var t = raw.trim();
      var hm = /^(#+)\s*(.+)$/.exec(t);
      if (hm) { t = hm[2]; indent = (hm[1].length - 1) * 2; }
      t = t.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
      t = mindLabel(t);
      if (!t) continue;
      rows.push({ indent: indent, text: t });
    }
    return rows;
  }

  function buildMind(src) {
    var rows = parseMindRows(src);
    if (!rows.length) return null;

    var step = 0;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i].indent > 0) step = step ? Math.min(step, rows[i].indent) : rows[i].indent;
    }
    if (!step) step = 2;

    var root = { text: rows[0].text, depth: 0, children: [], dir: 0 };
    var stack = [root];
    for (i = 1; i < rows.length; i++) {
      var d = Math.max(1, Math.round(rows[i].indent / step));
      while (stack.length > d) stack.pop();
      if (stack.length < d) d = stack.length;
      var parent = stack[stack.length - 1] || root;
      var node = { text: rows[i].text, depth: d, children: [], dir: 0 };
      parent.children.push(node);
      stack.push(node);
    }

    /* 尺寸：子树高度自下而上 */
    function measure(n) {
      var mm = measureLabel(n.text, 13);
      n.lines = mm.lines; n.w = mm.w; n.h = mm.h;
      if (!n.children.length) { n.sh = n.h; return; }
      var total = 0;
      n.children.forEach(function (c) { measure(c); total += c.sh + VGAP; });
      n.sh = Math.max(n.h, total - VGAP);
    }
    measure(root);

    /* 根节点左右分叉：按子树高度贪心，哪边矮放哪边 */
    var sides = { 1: [], '-1': [] }, sideH = { 1: 0, '-1': 0 };
    root.children.forEach(function (c) {
      var dir = sideH[1] <= sideH[-1] ? 1 : -1;
      c.dir = dir; sides[dir].push(c);
      sideH[dir] += c.sh + VGAP;
    });

    function place(n, cx, cy, dir) {
      n.x = cx; n.y = cy;
      if (!n.children.length) return;
      var total = 0;
      n.children.forEach(function (c) { c.dir = dir; total += c.sh + VGAP; });
      total -= VGAP;
      var cur = cy - total / 2;
      n.children.forEach(function (c) {
        var ccy = cur + c.sh / 2;
        cur += c.sh + VGAP;
        var ccx = dir > 0 ? (cx + n.w / 2 + HGAP + c.w / 2) : (cx - n.w / 2 - HGAP - c.w / 2);
        place(c, ccx, ccy, dir);
      });
    }
    place(root, 0, 0, 1);

    [1, -1].forEach(function (dir) {
      var arr = sides[dir];
      if (!arr.length) return;
      var total = 0;
      arr.forEach(function (c) { total += c.sh + VGAP; });
      total -= VGAP;
      var cur = -total / 2;
      arr.forEach(function (c) {
        var cy = cur + c.sh / 2;
        cur += c.sh + VGAP;
        var cx = dir > 0 ? (root.w / 2 + HGAP + c.w / 2) : (-root.w / 2 - HGAP - c.w / 2);
        place(c, cx, cy, dir);
      });
    });

    var all = [];
    (function walk(n) { all.push(n); n.children.forEach(walk); })(root);

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (n) {
      minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2); maxY = Math.max(maxY, n.y + n.h / 2);
    });
    var dx = 14 - minX, dy = 14 - minY;
    all.forEach(function (n) { n.x += dx; n.y += dy; });

    var body = '';
    (function drawLinks(n) {
      n.children.forEach(function (c) {
        var dir = c.dir || 1;
        var x1 = n.x + dir * n.w / 2, y1 = n.y;
        var x2 = c.x - dir * c.w / 2, y2 = c.y;
        var mx = (x1 + x2) / 2;
        body += linkEl('M' + r1(x1) + ' ' + r1(y1) + ' C' + r1(mx) + ' ' + r1(y1)
          + ' ' + r1(mx) + ' ' + r1(y2) + ' ' + r1(x2) + ' ' + r1(y2), 'solid');
        drawLinks(c);
      });
    })(root);

    all.slice().sort(function (a, b) { return a.depth - b.depth; }).forEach(function (n) {
      body += shapeEl(n, 'dgm-n d' + Math.min(n.depth, 3));
      body += textEl(n.x, n.y, n.lines);
    });

    return { w: maxX - minX + 28, h: maxY - minY + 28, body: body };
  }

  /* ============================================================
     流程图：mermaid 子集
       graph TD / LR（TB 当 TD，RL 当 LR）
       A[矩形] A(圆角) A([胶囊]) A((圆)) A{菱形}
       A --> B   A -.-> B   A ==> B   A -->|是| B   A -- 是 --> B
     ============================================================ */
  var CLOSERS = { '[[': ']]', '[(': ')]', '([': ')]', '((': '))', '{{': '}}', '[': ']', '(': ')', '{': '}' };
  var SHAPES = { '[[': 'rect', '[(': 'stadium', '([': 'stadium', '((': 'circle', '{{': 'decision', '[': 'rect', '(': 'round', '{': 'decision' };

  function readBracket(s, i) {
    var k = null, two = s.substr(i, 2);
    if (CLOSERS[two]) k = two;
    else if (CLOSERS[s.charAt(i)]) k = s.charAt(i);
    if (!k) return null;
    var close = CLOSERS[k];
    var start = i + k.length;
    var end = s.indexOf(close, start);
    if (end < 0) return null;
    var text = s.slice(start, end).replace(/^["']|["']$/g, '').trim();
    return { text: text, shape: SHAPES[k], end: end + close.length };
  }

  function readNode(s, i) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    var rest = s.slice(i), m = /^[A-Za-z0-9_\u4e00-\u9fff]+/.exec(rest);
    if (!m) return null;
    var id = m[0]; i += id.length;
    var j = i;
    while (j < s.length && s.charAt(j) === ' ') j++;
    var label = null, shape = 'rect';
    if (s.charAt(j) === '[' || s.charAt(j) === '(' || s.charAt(j) === '{') {
      var br = readBracket(s, j);
      if (br) { label = br.text; shape = br.shape; i = br.end; }
    }
    return { id: id, label: label == null ? id : label, shape: shape, end: i };
  }

  function readEdge(s, i) {
    var skip = 0;
    while (i + skip < s.length && /\s/.test(s.charAt(i + skip))) skip++;
    var t = s.slice(i + skip), m;
    var endAt = function (len) { return i + skip + len; };

    /* 标签写在箭头前面：-- 是 --> */
    m = /^--\s*([^-\s][^>]*?)\s*--+>/.exec(t);
    if (m) return { label: m[1].trim(), style: 'solid', end: endAt(m[0].length) };
    m = /^-\.\s*(.+?)\s*\.->/.exec(t);
    if (m) return { label: m[1].trim(), style: 'dotted', end: endAt(m[0].length) };
    m = /^==\s*(.+?)\s*==>/.exec(t);
    if (m) return { label: m[1].trim(), style: 'thick', end: endAt(m[0].length) };

    /* 标签写在箭头后面：-->|是| */
    m = /^(---->|--->|-->|-\.->|==>|---|-\.-|===)\s*(?:\|\s*([^|]*?)\s*\|)?/.exec(t);
    if (!m) return null;
    var arrow = m[1];
    var style = /^-\./.test(arrow) ? 'dotted' : (/^=/.test(arrow) ? 'thick' : (/^-{3}$/.test(arrow) ? 'open' : 'solid'));
    return { label: (m[2] || '').trim(), style: style, end: endAt(m[0].length) };
  }

  function buildFlow(src) {
    var nodes = {}, order = [], edges = [], dir = 'TD';

    function addNode(id, label, shape) {
      var n = nodes[id];
      if (!n) {
        n = nodes[id] = { id: id, label: label || id, shape: shape || 'rect' };
        order.push(id);
      } else if (label && label !== id) {
        n.label = label;
        if (shape) n.shape = shape;
      }
      return n;
    }

    function parseChain(line) {
      var i = 0, first = readNode(line, i);
      if (!first) return;
      i = first.end;
      var prev = addNode(first.id, first.label, first.shape), guard = 0;
      while (i < line.length && guard++ < 80) {
        var e = readEdge(line, i);
        if (!e) break;
        i = e.end;
        var nx = readNode(line, i);
        if (!nx) break;
        i = nx.end;
        var cur = addNode(nx.id, nx.label, nx.shape);
        if (prev.id !== cur.id) edges.push({ a: prev.id, b: cur.id, label: e.label, style: e.style });
        prev = cur;
      }
    }

    var lines = String(src || '').replace(/\r/g, '').split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line || /^%%/.test(line)) continue;
      if (/^(graph|flowchart)\b/i.test(line)) {
        var dm = /^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/i.exec(line);
        if (dm) dir = /^(LR|RL)$/i.test(dm[1]) ? 'LR' : 'TD';
        line = line.replace(/^(?:graph|flowchart)\s*(?:TD|TB|LR|RL|BT)?\s*/i, '').trim();
        if (!line) continue;
      }
      if (/^(subgraph|end|style|classDef|class|linkStyle|click|direction|accTitle|accDescr)\b/i.test(line)) continue;
      line = line.replace(/;+\s*$/, '');
      parseChain(line);
    }

    if (!order.length) return null;
    if (order.length > 60) return null;   /* 太大的图不硬排，降级成源码 */

    order.forEach(function (id) {
      var n = nodes[id], mm = measureLabel(n.label, 14);
      n.lines = mm.lines;
      n.w = mm.w + (n.shape === 'decision' ? 14 : 0);
      n.h = n.shape === 'decision' ? Math.max(mm.h + 10, 46) : mm.h;
    });

    /* 分层：最长路径；有环就忽略回边 */
    var inc = {}, rank = {};
    edges.forEach(function (e) { (inc[e.b] = inc[e.b] || []).push(e.a); });
    function rankOf(id, seen) {
      if (rank[id] != null) return rank[id];
      if (seen[id]) return 0;
      seen[id] = 1;
      var best = 0;
      (inc[id] || []).forEach(function (u) { best = Math.max(best, rankOf(u, seen) + 1); });
      seen[id] = 0;
      rank[id] = Math.min(best, 24);
      return rank[id];
    }
    order.forEach(function (id) { rankOf(id, {}); });

    var byRank = [];
    order.forEach(function (id) {
      var r = rank[id] || 0;
      (byRank[r] = byRank[r] || []).push(id);
    });
    for (var r = 0; r < byRank.length; r++) if (!byRank[r]) byRank[r] = [];

    /* 中位数法走两遍，减少连线交叉 */
    var pos = {};
    function reindex() {
      byRank.forEach(function (ids) { ids.forEach(function (id, k) { pos[id] = k; }); });
    }
    reindex();
    for (var pass = 0; pass < 2; pass++) {
      byRank.forEach(function (ids, ri) {
        if (ri === 0 || ids.length < 2) return;
        var key = {};
        ids.forEach(function (id, k) {
          var ps = (inc[id] || []).map(function (u) { return pos[u] != null ? pos[u] : k; });
          key[id] = ps.length ? ps.reduce(function (a, b) { return a + b; }, 0) / ps.length : k;
        });
        ids.sort(function (a, b) { return key[a] - key[b]; });
      });
      reindex();
    }

    /* 坐标 */
    var rowsW = [], rowsH = [], colsW = [], colsH = [];
    byRank.forEach(function (ids, ri) {
      var w = 0, h = 0;
      ids.forEach(function (id) { w += nodes[id].w + COL_GAP; h = Math.max(h, nodes[id].h); });
      rowsW[ri] = Math.max(0, w - COL_GAP);
      rowsH[ri] = h;
      var cw = 0, ch = 0;
      ids.forEach(function (id) { cw = Math.max(cw, nodes[id].w); ch += nodes[id].h + VGAP; });
      colsW[ri] = cw;
      colsH[ri] = Math.max(0, ch - VGAP);
    });

    if (dir === 'LR') {
      var cx = 16;
      byRank.forEach(function (ids, ri) {
        var colW = colsW[ri], colH = colsH[ri];
        var y = -colH / 2;
        ids.forEach(function (id) {
          var n = nodes[id];
          n.x = cx + colW / 2;
          n.y = y + n.h / 2;
          y += n.h + VGAP;
        });
        cx += colW + COL_GAP;
      });
    } else {
      var cy = 16;
      byRank.forEach(function (ids, ri) {
        var rowW = rowsW[ri], rowH = rowsH[ri];
        var x = -rowW / 2;
        ids.forEach(function (id) {
          var n = nodes[id];
          n.x = x + n.w / 2;
          n.y = cy + rowH / 2;
          x += n.w + COL_GAP;
        });
        cy += rowH + ROW_GAP;
      });
    }

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    order.forEach(function (id) {
      var n = nodes[id];
      minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2); maxY = Math.max(maxY, n.y + n.h / 2);
    });
    var ox = 16 - minX, oy = 16 - minY;
    order.forEach(function (id) { nodes[id].x += ox; nodes[id].y += oy; });

    var body = '';
    edges.forEach(function (e) {
      var a = nodes[e.a], b = nodes[e.b];
      var x1, y1, x2, y2, d;
      if (dir === 'LR') {
        var right = a.x <= b.x;
        x1 = a.x + (right ? a.w / 2 : -a.w / 2); y1 = a.y;
        x2 = b.x + (right ? -b.w / 2 : b.w / 2); y2 = b.y;
        var mx = (x1 + x2) / 2;
        d = 'M' + r1(x1) + ' ' + r1(y1) + ' C' + r1(mx) + ' ' + r1(y1)
          + ' ' + r1(mx) + ' ' + r1(y2) + ' ' + r1(x2) + ' ' + r1(y2);
      } else {
        var down = a.y <= b.y;
        x1 = a.x; y1 = a.y + (down ? a.h / 2 : -a.h / 2);
        x2 = b.x; y2 = b.y + (down ? -b.h / 2 : b.h / 2);
        var my = (y1 + y2) / 2;
        d = 'M' + r1(x1) + ' ' + r1(y1) + ' C' + r1(x1) + ' ' + r1(my)
          + ' ' + r1(x2) + ' ' + r1(my) + ' ' + r1(x2) + ' ' + r1(y2);
      }
      body += linkEl(d, e.style);
      if (e.label) {
        var lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
        var lw = Math.max(22, units(e.label) * 6.2 + 8);
        body += '<rect class="dgm-elabelbg" x="' + r1(lx - lw / 2) + '" y="' + r1(ly - 8) + '"'
          + ' width="' + r1(lw) + '" height="16" rx="4"/>'
          + '<text class="dgm-elabel" x="' + r1(lx) + '" y="' + r1(ly) + '"'
          + ' text-anchor="middle" dominant-baseline="central">' + esc(e.label) + '</text>';
      }
    });

    order.forEach(function (id) {
      var n = nodes[id];
      body += shapeEl(n, 'dgm-n d' + Math.min(rank[id] || 0, 3));
      body += textEl(n.x, n.y, n.lines);
    });

    return { w: maxX - minX + 32, h: maxY - minY + 32, body: body };
  }

  /* ---------------- 对外入口 ---------------- */
  function build(kind, src) {
    var key = kind + '\u0000' + src;
    var hit = CACHE[key];
    if (hit) return hit;
    var out = kind === 'mind' ? buildMind(src) : buildFlow(src);
    if (!out) return null;
    if (++CACHE_N > 80) { CACHE = {}; CACHE_N = 1; }
    CACHE[key] = out;
    return out;
  }

  function render(lang, src) {
    var l = String(lang || '').toLowerCase();
    var text = String(src == null ? '' : src).replace(/\r/g, '').replace(/\s+$/, '');
    if (!text.trim()) return null;

    var kind = (l === 'mindmap' || l === 'mind') ? 'mind' : 'flow';
    if (l === 'mermaid') {
      if (/^\s*mindmap\b/im.test(text)) { kind = 'mind'; text = text.replace(/^\s*mindmap\b[^\n]*\n?/i, ''); }
      else if (!/^\s*(graph|flowchart)\b/im.test(text)) return null;
    } else if (l !== 'mindmap' && l !== 'mind') {
      /* diagram 不写语言时看内容：有箭头就是流程图，否则当缩进大纲 */
      if (/^\s*(graph|flowchart)\b/im.test(text)) kind = 'flow';
      else kind = /-->|-\.->|==>|->/.test(text) ? 'flow' : 'mind';
      if (kind === 'flow') text = text.replace(/^\s*(graph|flowchart)\s*(?:TD|TB|LR|RL|BT)?\s*\n?/im, '');
    }

    var out = build(kind, text);
    if (!out) return null;
    var svg = svgDoc(out.w, out.h, out.body);
    return { html: card(kind, String(src || ''), svg), kind: kind, w: out.w, h: out.h };
  }

  /* 复制源码：事件委托，不依赖调用方绑事件 */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-dgm-copy]') : null;
    if (!btn) return;
    var src = SRC[btn.getAttribute('data-dgm-copy')] || '';
    var done = function (ok) {
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(src).then(function () { done(true); }, function () { done(false); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = src; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) {}
        document.body.removeChild(ta);
        done(ok);
      }
    } catch (e3) { done(false); }
  });

  window.DIAGRAM = { render: render, buildMind: buildMind, buildFlow: buildFlow };
})();
