/* search.js — 全局笔记搜索（悬浮窗 + Ctrl/Cmd+K + Notion 式预览） */
(function () {
  'use strict';
  var ITEMS = [], READY = false, LOADING = null;
  /* 第一层：模块（来源大类）。「全部」不挂二级筛选，结果按来源折叠汇总。 */
  var MODULES = ['全部', '题目', '讲义', '西综', '狂背', '我的笔记'];
  var CUR_MOD = '全部';
  var CUR_SUB = '全部';              /* 二级：科目（题目 / 讲义 各一套） */
  var QSUBJ = ['全部', '内科', '外科', '病理', '生理', '生化', '政治', '人文', '其他'];
  var LSUBJ = ['全部', '内科', '外科', '生理', '生化', '病理', '其他'];
  /* 题目二级：搜题文字的范围：题干 / 选项 / 解析 / 全部 */
  var QSCOPE = 'all';
  var MODE_CHIPS = [['all', '全部'], ['stem', '题干'], ['opts', '选项'], ['exp', '解析']];
  var AIF = false;                    /* ✨ AI 模糊相似度（把本地前 30 条交给模型重排） */
  var QSEEN = {}, QREADY = false, Q_SIG = '', AI_TOKEN = 0;

  /* ---------- 数据 ---------- */
  function subjectOf(s) {
    var t = String(s || '');
    if (/内科/.test(t)) return '内科';
    if (/外科/.test(t)) return '外科';
    if (/病理/.test(t)) return '病理';
    if (/生理/.test(t)) return '生理';
    if (/生化|生物化学/.test(t)) return '生化';
    if (/政治|马原|毛中特|史纲|思修|习思想/.test(t)) return '政治';
    if (/人文|伦理|心理|卫生法/.test(t)) return '人文';
    return '其他';
  }

  function niceName(raw) {
    var s = String(raw || '');
    for (var i = 0; i < 3; i++) {
      try { var d = decodeURIComponent(s); if (d === s) break; s = d; } catch (e) { break; }
    }
    s = s.replace(/^#\/?(tag|bank)?\/?/, '').replace(/^tg[:%]?3?A?/i, '');
    try { s = decodeURIComponent(s); } catch (e2) {}
    return s || raw;
  }

  function pushNoteItems() {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k) continue;
      var md = localStorage.getItem(k) || '';
      if (k.indexOf('kbdoc.tag.') === 0) {
        var tag = k.slice(10);
        if (!md.trim()) continue;
        ITEMS.push({ id: 'note:' + k, t: niceName(tag), s: '我的笔记', g: '知识点笔记', x: md, src: '我的笔记', kind: 'tag', key: k, tagId: tag });
      } else if (k.indexOf('kbdoc.doc.') === 0) {
        var title = k.slice(10);
        ITEMS.push({ id: 'note:' + k, t: title, s: '我的笔记', g: '自由笔记', x: md, src: '我的笔记', kind: 'doc', key: k, tagId: '' });
      }
    }
  }

  function loadKuangs() {
    var inline = window.__KBACK;
    if (inline && inline.items && inline.items.length) {
      inline.items.forEach(function (it, i) {
        ITEMS.push({
          id: 'kback:' + i, t: it.chapter, s: '狂背', g: it.subject || '',
          x: it.text || '', src: '狂背', kind: 'kuangbei',
          page: (it.p0 && it.p1) ? ('原书第 ' + it.p0 + '–' + it.p1 + ' 页') : '',
          p0: it.p0 || 0, p1: it.p1 || 0
        });
      });
      return Promise.resolve();
    }
    return fetch('资料/狂背/索引.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (idx) {
        var list = Array.isArray(idx) ? idx : (idx.items || idx.list || []);
        return Promise.all(list.map(function (it) {
          var f = String(it.file || '').replace(/\\/g, '/');
          return fetch(f, { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (txt) {
              if (!txt) return null;
              return {
                id: 'kb:' + f, t: it.chapter || f.replace(/\.md$/, ''),
                s: subjectOf(it.subject || f), g: it.subject || '', x: txt, src: '狂背',
                page: (it.pageStart && it.pageEnd) ? ('原书第 ' + it.pageStart + '–' + it.pageEnd + ' 页') : ''
              };
            });
        }));
      })
      .then(function (arr) { arr.forEach(function (x) { if (x) ITEMS.push(x); }); })
      .catch(function () {});
  }

  /* 资料库（知识库）里的正文也能搜：库是分片（kb/m*.js）懒加载的，谁先加载进来就收谁。
     西综合集那份（kb/m9.js，830KB）在这里单独按需拉一次——不挡开窗，
     到了之后 run() 自动把结果补上。 */
  var KBD_SEEN = {};
  function loadKbDocs() {
    var kbs = window.__KBS__ || [];
    kbs.forEach(function (bank) {
      var bid = String(bank.id || bank.name || '');
      var bn0 = String(bank.name || '');
      if (bn0 === '狂背') return;                 /* 狂背走 __KBACK */
      if (/^(内科|外科|生化|生理|病理)$/.test(bn0)) return;  /* 这几个库的正文已经按页从 pdftext 进来了，别重复 */
      (bank.docs || []).forEach(function (d, i) {
        if (!d || !d.text) return;
        var id = 'kbd:' + bid + ':' + i;
        if (KBD_SEEN[id]) return;
        KBD_SEEN[id] = 1;
        var lect = !!d.imgKey;              /* 有页图 key = 这份是「讲义」的那一页 */
        ITEMS.push({
          id: id, t: d.name || ('文档' + i),
          s: lect ? '西综' : '其他',
          g: bank.name || '', x: d.text,
          src: lect ? '西综' : '资料库',
          kind: lect ? 'lecture' : '', xz: lect ? 1 : 0,
          pg: d.page || 0, pages: d.pages || 0,
          file: d.file || '', img: d.imgKey || ''
        });
      });
    });
  }
  var SHARD_JOB = null;
  function loadKbShard() {
    if (window.__KBS__ && window.__KBS__.length && KBD_SEEN['kbd:file-xzong:0']) return Promise.resolve();
    if (SHARD_JOB) return SHARD_JOB;
    SHARD_JOB = new Promise(function (resolve) {
      if (window.__XZ_LOADED__) return resolve();
      var sc = document.createElement('script');
      sc.src = 'kb/m9.js?v=20261118a';
      sc.onload = function () { window.__XZ_LOADED__ = 1; resolve(); };
      sc.onerror = function () { resolve(); };
      document.head.appendChild(sc);
    });
    return SHARD_JOB;
  }

  /* ---------- 讲义 PDF 文字（「讲义」模块） ----------
     讲义正文在 pdftext/t*.json 里，由 lec3.js 按科目分块下载（第一次慢，之后进 IndexedDB 缓存）。
     这里按科目一块一块取，每块到了就补进索引并重跑一次：结果边下边出，不是空列表。 */
  var LEC_SUBJ = ['内科', '外科', '生理', '生化', '病理', '肖190知识点'];
  var LEC_SEEN = {};
  var LEC_STATE = { on: false, done: 0, total: 0, err: '' };
  var LEC_JOBS = {};

  /* 一行 pdftext（{k,p,src,f,t}）→ 一条可搜的讲义页 */
  function lecAdd(r, subj) {
    if (!r || !r.t) return;
    var src = String(r.src || '');
    if (src.indexOf('27狂背西综合集') >= 0) return;   /* 这份归「西综」模块，不重复 */
    var id = 'lec:' + (r.k || (src + '#' + r.p));
    if (LEC_SEEN[id]) return;
    LEC_SEEN[id] = 1;
    var name = String(r.f || src.split('/').pop() || '').replace(/\.pdf$/i, '');
    var ss = (subj === '肖190知识点') ? '其他' : (subj || '其他');
    ITEMS.push({
      id: id, t: name, s: ss, g: ss,
      x: r.t, src: '讲义', kind: 'lecture', xz: 0,
      file: src, pg: r.p | 0, pages: 0, img: r.k || ''
    });
  }

  function ensureLecSubj(subj) {
    if (!window.LECTURE || !LECTURE.textSubj) return Promise.resolve();
    var key = subj || '__all__';
    if (LEC_JOBS[key]) return LEC_JOBS[key];
    LEC_STATE.on = true;
    LEC_JOBS[key] = LECTURE.textSubj(subj).then(function (rows) {
      (rows || []).forEach(function (r) { lecAdd(r, subj); });
      LEC_STATE.done++;
      try { run(); } catch (e) {}
    }).catch(function (e) {
      LEC_STATE.err = String((e && e.message) || e || '');
    });
    return LEC_JOBS[key];
  }

  /* 选了具体科目只下那一个；「全部」按 内科 → 外科 → 生理 → 生化 → 病理 依次补 */
  function ensureLec() {
    if (!window.LECTURE || !LECTURE.textSubj) return;
    var subs = (CUR_SUB && CUR_SUB !== '全部') ? [CUR_SUB] : LEC_SUBJ.slice();
    subs = subs.map(function (x) { return x === '其他' ? '肖190知识点' : x; })
               .filter(function (x) { return x; });
    if (!subs.length) return;
    if (!LEC_STATE.on) { LEC_STATE.on = true; LEC_STATE.total = subs.length; }
    var ch = Promise.resolve();
    subs.forEach(function (x) { ch = ch.then(function () { return ensureLecSubj(x); }); });
  }
  function lecBusy() { return LEC_STATE.on && LEC_STATE.done < LEC_STATE.total; }
  function lecHintText() {
    if (!lecBusy()) return '';
    return '讲义文字还在下载（已完成 ' + LEC_STATE.done + ' / ' + LEC_STATE.total + ' 个科目），到了会自动补上…';
  }
  function lecHintEl() {
    var t = lecHintText();
    return t ? el('div', 'gsLoad', t) : null;
  }

  /* ---------- 题目（自建 + 内置题库里的题干/选项/解析） ----------
     题库是 app.js 的 baseBanks()（IndexedDB + 内置）；这里只做一层「能搜」的索引，
     正文分三段存（_stem/_opts/_exp），搜索时按 QSCOPE 取其中一段或全部。 */
  /* 题库签名：自建题库是 IndexedDB 异步读进来的，第一次打开搜索时可能还没到；
     所以每次打开都比一次签名，变了就重建题目索引（否则「题目」永远搜不到）。 */
  function bankSig() {
    var bs = [];
    try { bs = (typeof baseBanks === 'function') ? baseBanks() : (window.__BANKS__ || []); }
    catch (e) { bs = []; }
    return (bs || []).map(function (b) { return (b && b.id) + ':' + ((b && b.questions) ? b.questions.length : 0); }).join('|');
  }
  function loadQuestions() {
    var sig = bankSig();
    if (QREADY && sig === Q_SIG) return;
    QREADY = true; Q_SIG = sig;
    /* 重建：先把旧的题目条目摘掉，再重新扫一遍 */
    for (var z = ITEMS.length - 1; z >= 0; z--) { if (ITEMS[z] && ITEMS[z].kind === 'q') ITEMS.splice(z, 1); }
    QSEEN = {};
    var banks = [];
    try { banks = (typeof baseBanks === 'function') ? baseBanks() : (window.__BANKS__ || []); }
    catch (e) { banks = []; }
    (banks || []).forEach(function (b) {
      if (!b || !b.questions) return;
      for (var i = 0; i < b.questions.length; i++) {
        var q = b.questions[i];
        if (!q) continue;
        var qid = (q.id == null ? i : q.id);
        var id = 'q:' + b.id + ':' + qid;
        if (QSEEN[id]) continue;
        QSEEN[id] = 1;
        var stem = String(q.stem || q.title || q.q || q.name || '').replace(/\s+/g, ' ').trim();
        if (!stem) continue;
        var opts = (q.options || []).map(function (o, k) {
          var kk = (o && (o.k || o.key)) || 'ABCDEFGH'[k];
          var tt = '';
          if (o && typeof o === 'object') tt = (o.t != null ? o.t : (o.text != null ? o.text : (o.title != null ? o.title : '')));
          else tt = (o == null ? '' : o);
          return String(kk) + '. ' + String(tt).replace(/\s+/g, ' ').trim();
        }).join('\n');
        var exp = String(q.explain || q.exp || q.analysis || '').replace(/\s+/g, ' ').trim();
        var ans = q.answer || q.ans || q.correct || '';
        if (Array.isArray(ans)) ans = ans.join('');
        ITEMS.push({
          id: id, t: stem.slice(0, 60), s: subjectOf(b.title || b.id), g: b.title || '',
          x: '', src: '题目', kind: 'q', bank: b.id, qid: qid, no: i + 1,
          _stem: stem, _opts: opts, _exp: exp, _ans: String(ans || '')
        });
      }
    });
  }
  /* 按当前范围取这条要参与匹配/摘要的文字 */
  function qText(it) {
    if (!it || it.kind !== 'q') return it ? it.x : '';
    if (QSCOPE === 'stem') return it._stem;
    if (QSCOPE === 'opts') return it._opts;
    if (QSCOPE === 'exp') return it._exp;
    if (it._xall == null || it._xallScope !== QSCOPE) {
      it._xall = (it._stem || '') + '\n' + (it._opts || '') + '\n' + (it._exp || '');
      it._xallScope = QSCOPE;
    }
    return it._xall;
  }

  function ensureData() {
    if (READY) return Promise.resolve();
    if (LOADING) return LOADING;
    LOADING = loadKuangs().then(function () {
      loadKbDocs();
      pushNoteItems();
      loadQuestions();
      READY = true;
      /* 西综分片在后台到（830KB），到了补进结果，不耽误开窗 */
      loadKbShard().then(function () { loadKbDocs(); try { run(); } catch (e) {} });
    });
    return LOADING;
  }

  /* ---------- 相似度 ---------- */
  function bigrams(s) {
    var m = {};
    for (var i = 0; i < s.length - 1; i++) { var g = s.substr(i, 2); m[g] = (m[g] || 0) + 1; }
    return m;
  }
  function sim(a, b) {
    if (!a || !b) return 0;
    var A = bigrams(a), B = bigrams(b), inter = 0, n = 0;
    for (var k in A) { if (B[k]) inter += Math.min(A[k], B[k]); n += A[k]; }
    for (var k2 in B) n += 0;
    return n ? inter / n : 0;
  }
  function score(item, q, ql) {
    var t = item.t.toLowerCase(), x = String(qText(item) || '').toLowerCase();
    var s = 0;
    if (t.indexOf(ql) >= 0) s += 80;
    var idx = x.indexOf(ql);
    if (idx >= 0) s += 40;
    var cnt = 0, pos = 0;
    while (cnt < 5) { var p = x.indexOf(ql, pos); if (p < 0) break; cnt++; pos = p + ql.length; }
    s += cnt * 6;
    if (q.length >= 2) s += sim(ql, x.substr(Math.max(0, idx), 200)) * 25;
    return s;
  }
  function snippet(item, ql, n) {
    var x = String(qText(item) || ''), i = x.toLowerCase().indexOf(ql);
    if (i < 0) i = 0;
    var a = Math.max(0, i - Math.floor(n / 3)), b = Math.min(x.length, a + n);
    var s = x.slice(a, b).replace(/\s+/g, ' ');
    return (a > 0 ? '…' : '') + s + (b < x.length ? '…' : '');
  }

  /* ---------- UI ---------- */
  var CSS = [
    '#gsBtn{position:fixed;right:22px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:20000;width:60px;height:60px;border-radius:50%;border:1px solid var(--line,rgba(148,163,184,.35));background:var(--card,#fff);color:var(--text,#0f172a);box-shadow:0 10px 30px rgba(15,23,42,.22);cursor:grab;font-size:26px;touch-action:none;user-select:none;display:flex;align-items:center;justify-content:center}',
    '#gsWrap{position:fixed;inset:0;z-index:20010;display:none;background:rgba(15,23,42,.35);backdrop-filter:blur(3px)}',
    '#gsWrap.on{display:block}',
    '#gsBox{position:absolute;left:50%;top:12vh;transform:translateX(-50%);width:min(720px,92vw);max-height:70vh;background:var(--card,#fff);color:var(--text,#0f172a);border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;font:14px/1.6 system-ui,"PingFang SC","Microsoft YaHei"}',
    '#gsIn{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line,#eef2f7)}',
    '#gsQ{flex:1;border:0;outline:0;font-size:16px;background:transparent;color:inherit}',
    '#gsSub{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#f1f5f9)}',
    '#gsMode{display:block;padding:8px 14px;border-bottom:1px solid var(--line,#f1f5f9)}',
    '#gsMode .gsmr{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:3px 0}',
    '#gsMode .gslbl{font-size:11px;color:color-mix(in srgb,var(--text,#0f172a) 45%,transparent);margin-right:2px}',
    '#gsSub span,#gsMode span{padding:4px 10px;border-radius:999px;background:color-mix(in srgb,var(--text,#0f172a) 8%,transparent);color:var(--text,#475569);cursor:pointer;font-size:12px}',
    '#gsSub span.on{background:var(--primary,#2563eb);color:#fff}',
    '#gsMode span.on{background:var(--primary,#2563eb);color:#fff}',
    '#gsMode span.ai{background:color-mix(in srgb,var(--primary,#2563eb) 16%,transparent);color:var(--primary,#2563eb);font-weight:600}',
    '#gsMode span.ai.on{background:var(--primary,#2563eb);color:#fff}',
    '#gsItem .gsim{font-style:normal;font-size:11px;margin-left:6px;padding:1px 5px;border-radius:6px;background:color-mix(in srgb,var(--primary,#2563eb) 14%,transparent);color:var(--primary,#2563eb)}',
    '#gsList details.gsGrp{border-bottom:1px solid var(--line,#f1f5f9);padding:1px 0}',
    '#gsList details.gsGrp>summary{cursor:pointer;padding:9px 12px;font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px;list-style:none}',
    '#gsList details.gsGrp>summary::-webkit-details-marker{display:none}',
    '#gsList details.gsGrp>summary .gn{font-weight:400;font-size:12px;color:color-mix(in srgb,var(--text,#0f172a) 55%,transparent)}',
    '#gsList details.gsGrp>summary .gt{margin-left:auto;font-weight:400;font-size:11px;color:color-mix(in srgb,var(--text,#0f172a) 45%,transparent)}',
    '#gsMode i{font-style:normal;color:color-mix(in srgb,var(--text,#0f172a) 45%,transparent);font-size:11px;margin-left:2px}',
    '#gsMode .sp{flex:1}',
    '#gsList{overflow:auto;padding:6px}',
    '.gsItem{padding:10px 12px;border-radius:10px;cursor:pointer}', '.gsItem:hover{background:color-mix(in srgb,var(--primary,#2563eb) 10%,transparent)}',
    '.gsItem b{font-weight:600}', '.gsItem i{font-style:normal;color:color-mix(in srgb,var(--text,#0f172a) 55%,transparent);font-size:12px;margin-left:6px}',
    '.gsItem p{margin:4px 0 0;color:color-mix(in srgb,var(--text,#0f172a) 62%,transparent);font-size:12px;line-height:1.5}',
    '.gsLoad{margin:10px 2px;padding:8px 10px;border-radius:10px;font-size:12.5px;color:color-mix(in srgb,var(--text,#0f172a) 62%,transparent);background:color-mix(in srgb,var(--primary,#2f6fed) 8%,transparent)}',
    '#gsEmpty{padding:24px;text-align:center;color:#94a3b8}',
    '#gsPeek{position:fixed;inset:0;z-index:20020;display:none;background:rgba(15,23,42,.45)}',
    '#gsPeek.on{display:block}',
    '#gsCard{position:absolute;left:50%;top:6vh;transform:translateX(-50%);width:min(820px,94vw);height:84vh;background:var(--card,#fff);color:var(--text,#0f172a);border-radius:18px;box-shadow:0 30px 90px rgba(15,23,42,.3);display:flex;flex-direction:column;overflow:hidden}',
    '#gsCard h3{margin:0;padding:16px 20px;border-bottom:1px solid var(--line,#eef2f7);font-size:16px;display:flex;align-items:center;gap:8px}',
    '#gsCard h3 span{margin-left:auto;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1}',
    '#gsBody{overflow:auto;padding:18px 24px 40px;font:15px/1.75 system-ui,"PingFang SC","Microsoft YaHei"}',
    '#gsBody h1{font-size:24px;margin:10px 0 14px}', '#gsBody h2{font-size:19px;margin:18px 0 8px}', '#gsBody h3{font-size:16px;margin:14px 0 6px}',
    '#gsBody blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--line,#cbd5e1);color:color-mix(in srgb,var(--text,#0f172a) 70%,transparent);background:color-mix(in srgb,var(--text,#0f172a) 5%,transparent)}',
    '#gsBody li{margin:3px 0}', '#gsBody code{background:color-mix(in srgb,var(--text,#0f172a) 8%,transparent);padding:1px 5px;border-radius:4px}',
    '#gsPeek .kbp-head{font:12px/1.8;color:color-mix(in srgb,var(--text,#0f172a) 62%,transparent);margin:0 0 8px}',
    '.kbp-bar{display:flex;align-items:center;gap:8px;margin:0 0 10px;font:13px/1 system-ui,"PingFang SC","Microsoft YaHei"}',
    '.kbp-btn{border:1px solid var(--line,#d7dee9);background:var(--card,#fff);color:var(--text,#334155);border-radius:8px;padding:7px 12px;cursor:pointer;text-decoration:none;font-size:13px}',
    '.kbp-btn:hover{background:color-mix(in srgb,var(--text,#0f172a) 8%,transparent)}',
    '.kbp-no{font-variant-numeric:tabular-nums;color:var(--text,#475569);min-width:64px;text-align:center}',
    '.kbp-in{width:64px;border:1px solid var(--line,#d7dee9);border-radius:8px;padding:6px 8px;font:13px/1 inherit;background:var(--card,#fff);color:inherit}',
    '.kbp-sp{flex:1}',
    '.kbp-lbl{color:color-mix(in srgb,var(--text,#0f172a) 55%,transparent)}',
    '.kbp-wrap{border:1px solid var(--line,#e2e8f0);border-radius:12px;overflow:auto;max-height:60vh;background:#fff;-webkit-overflow-scrolling:touch}',
    '.kbp-img{display:block;width:100%;height:auto}',
    '.kbp-txt{margin-top:12px;font-size:13px;color:color-mix(in srgb,var(--text,#0f172a) 62%,transparent)}',
    '.kbp-txt summary{cursor:pointer;padding:6px 0}'
  ].join('\n');

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function mdToHtml(md) {
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var lines = String(md || '').split(/\r?\n/), out = [], list = false;
    function closeList() { if (list) { out.push('</ul>'); list = false; } }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (!t) { closeList(); return; }
      if (/^###\s+/.test(t)) { closeList(); out.push('<h3>' + esc(t.slice(4)) + '</h3>'); return; }
      if (/^##\s+/.test(t)) { closeList(); out.push('<h2>' + esc(t.slice(3)) + '</h2>'); return; }
      if (/^#\s+/.test(t)) { closeList(); out.push('<h1>' + esc(t.slice(2)) + '</h1>'); return; }
      if (/^>\s?/.test(t)) { closeList(); out.push('<blockquote>' + esc(t.replace(/^>\s?/, '')) + '</blockquote>'); return; }
      if (/^[-*]\s+/.test(t)) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + esc(t.replace(/^[-*]\s+/, '')) + '</li>'); return; }
      closeList(); out.push('<p>' + esc(t) + '</p>');
    });
    closeList();
    var html = out.join('\n');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return html || '<p style="color:#94a3b8">（空白）</p>';
  }

  var wrap, box, input, sub, mode, list, peek, card, cardTitle, cardBody;

  function build() {
    if (document.getElementById('gsWrap')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var btn = el('button', null, '🔍'); btn.id = 'gsBtn'; btn.title = '搜索全部笔记（Ctrl+K）— 可拖动';
    try {
      var saved = JSON.parse(localStorage.getItem('gs.pos') || 'null');
      if (saved && saved.x != null) {
        /* 以前拖到过屏幕外（换设备 / 转屏 / 缩小窗口）就复位到右下角，
           否则元素在但用户根本看不见 */
        var vw = window.innerWidth || 360, vh = window.innerHeight || 640;
        if (saved.x < 0 || saved.y < 0 || saved.x > vw - 40 || saved.y > vh - 40) {
          localStorage.removeItem('gs.pos');
        } else {
          btn.style.left = saved.x + 'px'; btn.style.top = saved.y + 'px';
          btn.style.right = 'auto'; btn.style.bottom = 'auto';
        }
      }
    } catch (e) {}
    var drag = { on: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    btn.addEventListener('pointerdown', function (e) {
      drag.on = true; drag.moved = false;
      drag.sx = e.clientX; drag.sy = e.clientY;
      var r = btn.getBoundingClientRect(); drag.ox = r.left; drag.oy = r.top;
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      btn.style.cursor = 'grabbing';
    });
    btn.addEventListener('pointermove', function (e) {
      if (!drag.on) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      var x = Math.max(6, Math.min(window.innerWidth - 66, drag.ox + dx));
      var y = Math.max(6, Math.min(window.innerHeight - 66, drag.oy + dy));
      btn.style.left = x + 'px'; btn.style.top = y + 'px';
      btn.style.right = 'auto'; btn.style.bottom = 'auto';
    });
    btn.addEventListener('pointerup', function () {
      drag.on = false; btn.style.cursor = 'grab';
      if (drag.moved) {
        var r2 = btn.getBoundingClientRect();
        localStorage.setItem('gs.pos', JSON.stringify({ x: Math.round(r2.left), y: Math.round(r2.top) }));
      }
    });
    btn.onclick = function () { if (drag.moved) { drag.moved = false; return; } open(); };
    document.body.appendChild(btn);

    wrap = el('div'); wrap.id = 'gsWrap';
    box = el('div'); box.id = 'gsBox';
    var row = el('div'); row.id = 'gsIn';
    input = el('input'); input.id = 'gsQ'; input.placeholder = '搜索笔记 / 考点 / 讲义 / 题目…（模糊匹配，Ctrl+K）';
    var x = el('span', null, '✕'); x.style.cursor = 'pointer'; x.style.color = '#94a3b8'; x.onclick = close;
    row.appendChild(input); row.appendChild(x);
    sub = el('div'); sub.id = 'gsSub';
    MODULES.forEach(function (m) {
      var c = el('span', m === CUR_MOD ? 'on' : '', m);
      c.setAttribute('data-mod', m);
      c.onclick = function () {
        CUR_MOD = m; CUR_SUB = '全部';
        Array.prototype.forEach.call(sub.children, function (n) { n.classList.remove('on'); });
        c.classList.add('on');
        buildMode(); run();
      };
      sub.appendChild(c);
    });
    var sp0 = el('span', 'sp'); sp0.style.background = 'transparent'; sp0.style.flex = '1'; sp0.style.cursor = 'default';
    sub.appendChild(sp0);
    var hintTop = el('i', null, ''); hintTop.id = 'gsAiHint'; hintTop.style.cssText = 'font-style:normal;font-size:11px;color:color-mix(in srgb,var(--text,#0f172a) 50%,transparent);align-self:center;margin-right:4px';
    sub.appendChild(hintTop);
    var aiTop = el('span', 'ai' + (AIF ? ' on' : ''), '✨ AI 相似度');
    aiTop.id = 'gsAi';
    aiTop.title = '用向量相似度排序（设置里填了「向量模型」就走 /embeddings；没填就用本地字符向量，不联网）';
    aiTop.onclick = function () { AIF = !AIF; aiTop.classList.toggle('on', AIF); run(); };
    sub.appendChild(aiTop);
    mode = el('div'); mode.id = 'gsMode';
    list = el('div'); list.id = 'gsList';
    box.appendChild(row); box.appendChild(sub); box.appendChild(mode); box.appendChild(list);
    buildMode();
    wrap.appendChild(box);
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
    document.body.appendChild(wrap);

    peek = el('div'); peek.id = 'gsPeek';
    card = el('div'); card.id = 'gsCard';
    cardTitle = el('h3');
    cardBody = el('div'); cardBody.id = 'gsBody';
    card.appendChild(cardTitle); card.appendChild(cardBody);
    peek.appendChild(card);
    peek.onclick = function (e) { if (e.target === peek) closePeek(); };
    document.body.appendChild(peek);

    input.oninput = run;
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
      else if (e.key === 'Escape') { if (peek.classList.contains('on')) closePeek(); else close(); }
    });
  }

  /* 这条属于哪个模块（「全部」按这个分组折叠） */
  function modOf(it) {
    if (!it) return '其他';
    if (it.kind === 'q') return '题目';
    if (it.kind === 'lecture') return it.xz ? '西综' : '讲义';
    if (it.kind === 'kuangbei' || it.src === '狂背') return '狂背';
    if (it.src === '我的笔记') return '我的笔记';
    return '讲义';
  }

  /* 二级筛选是跟着模块变的：
       题目 → 第一行 范围（题干/选项/解析/全部）、第二行 科目
       讲义 → 一行 科目（内科/外科/生理/生化/病理…）
       其余 → 不显示二级（「全部」就是不筛） */
  function chipRow(label, list, cur, onPick, attr, attrName) {
    var r = el('div', 'gsmr');
    if (label) { var l = el('span', 'gslbl', label); l.style.background = 'transparent'; l.style.cursor = 'default'; r.appendChild(l); }
    list.forEach(function (v) {
      var c = el('span', v === cur ? 'on' : '', v);
      if (attrName) c.setAttribute(attrName, v);
      c.onclick = function () {
        Array.prototype.forEach.call(r.querySelectorAll('span[' + (attrName || 'data-v') + ']'), function (n) { n.classList.remove('on'); });
        c.classList.add('on');
        onPick(v);
      };
      r.appendChild(c);
    });
    return r;
  }

  function buildMode() {
    if (!mode) return;
    mode.innerHTML = '';
    if (CUR_MOD === '题目') {
      mode.appendChild(chipRow('范围', MODE_CHIPS.map(function (p) { return p[1]; }),
        (MODE_CHIPS.filter(function (p) { return p[0] === QSCOPE; })[0] || MODE_CHIPS[0])[1],
        function (v) {
          var hit = MODE_CHIPS.filter(function (p) { return p[1] === v; })[0];
          QSCOPE = hit ? hit[0] : 'all';
          run();
        }, 'data-scope', 'data-scope'));
      mode.appendChild(chipRow('科目', QSUBJ, CUR_SUB, function (v) { CUR_SUB = v; run(); }, 'data-sub', 'data-sub'));
    } else if (CUR_MOD === '讲义') {
      mode.appendChild(chipRow('科目', LSUBJ, CUR_SUB, function (v) { CUR_SUB = v; run(); }, 'data-sub', 'data-sub'));
    }
    /* 全部、西综、狂背、笔记 → 不挂二级筛选（全部就是全部） */
    mode.style.display = mode.children.length ? 'block' : 'none';
  }

  function open() {
    build();
    wrap.classList.add('on');
    input.value = ''; run(); setTimeout(function () { input.focus(); }, 30);
    ensureData().then(function () { try { loadQuestions(); } catch (e) {} run(); });
    if (CUR_MOD === '讲义') { try { ensureLec(); } catch (e) {} }
    /* 知识库分片（kb/m1..m8）是页面另外异步加载的，常在面板打开之后才到；
       这里补两次索引，到了就重画一次结果。 */
    [900, 3000].forEach(function (ms) {
      setTimeout(function () {
        try { var before = ITEMS.length; loadKbDocs(); if (ITEMS.length !== before) run(); } catch (e) {}
      }, ms);
    });
  }
  function close() { if (wrap) wrap.classList.remove('on'); }
  function closePeek() { if (peek) peek.classList.remove('on'); }

  var PDFIDX = (window.__PDFIDX && typeof window.__PDFIDX === 'object') ? window.__PDFIDX : null;
  var PDFNORM = {};
  function buildNorm() {
    for (var k in PDFIDX) PDFNORM[String(k).replace(/\s+/g, '')] = PDFIDX[k];
  }
  function ensurePdfIdx() {
    if (PDFIDX) { buildNorm(); return Promise.resolve(PDFIDX); }
    return fetch('pdf-index.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { PDFIDX = j || {}; buildNorm(); return PDFIDX; })
      .catch(function () { PDFIDX = {}; return PDFIDX; });
  }
  function resolvePdf(name) {
    if (!PDFIDX) return '';
    var n = String(name || '').trim();
    var keys = [n, n.replace(/\.pdf$/i, ''), n.replace(/\s+/g, ''), n.replace(/\.pdf$/i, '').replace(/\s+/g, '')];
    for (var i = 0; i < keys.length; i++) if (PDFIDX[keys[i]]) return PDFIDX[keys[i]];
    var core = n.replace(/\.pdf$/i, '').split('_')[0];
    for (var k in PDFIDX) if (k.indexOf(core) === 0 && core.length >= 4) return PDFIDX[k];
    var nk = n.replace(/\s+/g, '').replace(/\.pdf$/i, '');
    for (var k2 in PDFNORM) if (k2.indexOf(nk) === 0 && nk.length >= 6) return PDFNORM[k2];
    return '';
  }
  function pdfPage(name) {
    var m = String(name || '').match(/_(\d+)(?:-\d+)?\.pdf$/i);
    return m ? m[1] : '';
  }

  function openPeek(item) {
    cardTitle.innerHTML = '<span>' + esc2(item.t) + '</span><i style="font-style:normal;color:#94a3b8;font-size:12px">' + esc2(item.src + (item.page ? ' · ' + item.page : '')) + '</i><span>✕</span>';
    cardTitle.querySelector('span:last-child').onclick = closePeek;
    cardBody.innerHTML = mdToHtml(item.x);
    cardBody.scrollTop = 0;
    peek.classList.add('on');
    if (item.kind === 'q') {
      cardTitle.innerHTML = '<span>' + esc2(item.g || '题目') + ' · 第 ' + (item.no || '') + ' 题</span>'
        + '<i style="font-style:normal;color:#94a3b8;font-size:12px">题目 · ' + esc2(item.s || '') + '</i><span>✕</span>';
      cardTitle.querySelector('span:last-child').onclick = closePeek;
      var optHtml = String(item._opts || '').split('\n').filter(function (x) { return x.trim(); })
        .map(function (ln) { return '<div style="margin:3px 0">' + esc2(ln) + '</div>'; }).join('');
      cardBody.innerHTML = '<div style="font-weight:600;font-size:16px;line-height:1.7;margin:0 0 12px">' + esc2(item._stem) + '</div>'
        + (optHtml ? '<div style="margin:0 0 14px;color:color-mix(in srgb,var(--text,#0f172a) 82%,transparent)">' + optHtml + '</div>' : '')
        + (item._ans ? '<p><b>答案：</b>' + esc2(item._ans) + '</p>' : '')
        + (item._exp ? '<p style="margin-bottom:4px"><b>解析：</b></p>' + mdToHtml(item._exp) : '')
        + '<div class="kbp-bar" style="margin-top:16px">'
        + '<button class="kbp-btn" id="qOpen">💡 在答题页打开这道题</button>'
        + '<button class="kbp-btn" id="qCopy">📋 复制这道题</button>'
        + '</div>';
      var qo = cardBody.querySelector('#qOpen');
      if (qo) qo.onclick = function () {
        closePeek();
        if (window.openQuestionAt) window.openQuestionAt(item.bank, item.qid);
        else location.hash = '#/bank/' + encodeURIComponent(item.bank);
      };
      var qc = cardBody.querySelector('#qCopy');
      if (qc) qc.onclick = function () {
        var txt = item._stem + '\n' + String(item._opts || '') + '\n' + (item._ans ? ('答案：' + item._ans + '\n') : '') + (item._exp ? ('解析：' + item._exp) : '');
        try { navigator.clipboard.writeText(txt); } catch (e) {}
        qc.textContent = '📋 已复制';
      };
      cardBody.scrollTop = 0;
      return;
    }
    if (item.kind === 'kuangbei') {
      var kbp = window.__KBACK || {};
      var total = kbp.pages || 50;
      var p0 = Math.max(1, Math.min(total, (item.p0 | 0) || 1));
      var pdfHref = '';
      if (kbp.pdf) pdfHref = encodeURI(kbp.pdf);
      else if (kbp.pdfLocal) pdfHref = 'file:///' + encodeURI(String(kbp.pdfLocal).replace(/\\/g, '/').replace(/^\/+/, ''));
      var kbSrc = function (p) { return encodeURI('资料/狂背/页/p' + ('00' + p).slice(-3) + '.webp'); };
      var head = '<div class="kbp-head">'
        + esc2((item.g ? item.g + ' · ' : '') + item.t) + (item.page ? ' · ' + esc2(item.page) : '') + '</div>';
      cardBody.innerHTML = head
        + '<div class="kbp-bar">'
        + '<button class="kbp-btn" data-kbp="-1" title="上一页（←）">‹</button>'
        + '<span class="kbp-no" id="kbpNo">' + p0 + ' / ' + total + '</span>'
        + '<button class="kbp-btn" data-kbp="1" title="下一页（→）">›</button>'
        + '<span class="kbp-sp"></span>'
        + '<span class="kbp-lbl">跳至</span>'
        + '<input class="kbp-in" id="kbpIn" type="number" min="1" max="' + total + '" value="' + p0 + '" title="输入页码后按回车">'
        + '<span class="kbp-lbl">页</span>'
        + (pdfHref ? '<a class="kbp-btn kbp-pdf" href="' + pdfHref + '#page=' + p0 + '" target="_blank" rel="noopener">📄 整本 PDF</a>' : '')
        + '</div>'
        + '<div class="kbp-wrap"><img id="kbpImg" class="kbp-img" alt="狂背 原书第 ' + p0 + ' 页" src="' + kbSrc(p0) + '"></div>'
        + (item.x ? '<details class="kbp-txt"><summary>文字版（可复制）</summary>' + mdToHtml(item.x) + '</details>' : '');
      var img2 = cardBody.querySelector('#kbpImg'), no2 = cardBody.querySelector('#kbpNo');
      var inp2 = cardBody.querySelector('#kbpIn'), pdfA2 = cardBody.querySelector('.kbp-pdf');
      var paint = function (p) {
        p = Math.max(1, Math.min(total, parseInt(p, 10) || 1));
        img2.src = kbSrc(p); img2.alt = '狂背 原书第 ' + p + ' 页';
        no2.textContent = p + ' / ' + total; inp2.value = p;
        if (pdfA2) pdfA2.href = pdfHref + '#page=' + p;
        cardBody.scrollTop = 0;
      };
      cardBody.querySelectorAll('[data-kbp]').forEach(function (b) {
        b.onclick = function () { paint((parseInt(inp2.value, 10) || p0) + (parseInt(b.getAttribute('data-kbp'), 10) || 0)); };
      });
      img2.title = '点一下在新标签页看大图';
      img2.style.cursor = 'zoom-in';
      img2.onclick = function () { window.open(img2.src, '_blank', 'noopener'); };
      inp2.onchange = function () { paint(inp2.value); };
      inp2.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); paint(inp2.value); inp2.blur(); } };
      return;
    }
    if (item.kind === 'lecture') {
      var pg = Math.max(1, item.pg | 0);
      var file = String(item.file || '');
      var pdfHref2 = file ? (encodeURI(file) + '#page=' + pg) : '';
      cardBody.innerHTML = '<div class="kbp-head">' + esc2(item.g || '西综') + ' · 第 ' + pg + ' 页'
        + (item.pages ? ' / ' + item.pages : '') + '</div>'
        + '<div class="kbp-bar">'
        + '<button class="kbp-btn" id="lecJump">📖 在讲义里打开这一页</button>'
        + '<span class="kbp-sp"></span>'
        + (pdfHref2 ? '<a class="kbp-btn" href="' + pdfHref2 + '" target="_blank" rel="noopener">📄 整本 PDF</a>' : '')
        + '</div>'
        + (item.img ? ('<div class="kbp-wrap"><img class="kbp-img" id="lecImg2" alt="第 ' + pg + ' 页"'
        + ' src="' + encodeURI('pdfimg/' + item.img + '.webp') + '"></div>') : '')
        + (item.x ? '<details class="kbp-txt"><summary>文字版（可复制）</summary>' + mdToHtml(item.x) + '</details>' : '');
      var im2 = cardBody.querySelector('#lecImg2');
      if (im2) {
        im2.title = '点一下在新标签页看大图'; im2.style.cursor = 'zoom-in';
        im2.onclick = function () { window.open(im2.src, '_blank', 'noopener'); };
      }
      var jb = cardBody.querySelector('#lecJump');
      if (jb) jb.onclick = function () {
        closePeek();
        if (window.LECTURE && LECTURE.openHit) LECTURE.openHit({ file: item.file, doc: item.t, pdfp: pg, page: pg });
        else location.hash = '#/';
      };
      return;
    }
    if (item.src === '资料库') {
      ensurePdfIdx().then(function () {
        var p = resolvePdf(item.t);
        if (!p) return;
        var pg = pdfPage(item.t);
        var src = encodeURI(p) + (pg ? '#page=' + pg : '');
        cardBody.innerHTML = '<p style="margin:0 0 10px"><a style="display:inline-block;background:#2f6fed;color:#fff;border-radius:8px;padding:8px 14px;font-size:13px;text-decoration:none" href="' + src + '" target="_blank" rel="noopener">📄 打开 PDF（新标签页）</a></p>'
          + '<iframe src="' + src + '" style="width:100%;height:60vh;border:0;border-radius:10px;background:#f8fafc"></iframe>';
      });
    }
  }
  function esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }


  function openNote(item) {
    close();
    if (!window.KbDoc) { alert('编辑器还没加载好，稍等一秒再点'); return; }
    if (item.kind === 'tag') window.KbDoc.openTag(item.tagId, item.t, item.x);
    else window.KbDoc.open(item.t, item.x);
  }

  function delNote(item, ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (!confirm('删除笔记「' + item.t + '」？删了就找不回来了。')) return;
    try { localStorage.removeItem(item.key); } catch (e) {}
    ITEMS = ITEMS.filter(function (x) { return x.key !== item.key; });
    run();
  }

  function newNote() {
    var title = prompt('新笔记的标题（保存后可在「我的笔记」里找到）', '未命名笔记');
    if (title == null) return;
    title = String(title).trim();
    if (!title) return;
    var key = 'kbdoc.doc.' + title;
    if (localStorage.getItem(key) != null) { alert('已经有同名笔记了'); return; }
    localStorage.setItem(key, '');
    var item = { id: 'note:' + key, t: title, s: '我的笔记', g: '自由笔记', x: '', src: '我的笔记', kind: 'doc', key: key, tagId: '' };
    ITEMS.push(item);
    openNote(item);
  }

  /* ---------- 相似度检索（向量） ----------
     ① 设置里填了「向量模型」→ OpenAI 兼容 /embeddings，按余弦相似度排；
     ② 没填 → 本地字符二元组稀疏向量余弦（零网络、零费用，补词序/局部重合）；
     两条都不挡路：失败就当没发生，调用方继续用本地关键词结果。 */
  var EMB = {};            /* 缓存键 → 向量 */
  var QEMB = {};           /* 查询文本 → 向量 */
  var SCORES = null;       /* 本次结果是相似度模式时：id → 相似度 0~1 */

  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h;
  }
  function bigramVec(s) {
    var v = {}, g, n = 0;
    s = String(s || '').toLowerCase().replace(/\s+/g, ' ');
    for (var i = 0; i < s.length - 1; i++) {
      g = s.substr(i, 2);
      if (g === '  ') continue;
      v[g] = (v[g] || 0) + 1; n++;
    }
    if (!n) return v;
    var d = Math.sqrt(n);
    for (var k in v) v[k] = v[k] / d;
    return v;
  }
  function cosSparse(a, b) {
    var s = 0;
    for (var k in a) if (b[k]) s += a[k] * b[k];
    return s;
  }
  function cosDense(a, b) {
    if (!a || !b || !a.length) return 0;
    var s = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return (na && nb) ? s / Math.sqrt(na * nb) : 0;
  }
  function itemText(it) {
    return String(qText(it) || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  }
  /* 远端向量：分块（一次 16 条），任意一块失败就整批放弃 */
  function embedAll(list) {
    if (typeof window.aiEmbed !== 'function' || !list.length) return Promise.resolve(null);
    var chunks = [], out = [];
    for (var i = 0; i < list.length; i += 16) chunks.push(list.slice(i, i + 16));
    var p = Promise.resolve();
    chunks.forEach(function (ch) {
      p = p.then(function () {
        return window.aiEmbed(ch).then(function (arr) {
          if (!arr || arr.length !== ch.length) throw new Error('emb len');
          out = out.concat(arr);
        });
      });
    });
    return p.then(function () { return out; });
  }

  /* cb(list, how, scores) —— how: 'ai'（远端向量）/ 'local'（本地向量）/ null（失败） */
  function aiRerank(q, items, cb) {
    if (!q || !items || !items.length) { cb(null); return; }
    var top = items.slice(0, 40);
    var texts = top.map(itemText);
    var keys = texts.map(function (t, i) { return top[i].id + ':' + t.length + ':' + hashStr(t); });
    var vecs = new Array(top.length);
    var miss = [], missIdx = [];
    for (var i = 0; i < top.length; i++) {
      if (EMB[keys[i]]) vecs[i] = EMB[keys[i]]; else { miss.push(texts[i]); missIdx.push(i); }
    }
    var qKey = 'q:' + q.length + ':' + hashStr(q);
    if (QEMB[qKey] && Object.keys(EMB).length > 4000) EMB = {};

    function local() {
      var qv = bigramVec(q);
      var scored = top.map(function (it, idx) {
        var v = vecs[idx] || bigramVec(texts[idx]);
        return { it: it, s: cosSparse(qv, v) };
      }).sort(function (a, b) { return b.s - a.s; });
      var sm = {};
      scored.forEach(function (o) { sm[o.it.id] = o.s; });
      cb(scored.map(function (o) { return o.it; }), 'local', sm);
    }
    function remote() {
      var qv = QEMB[qKey];
      var scored = top.map(function (it, idx) {
        return { it: it, s: vecs[idx] ? cosDense(qv, vecs[idx]) : 0 };
      }).sort(function (a, b) { return b.s - a.s; });
      var sm = {};
      scored.forEach(function (o) { sm[o.it.id] = o.s; });
      cb(scored.map(function (o) { return o.it; }), 'ai', sm);
    }

    var need = [];
    var needQ = !QEMB[qKey];
    if (needQ) need.push(q);
    miss.forEach(function (t) { need.push(t); });
    if (!need.length) { if (QEMB[qKey]) remote(); else local(); return; }
    embedAll(need).then(function (arr) {
      if (!arr) { local(); return; }
      var k = 0;
      if (needQ) { QEMB[qKey] = arr[k++]; }
      missIdx.forEach(function (idx, j) {
        var v = arr[k + j];
        if (v) { vecs[idx] = v; EMB[keys[idx]] = v; }
      });
      /* 远端只覆盖到一部分就退本地 */
      var gotAll = true;
      for (var z = 0; z < top.length; z++) if (!vecs[z]) { gotAll = false; break; }
      if (gotAll && QEMB[qKey]) remote(); else local();
    }).catch(function () { local(); });
  }

  var MOD_ORDER = ['题目', '讲义', '西综', '狂背', '我的笔记', '其他'];

  function rowEl(it) {
    var d = el('div', 'gsItem');
    var note = it.kind === 'tag' || it.kind === 'doc';
    var q0 = (input.value || '').trim().toLowerCase();
    var meta;
    if (it.kind === 'q') meta = '题目 · ' + (it.g || '') + ' · 第 ' + it.no + ' 题';
    else if (it.kind === 'lecture') meta = (it.xz ? '西综' : (it.s || '讲义')) + ' · 第 ' + it.pg + ' 页';
    else meta = (it.src || '') + (it.page ? ' · ' + it.page : '');
    var body = q0 ? snippet(it, q0, 100) : String(qText(it) || '').replace(/\s+/g, ' ').slice(0, 100);
    var pct = (SCORES && SCORES[it.id] != null) ? (' <span class="gsim">' + Math.round(Math.max(0, Math.min(1, SCORES[it.id])) * 100) + '%</span>') : '';
    d.innerHTML = '<b>' + esc2(it.t) + '</b>' + pct + '<i>' + esc2(meta) + '</i>'
      + (note ? '<i style="float:right;color:#ef4444;cursor:pointer;font-size:12px" data-del="1">删除</i>' : '')
      + '<p>' + esc2(body) + '</p>';
    d.onclick = function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-del')) { delNote(it, e); return; }
      if (note) { openNote(it); return; }
      openPeek(it);
    };
    return d;
  }

  function noteBar(n) {
    var bar = el('div', 'gsItem');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;position:sticky;top:0;background:var(--card,#fff);z-index:2;border-bottom:1px solid var(--line,#f1f5f9)';
    bar.innerHTML = '<b style="font-size:13px">我的笔记 · ' + n + ' 篇</b><span style="flex:1"></span>';
    var add = el('span', null, '＋ 新建笔记');
    add.style.cssText = 'background:var(--primary,#2563eb);color:#fff;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer';
    add.onclick = function (e) { e.stopPropagation(); newNote(); };
    bar.appendChild(add);
    return bar;
  }

  /* 「全部」模式：按来源分组折叠汇总 */
  function paintGrouped(res) {
    list.innerHTML = '';
    var by = {}, order = [];
    res.forEach(function (it) {
      var m = modOf(it);
      if (!by[m]) { by[m] = []; order.push(m); }
      by[m].push(it);
    });
    var keys = MOD_ORDER.filter(function (m) { return by[m]; });
    if (!res.length) {
      var e0 = READY ? '没找到相关内容，换个词试试（可以只搜题干、只搜讲义）' : '正在加载…';
      if (lecBusy()) e0 = lecHintText();
      list.appendChild(el('div', null, '<div id="gsEmpty">' + e0 + '</div>'));
      return;
    }
    keys.forEach(function (m) {
      var arr = by[m];
      var det = document.createElement('details'); det.className = 'gsGrp'; det.open = true;
      var sum = document.createElement('summary');
      sum.innerHTML = '<span>' + esc2(m) + '</span><span class="gn">' + arr.length + ' 条</span>'
        + '<span class="gt">' + (arr.length > 5 ? '点一下折叠' : '') + '</span>';
      det.appendChild(sum);
      arr.forEach(function (it) { det.appendChild(rowEl(it)); });
      list.appendChild(det);
    });
    var lh0 = lecHintEl(); if (lh0) list.appendChild(lh0);
  }

  function paintList(res, aiOrdered) {
    if (CUR_MOD === '全部') { paintGrouped(res); return; }
    list.innerHTML = '';
    if (CUR_MOD === '我的笔记') {
      list.appendChild(noteBar(res.length));
    }
    if (!res.length) {
      var msg;
      if (!READY) msg = '正在加载…';
      else if (CUR_MOD === '题目') msg = '没找到题目，换个词试试（也可以只搜解析或只搜选项）';
      else if (CUR_MOD === '讲义') msg = lecBusy() ? lecHintText() : '没找到这个科目里的讲义内容（讲义文字是按科目下载的，第一次会慢一点）';
      else if (CUR_MOD === '我的笔记') msg = '还没有笔记（点右上角「＋ 新建笔记」）';
      else msg = '没找到相关内容，换个词试试';
      list.appendChild(el('div', null, '<div id="gsEmpty">' + msg + '</div>'));
      return;
    }
    res.forEach(function (it) { list.appendChild(rowEl(it)); });
    var lh1 = lecHintEl(); if (lh1) list.appendChild(lh1);
  }

  /* 当前模块（+二级筛选）可见的条目 */
  function baseItems() {
    return ITEMS.filter(function (it) {
      var m = modOf(it);
      if (CUR_MOD === '我的笔记') return m === '我的笔记';
      if (CUR_MOD === '题目') return it.kind === 'q' && (CUR_SUB === '全部' || it.s === CUR_SUB);
      if (CUR_MOD === '讲义') return m === '讲义' && (CUR_SUB === '全部' || it.s === CUR_SUB);
      if (CUR_MOD === '西综') return m === '西综';
      if (CUR_MOD === '狂背') return m === '狂背';
      return true;
    });
  }

  function run() {
    if (!list) return;
    var hint = document.getElementById('gsAiHint');
    var q = (input.value || '').trim().toLowerCase();
    var base = baseItems();
    if (!q) {
      AI_TOKEN++; SCORES = null;
      if (hint) hint.textContent = '';
      if (CUR_MOD === '全部') {
        list.innerHTML = '';
        list.appendChild(el('div', null, '<div id="gsEmpty">输入关键词：结果会按「题目 / 讲义 / 西综 / 狂背 / 笔记」分类折叠汇总</div>'));
        var rec = base.filter(function (it) { return modOf(it) === '我的笔记'; }).slice(0, 8);
        if (rec.length) {
          var det = document.createElement('details'); det.className = 'gsGrp';
          var sum = document.createElement('summary');
          sum.innerHTML = '<span>我的笔记</span><span class="gn">最近 ' + rec.length + ' 条</span>';
          det.appendChild(sum);
          rec.forEach(function (it) { det.appendChild(rowEl(it)); });
          list.appendChild(det);
        }
        return;
      }
      if (CUR_MOD === '题目') {
        list.innerHTML = '';
        list.appendChild(el('div', null, '<div id="gsEmpty">输入关键词搜题目（可切换：题干 / 选项 / 解析）</div>'));
        return;
      }
      if (CUR_MOD === '讲义') { try { ensureLec(); } catch (e) {} }
      paintList(base.slice(0, 30), false);
      return;
    }
    if (CUR_MOD === '讲义' || CUR_MOD === '全部') { try { ensureLec(); } catch (e) {} }
    var res = base.map(function (it) { return { it: it, s: score(it, q, q) }; })
      .filter(function (o) { return o.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, CUR_MOD === '全部' ? 80 : 60)
      .map(function (o) { return o.it; });
    paintList(res, false);
    if (!AIF) { AI_TOKEN++; SCORES = null; if (hint) hint.textContent = ''; return; }
    var token = ++AI_TOKEN;
    if (hint) hint.textContent = '正在算相似度…';
    aiRerank(q, res, function (ord, how, sm) {
      if (token !== AI_TOKEN) return;
      if (!ord) { if (hint) hint.textContent = '相似度没跑起来，用关键词结果'; return; }
      SCORES = sm || null;
      if (hint) hint.textContent = (how === 'ai') ? 'AI 相似度排序' : '本地相似度排序（设置里没填向量模型）';
      paintList(ord, true);
    });
  }

  function boot() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.GS = { open: open, close: close };
})();
