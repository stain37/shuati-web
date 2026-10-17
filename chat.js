/* ============================================================
   刷题站 · AI 对话 chat.js（#/chat）
   ————————————————————————————————————————————————
   能干什么：
     1) 选知识库 → 输入知识点 → 出题（自动按站内文本格式生成，能一键存题库 / 直接开做）
     2) 选知识库 → 问知识点（先用知识库检索，再让模型回答，答案下面列参考资料）
     3) 把题库 / 目录拖进来（主页入口卡片，或「⋯ → 💬 让 AI 分析这个题库/目录」）
        —— 带上你的作答记录，按你的要求总结易错点、薄弱知识点、复习建议
     4) 把题库文件、整个文件夹（.txt / .json / .md）拖进来：识别 → 分析 → 可一键导入题库
     5) 图片附件：按 OpenAI 兼容的 image_url 发出去，支持看图的模型能读；不支持会明确报错
   数据：对话记录存 qbank.chat.v1（最多 30 条，重开页面还在）；知识库勾选与 AI 面板共用。
   不依赖框架；页面重画不影响流式输出（chat 页面自己重画时按 LOG 重画）。
   ============================================================ */
(function () {
  'use strict';

  var LOG_KEY = 'qbank.chat.v1';
  var MAX_MSG = 30;            // 最多留多少条消息
  var MAX_CHARS = 20000;       // 单条消息最多存多少字
  var MODE_LABEL = { auto: '自动识别', qa: '问知识点', quiz: '出题', analyze: '分析题库' };

  var LOG = [];                // [{ role:'user'|'ai', text, mode, tag, refs:[{name,page}], acts:[{id,label}], quizTitle }]
  var PEND = [];               // 待发附件
  var RUN = null;              // 正在生成：{ ctl, msg, el }
  var MODE = 'auto';

  function $id(id) { return document.getElementById(id); }
  function E(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? (s.slice(0, n) + '…') : s; }
  function readLS(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function T(msg, ms, kind) { try { if (typeof toast === 'function') toast(msg, ms, kind); } catch (e) {} }

  /* ---------- 对话记录 ---------- */
  function loadLog() {
    var v = readLS(LOG_KEY, null);
    LOG = (v && Array.isArray(v.msgs)) ? v.msgs.filter(function (m) { return m && (m.role === 'user' || m.role === 'ai'); }).slice(-MAX_MSG) : [];
  }
  function saveLog() {
    var out = LOG.slice(-MAX_MSG).map(function (m) {
      return {
        role: m.role, text: clip(m.text || '', MAX_CHARS), mode: m.mode || '', tag: m.tag || '',
        refs: (m.refs || []).slice(0, 8), acts: (m.acts || []).slice(0, 4), quizTitle: m.quizTitle || '',
        at: m.at || Date.now()
      };
    });
    writeLS(LOG_KEY, { msgs: out, ts: Date.now() });
  }
  function pushMsg(m) { m.at = Date.now(); LOG.push(m); if (LOG.length > MAX_MSG) LOG = LOG.slice(-MAX_MSG); saveLog(); return m; }

  /* ---------- 附件 ---------- */
  function pendHtml() {
    if (!PEND.length) return '';
    return PEND.map(function (a, i) {
      var label = a.kind === 'bank' ? ('题库：' + (a.title || a.id))
        : a.kind === 'cat' ? ('目录：' + (a.title || a.id) + '（' + (a.n || '?') + ' 个题库）')
          : a.kind === 'file-bank' ? ('题库文件：' + a.title + '（' + a.questions.length + ' 题）')
            : a.kind === 'image' ? ('图片：' + a.name)
              : ('附件：' + a.name + '（' + (a.text || '').length + ' 字）');
      return '<span class="chat-att" data-i="' + i + '">' + E(label) + '<b data-x="' + i + '" title="移除">×</b></span>';
    }).join('');
  }
  function paintPend() {
    var box = $id('chatPend');
    if (!box) return;
    box.innerHTML = pendHtml();
    box.style.display = PEND.length ? '' : 'none';
    box.querySelectorAll('[data-x]').forEach(function (b) {
      b.onclick = function () { PEND.splice(+b.dataset.x, 1); paintPend(); };
    });
  }

  /* 解析一个题库文本：JSON 或站内纯文本格式都行 */
  function parseBankText(text, name) {
    if (typeof parseInput !== 'function') return null;
    var t = String(text || '').replace(/```[a-zA-Z]*\s*\n/g, '').replace(/```/g, '');
    try {
      var r = parseInput(t, name || '导入的题库');
      if (r && r.error) return null;
      var qs = (r && r.bank && r.bank.questions) || [];
      if (!qs.length) return null;
      return { title: (r.bank.title || name || '导入的题库').slice(0, 40), questions: qs };
    } catch (e) { return null; }
  }
  function attachFile(file) {
    return new Promise(function (resolve) {
      var name = file.name || '未命名';
      var isImg = /^image\//.test(file.type || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
      if (isImg) {
        if (file.size > 6 * 1024 * 1024) { T('图片太大（>6MB），换一张小点的', 2600, 'bad'); resolve(); return; }
        var fr = new FileReader();
        fr.onload = function () {
          PEND.push({ kind: 'image', name: name, dataUrl: String(fr.result || '') });
          paintPend(); resolve();
        };
        fr.onerror = function () { resolve(); };
        fr.readAsDataURL(file);
        return;
      }
      if (!/\.(txt|md|markdown|json|js|csv|text|log)$/i.test(name) && !/^text\//.test(file.type || '')) {
        T('这个文件类型先不支持：' + name, 2400, 'bad'); resolve(); return;
      }
      var fr2 = new FileReader();
      fr2.onload = function () {
        var text = String(fr2.result || '');
        var bank = parseBankText(text, name.replace(/\.[a-z0-9]+$/i, ''));
        if (bank) PEND.push({ kind: 'file-bank', title: bank.title, questions: bank.questions });
        else PEND.push({ kind: 'file-text', name: name, text: clip(text, 60000) });
        paintPend(); resolve();
      };
      fr2.onerror = function () { resolve(); };
      fr2.readAsText(file, 'utf-8');
    });
  }
  /* 整件事：拖进来的文件 / 文件夹（webkitGetAsEntry 递归） */
  function filesFromDrop(dt) {
    var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = [];
    items.forEach(function (it) {
      if (it.kind !== 'file') return;
      var en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (en) entries.push(en);
    });
    if (!entries.length) {
      return Promise.resolve(Array.prototype.slice.call((dt && dt.files) || []));
    }
    var out = [];
    var SKIP = /(^|[\/\\])(\.|__MACOSX|node_modules)/;
    function walk(entry, depth) {
      return new Promise(function (resolve) {
        if (!entry || depth > 6) { resolve(); return; }
        if (SKIP.test(entry.fullPath || '')) { resolve(); return; }
        if (entry.isFile) {
          entry.file(function (f) { out.push(f); resolve(); }, function () { resolve(); });
          return;
        }
        if (entry.isDirectory) {
          var rd = entry.createReader(), all = [];
          (function readBatch() {
            rd.readEntries(function (ents) {
              if (!ents.length) {
                Promise.all(all.map(function (e) { return walk(e, depth + 1); })).then(function () { resolve(); });
                return;
              }
              all = all.concat(Array.prototype.slice.call(ents));
              readBatch();
            }, function () { resolve(); });
          })();
          return;
        }
        resolve();
      });
    }
    return Promise.all(entries.map(function (en) { return walk(en, 0); })).then(function () {
      return out.filter(function (f) { return /\.(txt|md|markdown|json)$/i.test(f.name || ''); }).slice(0, 80);
    });
  }

  /* ---------- 知识库 / 题目数据 ---------- */
  function kbChipsHtml() {
    var list = (typeof kbList === 'function') ? kbList() : [];
    if (!list.length) return '<span class="small muted">还没有知识库（去 <a href="#/kb">AI 与知识库</a> 导入资料；不选也能用，只是纯靠模型知识）</span>';
    var sel = {};
    ((typeof kbSelected === 'function') ? kbSelected() : []).forEach(function (id) { sel[id] = 1; });
    var allOn = list.every(function (k) { return sel[k.id]; });
    var h = '<span class="aichip aichip-all' + (allOn ? ' on' : '') + '" data-kb="__all__" title="一键选定全部资料">总库 · 全部</span>';
    h += list.map(function (k) {
      return '<span class="aichip' + (sel[k.id] ? ' on' : '') + '" data-kb="' + E(k.id) + '" title="' + (k.chars || 0).toLocaleString() + ' 字">' + E(k.name) + '</span>';
    }).join('');
    return h;
  }
  function bindChips(root) {
    root.querySelectorAll('.chat-kb .aichip').forEach(function (ch) {
      ch.onclick = function () {
        var id = ch.dataset.kb;
        if (id === '__all__') {
          var list = (typeof kbList === 'function') ? kbList() : [];
          var sel = (typeof kbSelected === 'function') ? kbSelected() : [];
          var allOn = list.length && list.every(function (k) { return sel.indexOf(k.id) >= 0; });
          list.forEach(function (k) { if (typeof kbSetSel === 'function') kbSetSel(k.id, !allOn); });
        } else if (typeof kbSetSel === 'function') {
          var on = !((typeof kbSelected === 'function' ? kbSelected() : []).indexOf(id) >= 0);
          kbSetSel(id, on);
        }
        var box = root.querySelector('.chat-kb');
        if (box) { box.innerHTML = kbChipsHtml(); bindChips(root); }
      };
    });
  }
  function kbBlocks(text, topK) {
    return new Promise(function (resolve) {
      var ids = (typeof kbSelected === 'function') ? kbSelected() : [];
      if (!ids.length || typeof kbSearch !== 'function' || !String(text || '').trim()) { resolve({ text: '', hits: [] }); return; }
      var go = function () {
        try {
          Promise.resolve(kbSearch(String(text).slice(0, 240), ids, topK || 4)).then(function (hits) {
            hits = (typeof aiUniqHits === 'function') ? aiUniqHits(hits || []) : (hits || []);
            var maxChars = Math.max(1200, Math.min(8000, +((typeof aiCfg === 'function' ? aiCfg().maxChars : 0) || 3500)));
            var per = Math.max(400, Math.floor(maxChars / Math.max(1, hits.length)));
            var blocks = [], used = 0;
            hits.forEach(function (h) {
              var t = String(h.text || '').slice(0, per);
              if (used + t.length > maxChars && blocks.length) return;
              used += t.length;
              blocks.push('[' + (blocks.length + 1) + '] 《' + (h.doc || '资料') + (h.head ? ' · ' + h.head : '') + (h.page ? ' · 第' + h.page + '页' : '') + '》（知识库：' + (h.kb || '') + '）\n' + t);
            });
            resolve({ text: blocks.join('\n\n'), hits: hits.slice(0, blocks.length) });
          }, function () { resolve({ text: '', hits: [] }); });
        } catch (e) { resolve({ text: '', hits: [] }); }
      };
      if (typeof kbEnsureFilesLoaded === 'function') {
        try { kbEnsureFilesLoaded().then(go, go); } catch (e) { go(); }
      } else go();
    });
  }
  function hitRefs(hits) {
    return (hits || []).map(function (h) {
      var f = String(h.file || '').split(/[\\\/]/).pop();
      var name = (f || h.doc || '资料').replace(/\.[a-z0-9]+$/i, '').trim() || h.doc || '资料';
      return { name: clip(name, 40), page: h.page || '', head: clip(h.head || '', 30) };
    });
  }

  /* 题库 / 目录附件 → 分析用的一堆题（带作答记录） */
  function attsBrief(atts) {
    var sets = collectSets((atts || []).filter(function (a) { return a.kind === 'bank' || a.kind === 'cat' || a.kind === 'file-bank'; }));
    if (!sets.length) return '';
    var out = [];
    sets.slice(0, 4).forEach(function (s) {
      out.push('【附件题库】' + s.title + '（共 ' + (s.questions || []).length + ' 题）');
      (s.questions || []).slice(0, 12).forEach(function (q, i) {
        out.push((i + 1) + '. ' + clip(q.stem, 70) + '　答案：' + ((q.answer || []).join('') || '—'));
      });
    });
    return out.join('\n');
  }
  function collectSets(atts) {
    var sets = [];
    (atts || []).forEach(function (a) {
      if (a.kind === 'bank' || a.kind === 'cat') {
        var banks = [];
        if (a.kind === 'bank') {
          var b = (typeof bankById === 'function') ? bankById(a.id) : null;
          if (b && !b.paper) banks = [b];
        } else if (typeof CAT !== 'undefined' && CAT && CAT.all) {
          var ids = [a.id].concat(CAT.descIds ? CAT.descIds(a.id) : []);
          var all = (typeof baseBanks === 'function') ? baseBanks() : [];
          banks = all.filter(function (x) { return ids.indexOf(x.cat) >= 0; });
        }
        banks.forEach(function (b) {
          sets.push({ title: b.title, bankId: b.id, questions: b.questions || [] });
        });
      } else if (a.kind === 'file-bank') {
        sets.push({ title: a.title, bankId: '', questions: a.questions || [] });
      } else if (a.kind === 'file-text') {
        sets.push({ title: a.name, bankId: '', questions: [], text: a.text });
      }
    });
    return sets;
  }
  function recOf(bankId, q) {
    if (!bankId || typeof ANS === 'undefined') return null;
    var k = (typeof kOf === 'function') ? kOf({ id: bankId }, q) : '';
    return k ? (ANS[k] || null) : null;
  }
  function buildStats(sets) {
    var total = 0, answered = 0, ok = 0, wrongQs = [];
    var lines = [], tagHit = {};
    sets.forEach(function (s) {
      var done = 0, oks = 0, wr = 0;
      (s.questions || []).forEach(function (q, i) {
        total++;
        var rec = recOf(s.bankId, q, i);
        if (rec && !rec.redo) {
          done++; answered++;
          if (rec.ok) { oks++; ok++; } else wr++;
          if ((rec.wrong || 0) > 0) {
            wrongQs.push({
              t: s.title, q: q, wrong: rec.wrong || 0, tries: rec.tries || 0, sel: (rec.sel || []).join(''), ok: !!rec.ok
            });
          }
        }
        var tags = [];
        try { if (typeof tagsOf === 'function' && s.bankId) tags = tagsOf(((typeof kOf === 'function') ? kOf({ id: s.bankId }, q) : '')); } catch (e) {}
        tags.forEach(function (t) { tagHit[t] = (tagHit[t] || 0) + 1; });
      });
      lines.push('· 《' + s.title + '》：' + (s.questions || []).length + ' 题，做过的 ' + done + '，对 ' + oks + (wr ? '，错过 ' + wr + ' 题' : ''));
    });
    wrongQs.sort(function (a, b) { return b.wrong - a.wrong; });
    return { total: total, answered: answered, ok: ok, wrongQs: wrongQs, lines: lines, tagHit: tagHit };
  }
  function statsText(sets, promptWords) {
    var st = buildStats(sets);
    var out = [];
    out.push('【题库概况】共 ' + sets.length + ' 个题库 / ' + st.total + ' 题；我有作答记录的 ' + st.answered + ' 题（对 ' + st.ok + '）');
    out.push(st.lines.slice(0, 12).join('\n'));
    var tags = Object.keys(st.tagHit).sort(function (a, b) { return st.tagHit[b] - st.tagHit[a]; }).slice(0, 15);
    if (tags.length) out.push('【考点标签统计】' + tags.map(function (t) { return t + '(' + st.tagHit[t] + ')'; }).join('、'));
    var pick = st.wrongQs.filter(function (x) { return x.wrong > 0; }).slice(0, 40);
    var useAll = pick.length < 3;
    if (!pick.length) {
      /* 没有错题记录：挑前 20 题看看整体（说明一下） */
      var rough = [];
      sets.forEach(function (s) {
        (s.questions || []).slice(0, 20 - rough.length).forEach(function (q) {
          rough.push({ t: s.title, q: q, wrong: 0, tries: 0, sel: '' });
        });
      });
      pick = rough.slice(0, 20);
      out.push('【说明】我还没有错题记录（或这个题库没做过），下面按题库顺序抽了 ' + pick.length + ' 道题给你看整体质量。');
    }
    if (pick.length) {
      out.push('【' + (useAll ? '题目摘录' : '我最常错的题（按错次排序，最多 40 道）') + '】');
      pick.forEach(function (x, i) {
        var q = x.q || {};
        var ans = (q.answer || []).join('');
        out.push((i + 1) + '. [' + x.t + '] ' + clip(q.stem, 90)
          + '\n   答案：' + (ans || '—') + (x.sel ? '；我选 ' + x.sel : '')
          + (x.tries ? '（作答 ' + x.tries + ' 次 / 错 ' + x.wrong + ' 次）' : '')
          + (q.explain ? '\n   解析：' + clip(q.explain, 110) : ''));
      });
    }
    var extra = (promptWords || '').trim();
    if (extra) out.push('【我的要求】' + extra);
    return out.join('\n');
  }

  /* ---------- 意图识别（看清用户要干啥） ---------- */
  function guessMode(text, atts) {
    var t = String(text || '');
    var hasBank = (atts || []).some(function (a) { return a.kind === 'bank' || a.kind === 'cat' || a.kind === 'file-bank'; });
    var quiz = /出.{0,10}题|出题|生成.{0,10}题|来.{0,6}[0-9一二三四五六七八九十两]{1,3}\s*道|(出|给|来|弄).{0,8}[0-9一二三四五六七八九十两]{1,3}\s*道|考我|考考我|做题|组.{0,4}(套卷|卷子)|做.{0,3}(套卷|卷子)|做成.{0,6}题库|建.{0,6}题库/.test(t);
    var analyze = /分析|总结|归纳|梳理|易错|薄弱|错题|知识点|考点|统计|复习计划|复习建议/.test(t);
    if (quiz && !analyze) return 'quiz';
    if (analyze) return 'analyze';
    if (hasBank) return 'analyze';
    return 'qa';
  }

  /* ---------- 渲染页面 ---------- */
  function render() {
    var view = $id('view');
    if (!view) return;
    var appT = $id('appTitle');
    if (appT) appT.textContent = 'AI 对话';
    var cfg = (typeof aiCfg === 'function') ? aiCfg() : null;
    var model = cfg && cfg.model ? cfg.model : '';
    view.innerHTML =
      '<div class="chat-page">'
      + '<div class="card chat-head">'
      + '<div class="chat-title"><b>💬 AI 对话</b><span class="small muted">出题 / 答知识点 / 分析题库</span>'
      + '<span class="spacer-grow"></span>'
      + '<button class="btn tiny" id="chatClear" title="清空对话记录（不影响题库和作答）">清空对话</button></div>'
      + '<div class="chat-kb-row"><span class="tl small muted">用哪些资料</span><div class="chat-kb" id="chatKb">' + kbChipsHtml() + '</div></div>'
      + '<div class="chat-sub small muted">' + (model ? ('模型：' + E(model)) : '还没配 AI —— 先去 <a href="#/kb">AI 与知识库</a> 配一下') + '</div>'
      + '</div>'
      + '<div class="card chat-log" id="chatLog"></div>'
      + '<div class="chat-compose card" id="chatCompose">'
      + '<div class="chat-pend" id="chatPend" style="display:none"></div>'
      + '<textarea id="chatTa" rows="2" placeholder="输入知识点或问题…（Enter 发送，Shift+Enter 换行）&#10;例：给我出 5 道「心衰」的题 / 慢阻肺和哮喘怎么鉴别 / 分析这个题库的易错点"></textarea>'
      + '<div class="chat-tools">'
      + '<select class="num chat-mode" id="chatMode" title="自动识别：按你的话判断是问问题、出题还是分析题库">'
      + Object.keys(MODE_LABEL).map(function (m) { return '<option value="' + m + '"' + (MODE === m ? ' selected' : '') + '>' + MODE_LABEL[m] + '</option>'; }).join('')
      + '</select>'
      + '<button class="btn tiny" id="chatAttach" title="选文件：.txt / .json / .md，或图片">＋ 文件</button>'
      + '<input type="file" id="chatFile" multiple accept=".txt,.md,.markdown,.json,.js,.csv,image/*" style="display:none">'
      + '<button class="btn tiny" id="chatPickBank" title="从我的题库 / 目录里选一个放进来分析">选题库</button>'
      + '<span class="spacer-grow"></span>'
      + '<button class="btn tiny primary" id="chatSend">发送</button>'
      + '<button class="btn tiny" id="chatStop" style="display:none">停止</button>'
      + '</div>'
      + '<div class="small muted chat-hint">也可以把整文件夹 / 题库文件拖到这里；图片只有支持看图的模型能读。</div>'
      + '</div>'
      + '</div>';
    bindPage();
    paintLog();
    paintPend();
    if (RUN) { T('上一轮还在生成，等它写完或点「停止」', 2000); }
    var log = $id('chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function bindPage() {
    var view = $id('view');
    var chipsBox = view.querySelector('.chat-kb');
    if (chipsBox) bindChips(view);
    var send = $id('chatSend');
    if (send) send.onclick = doSend;
    var ta = $id('chatTa');
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); }
      });
    }
    var mode = $id('chatMode');
    if (mode) mode.onchange = function () { MODE = mode.value; };
    var clear = $id('chatClear');
    if (clear) clear.onclick = function () {
      if (!confirm('清空这段对话？只清聊天记录，题库 / 作答 / 收藏都不动。')) return;
      LOG = []; saveLog(); paintLog(); T('已清空对话');
    };
    var attach = $id('chatAttach');
    var file = $id('chatFile');
    if (attach && file) {
      attach.onclick = function () { file.click(); };
      file.onchange = function (e) {
        var fs = Array.prototype.slice.call(e.target.files || []);
        e.target.value = '';
        if (!fs.length) return;
        Promise.all(fs.map(attachFile)).then(function () { paintPend(); });
      };
    }
    var pick = $id('chatPickBank');
    if (pick) pick.onclick = pickBank;
    /* 知识库是懒加载的：加载完把顶部标签补上 */
    if (typeof kbEnsureFilesLoaded === 'function') {
      try {
        kbEnsureFilesLoaded().then(function () {
          var box = $id('chatKb');
          var root = $id('view');
          if (box && root) { box.innerHTML = kbChipsHtml(); bindChips(root); }
        }, function () {});
      } catch (e) {}
    }
    var stop = $id('chatStop');
    if (stop) stop.onclick = function () { if (RUN && RUN.ctl) { try { RUN.ctl.abort(); } catch (e) {} } };
    /* 整页拖拽 */
    var page = view.querySelector('.chat-page');
    if (page) {
      page.addEventListener('dragover', function (e) { if (e.dataTransfer && (e.dataTransfer.types || []).length) { e.preventDefault(); page.classList.add('chat-drag'); } });
      page.addEventListener('dragleave', function (e) { if (!page.contains(e.relatedTarget)) page.classList.remove('chat-drag'); });
      page.addEventListener('drop', function (e) {
        e.preventDefault();
        /* 拦住事件别再往外冒：bf.js 在 window 上有个全局 drop（拖 .txt 就跳去导入页）的便利，
           在对话页里会把我们接住的文件抢走 —— 对话页自己处理。 */
        e.stopPropagation();
        page.classList.remove('chat-drag');
        handleDrop(e.dataTransfer).then(function (n) { if (n) paintPend(); });
      });
    }
  }

  function pickBank() {
    if (!window.BFUI || !BFUI.pick) return;
    var items = [];
    var banks = (typeof baseBanks === 'function') ? baseBanks() : [];
    banks.forEach(function (b) { items.push({ value: 'b:' + b.id, label: '题库：' + b.title, note: b.questions.length + ' 题' }); });
    if (typeof CAT !== 'undefined' && CAT && CAT.all) {
      CAT.all().forEach(function (c) {
        var n = 0, q = 0;
        banks.forEach(function (b) { if (b.cat === c.id) { n++; q += b.questions.length; } });
        items.push({ value: 'c:' + c.id, label: '目录：' + (c.title || '未命名'), note: n + ' 个题库 / ' + q + ' 题（含子目录）' });
      });
    }
    if (!items.length) { T('本机还没有题库', 2000); return; }
    BFUI.pick({ title: '放一个题库 / 目录进来', desc: '选一个，AI 会带上你的作答记录分析易错点。', items: items.slice(0, 200) }).then(function (v) {
      if (!v) return;
      addInternal(v);
    });
  }
  function addInternal(v) {
    if (/^b:/.test(v)) {
      var b = (typeof bankById === 'function') ? bankById(v.slice(2)) : null;
      if (b) { PEND.push({ kind: 'bank', id: b.id, title: b.title }); paintPend(); }
    } else if (/^c:/.test(v)) {
      var cid = v.slice(2);
      var c = (typeof CAT !== 'undefined' && CAT && CAT.get) ? CAT.get(cid) : null;
      var n = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
      var ids = [cid].concat((typeof CAT !== 'undefined' && CAT && CAT.descIds) ? CAT.descIds(cid) : []);
      all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) n++; });
      if (c) { PEND.push({ kind: 'cat', id: cid, title: c.title || '目录', n: n }); paintPend(); }
    }
  }
  function handleDrop(dt) {
    var internal = '';
    try { internal = dt ? String(dt.getData('text/plain') || '') : ''; } catch (e) {}
    if (internal && !dt.files.length && typeof bankById === 'function') {
      var b = bankById(internal);
      if (b) { PEND.push({ kind: 'bank', id: b.id, title: b.title }); return Promise.resolve(1); }
      if (typeof CAT !== 'undefined' && CAT && CAT.get && CAT.get(internal)) {
        var c = CAT.get(internal);
        var n = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
        var ids = [internal].concat(CAT.descIds ? CAT.descIds(internal) : []);
        all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) n++; });
        PEND.push({ kind: 'cat', id: internal, title: c.title || '目录', n: n });
        return Promise.resolve(1);
      }
    }
    return filesFromDrop(dt).then(function (files) {
      if (!files || !files.length) { T('没认出文件（支持 .txt / .json / .md，或整文件夹）', 2600); return 0; }
      return Promise.all(files.map(attachFile)).then(function () {
        var nb = PEND.filter(function (a) { return a.kind === 'file-bank'; }).length;
        T('收到 ' + files.length + ' 个文件' + (nb ? ('，认出 ' + nb + ' 个题库') : ''), 2600);
        return files.length;
      });
    });
  }

  /* ---------- 画对话 ---------- */
  function msgHtml(m, i) {
    var isUser = m.role === 'user';
    var body = isUser ? E(m.text || '') : ((typeof mdToHtml === 'function') ? mdToHtml(m.text || '') : E(m.text || ''));
    var refs = (!isUser && m.refs && m.refs.length)
      ? '<div class="chat-refs small muted">参考资料：' + m.refs.map(function (r, j) {
        return '[' + (j + 1) + '] 《' + E(r.name) + '》' + (r.page ? ' 第 ' + r.page + ' 页' : '');
      }).join('　') + '</div>'
      : '';
    var acts = (!isUser && m.acts && m.acts.length)
      ? '<div class="chat-acts">' + m.acts.map(function (a) { return '<button class="btn tiny" data-act="' + E(a.id) + '" data-mi="' + i + '">' + E(a.label) + '</button>'; }).join('') + '</div>'
      : '';
    return '<div class="chat-msg ' + (isUser ? 'user' : 'ai') + '" data-mi="' + i + '">'
      + '<div class="chat-bubble">'
      + (isUser && m.tag ? '<div class="chat-tag small muted">' + E(m.tag) + '</div>' : '')
      + '<div class="chat-text">' + body + '</div>'
      + refs + acts
      + '</div></div>';
  }
  function paintLog() {
    var box = $id('chatLog');
    if (!box) return;
    if (!LOG.length) {
      box.innerHTML = '<div class="chat-empty">'
        + '<div class="ce-t">可以这样问：</div>'
        + '<div class="chat-eg" data-eg="给我出 5 道「心肌梗死」的题">给我出 5 道「心肌梗死」的题</div>'
        + '<div class="chat-eg" data-eg="慢阻肺和支气管哮喘怎么鉴别？">慢阻肺和支气管哮喘怎么鉴别？</div>'
        + '<div class="chat-eg" data-eg="把题库拖进来，让它分析我的易错点">把题库拖进来，让它分析我的易错点</div>'
        + '</div>';
      box.querySelectorAll('[data-eg]').forEach(function (el) {
        el.onclick = function () { var ta = $id('chatTa'); if (ta) { ta.value = el.dataset.eg; ta.focus(); } };
      });
      return;
    }
    box.innerHTML = LOG.map(msgHtml).join('');
    box.querySelectorAll('.chat-msg[data-mi]').forEach(function (el) {
      el.querySelectorAll('[data-act]').forEach(function (b) {
        b.onclick = function () { doAct(b.dataset.act, +b.dataset.mi); };
      });
    });
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- 发消息 ---------- */
  function doSend() {
    if (RUN) { T('上一轮还在生成，等它写完或点「停止」', 2000); return; }
    var ta = $id('chatTa');
    var text = ta ? ta.value.trim() : '';
    if (!text && !PEND.length) { if (ta) ta.focus(); return; }
    if (ta) ta.value = '';
    var atts = PEND.slice();
    PEND = [];
    paintPend();

    var mode = MODE;
    var guessed = mode === 'auto' ? guessMode(text, atts) : mode;
    var attLabel = [];
    atts.forEach(function (a) {
      if (a.kind === 'bank') attLabel.push('题库「' + a.title + '」');
      else if (a.kind === 'cat') attLabel.push('目录「' + a.title + '」（' + (a.n || '?') + ' 个题库）');
      else if (a.kind === 'file-bank') attLabel.push('题库文件「' + a.title + '」(' + a.questions.length + ' 题)');
      else if (a.kind === 'image') attLabel.push('图片「' + a.name + '」');
      else attLabel.push('附件「' + a.name + '」');
    });
    var shown = text + (attLabel.length ? ((text ? '\n' : '') + '📎 ' + attLabel.join('；')) : '');
    /* 附件里的题库文件缓存一份：回复里的「导入这 N 个题库」按钮要用 */
    MEM.__lastFileBanks = atts.filter(function (a) { return a.kind === 'file-bank'; }).map(function (a) { return { title: a.title, questions: a.questions }; });
    pushMsg({ role: 'user', text: shown, mode: guessed, tag: MODE_LABEL[guessed] + (mode === 'auto' ? '（自动识别）' : '') });

    var aiMsg = pushMsg({ role: 'ai', text: '', streaming: true });
    paintLog();
    var taEl = $id('chatTa');
    if (taEl) taEl.focus();

    RUN = { ctl: ('AbortController' in window) ? new AbortController() : null, msg: aiMsg };
    var stopBtn = $id('chatStop');
    if (stopBtn) stopBtn.style.display = '';
    var sendBtn = $id('chatSend');
    if (sendBtn) sendBtn.disabled = true;

    var done = function (err) {
      aiMsg.streaming = false;
      if (err) aiMsg.text = (aiMsg.text ? aiMsg.text + '\n\n' : '') + '⚠ ' + err;
      if (!aiMsg.text) aiMsg.text = '（没有内容：模型没返回东西）';
      saveLog();
      RUN = null;
      if ($id('chatStop')) $id('chatStop').style.display = 'none';
      if ($id('chatSend')) $id('chatSend').disabled = false;
      paintLog();
    };

    var p = (guessed === 'quiz') ? runQuiz(text, atts, aiMsg)
      : (guessed === 'analyze') ? runAnalyze(text, atts, aiMsg)
        : runQA(text, atts, aiMsg);
    p.then(function () { done(null); }, function (e) {
      var aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      if (aborted) { done('（已停止）'); return; }
      var info = (typeof aiErrInfo === 'function') ? aiErrInfo(e) : { msg: (e && e.message) || '出错', hint: '' };
      done(info.msg + (info.hint ? ('\n' + info.hint) : ''));
    });
  }

  function streamInto(msg, msgs, opts) {
    return new Promise(function (resolve, reject) {
      var mi = LOG.indexOf(msg);
      var onDelta = function (full) {
        msg.text = String(full || '');
        var box = document.querySelector('.chat-msg[data-mi="' + mi + '"] .chat-text');
        if (box) { box.textContent = msg.text; }
        var logEl = $id('chatLog');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
      };
      Promise.resolve(aiChat(msgs, onDelta, RUN && RUN.ctl ? RUN.ctl.signal : undefined, opts || {})).then(function (full) {
        msg.text = String(full || msg.text || '');
        resolve(msg.text);
      }, reject);
    });
  }

  function histMsgs(n) {
    var out = [];
    /* 去掉本轮刚 push 的用户消息 + AI 占位（它们在 msgs 里单独拼） */
    LOG.slice(0, Math.max(0, LOG.length - 2)).slice(-(n || 6)).forEach(function (m) {
      if (!m.text || m.streaming) return;
      if (m.role === 'user') out.push({ role: 'user', content: clip(m.text, 1500) });
      else if (m.role === 'ai' && m.text) out.push({ role: 'assistant', content: clip(m.text, 1800) });
    });
    return out;
  }

  function ensureAI() {
    var cfg = (typeof aiCfg === 'function') ? aiCfg() : null;
    if (!cfg || !cfg.model || !cfg.base) return '还没配 AI：去 <a href="#/kb">AI 与知识库</a> 选一个服务、填上模型和 Key（本地 Ollama 也行）。';
    if (typeof aiChat !== 'function') return 'AI 模块没加载。';
    return '';
  }

  /* 问答 */
  async function runQA(text, atts, msg) {
    var bad = ensureAI(); if (bad) { msg.text = bad; return; }
    msg.text = '正在检索知识库…';
    paintLog();
    var kb = await kbBlocks(text, (typeof aiCfg === 'function' ? aiCfg().topK : 4) || 4);
    msg.refs = hitRefs(kb.hits);
    var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是我的私人刷题助教。')
      + '\n\n【本次任务】回答我的问题（知识点 / 机制 / 对比 / 记忆法都行）。如果给了【参考资料】：优先用资料里的说法，并在句末标 [1] [2] 这样的编号；资料没覆盖的用自己的知识补充，但要注明「（模型补充）」。回答完给 2–4 条「记住这个」的要点。';
    var msgs = [{ role: 'system', content: sys }];
    histMsgs(6).forEach(function (m) { msgs.push(m); });
    var parts = [];
    if (kb.text) parts.push('【参考资料】\n' + kb.text);
    var extra = [];
    atts.forEach(function (a) {
      if (a.kind === 'file-text') extra.push('【附件 ' + a.name + '】\n' + clip(a.text, 12000));
    });
    if (extra.length) parts.push(extra.join('\n\n'));
    var brief = attsBrief(atts);
    if (brief) parts.push(brief);
    parts.push('【我的问题】' + (text || '（见附件）'));
    var imgs = atts.filter(function (a) { return a.kind === 'image'; }).slice(0, 3);
    if (imgs.length) {
      msgs.push({
        role: 'user', content: [{ type: 'text', text: parts.join('\n\n') }].concat(imgs.map(function (a) {
          return { type: 'image_url', image_url: { url: a.dataUrl } };
        }))
      });
    } else {
      msgs.push({ role: 'user', content: parts.join('\n\n') });
    }
    msg.text = '';
    paintLog();
    await streamInto(msg, msgs, {});
  }

  /* 出题 */
  async function runQuiz(text, atts, msg) {
    var bad = ensureAI(); if (bad) { msg.text = bad; return; }
    msg.text = '正在按知识点出题…';
    paintLog();
    var cfg = (typeof aiCfg === 'function') ? aiCfg() : {};
    var kb = await kbBlocks(text, Math.min(6, (+cfg.topK || 4) + 1));
    msg.refs = hitRefs(kb.hits);
    var num = 6;
    var mm = String(text).match(/([0-9一二三四五六七八九十两]{1,3})\s*道/);
    if (mm) {
      var n = mm[1];
      var zh = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
      num = /^\d+$/.test(n) ? +n : (zh[n] || 5);
    }
    num = Math.max(2, Math.min(15, num));
    var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是一位命题老师。')
      + '\n\n【本次任务】你是命题老师，根据我给的知识点 / 要求出 ' + num + ' 道单选题或多选题。'
      + '\n要求：1) 题目要贴合考试（题干情景化、四个选项都要有干扰性）；2) 每题给正确答案和简短解析（解析里点出考点）；'
      + '\n3) 严格按站内的纯文本题库格式输出，不要写表格、不要代码块、不要额外解释：'
      + '\n# 题库名（自己起一个）\n\n1. 题干…\nA. …\nB. …\nC. …\nD. …\n答案：X\n解析：…'
      + '\n4) 多选答案连写（如 ABD）；题与题之间空一行。';
    var msgs = [{ role: 'system', content: sys }];
    histMsgs(2).forEach(function (m) { msgs.push(m); });
    var body = [];
    if (kb.text) body.push('【参考资料】\n' + kb.text);
    atts.forEach(function (a) {
      if (a.kind === 'file-text') body.push('【附件 ' + a.name + '】\n' + clip(a.text, 8000));
      if (a.kind === 'file-bank') body.push('【附件题库 ' + a.title + '】参考它的出题风格，共 ' + a.questions.length + ' 题。');
    });
    body.push('【知识点 / 要求】' + (text || '出一道覆盖上述资料的题'));
    body.push('【题数】' + num);
    msgs.push({ role: 'user', content: body.join('\n\n') });
    msg.text = '';
    paintLog();
    await streamInto(msg, msgs, {});
    /* 解析成题目 */
    var raw = String(msg.text || '').replace(/```[a-zA-Z]*\s*\n/g, '').replace(/```/g, '');
    var parsed = parseBankText(raw, 'AI 出题');
    if (parsed && parsed.questions.length) {
      msg.quizTitle = parsed.title;
      msg.acts = [
        { id: 'quiz-save-start', label: '存成新题库并开始做（' + parsed.questions.length + ' 题）' },
        { id: 'quiz-save', label: '只存题库' },
        { id: 'copy', label: '复制原文' }
      ];
      msg.text = raw;
      T('出好了 ' + parsed.questions.length + ' 道题', 1800);
    } else {
      msg.acts = [{ id: 'copy', label: '复制原文' }];
      msg.text = raw + '\n\n（这版没解析成题目：可以点「复制原文」自己改，或者把模式切到「问知识点」让我重讲。）';
    }
    paintLog();
  }

  /* 分析题库 */
  async function runAnalyze(text, atts, msg) {
    var sets = collectSets(atts);
    if (!sets.length) {
      /* 没附件：分析「我的错题」——按题库全量统计 */
      var all = (typeof baseBanks === 'function') ? baseBanks() : [];
      sets = all.map(function (b) { return { title: b.title, bankId: b.id, questions: b.questions || [] }; });
      if (!sets.length) { msg.text = '还没有题库可以分析：先导入题库，或者把题库文件拖进来。'; return; }
    }
    var data = statsText(sets, text);
    var imgs = atts.filter(function (a) { return a.kind === 'image'; }).slice(0, 2);
    var bad = ensureAI();
    if (bad) { msg.text = bad + '\n\n下面是本机算好的统计（可以先看）：\n' + data; return; }
    var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是我的刷题助教。')
      + '\n\n【本次任务】根据我给的题库数据（含作答记录）和我的要求，帮我：'
      + '\n1) 总结我最容易错的知识点 / 题型（引用题号或题干片段佐证）；'
      + '\n2) 逐个说清这些点为什么容易错、正确思路是什么（能对比就给对比表）；'
      + '\n3) 给一份可执行的复习清单（先补什么、再练什么，控制在 5 条内）。'
      + '\n不要编造数据里没有的记录；数据不足就直说。';
    var msgs = [{ role: 'system', content: sys }];
    histMsgs(4).forEach(function (m) { msgs.push(m); });
    if (imgs.length) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: data }].concat(imgs.map(function (a) { return { type: 'image_url', image_url: { url: a.dataUrl } }; })) });
    } else {
      msgs.push({ role: 'user', content: data });
    }
    msg.text = '';
    paintLog();
    await streamInto(msg, msgs, {});
    /* 如果附件里有解析出来的题库文件，给一个「导入」按钮 */
    var files = atts.filter(function (a) { return a.kind === 'file-bank'; });
    if (files.length) {
      msg.acts = (msg.acts || []).concat([{ id: 'import-files', label: '把这 ' + files.length + ' 个题库导入到我的题库' }]);
    }
    paintLog();
  }

  /* ---------- 消息上的按钮 ---------- */
  function doAct(act, mi) {
    var msg = LOG[mi];
    if (!msg) return;
    if (act === 'copy') {
      var t = document.createElement('textarea');
      t.value = msg.text || ''; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); T('已复制'); } catch (e) { T('复制失败，手动选中吧'); }
      t.remove();
      return;
    }
    if (act === 'quiz-save' || act === 'quiz-save-start') {
      var parsed = parseBankText(String(msg.text || ''), msg.quizTitle || 'AI 出题');
      if (!parsed || !parsed.questions.length) { T('这次的内容没解析成题目', 2400, 'bad'); return; }
      if (!window.VARIANT || !VARIANT.saveBankFromQuestions) { T('存题库模块没加载（variant.js）', 2400, 'bad'); return; }
      var id = VARIANT.saveBankFromQuestions(parsed.title || 'AI 出题', parsed.questions, { subtitle: '自建题库 · AI 对话出题 · ' + parsed.questions.length + ' 题' });
      if (!id) return;
      pushMsg({ role: 'ai', text: '已存成新题库：**' + (parsed.title || 'AI 出题') + '**（' + parsed.questions.length + ' 题）。' + (act === 'quiz-save-start' ? '' : '可以在首页「全部题库」里找到它。') });
      paintLog();
      if (act === 'quiz-save-start') { try { if (typeof startBank === 'function') startBank(id); } catch (e) {} }
      return;
    }
    if (act === 'import-files') {
      /* 把对话里附件解析出来的题库导入（从最后一条带附件摘要的用户消息里找不行——附件本身没存进 LOG）。
         换个稳妥办法：重新从消息文本里找？不行。所以这里直接不可用 —— 改成提示用「选题库 / 拖文件」后立刻导入。
         真正实现：把文件题库缓存到内存里，点按钮时用。 */
      var cache = a('__lastFileBanks');
      if (!cache || !cache.length) { T('这轮附件的题库已经不在了，重新拖一次文件吧', 2600, 'bad'); return; }
      var n = 0;
      cache.forEach(function (b) {
        var id = VARIANT && VARIANT.saveBankFromQuestions ? VARIANT.saveBankFromQuestions(b.title, b.questions, { subtitle: '自建题库 · 从文件导入 · ' + b.questions.length + ' 题' }) : '';
        if (id) n++;
      });
      T(n ? ('已导入 ' + n + ' 个题库') : '导入失败', 2600);
      if (n) pushMsg({ role: 'ai', text: '已把 ' + n + ' 个题库存进你的题库列表，可以回首页开始做。' });
      paintLog();
    }
  }
  /* 会话内的临时缓存（附件题库，用于「导入」按钮） */
  var MEM = {};
  function a(k) { return MEM[k]; }

  /* ---------- 主页入口：拖题库/文件夹上去 → 带去对话 ---------- */
  var DRAG_PEND = null;
  function bindHomeEntry() {
    if (bindHomeEntry._done) return;
    bindHomeEntry._done = true;
    /* 捕获阶段拦：别让 cat.js 的「拖到空白 = 移到当前目录」也接一手 */
    document.addEventListener('dragover', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('#chatEntry') : null;
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.add('chat-entry-hot');
    }, true);
    document.addEventListener('dragleave', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('#chatEntry') : null;
      if (card) card.classList.remove('chat-entry-hot');
    }, true);
    document.addEventListener('drop', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('#chatEntry') : null;
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('chat-entry-hot');
      var dt = e.dataTransfer;
      var internal = '';
      try { internal = String(dt.getData('text/plain') || ''); } catch (err) {}
      /* 批量模式里拖一个已选中的：把选中的一批都带进去 */
      try {
        var batch = (typeof CAT !== 'undefined' && CAT && CAT.batch) ? CAT.batch() : null;
        if (internal && batch && batch.n > 1 && batch.ids.indexOf(internal) >= 0) {
          batch.ids.forEach(function (bid) {
            var bb = (typeof bankById === 'function') ? bankById(bid) : null;
            if (bb) PEND.push({ kind: 'bank', id: bb.id, title: bb.title });
          });
          goChat();
          return;
        }
      } catch (err) {}
      if (internal && typeof bankById === 'function' && bankById(internal)) {
        var b = bankById(internal);
        PEND.push({ kind: 'bank', id: b.id, title: b.title });
        goChat();
        return;
      }
      if (internal && typeof CAT !== 'undefined' && CAT && CAT.get && CAT.get(internal)) {
        var c = CAT.get(internal);
        var n = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
        var ids = [internal].concat(CAT.descIds ? CAT.descIds(internal) : []);
        all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) n++; });
        PEND.push({ kind: 'cat', id: internal, title: c.title || '目录', n: n });
        goChat();
        return;
      }
      handleDrop(dt).then(function () { goChat(); });
    }, true);
  }
  function goChat() {
    if (location.hash === '#/chat') render();
    else location.hash = '#/chat';
    setTimeout(function () { try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }, 120);
  }

  /* ---------- 外部接口 ---------- */
  window.CHAT = {
    render: render,
    openWith: function (v) {
      if (v) addInternal(v);
      goChat();
    },
    openBank: function (id) { if (id) { addInternal('b:' + id); goChat(); } },
    openCat: function (id) { if (id) { addInternal('c:' + id); goChat(); } },
    log: function () { return LOG.slice(); },
    clear: function () { LOG = []; saveLog(); }
  };

  loadLog();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindHomeEntry);
  else bindHomeEntry();
})();
