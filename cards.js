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

  function filterItems() {
    var m = markers();
    var list = ST.items;
    if (ST.filter === 'todo') list = list.filter(function (it) { return m[it.key] !== 1; });
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
      + '<div class="cd-htop"><div><b>🧠 考点卡</b>'
      + '<span>把题库里的题按考点分组，先用列表看一遍考什么，再逐张背诵</span></div>'
      + '<div class="cd-hnum">' + bs.length + '<i>个题库</i></div></div>'
      + '<div class="cd-note">考点来自每道题已有的标签（题库自带 / AI 打的都算）。没标签的题会按「共用题干」分组，或者用题干当这张卡的标题。</div>'
      + '</div>';
    if (!bs.length) {
      h += '<div class="card"><div class="empty">还没有题库。先回首页导入一份。</div></div>';
      $('#view').innerHTML = h;
      return;
    }
    h += '<div class="cd-list">';
    bs.forEach(function (b) {
      var items = itemsOf(b);
      var p = progressOf(items);
      var subjN = {};
      items.forEach(function (it) { subjN[it.subj] = (subjN[it.subj] || 0) + 1; });
      var chips = Object.keys(subjN).map(function (s) { return '<span class="cd-chip">' + esc(s) + ' ' + subjN[s] + '</span>'; }).join('');
      h += '<div class="card cd-bank">'
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
      no: ST.items.filter(function (x) { return mAll[x.key] === -1; }).length
    };
    var h = '<div class="card cd-head">'
      + '<div class="cd-htop"><div><b>' + esc(bank.title || bank.id) + '</b>'
      + '<span>共 ' + (bank.questions || []).length + ' 题 · ' + ST.items.length + ' 个考点</span></div>'
      + '<div class="cd-hnum">' + p.done + '/' + p.total + '<i>已背</i></div></div>'
      + '<div class="cd-progline"><i style="width:' + (p.total ? Math.round(p.done * 100 / p.total) : 0) + '%"></i></div>'
      + '<div class="cd-note">点任一行从那个考点开始背；底部「开始背诵」从头来（结论写完才可用）。</div>'
      + '<div class="cd-srch"><input id="cdQ" class="cd-q" placeholder="搜考点 / 题干关键字…" value="' + esc(ST.q || '') + '">'
      + '<button class="cd-shuf' + (ST.shuf ? ' on' : '') + '" data-act="shuf" title="打乱顺序（背第二遍时用）">' + (ST.shuf ? '🎲 打乱中' : '🎲 打乱') + '</button></div>'
      + '<div class="cd-flt">'
      + '<button class="cd-fbtn' + (ST.filter === 'all' ? ' on' : '') + '" data-act="flt" data-f="all">全部 ' + cnt.all + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'todo' ? ' on' : '') + '" data-act="flt" data-f="todo">没背过 ' + cnt.todo + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'yes' ? ' on' : '') + '" data-act="flt" data-f="yes">已会 ' + cnt.yes + '</button>'
      + '<button class="cd-fbtn' + (ST.filter === 'no' ? ' on' : '') + '" data-act="flt" data-f="no">还不会 ' + cnt.no + '</button>'
      + '</div>'
      + '<div class="cd-tools"><button class="cd-link" data-act="regenall">🔄 整库重新总结</button></div>'
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
          + '第 ' + it.qs.slice(0, 6).join('、') + ' 题</span></div>'
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
      + '<button class="cd-qbtn cd-maskbtn' + (MASK_ON() ? ' on' : '') + '" data-act="mask" title="把结论和要点遮住，先自己回想">遮挡重点</button>'
      + '<button class="cd-qbtn" data-act="quizone">看原题</button>'
      + '</div>'
      + '<div class="cd-stage" id="cdStage"></div>'
      + '<div class="cd-loadline" id="cdLoad"><i></i></div>'
      + '<div class="cd-acts">'
      + '<button class="cd-no" data-act="no">还不会</button>'
      + '<button class="cd-yes" data-act="yes">会了</button>'
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
      if (a === 'ai') return genOne();
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
      h += '<ul class="cc-pts">' + p.pts.map(function (x) { return '<li>' + hilite(x, kws, hide) + '</li>'; }).join('') + '</ul>';
    }
    return h;
  }
  var MASK_KEY = 'qbank.cards.mask.v1';
  var REVEALED = false;   // 这一张是否已经点开看答案（不落盘，换卡重置）
  function MASK_ON() { try { return localStorage.getItem(MASK_KEY) === '1'; } catch (e) { return false; } }
  function MASK_SET(v) { try { localStorage.setItem(MASK_KEY, v ? '1' : '0'); } catch (e) {} }

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
      + (v === 1 ? ' · 已标记会' : (v === -1 ? ' · 已标记还不会' : '')) + '</div>'
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
