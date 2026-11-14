/* Lucian UX/UI Prompt #099 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#099 */
/* 刷题站适配：学习统计页「近 7 天三环」，数据取自本机答题记录（按每题最后作答日） */
(function () {
  if (window.__ux099) return;
  window.__ux099 = 1;

  var DAY = 864e5;
  var GOAL = [
    { key: 'done', name: '做题', goal: 60, unit: ' 题', cls: 'm' },
    { key: 'again', name: '复习', goal: 30, unit: ' 题', cls: 'e' },
    { key: 'acc', name: '正确率', goal: 0.8, unit: '%', cls: 's' }
  ];

  function dstr(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function days7() {
    var out = [], t = new Date(); t.setHours(0, 0, 0, 0);
    for (var i = 6; i >= 0; i--) {
      var d = new Date(t.getTime() - i * DAY);
      out.push({ d: d, s: dstr(d), label: '日一二三四五六'.charAt(d.getDay()) });
    }
    return out;
  }

  function collect() {
    try {
      if (window.DAYLOG && window.DAYLOG.get) {
        var t = window.DAYLOG.get();
        if (t && Object.keys(t).length) return t;
      }
    } catch (e0) {}
    var ans = {};
    try { ans = JSON.parse(localStorage.getItem('qbank.answers.v2') || '{}') || {}; } catch (e) { ans = {}; }
    var map = {};
    Object.keys(ans).forEach(function (k) {
      var a = ans[k] || {};
      var ts = a.ts || a.gts || a.upd;
      if (!ts) return;
      var d = new Date(ts); d.setHours(0, 0, 0, 0);
      var key = dstr(d);
      var b = map[key] || (map[key] = { done: 0, ok: 0, again: 0 });
      b.done++;
      if (a.ok) b.ok++;
      if ((a.tries || 1) > 1) b.again++;
    });
    return map;
  }

  function ratio(b, r) {
    if (!b) return 0;
    if (b.done === 0) return 0;
    if (r.key === 'acc') return b.ok / b.done;
    return (b[r.key] || 0) / r.goal;
  }

  function build(box, days, map) {
    var R = [[70, 'm'], [54, 'e'], [38, 's']];
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 164 164');
    svg.setAttribute('class', 'u099-rg');
    svg.setAttribute('aria-hidden', 'true');
    var rings = [];
    R.forEach(function (r, i) {
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'u099-r ' + r[1]);
      var C = 2 * Math.PI * r[0];
      ['t', 'a', 'b'].forEach(function (c) {
        var ci = document.createElementNS(NS, 'circle');
        ci.setAttribute('cx', 82); ci.setAttribute('cy', 82); ci.setAttribute('r', r[0]);
        ci.setAttribute('stroke-width', 15);
        ci.setAttribute('class', c);
        g.appendChild(ci);
      });
      g.querySelector('.t').setAttribute('stroke-dasharray', '');
      var cap = document.createElementNS(NS, 'circle');
      cap.setAttribute('class', 'cap'); cap.setAttribute('r', 7.5);
      g.appendChild(cap);
      svg.appendChild(g);
      rings.push({ g: g, r: r[0], C: C, a: g.querySelector('.a'), b: g.querySelector('.b'), cap: cap });
    });

    var lg = document.createElement('div');
    lg.className = 'u099-lg';
    var items = GOAL.map(function (r) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'u099-it ' + r.cls;
      b.innerHTML = '<small><i aria-hidden="true"></i>' + r.name + '</small><b></b>';
      lg.appendChild(b);
      return b;
    });

    var wk = document.createElement('div');
    wk.className = 'u099-wk'; wk.setAttribute('role', 'group'); wk.setAttribute('aria-label', '选一天看三环');
    var mini = days.map(function (day, i) {
      var bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'u099-d';
      var s = document.createElementNS(NS, 'svg');
      s.setAttribute('viewBox', '0 0 30 30'); s.setAttribute('aria-hidden', 'true');
      [13, 9, 5].forEach(function (rad, k) {
        var C = 2 * Math.PI * rad;
        var t = document.createElementNS(NS, 'circle');
        t.setAttribute('cx', 15); t.setAttribute('cy', 15); t.setAttribute('r', rad);
        t.setAttribute('class', 'mt ' + GOAL[k].cls);
        s.appendChild(t);
        var a = document.createElementNS(NS, 'circle');
        a.setAttribute('cx', 15); a.setAttribute('cy', 15); a.setAttribute('r', rad);
        a.setAttribute('class', 'ma ' + GOAL[k].cls);
        a.setAttribute('stroke-dasharray', '0 ' + C.toFixed(1));
        s.appendChild(a);
      });
      bt.appendChild(s);
      bt.appendChild(document.createTextNode(day.label));
      bt.addEventListener('click', function () { pick(i); });
      wk.appendChild(bt);
      return bt;
    });

    var head = document.createElement('div');
    head.className = 'u099-h';
    head.innerHTML = '<b>近 7 天</b><span class="u099-dt"></span>';
    var top = document.createElement('div');
    top.className = 'u099-top';
    top.appendChild(svg); top.appendChild(lg);
    var sum = document.createElement('p');
    sum.className = 'u099-sum';

    box.innerHTML = '';
    box.appendChild(head); box.appendChild(top); box.appendChild(wk); box.appendChild(sum);

    var cur = -1;
    function draw(ring, p, withCap) {
      var a = Math.min(p, 1), b = Math.max(0, Math.min(p - 1, 1));
      ring.a.setAttribute('stroke-dasharray', (a * ring.C).toFixed(2) + ' ' + ring.C.toFixed(2));
      ring.b.setAttribute('stroke-dasharray', (b * ring.C).toFixed(2) + ' ' + ring.C.toFixed(2));
      ring.b.style.display = b > 0 ? '' : 'none';
      if (withCap) {
        var ang = p * Math.PI * 2;
        ring.cap.setAttribute('cx', (82 + Math.cos(ang) * ring.r).toFixed(2));
        ring.cap.setAttribute('cy', (82 + Math.sin(ang) * ring.r).toFixed(2));
        ring.g.classList.toggle('over', p > 1.02);
      }
    }

    function val(r, b) {
      if (!b) return 0;
      if (r.key === 'acc') return b.ok / Math.max(1, b.done);
      return b[r.key] || 0;
    }

    function label(r, b) {
      var v = val(r, b);
      if (r.key === 'acc') return Math.round(v * 100) + '<span> / ' + Math.round(r.goal * 100) + '%</span>';
      return v + '<span> / ' + r.goal + r.unit + '</span>';
    }

    function pick(i) {
      if (i === cur) return;
      cur = i;
      var b = map[days[i].s] || { done: 0, ok: 0, again: 0 };
      mini.forEach(function (m, k) {
        m.setAttribute('aria-pressed', String(k === i));
        m.tabIndex = k === i ? 0 : -1;
        m.classList.toggle('on', k === i);
      });
      document.querySelector('.u099-dt');
      box.querySelector('.u099-dt').textContent = days[i].d.getMonth() + 1 + ' 月 ' + days[i].d.getDate() + ' 日 · 周' + days[i].label;
      GOAL.forEach(function (r, k) {
        var p = ratio(b, r);
        draw(rings[k], p, true);
        rings[k].g.classList.toggle('fl', false);
        items[k].querySelector('b').innerHTML = label(r, b);
        items[k].setAttribute('aria-label', r.name + ' ' + label(r, b).replace(/<[^>]+>/g, ''));
      });
      var full = GOAL.filter(function (r) { return ratio(b, r) >= 1; }).length;
      sum.innerHTML = '这一天完成三环中的 <b>' + full + ' / 3</b> 环';
    }

    items.forEach(function (btn, k) {
      btn.addEventListener('pointerenter', function () { box.classList.add('has'); rings.forEach(function (r, n) { r.g.classList.toggle('on', n === k); }); });
      btn.addEventListener('pointerleave', function () { box.classList.remove('has'); rings.forEach(function (r) { r.g.classList.remove('on'); }); });
      btn.addEventListener('focus', function () { box.classList.add('has'); rings.forEach(function (r, n) { r.g.classList.toggle('on', n === k); }); });
      btn.addEventListener('blur', function () { box.classList.remove('has'); rings.forEach(function (r) { r.g.classList.remove('on'); }); });
    });

    wk.addEventListener('keydown', function (e) {
      var to = e.key === 'ArrowRight' ? cur + 1 : e.key === 'ArrowLeft' ? cur - 1 : null;
      if (to === null) return;
      e.preventDefault(); to = Math.max(0, Math.min(6, to));
      pick(to); mini[to].focus();
    });

    // 星期小环先画
    days.forEach(function (day, i) {
      var b = map[day.s] || { done: 0, ok: 0, again: 0 };
      var arcs = mini[i].querySelectorAll('.ma');
      GOAL.forEach(function (r, k) {
        var p = Math.min(1, ratio(b, r));
        var rad = [13, 9, 5][k], C = 2 * Math.PI * rad;
        arcs[k].setAttribute('stroke-dasharray', (p * C).toFixed(2) + ' ' + C.toFixed(2));
      });
      mini[i].setAttribute('aria-label', '周' + day.label + ' 做题 ' + b.done + ' 题，复习 ' + b.again + ' 题，正确率 ' + Math.round(b.ok / Math.max(1, b.done) * 100) + '%');
    });

    pick(6);
  }

  function mount() {
    if (location.hash.indexOf('#/stats') !== 0) return;
    var view = document.getElementById('view');
    if (!view) return;
    var box = view.querySelector('.u099');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ux u099';
      var stg = view.querySelector('.stg');
      if (stg && stg.parentNode) stg.parentNode.insertBefore(box, stg);
      else view.insertBefore(box, view.firstChild);
    }
    var sig = location.hash + '|' + (localStorage.getItem('qbank.answers.v2') || '').length;
    if (!(box.dataset.sig === sig && box.querySelector('.u099-rg'))) {
      box.dataset.sig = sig;
      var days = days7();
      build(box, days, collect());
    }
    /* 统计数字块搬进「近 7 天」卡片右侧空白处 */
    var stg = view.querySelector('.stg'), top = box.querySelector('.u099-top');
    if (stg && top && stg.parentNode !== top) { stg.classList.add('stg-in-top'); top.appendChild(stg); }
  }

  var t = 0;
  function schedule() { clearTimeout(t); t = setTimeout(function () { try { mount(); } catch (e) { } }, 160); }
  window.addEventListener('hashchange', schedule);
  document.addEventListener('DOMContentLoaded', schedule);
  function watch() {
    var view = document.getElementById('view');
    if (!view) { setTimeout(watch, 300); return; }
    new MutationObserver(function () { if (location.hash.indexOf('#/stats') === 0) schedule(); })
      .observe(view, { childList: true });
  }
  watch();
  schedule();
})();
