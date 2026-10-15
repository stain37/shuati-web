/* ============================================================
   tags.js —— 知识点标签 + 薄弱点分析（方案五）
   数据：qbank.tags.v1 = { "题库id#题号": ["炎症","免疫应答"] }
         qbank.tagvocab.v1 = ["炎症", ...]（受控词表：AI 打标签只许从里面挑）
   标签独立存，不塞进题库对象里 —— 免得污染题库的导入 / 导出 / 编辑。
   写作走 mergeWrite + 墓碑（跟收藏一个套路），两个标签页同时改也不会互相覆盖。
   ============================================================ */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var T_KEY = 'qbank.tags.v1', V_KEY = 'qbank.tagvocab.v1';
  var MAX_PER_Q = 6;              /* 一道题最多挂几个标签 */
  var BATCH = 15;                 /* AI 分类：一批多少题 */
  var V_MIN = 15, V_MAX = 40;     /* 词表建议条数 */

  var TAGD = {};                  /* { key: [标签...] } */
  var TAGV = [];                  /* [标签...] */
  var JOB = { running: false, ctl: null, text: '', done: 0, total: 0, note: '', err: null, vocab: null };
  var VIEW = { bulk: false };      /* 词表「批量导入」粘贴框是否展开 */

  function rd() {
    try { TAGD = (typeof readLS === 'function') ? (readLS(T_KEY, {}) || {}) : (JSON.parse(localStorage.getItem(T_KEY)) || {}); } catch (e) { TAGD = {}; }
    try { TAGV = (typeof readLS === 'function') ? (readLS(V_KEY, []) || []) : (JSON.parse(localStorage.getItem(V_KEY)) || []); } catch (e) { TAGV = []; }
    if (!TAGV || !TAGV.length) TAGV = []; else TAGV = norm(TAGV);
  }
  function keyOf(bank, q) {
    if (typeof kOf === 'function') { try { return kOf(bank, q); } catch (e) {} }
    return bank.id + '#' + q.id;
  }
  function norm(list) {
    var out = [], seen = {};
    (list || []).forEach(function (t) {
      t = String(t == null ? '' : t).replace(/[\s,，、;；]+/g, ' ').trim().slice(0, 14);
      if (!t || seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }
  function save() {
    if (typeof mergeWrite === 'function') return mergeWrite(T_KEY, TAGD, 'tag');
    return writeLS(T_KEY, TAGD);
  }
  function saveVocab() {
    TAGV = norm(TAGV);
    try { writeLS(V_KEY, TAGV); } catch (e) {}
    return TAGV;
  }
  function tagsOf(k) { var v = TAGD[k]; return Array.isArray(v) ? v.slice() : []; }
  function setTags(k, list, quiet) {
    list = norm(list).slice(0, MAX_PER_Q);
    if (!list.length) {
      delete TAGD[k];
      if (typeof tombAdd === 'function') tombAdd('tag', k);   /* 记墓碑：别被另一个标签页的合并复活 */
    } else TAGD[k] = list;
    save();
    if (typeof bumpHay === 'function') { try { bumpHay(); } catch (e) {} }
    if (!quiet) drawTags();
    return list;
  }
  function addTags(k, list) { return setTags(k, tagsOf(k).concat(list)); }
  function delTag(k, t) { return setTags(k, tagsOf(k).filter(function (x) { return x !== t; })); }
  function rememberVocab(list) {
    var added = 0;
    norm(list).forEach(function (t) { if (TAGV.indexOf(t) < 0) { TAGV.push(t); added++; } });
    if (added) saveVocab();
    return added;
  }
  function dropTagEverywhere(t) {
    var n = 0;
    Object.keys(TAGD).forEach(function (k) {
      if (tagsOf(k).indexOf(t) >= 0) { setTags(k, tagsOf(k).filter(function (x) { return x !== t; }), true); n++; }
    });
    TAGV = TAGV.filter(function (x) { return x !== t; });
    saveVocab();
    return n;
  }
  function dropTagsOfBank(bankId) {
    var pre = bankId + '#', n = 0;
    Object.keys(TAGD).forEach(function (k) { if (k.indexOf(pre) === 0) { setTags(k, [], true); n++; } });
    TAGS_STATS_CACHE = null;
    return n;
  }

  /* ---------- 统计：按考点 ---------- */
  var TAGS_STATS_CACHE = null;
  function tagStats() {
    var banks = [];
    try { banks = (typeof baseBanks === 'function') ? baseBanks() : []; } catch (e) { banks = []; }
    var map = {};
    var tagged = 0, total = 0;
    banks.forEach(function (b) {
      (b.questions || []).forEach(function (q) {
        total++;
        var k = keyOf(b, q);
        var ts = tagsOf(k);
        if (!ts.length) return;
        tagged++;
        var a = (typeof ANS !== 'undefined' && ANS) ? ANS[k] : null;
        var done = !!(a && !a.redo), ok = !!(done && a.ok), wr = a ? (a.wrong || 0) : 0;
        ts.forEach(function (t) {
          var r = map[t] = map[t] || { t: t, n: 0, done: 0, ok: 0, wrong: 0, keys: [] };
          r.n++; r.keys.push(k);
          if (done) { r.done++; if (ok) r.ok++; }
          r.wrong += wr;
        });
      });
    });
    var rows = Object.keys(map).map(function (t) {
      var r = map[t];
      r.acc = r.done ? Math.round(r.ok / r.done * 100) : 0;
      r.thin = r.done < 5;                     /* 样本不足 */
      return r;
    });
    /* 排法：能用的在前（样本够的先看），同组里正确率低的在上，再按错得多的 */
    rows.sort(function (a, b) {
      return (a.thin ? 1 : 0) - (b.thin ? 1 : 0) || a.acc - b.acc || b.wrong - a.wrong || b.n - a.n ||
        String(a.t).localeCompare(String(b.t), 'zh');
    });
    var out = { rows: rows, tagged: tagged, total: total, tags: rows.length };
    TAGS_STATS_CACHE = out;
    return out;
  }
  function weakestKeys(n) {
    var st = TAGS_STATS_CACHE || tagStats();
    var pick = st.rows.filter(function (r) { return !r.thin || !st.rows.some(function (x) { return !x.thin; }); }).slice(0, n || 3);
    var keys = [], seen = {};
    pick.forEach(function (r) { r.keys.forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } }); });
    return { keys: keys, tags: pick.map(function (r) { return r.t; }) };
  }

  /* ---------- 答题页那一行标签 ---------- */
  function rowHtml(k, q) {
    var ts = tagsOf(k);
    var chips = ts.map(function (t) {
      return '<button class="tagchip" data-tagdel="' + esc(t) + '" title="点一下去掉这个标签">' + esc(t) + '<i>×</i></button>';
    }).join('');
    var none = ts.length ? '' : '<span class="tag-none">还没打考点标签</span>';
    return '<div class="tagrow" data-tagk="' + esc(k) + '">'
      + '<span class="tag-lab">考点</span>' + chips + none
      + '<button class="tagadd" data-tagedit="1" title="加考点标签（可以手动打字，也可以从词表里挑）">＋ 标签</button>'
      + '</div>';
  }
  function editorHtml(k) {
    var cur = tagsOf(k);
    var sug = TAGV.filter(function (t) { return cur.indexOf(t) < 0; });
    return '<div class="tagedit" data-tageditbox="' + esc(k) + '">'
      + '<div class="tedit-top">给这道题挂考点标签<span class="small muted">（自己想补一个就回车或点「加」；整个题库的标签去<b>学习统计 → 按考点</b>，那儿能先把词表批量导入、再让 AI 读题自动贴）</span></div>'
      + '<div class="tedit-cur">' + (cur.length ? cur.map(function (t) {
        return '<button class="tagchip" data-tagdel="' + esc(t) + '">' + esc(t) + '<i>×</i></button>';
      }).join('') : '<span class="small muted">还没有标签</span>') + '</div>'
      + '<div class="tedit-in"><input class="inp tedit-input" placeholder="打一个考点，比如：炎症" list="tagVocabList" maxlength="14">'
      + '<button class="btn tiny primary" data-tagadd="1">加</button>'
      + '<button class="btn tiny" data-tagclose="1">收起</button></div>'
      + '<datalist id="tagVocabList">' + TAGV.map(function (t) { return '<option value="' + esc(t) + '"></option>'; }).join('') + '</datalist>'
      + (sug.length ? '<div class="tedit-sug">词表里还有：' + sug.slice(0, 24).map(function (t) {
        return '<button class="vocab-chip" data-tagadd="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + (sug.length > 24 ? '<span class="small muted">…共 ' + sug.length + ' 个（统计页能看全部）</span>' : '') + '</div>'
        : '<div class="tedit-sug small muted">词表还是空的：统计页有「让 AI 生成考点词表」，或者你直接打字也行（打过的会自动进词表）。</div>')
      + '</div>';
  }
  /* 就地重画：只动标签行/编辑框，不整页重画 —— 免得把正在生成的东西冲掉 */
  function drawTags() {
    var row = document.querySelector('.tagrow[data-tagk]');
    if (!row) return;
    var k = row.getAttribute('data-tagk');
    var box = row.querySelector('.tagedit');
    row.innerHTML = rowHtml(k).replace(/^<div class="tagrow"[^>]*>/, '').replace(/<\/div>$/, '');
    if (box) openEdit(k, true);
  }
  function openEdit(k, keep) {
    var row = document.querySelector('.tagrow[data-tagk="' + cssq(k) + '"]');
    if (!row) return;
    var old = row.querySelector('.tagedit');
    if (old && keep) return;
    if (old) old.remove();
    else row.insertAdjacentHTML('beforeend', editorHtml(k));
    var inp = row.querySelector('.tedit-input');
    if (inp) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
  }
  function closeEdit(k) {
    var row = document.querySelector('.tagrow[data-tagk="' + cssq(k) + '"]');
    if (!row) return;
    var b = row.querySelector('.tagedit');
    if (b) b.remove();
  }
  function cssq(s) { return String(s == null ? '' : s).replace(/["\\]/g, '\\$&'); }

  function bindRow(host, bank, q) {
    if (!host) return;
    var k = keyOf(bank, q);
    var row = host.querySelector('.tagrow[data-tagk="' + cssq(k) + '"]');
    if (!row) return;
    row.addEventListener('click', function (e) {
      var del = e.target.closest('[data-tagdel]');
      if (del) { delTag(k, del.getAttribute('data-tagdel')); return; }
      var add = e.target.closest('[data-tagadd]');
      if (add) {
        var v = add.getAttribute('data-tagadd');
        if (v && v !== '1') { addTags(k, [v]); rememberVocab([v]); return; }
        var inp = row.querySelector('.tedit-input');
        var t = inp ? inp.value : '';
        if (!t) { if (inp) inp.focus(); return; }
        addTags(k, [t]); rememberVocab([t]);
        if (inp) { inp.value = ''; inp.focus(); }
        return;
      }
      if (e.target.closest('[data-tagedit]')) { openEdit(k); return; }
      if (e.target.closest('[data-tagclose]')) { closeEdit(k); return; }
    });
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.classList.contains('tedit-input')) {
        e.preventDefault(); e.stopPropagation();
        var t = e.target.value;
        if (t) { addTags(k, [t]); rememberVocab([t]); e.target.value = ''; }
      } else if (e.key === 'Escape' && e.target && e.target.classList.contains('tedit-input')) {
        e.preventDefault(); e.stopPropagation(); closeEdit(k);
      }
    });
  }

  /* ---------- 统计页：按考点 ---------- */
  function statsHtml() {
    var st = tagStats();
    if (!st.rows.length) {
      return '<div class="card"><div class="note">还没有任何考点标签。'
        + '顺序是：① 先把你的考点词表导进来（下面「考点词表」那块，一行一个，也可以直接粘贴一整份）；'
        + '② 再让 AI 读每道题、从词表里挑标签贴上去（「让 AI 打标签」那块）。'
        + '<div class="small muted">没打标签的题：' + st.total + ' 道。标签只存本机，会跟导出备份一起走。</div></div>'
        + vocabBoxHtml() + aiBoxHtml();
    }
    var rows = st.rows.map(function (r) {
      return '<button class="srow srow-go tag-srow" data-tagopen="' + esc(r.t) + '" title="看这个考点下的题">'
        + '<span class="sname">' + esc(r.t) + '</span>'
        + '<span class="tag-meta">' + r.n + ' 题 · 已答 ' + r.done + '</span>'
        + '<span class="sbar"><i style="width:' + (r.done ? r.acc : 0) + '%"></i></span>'
        + '<span class="sval">' + (r.done ? r.acc + '%' : '—') + '</span>'
        + (r.wrong ? '<span class="mini-tag bad">错 ' + r.wrong + ' 次</span>' : '')
        + (r.thin ? '<span class="mini-tag">样本不足</span>' : '')
        + '<span class="chev">›</span></button>';
    }).join('');
    var weak = weakestKeys(3);
    return '<div class="card">'
      + '<div class="tools" style="margin-top:0">'
      + '<span class="mini-tag">共 ' + st.tags + ' 个考点</span>'
      + '<span class="mini-tag">已打标签的题 ' + st.tagged + '/' + st.total + '</span>'
      + '<span class="spacer-grow"></span>'
      + '<button class="btn tiny primary" data-act="tagweak"' + (weak.keys.length ? '' : ' disabled') + '>刷最弱的 3 个考点</button>'
      + '<button class="btn tiny" data-act="tagvocab">管理考点词表</button>'
      + '</div>'
      + '<div class="small muted" style="margin:6px 0 4px">按正确率排（样本够的在前；已答 &lt; 5 题标「样本不足」）。点一行看这个考点下的题。</div>'
      + rows
      + '<div class="tag-weak-line" id="tagWeakLine">' + (weak.tags.length
        ? '「刷最弱的 3 个考点」现在是：<b>' + esc(weak.tags.join('、')) + '</b>（共 ' + weak.keys.length + ' 题）'
        : '') + '</div>'
      + '</div>' + vocabBoxHtml() + aiBoxHtml();
  }
  function vocabBoxHtml() {
    var used = {};
    Object.keys(TAGD).forEach(function (k) { tagsOf(k).forEach(function (t) { used[t] = (used[t] || 0) + 1; }); });
    var rows = TAGV.map(function (t) {
      return '<button class="vocab-chip' + (used[t] ? ' on' : '') + '" data-vocabdel="' + esc(t) + '" title="点一下从词表里删掉（同时会摘掉题上的这个标签）">'
        + esc(t) + (used[t] ? ' <i>' + used[t] + '</i>' : '') + '</button>';
    }).join('');
    var bulk = VIEW.bulk ? ('<div class="card" style="margin:8px 0 0" id="tagBulkBox">'
      + '<div class="small muted" style="margin-bottom:6px">把你那份考点清单粘进来，<b>一行一个</b>：只写名字，或者「名字：一句说明」都行。'
      + '序号（1. ①）、项目符号（- • ·）、引号会自动去掉；和词表里重名的跳过。</div>'
      + '<textarea class="inp" id="tagVocabBulk" rows="8" placeholder="慢阻肺：持续气流受限、FEV1/FVC&lt;70%'
      + '\n心力衰竭\n3. 酸碱平衡：血气分析判断失代偿与代偿\n呼吸衰竭"></textarea>'
      + '<div class="tools" style="margin:8px 0 0"><button class="btn tiny primary" data-vocablistok="1">导入这些考点</button>'
      + '<button class="btn tiny" data-vocablistclose="1">取消</button>'
      + '<span class="spacer-grow"></span><span class="tl" id="tagVocabBulkState"></span></div></div>') : '';
    return '<div class="card" id="tagVocabCard"><h3 class="tag-h">考点词表 <span class="small muted">'
      + '"' + TAGV.length + '" 个 · AI 只从这里面挑标签，统计才不会散</span></h3>'
      + '<div class="tools" style="margin:6px 0"><input class="inp" id="tagVocabInp" placeholder="加一个考点，比如：免疫应答" maxlength="14">'
      + '<button class="btn tiny primary" data-vocabadd="1">加进词表</button>'
      + '<button class="btn tiny" data-vocablist="1">批量导入考点（粘贴一串）</button>'
      + '<button class="btn tiny" data-vocabai="1">让 AI 起一份</button>'
      + '<button class="btn tiny" data-vocabimport="1">从已打的标签补全</button></div>'
      + bulk
      + '<div class="vocab-box" id="tagVocabBox">' + (rows || '<span class="small muted">词表是空的。建议先把你的考点清单批量导入，再让 AI 按它贴标签。</span>') + '</div></div>';
  }
  function aiBoxHtml() {
    var banks = [];
    try { banks = (typeof baseBanks === 'function') ? baseBanks() : []; } catch (e) {}
    var total = 0, tagged = 0;
    banks.forEach(function (b) { (b.questions || []).forEach(function (q) { total++; if (tagsOf(keyOf(b, q)).length) tagged++; }); });
    var todo = total - tagged;
    return '<div class="card" id="tagAiCard"><h3 class="tag-h">让 AI 打标签 <span class="small muted">它读题，从你的词表里挑，不会自己造词</span></h3>'
      + '<div class="small muted" style="margin:4px 0 8px">没打标签的题：<b>' + todo + '</b> 道（共 ' + total + ' 道）。'
      + '一次给 AI 看 ' + BATCH + ' 道题，让它按上面那份词表（' + TAGV.length + ' 个考点）逐题挑；'
      + '一次几十题，一个几百题的库大概十几到几十次请求 —— 用本地 Ollama 不花钱，用云模型注意余额。中途可以停，已经打完的会留着。</div>'
      + '<div class="tools" style="margin:0">'
      + '<button class="btn tiny primary" id="tagGo"' + (todo && TAGV.length ? '' : ' disabled') + '>给没标签的题贴标签</button>'
      + '<button class="btn tiny" id="tagGenVocab">词表空着？让 AI 起一份</button>'
      + '<button class="btn tiny" id="tagStop" style="display:none">停止</button>'
      + '<span class="spacer-grow"></span><span class="tl" id="tagAiState"></span></div>'
      + '<div class="tag-aivocab" id="tagAiVocab"></div></div>';
  }
  function paintAI() {
    var s = document.getElementById('tagAiState');
    if (s) s.textContent = JOB.running ? (JOB.total ? '第 ' + JOB.done + '/' + JOB.total + ' 批…' : '正在生成词表…') : (JOB.note || '');
    var stop = document.getElementById('tagStop');
    if (stop) stop.style.display = JOB.running ? '' : 'none';
    var go = document.getElementById('tagGo');
    if (go) go.disabled = JOB.running || !TAGV.length;
    var box = document.getElementById('tagAiVocab');
    if (box && JOB.vocab && JOB.vocab.length) {
      box.innerHTML = '<div class="small" style="margin:8px 0 4px">AI 出的词表（点一下可以删；不满意的自己再加）：</div>'
        + '<div class="vocab-box">' + JOB.vocab.map(function (t) {
          return '<button class="vocab-chip on" data-newvocabdel="' + esc(t) + '">' + esc(t) + '</button>';
        }).join('') + '</div>'
        + '<div class="tools" style="margin:8px 0 0"><button class="btn tiny primary" data-newvocabsave="1">用这份词表（' + JOB.vocab.length + ' 个）</button>'
        + '<button class="btn tiny" data-newvocabdrop="1">不要</button></div>';
    }
  }
  function parseJSONArray(txt) {
    var t = String(txt || '');
    try { var v = JSON.parse(t); if (Array.isArray(v)) return v; } catch (e) {}
    var m = t.match(/\[[\s\S]*?\]/);
    if (m) { try { var v2 = JSON.parse(m[0]); if (Array.isArray(v2)) return v2; } catch (e) {} }
    /* 兜底：把「炎症」「免疫应答」这类引号里的词抠出来 */
    var out = [], re = /["“']([^"”'\n]{2,14})["”']/g, mm;
    while ((mm = re.exec(t))) out.push(mm[1]);
    return out.length ? out : null;
  }
  function parseJSONMap(txt) {
    var t = String(txt || '');
    try { var v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch (e) {}
    var m = t.match(/\{[\s\S]*\}/);
    if (m) { try { var v2 = JSON.parse(m[0]); if (v2 && typeof v2 === 'object') return v2; } catch (e) {} }
    return null;
  }
  function qLine(q, i) {
    var o = (q.options || []).map(function (x, j) { return 'ABCDEFGH'[j] + '. ' + x; }).join(' ');
    var ans = (q.answer || []).join('');
    return (i + 1) + '. ' + String(q.stem || '') + (o ? ' ' + o : '') + (ans ? ' 答案：' + ans : '');
  }
  function cfgOK(cb) {
    var cfg = null;
    try { cfg = (typeof aiCfg === 'function') ? aiCfg() : null; } catch (e) { cfg = null; }
    if (cfg && cfg.model && (cfg.base || cfg.preset === 'ollama') && typeof aiChat === 'function') return true;
    JOB.note = '还没配 AI：先去「AI 与知识库」配一个服务';
    JOB.err = { msg: '还没配 AI', hint: '去 #/kb 选服务（本地 Ollama 也行）、填上模型再回来' };
    paintAI();
    if (typeof toast === 'function') toast('还没配 AI：先去「AI 与知识库」配一下');
    return false;
  }
  function firstN(arr, n) { return arr.slice(0, n); }

  /* Step 1：生成词表 */
  async function genVocab() {
    if (JOB.running) return;
    if (!cfgOK()) return;
    var banks = [];
    try { banks = (typeof baseBanks === 'function') ? baseBanks() : []; } catch (e) {}
    if (!banks.length) { JOB.note = '还没有题库'; paintAI(); return; }
    var sample = [];
    banks.forEach(function (b) {
      var qs = firstN((b.questions || []).filter(function (q) { return !tagsOf(keyOf(b, q)).length; }), 12);
      if (!qs.length) qs = firstN(b.questions || [], 6);
      qs.forEach(function (q) { if (sample.length < 48) sample.push({ b: b, q: q }); });
    });
    if (!sample.length) { JOB.note = '没有可参考的题'; paintAI(); return; }
    JOB.running = true; JOB.note = ''; JOB.err = null; JOB.vocab = null; JOB.total = 0; JOB.done = 0;
    JOB.ctl = ('AbortController' in window) ? new AbortController() : null;
    paintAI();
    var prompt = '你是医学考试的教研老师。下面是题库里的若干题目（题干 / 选项 / 答案）。\n'
      + '请提炼出 ' + V_MIN + '–' + V_MAX + ' 个**考点名词**，要求：\n'
      + '1) 每个 2–6 个字，是名词短语，比如「炎症」「免疫应答」「酸碱平衡」；\n'
      + '2) 覆盖这个题库的主要内容，别用「其它」「综合」这种词；\n'
      + '3) 严格只输出 JSON 数组，不要解释、不要代码块围栏：\n["炎症","免疫应答"]\n\n'
      + '【题库】' + banks.map(function (b) { return b.title || b.id; }).slice(0, 3).join('、') + '\n'
      + '【题目】\n' + sample.map(function (x, i) { return qLine(x.q, i); }).join('\n');
    try {
      var sys = (typeof aiSysText === 'function') ? aiSysText() : '你是一位医学考试的教研老师。';
      var txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: prompt }],
        function () {}, JOB.ctl ? JOB.ctl.signal : undefined);
      var arr = parseJSONArray(txt);
      if (!arr) { JOB.note = '词表没解析出来，重试一次或换模型'; JOB.err = { msg: 'AI 没按 JSON 输出' }; }
      else {
        JOB.vocab = norm(arr).slice(0, V_MAX);
        JOB.note = '词表出来了：' + JOB.vocab.length + ' 个（确认后点「用这份词表」）';
      }
    } catch (e) {
      var stopped = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      JOB.note = stopped ? '已停止' : '出错：' + ((e && e.message) || e);
      if (!stopped) JOB.err = { msg: (e && e.message) || '出错' };
    } finally {
      JOB.running = false; JOB.ctl = null; paintAI();
    }
  }

  /* Step 2：分批分类 */
  async function tagAll() {
    if (JOB.running) return;
    if (!cfgOK()) return;
    if (!TAGV.length) { JOB.note = '先有词表再分类（点「1) 生成考点词表」）'; paintAI(); return; }
    var todo = [];
    try {
      (typeof baseBanks === 'function' ? baseBanks() : []).forEach(function (b) {
        (b.questions || []).forEach(function (q) {
          var k = keyOf(b, q);
          if (!tagsOf(k).length) todo.push({ b: b, q: q, k: k });
        });
      });
    } catch (e) {}
    if (!todo.length) { JOB.note = '所有题都有标签了'; paintAI(); return; }
    var batches = [];
    for (var i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    JOB.running = true; JOB.note = ''; JOB.err = null; JOB.total = batches.length; JOB.done = 0;
    JOB.ctl = ('AbortController' in window) ? new AbortController() : null;
    paintAI();
    var sys = (typeof aiSysText === 'function') ? aiSysText() : '你是一位医学考试的教研老师。';
    var okQ = 0, fail = 0;
    for (var bi = 0; bi < batches.length; bi++) {
      if (!JOB.running) break;
      JOB.done = bi;
      paintAI();
      var list = batches[bi];
      var prompt = '你是命题老师。给下面每道题选 1–3 个考点标签，标签**必须**从这份词表里选，不要自创：\n'
        + '【词表】' + TAGV.join(' / ') + '\n\n'
        + '只输出 JSON，不要解释、不要代码块：\n{ "1": ["炎症"], "2": ["免疫应答","免疫调节"] }\n\n'
        + '【题目】\n' + list.map(function (x, i) { return qLine(x.q, i); }).join('\n');
      try {
        var txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: prompt }],
          function () {}, JOB.ctl ? JOB.ctl.signal : undefined);
        var map = parseJSONMap(txt);
        if (!map) { fail++; continue; }
        list.forEach(function (x, i) {
          var v = map[String(i + 1)];
          if (!v) return;
          var pick = norm([].concat(v)).filter(function (t) { return TAGV.indexOf(t) >= 0; });   /* 只认词表里的 */
          if (!pick.length) {
            return;
          }
          setTags(x.k, pick, true);
          okQ++;
        });
      } catch (e) {
        var stopped = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
        if (stopped) { JOB.note = '已停止：这一批之前的都保住了'; break; }
        fail++;
      }
    }
    JOB.running = false; JOB.ctl = null; JOB.done = JOB.total;
    JOB.note = '打完：' + okQ + ' 道' + (fail ? '，' + fail + ' 批失败（模型没按 JSON 输出）' : '')
      + (todo.length > okQ ? '，还有 ' + (todo.length - okQ) + ' 道没标签' : '');
    TAGS_STATS_CACHE = null;
    paintAI();
    if (typeof render === 'function') { try { render(); } catch (e) {} }
    paintAI();   /* 上面整页重画过：#tagAiState 是新节点，把「打完…」这句补回去 */
  }
  function stop() {
    if (!JOB.running) return;
    JOB.running = false;
    try { if (JOB.ctl) JOB.ctl.abort(); } catch (e) {}
    JOB.note = '已停止';
    paintAI();
  }

  function bindStats(host) {
    if (!host) return;
    var st = host.querySelector('#tagAiCard');
    if (st) {
      st.addEventListener('click', function (e) {
        if (e.target.closest('#tagGenVocab')) { genVocab(); return; }
        if (e.target.closest('#tagGo')) { tagAll(); return; }
        if (e.target.closest('#tagStop')) { stop(); return; }
        var d = e.target.closest('[data-newvocabdel]');
        if (d) {
          var t = d.getAttribute('data-newvocabdel');
          JOB.vocab = (JOB.vocab || []).filter(function (x) { return x !== t; });
          paintAI(); return;
        }
        if (e.target.closest('[data-newvocabsave]')) {
          var n = rememberVocab(JOB.vocab || []);
          JOB.note = '词表已保存：新增 ' + n + ' 个，共 ' + TAGV.length + ' 个';
          JOB.vocab = null; paintAI();
          if (typeof render === 'function') { try { render(); } catch (err) {} }
          return;
        }
        if (e.target.closest('[data-newvocabdrop]')) { JOB.vocab = null; JOB.note = '已丢弃这份词表'; paintAI(); return; }
        if (e.target.closest('[data-vocabai]')) { genVocab(); return; }
        if (e.target.closest('[data-vocabimport]')) {
          var all = [];
          Object.keys(TAGD).forEach(function (k) { all = all.concat(tagsOf(k)); });
          var n2 = rememberVocab(all);
          JOB.note = '从已打的标签补进词表：' + n2 + ' 个';
          if (typeof render === 'function') { try { render(); } catch (err2) {} }
          return;
        }
        if (e.target.closest('[data-vocabadd]')) {
          var inp = host.querySelector('#tagVocabInp');
          var v = inp ? inp.value : '';
          if (!v) { if (inp) inp.focus(); return; }
          rememberVocab([v]);
          if (typeof render === 'function') { try { render(); } catch (err3) {} }
          return;
        }
        var vd = e.target.closest('[data-vocabdel]');
        if (vd) {
          var t2 = vd.getAttribute('data-vocabdel');
          var used = tagsOf ? Object.keys(TAGD).filter(function (k) { return tagsOf(k).indexOf(t2) >= 0; }).length : 0;
          if (used && !confirm('「' + t2 + '」还挂在 ' + used + ' 道题上。从词表删掉并同时摘掉这些标签？')) return;
          dropTagEverywhere(t2);
          TAGS_STATS_CACHE = null;
          if (typeof render === 'function') { try { render(); } catch (err4) {} }
          return;
        }
      });
      st.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target && e.target.id === 'tagVocabInp') {
          e.preventDefault(); e.stopPropagation();
          rememberVocab([e.target.value]);
          if (typeof render === 'function') { try { render(); } catch (err) {} }
        }
      });
    }
    var box = host.querySelector('#tagVocabCard');
    if (box) {
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-vocablist]')) {
          VIEW.bulk = true;
          if (typeof render === 'function') { try { render(); } catch (err) {} }
          setTimeout(function () { var t = document.getElementById('tagVocabBulk'); if (t) t.focus(); }, 60);
          return;
        }
        if (e.target.closest('[data-vocablistclose]')) {
          VIEW.bulk = false;
          if (typeof render === 'function') { try { render(); } catch (err) {} }
          return;
        }
        if (e.target.closest('[data-vocablistok]')) {
          var ta = document.getElementById('tagVocabBulk');
          var cat = document.getElementById('tagVocabBulkState');
          var parsed = parseVocabList(ta ? ta.value : '');
          if (!parsed.length) { if (cat) cat.textContent = '一行都没认出考点（每行写「名字」或「名字：说明」）'; return; }
          var res = addVocabBulk(parsed);
          VIEW.bulk = false;
          if (typeof render === 'function') { try { render(); } catch (err) {} }
          if (typeof toast === 'function') toast('词表里加了 ' + res.added + ' 个考点（跳过 ' + (parsed.length - res.added) + ' 个重名的），现在共 ' + res.total + ' 个');
          /* 词表刚到位，顺手问一句要不要让 AI 给还没标签的题贴 */
          var banks = [];
          try { banks = (typeof baseBanks === 'function') ? baseBanks() : []; } catch (err5) {}
          var total = 0, tagged = 0;
          banks.forEach(function (b) { (b.questions || []).forEach(function (q) { total++; if (tagsOf(keyOf(b, q)).length) tagged++; }); });
          if (total - tagged > 0 && !JOB.running && cfgOK() && typeof confirm === 'function'
              && confirm('词表里有 ' + res.total + ' 个考点了。\n现在让 AI 给还没标签的 ' + (total - tagged) + ' 道题贴标签吗？（用 AI，可以中途停）')) {
            tagAll();
          }
          return;
        }
        var dd = e.target.closest('[data-vocabdel]');
        if (!dd) return;
        var t = dd.getAttribute('data-vocabdel');
        var used = Object.keys(TAGD).filter(function (k) { return tagsOf(k).indexOf(t) >= 0; }).length;
        if (used && !confirm('「' + t + '」还挂在 ' + used + ' 道题上。从词表删掉并同时摘掉这些标签？')) return;
        dropTagEverywhere(t);
        TAGS_STATS_CACHE = null;
        if (typeof render === 'function') { try { render(); } catch (err) {} }
      });
    }
    host.addEventListener('click', function (e) {
      var w = e.target.closest('[data-act="tagweak"]');
      if (w) {
        var pick = weakestKeys(3);
        if (!pick.keys.length) { if (typeof toast === 'function') toast('还没有可用的考点标签'); return; }
        if (typeof makePaper === 'function') makePaper('薄弱考点 · ' + pick.tags.join('、'), pick.keys, {});
        return;
      }
      if (e.target.closest('[data-act="tagvocab"]')) {
        var box2 = document.getElementById('tagVocabCard');
        if (box2) box2.scrollIntoView({ block: 'start' });
        return;
      }
      var open = e.target.closest('[data-tagopen]');
      if (open) {
        var t = open.getAttribute('data-tagopen');
        if (typeof go === 'function') go('#/search');       /* 先用搜索页当「看这个考点下的题」的落脚点 */
        _pendingTag = t;
        setTimeout(function () { if (typeof tagOpenInSearch === 'function') tagOpenInSearch(t); }, 60);
      }
    });
  }
  function parseVocabList(txt) {
    var out = [], seen = {};
    String(txt || '').split(/[\r\n]+/).forEach(function (raw) {
      var s = String(raw || '').trim();
      if (!s) return;
      s = s.replace(/^[\s\-•·*—–]+/, '')                         /* 项目符号 */
           .replace(/^\s*[（(]?\s*\d+\s*[.、)）:：]?\s*/, '')      /* 1. / （2） / 3、 */
           .replace(/^\s*[①-⑳]\s*/, '')                          /* ①②③ */
           .replace(/^["“'「『]+|["”'」』]+$/g, '')                 /* 首尾引号 */
           .trim();
      if (!s) return;
      var parts = s.split(/\s*[:：]\s*|\s+[-–—]\s+|\t+|\s{2,}/);  /* 名字：说明 / 名字 - 说明 */
      var name = String(parts[0] || '').trim().replace(/["“'「『]+|["”'」』]+$/g, '').trim();
      name = name.slice(0, 14);
      if (name.length < 2) return;                                /* 太短的丢掉 */
      if (seen[name]) return;
      seen[name] = 1; out.push(name);
    });
    return out;
  }
  function addVocabBulk(list) {
    var before = TAGV.length;
    rememberVocab(list);
    saveVocab();
    TAGV = norm(TAGV);
    TAGS_STATS_CACHE = null;
    return { added: Math.max(0, TAGV.length - before), total: TAGV.length, skipped: Math.max(0, list.length - Math.max(0, TAGV.length - before)) };
  }
  var _pendingTag = null;
  /* 搜索页里按标签筛：借它现成的搜索框（标签词本来就常在题干里，先填进去） */
  function tagOpenInSearch(t) {
    var inp = document.getElementById('sq');
    if (!inp) return;
    inp.value = t;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---------- 对外 ---------- */
  window.tagsOf = tagsOf;
  window.setTags = setTags;
  window.addTags = addTags;
  window.delTag = delTag;
  window.tagReload = function () { rd(); TAGS_STATS_CACHE = null; };
  window.tagRowHtml = rowHtml;
  window.bindTagRow = bindRow;
  window.tagStats = tagStats;
  window.tagStatsHtml = statsHtml;
  window.bindTagStats = bindStats;
  window.tagOpenInSearch = tagOpenInSearch;
  window.dropTagsOfBank = dropTagsOfBank;
  window.TAGS = {
    of: tagsOf, set: setTags, add: addTags, del: delTag, all: function () { return TAGV.slice(); },
    vocab: function () { return TAGV.slice(); }, rememberVocab: rememberVocab,
    stats: tagStats, weakest: weakestKeys, html: statsHtml, bind: bindStats,
    rowHtml: rowHtml, bindRow: bindRow, job: JOB, genVocab: genVocab, tagAll: tagAll, stop: stop,
    save: function () { save(); saveVocab(); }, reload: function () { rd(); },
    parseVocabList: parseVocabList, addVocabBulk: addVocabBulk,
    data: function () { return TAGD; }, dropBank: dropTagsOfBank,
    /* 云同步用：云端那份标签并进来。同一道题以本机为准（本机更可能是刚改过的），
       本机没有的题补上；云端词表也合进词表里。墓碑里的题不复活。 */
    mergeIn: function (cloudTags, cloudVocab) {
      var n = 0;
      try {
        var tomb = (typeof TOMB === 'object' && TOMB && TOMB.tag) || {};
        Object.keys(cloudTags || {}).forEach(function (k) {
          var v = norm(cloudTags[k]).slice(0, MAX_PER_Q);
          if (!v.length || tomb[k]) return;
          if (TAGD[k] && TAGD[k].length) return;          /* 本机有：留着本机的 */
          TAGD[k] = v; n++;
        });
        if (cloudVocab && cloudVocab.length) rememberVocab(cloudVocab);
        if (n) { save(); saveVocab(); if (typeof bumpHay === 'function') { try { bumpHay(); } catch (e) {} } }
        else if (cloudVocab && cloudVocab.length) saveVocab();
      } catch (e) {}
      return n;
    }
  };
  rd();
})();
