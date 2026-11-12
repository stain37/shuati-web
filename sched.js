/* ============================================================
   刷题站 · Anki 自研调度核心（阶段 1）
   - 纯函数：一次评分 = 一次状态迁移，无副作用
   - 与 collection.anki2 的字段语义对齐（type/queue/due/ivl/factor/left）
   - 依赖：无（浏览器 <script> 直接引入，node 里 require 也能跑测试）
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ANKI_SCHED = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SEP = '\x1f';

  /* ---------- 字段编解码 ---------- */

  function encodeFields(values) {
    var arr = values.slice();
    for (var i = 0; i < arr.length; i++) {
      var v = String(arr[i] == null ? '' : arr[i]);
      if (v.indexOf(SEP) >= 0) throw new Error('field ' + i + ' contains 0x1f');
      arr[i] = v;
    }
    return arr.join(SEP);
  }

  function decodeFields(flds, nFields) {
    var parts = String(flds == null ? '' : flds).split(SEP);
    if (parts.length > nFields) throw new Error('flds has ' + parts.length + ' parts, notetype has ' + nFields);
    while (parts.length < nFields) parts.push('');
    return parts;
  }

  /* ordOf[i] = 第 i 个值应该落到哪个字段序号 */
  function orderByOrd(values, ordOf) {
    var out = new Array(values.length);
    for (var i = 0; i < values.length; i++) {
      var o = ordOf[i];
      if (o == null || o < 0 || o >= values.length) throw new Error('bad ord at ' + i);
      out[o] = values[i];
    }
    return out;
  }

  /* guid：内容寻址（同内容 → 同 guid）。字母表与 Anki 的 base91 一致 */
  var B91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
  function guidFor() {
    var fields = Array.prototype.slice.call(arguments);
    var table = [0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < fields.length; i++) {
      var s = String(fields[i] == null ? '' : fields[i]);
      for (var c = 0; c < s.length; c++) {
        var code = s.charCodeAt(c);
        table[code % 8] += code;
        table[(code >> 3) % 8] += code;
      }
    }
    var out = '';
    for (var k = 0; k < 8; k++) out += B91[table[k] % B91.length];
    return out;
  }

  /* ---------- 状态 ---------- */

  /* type: 0 新 / 1 学习 / 2 复习 / 3 重新学习
     queue: 0/1/2/3 与 type 对齐；-1 暂停；-2/-3 buried
     due: 新卡=队列位次；学习/重学=epoch 秒；复习=相对 crt 的天数
     left: 学习阶段剩余步数（含当前这一步） */
  function makeState(o) {
    return {
      type: o.type | 0,
      queue: o.queue | 0,
      due: o.due | 0,
      ivl: o.ivl | 0,
      factor: o.factor == null ? 2500 : (o.factor | 0),
      reps: o.reps || 0,
      lapses: o.lapses || 0,
      left: o.left | 0,
      data: o.data || null
    };
  }

  function checkState(s) {
    var errs = [];
    if (s.type === 0) {
      if (s.queue !== 0) errs.push('new card queue != 0');
      if (s.ivl !== 0) errs.push('new card ivl != 0');
    } else if (s.type === 1 || s.type === 3) {
      if (s.queue !== s.type) errs.push('learn card queue/type mismatch');
      if (!(s.left > 0)) errs.push('learn card left <= 0');
    } else if (s.type === 2) {
      if (s.queue !== 2) errs.push('review card queue != 2');
      if (!(s.ivl >= 1)) errs.push('review card ivl < 1');
      if (s.left !== 0) errs.push('review card left != 0');
    } else {
      errs.push('unknown type ' + s.type);
    }
    if (!(s.factor >= 1300)) errs.push('factor < 1300');
    return errs;
  }

  /* ---------- 配置 ---------- */

  var DEFAULT_DECK = {
    learn_steps: [1, 10],
    relearn_steps: [10],
    graduating_interval: 1,
    easy_interval: 4,
    easy_bonus: 1.3,
    hard_multiplier: 1.2,
    lapse_multiplier: 0,        // 0 = 回落 min_interval（Anki 默认 0%）
    min_interval: 1,
    max_interval: 36500,
    starting_ease: 2.5,
    new_interval_multiplier: 0  // 重学毕业：max(min, pre_lapse * 0)
  };

  function cfgWith(base, over) {
    var c = {}, k;
    for (k in base) c[k] = base[k];
    if (over) for (k in over) c[k] = over[k];
    return c;
  }

  function clampFactor(f) { return Math.max(1300, f); }

  function clampIvl(ivl, cfg) {
    return Math.min(cfg.max_interval, Math.max(cfg.min_interval, Math.round(ivl)));
  }

  function graduate(s, cfg, today, crtDay, ivl) {
    s.type = 2; s.queue = 2; s.left = 0;
    s.ivl = clampIvl(ivl, cfg);
    s.due = (today - crtDay) + s.ivl;
    return s;
  }

  /**
   * 一次评分。
   * @param {object} state 卡片状态（不改原对象，返回新对象）
   * @param {number} rating 1=Again 2=Hard 3=Good 4=Easy
   * @param {number} now epoch 秒
   * @param {object} cfg DeckConfig（缺省用 DEFAULT_DECK）
   * @param {object} ctx { today, crtDay, preLapseIvl }
   */
  function answer(state, rating, now, cfg, ctx) {
    if (rating < 1 || rating > 4) throw new Error('rating must be 1..4');
    cfg = cfgWith(DEFAULT_DECK, cfg);
    ctx = ctx || {};
    var crtDay = ctx.crtDay != null ? Math.round(ctx.crtDay) : Math.floor(now / 86400);
    var today = ctx.today != null ? Math.round(ctx.today) : Math.floor(now / 86400);
    var before = makeState(state);
    var s = makeState(state);
    var steps, idx, next;

    s.reps = (before.reps || 0) + 1;

    /* ---- 新卡：先给第一个学习步，Easy 直接毕业 ---- */
    if (s.type === 0) {
      steps = cfg.learn_steps;
      if (rating === 4) {
        graduate(s, cfg, today, crtDay, cfg.easy_interval);
        return s;
      }
      if (rating === 1) {
        s.type = 1; s.queue = 1; s.left = steps.length;
        s.due = now + steps[0] * 60;
        return s;
      }
      /* Hard 与 Good 相同（Anki 新卡不区分 Hard） */
      if (steps.length <= 1) {
        graduate(s, cfg, today, crtDay, cfg.graduating_interval);
        return s;
      }
      s.type = 1; s.queue = 1; s.left = steps.length - 1;
      s.due = now + steps[1] * 60;
      return s;
    }

    /* ---- 学习卡：idx 是当前步 ---- */
    if (s.type === 1) {
      steps = cfg.learn_steps;
      idx = Math.max(0, steps.length - s.left);
      if (rating === 1) {
        s.left = steps.length;
        s.due = now + steps[0] * 60;
        return s;
      }
      if (rating === 2) {
        var a = steps[idx];
        var b = steps[idx + 1];
        var gap = (b != null) ? Math.floor((a + b) / 2) : Math.max(1, Math.round(a * 1.5));
        s.due = now + Math.max(1, gap) * 60;
        return s;
      }
      if (rating === 3) {
        next = idx + 1;
        if (next >= steps.length) {
          graduate(s, cfg, today, crtDay, cfg.graduating_interval);
          return s;
        }
        s.left = steps.length - next;
        s.due = now + steps[next] * 60;
        return s;
      }
      graduate(s, cfg, today, crtDay, cfg.easy_interval);
      return s;
    }

    /* ---- 复习卡：late 按「到期天」算，加在旧间隔上 ---- */
    if (s.type === 2) {
      var dueDay = crtDay + before.due;
      var late = Math.max(0, today - dueDay);
      var f = before.factor || 2500;
      var ivl = before.ivl;

      if (rating === 1) {
        s.lapses = (before.lapses || 0) + 1;
        s.factor = clampFactor(f - 200);
        s.ivl = clampIvl(Math.max(cfg.min_interval, Math.round(ivl * cfg.lapse_multiplier)), cfg);
        s.type = 3; s.queue = 3;
        s.left = cfg.relearn_steps.length;
        s.due = now + cfg.relearn_steps[0] * 60;
        return s;
      }
      if (rating === 2) {
        ivl = (ivl + late / 4) * cfg.hard_multiplier;
        s.factor = clampFactor(f - 150);
      } else if (rating === 3) {
        ivl = (ivl + late / 2) * (f / 1000);
        s.factor = f;
      } else {
        ivl = (ivl + late) * (f / 1000) * cfg.easy_bonus;
        s.factor = f + 150;
      }
      s.ivl = clampIvl(ivl, cfg);
      s.due = (today - crtDay) + s.ivl;
      return s;
    }

    /* ---- 重新学习 ---- */
    if (s.type === 3) {
      steps = cfg.relearn_steps;
      idx = Math.max(0, steps.length - s.left);
      if (rating === 1) {
        s.left = steps.length;
        s.due = now + steps[0] * 60;
        return s;
      }
      if (rating === 4) {
        var preE = ctx.preLapseIvl != null ? ctx.preLapseIvl : before.ivl;
        graduate(s, cfg, today, crtDay, Math.max(cfg.min_interval, preE * cfg.new_interval_multiplier));
        return s;
      }
      next = idx + 1;
      if (next >= steps.length) {
        var pre = ctx.preLapseIvl != null ? ctx.preLapseIvl : before.ivl;
        graduate(s, cfg, today, crtDay, Math.max(cfg.min_interval, pre * cfg.new_interval_multiplier));
        return s;
      }
      s.left = steps.length - next;
      s.due = now + steps[next] * 60;
      return s;
    }

    throw new Error('unknown card type ' + s.type);
  }

  return {
    SEP: SEP,
    encodeFields: encodeFields,
    decodeFields: decodeFields,
    orderByOrd: orderByOrd,
    guidFor: guidFor,
    makeState: makeState,
    checkState: checkState,
    DEFAULT_DECK: DEFAULT_DECK,
    answer: answer
  };
});
