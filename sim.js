/* sim.js —— 作答界面的「🔍 相似题」
   1) 本地：中文 2-gram TF-IDF 余弦 + 标签/题型/科目加成，秒出候选
   2) AI 精排（可选，要有模型）：把当前题和候选交给 aiChat，让它挑并说明为什么像
   依赖（都是经典脚本的全局函数/常量）：bankById / allBanks / QZ / render / esc / $ /
   tagListOf / basicTags / aiChat / aiErrInfo
   自己挂在 window.SIMQ。 */
(function () {
  'use strict';

  var MAXC = 14;          /* 最多列多少条候选 */
  var AI_TOPN = 8;        /* 交给 AI 精排的候选数 */
  var AI_TIMEOUT = 20000;

  var S = { open: false, scope: 'bank', ai: null, abort: null, seq: 0, note: '', mode: 'q', text: '' };

  /* ---------- 文本与相似度 ---------- */

  /* 只用题干 + 解析做字面比较：选项里大量共同套话（「下列哪项」「最常见」）会把
     不相干的题也顶到十几点相似度，实测把选项算进去排序明显更糊。 */
  function normText(q) {
    var parts = [q.stem || ''];
    if (q.explain) parts.push(q.explain);
    return parts.join('\n');
  }

  /* 2-gram：去掉空白和标点，中文按下标切；英文/数字串保留整词 */
  function grams(s) {
    s = String(s || '');
    var out = [];
    var re = /[A-Za-z0-9]+/g, m;
    while ((m = re.exec(s))) out.push(m[0].toLowerCase());
    var cn = s.replace(/[^\u4e00-\u9fa5]+/g, '');
    for (var i = 0; i < cn.length - 1; i++) out.push(cn.slice(i, i + 2));
    if (cn.length === 1) out.push(cn);
    return out;
  }

  function vec(g) {
    var t = Object.create(null);
    for (var i = 0; i < g.length; i++) t[g[i]] = (t[g[i]] || 0) + 1;
    return t;
  }

  function cosine(a, b, idf) {
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) {
      var w = idf[k] || 1;
      var av = a[k] * w;
      na += av * av;
      if (b[k]) dot += av * (b[k] * w);
    }
    for (k in b) {
      var w2 = idf[k] || 1;
      var bv = b[k] * w2;
      nb += bv * bv;
    }
    if (!na || !nb) return 0;
    return dot / Math.sqrt(na * nb);
  }

  function tagSetOf(q, bankId) {
    var set = Object.create(null);
    try {
      var k = bankId + '#' + q.id;
      var list = tagListOf(k) || [];
      for (var i = 0; i < list.length; i++) set[list[i]] = 1;
    } catch (e) {}
    return set;
  }

  function jaccard(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length || !kb.length) return 0;
    var inter = 0;
    for (var i = 0; i < ka.length; i++) if (b[ka[i]]) inter++;
    return inter / (ka.length + kb.length - inter);
  }

  /* 在当前题库（或全部题库）里给 cur 找相似题 */
  function rank(cur, bankId, scope) {
    var banks = [];
    if (scope === 'all') {
      try { banks = (allBanks() || []).slice(); } catch (e) { banks = []; }
    } else {
      var b = null;
      try { b = bankById(bankId); } catch (e) {}
      if (b) banks = [b];
    }
    var pool = [];
    banks.forEach(function (bk) {
      (bk.questions || []).forEach(function (q) { pool.push({ bank: bk, q: q }); });
    });
    if (pool.length < 2) return [];

    var curG = grams(normText(cur));
    var curV = vec(curG);
    var curTags = tagSetOf(cur, bankId);

    /* 全局 IDF：越稀有的 2-gram 越值钱 */
    var df = Object.create(null), total = pool.length;
    var vecs = pool.map(function (it) {
      var v = vec(grams(normText(it.q)));
      for (var k in v) df[k] = (df[k] || 0) + 1;
      return v;
    });
    var idf = Object.create(null);
    for (var k in df) idf[k] = Math.log(1 + total / df[k]);

    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i];
      if (String(it.q.id) === String(cur.id) && it.bank.id === bankId) continue;
      var sim = cosine(curV, vecs[i], idf);
      var tj = jaccard(curTags, tagSetOf(it.q, it.bank.id));
      var bonus = 0;
      if (tj) bonus += 0.35 * tj;
      if (it.q.group && cur.group && it.q.group === cur.group) bonus += 0.06;
      if (it.q.type && cur.type && it.q.type === cur.type) bonus += 0.02;
      var score = sim + bonus;
      if (score > 0.02) out.push({ bank: it.bank, q: it.q, sim: sim, score: score, tshare: tj });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    out = out.slice(0, MAXC);
    /* 显示用相对相似度：第一名约 100%，其余按比例，比绝对值好读（绝对值受题库大小影响很大） */
    var mx = out.length ? out[0].score : 1;
    out.forEach(function (it) { it.rel = mx > 0 ? it.score / mx : 0; });
    return out;
  }

  /* 拿一段「任意文字」（右键选中的解析 / 笔记 / 题干片段）去题库里找相关题 */
  function rankText(text, scope) {
    var banks = [];
    try {
      if (scope === 'bank') { var b0 = bankById(S.bankId || (typeof QZ !== 'undefined' ? QZ.bankId : '')); if (b0) banks = [b0]; }
    } catch (e) { banks = []; }
    if (!banks.length) {
      try { banks = (allBanks() || []).slice(); } catch (e) { banks = []; }
    }
    var pool = [];
    banks.forEach(function (bk) {
      (bk.questions || []).forEach(function (q) { pool.push({ bank: bk, q: q }); });
    });
    if (!pool.length) return [];

    var qv = vec(grams(normText({ stem: text, options: [], explain: '' })));
    var df = Object.create(null), total = pool.length;
    var vecs = pool.map(function (it) {
      var v = vec(grams(normText(it.q)));
      for (var k in v) df[k] = (df[k] || 0) + 1;
      return v;
    });
    var idf = Object.create(null);
    for (var k2 in df) idf[k2] = Math.log(1 + total / df[k2]);

    /* 文字里出现的标签名也算一点分（「急腹症」这种关键词常常就是考点名） */
    var lowText = String(text || '').toLowerCase();
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i];
      var sim = cosine(qv, vecs[i], idf);
      var bonus = 0;
      try {
        var tags = tagListOf(it.bank.id + '#' + it.q.id) || [];
        for (var t = 0; t < tags.length; t++) {
          var nm = String(tags[t] || '').toLowerCase();
          if (nm && nm.length >= 2 && lowText.indexOf(nm) >= 0) { bonus += 0.12; break; }
        }
      } catch (e) {}
      var score = sim + bonus;
      if (score > 0.02) out.push({ bank: it.bank, q: it.q, sim: sim, score: score, tshare: 0 });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    out = out.slice(0, MAXC);
    var mx = out.length ? out[0].score : 1;
    out.forEach(function (it) { it.rel = mx > 0 ? it.score / mx : 0; });
    return out;
  }

  /* ---------- 渲染 ---------- */

  function pct(x) { return Math.max(1, Math.min(99, Math.round(x * 100))); }

  function cut(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function rowHtml(it, i) {
    var why = it.why ? '<div class="sim-why">' + esc(it.why) + '</div>' : '';
    var same = it.bank && curBankId && it.bank.id !== curBankId
      ? '<span class="sim-bank">' + esc(it.bank.title || '') + '</span>' : '';
    var isAi = !!it.ai;
    var scoreCell = isAi
      ? '<div class="sim-score sim-ai"><b>✨</b></div>'
      : '<div class="sim-score"><b>' + pct(it.rel || it.score) + '</b><span>%</span></div>';
    var localPct = isAi ? '<span class="sim-bank">本地 ' + pct(it.rel || it.score) + '%</span>' : '';
    return '<div class="sim-row' + (isAi ? ' is-ai' : '') + '" data-simrow="' + i + '">'
      + scoreCell
      + '<div class="sim-main">'
      + '<div class="sim-q">' + esc(cut(it.q.stem, 90)) + '</div>'
      + '<div class="sim-meta">' + localPct + same + '<span>' + esc(tagLine(it)) + '</span></div>'
      + why
      + '</div>'
      + '<button type="button" class="btn tiny sim-go" data-simgo="' + i + '">跳过去</button>'
      + '</div>';
  }

  function tagLine(it) {
    var t = [];
    try {
      var list = tagListOf(it.bank.id + '#' + it.q.id) || [];
      t = list.slice(0, 3);
    } catch (e) {}
    if (!t.length) t = ['无标签'];
    return t.join(' · ');
  }

  var curBankId = null;
  var curQ = null;
  var results = [];

  function panelHtml() {
    return '<div class="sim-mask" id="simMask" hidden>'
      + '<div class="sim-panel" role="dialog" aria-label="相似题">'
      + '<div class="sim-head">'
      + '<b id="simTitle">相似题</b>'
      + '<button type="button" class="btn tiny sim-x" id="simX" aria-label="关闭">✕</button>'
      + '</div>'
      + '<div class="sim-acts">'
      + '<button type="button" class="btn tiny" id="simAi">✨ AI 精排</button>'
      + '<label class="sim-scope"><input type="checkbox" id="simAll"> 也找别的题库</label>'
      + '<span class="sim-note small muted" id="simNote"></span>'
      + '</div>'
      + '<div class="sim-list" id="simList"></div>'
      + '<div class="sim-foot small muted">本地按题干 / 选项 / 标签的字面相似度排序。配了模型后点「✨ AI 精排」，会让它再挑一遍并说明为什么像。</div>'
      + '</div></div>';
  }

  function ensurePanel() {
    var m = document.getElementById('simMask');
    if (m) return m;
    var d = document.createElement('div');
    d.innerHTML = panelHtml();
    m = d.firstChild;
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m) close();
    });
    m.querySelector('#simX').addEventListener('click', close);
    m.querySelector('#simAi').addEventListener('click', aiRank);
    m.querySelector('#simAll').addEventListener('change', function (e) {
      S.scope = e.target.checked ? 'all' : 'bank';
      paint();
    });
    m.querySelector('#simList').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-simgo]') : null;
      if (!b) return;
      var i = +b.getAttribute('data-simgo');
      jump(results[i]);
    });
    return m;
  }

  function paint() {
    var m = ensurePanel();
    var bank = null;
    try { bank = bankById(curBankId); } catch (e) {}
    var isText = S.mode === 'text';
    if (isText) {
      results = rankText(S.text, S.scope);
    } else {
      results = rank(curQ, curBankId, S.scope);
    }
    var list = m.querySelector('#simList');
    m.querySelector('#simTitle').textContent = isText ? '选中文字 · 相关题' : '相似题';
    var note = m.querySelector('#simNote');
    var where = S.scope === 'all' ? '全部题库' : ((bank && bank.title) || '本题库');
    if (isText) where = '关键词：' + cut(S.text, 24) + ' · ' + where;
    if (!results.length) {
      list.innerHTML = '<div class="sim-empty">'
        + (isText ? '这段文字在题库里没找到明显相关的题。' : '这个范围里没找到明显相似的题。')
        + '换「也找别的题库」试试，或者先给题目打上考点标签。</div>';
      note.textContent = where;
      return;
    }
    list.innerHTML = results.map(rowHtml).join('');
    note.textContent = where + ' · 共 ' + results.length + ' 条';
  }

  function jump(it) {
    if (!it || !it.bank) return;
    var sameBank = it.bank.id === curBankId;
    close();
    if (sameBank) {
      /* 记下跳转前那道题：这样点「返回」会先回到它，而不是一路退回主页 */
      try { if (QZ.cur && QZ.cur !== it.q.id) QZ.__jumpPrev = QZ.cur; } catch (e) {}
      try { QZ.cur = it.q.id; } catch (e) {}
      try { render(); } catch (e) {}
      try { window.scrollTo(0, 0); } catch (e) {}
    } else {
      try { location.hash = '#/bank/' + it.bank.id; } catch (e) {}
      setTimeout(function () {
        try { QZ.bankId = it.bank.id; QZ.cur = it.q.id; render(); window.scrollTo(0, 0); } catch (e) {}
      }, 260);
    }
  }

  /* ---------- AI 精排 ---------- */

  function aiReady() {
    try {
      if (typeof aiChat !== 'function') return false;
      var c = (typeof aiCfg === 'function') ? aiCfg() : null;
      return !!(c && c.model);
    } catch (e) { return false; }
  }

  function candidatesForAi() {
    return results.slice(0, AI_TOPN).map(function (it, i) {
      var tags = tagLine(it);
      return (i + 1) + '. [' + tags + '] ' + cut(it.q.stem, 160);
    }).join('\n');
  }

  function parseAi(txt, n) {
    var s = String(txt || '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    var obj;
    try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    var picks = obj && obj.picks;
    if (!picks || !picks.length) return null;
    var out = [];
    picks.forEach(function (p) {
      var i = (typeof p.i === 'number' ? p.i : (typeof p.index === 'number' ? p.index : parseInt(p.id || p.n, 10))) - 1;
      if (i >= 0 && i < n) out.push({ i: i, why: String(p.why || p.reason || '').slice(0, 60) });
    });
    return out.length ? out : null;
  }

  function aiRank() {
    var m = ensurePanel();
    var note = m.querySelector('#simNote');
    var btn = m.querySelector('#simAi');
    if (!results.length) { note.textContent = '还没有候选，先看一眼列表'; return; }
    if (!aiReady()) {
      note.textContent = '还没配模型：去「设置 → AI 服务」填好模型再来';
      return;
    }
    var seq = ++S.seq;
    if (S.abort) { try { S.abort.abort(); } catch (e) {} }
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    S.abort = ctl;
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctl) { try { ctl.abort(); } catch (e) {} } }, AI_TIMEOUT);
    btn.disabled = true;
    note.textContent = 'AI 正在挑…';

    var isText = S.mode === 'text';
    var sys = isText
      ? ('你是医学题库的助教。用户给了「一段原文 / 笔记」和若干「候选题」，'
        + '请挑出考查这段文字里知识点的候选，最多 5 个，按相关度从高到低。')
      : ('你是医学题库的助教。用户给了 1 道「当前题」和若干「候选题」，'
        + '请挑出与当前题考查同一知识点、或容易混淆的候选，最多 5 个，按相关度从高到低。')
      + '只输出一行 JSON：{"picks":[{"i":候选序号,"why":"不超过 18 个字说明为什么像"}]}。'
      + '不要输出别的任何文字；一条都不像就输出 {"picks":[]}。';
    var user = isText
      ? ('原文：\n' + cut(S.text, 400) + '\n\n候选题：\n' + candidatesForAi())
      : ('当前题：\n' + cut(curQ.stem, 220)
        + '\n选项：' + (curQ.options || []).map(function (o, i) { return 'ABCDEFGH'[i] + '.' + cut(o, 24); }).join(' ')
        + '\n\n候选题：\n' + candidatesForAi());

    var p;
    try {
      p = aiChat(
        [{ role: 'system', content: sys }, { role: 'user', content: user }],
        null, ctl ? ctl.signal : null, { stream: false, temp: 0.2, maxTokens: 600 }
      );
    } catch (e) {
      p = Promise.reject(e);
    }
    Promise.resolve(p).then(function (txt) {
      if (seq !== S.seq) return;
      var picks = parseAi(txt, Math.min(AI_TOPN, results.length));
      if (!picks || !picks.length) { note.textContent = 'AI 说没有特别像的，看本地结果就行'; return; }
      var head = [], seen = Object.create(null);
      picks.forEach(function (pk) {
        var it = results[pk.i];
        if (!it || seen[pk.i]) return;
        seen[pk.i] = 1;
        var cp = {};
        for (var k in it) cp[k] = it[k];
        cp.why = pk.why; cp.ai = true;
        head.push(cp);
      });
      var rest = results.filter(function (_, i) { return !seen[i]; });
      results = head.concat(rest);
      m.querySelector('#simList').innerHTML = results.map(rowHtml).join('');
      note.textContent = 'AI 挑了 ' + head.length + ' 条（带理由的那几条）';
    }).catch(function (e) {
      if (seq !== S.seq) return;
      if (e && e.name === 'AbortError' && !timedOut) return;
      var info = (timedOut)
        ? { msg: 'AI 20 秒没返回', hint: '模型可能太慢，换个小的试试' }
        : ((typeof aiErrInfo === 'function') ? aiErrInfo(e) : { msg: (e && e.message) || '出错', hint: '' });
      note.textContent = info.msg + (info.hint ? ' · ' + info.hint : '');
    }).then(function () {
      clearTimeout(timer);
      if (S.abort === ctl) S.abort = null;
      if (btn) btn.disabled = false;
    });
  }

  /* ---------- 开关 ---------- */

  function open() {
    var bank = null, q = null;
    try { bank = bankById(QZ.bankId); } catch (e) {}
    if (!bank) return;
    try {
      q = (bank.questions || []).filter(function (x) { return String(x.id) === String(QZ.cur); })[0];
    } catch (e) {}
    if (!q) return;
    curBankId = bank.id;
    curQ = q;
    S.mode = 'q';
    S.text = '';
    S.open = true;
    var m = ensurePanel();
    m.hidden = false;
    m.classList.add('show');
    paint();
  }

  function close() {
    var m = document.getElementById('simMask');
    if (m) { m.classList.remove('show'); m.hidden = true; }
    S.open = false;
    S.seq++;
    if (S.abort) { try { S.abort.abort(); } catch (e) {} S.abort = null; }
  }

  /* 从右键菜单进来：拿选中的一段文字去题库里找相关题 */
  function openText(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 4) {
      if (typeof toast === 'function') toast('先选中一段文字（至少 4 个字）再找', 1800, 'warn');
      return;
    }
    S.mode = 'text';
    S.text = t;
    S.scope = 'all';
    curQ = null;
    curBankId = null;
    S.open = true;
    var m = ensurePanel();
    m.hidden = false;
    m.classList.add('show');
    var all = m.querySelector('#simAll');
    if (all) all.checked = true;
    paint();
  }

  function toggle() { if (S.open) close(); else open(); }

  /* 换页/跳转时把面板收掉，别让它挡住新页面 */
  window.addEventListener('hashchange', function () { if (S.open) close(); });

  window.SIMQ = {
    open: open, openText: openText, close: close, toggle: toggle,
    rank: function (scope) { S.scope = scope || 'bank'; if (curQ) paint(); },
    state: function () { return { open: S.open, scope: S.scope, n: results.length, aiReady: aiReady() }; }
  };
})();
