/* ============================================================
   刷题站 · 掌握度复盘（web258）
   ——————————————————————————————————————————————
   学 sakura-question-bank 的「阶段复盘」：不只看总共做了多少题，
   而是按「科目」和「考点」拆开看——哪一科最薄、哪个考点一答就错。

   数据全部来自本机已有记录，不新增任何存储键：
     ANS[key]  = 作答记录（ok 上一次对错 / tries 次数 / wrong 错次 / due 下次复习时间）
     TAGS[key] = 考点标签（tags.js）
     qzBasics()= 六科词表，qzBasicOf(bank,q) 取这道题的科目
     kOf(bank,q) = 题库#题号 的唯一键

   页面上三块：
     ① 总览：总题数 / 已答 / 正确率 / 待复习
     ② 按科目：六科 + 未选，横条显示已答比例，右边是正确率与「去刷」
     ③ 最需要补的考点：答过 ≥3 题的考点里正确率最低的 12 个
   点「去刷」= 把这些题组成一张临时套卷（makePaper），不污染原题库。
   ============================================================ */
(function () {
  'use strict';

  var SUBJ_ORDER = ['内科', '外科', '病理', '生理', '生化', '人文', '政治'];

  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
  /* 取 app.js 里的顶层 const（ANS / TAGS / BANKS…）：它们不挂 window，
     只能用间接 eval 在全局作用域里按名字取。 */
  function globalOf(name) {
    try { var v = (0, eval)(name); return (v && typeof v === 'object') ? v : null; } catch (e) { return null; }
  }
  function nowMs() { return Date.now(); }

  /* ---------- 统计 ---------- */
  function collect() {
    var banks = (typeof allBanks === 'function' ? allBanks() : []).filter(function (b) { return b && b.questions; });
    /* app.js 里是 const ANS / const TAGS：顶层 const 不挂 window，
       但全局词法环境里能直接按名字取。注意别用同名局部变量去接——
       那样 typeof 命中的是局部变量自己，永远拿不到真数据（本地已踩过一次）。 */
    var ANSMAP = globalOf('ANS') || {};
    /* 注意：全局的 TAGS 是 tags.js 的 API 对象（.of/.set/.all…），不是原始映射表；
       真正的数据在 localStorage 的 qbank.tags.v1。 */
    var TAGMAP = {};
    try { TAGMAP = (typeof readLS === 'function') ? (readLS('qbank.tags.v1', {}) || {}) : {}; } catch (e) { TAGMAP = {}; }
    var basics = (typeof qzBasics === 'function' ? qzBasics() : SUBJ_ORDER);
    var total = 0, answered = 0, right = 0, due = 0;
    var bySubj = {}, byTag = {}, keyBank = {};

    banks.forEach(function (b) {
      (b.questions || []).forEach(function (q) {
        var k = (typeof kOf === 'function') ? kOf(b, q) : (b.id + '#' + q.id);
        total++;
        var a = ANSMAP[k];
        var bs = [];
        try { bs = (typeof qzBasicOf === 'function') ? qzBasicOf(b, q) : []; } catch (e) { bs = []; }
        var subj = bs.length ? bs[0] : '__none';
        var row = bySubj[subj] || (bySubj[subj] = { n: 0, ans: 0, ok: 0, bad: 0, due: 0, keys: [] });
        row.n++;
        if (a) {
          answered++;
          row.ans++;
          if (a.ok) { right++; row.ok++; } else { row.bad++; }
          if (a.due && a.due <= nowMs()) { due++; row.due++; }
        }
        var tags = TAGMAP[k] || (Array.isArray(q.tags) ? q.tags : []);
        if (a && tags && tags.length) {
          tags.forEach(function (t) {
            var tt = byTag[t] || (byTag[t] = { n: 0, ans: 0, ok: 0, bad: 0, keys: [] });
            tt.ans++;
            tt.n++;
            if (a.ok) tt.ok++; else { tt.bad++; tt.keys.push(k); }
          });
        }
      });
    });
    Object.keys(bySubj).forEach(function (s) { bySubj[s].rate = pct(bySubj[s].ok, bySubj[s].ans); });
    Object.keys(byTag).forEach(function (t) { byTag[t].rate = pct(byTag[t].ok, byTag[t].ans); });
    return {
      banks: banks.length, total: total, answered: answered, right: right, due: due,
      rate: pct(right, answered), bySubj: bySubj, byTag: byTag
    };
  }

  function subjRows(d) {
    var out = [];
    SUBJ_ORDER.forEach(function (s) {
      var r = d.bySubj[s];
      if (r) out.push({ name: s, v: r });
    });
    if (d.bySubj.__none) out.push({ name: '未选科目', v: d.bySubj.__none });
    return out;
  }

  function weakTags(d, limit) {
    return Object.keys(d.byTag).map(function (t) {
      var v = d.byTag[t]; return { name: t, v: v };
    }).filter(function (x) { return x.v.ans >= 2; })
      .sort(function (a, b) { return (a.v.rate - b.v.rate) || (b.v.bad - a.v.bad) || (b.v.ans - a.v.ans); })
      .slice(0, limit || 12);
  }

  /* ---------- 渲染 ---------- */
  function bar(rate, tone) {
    var w = Math.max(0, Math.min(100, rate));
    return '<div class="mv-bar"><i style="width:' + w + '%;background:' + (tone || 'var(--primary)') + '"></i></div>';
  }
  function toneOf(rate, ans) {
    if (!ans) return 'var(--line2)';
    if (rate >= 85) return 'var(--ok)';
    if (rate >= 65) return 'var(--primary)';
    if (rate >= 40) return 'var(--warn)';
    return 'var(--bad)';
  }

  function render() {
    if (typeof richFlush === 'function') richFlush();
    try { if (typeof QZ !== 'undefined' && QZ) QZ.focusCur = false; } catch (e) {}
    $('appTitle').textContent = '掌握度复盘';
    $('stat').textContent = '';
    if ($('bar')) $('bar').style.width = '0%';

    var d = collect();
    if (!d.answered) {
      $('view').innerHTML = '<h2 class="sec">掌握度复盘</h2>' +
        '<div class="card"><div class="empty">' +
        '<div style="font-size:15px;margin-bottom:8px">还没有作答记录</div>' +
        '<div class="hint">先随便刷几道题，这里就会按科目和考点告诉你哪儿最薄。</div>' +
        '<div class="actions" style="justify-content:center;margin-top:12px"><button class="btn primary" id="mvGo">去首页开始</button></div>' +
        '</div></div>';
      if ($('mvGo')) $('mvGo').onclick = function () { go('#/'); };
      return;
    }

    var subs = subjRows(d);
    var weak = weakTags(d, 12);

    var html = '<h2 class="sec">掌握度复盘</h2>';

    /* ① 总览 */
    html += '<div class="card mv-top">' +
      '<div class="mv-kpis">' +
      kpi('总题数', d.total, '') +
      kpi('已答', d.answered, '占 ' + pct(d.answered, d.total) + '%') +
      kpi('正确率', d.rate + '%', d.answered + ' 次作答') +
      kpi('待复习', d.due, d.due ? '到期了' : '暂无到期') +
      '</div>' +
      (d.due ? '<div class="actions" style="margin-top:12px"><button class="btn primary" id="mvDue">复习到期的 ' + d.due + ' 题</button></div>' : '') +
      '</div>';

    /* ② 按科目 */
    html += '<h2 class="sec">按科目</h2><div class="card mv-subj">';
    if (!subs.length) html += '<div class="hint">题库里的题还没分科目（答题页「未选」一栏可以逐题打科目标签）。</div>';
    subs.forEach(function (s) {
      var v = s.v;
      html += '<div class="mv-row" data-subj="' + esc(s.name) + '">' +
        '<div class="mv-name">' + esc(s.name) +
        '<span class="mv-sub">' + v.ans + ' / ' + v.n + ' 题已答</span></div>' +
        bar(pct(v.ans, v.n), 'var(--primary)') +
        '<div class="mv-meta">' +
        '<b style="color:' + toneOf(v.rate, v.ans) + '">' + (v.ans ? v.rate + '%' : '—') + '</b>' +
        '<span>错 ' + v.bad + '</span>' +
        '<button class="btn tiny mv-go" data-go-subj="' + esc(s.name) + '"' + (v.bad || v.due ? '' : ' disabled') + '>' +
        (v.bad ? '刷错题' : (v.due ? '复习' : '无错题')) + '</button>' +
        '</div></div>';
    });
    html += '</div>';

    /* ③ 最需要补的考点 */
    html += '<h2 class="sec">最需要补的考点</h2><div class="card mv-tags">';
    if (!weak.length) {
      html += '<div class="hint">还没有「答过 2 题以上」的考点统计。给题目打上考点标签（答题页「考点 / 加标签」）之后这里才有东西看。</div>';
    } else {
      weak.forEach(function (t) {
        html += '<div class="mv-row">' +
          '<div class="mv-name">' + esc(t.name) + '<span class="mv-sub">' + t.v.ans + ' 题 · 错 ' + t.v.bad + '</span></div>' +
          bar(t.v.rate, toneOf(t.v.rate, t.v.ans)) +
          '<div class="mv-meta"><b style="color:' + toneOf(t.v.rate, t.v.ans) + '">' + t.v.rate + '%</b>' +
          '<span>' + (t.v.ans - t.v.ok) + ' 错</span>' +
          '<button class="btn tiny mv-map" data-map-tag="' + esc(t.name) + '" title="在脑图里看这个考点的题">🗺</button></div></div>';
      });
    }
    html += '</div>';

    html += '<div class="hint" style="margin:10px 2px 24px">统计口径：正确率 = 上一次作答答对的比例；「待复习」= 复习排期已到期的题。数据只在本机浏览器里。</div>';

    $('view').innerHTML = html;
    bind(d);
    growBars();
  }

  /* web263 · 进度条也走缓动（WouoUI README：「包括列表，弹窗，甚至进度条」）。
     做法：先归零，再用 MO 沿指数曲线长到目标宽度；中途换页/重画也不会跳变，
     因为 MO 是按 id 复用同一支补间，目标变了就从当前值接着走。 */
  function growBars() {
    if (!window.MO || window.MO.reduced()) return;
    var bars = document.querySelectorAll('#view .mv-bar > i');
    Array.prototype.forEach.call(bars, function (el, i) {
      var target = parseFloat(el.style.width) || 0;
      if (!(target > 0)) return;
      el.style.width = '0%';
      var cur = [0];
      setTimeout(function () {
        window.MO.run('mvbar' + i, {
          cur: cur, trg: [target], eps: 0.15, spr: { k: 230, c: 19 },   /* ζ≈0.63：冲过一点点再落回 */
          onFrame: function (v) { el.style.width = Math.max(0, Math.min(100, v[0])).toFixed(2) + '%'; }
        });
      }, 60 + i * 45);
    });
  }

  function kpi(label, value, sub) {
    return '<div class="mv-kpi"><b>' + value + '</b><span>' + label + '</span>' +
      (sub ? '<i>' + sub + '</i>' : '') + '</div>';
  }

  function bind(d) {
    var view = $('view');
    if (view && !view.dataset.mapbind) {
      view.dataset.mapbind = '1';
      view.addEventListener('click', function (e) {
        var b = e.target.closest('[data-map-tag]');
        if (!b) return;
        var tag = b.getAttribute('data-map-tag'), found = null;
        try {
          (window.LOCAL || []).forEach(function (bank) {
            if (found) return;
            (bank.questions || []).forEach(function (q) {
              if (found) return;
              var ks = [];
              try { ks = (typeof tagList === 'function') ? tagList(q, bank.id) : (q.tags || []); } catch (err) { ks = q.tags || []; }
              if ((ks || []).indexOf(tag) >= 0) found = { b: bank, q: q };
            });
          });
        } catch (err) {}
        if (!found) { if (typeof toast === 'function') toast('这个考点的题不在自建题库里', 1800, 'warn'); return; }
        if (window.MAPQ && MAPQ.openFor) MAPQ.openFor(found.b.id, found.q.id);
        else if (typeof toast === 'function') toast('脑图模块没加载（map.js）', 1800, 'bad');
      });
    }
    var dueBtn = $('mvDue');
    if (dueBtn) dueBtn.onclick = function () { go('#/wrong'); };

    document.querySelectorAll('[data-go-subj]').forEach(function (btn) {
      btn.onclick = function () {
        var s = btn.dataset.goSubj;
        var row = d.bySubj[s === '未选科目' ? '__none' : s];
        if (!row) return;
        var keys = [];
        (typeof allBanks === 'function' ? allBanks() : []).forEach(function (b) {
          (b.questions || []).forEach(function (q) {
            var k = kOf(b, q);
            var a = (globalOf('ANS') || {})[k];
            if (!a) return;
            var bs = [];
            try { bs = qzBasicOf(b, q); } catch (e) {}
            var sj = bs.length ? bs[0] : '__none';
            if (sj !== (s === '未选科目' ? '__none' : s)) return;
            if (!a.ok) keys.push(k);
          });
        });
        if (!keys.length) { toast('这个科目暂时没有错题'); return; }
        if (typeof makePaper === 'function') makePaper('掌握度 · ' + s + ' 错题 ' + keys.length + ' 道', keys, { transient: true });
        else toast('套卷模块没加载');
      };
    });
  }

  window.MASTERY = { render: render, collect: collect };
})();
