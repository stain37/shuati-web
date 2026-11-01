/* ===== 画中画答题小窗 pip.js（P1：窗口壳 + 单窗） =====
   做法：包一层 renderQuiz，答题页每次重画后把刚渲染出来的那张卡「搬」进浮窗，
   页面原位留一个占位块。所以窗口里跑的就是原版答题卡：选项、提交、解析、口诀、专注、
   收藏、更多抽屉、答题卡、速刷/背题全都在，事件绑定也都在。
   窗口可拖（顶部横杠）、可拉大小（右下角）、可放大、可最小化成气泡（气泡可拖并吸附侧边）。 */
(function () {
  const K = 'qbank.pip.v1';
  const LS = {
    get() { try { return JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(K, JSON.stringify(v)); } catch (e) {} }
  };
  let ST = LS.get();
  let win = null, layer = null, bubble = null, body = null;
  let open = false, minimized = false, maximized = false;
  let holder = null;

  const isQuiz = () => /^#\/bank\//.test(location.hash || '');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function mkLayer() {
    if (!layer) { layer = document.createElement('div'); layer.id = 'pipLayer'; document.body.appendChild(layer); }
    return layer;
  }

  function build() {
    if (win) return win;
    mkLayer();
    win = document.createElement('section');
    win.id = 'pipWin';
    win.innerHTML =
      '<div class="pip-bar" data-drag><i class="pip-grip"></i><span class="pip-t">答题小窗</span>' +
      '<span class="pip-i"></span><span class="pip-sp"></span>' +
      '<button class="pip-btn" data-max title="放大 / 还原">⤢</button>' +
      '<button class="pip-btn" data-min title="最小化成气泡">—</button>' +
      '<button class="pip-btn" data-close title="关闭，把答题卡放回页面">✕</button></div>' +
      '<div class="pip-body"></div><i class="pip-rz" data-rz title="拖动改大小"></i>';
    layer.appendChild(win);
    body = win.querySelector('.pip-body');
    bindWin();
    return win;
  }

  function geo() {
    if (!win) return;
    const w = win.offsetWidth || 380, h = win.offsetHeight || 300;
    const x = clamp(ST.x == null ? innerWidth - w - 16 : ST.x, 0, Math.max(0, innerWidth - w));
    const y = clamp(ST.y == null ? 56 : ST.y, 0, Math.max(0, innerHeight - h));
    win.style.left = x + 'px'; win.style.top = y + 'px';
    if (!maximized) {
      win.style.width = (ST.w || 400) + 'px';
      win.style.height = (ST.h || 340) + 'px';
    }
  }

  function save() {
    if (!win || minimized) return;
    ST.x = parseInt(win.style.left) || 0;
    ST.y = parseInt(win.style.top) || 0;
    ST.w = win.offsetWidth; ST.h = win.offsetHeight;
    ST.min = false; LS.set(ST);
  }

  function bindWin() {
    const bar = win.querySelector('[data-drag]');
    const rz = win.querySelector('[data-rz]');
    let drag = null;
    bar.addEventListener('pointerdown', e => {
      if (maximized || e.target.closest('.pip-btn')) return;
      drag = { x: e.clientX, y: e.clientY, ox: parseInt(win.style.left) || 0, oy: parseInt(win.style.top) || 0 };
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', e => {
      if (!drag) return;
      const w = win.offsetWidth, h = win.offsetHeight;
      win.style.left = clamp(drag.ox + (e.clientX - drag.x), 0, Math.max(0, innerWidth - w)) + 'px';
      win.style.top = clamp(drag.oy + (e.clientY - drag.y), 0, Math.max(0, innerHeight - h)) + 'px';
    });
    const endDrag = () => { if (drag) { drag = null; save(); } };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    let rzOn = false, rw = 0, rh = 0, rx = 0, ry = 0;
    rz.addEventListener('pointerdown', e => {
      if (maximized) return;
      rzOn = true; rw = win.offsetWidth; rh = win.offsetHeight; rx = e.clientX; ry = e.clientY;
      rz.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
    });
    rz.addEventListener('pointermove', e => {
      if (!rzOn) return;
      win.style.width = clamp(rw + (e.clientX - rx), 300, Math.min(980, innerWidth - 12)) + 'px';
      win.style.height = clamp(rh + (e.clientY - ry), 200, Math.min(760, innerHeight - 12)) + 'px';
    });
    const endRz = () => { if (rzOn) { rzOn = false; save(); } };
    rz.addEventListener('pointerup', endRz);
    rz.addEventListener('pointercancel', endRz);

    win.querySelector('[data-max]').onclick = () => {
      maximized = !maximized;
      win.classList.toggle('max', maximized);
      if (!maximized) geo();
    };
    win.querySelector('[data-min]').onclick = minimize;
    win.querySelector('[data-close]').onclick = close;
  }

  /* ---------- 把页面里的答题卡搬进窗口 ---------- */
  function absorb() {
    if (!open || !win || !isQuiz()) return;
    const v = document.getElementById('view');
    if (!v) return;
    const c = v.querySelector(':scope > .card');
    const nav = document.getElementById('nav');
    if (!c && !body.querySelector('.card')) return;

    if (!holder) { holder = document.createElement('div'); holder.id = 'pipHolder'; }
    holder.textContent = '答题卡在小窗里 · 点窗口右上角 ✕ 放回页面';
    if (c) {
      const old = body.querySelector('.card');
      if (old && old !== c) old.remove();
      body.insertBefore(c, body.firstChild);
      holder.style.minHeight = Math.min(460, c.offsetHeight || 460) + 'px';
    }
    if (nav && nav.parentNode !== body) body.appendChild(nav);
    if (!holder.parentNode) v.insertBefore(holder, v.firstChild || null);
    refreshTitle();
  }

  function refreshTitle() {
    if (!win) return;
    const t = (document.getElementById('appTitle') || {}).textContent || '答题';
    win.querySelector('.pip-t').textContent = t;
    const mid = document.querySelector('#pipWin .pip-body #nav .mid, #pipWin .pip-body #nav button:nth-child(2)');
    win.querySelector('.pip-i').textContent = mid ? (' ' + mid.textContent.replace(/\s+/g, ' ').trim()) : '';
  }

  /* ---------- 气泡 ---------- */
  function buildBubble() {
    if (bubble) return bubble;
    mkLayer();
    bubble = document.createElement('button');
    bubble.id = 'pipBubble';
    bubble.title = '答题小窗（可拖动，松手吸附到左右侧边；点一下还原）';
    bubble.innerHTML = '<b></b><span></span><i></i>';
    layer.appendChild(bubble);

    let ing = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
    bubble.addEventListener('pointerdown', e => {
      ing = true; moved = false; sx = e.clientX; sy = e.clientY;
      ox = bubble.offsetLeft; oy = bubble.offsetTop;
      bubble.setPointerCapture(e.pointerId); e.preventDefault();
    });
    bubble.addEventListener('pointermove', e => {
      if (!ing) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      const w = bubble.offsetWidth, h = bubble.offsetHeight;
      bubble.style.left = clamp(ox + dx, 6, innerWidth - w - 6) + 'px';
      bubble.style.top = clamp(oy + dy, 6, innerHeight - h - 96) + 'px';
      bubble.style.right = 'auto';
    });
    const up = () => {
      if (!ing) return; ing = false;
      if (!moved) { restore(); return; }
      const w = bubble.offsetWidth, cx = bubble.offsetLeft + w / 2;
      const side = cx < innerWidth / 2 ? 'left' : 'right';
      bubble.style.left = side === 'left' ? '6px' : 'auto';
      bubble.style.right = side === 'left' ? 'auto' : '6px';
      bubble.style.top = clamp(bubble.offsetTop, 6, innerHeight - bubble.offsetHeight - 96) + 'px';
      bubble.classList.toggle('left', side === 'left');
      ST.side = side; ST.by = parseInt(bubble.style.top) || 0; LS.set(ST);
    };
    bubble.addEventListener('pointerup', up);
    bubble.addEventListener('click', () => { if (!moved) restore(); });   /* 键盘/程序化点击也能还原 */
    bubble.addEventListener('pointercancel', () => { ing = false; });
    return bubble;
  }

  function minimize() {
    if (!win || !open) return;
    minimized = true;
    const b = buildBubble();
    const n = document.querySelector('#pipWin .pip-body #nav .mid, #pipWin .pip-body #nav button:nth-child(2)');
    b.querySelector('b').textContent = ((document.getElementById('appTitle') || {}).textContent || '答题').slice(0, 5);
    b.querySelector('span').textContent = n ? n.textContent.replace(/\s+/g, ' ').trim().slice(0, 8) : '';
    b.style.top = (ST.by || Math.max(96, innerHeight - 160)) + 'px';
    b.classList.toggle('left', ST.side === 'left');
    b.style.left = ST.side === 'left' ? '6px' : 'auto';
    b.style.right = ST.side === 'left' ? 'auto' : '6px';
    b.style.display = 'flex';
    win.style.display = 'none';
    ST.min = true; LS.set(ST);
  }

  function restore() {
    minimized = false;
    if (bubble) bubble.style.display = 'none';
    if (win) { win.style.display = 'flex'; geo(); }
    ST.min = false; LS.set(ST);
  }

  function pop() {
    if (open) { restore(); return true; }
    build();
    open = true; minimized = false; maximized = false;
    win.classList.remove('max');
    win.style.display = 'flex';
    geo();
    absorb();
    save();
    ST.open = true; LS.set(ST);
    return true;
  }

  function close() {
    if (!open) return;
    const card = body && body.querySelector('.card');
    const nav = document.getElementById('nav');
    if (holder && holder.parentNode && card) {
      holder.parentNode.insertBefore(card, holder);
      holder.remove();
    }
    if (nav && nav.parentNode === body) document.body.appendChild(nav);
    holder = null;
    if (body) body.innerHTML = '';
    open = false; minimized = false;
    if (win) { win.style.display = 'none'; win.classList.remove('max'); }
    if (bubble) bubble.style.display = 'none';
    ST.open = false; ST.min = false; LS.set(ST);
  }

  /* ---------- 入口按钮 ---------- */
  function ensureEntry() {
    if (!isQuiz()) return;
    const head = document.querySelector('#view .qhead');
    if (!head || document.getElementById('pipOpen')) return;
    const b = document.createElement('button');
    b.className = 'btn';
    b.id = 'pipOpen';
    b.title = '变成浮窗：可以拖到任意位置、切到别的页面也一直在；窗口里的上一题/答题卡/下一题就是这套题自己的';
    b.textContent = '⤢ 小窗';
    b.onclick = () => { pop(); };
    const anchor = head.querySelector('#btnQn');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor);
    else head.appendChild(b);
  }

  /* ---------- 包住 renderQuiz：每次重画后把新卡搬进窗口 ---------- */
  function wrapRender() {
    if (!window.renderQuiz || window.renderQuiz.__pipWrapped) return;
    const orig = window.renderQuiz;
    const wrapped = function () {
      const r = orig.apply(this, arguments);
      if (open) setTimeout(absorb, 0);
      return r;
    };
    wrapped.__pipWrapped = true;
    window.renderQuiz = wrapped;
  }

  function watch() {
    wrapRender(); ensureEntry();
    let n = 0;
    const t = setInterval(() => { wrapRender(); ensureEntry(); if (++n > 20) clearInterval(t); }, 500);
    const view = document.getElementById('view');
    if (view) new MutationObserver(() => { wrapRender(); setTimeout(ensureEntry, 0); }).observe(view, { childList: true, subtree: false });
  }

  addEventListener('hashchange', () => setTimeout(() => {
    if (open && isQuiz()) close();          /* 回答题页：页面会重新渲染，避免两套同 id */
    ensureEntry();
  }, 80));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();

  window.PIP = { pop, close, minimize, restore, absorb, get isOpen() { return open; } };
})();
