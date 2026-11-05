/* 批注 / 空白板：一套画板，两种底图
   · 批注：覆盖在题目卡片上的透明层，笔迹按 「题库id#题id」 存 localStorage，下次打开自动叠回
   · 白板：一张空白画布，成品进「手稿历史」（最多 30 张，可再打开 / 删除）
   存的是矢量笔迹（不是截图），所以换屏、缩放都清晰，体积也小；只有导入的图片会存成压缩后的 dataURL。

   对外：INK.paint(bank,q)      画回这道题的笔迹（每题重画后调用）
        INK.annotation(bank,q) 打开批注
        INK.board()            打开空白板
        INK.hasInk(bank,q)     这道题有没有笔迹
        INK.pngOf(bank,q)      把笔迹画成透明 PNG（导出时用）
*/
(function () {
  'use strict';
  var INK_KEY = 'qbank.ink.v1';
  /* 实时圈画：批注只在内存里，刷新/关页就没了（不再写 localStorage） */
  var INK_MEM = {};

  /* 一次性迁移：批注改成「实时圈画、不保存」之后，把以前存下来的老批注全清掉，
     否则旧笔迹会一直叠在题目上（用户已确认要清） */
  (function () {
    try {
      var WIPE = 'qbank.ink.wiped.v2';
      if (!localStorage.getItem(WIPE)) {
        localStorage.removeItem(INK_KEY);
        localStorage.setItem(WIPE, '1');
      }
    } catch (e) {}
  })();
  var BOARD_KEY = 'qbank.board.v1';
  var COLORS = ['#111827', '#e11d48', '#f59e0b', '#0f9d58', '#2563eb', '#7c3aed'];
  /* 深色主题下纯黑笔画看不见：默认笔色跟随当前正文色（浅色主题=深灰，深色主题=浅灰） */
  function inkAuto() {
    try {
      var c = getComputedStyle(document.body).color || '';
      if (/rgba?\(/.test(c)) return c;
      if (/^#/.test(c)) return c;
    } catch (e) {}
    return '#111827';
  }
  var SHAPES = { line: 1, rect: 1, ellipse: 1, arrow: 1 };
  var MAX_BOARDS = 30;

  function lsGet(k, dflt) {
    try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function keyOf(bank, q) { return String(bank.id) + '#' + String(q.id); }
  function inkAll() { var o = lsGet(INK_KEY, {}); return (o && typeof o === 'object') ? o : {}; }
  function boardAll() { var a = lsGet(BOARD_KEY, []); return Array.isArray(a) ? a : []; }

  /* ---------- 画 ---------- */
  var repaintAll = null;   /* 图片解码完成后触发一次重画（view 层没有 Studio 实例） */

  function fontOf(o, scale) { return '600 ' + Math.round((14 + o.s * 2.2) * scale) + 'px system-ui,"Microsoft YaHei",sans-serif'; }

  function textMetrics(o) {
  if (!o.w) o.w = 1e6;   /* 没给框宽就当作不换行，避免 NaN 让文字一行都排不出来 */
    var c = document.createElement('canvas').getContext('2d');
    c.font = fontOf(o, 1);
    var lines = [];
    String(o.txt || '').split('\n').forEach(function (L) {
      if (!(o.w > 10)) { lines.push(L); return; }
      var line = '';
      for (var i = 0; i < L.length; i++) {
        var nxt = line + L.charAt(i);
        if (line && c.measureText(nxt).width > o.w) { lines.push(line); line = L.charAt(i); }
        else line = nxt;
      }
      lines.push(line);
    });
    var mw = 0; lines.forEach(function (L) { mw = Math.max(mw, c.measureText(L).width); });
    return { lines: lines, w: (o.w > 10 ? o.w : mw), h: (14 + o.s * 2.2) * 1.35 * lines.length };
  }

  /* ---------- 几何：任何一笔的外接框（模块级，导出/缩略图/选择都要用） ---------- */
  function boxOf(o) {
    if (!o) return { x: 0, y: 0, w: 0, h: 0 };
    if (o.t === 'img') {
      var w = o.w || 200, h = w * ((o._el && o._el.naturalWidth) ? (o._el.naturalHeight / o._el.naturalWidth) : 0.6);
      return { x: o.p[0][0], y: o.p[0][1], w: w, h: h };
    }
    if (o.t === 'text') { var tm = textMetrics(o); return { x: o.p[0][0], y: o.p[0][1], w: tm.w, h: tm.h }; }
    var p = o.p || [], x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, i;
    for (i = 0; i < p.length; i++) {
      if (p[i][0] < x0) x0 = p[i][0];
      if (p[i][0] > x1) x1 = p[i][0];
      if (p[i][1] < y0) y0 = p[i][1];
      if (p[i][1] > y1) y1 = p[i][1];
    }
    if (x0 > x1) return { x: 0, y: 0, w: 0, h: 0 };
    var pad = Math.max(5, (o.s || 2) * (o.t === 'hl' ? 2.2 : 0.9));
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  /* ---------- 自由笔迹引擎 ----------
     思路取自 Excalidraw 的 freedraw：把指针轨迹重采样成等距点，按「压力/速度」给每点算粗细，
     再沿法线左右各偏一份，围成一条闭合轮廓一次性填充，最后用二次贝塞尔把拐点磨圆。
     比直接 stroke 折线顺滑得多，起笔收笔还自带尖锋。老数据（点里没有第三位压力值）也照样能画。 */
  var FR_SMOOTH = 0.55;     /* 追踪平滑：越小越贴手，越大越顺滑（Excalidraw 默认 0.5） */
  var FR_STEP = 1.6;        /* 重采样步长（px） */
  var FR_TAPER = 3;         /* 起收笔各用几个点收尖 */

  function resample(p, step) {
    if (!p || !p.length) return [];
    if (p.length === 1) return [[p[0][0], p[0][1], p[0][2] == null ? 1 : p[0][2]]];
    var out = [[p[0][0], p[0][1], p[0][2] == null ? 1 : p[0][2]]];
    var next = step, i;
    for (i = 1; i < p.length; i++) {
      var a = p[i - 1], b = p[i];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var d = Math.sqrt(dx * dx + dy * dy);
      var fa = a[2] == null ? 1 : a[2], fb = b[2] == null ? fa : b[2];
      if (d < 1e-6) continue;
      var pos = 0;
      while (pos + next <= d) {
        pos += next; next = step;
        var t = pos / d;
        out.push([a[0] + dx * t, a[1] + dy * t, fa + (fb - fa) * t]);
      }
      next -= (d - pos);
      if (next < 0.01) next = step;
    }
    var lp = p[p.length - 1], last = out[out.length - 1];
    if (Math.abs(lp[0] - last[0]) > 0.4 || Math.abs(lp[1] - last[1]) > 0.4) {
      out.push([lp[0], lp[1], lp[2] == null ? 1 : lp[2]]);
    }
    return out;
  }

  /* 把一串点画成「经过各点的圆滑曲线」（中线过控制点、线段中点做锚点） */
  function traceSmooth(ctx, arr, cont) {
    var n = arr.length;
    if (!n) return;
    if (cont) ctx.lineTo(arr[0][0], arr[0][1]); else ctx.moveTo(arr[0][0], arr[0][1]);
    if (n === 1) return;
    if (n === 2) { ctx.lineTo(arr[1][0], arr[1][1]); return; }
    for (var i = 1; i < n - 1; i++) {
      var mx = (arr[i][0] + arr[i + 1][0]) / 2, my = (arr[i][1] + arr[i + 1][1]) / 2;
      ctx.quadraticCurveTo(arr[i][0], arr[i][1], mx, my);
    }
    ctx.quadraticCurveTo(arr[n - 1][0], arr[n - 1][1], arr[n - 1][0], arr[n - 1][1]);
  }

  function widthAt(i, n, sz, f) {
    var edge = Math.min(i, n - 1 - i);
    var taper = edge >= FR_TAPER ? 1 : 0.42 + 0.58 * (edge / FR_TAPER);
    return Math.max(0.28, (sz / 2) * taper * (0.45 + 0.55 * f));
  }

  /* 一笔画成「面」：sz 是视觉笔宽（px），butt=true 时不加圆头（荧光笔要的是平头） */
  function freehandFill(ctx, pts, sz, color, alpha, sx, sy, butt) {
    var raw = [], i;
    for (i = 0; i < pts.length; i++) raw.push([pts[i][0] * sx, pts[i][1] * sy, pts[i][2] == null ? 1 : pts[i][2]]);
    var q = resample(raw, Math.max(1, FR_STEP * Math.min(sx, sy)));
    if (!q.length) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    if (q.length < 3) {
      ctx.beginPath();
      ctx.arc(q[0][0], q[0][1], Math.max(0.4, sz / 2), 0, Math.PI * 2);
      ctx.fill(); ctx.restore(); return;
    }
    var N = q.length, lf = [], rt = [];
    for (i = 0; i < N; i++) {
      var a = q[i > 0 ? i - 1 : 0], b = q[i < N - 1 ? i + 1 : N - 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var L = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / L, ny = dx / L;
      var r = widthAt(i, N, sz, q[i][2]);
      lf.push([q[i][0] + nx * r, q[i][1] + ny * r]);
      rt.push([q[i][0] - nx * r, q[i][1] - ny * r]);
    }
    ctx.beginPath();
    traceSmooth(ctx, lf, false);
    ctx.lineTo(rt[N - 1][0], rt[N - 1][1]);
    var rev = [];
    for (i = N - 1; i >= 0; i--) rev.push(rt[i]);
    traceSmooth(ctx, rev, true);
    ctx.closePath();
    ctx.fill();
    if (!butt) {
      ctx.beginPath();
      ctx.arc(q[0][0], q[0][1], widthAt(0, N, sz, q[0][2]), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(q[N - 1][0], q[N - 1][1], widthAt(N - 1, N, sz, q[N - 1][2]), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOp(ctx, o, sx, sy) {
    sx = sx || 1; sy = sy || 1;
    if (!o) return;
    if (o.t === 'text') {
      ctx.save();
      if (!o.c) o.c = '#111827';
      ctx.fillStyle = o.c; ctx.globalAlpha = o.a == null ? 1 : o.a;
      var fs = Math.round((14 + o.s * 2.2) * sx);
      ctx.font = fontOf(o, sx); ctx.textBaseline = 'top';
      var lines = String(o.txt || '').split('\n');
      var lh = fs * 1.35;
      var out = [];
      lines.forEach(function (L) {
        if (!(o.w > 10)) { out.push(L); return; }
        var line = '';
        for (var wi = 0; wi < L.length; wi++) {
          var nxt = line + L.charAt(wi);
          if (line && ctx.measureText(nxt).width > o.w * sx) { out.push(line); line = L.charAt(wi); }
          else line = nxt;
        }
        out.push(line);
      });
      if (o.bg) {
        var mw = 0;
        out.forEach(function (L) { mw = Math.max(mw, ctx.measureText(L).width); });
        ctx.save();
        ctx.globalAlpha = (o.ba == null ? 1 : o.ba) * (o.a == null ? 1 : o.a);
        ctx.fillStyle = o.bg;
        ctx.fillRect(o.p[0][0] * sx - 4 * sx, o.p[0][1] * sy - 2 * sy, mw + 8 * sx, lh * out.length + 4 * sy);
        ctx.restore();
      }
      out.forEach(function (L, li) {
        ctx.fillText(L, o.p[0][0] * sx, o.p[0][1] * sy + li * lh);
      });
      ctx.restore(); return;
    }
    if (o.t === 'img') {
      if (!o._el && o.data) {
        var im0 = new Image();
        im0.onload = function () { if (repaintAll) repaintAll(); };
        im0.src = o.data; o._el = im0;
      }
      if (o._el && o._el.complete && o._el.naturalWidth) {
        ctx.save(); ctx.globalAlpha = o.a == null ? 1 : o.a;
        var w = o.w * sx, h = w * (o._el.naturalHeight / o._el.naturalWidth || 0.6);
        ctx.drawImage(o._el, o.p[0][0] * sx, o.p[0][1] * sy, w, h);
        ctx.restore();
      }
      return;
    }
    var p = o.p || []; if (!p.length) return;
    var k = (sx + sy) / 2;
    var W = Math.max(0.8, (o.s || 2) * k);
    var col = o.c || '#111827';
    var al = (o.a == null ? 1 : o.a);

    if (o.t === 'eraser') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(12, W * 3);
      ctx.beginPath();
      ctx.moveTo(p[0][0] * sx, p[0][1] * sy);
      for (var ei = 1; ei < p.length; ei++) ctx.lineTo(p[ei][0] * sx, p[ei][1] * sy);
      ctx.stroke();
      ctx.restore(); return;
    }
    if (o.t === 'hl') { freehandFill(ctx, p, Math.max(12, W * 4), col, Math.min(0.42, al), sx, sy, true); return; }
    if (o.t === 'pencil') { freehandFill(ctx, p, Math.max(0.8, W * 0.82), col, Math.min(1, al * 0.72), sx, sy, false); return; }
    if (!SHAPES[o.t]) { freehandFill(ctx, p, W, col, al, sx, sy, false); return; }

    /* 直线 / 箭头 / 矩形 / 椭圆 */
    ctx.save();
    ctx.strokeStyle = col; ctx.globalAlpha = al;
    ctx.lineWidth = W; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (ctx.setLineDash) ctx.setLineDash(o.dash ? [Math.max(4, W * 2.4), Math.max(3, W * 1.8)] : []);
    var a0 = p[0], b0 = p[1] || p[0];
    var X0 = a0[0] * sx, Y0 = a0[1] * sy, X1 = b0[0] * sx, Y1 = b0[1] * sy;
    ctx.beginPath();
    if (o.t === 'line' || o.t === 'arrow') {
      ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1);
    } else if (o.t === 'rect') {
      var rx = Math.min(X0, X1), ry = Math.min(Y0, Y1), rw = Math.abs(X1 - X0), rh = Math.abs(Y1 - Y0);
      var rr = Math.min(o.rt == null ? 6 : o.rt, rw / 2, rh / 2);
      if (o.fill) {
        ctx.save(); ctx.fillStyle = o.fill; ctx.globalAlpha = al * 0.85;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, rr); else ctx.rect(rx, ry, rw, rh);
        ctx.fill(); ctx.restore();
        ctx.beginPath();
      }
      if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, rr); else ctx.rect(rx, ry, rw, rh);
    } else if (o.t === 'ellipse') {
      var cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, rr2 = Math.abs(X1 - X0) / 2, rh2 = Math.abs(Y1 - Y0) / 2;
      if (o.fill) {
        ctx.save(); ctx.fillStyle = o.fill; ctx.globalAlpha = al * 0.85;
        ctx.beginPath(); ctx.ellipse(cx, cy, rr2, rh2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.beginPath();
      }
      ctx.ellipse(cx, cy, rr2, rh2, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
    if (o.t === 'arrow') {
      var ang = Math.atan2(Y1 - Y0, X1 - X0), AL = Math.max(8, W * 3.2);
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(X1, Y1); ctx.lineTo(X1 - AL * Math.cos(ang - 0.42), Y1 - AL * Math.sin(ang - 0.42));
      ctx.moveTo(X1, Y1); ctx.lineTo(X1 - AL * Math.cos(ang + 0.42), Y1 - AL * Math.sin(ang + 0.42));
      ctx.stroke();
    }
    ctx.restore();
  }


  function fitCanvas(cv, cw, ch) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.round(cw * dpr));
    cv.height = Math.max(1, Math.round(ch * dpr));
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* ---------- 工具栏 ---------- */
  /* simple=true：批注只要笔/橡皮（用户要求批注里不要图片、文字、形状） */
  var WIDTHS = [2, 4.5, 8.5, 14];      /* 四档笔宽（视觉像素）：细 / 中 / 粗 / 特粗 */
  var COLORS8 = ['#111827', '#dc2626', '#ea580c', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];

  function ico(d) {
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  var ICON = {
    pen: ico('<path d="M3 21l1.2-4.2L15.4 5.6a2.1 2.1 0 013 3L7.2 19.8 3 21z"/><path d="M13.8 7.2l3 3"/>'),
    pencil: ico('<path d="M4 20l4-1L19 8a1.9 1.9 0 00-2.7-2.7L5.3 16.3 4 20z"/><path d="M14.3 6.7l3 3"/>'),
    hl: ico('<path d="M6 14l8-9 4.5 3.6-7 9H6z"/><path d="M4 20h16"/>'),
    eraser: ico('<path d="M4 15l7-7 7 7-4 4H8z"/><path d="M9 20h11"/>'),
    sel: ico('<path d="M5 3v14l3.7-3.4 2.6 5.4 2.7-1.2-2.6-5.3H16z"/>'),
    line: ico('<path d="M4 20L20 4"/>'),
    rect: ico('<rect x="4" y="6" width="16" height="12" rx="2"/>'),
    ellipse: ico('<circle cx="12" cy="12" r="7.5"/>'),
    arrow: ico('<path d="M4 20L19.5 4.5"/><path d="M11 4.5h8.5V13"/>'),
    text: ico('<path d="M5 6h14"/><path d="M12 6v13"/><path d="M9 19h6"/>'),
    img: ico('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.4"/><path d="M4.5 17l5-5 4 4 3-3 3.5 3.5"/>'),
    undo: ico('<path d="M7 5L2.5 9.5 7 14"/><path d="M2.5 9.5H13a5.5 5.5 0 010 11H9"/>'),
    redo: ico('<path d="M17 5l4.5 4.5L17 14"/><path d="M21.5 9.5H11a5.5 5.5 0 000 11h4"/>'),
    trash: ico('<path d="M4 7h16"/><path d="M9.5 7V4.2h5V7"/><path d="M6.2 7l1 13h9.6l1-13"/>'),
    png: ico('<path d="M12 3.5v11.5"/><path d="M7 10.5l5 5 5-5"/><path d="M4 20h16"/>')
  };

  function tbtn(m, icon, tip, key) {
    return '<button type="button" data-m="' + m + '" title="' + tip + (key ? '（' + key + '）' : '') + '">' + icon + '</button>';
  }

  function toolsHtml(simple) {
    var line1 = [tbtn('pen', ICON.pen, '钢笔', 'P'), tbtn('pencil', ICON.pencil, '铅笔', 'N'),
      tbtn('hl', ICON.hl, '荧光笔', 'H'), tbtn('eraser', ICON.eraser, '橡皮', 'E')];
    if (!simple) {
      line1.push('<span class="ink-vsep"></span>');
      line1.push(tbtn('sel', ICON.sel, '选择 / 移动', 'V'), tbtn('line', ICON.line, '直线', 'L'),
        tbtn('rect', ICON.rect, '矩形', 'R'), tbtn('ellipse', ICON.ellipse, '椭圆', 'O'),
        tbtn('arrow', ICON.arrow, '箭头', 'A'), tbtn('text', ICON.text, '文字', 'T'),
        tbtn('img', ICON.img, '插入图片'));
    }
    line1.push('<span class="spacer-grow"></span>');
    line1.push('<button type="button" class="ink-undo" title="撤销（Ctrl+Z）">' + ICON.undo + '</button>');
    line1.push('<button type="button" class="ink-redo" title="重做（Ctrl+Shift+Z）">' + ICON.redo + '</button>');
    line1.push('<button type="button" class="ink-clear" title="清空这一页">' + ICON.trash + '</button>');
    if (!simple) line1.push('<button type="button" class="ink-png" title="导出 PNG">' + ICON.png + '</button>');
    line1.push('<button type="button" class="ink-done pri">完成</button>');

    var line2 = '<span class="ink-sws"></span><span class="ink-vsep"></span><span class="ink-ws"></span>' +
      '<span class="ink-vsep"></span><label class="ink-alab">透明</label>' +
      '<input type="range" class="ink-alpha" min="15" max="100" step="5" value="100">';
    if (!simple) {
      line2 += '<span class="ink-vsep"></span>' +
        '<button type="button" class="ink-tg ink-dash" title="虚线（作用于直线/矩形/椭圆）">虚线</button>' +
        '<button type="button" class="ink-tg ink-fill" title="填充（矩形/椭圆）">填充</button>' +
        '<button type="button" class="ink-tg ink-erw on" title="整笔擦：一笔整条删掉，关掉则是像素擦">整笔擦</button>';
    }

    var extra = '';
    if (!simple) {
      extra = '<div class="ink-row ink-txtrow"><span class="ink-alab">文字底色</span>' +
        '<span class="ink-bgs"></span>' +
        '<label class="ink-inline"><input type="checkbox" class="ink-bgtrans"> 半透明</label>' +
        '<input type="file" class="ink-file" accept="image/*" style="display:none"></div>';
    }

    return '<div class="ink-tools ink-tb' + (simple ? ' ink-simple' : '') + '">' +
      '<div class="ink-row ink-seg">' + line1.join('') + '</div>' +
      '<div class="ink-row">' + line2 + '</div>' +
      extra + '</div>';
  }

  /* 一套画板：cv 画布；getSize 返回逻辑宽高；ops 初始笔迹；onCommit(ops,w,h) 完成时回调 */
  function Studio(opt) {
    var cv = opt.cv, wrap = opt.wrap;
    var GEN = (window.__inkGen = (window.__inkGen || 0) + 1);
    function alive() { return GEN === window.__inkGen; }
    var penOnly = !!(wrap.querySelector && wrap.querySelector('.ink-simple'));
    var st = { tool: 'pen', color: (opt.ink || inkAuto()), size: 2, alpha: 1, bg: '', bgA: 1, dash: 0, fill: 0, eraseWhole: 1 };
    /* 记一下「刚点过工具栏」，用来阻止文字框被 blur 提前提交 */
    wrap.addEventListener('pointerdown', function () { window.__inkTbDown = Date.now(); }, true);
    if (opt.state) {
      st.tool = opt.state.tool || st.tool;
      st.color = opt.state.color || st.color;
      st.size = opt.state.size || st.size;
      st.alpha = opt.state.alpha == null ? st.alpha : opt.state.alpha;
      if (opt.state.dash != null) st.dash = opt.state.dash;
      if (opt.state.fill != null) st.fill = opt.state.fill;
      if (opt.state.eraseWhole != null) st.eraseWhole = opt.state.eraseWhole;
    }
    var ops = (opt.ops || []).slice(), cur = null, drag = false, dirty = false;
    /* 编辑过程中把笔迹锚在题目卡片上：窗口一变，笔迹跟着卡片缩放而不是漂走 */
    var anchorFrom = opt.anchorFrom || null, anchorCard = opt.anchorCard || null;
    /* 卡片位置/尺寸一变（改窗口、滚动），就把已有笔迹一次性换算到新坐标系，
       并把基准重置为当前矩形 —— 之后新画的笔就直接在当前坐标系里，不会再被二次搬运。 */
    function syncAnchor() {
      if (!anchorCard || !anchorFrom) return false;
      var now = anchorCard.getBoundingClientRect();
      if (!now.width || !now.height) return false;
      if (Math.abs(now.left - anchorFrom.left) < 0.5 && Math.abs(now.top - anchorFrom.top) < 0.5 &&
          Math.abs(now.width - anchorFrom.width) < 0.5 && Math.abs(now.height - anchorFrom.height) < 0.5) return false;
      ops = remapFromCard(ops, anchorFrom, now);
      if (cur) cur = remapFromCard([cur], anchorFrom, now)[0];
      anchorFrom = now;
      return true;
    }
    var ctx = cv.getContext('2d');
    var size = { w: 1, h: 1 };
    if (window.ResizeObserver) {
      var __ro = null;
      try {
        __ro = new ResizeObserver(function () {
          clearTimeout(__ro._t);
          __ro._t = setTimeout(function () { try { resize(); } catch (e) {} }, 60);
        });
        __ro.observe(wrap);
      } catch (e) {}
    }

    /* ---------- 历史（撤销 / 重做） ---------- */
    var hist = [], redoSt = [];
    function shallow(o) {
      var c = {}, k;
      for (k in o) if (k !== '_el') c[k] = o[k];
      if (o._el) c._el = o._el;
      return c;
    }
    function snap() {
      hist.push(ops.map(shallow));
      if (hist.length > 60) hist.shift();
      redoSt.length = 0;
      syncBtns();
    }
    function undoFn() {
      if (!hist.length) return;
      redoSt.push(ops.map(shallow));
      ops = hist.pop();
      SEL = -1; dirty = true; paint(); syncBtns();
    }
    function redoFn() {
      if (!redoSt.length) return;
      hist.push(ops.map(shallow));
      ops = redoSt.pop();
      SEL = -1; dirty = true; paint(); syncBtns();
    }

    function resize() {
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (Math.abs(r.width - size.w) < 1 && Math.abs(r.height - size.h) < 1) return;
      size = { w: r.width, h: r.height };
      ctx = fitCanvas(cv, size.w, size.h);
      opt.w0 = size.w; opt.h0 = size.h;   /* 几何交给锚定，这里只做像素缩放 */
      paint();
    }
    function paint() {
      repaintAll = paint;
      ctx.clearRect(0, 0, size.w, size.h);
      var sx = size.w / (opt.w0 || size.w), sy = size.h / (opt.h0 || size.h);
      syncAnchor();
      for (var i = 0; i < ops.length; i++) drawOp(ctx, ops[i], sx, sy);
      if (cur) drawOp(ctx, cur, sx, sy);
      if (opt.handles) {
        for (var hi = 0; hi < ops.length; hi++) {
          var ho = ops[hi]; if (ho.t !== 'text' && ho.t !== 'img') continue;
          var hb = boxOf(ho);
          var k = Math.max(1, sx);
          ctx.save();
          ctx.setLineDash && ctx.setLineDash([4 / k, 3 / k]);
          ctx.strokeStyle = 'rgba(14,165,233,.75)'; ctx.lineWidth = 1.2 / k;
          ctx.strokeRect(hb.x * sx - 2, hb.y * sy - 2, hb.w * sx + 4, hb.h * sy + 4);
          ctx.setLineDash && ctx.setLineDash([]);
          ctx.fillStyle = '#0ea5e9';
          ctx.fillRect(hb.x * sx + hb.w * sx - 5, hb.y * sy + hb.h * sy - 5, 11 / k, 11 / k);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / k;
          ctx.strokeRect(hb.x * sx + hb.w * sx - 5, hb.y * sy + hb.h * sy - 5, 11 / k, 11 / k);
          ctx.restore();
        }
      }
      if (SEL >= 0 && ops[SEL]) {
        var bb = boxOf(ops[SEL]);
        var kk = Math.max(1, sx);
        ctx.save();
        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 1.5 / kk;
        if (ctx.setLineDash) ctx.setLineDash([5 / kk, 4 / kk]);
        ctx.strokeRect(bb.x * sx - 3, bb.y * sy - 3, bb.w * sx + 6, bb.h * sy + 6);
        ctx.setLineDash && ctx.setLineDash([]);
        ctx.fillStyle = '#0ea5e9';
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (q) {
          ctx.fillRect(bb.x * sx + bb.w * sx * q[0] - 4, bb.y * sy + bb.h * sy * q[1] - 4, 8 / kk, 8 / kk);
        });
        ctx.restore();
      }
    }
    function pt(ev) {
      var r = cv.getBoundingClientRect();
      var lw = r.width || size.w || 1, lh = r.height || size.h || 1;
      var sx = (opt.w0 || lw) / lw;
      var sy = (opt.h0 || lh) / lh;
      return [Math.round((ev.clientX - r.left) * sx), Math.round((ev.clientY - r.top) * sy)];
    }
    function cfg(o) { o.c = st.color; o.s = st.size; o.a = st.alpha; if (st.bg) o.bg = st.bg; if (st.bgA != null) o.ba = st.bgA; return o; }

    /* 笔压：真笔用 ev.pressure；鼠标按速度模拟（写快了细、写慢了粗） */
    var lastP = null, lastT = 0, lastF = 0.82;
    function pressOf(ev, p) {
      var now = ev.timeStamp || Date.now();
      if (ev.pointerType === 'pen' && ev.pressure > 0.01) return Math.max(0.15, Math.min(1, ev.pressure * 1.35));
      if (ev.pointerType === 'touch' && ev.pressure > 0.01) return Math.max(0.2, Math.min(1, 0.5 + ev.pressure * 0.5));
      if (!lastP) { lastP = p; lastT = now; return lastF; }
      var d = Math.sqrt((p[0] - lastP[0]) * (p[0] - lastP[0]) + (p[1] - lastP[1]) * (p[1] - lastP[1]));
      var dt = Math.max(1, now - lastT);
      var v = d / dt;
      var target = Math.max(0.35, Math.min(1, 1 - v * 0.42));
      lastF = lastF + (target - lastF) * 0.3;
      lastP = p; lastT = now;
      return lastF;
    }
    function resetPress() { lastP = null; lastT = 0; lastF = 0.82; }

    function openText(p, editIdx) {
      var old = editIdx >= 0 ? ops[editIdx] : null;
      var host = document.body;
      var ir = cv.getBoundingClientRect(), cr = host.getBoundingClientRect();
      var kx = ir.width / (opt.w0 || size.w || 1), ky = ir.height / (opt.h0 || size.h || 1);
      var p0 = old ? old.p[0] : p;
      var inp = document.createElement('textarea');
      inp.className = 'ink-txt';
      inp.rows = 1;
      inp.style.left = Math.max(2, ir.left + p0[0] * kx) + 'px';
      inp.style.top = Math.max(2, ir.top + p0[1] * ky) + 'px';
      inp.style.color = st.color;
      inp.style.fontSize = Math.round(14 + st.size * 2.2) + 'px';
      host.appendChild(inp);
      inp.value = old ? old.txt : '';
      if (old) { ops.splice(editIdx, 1); paint(); }
      function fit() { inp.style.height = 'auto'; inp.style.height = Math.max(24, inp.scrollHeight) + 'px'; }
      function put(v) {
        var lines = String(v || '').split('\n');
        var w = 0, c2 = document.createElement('canvas').getContext('2d');
        c2.font = fontOf({ s: st.size }, 1);
        lines.forEach(function (L) { w = Math.max(w, c2.measureText(L).width); });
        inp.style.width = Math.max(96, Math.ceil(w) + 18) + 'px';
      }
      inp.addEventListener('input', function () { fit(); put(inp.value); });
      setTimeout(function () { try { inp.focus(); } catch (e) {} fit(); put(inp.value); }, 0);
      var closed = false;
      function commit() {
        if (closed) return; closed = true;
        var v = inp.value.replace(/\s+$/, ''); inp.remove();
        if (v.trim()) { snap(); ops.push(cfg({ t: 'text', txt: v, p: [[p0[0], p0[1]]] })); dirty = true; paint(); }
      }
      inp.addEventListener('blur', function () {
        if (Date.now() - (window.__inkTbDown || 0) < 400) { try { setTimeout(function () { inp.focus(); }, 0); } catch (e) {} return; }
        commit();
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); closed = true; inp.remove(); if (old) { ops.push(old); paint(); } }
      });
    }
    function hitText(p) {
      for (var i = ops.length - 1; i >= 0; i--) {
        var o = ops[i]; if (o.t !== 'text') continue;
        var b = boxOf(o);
        if (p[0] >= b.x - 6 && p[0] <= b.x + b.w + 6 && p[1] >= b.y - 6 && p[1] <= b.y + b.h + 6) return i;
      }
      return -1;
    }
    var SEL = -1;
    function hitHandle(p) {
      for (var i = ops.length - 1; i >= 0; i--) {
        var o = ops[i]; if (o.t !== 'text' && o.t !== 'img') continue;
        var b = boxOf(o);
        if (p[0] >= b.x + b.w - 9 && p[0] <= b.x + b.w + 9 && p[1] >= b.y + b.h - 9 && p[1] <= b.y + b.h + 9) return { i: i, mode: 'resize' };
      }
      return null;
    }
    function hitImg(p) {
      for (var i = ops.length - 1; i >= 0; i--) {
        var o = ops[i]; if (o.t !== 'img') continue;
        var b = boxOf(o);
        if (p[0] >= b.x - 6 && p[0] <= b.x + b.w + 6 && p[1] >= b.y - 6 && p[1] <= b.y + b.h + 6) return i;
      }
      return -1;
    }
    /* 任意一笔的点命中（用于选择/整笔擦） */
    function hitAny(p, tol) {
      tol = tol || 8;
      for (var i = ops.length - 1; i >= 0; i--) {
        var b = boxOf(ops[i]);
        if (p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol) return i;
      }
      return -1;
    }
    function nearStroke(o, p, tol) {
      var q = o.p || [], i, j;
      if (SHAPES[o.t] && q.length > 1) {
        var a = q[0], b = q[1];
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var L2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
        var ddx = p[0] - (a[0] + dx * t), ddy = p[1] - (a[1] + dy * t);
        return Math.sqrt(ddx * ddx + ddy * ddy) <= tol + (o.s || 2);
      }
      for (i = 0; i < q.length; i++) {
        var d = Math.abs(q[i][0] - p[0]) + Math.abs(q[i][1] - p[1]);
        if (d <= tol + (o.s || 2)) return true;
        if (i) {
          var p0 = q[i - 1];
          var ax = p0[0], ay = p0[1], bx = q[i][0], by = q[i][1];
          var vx = bx - ax, vy = by - ay, LL = vx * vx + vy * vy || 1;
          var tt = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / LL));
          var dx2 = p[0] - (ax + vx * tt), dy2 = p[1] - (ay + vy * tt);
          if (Math.sqrt(dx2 * dx2 + dy2 * dy2) <= tol + (o.s || 2)) return true;
        }
      }
      return false;
    }
    var imgDrag = null, textDrag = null, selDrag = null, moveDrag = null;
    function cloneGeo(o) {
      var c = shallow(o);
      if (o.p) c.p = o.p.map(function (q) { return q.slice(); });
      return c;
    }

    cv.addEventListener('pointerdown', function (ev) {
      if (!alive()) return;
      if (ev.button !== 0) return;
      var p = pt(ev);
      resetPress();

      /* 整笔擦：只删碰到的那几笔 */
      if (st.tool === 'eraser' && st.eraseWhole && !penOnly) {
        var hit = -1, k;
        for (k = ops.length - 1; k >= 0; k--) { if (ops[k].t !== 'eraser' && nearStroke(ops[k], p, 6)) { hit = k; break; } }
        if (hit >= 0) { snap(); ops.splice(hit, 1); dirty = true; paint(); syncBtns(); }
        eraseDrag = true;
        try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
        return;
      }

      if (st.tool === 'text') {
        ev.preventDefault();
        var ii = hitImg(p);
        if (ii >= 0) {
          imgDrag = { i: ii, dx: p[0] - ops[ii].p[0][0], dy: p[1] - ops[ii].p[0][1] };
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          cv.style.cursor = 'move';
          return;
        }
        var ti = hitText(p);
        if (ti >= 0) {
          textDrag = { i: ti, x0: p[0], y0: p[1], moved: 0, org: [[ops[ti].p[0][0], ops[ti].p[0][1]]] };
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          cv.style.cursor = 'move';
        } else {
          openText(p, -1);
        }
        return;
      }
      if (st.tool === 'sel' || hitHandle(p) != null) {
        var hh = hitHandle(p);
        if (hh) {
          var so0 = ops[hh.i], b0 = boxOf(so0);
          selDrag = { i: hh.i, x0: p[0], y0: p[1], org: { w: b0.w, h: b0.h, s: so0.s, iw: so0.w } };
          SEL = hh.i;
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          cv.style.cursor = 'nwse-resize';
          return;
        }
        var si = hitAny(p, 10);
        if (si >= 0) {
          SEL = si;
          var src = ops[si];
          snap();
          moveDrag = { i: si, x0: p[0], y0: p[1], org: cloneGeo(src), moved: 0 };
          dirty = true; paint(); syncSize();
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          cv.style.cursor = 'move';
        } else {
          SEL = -1; paint();
        }
        return;
      }
      ev.preventDefault();
      snap();
      drag = true;
      cur = { t: st.tool, p: [p.slice()] };
      cfg(cur);
      if (SHAPES[cur.t]) cur.p.push(p.slice()); else cur.p[0][2] = pressOf(ev, p);
      if (cur.t === 'rect' || cur.t === 'ellipse') { if (st.dash) cur.dash = 1; if (st.fill) cur.fill = shadeOf(st.color); }
      else if (cur.t === 'line' || cur.t === 'arrow') { if (st.dash) cur.dash = 1; }
      if (cur.t === 'hl') cur.p[0][2] = 1;
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      paint();
    });

    var eraseDrag = false;

    cv.addEventListener('pointermove', function (ev) {
      if (!alive()) return;
      if (eraseDrag) {
        var pe = pt(ev);
        for (var k = ops.length - 1; k >= 0; k--) {
          if (ops[k].t === 'eraser') continue;
          if (nearStroke(ops[k], pe, 6)) { ops.splice(k, 1); dirty = true; }
        }
        paint(); return;
      }
      if (moveDrag) {
        var mp = pt(ev), mo = ops[moveDrag.i], og = moveDrag.org;
        if (mo) {
          var dx = mp[0] - moveDrag.x0, dy = mp[1] - moveDrag.y0;
          if (Math.abs(dx) + Math.abs(dy) > 2) moveDrag.moved = 1;
          if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }   /* Shift 锁水平/垂直 */
          if (mo.t === 'img' || mo.t === 'text') {
            mo.p = [[Math.round(og.p[0][0] + dx), Math.round(og.p[0][1] + dy)]];
          } else {
            mo.p = og.p.map(function (q) { return [Math.round(q[0] + dx), Math.round(q[1] + dy), q[2]]; });
          }
          dirty = true; paint();
        }
        return;
      }
      if (selDrag) {
        var sp = pt(ev), so = ops[selDrag.i];
        if (so) {
          var dxr = sp[0] - selDrag.x0;
          if (so.t === 'img') {
            so.w = Math.max(48, Math.round(selDrag.org.iw + dxr));
          } else {
            var nw = Math.max(48, Math.round(selDrag.org.w + dxr));
            var ratio = nw / Math.max(1, selDrag.org.w);
            so.w = nw;
          }
          dirty = true; paint();
        }
        return;
      }
      if (textDrag) {
        var tp = pt(ev);
        var ddx = tp[0] - textDrag.x0, ddy = tp[1] - textDrag.y0;
        if (Math.abs(ddx) + Math.abs(ddy) > 3) textDrag.moved += 1;
        var to = ops[textDrag.i];
        if (to) { to.p = [[textDrag.org[0][0] + ddx, textDrag.org[0][1] + ddy]]; paint(); }
        return;
      }
      if (imgDrag) {
        var ip = pt(ev), im = ops[imgDrag.i];
        if (im) { im.p[0][0] = Math.round(ip[0] - imgDrag.dx); im.p[0][1] = Math.round(ip[1] - imgDrag.dy); dirty = true; paint(); }
        return;
      }
      if (!drag || !cur) return;
      var p = pt(ev);
      if (SHAPES[cur.t]) {
        if (ev.shiftKey && (cur.t === 'line' || cur.t === 'arrow')) {
          var a0 = cur.p[0], dxs = p[0] - a0[0], dys = p[1] - a0[1];
          var ang = Math.atan2(dys, dxs), L = Math.sqrt(dxs * dxs + dys * dys);
          var snap45 = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          cur.p[1] = [Math.round(a0[0] + Math.cos(snap45) * L), Math.round(a0[1] + Math.sin(snap45) * L)];
        } else if (ev.shiftKey && (cur.t === 'rect' || cur.t === 'ellipse')) {
          var s0 = cur.p[0], w0 = p[0] - s0[0], h0 = p[1] - s0[1];
          var m = Math.max(Math.abs(w0), Math.abs(h0));
          cur.p[1] = [s0[0] + (w0 < 0 ? -m : m), s0[1] + (h0 < 0 ? -m : m)];
        } else {
          cur.p[1] = p;
        }
      } else {
        var lastq = cur.p[cur.p.length - 1];
        if (Math.abs(p[0] - lastq[0]) + Math.abs(p[1] - lastq[1]) < 1.2) return;   /* 太密就丢，省点也省运算 */
        cur.p.push([p[0], p[1], cur.t === 'hl' ? 1 : pressOf(ev, p)]);
      }
      if (cur.t === 'eraser') {
        var ssx = size.w / (opt.w0 || size.w), ssy = size.h / (opt.h0 || size.h);
        var a1 = cur.p[cur.p.length - 2] || cur.p[cur.p.length - 1], b1 = cur.p[cur.p.length - 1];
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(12, Math.max(1, (cur.s || 2) * ssx) * 3);
        ctx.beginPath(); ctx.moveTo(a1[0] * ssx, a1[1] * ssy); ctx.lineTo(b1[0] * ssx, b1[1] * ssy); ctx.stroke();
        ctx.restore();
        return;
      }
      paint();
    });

    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () {
        if (!alive()) return;
        if (eraseDrag) { eraseDrag = false; return; }
        if (moveDrag) { if (!moveDrag.moved) { hist.pop(); syncBtns(); } moveDrag = null; cv.style.cursor = 'move'; paint(); return; }
        if (selDrag) { selDrag = null; cv.style.cursor = 'default'; paint(); syncBtns(); return; }
        if (textDrag) {
          var td = textDrag; textDrag = null;
          cv.style.cursor = 'text';
          if (td.moved <= 3) {
            var op0 = ops[td.i];
            if (op0) { st.color = op0.c || st.color; st.size = op0.s || st.size; }
            openText([td.x0, td.y0], td.i);
          } else { paint(); snap(); }
          return;
        }
        if (imgDrag) { imgDrag = null; snap(); return; }
        if (!drag) return;
        drag = false;
        if (cur) { ops.push(cur); dirty = true; }
        cur = null; paint(); syncBtns();
      });
    });

    /* ---------- 工具栏 ---------- */
    var tb = wrap.querySelector('.ink-tools');
    function syncBtns() {
      if (!tb) return;
      var u = tb.querySelector('.ink-undo'), r = tb.querySelector('.ink-redo');
      if (u) u.classList.toggle('off', !hist.length);
      if (r) r.classList.toggle('off', !redoSt.length);
    }
    function setTool(m) {
      st.tool = m;
      if (seg) Array.prototype.forEach.call(seg.children, function (x) { if (x.dataset && x.dataset.m) x.classList.toggle('on', x.dataset.m === m); });
      cv.style.cursor = m === 'text' ? 'text' : (m === 'sel' ? 'default' : 'crosshair');
    }
    function syncSize() {
      if (!tb) return;
      Array.prototype.forEach.call(tb.querySelectorAll('.ink-w'), function (b, i) {
        b.classList.toggle('on', Math.abs(WIDTHS[i] - st.size) < 0.01);
      });
    }
    var seg = tb.querySelector('.ink-seg');
    if (seg) seg.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.m === 'img') { var fi = tb.querySelector('input[type=file]'); if (fi) fi.click(); return; }
      setTool(b.dataset.m);
    };
    var sws = tb.querySelector('.ink-sws');
    var pal = (opt.pal && opt.pal.length) ? opt.pal : [inkAuto()].concat(COLORS8);
    function sameC(a, b2) { return String(a || '').toLowerCase() === String(b2 || '').toLowerCase(); }
    if (sws) pal.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'ink-sw' + (sameC(c, st.color) ? ' on' : '');
      b.title = c === '#ffffff' ? '白色（在白板/深色批注上当橡皮用）'
        : (pal.length > COLORS8.length && i === 0 ? '跟随主题' : '');
      b.style.background = c;
      b.onclick = function () {
        st.color = c;
        Array.prototype.forEach.call(sws.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (SEL >= 0 && ops[SEL] && (ops[SEL].t === 'text' || ops[SEL].t === 'rect' || ops[SEL].t === 'ellipse')) {
          snap(); ops[SEL].c = c; dirty = true; paint();
        }
      };
      sws.appendChild(b);
    });
    var ws = tb.querySelector('.ink-ws');
    if (ws) WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.className = 'ink-w' + (Math.abs(w - st.size) < 0.01 ? ' on' : '');
      b.title = ['细', '中', '粗', '特粗'][i];
      b.innerHTML = '<i style="width:' + Math.round(w + 3) + 'px;height:' + Math.round(w + 3) + 'px"></i>';
      b.onclick = function () {
        st.size = w; syncSize();
        if (SEL >= 0 && ops[SEL]) {
          var so = ops[SEL];
          if (so.t === 'text') { so.s = w; dirty = true; paint(); }
          else if (so.t === 'img') { so.w = Math.round(w * 24); dirty = true; paint(); }
        }
      };
      ws.appendChild(b);
    });
    var bgs = tb.querySelector('.ink-bgs');
    if (bgs) {
      var BGS = [['', '无'], ['#ffffff', '白'], ['#fff3a3', '黄'], ['#d1fae5', '绿'], ['#dbeafe', '蓝'], ['#111827', '黑']];
      BGS.forEach(function (bg, i) {
        var b = document.createElement('button');
        b.className = 'ink-bg' + (i === 0 ? ' on' : '');
        b.textContent = bg[1];
        if (bg[0]) b.style.background = bg[0];
        b.onclick = function () {
          st.bg = bg[0];
          Array.prototype.forEach.call(bgs.children, function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          if (SEL >= 0 && ops[SEL] && ops[SEL].t === 'text') {
            snap(); if (bg[0]) ops[SEL].bg = bg[0]; else delete ops[SEL].bg;
            dirty = true; paint();
          }
        };
        bgs.appendChild(b);
      });
    }
    var bgt = tb.querySelector('.ink-bgtrans');
    if (bgt) bgt.onchange = function () {
      st.bgA = bgt.checked ? 0.45 : 1;
      if (SEL >= 0 && ops[SEL] && ops[SEL].t === 'text') { ops[SEL].ba = st.bgA; dirty = true; paint(); }
    };
    var alphaEl = tb.querySelector('.ink-alpha');
    if (alphaEl) {
      alphaEl.value = Math.round(st.alpha * 100);
      alphaEl.oninput = function (e) { st.alpha = +e.target.value / 100; };
    }
    var dEl = tb.querySelector('.ink-dash');
    if (dEl) dEl.onclick = function () {
      st.dash = st.dash ? 0 : 1;
      dEl.classList.toggle('on', !!st.dash);
      if (SEL >= 0 && ops[SEL] && SHAPES[ops[SEL].t]) { snap(); if (st.dash) ops[SEL].dash = 1; else delete ops[SEL].dash; dirty = true; paint(); }
    };
    var fEl = tb.querySelector('.ink-fill');
    if (fEl) fEl.onclick = function () {
      st.fill = st.fill ? 0 : 1;
      fEl.classList.toggle('on', !!st.fill);
      if (SEL >= 0 && ops[SEL] && (ops[SEL].t === 'rect' || ops[SEL].t === 'ellipse')) {
        snap();
        if (st.fill) ops[SEL].fill = shadeOf(ops[SEL].c || st.color); else delete ops[SEL].fill;
        dirty = true; paint();
      }
    };
    var eEl = tb.querySelector('.ink-erw');
    if (eEl) eEl.onclick = function () {
      st.eraseWhole = st.eraseWhole ? 0 : 1;
      eEl.classList.toggle('on', !!st.eraseWhole);
      eEl.textContent = st.eraseWhole ? '整笔擦' : '像素擦';
    };
    var undoEl = tb.querySelector('.ink-undo');
    if (undoEl) undoEl.onclick = undoFn;
    var redoEl = tb.querySelector('.ink-redo');
    if (redoEl) redoEl.onclick = redoFn;
    var clearEl = tb.querySelector('.ink-clear');
    if (clearEl) clearEl.onclick = function () {
      if (!ops.length) return;
      if (!confirm('清空这一层的全部笔迹？')) return;
      snap(); ops = []; SEL = -1; dirty = true; paint(); syncBtns();
    };
    var pngEl = tb.querySelector('.ink-png');
    if (pngEl) pngEl.onclick = function () { exportPng(); };

    function exportPng() {
      var W = Math.max(1, Math.round(opt.w0 || size.w)), H = Math.max(1, Math.round(opt.h0 || size.h));
      var c = document.createElement('canvas');
      var cc = fitCanvas(c, W, H);
      cc.fillStyle = '#fff'; cc.fillRect(0, 0, W, H);
      ops.forEach(function (o) { try { drawOp(cc, o, 1, 1); } catch (e) {} });
      var url = '';
      try { url = c.toDataURL('image/png'); } catch (e) { return; }
      var d = new Date();
      var name = '白板-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '-' +
        ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + '.png';
      if (typeof window.download === 'function') { window.download(name, url, 'image/png'); }
      else { var a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
      if (typeof toast === 'function') toast('已导出 ' + name, 2200, 'good');
    }

    /* ---------- 快捷键 ---------- */
    function onKey(ke) {
      if (!alive() || !ke || !document.body.contains(wrap)) return;
      var ae = document.activeElement;
      if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
      var meta = ke.ctrlKey || ke.metaKey;
      var k = String(ke.key || '').toLowerCase();
      if (meta && k === 'z') { ke.preventDefault(); if (ke.shiftKey) redoFn(); else undoFn(); return; }
      if (meta && k === 'y') { ke.preventDefault(); redoFn(); return; }
      if (k === 'delete' || k === 'backspace') {
        if (SEL >= 0 && ops[SEL]) { ke.preventDefault(); snap(); ops.splice(SEL, 1); SEL = -1; dirty = true; paint(); syncBtns(); }
        return;
      }
      if (meta || ke.altKey) return;
      if (k === 'escape') { SEL = -1; paint(); return; }
      if (penOnly) return;
      var map = { p: 'pen', n: 'pencil', h: 'hl', e: 'eraser', v: 'sel', l: 'line', r: 'rect', o: 'ellipse', a: 'arrow', t: 'text' };
      if (map[k]) { setTool(map[k]); }
    }
    if (window.__inkKey) document.removeEventListener('keydown', window.__inkKey);
    window.__inkKey = onKey;
    document.addEventListener('keydown', onKey);

    tb.querySelector('.ink-done').onclick = function () {
      syncAnchor();
      opt.onDone(ops, innerWidth, innerHeight, dirty);
    };
    setTool(st.tool);
    syncSize(); syncBtns();
    window.addEventListener('resize', function () { setTimeout(resize, 60); });
    setTimeout(resize, 20);
    return {
      resize: resize, paint: paint, ops: function () { return ops; },
      state: function () { return { tool: st.tool, color: st.color, size: st.size, alpha: st.alpha, dash: st.dash, fill: st.fill, eraseWhole: st.eraseWhole }; }
    };
  }

  /* 从某个颜色派生出浅一号的填充色 */
  function shadeOf(c) {
    var m = String(c || '').match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (!m) return 'rgba(37,99,235,.18)';
    var r = Math.round(+m[1] + (255 - +m[1]) * 0.72),
      g = Math.round(+m[2] + (255 - +m[2]) * 0.72),
      b = Math.round(+m[3] + (255 - +m[3]) * 0.72);
    return 'rgba(' + r + ',' + g + ',' + b + ',.55)';
  }
  /* ---------- 批注 ---------- */
  var liveCv = null, liveStudio = null;

  function cardOf() { return document.querySelector('#view .card') || null; }

  var PAD = 150;   /* 画布比题目卡片四周各多 150px：允许把字 / 图片画到框外，导出时也不裁 */

  function layerBox(card, pad) {
    var r = card.getBoundingClientRect();
    return { w: Math.round(r.width) + 2 * pad, h: Math.round(r.height) + 2 * pad, pad: pad };
  }
  function placeLayer(cv, card, w, h, pad, k) {
    k = k || 1;
    cv.style.left = (-pad * k) + 'px';
    cv.style.top = (-pad * k) + 'px';
    cv.style.width = Math.round(w * k) + 'px';
    cv.style.height = Math.round(h * k) + 'px';
  }

  /* web272：「隐藏批注」已删掉，批注永远显示（老的 qbank.ink.show.v1 键不再读） */
  function inkShow() { return true; }

  /* 整页批注：显示层（不可点）与编辑层（可画）都是 fixed 铺满整个视口，
     所以「答题卡外面」也能画，而且点空白处不会触发选字/复制 */
  function viewLayer() {
    var cv = document.getElementById('inkView');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'inkView'; cv.className = 'ink-view';
      document.body.appendChild(cv);
    }
    return cv;
  }
  function fixLayer() {
    var cv = document.getElementById('inkFix');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'inkFix'; cv.className = 'ink-fix';
      document.body.appendChild(cv);
    }
    return cv;
  }
  function vpSize(cv, k) {
    k = k || 1;
    var de = document.documentElement;
    var w = Math.max(de.scrollWidth, innerWidth), h = Math.max(de.scrollHeight, innerHeight);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    return { w: w, h: h, cw: w, ch: h };
  }

  function penOps(ops) {
    return (ops || []).filter(function (o) {
      return o && (o.t === 'pen' || o.t === 'pencil' || o.t === 'hl' || o.t === 'eraser');
    });
  }

  /* 转屏 / 改窗口：画布尺寸和卡片尺寸都变了，重铺一次（笔迹按卡片锚定，所以只会跟着卡片缩放） */
  var _rzT = 0;
  addEventListener('resize', function () {
    clearTimeout(_rzT);
    _rzT = setTimeout(function () { try { if (typeof repaintAll === 'function') repaintAll(); } catch (e) {} }, 160);
  }, { passive: true });

  function hideView() {
    var cv = document.getElementById('inkView');
    if (cv) { cv.style.display = 'none'; try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } catch (e) {} }
    var L = document.getElementById('inkImgLayer');
    if (L) { L.innerHTML = ''; L.style.display = 'none'; }
  }

  function paint(bank, q) {
    if (!bank || !q) { hideView(); return; }
    var cv = viewLayer();
    var rec = INK_MEM[keyOf(bank, q)] || inkAll()[keyOf(bank, q)];
    if (rec && rec.ops) rec = { ops: penOps(rec.ops), vw: rec.vw, vh: rec.vh, cr: rec.cr, ts: rec.ts };
    if (!rec || !rec.ops || !rec.ops.length || !inkShow()) { cv.style.display = 'none'; var L0 = document.getElementById('inkImgLayer'); if (L0) { L0.innerHTML = ''; L0._im = {}; L0.style.display = 'none'; } return; }
    var editing = !!EDIT;
    cv.style.display = editing ? 'none' : 'block';
    if (editing) return;
    var k = 1;
    var s = vpSize(cv, 1);
    var ctx = fitCanvas(cv, s.cw, s.ch);
    var sx = 1, sy = 1;
    repaintAll = function () { paint(bank, q); };   /* 图片解码完成后回一次，否则首帧画不出来 */
    var ANCMAP = anchorOf(rec, cardDocRect());
    var DRAWN = mapOps(rec.ops, ANCMAP);
    DRAWN.forEach(function (o) {
      drawOp(ctx, o, sx, sy);
    });
    /* 图片单独用真 <img> 叠上去：canvas 画图在这套缩放里不可靠，DOM 一定画得出来。
       复用已有节点，只改位置/尺寸，避免每次重画都重建导致闪烁 */
    var lay = document.getElementById('inkImgLayer');
    if (!lay) { lay = document.createElement('div'); lay.id = 'inkImgLayer'; lay.className = 'ink-imgs'; document.body.appendChild(lay); }
    var keep = [];
    lay._im = lay._im || {};
    DRAWN.forEach(function (o, i) {
      if (o.t !== 'img' || !o.data) return;
      var im = lay._im[i];
      if (!im) {
        im = document.createElement('img');
        im.className = 'ink-img'; im.src = o.data; im.alt = '';
        lay._im[i] = im; lay.appendChild(im);
      }
      im.style.left = Math.round(o.p[0][0]) + 'px';
      im.style.top = Math.round(o.p[0][1]) + 'px';
      im.style.width = Math.round(o.w || 200) + 'px';
      im.style.opacity = (o.op == null ? 1 : o.op);
      keep.push(i);
    });
    Object.keys(lay._im).forEach(function (k) {
      if (keep.indexOf(+k) < 0) { try { lay.removeChild(lay._im[k]); } catch (e) {} delete lay._im[k]; }
    });
    lay.style.display = editing ? 'none' : '';
  }

  /* 批注锚定：存的时候记下题目卡片的矩形（文档坐标），画的时候按当前卡片矩形做仿射映射，
     窗口怎么变、字号怎么变，笔迹都跟着卡片走，不会漂到别处。 */
  function cardDocRect() {
    var c = (typeof cardOf === 'function' ? cardOf() : null) || document.querySelector('#view .qcard');
    if (!c) return null;
    var r = c.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  function anchorOf(rec, rect) {
    var cr = rec && rec.cr;
    if (!rect || !cr || !(cr.w > 8) || !(cr.h > 8)) return null;
    var kx = rect.w / cr.w, ky = rect.h / cr.h;
    if (!(kx > 0.05 && kx < 20 && ky > 0.05 && ky < 20)) return null;
    return { kx: kx, ky: ky, dx: rect.x - cr.x * kx, dy: rect.y - cr.y * ky };
  }

  function mapOps(ops, a) {
    if (!a) return ops;
    var k = (a.kx + a.ky) / 2;
    return ops.map(function (o) {
      var n = {}; for (var q in o) n[q] = o[q];
      if (o.p) n.p = o.p.map(function (pt) { return [pt[0] * a.kx + a.dx, pt[1] * a.ky + a.dy, pt[2]]; });
      if (o.s) n.s = o.s * k;
      if (o.w) n.w = o.w * a.kx;
      return n;
    });
  }

  /* 把屏幕坐标的笔迹从一张卡片矩形搬到另一张（编辑中改窗口用） */
  function remapFromCard(ops, from, to) {
    if (!ops || !from || !to || !(from.width > 8) || !(from.height > 8)) return ops || [];
    var kx = to.width / from.width, ky = to.height / from.height, k = (kx + ky) / 2;
    return ops.map(function (o) {
      var n = {}; for (var q in o) n[q] = o[q];
      if (o.p) n.p = o.p.map(function (pt) {
        return [to.left + (pt[0] - from.left) * kx, to.top + (pt[1] - from.top) * ky, pt[2]];
      });
      if (o.s) n.s = o.s * k;
      if (o.w) n.w = o.w * kx;
      return n;
    });
  }

  function hasInk(bank, q) {
    var rec = inkAll()[keyOf(bank, q)];
    return !!(rec && rec.ops && rec.ops.length);
  }

  var EDIT = null;

  /* 统一的「开始在题目上画」；rebind 也走这里，保证重画后工具条与笔迹都还在 */
  function startEditing(bank, q, ops, state, w0, h0) {
    var card = cardOf(); if (!card) return false;
    closeAll();
    var cv = fixLayer();
    cv.style.display = 'block';
    document.body.classList.add('ink-on');

    var wrap = document.createElement('div');
    wrap.className = 'ink-wrap';
    wrap.innerHTML = toolsHtml();   /* 批注也用全套工具：直线/箭头/文字在讲题时最常用 */
    document.body.appendChild(wrap);


    var vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    fitCanvas(cv, vw, vh);
    EDIT = { bankId: bank.id, qid: q.id, w0: vw, h0: vh, card0: card.getBoundingClientRect() };
    liveCv = cv;
    /* Esc 直接退出批注 */
    var escFn = function (e) { if (e && e.key === 'Escape') { var dn = wrap.querySelector('.ink-done'); if (dn) dn.click(); } };
    document.addEventListener('keydown', escFn);
    window.__inkEsc = escFn;
    liveStudio = Studio({
      cv: cv, wrap: wrap, ops: ops || [], state: state || null,
      w0: vw, h0: vh, handles: true,
      anchorCard: card, anchorFrom: card.getBoundingClientRect(),
      onDone: function (o, w, h, dirty) {
        var all = inkAll(), prevRec = all[keyOf(bank, q)];
        var r0 = card.getBoundingClientRect();
        var cr = { x: Math.round(r0.left + scrollX), y: Math.round(r0.top + scrollY), w: Math.round(r0.width), h: Math.round(r0.height) };
        var k0 = keyOf(bank, q);
        if (o.length) {
          all[k0] = {
            ops: o, vw: Math.max(document.documentElement.scrollWidth, innerWidth),
            vh: Math.max(document.documentElement.scrollHeight, innerHeight),
            cr: cr, ts: Date.now()
          };
        } else if (all[k0]) {
          delete all[k0];     /* 全擦光了就把这条批注一起删掉，别留空记录 */
        }
        if (!lsSet(INK_KEY, all)) toast('本地存储满了，这条批注没存下', 2600, 'bad');
        closeAll();
        paint(bank, q);
        if (typeof window.paintInkDot === 'function') window.paintInkDot();
      }
    });
    setTimeout(function () { if (liveStudio) liveStudio.resize(); }, 30);

    /* 未保存状态下改窗口 / 转屏：把编辑画布撑到新视口，Studio 会按锚定关系重画笔迹 */
    var rzT = 0;
    var onRz = function () {
      clearTimeout(rzT);
      rzT = setTimeout(function () {
        if (!liveStudio) return;
        cv.style.width = Math.max(1, innerWidth) + 'px';
        cv.style.height = Math.max(1, innerHeight) + 'px';
        liveStudio.resize();
      }, 120);
    };
    window.__inkRz = onRz;
    addEventListener('resize', onRz, { passive: true });

    /* 编辑层是 position:fixed（视口坐标），页面一滚卡片就移了 → 每次滚动都按锚定关系重画一次 */
    var scrRaf = 0;
    var onScr = function () {
      if (scrRaf) return;
      scrRaf = requestAnimationFrame(function () {
        scrRaf = 0;
        try { if (liveStudio) liveStudio.paint(); } catch (e) {}
      });
    };
    window.__inkScr = onScr;
    addEventListener('scroll', onScr, { passive: true });
    return true;
  }

  /* 答题页整页重画会把 <canvas.ink-layer> 一起换掉：把笔迹和工具状态搬到新画布上 */
  function rebind() {
    if (!EDIT || !liveStudio) return false;
    var bank = (typeof bankById === 'function') ? bankById(EDIT.bankId) : null;
    if (!bank) { closeAll(); return false; }
    var q = (bank.questions || []).filter(function (x) { return String(x.id) === String(EDIT.qid); })[0];
    if (!q) { closeAll(); return false; }
    var ops = liveStudio.ops().slice(), state = liveStudio.state(), w0 = EDIT.w0, h0 = EDIT.h0;
    closeAll();
    return startEditing(bank, q, ops, state, w0, h0);
  }

  function isEditing() { return !!EDIT; }

  function annotation(bank, q) {
    if (!bank || !q) return;
    closeAll();
    var rec = inkAll()[keyOf(bank, q)] || null;
    startEditing(bank, q, (rec && rec.ops) || [], null,
      (rec && rec.w) || 0, (rec && rec.h) || 0);
  }

  /* ---------- 空白板 ---------- */
  /* 白板是浮动窗口：按住标题条可以挪位置 */
  function dragHead(wrap) {
    var head = wrap.querySelector('.ink-head');
    if (!head) return;
    head.style.cursor = 'grab';
    head.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('button')) return;
      ev.preventDefault();
      var r = wrap.getBoundingClientRect();
      var x0 = ev.clientX, y0 = ev.clientY;
      wrap.style.transform = 'none';
      wrap.style.left = r.left + 'px'; wrap.style.top = r.top + 'px';
      function mv(e2) { wrap.style.left = (r.left + e2.clientX - x0) + 'px'; wrap.style.top = (r.top + e2.clientY - y0) + 'px'; }
      function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }
      document.addEventListener('pointermove', mv);
      document.addEventListener('pointerup', up);
    });
  }

  function board() {
    closeAll();
    var wrap = document.createElement('div');
    wrap.className = 'ink-full';
    wrap.innerHTML =
      '<div class="ink-head"><b>空白板</b>' +
      '<span class="ink-hint2">写完点「完成」，成品会存进手稿历史（最多 ' + MAX_BOARDS + ' 张，只在本机）</span>' +
      '<span class="spacer-grow"></span>' +
      '<button class="ink-hist">手稿历史 <i>' + boardAll().length + '</i></button>' +
      '<button class="ink-close">✕</button></div>' +
      '<div class="ink-stage"><canvas></canvas></div>' + toolsHtml();
    document.body.appendChild(wrap);
    document.body.classList.add('ink-on');
    dragHead(wrap);

    var stage = wrap.querySelector('.ink-stage');
    var cv = wrap.querySelector('.ink-stage canvas');
    var st = null;
    function sizeIt() {
      var r = stage.getBoundingClientRect();
      cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
      cv.width = Math.round(r.width * Math.min(devicePixelRatio || 1, 2));
      cv.height = Math.round(r.height * Math.min(devicePixelRatio || 1, 2));
      cv.getContext('2d').setTransform(Math.min(devicePixelRatio || 1, 2), 0, 0, Math.min(devicePixelRatio || 1, 2), 0, 0);
    }
    sizeIt();
    st = Studio({
      cv: cv, wrap: wrap, ops: [], ink: '#111827',
      pal: COLORS8.concat(['#ffffff']),
      w0: Math.round(stage.getBoundingClientRect().width), h0: Math.round(stage.getBoundingClientRect().height),
      onDone: function (ops, w, h) {
        if (!ops.length) { closeAll(); return; }
        var all = boardAll();
        var n = all.length + 1;
        all.unshift({ id: 'b' + Date.now().toString(36), ts: Date.now(), name: '手稿 ' + n, ops: ops, w: w, h: h });
        if (all.length > MAX_BOARDS) all.length = MAX_BOARDS;
        if (!lsSet(BOARD_KEY, all)) toast('本地存储满了，这张没存下', 2600, 'bad');
        closeAll();
        toast('手稿已存进历史（' + (all.length) + ' 张）', 2000, 'good');
      }
    });
    /* 窗口拖大拖小之后，画布要跟着重算，不然只会显示一部分 */
    try {
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          clearTimeout(ro._t);
          ro._t = setTimeout(function () { try { sizeIt(); if (st) st.resize(); } catch (e) {} }, 60);
        });
        ro.observe(stage);
      }
    } catch (e) {}
    wrap.querySelector('.ink-close').onclick = function () {
      if (st && st.ops().length && !confirm('这张还没完成，关掉就不保存了，确定？')) return;
      closeAll();
    };
    wrap.querySelector('.ink-hist').onclick = function () { history(); };
  }

  function history() {
    var all = boardAll();
    var m = document.createElement('div');
    m.className = 'ink-histmask';
    m.innerHTML = '<div class="ink-histbox"><div class="ink-head"><b>手稿历史</b>' +
      '<span class="ink-hint2">' + all.length + ' 张 · 只在本机</span><span class="spacer-grow"></span>' +
      '<button class="ink-hclose">✕</button></div>' +
      '<div class="ink-hlist">' + (all.length ? '' : '<div class="ink-empty">还没有手稿</div>') + '</div></div>';
    document.body.appendChild(m);
    var list = m.querySelector('.ink-hlist');
    all.forEach(function (b, i) {
      var d = document.createElement('div');
      d.className = 'ink-hitem';
      var th = document.createElement('canvas');
      th.width = 240; th.height = 150;
      d.appendChild(th);
      var cap = document.createElement('div');
      cap.className = 'ink-hcap';
      var dt = new Date(b.ts);
      cap.innerHTML = '<b>' + (b.name || '手稿') + '</b><span>' +
        (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2) + '</span>';
      d.appendChild(cap);
      var del = document.createElement('button');
      del.className = 'ink-hdel'; del.textContent = '🗑';
      del.onclick = function (ev) {
        ev.stopPropagation();
        if (!confirm('删掉这张手稿？')) return;
        var arr = boardAll().filter(function (x) { return x.id !== b.id; });
        lsSet(BOARD_KEY, arr); m.remove(); history();
      };
      d.appendChild(del);
      d.onclick = function () { m.remove(); openSaved(b); };
      list.appendChild(d);
      var ctx = th.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 240, 150);
      var sx = 240 / (b.w || 240), sy = 150 / (b.h || 150);
      b.ops.forEach(function (o) {
        if (o.t === 'img' && o.data && !o._el) { var im = new Image(); im.onload = function () { ctx.drawImage(im, o.p[0][0] * sx, o.p[0][1] * sy, o.w * sx, o.w * sx * (im.naturalHeight / im.naturalWidth || 0.6)); }; im.src = o.data; o._el = im; return; }
        drawOp(ctx, o, sx, sy);
      });
    });
    m.querySelector('.ink-hclose').onclick = function () { m.remove(); };
    m.onclick = function (ev) { if (ev.target === m) m.remove(); };
  }

  function openSaved(b) {
    var wrap = document.createElement('div');
    wrap.className = 'ink-full';
    wrap.innerHTML = '<div class="ink-head"><b>' + (b.name || '手稿') + '</b>' +
      '<span class="ink-hint2">只读再看看；点「完成」可以覆盖更新</span><span class="spacer-grow"></span>' +
      '<button class="ink-close">✕</button></div>' +
      '<div class="ink-stage"><canvas></canvas></div>' + toolsHtml();
    document.body.appendChild(wrap);
    document.body.classList.add('ink-on');
    dragHead(wrap);
    var stage = wrap.querySelector('.ink-stage'), cv = wrap.querySelector('canvas');
    var r = stage.getBoundingClientRect();
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    var ops = JSON.parse(JSON.stringify(b.ops || []));
    var st = Studio({
      cv: cv, wrap: wrap, ops: ops, w0: b.w, h0: b.h,
      onDone: function (nops) {
        var arr = boardAll();
        for (var i = 0; i < arr.length; i++) if (arr[i].id === b.id) { arr[i].ops = nops; arr[i].ts = Date.now(); }
        lsSet(BOARD_KEY, arr); closeAll(); toast('已更新这张手稿', 1800, 'good');
      }
    });
    wrap.querySelector('.ink-close').onclick = function () { closeAll(); };
    setTimeout(function () { st.resize(); }, 30);
  }

  function lumOf(c) {
    var m = String(c || '').match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (!m) return 0;
    return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
  }
  /* 白纸导出时，把「跟随主题」那种很浅的笔色换成深色，否则打印出来看不见 */
  function onPaper(o) {
    var c2 = {};
    for (var k in o) c2[k] = o[k];
    if (o.c && lumOf(o.c) > 0.72) c2.c = '#111827';
    return c2;
  }

  function opsBox(ops) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ops.forEach(function (o) {
      if (o.t === 'img') {
        var b = boxOf(o);
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      } else if (o.t === 'text') {
        var t = boxOf(o);
        x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
      } else {
        var lw = (o.t === 'hl' ? Math.max(14, (o.s || 2) * 4.5) : (o.s || 2) * 2.2) / 2 + 6;
        (o.p || []).forEach(function (pt) {
          x0 = Math.min(x0, pt[0] - lw); y0 = Math.min(y0, pt[1] - lw);
          x1 = Math.max(x1, pt[0] + lw); y1 = Math.max(y1, pt[1] + lw);
        });
      }
    });
    return { x: x0, y: y0, x1: x1, y1: y1 };
  }

  /* 导出用：把这道题的笔迹（含画到题目外面的部分）裁成一张 PNG，
     并返回它相对题目卡片的位置，供导出文档按 A4 版心缩放后贴回去 */
  function pngOf(bank, q, opt) {
    var rec = inkAll()[keyOf(bank, q)];
    if (!rec || !rec.ops || !rec.ops.length) return null;
    var cr = rec.cr;
    if (!cr) { var c0 = cardOf(); if (!c0) return null; var r0 = c0.getBoundingClientRect(); cr = { x: r0.left, y: r0.top, w: r0.width, h: r0.height }; }
    var bb = opsBox(rec.ops);
    var pad = 8;
    var x = Math.min(cr.x, bb.x) - pad, y = Math.min(cr.y, bb.y) - pad;
    var w = Math.max(cr.x + cr.w, bb.x1) + pad - x, h = Math.max(cr.y + cr.h, bb.y1) + pad - y;
    var sx = 1, sy = 1;
    var c = document.createElement('canvas');
    var ctx = fitCanvas(c, w, h);
    ctx.save(); ctx.translate(-x * sx, -y * sy);
    rec.ops.forEach(function (o) {
      if (o.t === 'img' && o.data && !o._el) { var im = new Image(); im.src = o.data; o._el = im; }
      drawOp(ctx, (opt && opt.paper === 'light') ? onPaper(o) : o, sx, sy);
    });
    ctx.restore();
    var url = '';
    try { url = c.toDataURL('image/png'); } catch (e) { return null; }
    return { url: url, x: x, y: y, w: w, h: h, cr: cr, k: sx };
  }

  function inkRec(bank, q) { return inkAll()[keyOf(bank, q)] || null; }

  function boardPng(b) {
    if (!b || !b.ops || !b.ops.length) return '';
    var c = document.createElement('canvas');
    var ctx = fitCanvas(c, b.w || 900, b.h || 600);
    c.getContext('2d').fillStyle = '#fff';
    c.getContext('2d').fillRect(0, 0, b.w || 900, b.h || 600);
    b.ops.forEach(function (o) {
      if (o.t === 'img' && o.data && !o._el) { var im = new Image(); im.src = o.data; o._el = im; }
      drawOp(ctx, o, 1, 1);
    });
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }

  function closeAll() {
    try { window.__inkGen = (window.__inkGen || 0) + 1; } catch (e) {}
    try { if (window.__inkKey) { document.removeEventListener('keydown', window.__inkKey); window.__inkKey = null; } } catch (e) {}
    try { if (window.__inkEsc) { document.removeEventListener('keydown', window.__inkEsc); window.__inkEsc = null; } } catch (e) {}
    try { if (window.__inkRz) { removeEventListener('resize', window.__inkRz); window.__inkRz = null; } } catch (e) {}
    try { if (window.__inkScr) { removeEventListener('scroll', window.__inkScr); window.__inkScr = null; } } catch (e) {}
    try { document.body.classList.remove('ink-on'); } catch (e) {}
    /* 退出批注后，右上角那颗按钮要立刻变回「隐藏/显示批注」 */
    try {
      var eb = document.getElementById('inkEyeBig');
      if (eb) {
        var on = localStorage.getItem('qbank.ink.show.v1') !== '0';
        eb.className = 'ink-eye' + (on ? '' : ' off');
        eb.innerHTML = on ? '<b>🚫</b> 隐藏批注' : '<b>👁</b> 显示批注';
      }
    } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('.ink-wrap,.ink-full,.ink-histmask'), function (el) { el.remove(); });
    document.body.classList.remove('ink-on');
    var fx = document.getElementById('inkFix');
    if (fx) { fx.style.display = 'none'; fx.getContext('2d').clearRect(0, 0, fx.width, fx.height); }
    var cv = document.querySelector('#view .card > canvas.ink-layer');
    if (cv) cv.classList.remove('editing');
    liveStudio = null; liveCv = null; EDIT = null;
  }

  /* 导出用：把这道题里的图片笔迹按文档坐标列出来 */
  function imgList(bank, q) {
    var rec = inkAll()[keyOf(bank, q)];
    if (!rec || !rec.ops) return [];
    return rec.ops.filter(function (o) { return o.t === 'img' && o.data; }).map(function (o) {
      var b = boxOf(o);
      return { data: o.data, x: b.x, y: b.y, w: b.w, h: b.h, op: (o.op == null ? 1 : o.op) };
    });
  }

  /* 把这一题的批注（笔迹 + 图片）烤成一张与卡片同尺寸的透明 PNG；导出时直接贴上去 */
  function bake(bank, q) {
    return new Promise(function (resolve) {
      var rec = inkAll()[keyOf(bank, q)];
      if (!rec || !rec.ops || !rec.ops.length) { resolve(null); return; }
      var cr = rec.cr || { x: 0, y: 0, w: 1180, h: 900 };
      var dpr = Math.min(devicePixelRatio || 1, 2);
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(cr.w * dpr));
      cv.height = Math.max(1, Math.round(cr.h * dpr));
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(-cr.x, -cr.y);
      var jobs = [];
      rec.ops.forEach(function (o) {
        if (o.t !== 'img' || !o.data) return;
        jobs.push(new Promise(function (res) {
          var im = new Image();
          im.onload = function () { res({ o: o, im: im }); };
          im.onerror = function () { res(null); };
          im.src = o.data;
        }));
      });
      Promise.all(jobs).then(function (arr) {
        rec.ops.forEach(function (o) { try { drawOp(ctx, o, 1, 1); } catch (e) {} });
        arr.forEach(function (it) {
          if (!it || !it.im) return;
          var o = it.o, b = boxOf(o);
          ctx.globalAlpha = (o.op == null ? 1 : o.op);
          try { ctx.drawImage(it.im, o.p[0][0], o.p[0][1], b.w, b.h); } catch (e) {}
          ctx.globalAlpha = 1;
        });
        resolve({ url: cv.toDataURL('image/png'), w: cr.w, h: cr.h });
      });
    });
  }

  window.INK = {
    bake: bake, imgList: imgList,
    paint: paint, annotation: annotation, board: board, history: history,
    hasInk: hasInk, pngOf: pngOf, boardPng: boardPng, inkRec: inkRec, boards: boardAll,
    close: closeAll, hideView: hideView, keyOf: keyOf,
    rebind: rebind, isEditing: isEditing,
    count: function () { return Object.keys(inkAll()).length; }
  };
})();
