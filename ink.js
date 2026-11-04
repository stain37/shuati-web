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
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = o.t === 'hl' ? 'butt' : 'round';
    var w = Math.max(1, o.s * sx);
    if (o.t === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = Math.max(12, w * 3); }
    else if (o.t === 'hl') { ctx.strokeStyle = o.c; ctx.globalAlpha = Math.min(0.4, o.a == null ? 1 : o.a); ctx.lineWidth = Math.max(14, w * 4.5); }
    else if (o.t === 'pencil') { ctx.strokeStyle = o.c; ctx.globalAlpha = (o.a == null ? 1 : o.a) * 0.55; ctx.lineWidth = Math.max(1, w * 0.7); }
    else { ctx.strokeStyle = o.c; ctx.globalAlpha = o.a == null ? 1 : o.a; ctx.lineWidth = w; }
    ctx.beginPath();
    if (o.t === 'line' || o.t === 'arrow') {
      var a0 = p[0], b0 = p[1] || p[0];
      ctx.moveTo(a0[0] * sx, a0[1] * sy); ctx.lineTo(b0[0] * sx, b0[1] * sy);
      if (o.t === 'arrow') {
        var ang = Math.atan2(b0[1] * sy - a0[1] * sy, b0[0] * sx - a0[0] * sx), L = (6 + w * 1.8);
        ctx.moveTo(b0[0] * sx, b0[1] * sy); ctx.lineTo(b0[0] * sx - L * Math.cos(ang - 0.4), b0[1] * sy - L * Math.sin(ang - 0.4));
        ctx.moveTo(b0[0] * sx, b0[1] * sy); ctx.lineTo(b0[0] * sx - L * Math.cos(ang + 0.4), b0[1] * sy - L * Math.sin(ang + 0.4));
      }
    } else if (o.t === 'rect') {
      var r0 = p[0], r1 = p[1] || p[0];
      ctx.rect(r0[0] * sx, r0[1] * sy, (r1[0] - r0[0]) * sx, (r1[1] - r0[1]) * sy);
    } else if (o.t === 'ellipse') {
      var e0 = p[0], e1 = p[1] || p[0];
      ctx.ellipse(((e0[0] + e1[0]) / 2) * sx, ((e0[1] + e1[1]) / 2) * sy,
        Math.abs(e1[0] - e0[0]) / 2 * sx, Math.abs(e1[1] - e0[1]) / 2 * sy, 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(p[0][0] * sx, p[0][1] * sy);
      for (var i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * sx, p[i][1] * sy);
      if (p.length === 1) ctx.lineTo(p[0][0] * sx + 0.1, p[0][1] * sy);
    }
    ctx.stroke(); ctx.restore();
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
  function toolsHtml(simple) {
    var penOnly = !!simple;
    return '<div class="ink-tools' + (penOnly ? ' ink-simple' : '') + '">' +
      '<div class="ink-row ink-seg">' +
      '<button data-m="pen" class="on" title="钢笔">✒ 钢笔</button>' +
      '<button data-m="pencil" title="铅笔">✎ 铅笔</button>' +
      '<button data-m="hl" title="荧光笔（半透明，不挡字）">▮ 荧光</button>' +
      '<button data-m="eraser" title="橡皮">◻ 橡皮</button>' +
      (penOnly ? '' :
        '<button data-m="sel" title="鼠标：点中文字/图片直接拖动，拖右下角改大小">✥ 鼠标</button>' +
        '<button data-m="line" title="直线">╱</button>' +
        '<button data-m="rect" title="矩形">▭</button>' +
        '<button data-m="ellipse" title="椭圆">◯</button>' +
        '<button data-m="arrow" title="箭头">↗</button>' +
        '<button data-m="text" title="文字：点画布就地输入">T</button>' +
        '<button data-m="img" title="导入图片">⤒</button>') +
      '</div>' +
      '<div class="ink-row"><span class="ink-sws"></span></div>' +
      (penOnly ? '' : '<div class="ink-row"><span class="ink-lbl">文字底色</span><span class="ink-bgs"></span>' +
      '<label class="ink-chk"><input type="checkbox" class="ink-bgtrans" checked><span>半透明</span></label></div>') +
      '<div class="ink-row ink-sl">' +
      '<span class="ink-lab">粗细</span><input type="range" min="1" max="26" step="1" value="2" class="ink-size">' +
      '<span class="ink-lab">透明</span><input type="range" min="15" max="100" value="100" class="ink-alpha">' +
      '</div>' +
      '<div class="ink-row ink-acts">' +
      '<button class="ink-undo" title="撤销">↶ 撤销</button>' +
      '<button class="ink-clear" title="清空">清空</button>' +
      '<button class="ink-done pri">完成</button>' +
      '</div>' +
      (penOnly ? '' : '<input type="file" accept="image/*" hidden>') +
      '</div>';
  }

  /* 一套画板：cv 画布；getSize 返回逻辑宽高；ops 初始笔迹；onCommit(ops,w,h) 完成时回调 */
  function Studio(opt) {
    var cv = opt.cv, wrap = opt.wrap, st = { tool: 'pen', color: inkAuto(), size: 2, alpha: 1, bg: '', bgA: 1 };
    /* 记一下「刚点过工具栏」，用来阻止文字框被 blur 提前提交 */
    wrap.addEventListener('pointerdown', function () { window.__inkTbDown = Date.now(); }, true);
    if (opt.state) { st.tool = opt.state.tool || st.tool; st.color = opt.state.color || st.color;
      st.size = opt.state.size || st.size; st.alpha = opt.state.alpha == null ? st.alpha : opt.state.alpha; }
    var ops = (opt.ops || []).slice(), cur = null, drag = false, dirty = false;
    var ctx = cv.getContext('2d');
    var size = { w: 1, h: 1 };
    /* 画板是浮动窗口，用户拖着改大小时要重算画布尺寸 */
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

    function resize() {
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (Math.abs(r.width - size.w) < 1 && Math.abs(r.height - size.h) < 1) return;
      size = { w: r.width, h: r.height };
      ctx = fitCanvas(cv, size.w, size.h);
      paint();
    }
    function paint() {
      repaintAll = paint;
      ctx.clearRect(0, 0, size.w, size.h);
      var sx = size.w / (opt.w0 || size.w), sy = size.h / (opt.h0 || size.h);
      for (var i = 0; i < ops.length; i++) drawOp(ctx, ops[i], sx, sy);
      if (cur) drawOp(ctx, cur, sx, sy);
      if (opt.handles) {
        /* 每条文字/图片自带两个把手：顶部圆点＝整块移动，右下角方块＝调大小 */
        for (var hi = 0; hi < ops.length; hi++) {
          var ho = ops[hi]; if (ho.t !== 'text' && ho.t !== 'img') continue;
          var hb = boxOf(ho);
          var k = Math.max(1, sx);
          ctx.save();
          ctx.setLineDash && ctx.setLineDash([4 / k, 3 / k]);
          ctx.strokeStyle = 'rgba(14,165,233,.75)'; ctx.lineWidth = 1.2 / k;
          ctx.strokeRect(hb.x * sx - 2, hb.y * sy - 2, hb.w * sx + 4, hb.h * sy + 4);
          ctx.setLineDash && ctx.setLineDash([]);
          /* 右下角方块：拖它调大小 */
          ctx.fillStyle = '#0ea5e9';
          ctx.fillRect(hb.x * sx + hb.w * sx - 5, hb.y * sy + hb.h * sy - 5, 11 / k, 11 / k);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / k;
          ctx.strokeRect(hb.x * sx + hb.w * sx - 5, hb.y * sy + hb.h * sy - 5, 11 / k, 11 / k);
          ctx.restore();
        }
      }
      if (SEL >= 0 && ops[SEL]) {
        var bb = boxOf(ops[SEL]);
        ctx.save();
        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 1.5 / Math.max(1, sx);
        if (ctx.setLineDash) ctx.setLineDash([5 / Math.max(1, sx), 4 / Math.max(1, sx)]);
        ctx.strokeRect(bb.x * sx - 3, bb.y * sy - 3, bb.w * sx + 6, bb.h * sy + 6);
        ctx.setLineDash && ctx.setLineDash([]);
        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(bb.x * sx + bb.w * sx - 2, bb.y * sy + bb.h * sy - 2, 11 / Math.max(1, sx), 11 / Math.max(1, sx));
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

    function openText(p, editIdx) {
      var old = editIdx >= 0 ? ops[editIdx] : null;
      /* 输入框要贴在「点下去的那个位置」，所以挂到画布所在容器（题目卡片）里，
         不能挂进底部工具条——那样会跑到工具条上面去，看着像没反应 */
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
        if (v.trim()) { ops.push(cfg({ t: 'text', txt: v, p: [[p0[0], p0[1]]] })); dirty = true; paint(); }
      }
      inp.addEventListener('blur', function () {
        /* 点工具栏（换色、改字号）不该把文字框提交掉 */
        if (Date.now() - (window.__inkTbDown || 0) < 400) { try { setTimeout(function () { inp.focus(); }, 0); } catch (e) {} return; }
        commit();
      });
      inp.addEventListener('keydown', function (e) {
        /* 回车换行，Ctrl/⌘+回车或点「完成」才落字 */
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
    var SEL = -1;                       /* 选中的图片下标，用来拖动 / 改大小 */
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
        var w = o.w || 200, h = w * ((o._el && o._el.naturalWidth) ? (o._el.naturalHeight / o._el.naturalWidth) : 0.6);
        if (p[0] >= o.p[0][0] - 6 && p[0] <= o.p[0][0] + w + 6 && p[1] >= o.p[0][1] - 6 && p[1] <= o.p[0][1] + h + 6) return i;
      }
      return -1;
    }
    var imgDrag = null, textDrag = null, selDrag = null;
    function boxOf(o) {
      if (!o) return { x: 0, y: 0, w: 0, h: 0 };
      if (o.t === 'img') {
        var w = o.w || 200, h = w * ((o._el && o._el.naturalWidth) ? (o._el.naturalHeight / o._el.naturalWidth) : 0.6);
        return { x: o.p[0][0], y: o.p[0][1], w: w, h: h };
      }
      var tm = textMetrics(o);
      return { x: o.p[0][0], y: o.p[0][1], w: tm.w, h: tm.h };
    }

    cv.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var p = pt(ev);
      if (st.tool === 'text') {
        ev.preventDefault();
        var ii = hitImg(p);
        if (ii >= 0) {
          /* 图片：按住本体直接拖动 */
          imgDrag = { i: ii, dx: p[0] - ops[ii].p[0][0], dy: p[1] - ops[ii].p[0][1] };
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          cv.style.cursor = 'move';
          return;
        }
        var ti = hitText(p);
        if (ti >= 0) {
          /* 按住已有的字拖动＝挪位置；只是点一下＝改字 */
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
          ev.preventDefault();
          SEL = hh.i;
          var hb2 = boxOf(ops[hh.i]);
          selDrag = { i: hh.i, handle: true, mode: hh.mode, x0: p[0], y0: p[1],
                      org: { x: hb2.x, y: hb2.y, w: hb2.w, h: hb2.h, s: ops[hh.i].s || 2 } };
          if (ops[hh.i].t === 'text' && !(ops[hh.i].w > 10)) ops[hh.i].w = Math.round(hb2.w);
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          cv.style.cursor = hh.mode === 'resize' ? 'nwse-resize' : 'move';
          paint();
          return;
        }
      }
      if (st.tool === 'sel') {
        ev.preventDefault();
        var si = hitImg(p); if (si < 0) si = hitText(p);
        SEL = si;
        if (si >= 0) {
          var bb = boxOf(ops[si]);
          var onCorner = p[0] > bb.x + bb.w - 22 && p[1] > bb.y + bb.h - 22;
          selDrag = { i: si, mode: onCorner ? 'resize' : 'move', x0: p[0], y0: p[1],
                      org: { x: bb.x, y: bb.y, w: bb.w, h: bb.h, s: ops[si].s || 2 } };
          try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
          var so = ops[si];
          if (so && so.t === 'text') {
            st.color = so.c || st.color; st.size = so.s || st.size;
            st.bg = so.bg || ''; st.bgA = so.ba == null ? 1 : so.ba;
            var sl0 = tb.querySelector('.ink-size'); if (sl0) sl0.value = st.size;
          }
          syncSize();
        }
        paint();
        return;
      }
      ev.preventDefault();
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      drag = true;
      cur = cfg({ t: st.tool, p: [p] });
      paint();
    });
    cv.addEventListener('pointermove', function (ev) {
      if (selDrag) {
        var sp = pt(ev), so = ops[selDrag.i];
        if (so) {
          if (selDrag.mode === 'move') {
            so.p[0][0] = Math.round(selDrag.org.x + (sp[0] - selDrag.x0));
            so.p[0][1] = Math.round(selDrag.org.y + (sp[1] - selDrag.y0));
          } else {
            var dxr = sp[0] - selDrag.x0;
            if (so.t === 'img') so.w = Math.max(24, Math.round(selDrag.org.w + dxr));
            else {
              var nw = Math.max(48, Math.round(selDrag.org.w + dxr));
              var ratio = nw / Math.max(1, selDrag.org.w);
              so.w = nw;
              so.s = Math.max(1, Math.min(40, Math.round((selDrag.org.s || 2) * ratio)));
            }
          }
          dirty = true; paint();
        }
        return;
      }
      if (textDrag) {
        var tp = pt(ev);
        var dx = tp[0] - textDrag.x0, dy = tp[1] - textDrag.y0;
        textDrag.moved = Math.max(textDrag.moved, Math.abs(dx) + Math.abs(dy));
        var to = ops[textDrag.i];
        if (to && textDrag.moved > 3) {
          to.p[0][0] = Math.round(textDrag.org[0][0] + dx);
          to.p[0][1] = Math.round(textDrag.org[0][1] + dy);
          dirty = true; paint();
        }
        return;
      }
      if (imgDrag) {
        var ip = pt(ev), im = ops[imgDrag.i];
        if (im) { im.p[0][0] = Math.round(ip[0] - imgDrag.dx); im.p[0][1] = Math.round(ip[1] - imgDrag.dy); dirty = true; paint(); }
        return;
      }
      if (!drag || !cur) return;
      var p = pt(ev);
      if (SHAPES[cur.t]) cur.p[1] = p; else cur.p.push(p);
      if (cur.t === 'eraser') {
        /* 橡皮只在「新擦过的那一段」上打洞，不回重放整页——大页面上也能跟手 */
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
        if (selDrag) { selDrag = null; cv.style.cursor = 'default'; paint(); return; }
        if (textDrag) {
          var td = textDrag; textDrag = null;
          cv.style.cursor = 'text';
          if (td.moved <= 3) {
            /* 没拖动＝改字：沿用原来的颜色和字号 */
            var op0 = ops[td.i];
            if (op0) { st.color = op0.c || st.color; st.size = op0.s || st.size; }
            openText([td.x0, td.y0], td.i);
          } else { paint(); }
          return;
        }
        if (imgDrag) { imgDrag = null; return; }
        if (!drag) return;
        drag = false;
        if (cur) { ops.push(cur); dirty = true; }
        cur = null; paint();
      });
    });

    var tb = wrap.querySelector('.ink-tools');
    function syncSize() {
      if (SEL < 0) return;
      var im = ops[SEL]; if (!im || im.t !== 'img') return;
      var v = Math.max(1, Math.min(26, Math.round((im.w || 288) / 24)));
      st.size = v;
      var sl = tb.querySelector('.ink-size'); if (sl) sl.value = v;
    }
    var seg = tb.querySelector('.ink-seg');
    seg.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.m === 'img') { tb.querySelector('input[type=file]').click(); return; }
      Array.prototype.forEach.call(seg.children, function (x) { x.classList.remove('on'); });
      b.classList.add('on'); st.tool = b.dataset.m;
      cv.style.cursor = st.tool === 'text' ? 'text' : 'crosshair';
    };
    var sws = tb.querySelector('.ink-sws');
    var pal = [inkAuto()].concat(COLORS);
    pal.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'ink-sw' + (i === 0 ? ' on' : '');
      b.title = i === 0 ? '跟随主题（深色主题下就是这个浅色）' : '';
      b.style.background = c;
      b.onclick = function () {
        st.color = c;
        Array.prototype.forEach.call(sws.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        /* 正在打字的文字框也跟着换色 */
        Array.prototype.forEach.call(document.querySelectorAll('.ink-txt'), function (x) { x.style.color = c; });
        /* 已经选中的文字也跟着换色 */
        if (SEL >= 0 && ops[SEL] && ops[SEL].t === 'text') { ops[SEL].c = c; dirty = true; paint(); }
      };
      sws.appendChild(b);
    });
    /* 文字底色：无 / 白 / 黄 / 绿 / 蓝 / 黑（配下面的「半透明」开关） */
    var bgs = tb.querySelector('.ink-bgs');
    var BGS = [['', '无'], ['#ffffff', '白'], ['#fff3a3', '黄'], ['#d1fae5', '绿'], ['#dbeafe', '蓝'], ['#111827', '黑']];
    BGS.forEach(function (pair, i) {
      var b = document.createElement('button');
      b.className = 'ink-bg' + (i === 0 ? ' on' : '');
      b.title = pair[1] + '底';
      b.style.background = pair[0] || 'transparent';
      if (!pair[0]) b.textContent = '∅';
      b.onclick = function () {
        st.bg = pair[0] || '';
        Array.prototype.forEach.call(bgs.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        if (SEL >= 0 && ops[SEL] && ops[SEL].t === 'text') {
          if (st.bg) ops[SEL].bg = st.bg; else delete ops[SEL].bg;
          ops[SEL].ba = st.bgA;
          dirty = true; paint();
        }
      };
      bgs.appendChild(b);
    });
    var bgt = tb.querySelector('.ink-bgtrans');
    if (bgt) bgt.onchange = function () {
      st.bgA = bgt.checked ? 0.45 : 1;
      if (SEL >= 0 && ops[SEL] && ops[SEL].t === 'text') { ops[SEL].ba = st.bgA; dirty = true; paint(); }
    };
    tb.querySelector('.ink-size').oninput = function (e) {
      st.size = +e.target.value;
      /* 正在打的字也跟着变大小 */
      Array.prototype.forEach.call(document.querySelectorAll('.ink-txt'), function (x) {
        x.style.fontSize = Math.round(14 + st.size * 2.2) + 'px';
      });
      if (SEL < 0 || !ops[SEL]) return;
      var so = ops[SEL];
      if (so.t === 'img') so.w = Math.round(st.size * 24);
      else if (so.t === 'text') so.s = st.size;
      else return;
      dirty = true; paint();
    };
    tb.querySelector('.ink-alpha').oninput = function (e) { st.alpha = +e.target.value / 100; };
    tb.querySelector('.ink-undo').onclick = function () { if (ops.length) { ops.pop(); dirty = true; paint(); } };
    tb.querySelector('.ink-clear').onclick = function () { if (!ops.length) return; if (confirm('清空这一层的全部笔迹？')) { ops = []; dirty = true; paint(); } };
    var file = tb.querySelector('input[type=file]');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          /* 存进 localStorage 前先压到 900px 宽的 JPEG，别把本地存储撑爆 */
          var mw = Math.min(900, img.naturalWidth), mh = Math.round(img.naturalHeight * mw / img.naturalWidth);
          var c2 = document.createElement('canvas'); c2.width = mw; c2.height = mh;
          c2.getContext('2d').drawImage(img, 0, 0, mw, mh);
          var data = c2.toDataURL('image/jpeg', 0.72);
          var W = (opt.w0 || size.w), H = (opt.h0 || size.h);
          ops.push({ t: 'img', data: data, x: 0, y: 0, w: Math.min(420, mw), nw: mw, nh: mh, _el: img, p: [[Math.round(W * 0.16), Math.round(H * 0.12)]], a: 1 });
          SEL = ops.length - 1; syncSize(); hydrate(ops); dirty = true; paint();
        };
        img.src = r.result;
      };
      r.readAsDataURL(f); file.value = '';
    });

    function hydrate(list) {      list.forEach(function (o) {
        if (o.t === 'img' && o.data && !o._el) {
          var im = new Image(); im.onload = function () { paint(); }; im.src = o.data; o._el = im;
        }
      });
    }
    hydrate(ops);

    tb.querySelector('.ink-done').onclick = function () {
      opt.onDone(ops, opt.w0 || size.w, opt.h0 || size.h, dirty);
    };
    window.addEventListener('resize', function () { setTimeout(resize, 60); });
    setTimeout(resize, 20);
    return { resize: resize, paint: paint, ops: function () { return ops; },
      state: function () { return { tool: st.tool, color: st.color, size: st.size, alpha: st.alpha }; } };
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

  function inkShow() {
    try { return localStorage.getItem('qbank.ink.show.v1') !== '0'; } catch (e) { return true; }
  }

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

  function paint(bank, q) {
    if (!bank || !q) return;
    var cv = viewLayer();
    var rec = INK_MEM[keyOf(bank, q)] || inkAll()[keyOf(bank, q)];
    if (!rec || !rec.ops || !rec.ops.length || !inkShow()) { cv.style.display = 'none'; var L0 = document.getElementById('inkImgLayer'); if (L0) { L0.innerHTML = ''; L0._im = {}; L0.style.display = 'none'; } return; }
    var editing = !!EDIT;
    cv.style.display = editing ? 'none' : 'block';
    if (editing) return;
    var k = 1;
    var s = vpSize(cv, 1);
    var ctx = fitCanvas(cv, s.cw, s.ch);
    var sx = 1, sy = 1;
    repaintAll = function () { paint(bank, q); };   /* 图片解码完成后回一次，否则首帧画不出来 */
    rec.ops.forEach(function (o) {
      drawOp(ctx, o, sx, sy);
    });
    /* 图片单独用真 <img> 叠上去：canvas 画图在这套缩放里不可靠，DOM 一定画得出来。
       复用已有节点，只改位置/尺寸，避免每次重画都重建导致闪烁 */
    var lay = document.getElementById('inkImgLayer');
    if (!lay) { lay = document.createElement('div'); lay.id = 'inkImgLayer'; lay.className = 'ink-imgs'; document.body.appendChild(lay); }
    var keep = [];
    lay._im = lay._im || {};
    rec.ops.forEach(function (o, i) {
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
    wrap.innerHTML = toolsHtml(true);
    document.body.appendChild(wrap);


    var s = vpSize(cv, 1);
    fitCanvas(cv, s.cw, s.ch);
    EDIT = { bankId: bank.id, qid: q.id, w0: s.cw, h0: s.ch };
    liveCv = cv;
    liveStudio = Studio({
      cv: cv, wrap: wrap, ops: ops || [], state: state || null,
      w0: s.cw, h0: s.ch, handles: true,
      onDone: function (o, w, h, dirty) {
        var all = inkAll(), prevRec = all[keyOf(bank, q)];
        var r0 = card.getBoundingClientRect();
        var cr = { x: Math.round(r0.left + scrollX), y: Math.round(r0.top + scrollY), w: Math.round(r0.width), h: Math.round(r0.height) };
        if (dirty || (prevRec && prevRec.ops) || o.length) {
          if (o.length) INK_MEM[keyOf(bank, q)] = {
            ops: o, vw: Math.max(document.documentElement.scrollWidth, innerWidth),
            vh: Math.max(document.documentElement.scrollHeight, innerHeight),
            cr: cr, ts: Date.now()
          };
          else delete all[keyOf(bank, q)];
          if (!lsSet(INK_KEY, all)) toast('本地存储满了，这条批注没存下', 2600, 'bad');
        }
        closeAll();
        paint(bank, q);
        if (typeof window.paintInkDot === 'function') window.paintInkDot();
      }
    });
    setTimeout(function () { if (liveStudio) liveStudio.resize(); }, 30);
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
      cv: cv, wrap: wrap, ops: [], w0: Math.round(stage.getBoundingClientRect().width), h0: Math.round(stage.getBoundingClientRect().height),
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
        dt.getMonth() + 1 + '/' + dt.getDate() + ' ' + ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2) + '</span>';
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
    close: closeAll, keyOf: keyOf,
    rebind: rebind, isEditing: isEditing,
    count: function () { return Object.keys(inkAll()).length; }
  };
})();
