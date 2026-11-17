/* polifix.js — 政治题自动识别与迁移（2026-11-17）
   背景：老的 AI 打标只有一个「人文」科，政治题被一并打成人文。
   这里用「政治强特征词」判题，命中就把题的基本标签改成「政治」，
   并按特征词归到 马原 / 毛中特 / 新思想 / 史纲 / 时政 五个一级章之一。

   判据刻意保守：
   - 至少命中 2 个特征词，或命中 1 个「强标记」（>=6 字的长专名）；
   - 题面里出现医学/人文强词（患者、医患、执业医师法……）时，除非命中 >=2 个政治词，否则不判；
   - 已经是「政治」的题不动。
   幂等：重复跑不会重复改。
*/
(function () {
  'use strict';
  var BASIC = ['生理', '生化', '病理', '内科', '外科', '人文', '政治'];

  var RULES = [
    ['新思想', ['习近平新时代中国特色社会主义思想', '中国梦', '五位一体', '四个全面', '新发展理念', '高质量发展',
      '全过程人民民主', '人类命运共同体', '一带一路', '共同富裕', '全面从严治党', '中国式现代化', '乡村振兴',
      '生态文明建设', '总体国家安全观', '全面深化改革', '新发展格局', '文化自信', '人民至上']],
    ['毛中特', ['毛泽东思想', '新民主主义革命', '农村包围城市', '三大法宝', '过渡时期总路线', '社会主义改造',
      '邓小平理论', '三个代表', '科学发展观', '社会主义初级阶段', '一国两制', '社会主义市场经济体制',
      '改革开放', '实事求是', '群众路线', '独立自主']],
    ['马原', ['唯物史观', '唯物辩证法', '剩余价值', '商品二因素', '资本有机构成', '生产力与生产关系', '上层建筑',
      '实践是检验真理', '矛盾的普遍性', '质量互变', '否定之否定', '价值规律', '劳动力商品', '级差地租',
      '社会再生产', '空想社会主义', '共产主义', '辩证唯物主义', '历史唯物主义', '意识形态', '使用价值', '抽象劳动']],
    ['史纲', ['鸦片战争', '太平天国', '洋务运动', '戊戌变法', '辛亥革命', '五四运动', '中共一大', '遵义会议',
      '长征', '抗日战争', '解放战争', '新中国成立', '三大改造', '十一届三中全会', '中国特色社会主义进入新时代',
      '新文化运动', '义和团', '百日维新', '中华民国']],
    ['时政', ['二十届', '党的二十大', '全国两会', '政府工作报告', '中央经济工作会议', '神舟', '嫦娥', '进博会',
      '碳达峰', '碳中和', '十四五', '十五五', '一带一路高峰论坛', '金砖', '上合组织', '博鳌']]
  ];

  /* 单独一个词就足够判政治（本身不可能出现在别的科的题里） */
  var STRONG1 = ['剩余价值', '唯物史观', '唯物辩证法', '资本有机构成', '新民主主义革命', '社会主义改造',
    '邓小平理论', '三个代表', '科学发展观', '习近平新时代中国特色社会主义思想', '五位一体', '四个全面',
    '新发展理念', '人类命运共同体', '辛亥革命', '鸦片战争', '遵义会议', '十一届三中全会', '二十大',
    '中国式现代化', '全过程人民民主', '共同富裕', '全面从严治党', '一带一路', '高质量发展', '乡村振兴',
    '空想社会主义', '商品二因素', '劳动力商品', '级差地租', '社会再生产', '质量互变', '否定之否定',
    '主要矛盾', '实事求是', '群众路线', '一国两制', '社会主义市场经济', '社会主义初级阶段'];

  /* 医学 / 人文强词：命中说明更像人文题，不轻易判政治 */
  var MED = ['患者', '病人', '医师', '医院', '临床', '诊断', '治疗', '医患', '知情同意', '医疗事故',
    '执业医师法', '医学伦理', '疾病', '症状', '手术', '药物', '护理', '病历', '传染病防治'];

  function textOf(q) {
    if (!q) return '';
    var s = String(q.stem || q.title || '');
    var o = q.options;
    if (o) {
      if (Array.isArray(o)) s += ' ' + o.map(function (x) { return (x && x.text) || x || ''; }).join(' ');
      else Object.keys(o).forEach(function (k) { s += ' ' + o[k]; });
    }
    if (q.explain) s += ' ' + String(q.explain).slice(0, 200);
    return s;
  }

  /* 返回 {chapter, hits, med} 或 null */
  function detect(q) {
    var t = textOf(q);
    if (!t || t.length < 6) return null;
    var best = null;
    var total = 0;
    var med = 0;
    MED.forEach(function (w) { if (t.indexOf(w) >= 0) med++; });
    RULES.forEach(function (pair) {
      var ch = pair[0], words = pair[1], hits = 0, strong = 0, first = '';
      words.forEach(function (w) {
        if (t.indexOf(w) >= 0) { hits++; if (!first) first = w; if (w.length >= 6) strong++; }
      });
      total += hits;
      if (hits && (!best || hits > best.hits)) best = { chapter: ch, hits: hits, strong: strong, first: first };
    });
    if (!best) return null;
    var strong1 = '';
    for (var i = 0; i < STRONG1.length; i++) { if (t.indexOf(STRONG1[i]) >= 0) { strong1 = STRONG1[i]; break; } }
    if (med > 0 && best.hits < 2) return null;
    if (best.hits < 2 && !best.strong && !strong1) return null;
    return { chapter: best.chapter, hits: best.hits, med: med, first: best.first || strong1, strong1: strong1 };
  }

  /* 关键词 -> 二级考点（在该章的 secs 里按名字找；找不到就退回 2-gram） */
  var KW_SEC = [
    [['五位一体', '总体布局'], '总体布局'],
    [['四个全面', '战略布局'], '战略布局'],
    [['新发展理念', '高质量发展', '新发展格局'], '高质量发展'],
    [['全过程人民民主', '人民民主'], '人民民主'],
    [['人类命运共同体', '一带一路'], '人类命运共同体'],
    [['中国式现代化'], '中国式现代化'],
    [['全面从严治党', '党的建设'], '全面从严治党'],
    [['乡村振兴'], '乡村振兴'],
    [['共同富裕'], '共同富裕'],
    [['习近平新时代', '习近平新时代中国特色社会主义思想'], '新时代'],
    [['毛泽东思想', '新民主主义革命理论'], '毛泽东思想'],
    [['邓小平理论'], '邓小平理论'],
    [['三个代表'], '三个代表'],
    [['科学发展观'], '科学发展观'],
    [['社会主义改造', '过渡时期'], '社会主义改造'],
    [['剩余价值', '资本有机构成', '商品二因素', '价值规律', '劳动力商品', '使用价值', '抽象劳动', '社会再生产'], '资本主义的本质'],
    [['垄断', '帝国主义', '经济危机'], '资本主义的发展'],
    [['唯物', '物质', '意识', '辩证法', '矛盾', '质量互变', '否定之否定'], '世界的物质性'],
    [['实践', '认识', '真理', '感性认识', '理性认识'], '实践与认识'],
    [['生产力', '生产关系', '上层建筑', '阶级', '国家', '社会形态', '改革'], '人类社会'],
    [['共产主义', '自由王国'], '共产主义'],
    [['社会主义', '苏联'], '社会主义的发展'],
    [['鸦片战争'], '鸦片战争'],
    [['辛亥革命'], '辛亥革命'],
    [['五四运动'], '五四运动'],
    [['遵义会议'], '遵义会议'],
    [['抗日战争'], '抗日战争'],
    [['十一届三中全会'], '十一届三中全会']
  ];

  function pickSec(secs, text) {
    for (var i = 0; i < KW_SEC.length; i++) {
      var kws = KW_SEC[i][0], pat = KW_SEC[i][1], hit = false;
      for (var j = 0; j < kws.length; j++) { if (text.indexOf(kws[j]) >= 0) { hit = true; break; } }
      if (!hit) continue;
      for (var m = 0; m < secs.length; m++) {
        if (String(secs[m]).indexOf(pat) >= 0) return secs[m];
      }
    }
    return pickSecByGram(secs, text);
  }

  function pickSecByGram(secs, text) {
    var best = secs[0], bestN = 0;
    secs.forEach(function (nm) {
      var n = 0;
      for (var i = 0; i + 2 <= nm.length; i++) {
        if (text.indexOf(nm.slice(i, i + 2)) >= 0) n++;
      }
      if (n > bestN) { bestN = n; best = nm; }
    });
    return best;
  }

  function basicOf(list) {
    for (var i = 0; i < list.length; i++) if (BASIC.indexOf(list[i]) >= 0) return list[i];
    return '';
  }

  function banksReady() {
    try { return typeof window.baseBanks === 'function' ? window.baseBanks() : []; } catch (e) { return []; }
  }

  function run(opts) {
    opts = opts || {};
    var TAGS = window.TAGS, TAX = window.TAX;
    if (!TAGS || !TAX) return { ok: false, err: 'TAGS / TAX 未就绪' };
    var banks = banksReady();
    if (!banks.length) return { ok: false, err: '题库还没加载完' };
    var changed = 0, scanned = 0, byCh = {}, samples = [];
    banks.forEach(function (b) {
      (b.questions || []).forEach(function (q) {
        var k = b.id + '#' + q.id;
        var cur = TAGS.of(k);
        var bs = basicOf(cur);
        if (bs === '政治') return;                 /* 已经是政治，不动 */
        var hit = detect(q);
        if (!hit) return;
        var t = textOf(q);
        scanned++;
        /* 章名以 taxonomy 为准（政治只有 5 个二级：章名即二级） */
        var ch = hit.chapter;
        var secs = [];
        try { secs = TAX.secs ? TAX.secs('政治', ch) : []; } catch (e) {}
        var l2 = (secs && secs.length) ? pickSec(secs, t) : ch;
        var keep = cur.filter(function (t) {
          if (BASIC.indexOf(t) >= 0) return false;
          try { return TAX.subOf(t) === '政治'; } catch (e) { return false; }
        });
        var next = ['政治', l2].concat(keep).filter(function (t, i, a) { return a.indexOf(t) === i; });
        TAGS.set(k, next, true);
        changed++;
        byCh[ch] = (byCh[ch] || 0) + 1;
        if (samples.length < 5) samples.push({ k: k, ch: ch, hit: hit.first, stem: String(q.stem || '').slice(0, 30) });
      });
    });
    if (changed) {
      try { TAGS.save(); } catch (e) {}
      try { window.tagReload && window.tagReload(); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('qbank:tags-changed')); } catch (e) {}
      if (typeof toast === 'function') toast('已把 ' + changed + ' 道政治题从人文改成「政治」' + (opts.silent ? '' : ''), 4000);
    } else if (!opts.silent) {
      if (typeof toast === 'function') toast('没找到需要改判的政治题');
    }
    return { ok: true, changed: changed, scanned: scanned, byCh: byCh, samples: samples };
  }

  window.__polDetect = detect;
  window.polFix = run;

  /* 题库异步从 IndexedDB 回来：等它就绪后自动跑一次（每页只跑一次） */
  var tries = 0;
  function auto() {
    var banks = banksReady();
    if (banks.length) { run({ silent: false }); return; }
    if (++tries > 12) return;
    setTimeout(auto, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(auto, 900); });
  else setTimeout(auto, 900);
})();
