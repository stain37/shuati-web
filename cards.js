/* ============================================================
   cards.js —— 考点预览 + 背诵卡片（web786）
   ------------------------------------------------------------
   数据全部来自本机已有内容，不新增题库结构：
     BANKS/题目        ：题库里的题干、选项、答案、解析
     qbank.tags.v1     ：每题标签（tags.js），形如 ["外科","麦氏点压痛"]
   新增的存储只有两把：
     qbank.cards.gen.v1  ：每个考点的一句「可背诵结论」+ 关键词（AI 生成，可留空）
     qbank.cards.mark.v1 ：点过「会了 / 还不会」的记录
   页面：
     #/cards            题库选择
     #/cards/<bankId>   考点预览（按科目分组）+ 点开卡片
   ============================================================ */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var GEN_KEY = 'qbank.cards.gen.v1';
  var MARK_KEY = 'qbank.cards.mark.v1';
  var SUBJ_ALL = ['生理', '生化', '病理', '内科', '外科', '人文', '政治'];

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function readLS(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; }
  }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(msg, ms, kind) {
    try { if (typeof window.toast === 'function') return window.toast(msg, ms, kind); } catch (e) {}
  }
  /* app.js 里的 BANKS / kOf / QZ 都是顶层绑定、不挂 window，只能间接 eval 取 */
  function gv(expr, dflt) {
    try { var v = (0, eval)(expr); return v == null ? dflt : v; } catch (e) { return dflt; }
  }
  function allBanks() {
    var bs = gv('baseBanks()', null);
    if (!bs || !bs.length) bs = gv('BANKS', []) || [];
    return (bs || []).filter(function (b) { return b && b.id && (b.questions || []).length; });
  }
  function bankOf(id) {
    var bs = allBanks();
    for (var i = 0; i < bs.length; i++) if (String(bs[i].id) === String(id)) return bs[i];
    return null;
  }
  function kOf(b, q) {
    try {
      if (b && b.paper && q && q._srcKey) return q._srcKey;
      return b.id + '#' + q.id;
    } catch (e) { return ''; }
  }
  function tagsOf(q, k) {
    var arr = null;
    try { if (window.TAGS && TAGS.of) arr = TAGS.of(k); } catch (e) {}
    if (!arr || !arr.length) arr = q && q.tags;
    return (arr || []).filter(Boolean).map(String);
  }
  function basicList() {
    var b = null;
    try { if (window.TAGS && TAGS.basic) b = TAGS.basic(); } catch (e) {}
    return (b && b.length) ? b : SUBJ_ALL;
  }
  function subjectOf(tags) {
    var basic = basicList();
    for (var i = 0; i < tags.length; i++) if (basic.indexOf(tags[i]) >= 0) return tags[i];
    return '未分科';
  }
  function pointOf(tags) {
    var basic = basicList();
    var pts = tags.filter(function (t) { return basic.indexOf(t) < 0; });
    return pts.length ? pts : [];
  }
  function markers() { return readLS(MARK_KEY, {}); }
  function genMap() { return readLS(GEN_KEY, {}); }

  /* ---------- 一句「可背诵结论」 ---------- */
  function tidyOne(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^【[^】]*】/, '').replace(/^解析\s*[:：]?\s*/, '').replace(/^答案\s*[:：]?\s*/, '');
    return s;
  }
  function firstSentence(s, max) {
    s = tidyOne(s);
    if (!s) return '';
    var m = s.match(/^[^。！？；]{6,}?[。！？；]/);
    var out = m ? m[0] : s;
    out = out.replace(/[。！？；]$/, '');
    max = max || 62;
    if (out.length > max) out = out.slice(0, max);
    return out;
  }
  function fallbackOne(item) {
    var q = item.q;
    var e = firstSentence(q.explain || q.exp || '', 62);
    if (e) return e;
    var ans = (q.answer || []).join('');
    var opt = q.options || [];
    var texts = (q.answer || []).map(function (a) {
      var s = opt[String(a).charCodeAt(0) - 65] || '';
      return String(s).replace(/^[A-H][\s.、．]?/, '');
    }).filter(Boolean);
    var head = firstSentence(q.stem || '', 40);
    if (texts.length) return head + ' → ' + texts.join(' / ');
    return head || '（这道题还没有解析，去题库里看原题）';
  }
  function oneOf(item) {
    var g = genMap()[item.key];
    if (g && g.t) return { t: g.t, k: (g.k || []), ai: 1 };
    return { t: fallbackOne(item), k: [], ai: 0 };
  }
  function markOf(item) { var m = markers()[item.key]; return m == null ? 0 : m; }

  /* ---------- 整库批量写结论 ---------- */
  var GEN = { on: false, stop: false, done: 0, total: 0 };
  function missGen(items) {
    var g = genMap();
    return (items || []).filter(function (it) { return !(g[it.key] && g[it.key].t); });
  }
  /* 卡片正文只讲知识点：把「本题/答案是/正确选项」这类做题腔清掉 */
  function cleanCard(t) {
    var lines = String(t || '').split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    var out = [];
    lines.forEach(function (ln) {
      var body = ln.replace(/^[·•\-*]\s*/, '');
      if (/^(本题|这题|该题|题干|答案|正确答案|正确选项|选项)/.test(body)) return;
      body = body.replace(/[，,；;]?\s*(所以|因此)?\s*(本题|这题|该题)?\s*(答案|正确答案)?\s*(应?选|是)\s*[A-H]{1,4}\s*[）)]?\s*$/i, '');
      body = body.replace(/[（(]\s*[A-H]{1,4}\s*(对|正确)[）)]/g, '').trim();
      if (!body) return;
      out.push(/^[·•]/.test(ln) ? '· ' + body : body);
    });
    return out.join('\n').slice(0, 420);
  }
  function askOne(it) {
    var q = it.q || {};
    var sys = '你是医学考研辅导老师，正在给学生写背诵卡（不是写答案解析）。\n'
      + '第 1 行：一句话结论（≤40 字，直接陈述知识点本身，例如「骨骼肌强直收缩时钙离子主要来自肌浆网」）。\n'
      + '第 2 行起：2–5 条要点，每条以「· 」开头，把这题牵涉的知识点讲全——定义/机制、典型表现、鉴别点、关键数值或分型、易错点。\n'
      + '禁止出现做题口吻：不要写「本题」「这题」「该题」「答案是」「正确选项」「故选」「A/B/C/D」，也不要复述题干；只陈述医学结论。\n'
      + '要求：只能用题干和解析里出现的内容，不补充题外知识，不编数字；总长 ≤220 字。'
      + '再给 3-6 个关键词（用于标黄，别和考点名重复）。只输出 JSON：'
      + '{"t":"第1行\n· 要点1\n· 要点2","k":["关键词1","关键词2"]}';
    var usr = '考点：' + it.tag + '\n题干：' + String(q.stem || '').slice(0, 400)
      + '\n答案：' + (q.answer || []).join('')
      + '\n解析：' + tidyOne(q.explain || q.exp || '').slice(0, 900)
      + (q.options && q.options.length ? '\n选项：' + q.options.map(function (o, i) { return String.fromCharCode(65 + i) + '. ' + String(o).slice(0, 90); }).join(' ').slice(0, 600) : '');
    function call(mt) {
      return Promise.resolve(window.aiChat([{ role: 'system', content: sys }, { role: 'user', content: usr }],
        null, null, { stream: false, temp: 0.2, maxTokens: mt }));
    }
    var ok = (typeof window.aiChat === 'function');
    return (ok ? call(900).then(function (t0) {
      return String(t0 || '').trim() ? t0 : call(3200);
    }) : Promise.reject(new Error('AI 模块没加载')))
      .then(function (txt) {
        var m = String(txt || '').match(/\{[\s\S]*\}/), o = null;
        try { o = JSON.parse(m ? m[0] : txt); } catch (e) { o = null; }
        if (!o || !o.t) throw new Error('没解析出结论');
        var head = cleanCard(String(o.t).replace(/^\s*(单张重写|重新生成|卡片)[:：]\s*/, ''));
        if (!head) throw new Error('只写了做题分析，没有知识点');
        return { t: head, k: (o.k || []).slice(0, 6), ts: Date.now() };
      })
      .catch(function () {
        /* AI 没写出来：先用解析首句 / 题干顶上，保证这一张不是空的，之后可以单张重写 */
        var sents = tidyOne(q.explain || q.exp || '').split(/[。；;\n]/).map(function (x) { return String(x || '').trim(); })
          .filter(function (x) { return x.length >= 6 && !/本题|这题|该题|答案|选项|故选|正确项|错误项/.test(x); });
        if (sents.length) {
          var txt = sents[0].slice(0, 60);
          sents.slice(1, 4).forEach(function (x) { txt += '\n· ' + x.slice(0, 60); });
          if (txt.indexOf('\n') < 0) {
            /* 解析只有一句时，用正确选项的原文补一条「要点」，仍然只讲知识点、不写「答案选 X」 */
            var opts = q.options || [];
            var pick = (q.answer || []).map(function (a) {
              var i = String(a).charCodeAt(0) - 65;
              return opts[i] ? String(opts[i]).replace(/^[A-H][\s.、．]?/, '').slice(0, 50) : '';
            }).filter(Boolean).join(' / ');
            if (pick) txt += '\n· ' + pick;
          }
          return { t: txt, k: [], ts: Date.now(), auto: 1 };
        }
        return { t: fallbackOne(it), k: [], ts: Date.now(), auto: 2 };
      });
  }
  function paintGen() {
    var b = document.getElementById('cdGenAll');
    if (b) {
      b.textContent = GEN.on ? ('■ 停止（' + GEN.done + '/' + GEN.total + '）') : '✨ 一键写完全部结论';
      b.classList.toggle('on', !!GEN.on);
    }
    var p = document.getElementById('cdGenProg');
    if (p) p.style.width = (GEN.total ? Math.round(GEN.done * 100 / GEN.total) : 0) + '%';
    var g = document.getElementById('cdGnum');
    if (g) g.textContent = GEN.total ? (GEN.done + ' / ' + GEN.total) : '';
  }
  function genAll(force) {
    if (GEN.on) { GEN.stop = true; toast('停下来…', 1200); return; }
    var bank = bankOf(ST.bankId);
    if (!bank) return;
    var items = itemsOf(bank);
    var g = genMap();
    var todo = items.filter(function (it) { return force || !(g[it.key] && g[it.key].t); });
    if (!todo.length) { toast('这个题库都已经有结论了', 1400); return; }
    GEN = { on: true, stop: false, done: 0, total: todo.length, force: !!force };
    renderPreview();
    paintGen();
    var i = 0, stopped = false;
    (function next() {
      if (GEN.stop) { stopped = true; return finish(); }
      if (i >= todo.length) return finish();
      var it = todo[i++];
      Promise.resolve(askOne(it)).then(function (res) {
        var g2 = genMap(); g2[it.key] = res; writeLS(GEN_KEY, g2);
      }).catch(function () {}).then(function () {
        GEN.done++; paintGen();
        setTimeout(next, 100);
      });
    })();
    function finish() {
      var done = GEN.done, tot = GEN.total;
      GEN.on = false; GEN.stop = false;
      renderPreview();
      toast((stopped ? '已停下，写好 ' : '写完了 ') + done + ' / ' + tot + ' 张', 2200, stopped ? null : 'ok');
    }
  }


  /* ---------- 组装某个题库的考点条目 ---------- */
  function shortStem(q) {
    var s = String((q && q.stem) || '').replace(/\s+/g, '');
    s = s.replace(/[？?。，,；;：:].*$/, '');
    return s.length > 14 ? s.slice(0, 14) + '…' : (s || '（无题干）');
  }
  function itemsOf(bank) {
    var out = [], seen = {};
    (bank.questions || []).forEach(function (q, qi) {
      var k = kOf(bank, q);
      var tags = tagsOf(q, k);
      var subj = subjectOf(tags);
      var pts = pointOf(tags);
      /* 没有考点标签的题：同一「共用题干」并成一张卡；连章节也没有，就一题一卡（用题干当标题） */
      var grp = String(q.groupTitle || q.group || '').trim();
      var tag = pts[0] || grp || shortStem(q);
      var key = pts.length ? ('t:' + tag) : (grp ? ('g:' + subj + '|' + grp) : ('q:' + k));
      if (!seen[key]) {
        seen[key] = { key: key, tag: tag, subj: subj, q: q, k: k, qno: qi + 1, qs: [], kw: [], stems: [] };
        out.push(seen[key]);
      }
      var it = seen[key];
      if (it.subj === '未分科' && subj !== '未分科') it.subj = subj;   /* 同一考点跨题补科目 */
      it.qs.push(qi + 1);
      it.stems.push(String(q.stem || q.gstem || '').slice(0, 80));
      pts.forEach(function (p) { if (p !== tag && it.kw.indexOf(p) < 0 && it.kw.length < 5) it.kw.push(p); });
    });
    var order = basicList().concat(['未分科']);
    out.sort(function (a, b) {
      var ia = order.indexOf(a.subj), ib = order.indexOf(b.subj);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      if (ia !== ib) return ia - ib;
      return (a.qno || 0) - (b.qno || 0);   /* 同一科里保持题目原来的顺序 */
    });
    return out;
  }
  function groupsOf(items) {
    var out = [], cur = null;
    items.forEach(function (it) {
      if (!cur || cur.subj !== it.subj) { cur = { subj: it.subj, list: [] }; out.push(cur); }
      cur.list.push(it);
    });
    return out;
  }

  function progressOf(items) {
    var m = markers(), done = 0, yes = 0, no = 0;
    items.forEach(function (it) {
      var v = m[it.key];
      if (v === 1) { done++; yes++; } else if (v === -1) { done++; no++; }
    });
    return { done: done, yes: yes, no: no, total: items.length };
  }

  /* ---------- 高亮关键词 ---------- */
  function kwList(item) {
    var one = oneOf(item);
    var arr = [one.k || [], item.kw || [], [item.tag]].reduce(function (a, b) { return a.concat(b); }, []);
    var seen = {}, out = [];
    arr.forEach(function (w) {
      w = String(w || '').trim();
      if (w.length < 2 || w.length > 12 || seen[w] || w === item.tag) return;
      seen[w] = 1; out.push(w);
    });
    return out.slice(0, 5);
  }
  function hilite(text, kws, hide) {
    var html = esc(text);
    kws.forEach(function (w) {
      var re = new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      var tag = hide
        ? '<b class="cc-kw hid" data-act="reveal">' + esc(w) + '</b>'
        : '<b class="cc-kw" data-act="kw" data-kw="' + esc(w) + '">' + esc(w) + '</b>';
      html = html.replace(re, tag);
    });
    return html;
  }

  /* ---------- 状态 ---------- */
  var ST = { bankId: null, card: false, i: 0, filter: 'all', items: [], q: '', shuf: false };
  var POS_KEY = 'qbank.cards.pos.v1';

  /* ---------- 真实调度（Anki 式四档 + 到期队列） ---------- */
  var SCHED_KEY = 'qbank.cards.sched.v1';
  var CRT_KEY = 'qbank.cards.crt.v1';
  var RATE_NAME = { 1: '还不会', 2: '有点难', 3: '会了', 4: '简单' };

  function dayNo() { return Math.floor(Date.now() / 86400000); }
  function crtDay() {
    var v = Number(localStorage.getItem(CRT_KEY) || 0);
    if (!v) { v = dayNo(); try { localStorage.setItem(CRT_KEY, String(v)); } catch (e) {} }
    return v;
  }
  function schedMap() { return readLS(SCHED_KEY, {}) || {}; }
  function stateOf(it, idx) {
    var st = schedMap()[it.key];
    if (st && st.type != null) return st;
    return { type: 0, queue: 0, due: idx || 0, ivl: 0, factor: 2500, reps: 0, lapses: 0, left: 0 };
  }
  function isReady(st) {
    if (!st || st.type === 0) return true;
    if (st.type === 2) return crtDay() + st.due <= dayNo();
    return st.due <= Math.floor(Date.now() / 1000);
  }
  function dueText(st) {
    if (!st || st.type === 0) return '新卡';
    if (st.type === 2) {
      var d = crtDay() + st.due - dayNo();
      return d <= 0 ? '今天到期' : (d + ' 天后');
    }
    var sec = st.due - Math.floor(Date.now() / 1000);
    if (sec <= 0) return '现在到期';
    if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + ' 分钟后';
    if (sec < 86400) return Math.round(sec / 3600) + ' 小时后';
    return Math.round(sec / 86400) + ' 天后';
  }

  function filterItems() {
    var m = markers();
    var list = ST.items;
    if (ST.filter === 'due') list = list.filter(function (it) { return isReady(stateOf(it)); });
    else if (ST.filter === 'newc') list = list.filter(function (it) { return (stateOf(it).reps || 0) === 0; });
    else if (ST.filter === 'learn') list = list.filter(function (it) { var t = stateOf(it).type; return t === 1 || t === 3; });
    else if (ST.filter === 'review') list = list.filter(function (it) { return stateOf(it).type === 2; });
    else if (ST.filter === 'todo') list = list.filter(function (it) { return m[it.key] !== 1; });
    else if (ST.filter === 'yes') list = list.filter(function (it) { return m[it.key] === 1; });
    else if (ST.filter === 'no') list = list.filter(function (it) { return m[it.key] === -1; });
    var q = String(ST.q || '').trim().toLowerCase();
    if (q) {
      list = list.filter(function (it) {
        var hay = String(it.tag || '') + ' ' + (it.subj || '') + ' ' + (it.stems || []).join(' ');
        return hay.toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function posMap() { return readLS(POS_KEY, {}); }
  function savePos(i) {
    if (!ST.bankId) return;
    var m = posMap();
    m[ST.bankId] = { i: i, ts: Date.now() };
    writeLS(POS_KEY, m);
  }

  /* ---------- 页面一：题库列表 ---------- */
  function renderBankList() {
    var bs = allBanks();
    var h = '<div class="card cd-head">'
      + '<div class="cd-htop"><div><b>🧠 考点卡</b></div>'
      + '<div class="cd-hnum">' + bs.length + '<i>个题库</i></div></div>'
      + '<div class="cd-psrch"><input id="cdBankQ" class="cd-q" placeholder="搜题库名…" value="' + esc(ST.bankQ || '') + '">'
      + '<button class="cd-shuf" id="cdBankAI">✨ AI 模糊</button></div>'
      + '</div>';
    if (!bs.length) {
      h += '<div class="card"><div class="empty">还没有题库。先回首页导入一份。</div></div>';
      $('#view').innerHTML = h;
      return;
    }
    var bq = String(ST.bankQ || '').trim().toLowerCase();
    var bterms = (ST.bankTerms || []).map(function (t) { return String(t).toLowerCase(); });
    if (bq) {
      bs = bs.filter(function (b) {
        var nm = String(b.title || b.id).toLowerCase();
        if (nm.indexOf(bq) >= 0) return true;
        return bterms.some(function (t) { return t && nm.indexOf(t) >= 0; });
      });
    }
    h += '<div class="cd-list">';
    bs.forEach(function (b) {
      var items = itemsOf(b);
      var p = progressOf(items);
      var subjN = {};
      items.forEach(function (it) { subjN[it.subj] = (subjN[it.subj] || 0) + 1; });
      var chips = Object.keys(subjN).map(function (s) { return '<span class="cd-chip">' + esc(s) + ' ' + subjN[s] + '</span>'; }).join('');
      var hay = (String(b.title || b.id) + ' ' + Object.keys(subjN).join(' ')).toLowerCase();
      h += '<div class="card cd-bank" data-s="' + esc(hay) + '">'
        + '<div class="cd-btop"><b>' + esc(b.title || b.id) + '</b><s>' + (b.questions || []).length + ' 题</s></div>'
        + '<div class="cd-bmeta">' + items.length + ' 个考点 · 已背 ' + p.done + ' / ' + p.total + '</div>'
        + '<div class="cd-chips">' + chips + '</div>'
        + '<div class="cd-bacts">'
        + '<button class="btn primary" data-act="open" data-id="' + esc(b.id) + '">看考点 →</button>'
        + '<button class="btn" data-act="quiz" data-id="' + esc(b.id) + '">开始刷题</button>'
        + '</div></div>';
    });
    h += '</div>';
    $('#view').innerHTML = h;
  }

  /* 题库列表：搜索 + AI 模糊（委托，重绘后仍可用） */
  /* 只切 .cd-bank 的 display，不重绘输入框 —— 否则中文输入法会被打断 */
  function filterBankCards() {
    var q = String(ST.bankQ || '').trim().toLowerCase();
    var terms = (ST.bankTerms || []).map(function (t) { return String(t).toLowerCase(); }).filter(Boolean);
    var cards = document.querySelectorAll('#view .cd-bank');
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i], hay = el.getAttribute('data-s') || '';
      var hit = !q || hay.indexOf(q) >= 0 || terms.some(function (t) { return hay.indexOf(t) >= 0; });
      el.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    var box = document.getElementById('cdBankEmpty');
    if (q || terms.length) {
      if (!shown && !box) {
        box = document.createElement('div');
        box.id = 'cdBankEmpty';
        box.className = 'card';
        box.innerHTML = '<div class="empty">没有匹配的题库</div>';
        var list = document.querySelector('#view .cd-list');
        if (list) list.parentNode.insertBefore(box, list.nextSibling);
      } else if (shown && box) box.remove();
    } else if (box) box.remove();
  }
  if (!window.__cdBankBound) {
    window.__cdBankBound = 1;
    document.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'cdBankQ') return;
      ST.bankQ = e.target.value;
      filterBankCards();
    });
    document.addEventListener('compositionend', function (e) {
      if (!e.target || e.target.id !== 'cdBankQ') return;
      ST.bankQ = e.target.value;
      filterBankCards();
    });
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('#cdBankAI');
      if (!b) return;
      var kw0 = String(ST.bankQ || '').trim();
      if (!kw0) { toast('先在搜索框里写个词，AI 再帮你找相近的', 1800); return; }
      if (typeof window.aiChat !== 'function') { toast('AI 模块没加载', 1600); return; }
      b.disabled = true; b.textContent = '…';
      var msgs = [
        { role: 'system', content: '你在给一个医学刷题站的题库名做模糊检索。根据用户给的词，给出 6-10 个可能出现在题库名里的中文关键词（同义词、科目名、年份、题型、别名）。只输出 JSON：{"terms":["…"]}' },
        { role: 'user', content: kw0 }
      ];
      window.aiChat(msgs, { max_tokens: 400, timeout: 20000 }).then(function (txt) {
        var t = String(txt || ''), o = null;
        try { o = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e3) {}
        var list = (o && (o.terms || o.t)) || [];
        if (!list.length) throw new Error('AI 没给出词');
        ST.bankTerms = list.slice(0, 12);
        b.disabled = false; b.textContent = '✨ AI 模糊';
        renderBankList();
        toast('AI 想到 ' + ST.bankTerms.length + ' 个相关词，按这些一起筛', 2200);
      }).catch(function (err) {
        b.disabled = false; b.textContent = '✨ AI 模糊';
        toast('AI 没想出来：' + ((err && err.message) || err), 2200, 'bad');
      });
    });
  }

  /* ---------- 页面二：考点预览 ---------- */
  function renderPreview() {
    var bank = bankOf(ST.bankId);
    if (!bank) { location.hash = '#/cards'; return; }
    ST.items = itemsOf(bank);
    if (ST.shuf) ST.items = shuffleArr(ST.items.slice());
    var p = progressOf(ST.items);
    var list = filterItems();
    var groups = groupsOf(list);
    var mAll = markers();
    var cnt = {
      all: ST.items.length,
      todo: ST.items.filter(function (x) { return mAll[x.key] !== 1; }).length,
      yes: ST.items.filter(function (x) { return mAll[x.key] === 1; }).length,
      no: ST.items.filter(function (x) { return mAll[x.key] === -1; }).length,
      due: ST.items.filter(function (x) { return isReady(stateOf(x)); }).length,
      newc: ST.items.filter(function (x) { return (stateOf(x).reps || 0) === 0; }).length,
      learn: ST.items.filter(function (x) { var t = stateOf(x).type; return t === 1 || t === 3; }).length,
      review: ST.items.filter(function (x) { return stateOf(x).type === 2; }).length
    };
    var h = '<div class="card cd-head">'
      + '<div class="cd-htop"><div><b>' + esc(bank.title || bank.id) + '</b>'
      + '<span>共 ' + (bank.questions || []).length + ' 题 · ' + ST.items.length + ' 个考点</span></div>'
      + (function () {
          var done = doneToday();
          var dueLeft = (ST.items || []).filter(function (it) { return isReady(stateOf(it)); }).length;
          var goal = done + dueLeft;
          var frac = goal ? Math.min(1, done / goal) : 0;
          var off = (2 * Math.PI * 15.5 * (1 - frac)).toFixed(1);
          return '<div class="cd-hnum cd-hnum-ring">'
            + '<svg class="cd-ring" viewBox="0 0 36 36" aria-hidden="true">'
            + '<circle class="cd-ring-bg" cx="18" cy="18" r="15.5"></circle>'
            + '<circle class="cd-ring-fg" cx="18" cy="18" r="15.5" style="stroke-dasharray:97.4;stroke-dashoffset:' + off + '"></circle>'
            + '</svg>'
            + '<div class="cd-hnt"><b>' + done + '</b><i>今日</i></div></div>';
        })()
      + '</div>'
      + '<div class="cd-progline"><i style="width:' + (p.total ? Math.round(p.done * 100 / p.total) : 0) + '%"></i></div>'
      + '<div class="cd-note">今天到期 <b>' + cnt.due + '</b> 张（其中新卡 ' + cnt.newc + ' 张）· 点任一行开始背；四档评分按 Anki 的间隔走。</div>'
      + '<div class="cd-srch"><input id="cdQ" class="cd-q" placeholder="搜考点 / 题干关键字…" value="' + esc(ST.q || '') + '">'
      + '<button class="cd-shuf' + (ST.shuf ? ' on' : '') + '" data-act="shuf" title="打乱顺序（背第二遍时用）">' + (ST.shuf ? '🎲 打乱中' : '🎲 打乱') + '</button></div>'
      + '<div class="cd-flt"><i class="cd-ind" id="cdInd"></i>'
      + '<button class="cd-fbtn' + (ST.filter === 'due' ? ' on' : '') + '" data-act="flt" data-f="due">今天要背 ' + cnt.due + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'all' ? ' on' : '') + '" data-act="flt" data-f="all">全部 ' + cnt.all + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'newc' ? ' on' : '') + '" data-act="flt" data-f="newc">新卡 ' + cnt.newc + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'learn' ? ' on' : '') + '" data-act="flt" data-f="learn">学习中 ' + cnt.learn + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'review' ? ' on' : '') + '" data-act="flt" data-f="review">复习中 ' + cnt.review + '</button>'
      + '</div>'
      + '<div class="cd-tools"><button class="cd-link" data-act="kpall">🧩 整库挂到知识点（' + ST.items.length + '）</button><button class="cd-link" data-act="regenall">🔄 整库重新总结</button></div>'
      + '<div class="cd-kphint">挂好的考点会进「知识点管理」（首页底部入口），可再分层、加编码和标签。</div>'
      + '</div>';

    groups.forEach(function (g) {
      h += '<div class="cd-grp"><div class="cd-ghead"><span>' + esc(g.subj) + '</span><i>' + g.list.length + ' 个考点</i></div>';
      g.list.forEach(function (it, i) {
        var idx = list.indexOf(it);
        var v = markOf(it);
        var mark = v === 1 ? '<u class="cd-ok">已会</u>' : (v === -1 ? '<u class="cd-no">还不会</u>' : '');
        var n = idx + 1;
        var noGen = !(genMap()[it.key] && genMap()[it.key].t);
        h += '<button class="cd-row' + (noGen ? ' cd-row-todo' : '') + '" data-act="card" data-i="' + idx + '">'
          + '<em>' + n + '</em>'
          + '<div><b>' + esc(it.tag) + '</b><span>' + (it.qs.length > 1 ? it.qs.length + ' 道题都考这里 · ' : '')
          + '第 ' + it.qs.slice(0, 6).join('、') + ' 题 · ' + dueText(stateOf(it)) + '</span></div>'
          + mark
          + (noGen ? '<u class="cd-todo">待写</u>' : '')
          + '</button>';
      });
      h += '</div>';
    });

    if (!ST.items.length) {
      h += '<div class="card"><div class="empty">这个题库还没有题目。</div></div>';
    } else if (!list.length) {
      h += '<div class="card"><div class="empty">这个筛选下没有卡片。点「全部」看看。</div></div>';
    }
    h += '<div class="cd-gap"></div>';
    var miss = missGen(ST.items);
    if (miss.length || GEN.on) {
      h += '<div class="cd-bar cd-bar-gen">'
        + (GEN.on ? '<div class="cd-gtop"><span>' + (GEN.force ? '正在整库重写' : '正在写结论') + '</span><i id="cdGnum">' + GEN.done + ' / ' + GEN.total + '</i></div>'
          + '<div class="cd-gprog"><i id="cdGenProg" style="width:' + (GEN.total ? Math.round(GEN.done * 100 / GEN.total) : 0) + '%"></i></div>' : '')
        + '<div class="cd-grow">'
        + (GEN.on
          ? '<button class="btn primary cd-genall on" id="cdGenAll" data-act="genall">■ 停止（' + GEN.done + '/' + GEN.total + '）</button>'
          : '<button class="btn primary cd-genall" id="cdGenAll" data-act="genall">✨ 一键写完结论 · 还差 ' + miss.length + ' 张</button>')
        + '<button class="btn" data-act="cards"' + (GEN.on || miss.length ? ' disabled title="先把结论写完"' : '') + '>🃏 开始背诵</button>'
        + '</div></div>';
    } else {
      h += '<div class="cd-bar">'
        + '<button class="btn primary" data-act="cards">🃏 开始背诵卡片</button>'
        + '<button class="btn" data-act="quiz" data-id="' + esc(bank.id) + '">开始刷题</button>'
        + '</div>';
    }

    $('#view').innerHTML = h;
    requestAnimationFrame(function () { try { moveFltInd(); } catch (e0) {} });
  }

  /* ---------- 卡片模式 ---------- */
  /* ---------- 关键词 → 站内三处搜索（题目 / 讲义 / 知识点笔记） ---------- */
  var KWM = { kw: '' };
  function kwMenuEl() {
    var m = document.getElementById('ccKwMenu');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'ccKwMenu';
    m.innerHTML = '<div class="cc-kwm-t" id="ccKwTitle"></div>'
      + '<button data-kwdo="q">🔍 搜题目（题干 / 选项 / 解析）</button>'
      + '<button data-kwdo="lec">📖 搜讲义知识点</button>'
      + '<button data-kwdo="note">📝 搜知识点笔记</button>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-kwdo]');
      if (!b) return;
      var kind = b.getAttribute('data-kwdo'), kw = KWM.kw;
      kwMenuHide();
      try { sessionStorage.setItem(BACK_KEY, JSON.stringify({ bankId: ST.bankId, i: ST.i, f: ST.filter, ts: Date.now() })); } catch (eb) {}
      if (kind === 'q') {
        try { window.__qbSearchPrefill = kw; } catch (e0) {}
        closeCard();
        location.hash = '#/search';
      } else if (kind === 'lec') {
        closeCard();
        setTimeout(function () {
          try {
            if (!window.LECTURE) return toast('讲义模块没加载', 1600);
            window.LECTURE.open();
            setTimeout(function () { try { window.LECTURE.find(kw); } catch (e1) {} }, 380);
          } catch (e2) {}
        }, 80);
      } else if (kind === 'note') {
        closeCard();
        location.hash = '#/notes';
        setTimeout(function () {
          try { if (window.LECNOTES && LECNOTES.search) LECNOTES.search(kw); } catch (e3) {}
        }, 240);
      }
    });
    return m;
  }
  function kwMenuShow(btn, kw) {
    var m = kwMenuEl();
    KWM.kw = kw || '';
    var t = document.getElementById('ccKwTitle');
    if (t) t.textContent = '「' + (kw || '') + '」在站内搜：';
    m.classList.add('on');
    var r = btn.getBoundingClientRect();
    var w = m.offsetWidth || 214, h = m.offsetHeight || 150;
    var left = Math.min(Math.max(8, r.left), (window.innerWidth || 360) - w - 8);
    var top = r.bottom + 6;
    if (top + h > (window.innerHeight || 640) - 8) top = Math.max(8, r.top - h - 6);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  }
  function kwMenuHide() { var m = document.getElementById('ccKwMenu'); if (m) m.classList.remove('on'); }
  document.addEventListener('pointerdown', function (e) {
    var m = document.getElementById('ccKwMenu');
    if (!m || !m.classList.contains('on')) return;
    if (e.target.closest('#ccKwMenu') || e.target.closest('[data-act="kw"]')) return;
    kwMenuHide();
  }, true);

  function ensureMask() {
    if ($('#cdMask')) return;
    var d = document.createElement('div');
    d.id = 'cdMask';
    d.className = 'cd-mask';
    d.innerHTML = '<div class="cd-top">'
      + '<button class="cd-back" data-act="close">‹ 返回</button>'
      + '<span class="cd-nav"><button class="cd-step" data-act="prev" title="上一张">‹</button>'
      + '<b id="cdCnt">1 / 1</b>'
      + '<button class="cd-step" data-act="next" title="下一张">›</button></span>'
      + '<button class="cd-sw' + (MASK_ON() ? ' on' : '') + '" data-act="mask" role="switch" aria-checked="' + (MASK_ON() ? 'true' : 'false') + '" title="遮住橙色重点字，先自己回想">'
      + '<span class="cd-sw-k"><svg viewBox="0 0 14 14" aria-hidden="true">'
      + '<path class="cd-sw-x" d="M4 4l6 6M10 4l-6 6"/><path class="cd-sw-v" d="M3 7.2l2.6 2.6L11 4.4"/>'
      + '</svg></span><em>遮挡重点</em></button>'
      + '<button class="cd-qbtn" data-act="quizone">看原题</button>'
      + '</div>'
      + '<div class="cd-stage" id="cdStage"></div>'
      + '<div class="cd-loadline" id="cdLoad"><i></i></div>'
      + '<div class="cd-acts cd-acts4">'
      + '<button class="cd-no" data-act="rate" data-r="1"><b>还不会</b><i>1 · 1 分钟后</i></button>'
      + '<button class="cd-hard" data-act="rate" data-r="2"><b>有点难</b><i>2</i></button>'
      + '<button class="cd-yes" data-act="rate" data-r="3"><b>会了</b><i>3 · 看熟练度</i></button>'
      + '<button class="cd-easy" data-act="rate" data-r="4"><b>简单</b><i>4 · 隔更久</i></button>'
      + '</div>'
      + '<div class="cd-prog"><i id="cdProg"></i></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'close') return closeCard();
      if (a === 'quizone') return quizOne();
      if (a === 'mask') {
        var on = !MASK_ON();
        var swb = b;
        swb.classList.toggle('on', on);
        swb.classList.add('is-stretch');
        setTimeout(function () { swb.classList.remove('is-stretch'); }, 180);
        swb.setAttribute('aria-checked', on ? 'true' : 'false');
        MASK_SET(on);
        REVEALED = false;
        paintCard();
        toast(on ? '已遮住橙色重点：先自己回想，点一下重点字就揭开' : '已显示重点', 1600);
        return;
      }
      if (a === 'reveal') {
        REVEALED = true;
        paintCard();
        return;
      }
      if (a === 'prev') return step(-1);
      if (a === 'next') return step(1);
      if (a === 'yes') return mark(1);
      if (a === 'no') return mark(-1);
      if (a === 'rate') return rate(Number(b.getAttribute('data-r')) || 3);
      if (a === 'ai') return genOne();
      if (a === 'kp') {
        var itk = filterItems()[ST.i];
        if (!itk) return;
        if (!window.KP || !window.KP.attachCard) { toast('知识点模块没加载，刷新一次再试', 2000); return; }
        var nm1 = cardName(itk);
        toast('正在挂到知识点…', 1000);
        window.KP.attachCard({ key: itk.key, name: nm1, subj: ST.bankTitle || '' }).then(function (node) {
          toast('已挂到「' + node.name + '」', 1800);
          paintCard();
        }).catch(function (e2) { toast('挂不上：' + (e2 && e2.message || e2), 2400); });
        return;
      }
      if (a === 'kw') return kwMenuShow(b, b.getAttribute('data-kw') || b.textContent || '');
      if (a === 'stem') {
        var s = $('#cdStem');
        if (s) {
          s.classList.toggle('on');
          var on = s.classList.contains('on');
          b.textContent = on ? '收起题目 ▴' : '看这道题 ▾';
        }
        return;
      }
    });
    /* 左右滑动 */
    var sx = 0, sy = 0, moved = false;
    var stage = $('#cdStage');
    stage.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false;
    }, { passive: true });
    stage.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 12 && Math.abs(t.clientX - sx) > Math.abs(t.clientY - sy)) moved = true;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (!moved || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
      step(dx < 0 ? 1 : -1);
    });
  }

  /* 结论可能是「一句话 + · 要点」多行：第一行大字，其余做成要点列表 */
  function oneParts(t) {
    var lines = String(t || '').split(/\n+/).map(function (x) { return x.replace(/^\s*[·•\-*]\s*/, '').trim(); })
      .filter(function (x) { return x; });
    if (!lines.length) return { head: '', pts: [] };
    return { head: lines[0], pts: lines.slice(1, 6) };
  }
  function oneHtml(t, kws, hide) {
    var p = oneParts(t);
    var h = '<div class="cc-one">' + hilite(p.head, kws, hide) + '</div>';
    if (p.pts.length) {
      h += '<ul class="cc-pts">' + p.pts.map(function (x, i) { return '<li style="--i:' + i + '">' + hilite(x, kws, hide) + '</li>'; }).join('') + '</ul>';
    }
    return h;
  }
  var MASK_KEY = 'qbank.cards.mask.v1';
  var REVEALED = false;   // 这一张是否已经点开看答案（不落盘，换卡重置）
  function MASK_ON() { try { return localStorage.getItem(MASK_KEY) === '1'; } catch (e) { return false; } }
  function MASK_SET(v) { try { localStorage.setItem(MASK_KEY, v ? '1' : '0'); } catch (e) {} }

  /* 挂到知识点时用考点名（卡片标题），别用 AI 写的正文——正文第一行经常是「重写」「结论」这种词 */
  /* 筛选条：滑动指示条跟着选中项走 */
  function moveFltInd() {
    var box = document.querySelector('.cd-flt');
    var ind = document.getElementById('cdInd');
    if (!box || !ind) return;
    var on = box.querySelector('.cd-fbtn.on');
    if (!on) { ind.style.opacity = '0'; return; }
    var r = on.getBoundingClientRect(), b = box.getBoundingClientRect();
    ind.style.opacity = '1';
    ind.style.width = Math.round(r.width) + 'px';
    ind.style.transform = 'translateX(' + Math.round(r.left - b.left) + 'px)';
  }

  function cardName(it) {
    return String((it && (it.tag || it.name)) || '').trim() || ('第 ' + ((it && it.qno) || '?') + ' 题');
  }

  function paintCard() {
    ensureMask();
    var list = filterItems();
    if (!list.length) {
      closeCard();
      toast('这个筛选下没有卡片了', 1600);
      return;
    }
    if (ST.i >= list.length) ST.i = list.length - 1;
    if (ST.i < 0) ST.i = 0;
    var it = list[ST.i];
    var one = oneOf(it);
    var kws = kwList(it);
    var hideKw = MASK_ON() && !REVEALED;
    var v = markOf(it);
    var q = it.q || {};
    var ans = (q.answer || []).join('');
    var explain = tidyOne(q.explain || q.exp || '');
    var html = '<div class="cc-wrap"><div class="cc-card' + (v === 1 ? ' ok' : (v === -1 ? ' no' : '')) + '">'
      + '<div class="cc-tag">' + esc(it.subj) + '</div>'
      + '<div class="cc-title">' + esc(it.tag) + '</div>'
      + '<div class="cc-key">'
      + oneHtml(one.t, kws, hideKw)
      + '</div>'
      + (hideKw ? '<div class="cc-reveal-hint">橙色重点字已遮住 · 点一下看答案</div>' : '')
      + (kws.length ? '<div class="cc-kws">' + kws.map(function (w) {
        return '<button class="cc-kw' + (hideKw ? ' hid' : '') + '" data-act="' + (hideKw ? 'reveal' : 'kw') + '" data-kw="' + esc(w) + '">' + esc(w) + '</button>';
      }).join('') + '</div>' : '')
      + '<button class="cc-stembtn" data-act="stem">看这道题 ▾</button>'
      + '<div class="cc-stem" id="cdStem"><b data-act="quizone" title="点这里去做这道题">' + esc(q.stem || '') + '</b>'
      + (explain ? '<p>' + hilite(explain, kws) + '</p>' : '')
      + '<u>答案：' + esc(ans || '—') + '</u>'
      + '<button class="cc-goq" data-act="quizone">去做这道题 →</button></div>'
      + '<div class="cc-foot">出自 · ' + esc(ST.bankTitle || '') + ' 第 ' + (it.qno || '?') + ' 题'
      + ' · <span class="cc-srs">背过 ' + ((stateOf(it).reps || 0)) + ' 次 · 下次 ' + dueText(stateOf(it)) + '</span></div>'
      + '<div class="cc-kpline">'
      + (function () {
          var e = (window.KP && KP.cardEntry) ? KP.cardEntry(it.key) : null;
          return e
            ? '<u class="cc-kptag">🧩 已挂：' + esc(e.name || '知识点') + '</u><button class="cc-kpbtn ghost" data-act="kp">换一个</button>'
            : '<button class="cc-kpbtn" data-act="kp">🧩 挂到知识点</button>';
        })()
      + '</div>'
      + '</div>'
      + '<button class="cc-ai" data-act="ai">✨ ' + (one.ai ? '重新生成本卡' : '让 AI 写这张卡') + '</button></div>';
    $('#cdStage').innerHTML = html;
    try { kwMenuHide(); } catch (e0) {}
    $('#cdCnt').textContent = (ST.i + 1) + ' / ' + list.length;
    $('#cdProg').style.width = Math.round((ST.i + 1) * 100 / list.length) + '%';
    $('#cdMask').classList.add('on');
    savePos(ST.i);
  }

  function step(d) {
    var list = filterItems();
    if (!list.length) return;
    ST.i = (ST.i + d + list.length) % list.length;
    paintCard();
  }
  var PARTY_KEY = 'qbank.cards.party.v1';

  /* 今天点过评分的张数（用于「今日进度环」） */
  function doneToday() {
    var map = schedMap(), today = dayNo(), n = 0;
    Object.keys(map).forEach(function (k) {
      var st = map[k];
      if (st && st.ts && dayNo(st.ts) === today) n++;
    });
    return n;
  }

  function bankPartyMap() {
    try { return JSON.parse(localStorage.getItem(PARTY_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  /* 今天第一次把这个题库的到期卡清空时，来一次轻量庆祝 */
  function maybeParty() {
    var left = (ST.items || []).filter(function (it) { return isReady(stateOf(it)); }).length;
    if (left) return;
    var m = bankPartyMap();
    if (m[ST.bankId] === dayNo()) return;
    m[ST.bankId] = dayNo();
    try { localStorage.setItem(PARTY_KEY, JSON.stringify(m)); } catch (e) {}
    party();
  }

  function party() {
    var n = doneToday();
    var tried = 0, wrong = 0;
    var map = schedMap();
    (ST.items || []).forEach(function (it) {
      var st = map[it.key];
      if (st && st.ts && dayNo(st.ts) === dayNo()) { tried++; }
    });
    var box = document.createElement('div');
    box.className = 'cd-party';
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = '<div class="cd-party-card">'
      + '<div class="cd-party-ico">🎉</div>'
      + '<b>今天这个题库背完了</b>'
      + '<span>' + n + ' 张 · 已过一遍，明天再来</span>'
      + '<div class="cd-confetti" aria-hidden="true">'
      + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(function (i) {
          return '<i style="--i:' + i + '"></i>';
        }).join('')
      + '</div></div>';
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add('on'); });
    setTimeout(function () {
      box.classList.remove('on');
      setTimeout(function () { box.remove(); }, 320);
    }, 2400);
  }

  function rate(r) {
    var list = filterItems();
    var it = list[ST.i];
    if (!it) return;
    var st = stateOf(it);
    var nowSec = Math.floor(Date.now() / 1000);
    var today = dayNo();
    var crt = crtDay();
    var next = null;
    if (window.ANKI_SCHED && window.ANKI_SCHED.answer) {
      try {
        next = window.ANKI_SCHED.answer(st, r, nowSec, window.ANKI_SCHED.DEFAULT_DECK,
          { today: today, crtDay: crt, preLapseIvl: st.ivl || 0 });
      } catch (e) { toast('调度出错：' + (e && e.message), 2400); return; }
      next.ts = Date.now();
      var map = schedMap();
      map[it.key] = next;
      writeLS(SCHED_KEY, map);
    }
    var m = markers();
    m[it.key] = r >= 3 ? 1 : -1;
    writeLS(MARK_KEY, m);
    var after = filterItems();
    if (!after.length) { closeCard(); toast('都过完了 🎉', 1800); return; }
    ST.i = ST.filter === 'all' ? (ST.i + 1) % after.length : Math.min(ST.i, after.length - 1);
    try { renderPreview(); } catch (e0) {}   /* 背后的列表/计数跟着更新（到期数、学习中、复习中） */
    paintCard();
    toast('记下：' + RATE_NAME[r] + ' · 下次 ' + dueText(next || st), 1300);
    try { maybeParty(); } catch (e1) {}
  }

  function mark(v) {
    var list = filterItems();
    var it = list[ST.i];
    if (!it) return;
    var m = markers();
    m[it.key] = v;
    writeLS(MARK_KEY, m);
    var after = filterItems();
    if (!after.length) { closeCard(); toast('都过完了 🎉', 1800); return; }
    if (v === 1) {
      /* 会了：自动翻下一张（筛选里被移除时，同一位置就是下一张） */
      ST.i = ST.filter === 'all' ? (ST.i + 1) % after.length : Math.min(ST.i, after.length - 1);
      paintCard();
      toast('记下：会了 · 下一张', 800);
    } else {
      ST.i = Math.min(ST.i, after.length - 1);
      paintCard();
      toast('记下：还不会 · 这张会留着', 1000);
    }
  }
  function closeCard() {
    var d = $('#cdMask');
    if (d) d.classList.remove('on');
    ST.card = false;
    /* 关卡片时把背后的列表重画一次：到期 / 学习中 / 复习中 的数字跟着评分开 */
    try { if (location.hash.indexOf('#/cards/') === 0) renderPreview(); } catch (e) {}
  }
  function quizOne() {
    var list = filterItems();
    var it = list[ST.i];
    if (!it) return;
    try { (0, eval)("QZ.cur = " + JSON.stringify(String(it.q.id)) + "; QZ.subject = '';"); } catch (e) {}
    try {
      sessionStorage.setItem(BACK_KEY, JSON.stringify({ bankId: ST.bankId, i: ST.i, f: ST.filter, ts: Date.now() }));
    } catch (e) {}
    closeCard();
    location.hash = '#/bank/' + encodeURIComponent(ST.bankId);
    backChip();
  }

  /* 回到卡片：从原题页面回卡片时，落在刚才那张 */
  var BACK_KEY = 'qbank.cards.back';
  function backChip() {
    if (document.getElementById('cdBack')) return;
    var b = document.createElement('button');
    b.id = 'cdBack';
    b.className = 'cd-backchip';
    b.innerHTML = '‹ 回到卡片';
    b.onclick = function () {
      var st0 = null;
      try { st0 = JSON.parse(sessionStorage.getItem(BACK_KEY) || 'null'); } catch (e) {}
      location.hash = '#/cards/' + encodeURIComponent((st0 && st0.bankId) || ST.bankId);
    };
    document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.classList.add('on'); }, 60);
  }
  function dropChip() {
    var b = document.getElementById('cdBack');
    if (b) b.remove();
  }
  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('#/cards') === 0) dropChip();
    else if (location.hash.indexOf('#/bank/') === 0) {
      var b0 = null;
      try { b0 = JSON.parse(sessionStorage.getItem(BACK_KEY) || 'null'); } catch (e) {}
      if (b0 && Date.now() - (b0.ts || 0) < 1800000) setTimeout(backChip, 60);
    }
  }, false);

  function genOne() {
    var list = filterItems();
    var it = list[ST.i];
    if (!it) return;
    if (typeof window.aiChat !== 'function') { toast('AI 模块没加载', 1600); return; }
    var b = $('[data-act="ai"]');
    if (b) { b.disabled = true; b.innerHTML = '<span class="cc-spin"></span> 正在写这张卡…'; }
    var mk = $('#cdMask'); if (mk) mk.classList.add('busy');
    var fin = function () { var m2 = $('#cdMask'); if (m2) m2.classList.remove('busy'); };
    askOne(it).then(function (res) {
      var g = genMap();
      g[it.key] = res;
      writeLS(GEN_KEY, g);
      fin();
      paintCard();
      toast(res.auto ? 'AI 没回正文，先用解析里的句子顶上；可以再点一次重写' : '这张卡写好了，下次这个考点直接用', 2200);
    }).catch(function (e) {
      fin();
      if (b) { b.disabled = false; b.textContent = '✨ 再试一次'; }
      toast('没写成：' + ((e && e.message) || e), 2400, 'bad');
    });
  }

  /* ---------- 事件 ---------- */
  function onViewClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.getAttribute('data-act');
    if (a === 'open') {
      ST.bankId = b.getAttribute('data-id');
      var bk = bankOf(ST.bankId);
      ST.bankTitle = bk ? (bk.title || bk.id) : '';
      ST.items = bk ? itemsOf(bk) : [];
      ST.i = 0;
      location.hash = '#/cards/' + encodeURIComponent(ST.bankId);
      return;
    }
    if (a === 'quiz') {
      var id = b.getAttribute('data-id');
      location.hash = '#/bank/' + encodeURIComponent(id);
      return;
    }
    if (a === 'card') {
      ST.i = parseInt(b.getAttribute('data-i'), 10) || 0;
      paintCard();
      return;
    }
    if (a === 'genall') { genAll(false); return; }
    if (a === 'regenall') {
      if (!confirm('整个题库重新总结？会覆盖现在这 ' + ST.items.length + ' 张的结论。')) return;
      genAll(true);
      return;
    }
    if (a === 'kpall') {
        var allItems = filterItems();
        var seen = {}, todo = [];
        allItems.forEach(function (x) {
          var nm = cardName(x);
          if (!nm || seen[x.key]) return;
          seen[x.key] = 1;
          todo.push({ key: x.key, name: nm, subj: ST.bankTitle || '' });
        });
        if (!todo.length) { toast('这个题库还没有考点', 1600); return; }
        if (!window.KP || !window.KP.attachCard) { toast('知识点模块没加载，刷新一次再试', 2000); return; }
        toast('正在挂 ' + todo.length + ' 个考点到知识点…', 1500);
        var okN = 0, badN = 0;
        todo.reduce(function (p, x) {
          return p.then(function () {
            return window.KP.attachCard(x).then(function () { okN++; }).catch(function () { badN++; });
          });
        }, Promise.resolve()).then(function () {
          toast('已挂 ' + okN + ' 个知识点' + (badN ? ('，失败 ' + badN + ' 个') : ''), 2600);
        });
        return;
      }
    if (a === 'cards') {
      var miss2 = missGen(ST.items);
      if (miss2.length) { toast('还有 ' + miss2.length + ' 张没写结论，先点「一键写完结论」', 2400, 'bad'); return; }
      ST.i = 0;
      paintCard();
      return;
    }
    if (a === 'flt') {
      ST.filter = b.getAttribute('data-f') || 'all';
      ST.i = 0;
      renderPreview();
      return;
    }
    if (a === 'shuf') {
      ST.shuf = !ST.shuf;
      ST.i = 0;
      renderPreview();
      toast(ST.shuf ? '已打乱顺序，背第二遍用' : '恢复按题号顺序', 1400);
      return;
    }
  }

  function keyHandler(e) {
    var d = $('#cdMask');
    if (!d || !d.classList.contains('on')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeCard(); }
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  }

  function render(bankId) {
    var bk0 = null;
    /* 从「看原题」回来：恢复刚才那张卡 */
    if (bankId) {
      var st0 = null;
      try { st0 = JSON.parse(sessionStorage.getItem(BACK_KEY) || 'null'); } catch (e) {}
      if (st0 && st0.bankId === bankId && Date.now() - (st0.ts || 0) < 1800000) {
        try { sessionStorage.removeItem(BACK_KEY); } catch (e) {}
        var f0 = st0.f || 'all';
        setTimeout(function () { openCard(bankId, st0.i || 0, f0); }, 80);
      }
    }
    ST.card = false;
    if (bankId) {
      ST.bankId = bankId;
      var bk = bankOf(bankId);
      if (!bk) {
        /* 首屏时本地题库可能还没合并进来：等一会儿再找，别立刻退回题库列表 */
        var tries = 0;
        var timer = setInterval(function () {
          var b2 = bankOf(bankId);
          if (b2) {
            clearInterval(timer);
            ST.bankTitle = b2.title || b2.id;
            renderPreview();
          } else if (++tries > 12) {
            clearInterval(timer);
            if (location.hash.indexOf('/cards/') < 0) return;
            location.hash = '#/cards';
          }
        }, 150);
        return;
      }
      ST.bankTitle = bk.title || bk.id;
      renderPreview();
    } else {
      ST.bankId = null;
      renderBankList();
    }
    var v = $('#view');
    if (v && !v.__cdBound) {
      v.__cdBound = 1;
      v.addEventListener('click', onViewClick);
      v.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'cdQ') {
          ST.q = e.target.value || '';
          var caret = e.target.selectionStart;
          renderPreview();
          var q = $('#cdQ');
          if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (er) {} }
        }
      });
    }
    if (!window.__cdKeyBound) { document.addEventListener('keydown', keyHandler, true); window.__cdKeyBound = 1; }
  }

  function openCard(bankId, i, f) {
    ST.bankId = bankId;
    var bk = bankOf(bankId);
    ST.bankTitle = bk ? (bk.title || bk.id) : '';
    ST.items = bk ? itemsOf(bk) : [];
    ST.filter = f || 'all';
    var pv = posMap()[bankId];
    ST.i = (i == null && pv && typeof pv.i === 'number') ? pv.i : (i || 0);
    ST.card = true;
    paintCard();
  }
  try {
    if (location.hash.indexOf('#/bank/') === 0) {
      var b1 = JSON.parse(sessionStorage.getItem(BACK_KEY) || 'null');
      if (b1 && Date.now() - (b1.ts || 0) < 1800000) setTimeout(backChip, 300);
    }
  } catch (e0) {}
  window.CARDS = { render: render, itemsOf: itemsOf, groupsOf: groupsOf, open: openCard };
})();
