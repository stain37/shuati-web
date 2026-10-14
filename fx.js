/* ============================================================
   fx.js —— 做完一套题 / 交卷时的小庆祝：🎺 + 彩带
   - 无依赖、自写 canvas；只动 transform / opacity，不动布局属性
   - 4 秒内必须收尾：粒子出屏或计时到 → cancelAnimationFrame + 移除 canvas
   - 尊重系统「减少动态效果」：prefers-reduced-motion 时只留 🎺 静态 + 文案
   - 交卷 / 套卷各只放一次：localStorage['qbank.fx.<bankId>'] 做一次性守卫，
     「再答一次」/「再用这套题考一次」时由 FX.reset(bankId) 清掉
   ============================================================ */
(function () {
  var COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'];
  var MAX_MS = 4000;                     /* 硬上限：超过就收尾，绝不常驻 rAF */

  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function confettiOn() {               /* 设置里的「放彩带」，默认开 */
    try { return !(typeof SET !== 'undefined' && SET && SET.fxConfetti === false); } catch (e) { return true; }
  }
  function normalOn() {                 /* 普通题库（非套卷）默认不庆祝，要手动开 */
    try { return !!(typeof SET !== 'undefined' && SET && SET.fxNormalBank); } catch (e) { return false; }
  }

  /* ---------- 一次性守卫 ---------- */
  function guardKey(bankId) { return 'qbank.fx.' + String(bankId == null ? '' : bankId); }
  function alreadyDone(bankId) { try { return !!localStorage.getItem(guardKey(bankId)); } catch (e) { return false; } }
  function markDone(bankId) { try { localStorage.setItem(guardKey(bankId), String(Date.now())); } catch (e) {} }
  function reset(bankId) { try { localStorage.removeItem(guardKey(bankId)); } catch (e) {} }

  /* ---------- canvas 彩带 ---------- */
  var cv = null, cx = null, raf = 0, parts = [], t0 = 0, last = 0, W = 0, H = 0;

  function ensureCanvas() {
    if (cv && cv.parentNode) return true;
    try {
      var d = document.createElement('canvas');
      d.id = 'fxCanvas';
      W = window.innerWidth || 800; H = window.innerHeight || 600;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      d.width = Math.round(W * dpr); d.height = Math.round(H * dpr);
      d.style.width = W + 'px'; d.style.height = H + 'px';
      document.body.appendChild(d);
      cv = d; cx = d.getContext('2d');
      if (cx) cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return !!cx;
    } catch (e) { cv = null; cx = null; return false; }
  }

  function finish() {
    if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    cv = null; cx = null; parts = [];
  }

  function count(base) { return (window.innerWidth <= 560) ? Math.round(base / 2) : base; }

  function spawn(o) {
    o = o || {};
    var mode = o.mode === 'rain' ? 'rain' : 'burst';
    var n = count(o.count || (mode === 'rain' ? 120 : 100));
    parts = [];
    for (var i = 0; i < n; i++) {
      var p = {
        x: 0, y: 0, vx: 0, vy: 0, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        c: COLORS[i % COLORS.length], ph: Math.random() * 6.28, sw: 0.3 + Math.random() * 0.9,
        life: 2500 + Math.random() * 1000, born: 0, square: Math.random() < 0.35
      };
      if (mode === 'rain') {
        p.x = Math.random() * W; p.y = -20 - Math.random() * H * 0.5;
        p.vx = (Math.random() - 0.5) * 2.4; p.vy = 2.2 + Math.random() * 3.4;
      } else {
        var a = Math.random() * 6.28, sp = 4 + Math.random() * 9;
        p.x = W / 2; p.y = H * 0.42;
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp - 3.5;
      }
      parts.push(p);
    }
  }

  function draw(now) {
    if (!cx) return;
    cx.clearRect(0, 0, W, H);
    var dt = Math.min(34, now - last || 16); last = now;
    var k = dt / 16.7, alive = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], age = now - t0;
      if (age > p.life + p.born) continue;
      if (age < p.born) { alive++; continue; }
      p.vy += 0.15 * k;
      p.vx *= Math.pow(0.99, k); p.vy *= Math.pow(0.995, k);
      p.x += p.vx * k + Math.sin((now / 320) + p.ph) * p.sw;
      p.y += p.vy * k;
      p.rot += p.vr * k;
      if (p.y > H + 40 || p.x < -60 || p.x > W + 60) continue;
      alive++;
      var left = (p.life + p.born) - age;
      var alpha = left < 600 ? Math.max(0, left / 600) : 1;
      cx.globalAlpha = alpha;
      cx.fillStyle = p.c;
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(p.rot);
      if (p.square) cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * 0.7);
      else cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cx.restore();
    }
    cx.globalAlpha = 1;
    if (alive === 0 || now - t0 > MAX_MS) { finish(); return; }
    raf = requestAnimationFrame(draw);
  }

  function confetti(o) {
    if (reduced() || !confettiOn()) return false;
    if (!ensureCanvas()) return false;
    spawn(o);
    t0 = last = (window.performance && performance.now) ? performance.now() : Date.now();
    if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} }
    raf = requestAnimationFrame(draw);
    /* 兜底：就算 rAF 被节流（切到后台标签页），也保证 4.6 秒内拆掉 canvas */
    setTimeout(function () { if (cv) finish(); }, MAX_MS + 600);
    return true;
  }

  /* ---------- 🎺 + 文案 ---------- */
  var held = [];
  function clearHeld() {                 /* 把还在屏幕上的 🎺 / 文案立刻收掉 */
    for (var i = 0; i < held.length; i++) {
      var el = held[i];
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    held.length = 0;
  }
  function stopAll() { finish(); clearHeld(); }
  function hold(el, ms) {
    if (!el) return;
    document.body.appendChild(el);
    held.push(el);
    setTimeout(function () { try { el.classList.add('out'); } catch (e) {} }, ms);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      var i = held.indexOf(el); if (i >= 0) held.splice(i, 1);
    }, ms + 400);
  }
  function trumpet(msg) {
    var t = document.createElement('div');
    t.className = 'fx-trumpet';
    t.setAttribute('aria-hidden', 'true');
    t.textContent = '🎺';
    hold(t, 1600);
    requestAnimationFrame(function () { t.classList.add('go'); });
    if (msg) {
      var m = document.createElement('div');
      m.className = 'fx-msg';
      m.textContent = msg;
      hold(m, 2200);
      requestAnimationFrame(function () { m.classList.add('go'); });
    }
    return t;
  }
  function grade(score) {
    if (score >= 90) return '太强了';
    if (score >= 60) return '稳';
    return '下次一定';
  }

  /* ---------- 两个入口 ---------- */
  function celebrateExam(o) {
    o = o || {};
    var id = o.bankId || (typeof EX !== 'undefined' && EX && EX.id) || 'exam';
    if (alreadyDone(id)) return false;
    markDone(id);
    var score = o.score == null ? 0 : o.score;
    trumpet('交卷完成 · ' + score + ' 分 · ' + grade(score));
    confetti({ mode: 'burst', count: 120 });
    return true;
  }
  function celebrateSet(o) {
    o = o || {};
    var id = o.bankId;
    if (alreadyDone(id)) return false;
    markDone(id);
    trumpet('这套题做完了 · 共 ' + (o.total || 0) + ' 题');
    confetti({ mode: 'rain', count: 120 });
    return true;
  }
  function celebrateNormal(o) {          /* 普通题库：默认关，设置里开了才庆祝 */
    if (!normalOn()) return false;
    return celebrateSet(o);
  }

  window.FX = {
    celebrateExam: celebrateExam,
    celebrateSet: celebrateSet,
    celebrateNormal: celebrateNormal,
    confetti: confetti,
    trumpet: trumpet,
    reset: reset,
    stop: stopAll,
    isReduced: reduced
  };
})();
