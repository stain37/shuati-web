/* ===== 画中画答题小窗 pip.js（P2：独立会话，最多 3 个） =====
   做法：每个小窗 = 一个同源 iframe（src="index.html?pip=1#/bank/<id>"），里面跑的是完整本站，
   带 ?pip=1 时进入「小窗客串模式」：隐藏顶栏和底栏、去掉页边距。
   这样窗口里的题与页面上的是两个独立文档 → 各自一套 QZ / 各自一套 id，
   窗口答 A 题库、页面答 B 题库可以同时进行，互不覆盖。
   窗口：拖（顶部横杠）、拉大小（右下角斜纹）、放大、最小化成气泡（可拖、吸附左右侧边）、关闭。 */
(function () {
  /* 小窗里那份是本站在 iframe 内跑：不要再套一层小窗 */
  if (/[?&]pip=1/.test(location.search)) return;

  const K = 'qbank.pip.v1';
  const MAX = 3;
  const LS = {
    get() { try { return JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(K, JSON.stringify(v)); } catch (e) {} }
  };
  let ST = LS.get() || {};
  const wins = [];                    /* {bank, el, frame, bubble, min, max, rect} */
  let layer = null, seq = 0;
  let zTop = 100, act = null;         /* 层叠顶端 / 当前激活的小窗（null = 都没激活，谁也不变淡） */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const bankId = () => (location.hash.match(/^#\/bank\/([^/?]+)/) || [])[1] || '';
  const bankTitle = id => (window.BANKS && BANKS[id] && BANKS[id].title) || '答题小窗';
  function toast(t) { if (window.toast) return window.toast(t, 1800); console.log('[pip]', t); }

  function mkLayer() {
    if (!layer) { layer = document.createElement('div'); layer.id = 'pipLayer'; document.body.appendChild(layer); }
    return layer;
  }

  function makeWin(bank, rect, top) {
    const el = document.createElement('section');
    el.className = 'pip-win';
    el.innerHTML =
      '<div class="pip-bar"><i class="pip-grip"></i><span class="pip-t"></span>' +
      '<span class="pip-sp"></span>' +
      '<button class="pip-btn" data-a="max" title="放大 / 还原">⤢</button>' +
      '<button class="pip-btn" data-a="min" title="最小化成气泡">—</button>' +
      '<button class="pip-btn" data-a="close" title="关闭">✕</button></div>' +
      '<div class="pip-wrap"><iframe class="pip-frame" title="答题小窗"></iframe><i class="pip-shield"></i></div>' +
      '<i class="pip-rz" title="拖动改大小"></i>';
    mkLayer().appendChild(el);

    const rec = { bank, el, frame: el.querySelector('iframe'), bubble: null, min: false, max: false, rect: rect || null };
    wins.push(rec);
    el.querySelector('.pip-t').textContent = bankTitle(bank);
    /* 临时卷（每日复习 / 套卷）只活在内存里，小窗是另一个文档 → 先存一份快照给它 */
    try {
      const bk = (typeof window.__PIP_BANK === 'function') ? window.__PIP_BANK(bank) : (window.BANKS && BANKS[bank]);
      if (bk) localStorage.setItem('qbank.pip.snap.v1', JSON.stringify({ id: bank, bank: bk, ts: Date.now() }));
    } catch (e) {}
    rec.frame.src = 'index.html?pip=1&bank=' + encodeURIComponent(bank) + '#/bank/' + encodeURIComponent(bank);
    applyRect(rec);
    bind(rec);
    save(); updateFab();
    if (top) activate(rec); else paint();
    return rec;
  }

  function applyRect(rec) {
    const i = Math.max(0, wins.indexOf(rec));
    const w = rec.rect && rec.rect.w ? rec.rect.w : 420;
    const h = rec.rect && rec.rect.h ? rec.rect.h : 520;
    const x = rec.rect && rec.rect.x != null ? rec.rect.x : (innerWidth - w - 18 - i * 26);
    const y = rec.rect && rec.rect.y != null ? rec.rect.y : (70 + i * 22);
    rec.el.style.width = w + 'px';
    rec.el.style.height = h + 'px';
    rec.el.style.left = clamp(x, 6, Math.max(6, innerWidth - w - 6)) + 'px';
    rec.el.style.top = clamp(y, 6, Math.max(6, innerHeight - h - 6)) + 'px';
  }

  /* ---------- 焦点：点哪个小窗，哪个就到最上层；其余变淡；点页面空白处全部失焦 ---------- */
  function paint() {
    const vis = wins.filter(w => !w.min);
    const multi = vis.length > 1;
    wins.forEach(w => {
      const on = (w === act && !w.min);
      w.el.classList.toggle('on', on);
      w.el.classList.toggle('off', !!act && multi && !on && !w.min);
      if (w.bubble) w.bubble.classList.toggle('on', on);
    });
    document.body.classList.toggle('pip-act', !!act);
    document.body.classList.toggle('pip-multi', multi);
  }
  function activate(rec) {
    if (!rec || rec.min) return;
    act = rec;
    rec.el.style.zIndex = ++zTop;
    if (rec.bubble) rec.bubble.style.zIndex = zTop;
    paint();
  }
  function deactivate() {
    if (!act) return;
    act = null;
    paint();
  }

  function bind(rec) {
    const el = rec.el, bar = el.querySelector('.pip-bar'), rz = el.querySelector('.pip-rz');

    /* 窗框任意处按下都先激活（capture：拖拽/按钮自己的处理照旧） */
    el.addEventListener('pointerdown', () => activate(rec), true);
    /* 窗内那份站立（同源 iframe）里的点击也要能激活：iframe 的点击不会冒泡到父文档 */
    rec.frame.addEventListener('load', () => {
      try {
        const d = rec.frame.contentDocument;
        if (d && !d.__pipAct) { d.__pipAct = 1; d.addEventListener('pointerdown', () => activate(rec), true); }
      } catch (e) {}
    });

    let drag = null;
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('.pip-btn') || rec.max) return;
      drag = { x: e.clientX, y: e.clientY, ox: parseInt(el.style.left) || 0, oy: parseInt(el.style.top) || 0 };
      bar.setPointerCapture(e.pointerId); e.preventDefault();
    });
    bar.addEventListener('pointermove', e => {
      if (!drag) return;
      el.style.left = clamp(drag.ox + e.clientX - drag.x, 0, innerWidth - el.offsetWidth) + 'px';
      el.style.top = clamp(drag.oy + e.clientY - drag.y, 0, innerHeight - el.offsetHeight) + 'px';
    });
    const endDrag = () => {
      if (drag) { drag = null; snapSave(rec); }
      /* 点过标题栏（拖或不拖）以后，按键直接进窗内那份站点 */
      if (act === rec) { try { rec.frame.contentWindow.focus(); } catch (e) {} }
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    let rzOn = false, rw = 0, rh = 0, rx = 0, ry = 0;
    rz.addEventListener('pointerdown', e => {
      if (rec.max) return;
      rzOn = true; rw = el.offsetWidth; rh = el.offsetHeight; rx = e.clientX; ry = e.clientY;
      rz.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
    });
    rz.addEventListener('pointermove', e => {
      if (!rzOn) return;
      el.style.width = clamp(rw + e.clientX - rx, 300, Math.min(980, innerWidth - 12)) + 'px';
      el.style.height = clamp(rh + e.clientY - ry, 240, Math.min(820, innerHeight - 12)) + 'px';
    });
    const endRz = () => { if (rzOn) { rzOn = false; snapSave(rec); } };
    rz.addEventListener('pointerup', endRz);
    rz.addEventListener('pointercancel', endRz);

    el.querySelectorAll('.pip-btn').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'max') { rec.max = !rec.max; el.classList.toggle('max', rec.max); }
        else if (a === 'min') minimize(rec);
        else close(rec);
        save();
      };
    });
  }

  function snapSave(rec) {
    rec.rect = { x: parseInt(rec.el.style.left) || 0, y: parseInt(rec.el.style.top) || 0, w: rec.el.offsetWidth, h: rec.el.offsetHeight };
    save();
  }

  function save() {
    ST.wins = wins.filter(w => !w.min).map(w => ({ bank: w.bank, rect: w.max ? null : w.rect }));
    LS.set(ST);
  }

  /* ---------- 最小化成气泡：可拖、松手吸左右边、点一下还原 ---------- */
  function bubbleFor(rec) {
    const b = document.createElement('button');
    b.className = 'pip-bubble';
    b.title = '点一下还原这个小窗（可拖着走，松手会吸到左右边）';
    b.innerHTML = '<b></b><span>小窗</span>';
    mkLayer().appendChild(b);
    b.style.zIndex = ++zTop;
    b.querySelector('b').textContent = bankTitle(rec.bank).slice(0, 6);

    const minList = wins.filter(w => w.min);
    const i = minList.indexOf(rec);
    b.style.top = (96 + Math.max(0, i) * 64) + 'px';
    b.style.right = '8px';

    let ing = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    b.addEventListener('pointerdown', e => {
      ing = true; moved = false; sx = e.clientX; sy = e.clientY; ox = b.offsetLeft; oy = b.offsetTop;
      b.style.zIndex = ++zTop;
      b.setPointerCapture(e.pointerId); e.preventDefault();
    });
    b.addEventListener('pointermove', e => {
      if (!ing) return;
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 5) moved = true;
      if (!moved) return;
      b.style.left = clamp(ox + e.clientX - sx, 6, innerWidth - b.offsetWidth - 6) + 'px';
      b.style.top = clamp(oy + e.clientY - sy, 6, innerHeight - b.offsetHeight - 96) + 'px';
      b.style.right = 'auto';
    });
    const up = () => {
      if (!ing) return;
      ing = false;
      if (!moved) { restore(rec); return; }
      const leftSide = (b.offsetLeft + b.offsetWidth / 2) < innerWidth / 2;
      b.style.left = leftSide ? '6px' : 'auto';
      b.style.right = leftSide ? 'auto' : '6px';
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('click', () => { if (!moved) restore(rec); });
    rec.bubble = b;
    return b;
  }

  function minimize(rec) {
    rec.min = true;
    rec.el.style.display = 'none';
    if (act === rec) act = null;
    bubbleFor(rec);
    paint();
    save();
  }

  function restore(rec) {
    rec.min = false;
    if (rec.bubble) { rec.bubble.remove(); rec.bubble = null; }
    rec.el.style.display = 'flex';
    activate(rec);
    save();
  }

  function close(rec) {
    const i = wins.indexOf(rec);
    if (i < 0) return;
    if (act === rec) act = null;
    try { rec.frame.src = 'about:blank'; } catch (e) {}
    rec.el.remove();
    if (rec.bubble) rec.bubble.remove();
    wins.splice(i, 1);
    paint();
    save(); updateFab();
  }

  function updateFab() {
    const n = wins.length, et = document.getElementById('pipEntry');
    if (!et) return;
    et.disabled = n >= MAX;
    et.textContent = n ? ('⤢ 小窗 ' + n + '/' + MAX) : '⤢ 小窗';
    et.title = n >= MAX ? '最多同时 3 个小窗' : '开一个小窗答这套题：切到别的页面它也会留着';
  }

  /* ---------- 入口按钮：放在答题页头部 ---------- */
  function open() {
    const b = bankId();
    if (!b) { toast('先进入一个题库，再开小窗'); return null; }
    if (wins.length >= MAX) { toast('最多同时 3 个小窗，先关一个'); return null; }
    if (wins.some(w => w.bank === b)) { toast('这套题已经在小窗里了'); return null; }
    mkLayer();
    return makeWin(b, null, true);
  }

  function ensureEntry() {
    if (!bankId()) {
      const old = document.getElementById('pipEntry');
      if (old) old.remove();
      return;
    }
    const head = document.querySelector('#view .qhead');
    if (!head) return;
    if (!document.getElementById('pipEntry')) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.id = 'pipEntry';
      b.onclick = () => open();
      const anchor = head.querySelector('#btnInk') || head.querySelector('#btnQn');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor);
      else head.appendChild(b);
    }
    updateFab();
  }

  function revive() {
    const list = (ST.wins || []).slice(0, MAX);
    if (!list.length) return;
    list.forEach(w => { if (w && w.bank) makeWin(w.bank, w.rect || null, false); });
    ST.wins = []; LS.set(ST);
  }

  /* 点页面其它地方 → 所有小窗一起失焦（不改变叠放，只是不再突出） */
  document.addEventListener('pointerdown', e => {
    if (!act) return;
    const t = e.target;
    if (t && t.closest && (t.closest('.pip-win') || t.closest('.pip-bubble'))) return;
    deactivate();
  }, true);

  function watch() {
    ensureEntry();
    setInterval(ensureEntry, 900);
    const view = document.getElementById('view');
    if (view) new MutationObserver(() => setTimeout(ensureEntry, 0)).observe(view, { childList: true, subtree: false });
  }

  addEventListener('hashchange', () => setTimeout(ensureEntry, 80));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { watch(); setTimeout(revive, 700); });
  else { watch(); setTimeout(revive, 700); }

  window.PIP = { open, closeAll: () => wins.slice().forEach(close), get count() { return wins.length; } };
})();
