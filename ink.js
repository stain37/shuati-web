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
  var BOARD_KEY = 'qbank.board.v1';
  var COLORS = ['#111827', '#e11d48', '#f59e0b', '#0f9d58', '#2563eb', '#7c3aed'];
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
  function fontOf(o, scale) { return '600 ' + Math.round((12 + o.s * 1.6) * scale) + 'px system-ui,"Microsoft YaHei",sans-serif'; }

  function drawOp(ctx, o, sx, sy) {
    sx = sx || 1; sy = sy || 1;
    if (!o) return;
    if (o.t === 'text') {
      ctx.save();
      ctx.fillStyle = o.c; ctx.globalAlpha = o.a == null ? 1 : o.a;
      ctx.font = fontOf(o, sx); ctx.textBaseline = 'top';
      ctx.fillText(o.txt, o.p[0][0] * sx, o.p[0][1] * sy);
      ctx.restore(); return;
    }
    if (o.t === 'img') {
      if (o._el && o._el.complete) {
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
  function toolsHtml() {
    return '<div class="ink-tools">' +
      '<div class="ink-row ink-seg">' +
      '<button data-m="pen" class="on" title="钢笔">✒ 钢笔</button>' +
      '<button data-m="pencil" title="铅笔">✎ 铅笔</button>' +
      '<button data-m="hl" title="荧光笔（半透明，不挡字）">▮ 荧光</button>' +
      '<button data-m="eraser" title="橡皮">◻ 橡皮</button>' +
      '<button data-m="line" title="直线">╱</button>' +
      '<button data-m="rect" title="矩形">▭</button>' +
      '<button data-m="ellipse" title="椭圆">◯</button>' +
      '<button data-m="arrow" title="箭头">↗</button>' +
      '<button data-m="text" title="文字：点画布就地输入">T</button>' +
      '<button data-m="img" title="导入图片">⤒</button>' +
      '</div>' +
      '<div class="ink-row"><span class="ink-sws"></span></div>' +
      '<div class="ink-row ink-sl">' +
      '<span class="ink-lab">粗细</span><input type="range" min="1" max="26" step="1" value="2" class="ink-size">' +
      '<span class="ink-lab">透明</span><input type="range" min="15" max="100" value="100" class="ink-alpha">' +
      '</div>' +
      '<div class="ink-row ink-acts">' +
      '<button class="ink-undo" title="撤销">↶ 撤销</button>' +
      '<button class="ink-clear" title="清空">清空</button>' +
      '<button class="ink-done pri">完成</button>' +
      '</div>' +
      '<input type="file" accept="image/*" hidden>' +
      '</div>';
  }

  /* 一套画板：cv 画布；getSize 返回逻辑宽高；ops 初始笔迹；onCommit(ops,w,h) 完成时回调 */
  function Studio(opt) {
    var cv = opt.cv, wrap = opt.wrap, st = { tool: 'pen', color: COLORS[0], size: 2, alpha: 1 };
    var ops = (opt.ops || []).slice(), cur = null, drag = false, dirty = false;
    var ctx = cv.getContext('2d');
    var size = { w: 1, h: 1 };

    function resize() {
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (Math.abs(r.width - size.w) < 1 && Math.abs(r.height - size.h) < 1) return;
      size = { w: r.width, h: r.height };
      ctx = fitCanvas(cv, size.w, size.h);
      paint();
    }
    function paint() {
      ctx.clearRect(0, 0, size.w, size.h);
      var sx = size.w / (opt.w0 || size.w), sy = size.h / (opt.h0 || size.h);
      for (var i = 0; i < ops.length; i++) drawOp(ctx, ops[i], sx, sy);
      if (cur) drawOp(ctx, cur, sx, sy);
    }
    function pt(ev) {
      var r = cv.getBoundingClientRect();
      var lw = r.width || size.w || 1, lh = r.height || size.h || 1;
      var sx = (opt.w0 || lw) / lw;
      var sy = (opt.h0 || lh) / lh;
      return [Math.round((ev.clientX - r.left) * sx), Math.round((ev.clientY - r.top) * sy)];
    }
    function cfg(o) { o.c = st.color; o.s = st.size; o.a = st.alpha; return o; }

    function openText(p, editIdx) {
      var old = editIdx >= 0 ? ops[editIdx] : null;
      var host = wrap; var ir = cv.getBoundingClientRect(), cr = host.getBoundingClientRect();
      var sx = (size.w) / (opt.w0 || size.w);
      var inp = document.createElement('input');
      inp.className = 'ink-txt';
      inp.style.left = Math.max(2, ((old ? old.p[0][0] : p[0]) / (opt.w0 || size.w)) * size.w) + 'px';
      inp.style.top = Math.max(2, ((old ? old.p[0][1] : p[1]) / (opt.h0 || size.h)) * size.h) + 'px';
      inp.style.color = st.color;
      inp.style.fontSize = Math.round((12 + st.size * 1.6) * 1) + 'px';
      host.appendChild(inp);
      inp.value = old ? old.txt : '';
      if (old) { ops.splice(editIdx, 1); paint(); }
      setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 0);
      var closed = false;
      function commit() {
        if (closed) return; closed = true;
        var v = inp.value.trim(); inp.remove();
        if (v) { ops.push(cfg({ t: 'text', txt: v, p: [old ? old.p[0] : p[0], old ? old.p[0][1] : p[1]] })); dirty = true; paint(); }
      }
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); closed = true; inp.remove(); if (old) { ops.push(old); paint(); } }
      });
    }
    function hitText(p) {
      for (var i = ops.length - 1; i >= 0; i--) {
        var o = ops[i]; if (o.t !== 'text') continue;
        var c = document.createElement('canvas').getContext('2d');
        c.font = fontOf(o, 1);
        var w = c.measureText(o.txt).width, h = (12 + o.s * 1.6);
        if (p[0] >= o.p[0][0] - 6 && p[0] <= o.p[0][0] + w + 6 && p[1] >= o.p[0][1] - 6 && p[1] <= o.p[0][1] + h + 6) return i;
      }
      return -1;
    }

    cv.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      var p = pt(ev);
      if (st.tool === 'text') { ev.preventDefault(); openText(p, hitText(p)); return; }
      ev.preventDefault();
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
      drag = true;
      cur = cfg({ t: st.tool, p: [p] });
      paint();
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drag || !cur) return;
      var p = pt(ev);
      if (SHAPES[cur.t]) cur.p[1] = p; else cur.p.push(p);
      paint();
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () {
        if (!drag) return;
        drag = false;
        if (cur) { ops.push(cur); dirty = true; }
        cur = null; paint();
      });
    });

    var tb = wrap.querySelector('.ink-tools');
    var seg = tb.querySelector('.ink-seg');
    seg.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.m === 'img') { tb.querySelector('input[type=file]').click(); return; }
      Array.prototype.forEach.call(seg.children, function (x) { x.classList.remove('on'); });
      b.classList.add('on'); st.tool = b.dataset.m;
      cv.style.cursor = st.tool === 'text' ? 'text' : 'crosshair';
    };
    var sws = tb.querySelector('.ink-sws');
    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.className = 'ink-sw' + (i === 0 ? ' on' : '');
      b.style.background = c;
      b.onclick = function () {
        st.color = c;
        Array.prototype.forEach.call(sws.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
      sws.appendChild(b);
    });
    tb.querySelector('.ink-size').oninput = function (e) { st.size = +e.target.value; };
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
          ops.push({ t: 'img', data: data, x: 0, y: 0, w: W * 0.42, p: [[W * 0.16, H * 0.12]], a: 1 });
          hydrate(ops); dirty = true; paint();
        };
        img.src = r.result;
      };
      r.readAsDataURL(f); file.value = '';
    });

    function hydrate(list) {
      list.forEach(function (o) {
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
    return { resize: resize, paint: paint, ops: function () { return ops; } };
  }

  /* ---------- 批注 ---------- */
  var liveCv = null, liveStudio = null;

  function cardOf() { return document.querySelector('#view .card') || null; }

  function ensureLayer() {
    var card = cardOf(); if (!card) return null;
    var cv = card.querySelector(':scope > canvas.ink-layer');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'ink-layer';
      card.appendChild(cv);
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    }
    return cv;
  }

  function paint(bank, q) {
    if (!bank || !q) return;
    var cv = ensureLayer(); if (!cv) return;
    var rec = inkAll()[keyOf(bank, q)];
    if (!rec || !rec.ops || !rec.ops.length) {
      cv.style.display = 'none';
      return;
    }
    cv.style.display = 'block';
    var r = cv.parentElement.getBoundingClientRect();
    var ctx = fitCanvas(cv, r.width, r.height);
    ctx.clearRect(0, 0, r.width, r.height);
    var sx = r.width / (rec.w || r.width), sy = r.height / (rec.h || r.height);
    rec.ops.forEach(function (o) {
      if (o.t === 'img' && o.data && !o._el) { var im = new Image(); im.onload = function () { paint(bank, q); }; im.src = o.data; o._el = im; }
      drawOp(ctx, o, sx, sy);
    });
  }

  function hasInk(bank, q) {
    var rec = inkAll()[keyOf(bank, q)];
    return !!(rec && rec.ops && rec.ops.length);
  }

  function annotation(bank, q) {
    if (!bank || !q) return;
    closeAll();
    var card = cardOf(); if (!card) return;
    var cv = ensureLayer();
    cv.classList.add('editing');
    cv.style.display = 'block';
    document.body.classList.add('ink-on');

    var wrap = document.createElement('div');
    wrap.className = 'ink-wrap';
    wrap.innerHTML = toolsHtml();
    document.body.appendChild(wrap);

    var rec = inkAll()[keyOf(bank, q)] || null;
    var r = card.getBoundingClientRect();
    liveStudio = Studio({
      cv: cv, wrap: wrap, ops: (rec && rec.ops) || [],
      w0: (rec && rec.w) || Math.round(r.width), h0: (rec && rec.h) || Math.round(r.height),
      onDone: function (ops, w, h, dirty) {
        var all = inkAll();
        if (dirty || (rec && rec.ops) || ops.length) {
          if (ops.length) all[keyOf(bank, q)] = { ops: ops, w: w, h: h, ts: Date.now() };
          else delete all[keyOf(bank, q)];
          if (!lsSet(INK_KEY, all)) toast('本地存储满了，这条批注没存下', 2600, 'bad');
        }
        closeAll();
        paint(bank, q);
        if (typeof window.paintInkDot === 'function') window.paintInkDot();
      }
    });
    liveCv = cv;
    setTimeout(function () { liveStudio.resize(); }, 30);
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

  function pngOf(bank, q) {
    var rec = inkAll()[keyOf(bank, q)];
    if (!rec || !rec.ops || !rec.ops.length) return '';
    var c = document.createElement('canvas');
    var ctx = fitCanvas(c, rec.w || 800, rec.h || 600);
    rec.ops.forEach(function (o) {
      if (o.t === 'img' && o.data && !o._el) { var im = new Image(); im.src = o.data; o._el = im; }
      drawOp(ctx, o, 1, 1);
    });
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }

  function closeAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.ink-wrap,.ink-full,.ink-histmask'), function (el) { el.remove(); });
    document.body.classList.remove('ink-on');
    var cv = document.querySelector('#view .card > canvas.ink-layer');
    if (cv) cv.classList.remove('editing');
    liveStudio = null; liveCv = null;
  }

  window.INK = {
    paint: paint, annotation: annotation, board: board, history: history,
    hasInk: hasInk, pngOf: pngOf, close: closeAll, keyOf: keyOf,
    count: function () { return Object.keys(inkAll()).length; }
  };
})();
