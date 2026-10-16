/* ============================================================
   AI 变式题（方案三）
   拿一道题（尤其错题）让 AI 出「同考点的新题」，再和库里的相似题做对比。
   依赖（都按名调用，缺了就降级）：
     ai.js   aiSysText / aiUserText / aiContext / aiChat / aiCfg / aiChipHtml / kbSelected / kbSetSel
     app.js  $ / esc / toast / parseInput / normalizeQ / openAnsEditor / allBanks / bankById
             LOCAL / FIX / writeLS / LS / invalidateBanks / saveFix / render / go
   约定（见 改造方案/00-通用约定与验收.md）：不引依赖、顶层不抛错、只动 transform/opacity。
   ============================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var DIRS = ['老师爱考病例题', '考细节/数字', '加大难度', '保持难度', '考易混概念辨析', '多选为主', '考计算', '考机制/原理', '偏基础'];
  var N_OPTS = [3, 5, 8];
  var SIM_MIN = 0.22;        /* 相似度门槛：低于这个就不列 */
  var SIM_TOP = 3;           /* 最多列几道 */
  var SIM_SCAN = 4000;       /* 最多扫多少道已有题，防止十几万题时卡住 */
  var FRESH_MS = 3 * 60 * 1000;
  var V_LAST = {};           /* 题键 → 面板状态：整页重画之后还能挂回来 */

  /* ---------- 小工具 ---------- */
  function cssq(s) { return String(s == null ? '' : s).replace(/["\\]/g, '\\$&'); }
  function live(st) { try { return document.querySelector('.vpanel[data-vk="' + cssq(st.k) + '"]'); } catch (e) { return null; } }
  function fade(el, cls, ms) {                     /* 只动 opacity/transform 的轻提示 */
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 1400);
  }
  function bankOf(k) {
    if (typeof allBanks !== 'function') return null;
    var bs = allBanks();
    for (var i = 0; i < bs.length; i++) if (!bs[i].paper && String(k).indexOf(bs[i].id + '#') === 0) return bs[i];
    return null;
  }

  /* ---------- 2-gram 相似度（纯本地，不调 AI） ---------- */
  var GRAM_CACHE = new WeakMap();
  function grams(text) {
    var t = String(text || '').replace(/\s+/g, '');
    var s = new Set();
    for (var i = 0; i + 1 < t.length; i++) s.add(t.slice(i, i + 2));
    return s;
  }
  function qText(q) {
    return [q && q.group, q && q.stem, (q && q.options || []).join(' '), q && q.explain].filter(Boolean).join(' ');
  }
  function gramsOf(q) {
    if (q && typeof q === 'object' && GRAM_CACHE.has(q)) return GRAM_CACHE.get(q);
    var g = grams(qText(q));
    if (q && typeof q === 'object') { try { GRAM_CACHE.set(q, g); } catch (e) {} }
    return g;
  }
  function jac(a, b) {
    if (!a.size || !b.size) return 0;
    var small = a.size <= b.size ? a : b, big = a.size <= b.size ? b : a, inter = 0;
    small.forEach(function (g) { if (big.has(g)) inter++; });
    return inter / (a.size + b.size - inter);
  }
  function simList(q, skipBankId) {
    var A = gramsOf(q);
    if (A.size < 8) return [];
    var banks = (typeof allBanks === 'function') ? allBanks() : [];
    var out = [], scanned = 0;
    for (var i = 0; i < banks.length; i++) {
      var b = banks[i];
      if (!b || b.paper) continue;                       /* 套卷是引用别的题，不重复比 */
      if (skipBankId && b.id === skipBankId) continue;
      var qs = b.questions || [];
      for (var j = 0; j < qs.length; j++) {
        if (++scanned > SIM_SCAN) break;
        var B = gramsOf(qs[j]);
        if (B.size < A.size * 0.35 || B.size > A.size * 3.2) continue;   /* 长短差太多，先跳过省算力 */
        var s = jac(A, B);
        if (s >= SIM_MIN) out.push({ bank: b, q: qs[j], score: s });
      }
      if (scanned > SIM_SCAN) break;
    }
    out.sort(function (p, r) { return r.score - p.score; });
    return out.slice(0, SIM_TOP);
  }
  /* 把 text 里和 other 重复的 2-gram 片段包成 <mark>（用于并排对比） */
  function hiShared(text, otherSet) {
    var t = String(text == null ? '' : text);
    if (!otherSet || !otherSet.size) return esc(t);
    var out = '', i = 0, mark = false;
    while (i < t.length) {
      var hit = (i + 1 < t.length) && otherSet.has(t.slice(i, i + 2));
      if (hit && !mark) { out += '<mark>'; mark = true; }
      else if (!hit && mark) { out += '</mark>'; mark = false; }
      out += esc(t.charAt(i));
      i++;
    }
    if (mark) out += '</mark>';
    return out;
  }

  /* ---------- 面板 HTML ---------- */
  function srcHtml(st) {
    var q = st.q || {};
    var ans = (typeof ansOf === 'function') ? (ansOf(st.k, q) || []) : (q.answer || []);
    var rec = (typeof recOf === 'function') ? recOf(st.k) : null;
    var opts = (q.options || []).map(function (o, i) {
      var K = 'ABCDEFGH'[i];
      var mine = rec && (rec.sel || []).indexOf(K) >= 0;
      return '<div class="vso' + (mine && ans.indexOf(K) < 0 ? ' w' : '') + '"><b>' + K + '</b>' + esc(typeof optText === 'function' ? optText(o, K) : o) + '</div>';
    }).join('');
    return '<div class="vsrc">' +
      '<div class="vsrc-tag">源题</div>' +
      (q.group ? '<div class="gstem"><b>共用题干：</b>' + esc(q.group) + '</div>' : '') +
      '<div class="vsrc-stem">' + esc(q.stem || '') + '</div>' +
      (opts ? '<div class="vsrc-opts">' + opts + '</div>' : '') +
      '<div class="small muted">答案 <b>' + (ans.join('') || '—') + '</b>' +
      (rec ? '　我的作答 <b>' + ((rec.sel || []).join('') || '—') + '</b>　错 ' + (rec.wrong || 0) + ' 次 / 作答 ' + (rec.tries || 0) + ' 次' : '　还没做过这道题') +
      '</div></div>';
  }
  function panelHtml(st) {
    var chips = DIRS.map(function (d) { return '<span class="vchip' + (st.dirs.indexOf(d) >= 0 ? ' on' : '') + '" data-dir="' + esc(d) + '">' + esc(d) + '</span>'; }).join('');
    var ns = N_OPTS.map(function (n) { return '<span class="vchip vnchip' + (st.n === n ? ' on' : '') + '" data-n="' + n + '">' + n + ' 道</span>'; }).join('');
    var kbs = (typeof aiChipHtml === 'function') ? aiChipHtml() : '';
    return '<div class="vpanel" data-vk="' + esc(st.k) + '">' +
      '<div class="vhead"><b>AI 变式题</b>' +
      '<span class="vstate aistate">就绪</span>' +
      '<span class="spacer-grow"></span>' +
      '<span class="tag">同考点换情境 · 出新题</span>' +
      '<button class="btn tiny vclose" type="button">收起</button></div>' +
      srcHtml(st) +
      '<div class="vlab">命题方向 <span class="muted">（可多选，会拼进提问里）</span></div>' +
      '<div class="vchips">' + chips + '</div>' +
      '<textarea class="vask" rows="2" placeholder="也可以直接说人话，比如：我们老师喜欢出病例题，问「最可能的诊断」，选项互相干扰；难度比这题再高一点"></textarea>' +
      '<div class="vlab">出几道</div>' +
      '<div class="vchips">' + ns + '</div>' +
      '<div class="vlab">参考资料（本地知识库）</div>' +
      '<div class="aichips"><span class="aichipbox">' + kbs + '</span><span class="aichint"></span></div>' +
      '<div class="vactions">' +
      '<button class="btn primary vgo" type="button">生成变式题</button>' +
      '<button class="btn vstop" type="button" disabled>停止</button>' +
      '<button class="btn vcopyq" type="button">复制提问</button>' +
      '<button class="btn vsave" type="button" disabled>存成新题库</button>' +
      '</div>' +
      '<div class="vout small muted"></div>' +
      '<div class="vcards"></div>' +
      '</div>';
  }

  /* ---------- 状态 ---------- */
  function stateFor(k, q) {
    var st = V_LAST[k];
    if (!st) {
      st = V_LAST[k] = {
        k: k, q: q, dirs: [], ask: '', n: 3,
        running: false, ctl: null, text: '', ctx: null, msgs: [], parsed: null,
        parseErr: '', err: null, sims: {}, uid: 'var:' + Math.random().toString(36).slice(2, 8),
        endTs: 0, ts: 0, timer: null, notes: []
      };
    }
    if (q) st.q = q;
    return st;
  }

  /* ---------- 界面刷新 ---------- */
  function setRun(st, on) {
    st.running = on;
    var p = live(st);
    if (!p) return;
    var go = p.querySelector('.vgo'), stop = p.querySelector('.vstop'), save = p.querySelector('.vsave');
    if (go) { go.disabled = on; go.textContent = on ? '正在生成…' : '生成变式题'; }
    if (stop) stop.disabled = !on;
    if (save) save.disabled = on || !(st.parsed && st.parsed.length);
    var s = p.querySelector('.vstate');
    if (s) { s.textContent = on ? '正在生成…' : '就绪'; s.classList.toggle('run', !!on); }
  }
  function paintOut(st) {
    var p = live(st);
    if (!p) return;
    var out = p.querySelector('.vout');
    if (!out) return;
    var head = '';
    if (st.err) head = '<div class="note err">' + esc(st.err.msg || '出错') + (st.err.hint ? '<div class="small muted">' + esc(st.err.hint) + '</div>' : '') + '</div>';
    var notes = st.notes.length ? '<div class="small muted">' + st.notes.map(esc).join('　·　') + '</div>' : '';
    var body = st.text ? '<pre class="vraw">' + esc(st.text) + '</pre>' : '';
    // 已经解析成卡片了，就把原文折起来（不然上面一大段原文、下面又是卡片，看着重复）
    if (st.text && st.parsed && st.parsed.length && !st.running) {
      body = '<details class="vrawbox"><summary>看模型原文（' + st.text.length + ' 字）</summary>' + body + '</details>';
    }
    out.innerHTML = head + notes + body + (st.running ? '<div class="small muted">正在写…（已 ' + (st.text || '').length + ' 字）</div>' : '');
  }
  function note(st, s) { st.notes.push(s); if (st.notes.length > 4) st.notes.shift(); paintOut(st); }

  function paintCards(st) {
    var p = live(st);
    if (!p) return;
    var box = p.querySelector('.vcards');
    if (!box) return;
    if (st.parseErr) {
      box.innerHTML = '<div class="note err">没解析成题目：' + esc(st.parseErr) +
        '<div class="small muted">原文在上面，可以「复制提问」换个模型再试，或点「生成变式题」重来一次。</div>' +
        '<div class="actions"><button class="btn tiny vretry" type="button">重试</button>' +
        '<button class="btn tiny vcopyq2" type="button">复制提问</button></div></div>';
      return;
    }
    if (!st.parsed || !st.parsed.length) { box.innerHTML = ''; return; }
    var H = ['<div class="vlab">解析出来的 ' + st.parsed.length + ' 道变式题</div>'];
    st.parsed.forEach(function (q, i) {
      var ans = (q.answer && q.answer.length) ? q.answer : [(q.answer || '')];
      var opts = (q.options || []).map(function (o, j) {
        var K = 'ABCDEFGH'[j];
        var right = ans.indexOf(K) >= 0;
        return '<div class="vopt' + (right ? ' r' : '') + '"><b>' + K + '</b>' + esc(typeof optText === 'function' ? optText(o, K) : o) +
          (right ? '<span class="mini-tag ok">正确</span>' : '') + '</div>';
      }).join('');
      var sims = st.sims[i] || [];
      H.push('<div class="vcard" data-vi="' + i + '">' +
        '<div class="vcard-head"><span class="vno">变式 ' + (i + 1) + '</span>' +
        '<span class="mini-tag">答案 ' + (ans.join('') || '?') + '</span>' +
        '<span class="spacer-grow"></span>' +
        '<button class="btn tiny vfix" type="button">改答案</button>' +
        '<button class="btn tiny vsim" type="button" data-i="' + i + '">相似的已有题' + (sims.length ? ' (' + sims.length + ')' : '') + '</button>' +
        '</div>' +
        '<div class="vstem">' + esc(q.stem || '') + '</div>' +
        (opts ? '<div class="vopts">' + opts + '</div>' : '') +
        (q.explain ? '<div class="vexp">' + esc(q.explain) + '</div>' : '') +
        '<div class="vfixhost"></div>' +
        '<div class="vsimbox"></div>' +
        '</div>');
    });
    box.innerHTML = H.join('');
  }

  function simBoxHtml(st, i) {
    var sims = st.sims[i] || [];
    if (!sims.length) return '<div class="small muted">库里没找到明显相似的题（阈值 ' + Math.round(SIM_MIN * 100) + '%）。</div>';
    return '<div class="vlab">相似的已有题</div>' + sims.map(function (s, j) {
      return '<div class="vsimrow">' +
        '<div class="vsim-l"><span class="sim-pct">' + Math.round(s.score * 100) + '%</span>' +
        '<b>' + esc(s.bank.title || s.bank.id) + '</b>' +
        '<div class="small muted">' + esc(String(s.q.stem || '').slice(0, 60)) + '</div></div>' +
        '<button class="btn tiny vcmp" type="button" data-i="' + i + '" data-j="' + j + '">对比</button>' +
        '</div>';
    }).join('');
  }
  function cmpHtml(st, i, j) {
    var vq = st.parsed[i], s = (st.sims[i] || [])[j];
    if (!vq || !s) return '';
    var A = gramsOf(vq), B = gramsOf(s.q);
    var va = (typeof ansOf === 'function') ? ansOf(s.bank.id + '#' + s.q.id, s.q) : (s.q.answer || []);
    function block(title, q, otherSet, mine) {
      return '<div class="vcmp-side"><div class="vcmp-t">' + esc(title) + (mine ? ' <span class="mini-tag ok">答案 ' + (mine.join('') || '—') + '</span>' : '') + '</div>' +
        (q.group ? '<div class="gstem small"><b>共用题干：</b>' + hiShared(q.group, otherSet) + '</div>' : '') +
        '<div class="vstem">' + hiShared(q.stem, otherSet) + '</div>' +
        '<div class="vopts">' + (q.options || []).map(function (o, k) { return '<div class="vopt">' + ('ABCDEFGH'[k]) + '. ' + hiShared(o, otherSet) + '</div>'; }).join('') + '</div>' +
        (q.explain ? '<div class="vexp small">' + hiShared(q.explain, otherSet) + '</div>' : '') +
        '</div>';
    }
    return '<div class="vcmp">' +
      block('变式题（新）', vq, B, (vq.answer || [])) +
      block('已有题 · ' + (s.bank.title || s.bank.id), s.q, A, va) +
      '<div class="small muted">黄色 = 两题共有的字词片段；相似度 ' + Math.round(s.score * 100) + '%（2-gram Jaccard，纯本地算的）</div>' +
      '</div>';
  }

  /* ---------- 事件绑定 ---------- */
  function bindPanel(host, st) {
    var p = host.querySelector('.vpanel');
    if (!p) return;
    p.querySelector('.vclose').onclick = function () { host.innerHTML = ''; };
    p.querySelectorAll('.vchip[data-dir]').forEach(function (c) {
      c.onclick = function () {
        var d = c.dataset.dir, i = st.dirs.indexOf(d);
        if (i >= 0) st.dirs.splice(i, 1); else st.dirs.push(d);
        c.classList.toggle('on', i < 0);
      };
    });
    p.querySelectorAll('.vnchip').forEach(function (c) {
      c.onclick = function () {
        st.n = +c.dataset.n || 3;
        p.querySelectorAll('.vnchip').forEach(function (x) { x.classList.toggle('on', x === c); });
      };
    });
    var ta = p.querySelector('.vask');
    if (ta) { ta.value = st.ask || ''; ta.oninput = function () { st.ask = ta.value; }; }
    p.querySelector('.vgo').onclick = function () { run(st); };
    p.querySelector('.vstop').onclick = function () { if (st.ctl) { try { st.ctl.abort(); } catch (e) {} note(st, '你点了停止'); } };
    p.querySelector('.vcopyq').onclick = function () { copyAsk(st); };
    p.querySelector('.vsave').onclick = function () { saveBank(st); };
    /* 知识库 chips：和 AI 面板同一套 kbSetSel/paintAiChips */
    var box = p.querySelector('.aichipbox');
    if (box && typeof kbSetSel === 'function') {
      box.addEventListener('click', function (e) {
        var c = e.target.closest ? e.target.closest('.aichip') : null;
        if (!c) return;
        var on = !c.classList.contains('on');
        try {
          if (c.dataset.kb === '__all__' && typeof kbSelAll === 'function') kbSelAll(on);
          else kbSetSel(c.dataset.kb, on);
        } catch (err) {}
        if (typeof paintAiChips === 'function') paintAiChips();
        if (typeof aiChipHtml === 'function') box.innerHTML = aiChipHtml();
      });
    }
    /* 卡片里的按钮：用事件委托，重画卡片后不用重新绑 */
    p.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('vretry')) { run(st); return; }
      if (t.classList.contains('vcopyq2')) { copyAsk(st); return; }
      var card = t.closest ? t.closest('.vcard') : null;
      if (!card) return;
      var i = +card.dataset.vi || 0;
      if (t.classList.contains('vfix')) {
        var fh = card.querySelector('.vfixhost');
        if (!fh || typeof openAnsEditor !== 'function') return;
        var qq = st.parsed[i];
        openAnsEditor(fh, st.uid + '#' + i, qq, function () {
          paintCards(st);
          var c2 = (live(st) || p).querySelector('.vcard[data-vi="' + i + '"]');
          if (c2) fade(c2, 'flash', 900);
        });
      } else if (t.classList.contains('vsim')) {
        var sb = card.querySelector('.vsimbox');
        if (!sb) return;
        if (st.sims[i] == null) st.sims[i] = simList(st.parsed[i], (bankOf(st.k) || {}).id);
        if (sb.innerHTML) { sb.innerHTML = ''; return; }
        sb.innerHTML = simBoxHtml(st, i);
      } else if (t.classList.contains('vcmp')) {
        var sb2 = card.querySelector('.vsimbox');
        var j = +t.dataset.j || 0;
        var i2 = +t.dataset.i || 0;
        var old = sb2.querySelector('.vcmp');
        if (old) old.remove();
        sb2.insertAdjacentHTML('beforeend', cmpHtml(st, i2, j));
        var fresh = sb2.querySelector('.vcmp');
        if (fresh) fresh.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /* ---------- 生成 ---------- */
  function dirText(st) {
    var parts = [];
    if (st.dirs.length) parts.push(st.dirs.join('；'));
    var t = String(st.ask || '').trim();
    if (t) parts.push(t);
    return parts.join('；') || '按你自己的判断，出这道题同考点的常规考法';
  }
  function sysText(st) {
    var base = (typeof aiSysText === 'function') ? aiSysText() : '你是一位医学考试的命题老师。';
    return base +
      '\n\n【本次任务】你是命题老师。基于我给的源题，按【命题方向】出 ' + st.n + ' 道同考点变式题。' +
      '\n要求：' +
      '\n1) 考点必须与源题一致，但情境/数字/问法/选项要换，不能只改几个字；' +
      '\n2) 每题都要给正确选项和简短解析（解析里点出考点）；' +
      '\n3) 严格按下面的纯文本格式输出，不要写表格、不要代码块、不要额外解释：' +
      '\n# 变式题\n\n1. 题干…\nA. …\nB. …\nC. …\nD. …\n答案：X\n解析：…';
  }
  function askText(st) {
    var user = '';
    try {
      user = (typeof aiUserText === 'function')
        ? aiUserText(st.q, (st.ctx && st.ctx.text) || '', dirText(st), st.k)
        : ('【题目】' + (st.q && st.q.stem || ''));
    } catch (e) { user = '【题目】' + (st.q && st.q.stem || ''); }
    return user + '\n【命题方向】' + dirText(st) + '\n【题数】' + st.n;
  }
  function copyAsk(st) {
    var txt = sysText(st) + '\n\n' + askText(st);
    if (typeof download === 'function' && navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function () { toast('提问已经复制，粘到任意 AI 里就能问'); },
        function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('提问已经复制'); } catch (e) { toast('复制失败，手动选中吧'); }
    ta.remove();
  }

  async function run(st) {
    if (st.running) return;
    var cfg = (typeof aiCfg === 'function') ? aiCfg() : null;
    if (!cfg || !cfg.model || (!cfg.base && cfg.preset !== 'ollama')) { notCfg(st); return; }
    if (typeof aiChat !== 'function') { notCfg(st); return; }
    st.text = ''; st.err = null; st.parseErr = ''; st.parsed = null; st.notes = []; st.sims = {};
    st.running = true; st.ctl = ('AbortController' in window) ? new AbortController() : null;
    setRun(st, true); paintOut(st); paintCards(st);
    var p0 = live(st);
    if (p0) { var o0 = p0.querySelector('.vout'); if (o0) o0.innerHTML = '<div class="small muted">先问知识库、再让模型写，稍等…</div>'; }
    var timedOut = false;
    st.timer = setTimeout(function () { timedOut = true; if (st.running) note(st, '已经 30 秒了：模型慢的话可以继续等，或者点「停止」'); }, 30000);
    try {
      st.ctx = (typeof aiContext === 'function') ? await aiContext(st.q, dirText(st)) : null;
      var msgs = [{ role: 'system', content: sysText(st) }, { role: 'user', content: askText(st) }];
      st.msgs = msgs;
      var txt = await aiChat(msgs, function (full) {
        st.text = full || '';
        if (!timedOut) paintOut(st);
      }, st.ctl ? st.ctl.signal : undefined);
      st.text = txt || st.text;
    } catch (e) {
      var stopped = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      if (!stopped) st.err = (typeof aiErrInfo === 'function') ? aiErrInfo(e) : { msg: (e && e.message) || '出错', hint: '' };
    } finally {
      clearTimeout(st.timer); st.timer = null;
      st.running = false; st.ctl = null; st.endTs = Date.now();
      setRun(st, false);
    }
    paintOut(st);
    if (st.err) { paintCards(st); return; }
    /* 有内容就试着落地（停止时也试一下，说不定已经够一道题了） */
    var parsed = null;
    try {
      var r = (typeof parseInput === 'function') ? parseInput(st.text, '变式题') : { error: '解析模块没加载' };
      if (r && r.error) st.parseErr = r.error;
      else if (r && r.bank && (r.bank.questions || []).length) {
        parsed = r.bank.questions.map(function (q, i) { return (typeof normalizeQ === 'function') ? normalizeQ(q, i + 1) : q; });
      } else st.parseErr = '没读到题目';
    } catch (e) { st.parseErr = (e && e.message) || '解析出错'; }
    st.parsed = parsed;
    if (parsed && parsed.length) {
      /* 方案十一：生成完【自动挂到原题下面】（不用再点「存成新题库」）；
         顺手把答题页那一栏刷新一下 —— 不然要翻走再回来才看得到 */
      try {
        if (typeof varqAdd === 'function' && st.k) {
          varqAdd(st.k, parsed);
          var vh = document.getElementById('vStrip');
          if (vh) varqPaint(vh, st.k);
        }
      } catch (e) {}
      for (var i = 0; i < parsed.length; i++) st.sims[i] = simList(parsed[i], (bankOf(st.k) || {}).id);
      st.notes.push('解析出 ' + parsed.length + ' 道');
    }
    paintOut(st);   /* 再画一次：解析成功后把原文折起来 */
    paintCards(st);
    var p = live(st);
    if (p) {
      var save = p.querySelector('.vsave');
      if (save) save.disabled = !(st.parsed && st.parsed.length);
      var cards = p.querySelector('.vcards');
      if (cards) cards.scrollIntoView({ block: 'nearest' });
    }
  }
  function notCfg(st) {
    var p = live(st);
    var msg = '<div class="note">还没配 AI：去 <a href="#/kb">AI 与知识库</a> 选一个服务、填上模型（本地 Ollama 也可以），' +
      '再回来点「生成变式题」。<div class="small muted">变式题要用模型现场命题，所以必须先有可用的 AI。</div></div>';
    if (p) { var o = p.querySelector('.vout'); if (o) o.innerHTML = msg; }
    toast('还没配 AI：先去「AI 与知识库」配一下');
  }

  /* ---------- 落地：存成新题库 ---------- */
  /* 把一堆题存成一个自建题库（方案六的「考点出题」也走这里，别重复写一遍） */
  function saveBankFromQuestions(title, qs, opts) {
    opts = opts || {};
    qs = qs || [];
    if (!qs.length) { toast('还没有可存的题'); return false; }
    if (typeof LOCAL === 'undefined' || typeof writeLS !== 'function') { toast('存储模块没加载'); return false; }
    var id = (opts.idPrefix || 'local-var-') + Date.now().toString(36);
    while (LOCAL.some(function (b) { return b.id === id; })) id += 'x';
    var bank = { id: id, title: String(title || 'AI 新题').slice(0, 40), subtitle: opts.subtitle || ('自建题库 · AI 变式 · ' + qs.length + ' 题'), questions: qs };
    LOCAL.push(bank);
    if (typeof invalidateBanks === 'function') invalidateBanks();
    writeLS(typeof LS !== 'undefined' ? LS.banks : 'qbank.local.v2', LOCAL);
    if (typeof saveFix === 'function') { try { saveFix(); } catch (e) {} }
    if (typeof paintStorageUse === 'function') { try { paintStorageUse(); } catch (e) {} }
    if (typeof BF !== 'undefined' && BF && BF.autoSave) { try { BF.autoSave(); } catch (e) {} }
    toast('已存成新题库：' + bank.title);
    return id;
  }
  function saveBank(st) {
    var qs = st.parsed || [];
    if (!qs.length) { toast('还没有可存的题'); return; }
    var title = '变式 · ' + String((st.q && st.q.stem) || '').slice(0, 12);
    /* 面板里「改答案」是记在临时键上的：搬到新题库的键上，别丢 */
    var tmp = qs.map(function (q, i) { return { tk: st.uid + '#' + i, q: q }; });
    var id = saveBankFromQuestions(title, qs, {});
    if (id) tmp.forEach(function (x) {
      var nk = id + '#' + x.q.id;
      if (typeof FIX !== 'undefined' && FIX[x.tk]) { FIX[nk] = FIX[x.tk]; delete FIX[x.tk]; }
    });
    if (id && typeof saveFix === 'function') { try { saveFix(); } catch (e) {} }
    var p = live(st);
    if (p && id) {
      p.insertAdjacentHTML('beforeend', '<div class="note">已经存进「' + esc(title) + '」：可以去 <a href="#/bank/' + esc(id) + '">题库里直接做</a>，' +
        '或在首页「全部题库」里找到它（标着「自建」）。</div>');
    }
  }

  /* ---------- 对外入口 ---------- */
  function openVariant(host, k, q) {
    if (!host) return null;
    var st = stateFor(k, q);
    st.ts = Date.now();
    host.innerHTML = panelHtml(st);
    bindPanel(host, st);
    paintOut(st);
    paintCards(st);
    setRun(st, !!st.running);
    var save = host.querySelector('.vsave');
    if (save) save.disabled = st.running || !(st.parsed && st.parsed.length);
    if (typeof paintAiChips === 'function') { try { paintAiChips(); } catch (e) {} }
    if (typeof kbEnsureFilesLoaded === 'function') { try { kbEnsureFilesLoaded().then(function () { if (typeof paintAiChips === 'function') paintAiChips(); }); } catch (e) {} }
    var ta = host.querySelector('.vask');
    if (ta && !st.text) { try { ta.focus({ preventScroll: true }); } catch (e) {} }
    host.scrollIntoView({ block: 'nearest' });
    return st;
  }
  /* 整页重画之后把面板挂回来（跑着的生成不能因为翻页/答题就断） */
  function reopenFor(host, k, q) {
    var st = V_LAST[k];
    if (!st || !host) return false;
    var fresh = st.running || (st.endTs && Date.now() - st.endTs < FRESH_MS) || (st.ts && Date.now() - st.ts < FRESH_MS);
    if (!fresh) return false;
    openVariant(host, k, q);
    return true;
  }
  function forget(host) {
    if (!host) return;
    host.innerHTML = '';
  }

  /* ================= 变式题【挂到原题下面】（方案十一）=================
     用户要求：变式是【这道题的附属】——
       · 题干下面一排「变式 1 / 2 / 3」，点开就地做；
       · 作答前不露答案 / 解析；
       · 做变式【绝不写 ANS】—— 不进错题本、不算正确率、不进 SRS，纯练习；
       · 收藏是【单条】的：FAV['var:'+原题key+'#'+序号]，跟原题的 ★ 互不连带。 */
  var VARK = 'qbank.var.v1';
  var VARM = null;
  var VOPEN = {};            /* 题目 key → 当前切到的变式序号（不存 / -1 = 原题） */
  var VPICK = {};            /* '<k>#<i>' → ['A']：刚点的选项（还没提交） */
  function varqAll() {
    if (!VARM) { try { VARM = JSON.parse(localStorage.getItem(VARK) || '{}') || {}; } catch (e) { VARM = {}; } }
    return VARM;
  }
  function varqSave() { try { localStorage.setItem(VARK, JSON.stringify(VARM || {})); } catch (e) {} }
  function varqList(k) { var m = varqAll(); return (m[k] || []).slice(); }
  function varqStem(q) { return String((q && (q.stem || q.title)) || '').trim(); }
  function varqAdd(k, arr) {
    if (!k || !arr || !arr.length) return 0;
    var m = varqAll(), list = m[k] || (m[k] = []), n = 0;
    arr.forEach(function (q) {
      var stem = varqStem(q);        /* ⚠️ normalizeQ 出来的题目字段是 stem，不是 title —— 拿错字段会一道都存不进 */
      if (!stem || !q.options || !q.options.length) return;
      if (list.some(function (x) { return x.t === stem; })) return;      /* 同题干的不重复挂 */
      list.push({ t: stem, o: q.options, a: q.answer || [], e: q.explain || '', ts: Date.now() });
      n++;
    });
    if (n) varqSave();
    return n;
  }
  function varqClear(k) { var m = varqAll(); if (m[k]) { delete m[k]; varqSave(); } }
  function varqFK(k, i) { return 'var:' + k + '#' + i; }
  function varqOpenIdx(k) { return (typeof VOPEN[k] === 'number') ? VOPEN[k] : -1; }
  function varqPaint(host, k) {
    if (!host) return;
    var list = varqList(k);
    /* 切到某道变式时，把【原题正文】藏起来（原题本身没动，切回「原题」就复原）
       —— 这是「切换」而不是「在下面展开」 */
    var qb = document.getElementById('qBody');
    var open = varqOpenIdx(k);
    if (qb) qb.style.display = (open >= 0 && list[open]) ? 'none' : '';
    if (!list.length) { host.innerHTML = ''; return; }
    var chips = '<div class="vstrip-row"><span class="vstrip-lab">题目</span>'
      + '<button class="vchip vsc' + (open < 0 ? ' on' : '') + '" data-vopen="-1" title="回到原题">原题</button>'
      + list.map(function (v, i) {
          var st = v.r ? (v.r.ok ? ' ok' : ' bad') : '';
          return '<button class="vchip vsc' + st + (open === i ? ' on' : '') + '" data-vopen="' + i + '" title="切到这道变式（纯练习：不计错题本 / 正确率 / 复习）">变式 ' + (i + 1) + (v.r ? (v.r.ok ? ' ✓' : ' ✗') : '') + '</button>';
        }).join('')
      + '<button class="vchip vsc vclr" data-vclr="1" title="清空这道题的所有变式">清空</button></div>';
    var body = '';
    if (open >= 0 && list[open]) {
      var v = list[open], key = k + '#' + open, mine = VPICK[key] || [], r = v.r;
      var opts = (v.o || []).map(function (txt, j) {
        var K = 'ABCDEFGH'[j], cls = 'opt';
        if (r) { if ((v.a || []).indexOf(K) >= 0) cls += ' right'; else if (mine.indexOf(K) >= 0) cls += ' wrong'; }
        else if (mine.indexOf(K) >= 0) cls += ' sel';
        return '<button class="' + cls + '" data-vpick="' + K + '"' + (r ? ' disabled' : '') + '><span class="k">' + K + '</span><span>' + esc(optText(txt, K)) + '</span></button>';
      }).join('');
      body = '<div class="vexp">'
        + '<div class="vexp-hd"><span class="small muted">变式 ' + (open + 1) + '　·　纯练习：不计错题本 / 正确率 / 复习</span><span class="spacer-grow"></span>'
        + (r ? '<button class="btn tiny" data-vredo="1">再做一次</button>' : '')
        + '<button class="btn tiny" data-vfav="' + open + '">' + (FAV[varqFK(k, open)] ? '★ 已收藏' : '☆ 收藏') + '</button>'
        + '</div>'
        + '<div class="vstem">' + esc(v.t) + '</div>'
        + '<div class="opts">' + opts + '</div>'
        + (r ? '<div class="vres ' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '✓ 答对了' : '✗ 正确答案：' + esc((v.a || []).join('') || '（没给答案）')) + '</div>'
              + (v.e ? '<div class="vexp-exp"><b>解析：</b>' + ((typeof mdToHtml === 'function') ? mdToHtml(v.e) : esc(v.e)) + '</div>' : '')
            : '<div class="vexp-ft"><button class="btn primary" data-vsub="1"' + (mine.length ? '' : ' disabled') + '>提交</button></div>')
        + '</div>';
    }
    host.innerHTML = '<div class="vstrip-box">' + chips + body + '</div>';
    host.querySelectorAll('[data-vopen]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.vopen;
        /* ⚠️ 直接按题目 key 存序号 —— 别从字符串里拆：题目 key 本身就带 '#'（bank12#34），拆出来是题号，不是序号 */
        if (i >= 0) VOPEN[k] = i; else delete VOPEN[k];
        varqPaint(host, k);
      };
    });
    var clr = host.querySelector('[data-vclr]');
    if (clr) clr.onclick = function () { if (confirm('清空这道题的所有变式？')) { varqClear(k); varqPaint(host, k); } };
    var cls2 = host.querySelector('[data-vclose]');
    if (cls2) cls2.onclick = function () { delete VOPEN[k]; varqPaint(host, k); };
    if (open < 0) return;
    var key2 = k + '#' + open;
    host.querySelectorAll('[data-vpick]').forEach(function (b) {
      b.onclick = function () {
        var K = b.dataset.vpick, arr = VPICK[key2] || (VPICK[key2] = []);
        var at = arr.indexOf(K);
        if (at >= 0) arr.splice(at, 1); else arr.push(K);
        varqPaint(host, k);
      };
    });
    var sb = host.querySelector('[data-vsub]');
    if (sb) sb.onclick = function () {
      var l = varqAll()[k]; if (!l || !l[open]) return;
      var mine2 = (VPICK[key2] || []).slice().sort();
      var corr = (l[open].a || []).slice().sort();
      var ok = mine2.length === corr.length && mine2.every(function (x, n2) { return x === corr[n2]; });
      l[open].r = { ok: ok, sel: mine2, ts: Date.now() };   /* 只写变式自己，绝不碰 ANS */
      varqSave();
      varqPaint(host, k);
    };
    var rb = host.querySelector('[data-vredo]');
    if (rb) rb.onclick = function () {
      var l = varqAll()[k];
      if (l && l[open]) { delete l[open].r; varqSave(); }
      delete VPICK[key2];
      varqPaint(host, k);
    };
    var fb = host.querySelector('[data-vfav]');
    if (fb) fb.onclick = function () {
      var fk2 = varqFK(k, open);
      if (FAV[fk2]) { delete FAV[fk2]; } else { FAV[fk2] = 1; }
      try { if (typeof tombAdd === 'function') tombAdd('fav', fk2); } catch (e) {}
      try { if (typeof saveFav === 'function') saveFav(); } catch (e) {}
      varqPaint(host, k);
    };
  }
  function varqBind(host, k) { varqPaint(host, k); }
  window.varqBind = varqBind;
  window.varqAdd = varqAdd;
  window.varqList = varqList;
  window.varqClear = varqClear;

  window.openVariant = openVariant;
  window.variantReopenFor = reopenFor;
  window.variantPanelOpen = function () { return !!(document.querySelector && document.querySelector('.vpanel')); };
  window.variantForget = forget;
  window.VARIANT = {
    open: openVariant, reopen: reopenFor, forget: forget,
    sim: simList, grams: grams, jac: jac, dirs: DIRS, state: V_LAST,
    run: run, save: saveBank, ask: askText, sys: sysText, dirText: dirText, simMin: SIM_MIN,
    saveBankFromQuestions: saveBankFromQuestions      /* 方案六「考点出题」也用它落地 */
  };
})();
