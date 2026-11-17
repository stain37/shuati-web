/* taxload.js —— 把 tax.js 的三级索引「整份灌进」考点词表（按版本执行一次）
   做法是覆盖式的，不跟旧数据纠缠：
     ① 词表（qbank.tagvocab.v1）直接重写成「基本科目 + tax.js 的全部考点」；
     ② 每个考点的科目归属（qbank.tagsub.v1）与一级章归属（qbank.tagchap.v1）按 tax.js 重写；
     ③ 旧名字（改名前）在词表/归属表里的残留一并清掉；
     ④ 题目上的旧人文标签（22 个）并进新的 4 个二级，见 migrateHuman()。
   这样无论本机以前装过哪一版标签体系，都会被纠正成同一套。
   想强制重跑：控制台执行 taxImport(true)。 */
(function () {
  'use strict';

  var HRVER_KEY = 'qbank.hrver.v1';
  var HRVER = 'h2';                 /* 人文并档逻辑的版本，与 tax 版本解耦，改一次加一次 */

  function readObj (k) { try { var v = JSON.parse(localStorage.getItem(k) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; } }
  function write (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function stampTags (tags) {
    try {
      /* 逐题时间戳必须是对象：以前这里写的是 String(Date.now()) 这种裸数字，
         tags.js 的 tagTsSet 再做 TAG_TS[k] = t 就会炸「Cannot create property … on number」 */
      var _ts = {}, _now = Date.now();
      Object.keys(tags || {}).forEach(function (k) { _ts[k] = _now; });
      localStorage.setItem('qbank.tagts.v1', JSON.stringify(_ts));
    } catch (e) {}
  }

  /* ④ 题目上的旧人文标签 → 新的 4 个二级（医学职业素养/医患关系/临床伦理/卫生法律法规）。
     找不到归属、且旧科目是「人文」的，直接撤掉。
     单独成函数、单独记版本，是因为 tax 版本号可能早就更新过了，而那些题还没并档。 */
  function migrateHuman (T, vocab) {
    var G = window.TAGS;
    if (!T || !T.humanRen || !G) return 0;
    var HR = T.humanRen;
    var ok = {};
    ((vocab && vocab.length) ? vocab : Object.keys(T.map || {})).forEach(function (n) { ok[n] = 1; });
    (G.basic ? G.basic() : []).forEach(function (n) { ok[n] = 1; });

    var oldSub = readObj('qbank.tagsub.v1');
    var tags = readObj('qbank.tags.v1');
    var qfixed = 0, qdrop = 0;
    Object.keys(tags).forEach(function (k) {
      var arr = Array.isArray(tags[k]) ? tags[k] : [];
      if (!arr.length) return;
      var out = [], touched = false;
      arr.forEach(function (t) {
        var nt = HR[t] || t;
        if (nt !== t) touched = true;
        if (ok[nt]) { if (out.indexOf(nt) < 0) out.push(nt); }
        else if (oldSub[t] === '人文') { touched = true; qdrop++; }
        else if (out.indexOf(nt) < 0) out.push(nt);
      });
      if (touched) { tags[k] = out; qfixed++; }
    });
    if (!qfixed) return 0;

    write('qbank.tags.v1', tags);
    /* tags.js 内存里还是旧标签，不重读的话它下一次 save() 会把旧数据写回来 */
    try { if (typeof window.tagReload === 'function') window.tagReload(); } catch (e) {}
    stampTags(tags);
    try { window.dispatchEvent(new CustomEvent('qbank:tags-changed')); } catch (e) {}
    console.log('[taxload] 人文并档：' + qfixed + ' 题改标签，撤掉 ' + qdrop + ' 个旧人文标签');
    return qfixed;
  }

  function importTax (force) {
    var T = window.TAX, G = window.TAGS;
    if (!T || !T.map || !G || !G.rememberVocab || !G.setCh) return -1;
    var ver = (localStorage.getItem('qbank.taxver.v1') || '').replace(/^"|"$/g, '');
    if (!force && ver === T.version) {
      /* 版本没变也要看一下人文并档做过没有（老用户升级 tax 时 ③c 可能没生效） */
      if (localStorage.getItem(HRVER_KEY) !== HRVER) {
        var mh0 = migrateHuman(T, null);
        try { localStorage.setItem(HRVER_KEY, HRVER); } catch (e) {}
        if (mh0) { try { if (typeof window.statsRerender === 'function') window.statsRerender(); } catch (e) {} }
      }
      return 0;
    }

    var names = Object.keys(T.map);          /* 保持 tax.js 里的顺序：学科 → 章 → 考点 */
    var basics = (G.basic && G.basic()) || [];
    var vocab = basics.slice();
    names.forEach(function (n) { if (vocab.indexOf(n) < 0) vocab.push(n); });

    /* ① 覆盖词表：先落盘，再让 tags.js 的内存重读，否则 saveVocab() 会把旧的写回去 */
    write('qbank.tagvocab.v1', vocab);
    try { if (typeof window.tagReload === 'function') window.tagReload(); else if (G.reload) G.reload(); } catch (e) {}

    /* ② 科目 / 一级章：逐个写（setSub / setCh 会同时改内存与 localStorage） */
    var nsub = 0, nch = 0;
    names.forEach(function (n) {
      var s = T.subOf(n), c = T.chOf(n);
      if (s) { try { G.setSub(n, s); nsub++; } catch (e) {} }
      if (c) { try { G.setCh(n, c); nch++; } catch (e) {} }
    });

    /* ③ 旧名字残留：清掉改名前那批的科目/章归属 */
    var REN = T.renamed || {};
    Object.keys(REN).forEach(function (o) {
      try { G.setSub(o, ''); } catch (e) {}
      try { G.setCh(o, ''); } catch (e) {}
    });

    /* ④ 题目上的旧人文标签并档。必须放在 ③b 之前：并档要靠 tagsub 里「这个旧标签属于人文」
       来判断该并到哪一类，③b 会把这些键清掉。 */
    var mh = 0;
    try { mh = migrateHuman(T, vocab); } catch (e) { console.warn('[taxload] 人文并档失败', e); }
    try { localStorage.setItem(HRVER_KEY, HRVER); } catch (e) {}

    /* ③b 词表外的残留键（旧标签、测试标签）一并清掉，避免 taxCh/taxSub 走 override 走偏。 */
    var keep = {};
    vocab.forEach(function (n) { keep[n] = 1; });
    [['qbank.tagsub.v1', 'setSub'], ['qbank.tagchap.v1', 'setCh']].forEach(function (pair) {
      var m = readObj(pair[0]);
      Object.keys(m).forEach(function (k) {
        if (!keep[k]) { try { G[pair[1]](k, ''); } catch (e) {} }
      });
    });

    /* ④ 已经在 ③b 之前做完了 */

    G.rememberVocab(names);
    try { G.save(); } catch (e) {}
    try { localStorage.setItem('qbank.taxver.v1', T.version); } catch (e) {}

    var msg = '已按三级索引重设词表：' + names.length + ' 个考点 / ' + (T.chapters_count || 0) + ' 个一级章（归科 ' + nsub + '，归章 ' + nch + (mh ? '，人文并档 ' + mh + ' 题' : '') + '）';
    if (typeof toast === 'function') toast(msg);
    console.log('[taxload] ' + msg + ' v' + T.version);
    return names.length;
  }
  window.taxImport = importTax;

  function go () {
    var n = importTax(false);
    if (n > 0) {
      try { if (typeof window.statsRerender === 'function') window.statsRerender(); } catch (e) {}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else setTimeout(go, 0);
})();
