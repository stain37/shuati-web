/* ============================================================
   report.js —— AI 学情诊断（周报，方案七）
   把「作答记录 / 错次 / 考点标签 / 复习排期」聚合成一小段结构化摘要，交给模型写成
   人话版诊断：这周干了多少、最弱在哪、大概卡在哪、下周干什么。
   统计页最上面有个折叠区块「学情诊断（周报）」，也可以走路由 #/report 看全部历史。
   历史报告存 qbank.report.v1（只留最近 20 份），跟导出备份一起走。
   ============================================================ */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var R_KEY = 'qbank.report.v1';
  var MAX_KEEP = 20;          /* 历史最多留几份 */
  var MIN_N = 30;             /* 窗口内少于这么多题：提示样本太小（但还是允许生成） */
  var CAP_TAGS = 15;          /* byTag 最多几行 */
  var CAP_MIS = 20;           /* 错题样本最多几条 */
  var CAP_STEM = 80;          /* 每条题干截多少字 */
  var CAP_TEXT = 4000;        /* 摘要整体上限 */
  var DAYS = [7, 14, 30];

  var REPORTS = [];
  var V = { days: 7, running: false, text: '', err: null, ctl: null, timer: null, note: '', lastSum: '' };

  function rd() {
    try { REPORTS = readLS(R_KEY, []) || []; } catch (e) { REPORTS = []; }
    if (!Array.isArray(REPORTS)) REPORTS = [];
    REPORTS = REPORTS.filter(function (r) { return r && r.text; });
  }
  function save() {
    if (typeof mergeWrite === 'function') return mergeWrite(R_KEY, REPORTS, 'report');
    return writeLS(R_KEY, REPORTS);
  }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function sorted() { return REPORTS.slice().sort(function (a, b) { return (+b.ts || 0) - (+a.ts || 0); }); }
  function latest() { return sorted()[0] || null; }
  function staleDays() { var l = latest(); return l ? Math.floor((Date.now() - (+l.ts || 0)) / 86400000) : null; }
  function pct(ok, n) { return n ? Math.round(ok / n * 100) : 0; }
  function cut(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* ---------- 题目查找（取题干 / 正确答案） ---------- */
  var QMAP = null;
  function buildQMap() {
    QMAP = {};
    var bs = [];
    try { bs = (typeof baseBanks === 'function') ? baseBanks() : []; } catch (e) { bs = []; }
    bs.forEach(function (b) {
      (b.questions || []).forEach(function (q) {
        try { QMAP[kOf(b, q)] = { bank: b, q: q }; } catch (e) {}
      });
    });
    return QMAP;
  }
  function qOf(k) { if (!QMAP) buildQMap(); return QMAP[k] || null; }

  /* ---------- 数据聚合（只发摘要，别全量塞） ---------- */
  function winRecords(days) {
    var since = Date.now() - days * 86400000, out = [];
    var A = (typeof ANS !== 'undefined' && ANS) ? ANS : {};
    Object.keys(A).forEach(function (k) {
      var a = A[k];
      if (!a || !a.ts || a.ts < since) return;
      out.push({ k: k, a: a });
    });
    out.sort(function (x, y) { return (y.a.ts || 0) - (x.a.ts || 0); });
    return out;
  }
  function dayRows(days) {
    var rows = [];
    try { rows = (typeof statsDaily === 'function') ? statsDaily(days) : []; } catch (e) { rows = []; }
    return rows.filter(function (r) { return r.n > 0; }).map(function (r) { return { date: r.label, n: r.n, acc: pct(r.ok, r.n) }; });
  }
  function tagRows(days, recs) {
    var tags = null;
    try { tags = (window.TAGS && window.TAGS.data) ? window.TAGS.data() : null; } catch (e) { tags = null; }
    var useTag = !!(tags && Object.keys(tags).length);
    var map = {};
    if (useTag) {   /* 按考点（方案五的标签） */
      Object.keys(tags).forEach(function (k) {
        (tags[k] || []).forEach(function (t) {
          (map[t] = map[t] || { tag: t, n: 0, answered: 0, ok: 0, wrong: 0 }).n++;
        });
      });
      recs.forEach(function (r) {
        (tags[r.k] || []).forEach(function (t) {
          var o = map[t]; if (!o) return;
          o.answered++; if (r.a.ok) o.ok++; o.wrong += (r.a.wrong || 0);
        });
      });
    } else {        /* 没有标签就退回按题库 */
      var bs = [];
      try { bs = (typeof baseBanks === 'function') ? baseBanks() : []; } catch (e) {}
      bs.forEach(function (b) {
        var o = map[b.id] = { tag: b.title || b.id, n: (b.questions || []).length, answered: 0, ok: 0, wrong: 0, bank: true };
      });
      recs.forEach(function (r) {
        var hit = qOf(r.k); if (!hit) return;
        var o = map[hit.bank.id]; if (!o) return;
        o.answered++; if (r.a.ok) o.ok++; o.wrong += (r.a.wrong || 0);
      });
    }
    var rows = Object.keys(map).map(function (t) {
      var o = map[t];
      o.acc = pct(o.ok, o.answered);
      return o;
    }).filter(function (o) { return o.n > 0; });
    rows.sort(function (a, b) { return (a.answered ? a.acc : -1) - (b.answered ? b.acc : -1) || b.wrong - a.wrong; });
    return { rows: rows, byTag: useTag };
  }
  function mistakeRows(days, recs) {
    var out = recs.filter(function (r) { return !r.a.ok || (r.a.wrong || 0) > 0; })
      .sort(function (x, y) { return (y.a.wrong || 0) - (x.a.wrong || 0) || (y.a.ts || 0) - (x.a.ts || 0); });
    return out.slice(0, CAP_MIS).map(function (r) {
      var hit = qOf(r.k);
      var tag = '';
      try { var t = (window.TAGS && window.TAGS.of) ? window.TAGS.of(r.k) : []; tag = (t && t[0]) || ''; } catch (e) {}
      if (!tag) tag = hit ? (hit.bank.title || hit.bank.id) : '';
      var right = [];
      try { right = (typeof ansOf === 'function' && hit) ? ansOf(r.k, hit.q) : ((hit && hit.q.answer) || []); } catch (e) { right = (hit && hit.q.answer) || []; }
      return {
        stem: cut(hit ? hit.q.stem : r.k, CAP_STEM), tag: tag,
        mine: (r.a.sel || []).join(''), right: (right || []).join(''),
        wrong: r.a.wrong || 0, tries: r.a.tries || 1
      };
    });
  }
  function srsSide(top) {
    var due = 0, streak = 0;
    try { due = (typeof dueKeys === 'function') ? dueKeys(0).length : 0; } catch (e) {}
    try { streak = (typeof todayStats === 'function') ? todayStats().streak : 0; } catch (e) {}
    return { dueNow: due, streak: streak, weakTop3: (top || []).slice(0, 3).map(function (o) { return o.tag; }) };
  }
  /* 结构化摘要：给模型看的文本（有硬上限，超了截断） */
  function buildSummary(days) {
    days = days || V.days;
    var recs = winRecords(days);
    var ok = recs.filter(function (r) { return r.a.ok; }).length;
    var tries = recs.reduce(function (n, r) { return n + (r.a.tries || 1); }, 0);
    var wrong = recs.reduce(function (n, r) { return n + (r.a.wrong || 0); }, 0);
    var tg = tagRows(days, recs);
    var mis = mistakeRows(days, recs);
    var data = {
      days: days, answered: recs.length, correct: ok, acc: pct(ok, recs.length), tries: tries, wrongTotal: wrong,
      daily: dayRows(days), byTag: tg.rows.slice(0, CAP_TAGS), tagDim: tg.byTag,
      mistakes: mis, srs: srsSide(tg.rows)
    };
    var L = [];
    L.push('【时间窗】最近 ' + days + ' 天');
    L.push('【总量】做过 ' + data.answered + ' 题（作答次数 ' + tries + '）· 对 ' + ok + ' 题 · 正确率 ' + data.acc + '% · 累计错 ' + wrong + ' 次');
    L.push('【每天】' + (data.daily.length ? data.daily.map(function (d) { return d.date + ' ' + d.n + '题/' + d.acc + '%'; }).join('；') : '（这几天没做题）'));
    L.push('【按' + (tg.byTag ? '考点' : '题库') + '】正确率从低到高（最多 ' + CAP_TAGS + ' 行）：');
    data.byTag.forEach(function (o) {
      L.push('- ' + o.tag + '：共 ' + o.n + ' 题，这' + days + '天答了 ' + o.answered + ' 题，正确率 ' + (o.answered ? o.acc + '%' : '（这窗口没答）') + '，累计错 ' + o.wrong + ' 次');
    });
    L.push('【错题样本】最多 ' + CAP_MIS + ' 条：');
    data.mistakes.forEach(function (m, i) {
      L.push((i + 1) + '. [' + m.tag + '] ' + m.stem + '（我选 ' + (m.mine || '空') + '／正确 ' + (m.right || '?') + '，错 ' + m.wrong + ' 次）');
    });
    if (!data.mistakes.length) L.push('（这窗口没有错题）');
    L.push('【复习侧】今天到期该复习 ' + data.srs.dueNow + ' 题 · 连续刷题 ' + data.srs.streak + ' 天 · 最弱三个' + (tg.byTag ? '考点' : '题库') + '：' + (data.srs.weakTop3.join('、') || '（无）'));
    var text = L.join('\n');
    if (text.length > CAP_TEXT) text = text.slice(0, CAP_TEXT) + '\n（摘要过长已截断）';
    return { text: text, data: data };
  }

  /* ---------- Prompt ---------- */
  function sysText() {
    var base = (typeof aiSysText === 'function') ? aiSysText() : '你是一位医学考试的辅导老师。';
    return base + '\n\n【本次任务】你是我的学习教练。基于我给的学习数据，写一份**简明**的诊断报告。'
      + '用简体中文和 Markdown，别客套、别复述我的数据。';
  }
  function askText(sumText) {
    return '【学习数据】\n' + sumText + '\n\n【要写的内容】\n'
      + '1. **整体**：一两句话概括这' + V.days + '天表现（要基于数据，别空夸）。\n'
      + '2. **最薄弱的' + (V.lastTagDim ? '考点' : '题库') + '**：指出 2–3 个，每个用数据说明（正确率、错几道、错在哪类）。\n'
      + '3. **错因推测**：结合上面的错题样本，猜我大概卡在哪（概念没懂 / 记混 / 粗心）。\n'
      + '4. **下周行动**：具体到"刷哪些' + (V.lastTagDim ? '考点' : '题库') + '、每天多少题、先清复习还是先刷新题"，可执行。\n'
      + '5. 最后一行给一个**这周最该点开的那一个' + (V.lastTagDim ? '考点' : '题库') + '**。\n\n'
      + '要求：总长 300–500 字，不要加没用的前言和总结。';
  }

  /* ---------- 生成 ---------- */
  function cfgOK() {
    var cfg = null;
    try { cfg = (typeof aiCfg === 'function') ? aiCfg() : null; } catch (e) { cfg = null; }
    return !!(cfg && cfg.model && (cfg.base || cfg.preset === 'ollama') && typeof aiChat === 'function');
  }
  function paint() {
    var out = document.getElementById('repOut');
    if (out) {
      if (V.err) {
        var info = V.err;
        out.innerHTML = '<div class="note bad"><b>生成失败：</b>' + esc(info.msg || '出错')
          + (info.hint ? '<div class="small muted" style="margin-top:4px">' + esc(info.hint) + '</div>' : '') + '</div>';
      } else if (V.text) {
        out.innerHTML = '<div class="rep-md">' + ((typeof mdToHtml === 'function') ? mdToHtml(V.text) : esc(V.text)) + '</div>'
          + (V.running ? '<div class="small muted">正在写…</div>' : '');
      } else if (V.running) {
        out.innerHTML = '<div class="small muted">正在整理数据、让模型写报告…</div>';
      } else {
        out.innerHTML = '';
      }
    }
    var st = document.getElementById('repState');
    if (st) {
      var d = staleDays();
      st.textContent = V.running ? '生成中…' : (V.note || (d == null ? '还没生成过' : (d === 0 ? '今天生成过' : '上次生成：' + d + ' 天前')));
    }
    var stop = document.getElementById('repStop');
    if (stop) stop.style.display = V.running ? '' : 'none';
    var go2 = document.getElementById('repGo');
    if (go2) { go2.disabled = V.running; go2.textContent = V.text ? '重新生成' : '生成报告'; }
    var bar = document.getElementById('repBar');
    if (bar) bar.style.display = V.running ? '' : 'none';
  }
  function stop() {
    if (!V.running) return;
    V.running = false;
    try { if (V.ctl) V.ctl.abort(); } catch (e) {}
    V.note = '已停止（已生成的部分不会存进历史）';
    if (V.timer) { clearTimeout(V.timer); V.timer = null; }
    paint();
  }
  async function run(days) {
    if (V.running) return;
    V.days = +days || V.days;
    if (!cfgOK()) {
      V.err = null; V.text = '';
      V.note = '还没配 AI：先去「AI 与知识库」配一下';
      paint();
      var out0 = document.getElementById('repOut');
      if (out0) out0.innerHTML = '<div class="note">还没配 AI：去 <a href="#/kb">AI 与知识库</a> 选一个服务、填上模型（本地 Ollama 也行），再回来点「生成报告」。'
        + '<div class="small muted">学情诊断要用模型把数据写成话，所以得先有可用的 AI。</div></div>';
      if (typeof toast === 'function') toast('还没配 AI：先去「AI 与知识库」配一下');
      return;
    }
    var sum = buildSummary(V.days);
    V.lastTagDim = sum.data.tagDim;
    if (sum.data.answered < MIN_N) {
      if (!confirm('这 ' + V.days + ' 天只做了 ' + sum.data.answered + ' 题，样本太小，结论可能不准。还是要生成吗？')) return;
    }
    var today = dayKey(Date.now());
    var sameDay = REPORTS.filter(function (r) { return dayKey(+r.ts || 0) === today; })[0];
    if (sameDay && !confirm('今天已经生成过一份了（' + new Date(+sameDay.ts).toLocaleTimeString() + '），要再生成一份新的吗？\n\n点「取消」保留原来那份。')) return;
    V.running = true; V.text = ''; V.err = null; V.note = ''; V.lastSum = sum.text;
    V.ctl = ('AbortController' in window) ? new AbortController() : null;
    paint();
    var msgs = [{ role: 'system', content: sysText() }, { role: 'user', content: askText(sum.text) }];
    V.msgs = msgs;
    var timedOut = false;
    V.timer = setTimeout(function () { timedOut = true; if (V.running) { V.note = '已经 30 秒了：模型慢可以继续等，或点「停止」'; paint(); } }, 30000);
    try {
      var txt = await aiChat(msgs, function (full) {
        V.text = full || '';
        if (!timedOut) paint();
      }, V.ctl ? V.ctl.signal : undefined);
      V.text = txt || V.text;
    } catch (e) {
      var stopped = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      if (!stopped) V.err = (typeof aiErrInfo === 'function') ? aiErrInfo(e) : { msg: (e && e.message) || '出错', hint: '' };
    } finally {
      if (V.timer) { clearTimeout(V.timer); V.timer = null; }
      V.running = false; V.ctl = null;
    }
    if (V.err) { paint(); return; }
    if (!V.text) { V.note = '模型没返回内容，再试一次'; paint(); return; }
    /* 存历史（最多留 MAX_KEEP 份，同一天多份按时间排） */
    var rec = { id: 'r' + Date.now().toString(36), ts: Date.now(), days: V.days, text: V.text, summary: { answered: sum.data.answered, acc: sum.data.acc, weak: (sum.data.srs.weakTop3 || []).join('、'), due: sum.data.srs.dueNow } };
    REPORTS.push(rec);
    var keep = sorted().slice(0, MAX_KEEP);
    var dropIds = sorted().slice(MAX_KEEP).map(function (r) { return r.id; });
    REPORTS = keep;
    if (dropIds.length && typeof tombAdd === 'function') dropIds.forEach(function (id) { tombAdd('report', id); });
    save();
    V.note = '已生成并存进历史（' + REPORTS.length + ' 份）';
    paint();
    if (typeof render === 'function') { try { render(); } catch (e) {} }
  }
  function delReport(id) {
    var r = REPORTS.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (!confirm('删掉这份报告（' + new Date(+r.ts).toLocaleString() + '）？')) return;
    REPORTS = REPORTS.filter(function (x) { return x.id !== id; });
    if (typeof tombAdd === 'function') tombAdd('report', id);
    save();
    if (typeof render === 'function') { try { render(); } catch (e) {} }
  }
  function showReport(id) {
    var r = REPORTS.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    V.text = r.text; V.days = +r.days || V.days; V.err = null;
    V.note = '这是 ' + new Date(+r.ts).toLocaleString() + ' 生成的那份（' + V.days + ' 天窗口）';
    paint();
    var box = document.getElementById('repOut');
    if (box) box.scrollIntoView({ block: 'nearest' });
  }
  function copyText() {
    var t = V.text;
    if (!t) { if (typeof toast === 'function') toast('还没有报告可复制'); return; }
    var head = '# 学情诊断（' + V.days + ' 天）\n\n' + new Date().toLocaleString() + '\n\n';
    if (navigator.clipboard) navigator.clipboard.writeText(head + t).then(function () { toast('报告已复制'); }, function () { fallback(head + t); });
    else fallback(head + t);
  }
  function fallback(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('报告已复制'); } catch (e) { toast('复制失败，手动选中吧'); }
    ta.remove();
  }
  function exportMd() {
    if (!V.text) { if (typeof toast === 'function') toast('还没有报告可导出'); return; }
    var name = '学情诊断-' + dayKey(Date.now()) + '.md';
    var head = '# 学情诊断（最近 ' + V.days + ' 天）\n\n> 生成时间：' + new Date().toLocaleString() + ' · 由刷题站的 AI 学情诊断生成\n\n';
    try { download(name, head + V.text, 'text/markdown'); }
    catch (e) { copyText(); }
  }
  function copyAsk() {
    if (!V.lastSum) V.lastSum = buildSummary(V.days).text;
    var t = sysText() + '\n\n' + askText(V.lastSum);
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { toast('提问已复制，粘到任意 AI 里就能问'); }, function () { fallback(t); });
    else fallback(t);
  }

  /* ---------- 界面 ---------- */
  function histHtml() {
    var rs = sorted();
    if (!rs.length) return '<div class="small muted" style="margin-top:8px">还没有历史报告。</div>';
    return '<div class="rep-hist"><div class="small muted" style="margin:8px 0 4px">历史报告（最近 ' + rs.length + ' 份，只留 ' + MAX_KEEP + ' 份）</div>'
      + rs.map(function (r) {
        var s = r.summary || {};
        return '<div class="rep-item"><button class="rep-open" data-repopen="' + esc(r.id) + '" title="看这份报告">'
          + '<b>' + esc(new Date(+r.ts).toLocaleString()) + '</b>'
          + '<span class="small muted">' + (+r.days || 7) + ' 天 · ' + (s.answered || 0) + ' 题 · 正确率 ' + (s.acc == null ? '—' : s.acc + '%')
          + (s.weak ? ' · 最弱 ' + esc(s.weak) : '') + '</span></button>'
          + '<button class="btn tiny" data-repcopy="' + esc(r.id) + '">复制</button>'
          + '<button class="btn tiny danger" data-repdel="' + esc(r.id) + '" title="删掉这份">删</button></div>';
      }).join('') + '</div>';
  }
  function controlsHtml() {
    var cfg = null;
    try { cfg = (typeof aiCfg === 'function') ? aiCfg() : null; } catch (e) {}
    var d = staleDays();
    var stale = (d == null || d >= 7);
    return '<div class="tools" style="margin-top:0">'
      + '<span class="mini-tag">时间窗</span>'
      + DAYS.map(function (n) {
        return '<button class="btn tiny' + (V.days === n ? ' primary' : '') + '" data-repd="' + n + '">' + n + ' 天</button>';
      }).join('')
      + '<button class="btn tiny primary" id="repGo"' + (V.running ? ' disabled' : '') + '>' + (V.text ? '重新生成' : '生成报告') + '</button>'
      + '<button class="btn tiny" id="repStop" style="display:' + (V.running ? '' : 'none') + '">停止</button>'
      + '<span class="spacer-grow"></span>'
      + '<span class="tl" id="repState">' + (V.running ? '生成中…' : (V.note || (d == null ? '还没生成过' : (d === 0 ? '今天生成过' : '上次生成：' + d + ' 天前')))) + '</span></div>'
      + '<div class="small muted" style="margin:6px 0 0">'
      + (stale ? '<span class="rep-stale">该更新学情报告了</span>　' : '')
      + '模型：' + esc((cfg && cfg.model) || '（还没配）')
      + '　·　报告会把<b>你的题干文本和作答记录</b>发给你配置的模型服务商（介意就用本地模型，或别生成）'
      + '</div>'
      + '<div class="rep-bar" id="repBar" style="display:' + (V.running ? '' : 'none') + '"><i></i></div>'
      + '<div class="rep-out" id="repOut"></div>'
      + '<div class="tools" style="margin-top:8px">'
      + '<button class="btn tiny" data-repcopy="1">复制</button>'
      + '<button class="btn tiny" data-repexport="1">导出 md</button>'
      + '<button class="btn tiny" data-repask="1" title="不花额度：把提问复制出来，自己粘到任意 AI 里">复制提问</button>'
      + '<span class="spacer-grow"></span>'
      + '<a class="btn tiny" href="#/report">看全部报告 ›</a></div>'
      + histHtml();
  }
  function blockHtml() {
    var d = staleDays();
    return '<details class="fold" id="repFold"' + (V.running ? ' open' : '') + '>'
      + '<summary>学情诊断（周报）'
      + '<span class="small muted" style="margin-left:6px">' + (d == null ? '还没生成过' : (d === 0 ? '今天生成过' : '上次 ' + d + ' 天前'))
      + (d == null || d >= 7 ? ' · <span class="rep-stale">该更新了</span>' : '') + '</span>'
      + '</summary><div class="fold-body" id="repBody">' + controlsHtml() + '</div></details>';
  }
  function bind(host) {
    host = host || document;
    var fold = host.querySelector ? host.querySelector('#repFold') : null;
    if (fold && V.running) fold.open = true;
    if (host.__repBound) { paint(); return; }
    host.__repBound = true;
    host.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var d = t.closest('[data-repd]');
      if (d) { V.days = +d.getAttribute('data-repd'); V.note = '已切到 ' + V.days + ' 天窗口（点「生成报告」重新算）'; paint();
        document.querySelectorAll('[data-repd]').forEach(function (b) { b.classList.toggle('primary', +b.getAttribute('data-repd') === V.days); });
        return; }
      if (t.closest('#repGo')) { run(V.days); return; }
      if (t.closest('#repStop')) { stop(); return; }
      if (t.closest('[data-repexport]')) { exportMd(); return; }
      if (t.closest('[data-repask]')) { copyAsk(); return; }
      var cp = t.closest('[data-repcopy]');
      if (cp) {
        var id = cp.getAttribute('data-repcopy');
        if (id && id !== '1') { var r = REPORTS.filter(function (x) { return x.id === id; })[0]; if (r) { V.text = r.text; V.days = +r.days || V.days; V.note = '这是 ' + new Date(+r.ts).toLocaleString() + ' 的那份'; paint(); } }
        copyText(); return;
      }
      var op = t.closest('[data-repopen]');
      if (op) { showReport(op.getAttribute('data-repopen')); return; }
      var dl = t.closest('[data-repdel]');
      if (dl) { delReport(dl.getAttribute('data-repdel')); return; }
    });
    paint();
  }
  /* 统计页的区块：柱子/题库那些点完会重画，重画后要靠这个挂回来 */
  function reportSectionHtml() { return '<h2 class="sec" id="secReport">学情诊断（周报）</h2>' + blockHtml(); }
  function renderReport() {
    var v = document.getElementById('view');
    if (!v) return;
    try { if (typeof $ === 'function') { $('appTitle').textContent = '学情诊断'; $('stat').textContent = ''; $('bar').style.width = '0%'; } } catch (e) {}
    v.innerHTML = '<div class="card">' + controlsHtml() + '</div>';
    bind(v);
  }

  /* 生成中把答题快捷键也让开（复用上一轮 ai.js 那个 aiBusy 闸门） */
  try {
    var prevBusy = window.aiBusy;
    window.aiBusy = function () { return (typeof prevBusy === 'function' && prevBusy()) || V.running; };
  } catch (e) {}

  rd();
  window.reportSectionHtml = reportSectionHtml;
  window.bindReport = bind;
  window.renderReport = renderReport;
  window.REPORT = {
    run: run, stop: stop, html: reportSectionHtml, block: blockHtml, bind: bind, render: renderReport,
    data: function () { return REPORTS; }, reload: function () { rd(); },
    summary: buildSummary, sys: sysText, ask: askText, days: function () { return V.days; }, state: V,
    del: delReport, copy: copyText, exportMd: exportMd
  };
})();
