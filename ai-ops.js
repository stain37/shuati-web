/* ============================================================
   ai-ops.js — AI 站内操作执行核
   ------------------------------------------------------------
   一条写通道：
     意图解析（chat.js）→ AI_OPS.preview（dry，影子参数物化）
     → 用户在预览卡上确认 → AI_OPS.execute（WAL + 幂等 + 补偿）
     → 事后 AI_OPS.undoPlan（版本校验，冲突保留手动值）

   约定：
   - 动作 handler 只写一次 run(ctx, params)：
       ctx.mode === 'dry'   只算影响面，绝不写
       ctx.mode === 'apply' 先 ctx.capture(keys) 落 WAL，再写
   - 预览和执行的参数是同一份「物化后参数」：预览看到多少题，执行就是多少题
   - 动作只调 service / 全局 store，不点 DOM
   - 文件类 R0 只读，不进 WAL；外发/系统级不自动
   ============================================================ */
(function () {
  'use strict';

  var K = {
    wal: 'qbank.aiops.wal.v1',
    plans: 'qbank.aiops.plans.v1',
    audit: 'qbank.aiops.audit.v1',
    steps: 'qbank.aiops.steps.v1',
    lock: 'qbank.aiops.lock.v1',
    kill: 'qbank.aiops.kill.v1',
    ticket: 'qbank.aiops.ticket.v1',   /* 旧字段保留（从未使用）；真正的票据键在 tickets */
    tickets: 'qbank.aiops.tickets.v1',
    ver: 'qbank.state.ver.v1'          /* 数据版本号：票据 fencing + 多标签页漂移检测 */
  };
  var TTL = 5 * 60 * 1000;          /* 预览确认有效期 */
  var LOCK_TTL = 120 * 1000;        /* 计划级锁 */
  var MAX_STEPS = 20;
  var MAX_WAL = 120;
  var MAX_PLANS = 50;
  var MAX_AUDIT = 300;
  var MAX_STEP_CACHE = 400;
  var RISK = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

  /* ---------------- 存储 ---------------- */
  function read(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function writeStrict(k, v, what) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { throw new Error((what || '数据') + '写入失败：浏览器存储可能满了，已中止（没有改动数据）'); }
  }
  function hash(s) {
    s = String(s == null ? '' : s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = stable(v[k]); });
      return o;
    }
    return v;
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function now() { return Date.now(); }
  function uuid() { return 'p' + now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function valHash(v) { return hash(v == null ? '\u0000' : String(v)); }
  function msgOf(e) { return (e && e.message) ? e.message : String(e || '未知错误'); }
  function uniq(a) { var o = {}, r = []; (a || []).forEach(function (x) { if (x != null && !o[x]) { o[x] = 1; r.push(x); } }); return r; }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }

  /* ---------------- 版本号 fencing ---------------- */
  /* 约定：任何一次「业务数据落地」都把 qbank.state.ver.v1 加一，并记下 by（谁写的）。
     票据里存 baseVer：预览之后别人动过数据，执行就拒绝；执行中每步前再校验一次，
     防止两个标签页 / 两轮 AI 计划交叉写。外部脚本若直接写业务键，可调 AI_OPS.bumpVer() 参与进来。 */
  function readVer() {
    var v = read(K.ver, null);
    if (!v || typeof v !== 'object' || typeof v.v !== 'number') return { v: 0, by: null, ts: 0 };
    return { v: v.v, by: v.by || null, ts: v.ts || 0 };
  }
  function bumpVer(by) {
    var cur = readVer();
    var nv = { v: (cur.v || 0) + 1, by: by || null, ts: now() };
    write(K.ver, nv);
    return nv;
  }
  function verDrift(expect) {
    var cur = readVer();
    if (cur.v === expect) return null;
    return '数据在你确认后又被改过（版本 ' + expect + ' → ' + cur.v + (cur.by ? '，来源：' + cur.by : '') + '）';
  }

  /* ---------------- 注册表 ---------------- */
  var actions = {};
  function register(def) {
    if (!def || !def.id || typeof def.run !== 'function') throw new Error('动作需要 id 和 run(ctx, params)');
    var a = {
      id: def.id,
      title: def.title || def.id,
      risk: def.risk || 'R1',
      reversible: def.reversible !== false,
      readOnly: !!def.readOnly,
      hidden: !!def.hidden,
      paramsHint: def.paramsHint || '',
      resolve: def.resolve || null,
      /* 失败是否自动回滚（§18 Q6）：R3 默认不自动回滚，破坏性步骤留人工确认 */
      autoCompensate: def.autoCompensate == null ? ((def.risk || 'R1') !== 'R3') : !!def.autoCompensate,
      run: def.run
    };
    actions[a.id] = a;
    return a;
  }
  function alias(id, targetId) {
    var t = actions[targetId];
    if (!t) return;
    actions[id] = {
      id: id, title: t.title, risk: t.risk, reversible: t.reversible, readOnly: t.readOnly,
      hidden: true, paramsHint: t.paramsHint, resolve: t.resolve, autoCompensate: t.autoCompensate, run: t.run
    };
  }
  function getAction(id) { return actions[id] || null; }
  function maxRisk(steps) {
    var m = 'R0';
    (steps || []).forEach(function (s) {
      var a = getAction(s.action);
      if (a && RISK[a.risk] > RISK[m]) m = a.risk;
    });
    return m;
  }
  function planReversible(steps) {
    var ok = true;
    (steps || []).forEach(function (s) { var a = getAction(s.action); if (a && a.reversible === false) ok = false; });
    return ok;
  }

  function normalize(plan) {
    var steps = Array.isArray(plan) ? plan : (plan && plan.steps);
    if (!Array.isArray(steps) || !steps.length) throw new Error('计划是空的');
    if (steps.length > MAX_STEPS) throw new Error('一次最多 ' + MAX_STEPS + ' 步，请拆开');
    return steps.map(function (s, i) {
      if (!s || !s.action) throw new Error('第 ' + (i + 1) + ' 步没有动作');
      if (!actions[s.action]) throw new Error('第 ' + (i + 1) + ' 步动作不支持：' + s.action);
      return { action: s.action, params: clone(s.params || {}), index: i };
    });
  }
  function hashPlan(steps) {
    return hash(JSON.stringify(stable((steps || []).map(function (s) {
      return { action: s.action, params: s.params || {} };
    }))));
  }
  function stepId(planId, step, index) {
    return hash(planId + ':' + (index == null ? step.index : index) + ':' + step.action + ':' + JSON.stringify(stable(step.params || {})));
  }

  /* ---------------- WAL ---------------- */
  function walFullyCompensated(e) {
    if (!e) return false;
    if (e.status === 'compensated') return true;
    return !!(e.keys && e.keys.length && e.keys.every(function (k) { return k.compensated; }));
  }
  function trySaveWal(wal) {
    try { localStorage.setItem(K.wal, JSON.stringify(wal)); return true; } catch (e) { return false; }
  }
  /* 严格模式用于「写前落盘」：失败必须抛错，绝不能让业务数据先写下去 */
  function saveWal(wal, strict) {
    wal = wal || [];
    while (wal.length > MAX_WAL) wal.shift();
    if (trySaveWal(wal)) return true;
    /* 存储满了：先丢最老的已补偿记录，再试 */
    var guard = 0;
    while (wal.length > 0 && guard++ < MAX_WAL) {
      var i = -1;
      for (var j = 0; j < wal.length; j++) { if (walFullyCompensated(wal[j])) { i = j; break; } }
      if (i < 0) break;
      wal.splice(i, 1);
      if (trySaveWal(wal)) return true;
    }
    if (strict) throw new Error('撤销日志写入失败：浏览器存储可能满了。为了不丢数据，这次操作已中止（没有改动）。');
    return false;
  }

  function makeCtx(planId, step, sid, mode, virtual) {
    var ctx = {
      mode: mode,
      planId: planId,
      stepId: sid,
      seq: step.index + 1,
      virtual: virtual || {},
      capture: function (keys) {
        if (mode !== 'apply') throw new Error('dry 模式不能 capture');
        keys = uniq((keys || []).filter(function (k) { return typeof k === 'string' && k; }));
        if (!keys.length) return [];
        var wal = read(K.wal, []);
        var ent = null;
        for (var i = wal.length - 1; i >= 0; i--) {
          if (wal[i].id === sid && wal[i].status === 'running') { ent = wal[i]; break; }
        }
        if (!ent) {
          ent = {
            id: sid, planId: planId, seq: step.index + 1, action: step.action,
            risk: (getAction(step.action) || {}).risk || 'R1',
            keys: [], status: 'running', committed: false, ts: now()
          };
          wal.push(ent);
        }
        var have = {};
        ent.keys.forEach(function (k) { have[k.key] = 1; });
        keys.forEach(function (key) {
          if (have[key]) return;
          var before = localStorage.getItem(key);
          ent.keys.push({ key: key, before: before, beforeHash: valHash(before), afterHash: null, compensated: false });
        });
        saveWal(wal, true);
        return ent.keys.map(function (k) { return { key: k.key, before: k.before }; });
      }
    };
    return ctx;
  }

  function finalizeStep(sid, ok) {
    var wal = read(K.wal, []);
    var hit = false;
    wal.forEach(function (e) {
      if (e.id !== sid) return;
      hit = true;
      (e.keys || []).forEach(function (k) {
        k.afterHash = valHash(localStorage.getItem(k.key));
      });
      e.status = ok ? 'committed' : 'failed';
      e.committed = !!ok;
      e.ts = now();
    });
    if (hit) saveWal(wal, false);
  }

  function restoreEntry(e) {
    var conflicts = [], restored = 0;
    (e.keys || []).forEach(function (k) {
      if (k.compensated) return;
      var cur = localStorage.getItem(k.key);
      if (k.afterHash && valHash(cur) !== k.afterHash) {
        conflicts.push({ key: k.key, reason: 'changed_after_action' });
        return;
      }
      try {
        if (k.before == null) localStorage.removeItem(k.key);
        else localStorage.setItem(k.key, k.before);
        k.compensated = true;
        restored++;
      } catch (err) {
        conflicts.push({ key: k.key, reason: 'write_failed' });
      }
    });
    return { conflicts: conflicts, restored: restored };
  }

  /* ---------------- 锁 / 审计 ---------------- */
  function acquireLock(planId) {
    var lock = read(K.lock, null);
    if (lock && lock.until > now() && lock.planId !== planId) return false;
    write(K.lock, { planId: planId, until: now() + LOCK_TTL });
    return true;
  }
  function releaseLock(planId) {
    var lock = read(K.lock, null);
    if (!lock || lock.planId === planId) write(K.lock, null);
  }
  function audit(entry) {
    var a = read(K.audit, []);
    a.push(entry);
    while (a.length > MAX_AUDIT) a.shift();
    write(K.audit, a);
  }
  function savePlans(plans) {
    while (plans.length > MAX_PLANS) plans.shift();
    write(K.plans, plans);
  }
  function findPlan(plans, id) {
    for (var i = 0; i < plans.length; i++) if (plans[i].id === id) return plans[i];
    return null;
  }

  /* ---------------- 目标物化 ---------------- */
  function banksAll() {
    try {
      if (typeof baseBanks === 'function') return baseBanks();
      if (typeof allBanks === 'function') return allBanks();
      if (Array.isArray(window.__BANKS__)) return window.__BANKS__;
    } catch (e) {}
    return [];
  }
  function bankOf(id) {
    if (id == null) return null;
    try { if (typeof bankById === 'function') { var b = bankById(id); if (b) return b; } } catch (e) {}
    var arr = banksAll();
    for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(id)) return arr[i];
    return null;
  }
  function titleNorm(s) { return String(s == null ? '' : s).replace(/题库$/, '').trim(); }
  function matchBank(title) {
    var q = titleNorm(title);
    if (!q) throw new Error('题库名是空的');
    var list = banksAll().filter(function (b) { return b && !b.paper; });
    var exact = list.filter(function (b) { return titleNorm(b.title) === q; });
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error('有 ' + exact.length + ' 个同名题库《' + title + '》，请改用完整名称或 bankId');
    var part = list.filter(function (b) { return titleNorm(b.title).indexOf(q) >= 0; });
    if (part.length === 1) return part[0];
    if (part.length > 1) throw new Error('「' + title + '」匹配到 ' + part.length + ' 个题库，请写完整名称');
    throw new Error('没找到题库《' + title + '》');
  }
  function currentQ() {
    try {
      var bid = null, qid = null;
      if (typeof QZ !== 'undefined' && QZ && QZ.bankId) { bid = QZ.bankId; qid = QZ.cur; }
      if (!bid) {
        var last = read('qbank.lastbank.v1', null);
        if (last) { bid = last.bankId; qid = last.qid; }
      }
      if (!bid) return null;
      var b = bankOf(bid);
      if (!b) return null;
      var q = null, qs = b.questions || [];
      for (var i = 0; i < qs.length; i++) if (String(qs[i].id) === String(qid)) { q = qs[i]; break; }
      if (!q) q = qs[0];
      if (!q) return null;
      return { bank: b, q: q, index: qs.indexOf(q) };
    } catch (e) { return null; }
  }
  function currentBank() {
    try {
      if (typeof CAT !== 'undefined' && CAT && CAT.cur) {
        var b = bankOf(CAT.cur());
        if (b) return b;
      }
    } catch (e) {}
    var cq = currentQ();
    return cq ? cq.bank : null;
  }
  function targetBanks(p) {
    var out = [], i;
    if (p.bankIds) {
      p.bankIds.forEach(function (id) { var b = bankOf(id); if (b) out.push(b); });
    } else if (p.bankId) {
      var b = bankOf(p.bankId);
      if (b) out.push(b);
    } else if (p.bankTitles) {
      p.bankTitles.forEach(function (t) {
        var bb = matchBank(t);
        if (bb && out.indexOf(bb) < 0) out.push(bb);
      });
    } else if (p.bankTitle) {
      out.push(matchBank(p.bankTitle));
    } else if (typeof p.bank === 'string' && p.bank && p.bank !== '$new' && p.bank !== 'current') {
      out.push(matchBank(p.bank));
    } else if (p.current || p.bank === 'current') {
      var cb = currentBank();
      if (cb) out.push(cb);
    }
    /* 去重 */
    var seen = {}, rs = [];
    out.forEach(function (x) { if (x && !seen[x.id]) { seen[x.id] = 1; rs.push(x); } });
    return rs;
  }
  function selectQs(bank, p) {
    var qs = bank.questions || [], out = [], seen = {};
    function add(q) { if (q && !seen[q.id]) { seen[q.id] = 1; out.push(q); } }
    if (p.qids && p.qids.length) {
      p.qids.forEach(function (id) {
        for (var i = 0; i < qs.length; i++) if (String(qs[i].id) === String(id)) { add(qs[i]); return; }
      });
    } else if (p.currentQ) {
      var cq = currentQ();
      if (cq && String(cq.bank.id) === String(bank.id)) add(cq.q);
    } else if (p.nums && p.nums.length) {
      p.nums.forEach(function (n) { var q = qs[n - 1]; if (q) add(q); });
    } else if (p.wrong) {
      var ANS = ansData();
      qs.forEach(function (q) { var a = ANS[bank.id + '#' + q.id]; if (a && (a.wrong || 0) > 0) add(q); });
    } else if (p.all) {
      qs.forEach(add);
    }
    return out;
  }
  /* 计划内顺序预演：记录前面步骤删掉的题，后面的步骤预览时就不再把它们算进去 */
  function mergeVirtual(dst, src) {
    if (!dst || !src) return dst;
    if (src.newBank) dst.newBank = src.newBank;
    if (src.deleted) (src.deleted || []).forEach(function (k) { dst.deleted[k] = 1; });
    return dst;
  }
  /* 把「题库名 / 第几题 / 错题 / 全部」变成固定 id 列表，写回 params。
     预览和执行用的是同一份 target，不会再出现「预览 12 题、执行删 30 题」。 */
  function materialize(ctx, p, opts) {
    opts = opts || {};
    if (opts.defaultAll && !p.qids && !p.nums && !p.wrong && !p.currentQ && !p.all) p.all = true;
    if (p.bank === '$new' || p.bankId === '$new' || p.bankRef === '$new') {
      var vb = ctx.virtual && ctx.virtual.newBank;
      if (!vb) throw new Error('上一步没有创建新题库，不能对它操作');
      p.targets = [{ bankId: vb.id, title: vb.title, qids: (vb.qids || []).slice(), nums: [] }];
      p.virtualBank = true;
      return p;
    }
    var banks = p.allBanks ? banksAll() : targetBanks(p);
    if (!banks.length) throw new Error('没找到题库（说《题库名》，或先打开一道题说「这道题」）');
    var targets = [];
    banks.forEach(function (b) {
      var qs = selectQs(b, p);
      if (!qs.length) return;
      targets.push({
        bankId: b.id,
        title: b.title,
        qids: qs.map(function (q) { return q.id; }),
        nums: qs.map(function (q) { return (b.questions || []).indexOf(q) + 1; })
      });
    });
    if (ctx.virtual && ctx.virtual.deleted) {
      targets.forEach(function (t) {
        var pairs = (t.qids || []).map(function (id, i) { return { id: id, num: (t.nums || [])[i] }; });
        pairs = pairs.filter(function (x) { return !ctx.virtual.deleted[t.bankId + '#' + x.id]; });
        t.qids = pairs.map(function (x) { return x.id; });
        t.nums = pairs.map(function (x) { return x.num; });
      });
      targets = targets.filter(function (t) { return t.qids.length; });
    }
    if (!targets.length) {
      if (opts.allowEmpty) { p.targets = []; return p; }
      throw new Error('没有符合条件的题目');
    }
    p.targets = targets;
    delete p.bankTitle; delete p.bankTitles; delete p.bankIds; delete p.bankId;
    delete p.nums; delete p.qids; delete p.wrong; delete p.all; delete p.currentQ; delete p.current; delete p.bank;
    return p;
  }
  function targetCount(p) {
    var n = 0;
    (p.targets || []).forEach(function (t) { n += (t.qids || []).length; });
    return n;
  }
  function targetNames(p) {
    return (p.targets || []).map(function (t) { return '《' + t.title + '》'; }).join('、');
  }
  function targetQids(p) {
    var out = [];
    (p.targets || []).forEach(function (t) { out = out.concat(t.qids || []); });
    return out;
  }
  function ansData() {
    try { if (typeof ANS !== 'undefined' && ANS) return ANS; } catch (e) {}
    return read('qbank.answers.v2', {}) || {};
  }
  function favData() {
    try { if (typeof FAV !== 'undefined' && FAV) return FAV; } catch (e) {}
    return read('qbank.favs.v2', {}) || {};
  }
  function saveAnsSafe() { try { if (typeof saveAns === 'function') saveAns(); } catch (e) {} }
  function saveFavSafe() { try { if (typeof saveFav === 'function') saveFav(); } catch (e) {} }
  function tomb(type, k) { try { if (typeof tombAdd === 'function') tombAdd(type, k); } catch (e) {} }
  function invalidate() { try { if (typeof invalidateBanks === 'function') invalidateBanks(); } catch (e) {} }
  function writeBanks(arr) { try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', arr); } catch (e) {} }

  /* ---------------- 预览 / 执行 ---------------- */
  async function preview(plan) {
    var steps;
    try { steps = normalize(plan); } catch (e) { return { ok: false, error: msgOf(e) }; }
    var baseVer = readVer().v;   /* 预览这一刻的数据版本；执行时要求版本不变 */
    var virtual = { deleted: {} }, out = [];
    for (var i = 0; i < steps.length; i++) {
      var def = getAction(steps[i].action);
      var ctx = { mode: 'dry', planId: 'preview', seq: i + 1, virtual: virtual, capture: function () { throw new Error('dry 模式不能 capture'); } };
      var p = clone(steps[i].params);
      try {
        if (def.resolve) p = (await def.resolve(ctx, p)) || p;
        var r = await def.run(ctx, p);
      } catch (e) {
        return { ok: false, error: '第 ' + (i + 1) + ' 步（' + def.title + '）：' + msgOf(e) };
      }
      if (!r || r.ok === false) {
        return { ok: false, error: '第 ' + (i + 1) + ' 步（' + def.title + '）：' + ((r && (r.text || r.error)) || '不能执行') };
      }
      mergeVirtual(virtual, r.virtual);
      out.push({
        action: def.id, title: def.title, risk: def.risk, reversible: def.reversible,
        params: p, impact: r.impact || {}, warnings: r.warnings || []
      });
    }
    var ticketSteps = out.map(function (s) { return { action: s.action, params: s.params, title: s.title, risk: s.risk, reversible: s.reversible }; });
    var h = hashPlan(ticketSteps);
    var ticket = { hash: h, steps: ticketSteps, createdAt: now(), expiresAt: now() + TTL, used: false, baseVer: baseVer };
    try {
      var tickets = read(K.tickets, {}) || {};
      tickets[h] = ticket;
      var tkeys = Object.keys(tickets).sort(function (a, b) { return (tickets[b].createdAt || 0) - (tickets[a].createdAt || 0); });
      tkeys.slice(12).forEach(function (k) { delete tickets[k]; });
      writeStrict(K.tickets, tickets, '预览确认票据');
    } catch (e) { return { ok: false, error: msgOf(e) }; }
    return {
      ok: true, hash: h,
      risk: maxRisk(ticketSteps), reversible: planReversible(ticketSteps),
      steps: out,
      plan: { steps: ticketSteps }
    };
  }

  async function execute(plan, token, opts) {
    opts = opts || {};
    if (read(K.kill, false)) return { ok: false, error: 'AI 写权限已关闭（kill switch）。撤销仍然可用。' };
    var tickets = read(K.tickets, {}) || {};
    var ticket = token ? tickets[token] : null;
    var planId = opts.planId || uuid();
    var steps;
    if (opts.resume) {
      steps = normalize(plan);
    } else {
      if (!token && typeof plan === 'string') { token = plan; ticket = tickets[token] || null; }
      if (!token) return { ok: false, error: '缺少预览确认票据，请重新预览' };
      if (!ticket || ticket.hash !== token) return { ok: false, error: '预览已失效或计划被改过，请重新预览' };
      if (ticket.used) return { ok: false, error: '这个预览已经执行过了，请重新预览' };
      if (now() > ticket.expiresAt) return { ok: false, error: '预览超过 5 分钟，请重新预览' };
      /* 版本号 fencing：预览之后数据被别的计划/标签页改过，这份预览就不再可信 */
      if (ticket.baseVer != null) {
        var nowVer = readVer();
        if (nowVer.v !== ticket.baseVer) {
          return { ok: false, error: '数据在你预览后被改过（版本 ' + ticket.baseVer + ' → ' + nowVer.v + (nowVer.by ? '，来源：' + nowVer.by : '') + '），请重新预览' };
        }
      }
      steps = ticket.steps.map(function (s, i) { return { action: s.action, params: clone(s.params || {}), index: i }; });
    }
    if (!acquireLock(planId)) return { ok: false, error: '另一个 AI 计划正在执行，请稍后再试' };
    if (!opts.resume) {
      ticket.used = true;
      tickets[token] = ticket;
      write(K.tickets, tickets);
    }
    var plans = read(K.plans, []);
    var rec = findPlan(plans, planId);
    if (!rec) {
      rec = {
        id: planId, hash: token || hashPlan(steps), risk: maxRisk(steps),
        reversible: planReversible(steps), steps: steps.map(function (s) { return { action: s.action, params: s.params }; }),
        status: 'running', startedAt: now(), done: 0
      };
      plans.push(rec);
    } else {
      rec.status = 'running';
      rec.error = null;
    }
    savePlans(plans);

    var virtual = { deleted: {} }, done = [], changed = false;
    var expectVer = readVer().v;   /* 本计划期望的数据版本：自己每写一步就 +1，别人插进来就中止 */
    try {
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var def = getAction(step.action);
        if (!def) throw new Error('动作不支持：' + step.action);
        /* D-4：kill switch 每一步都复查，别只看开头 */
        if (read(K.kill, false)) throw new Error('AI 写权限已关闭（kill switch），计划已中止（撤销仍然可用）');
        /* 每步前的数据版本校验（多标签页 / 跨计划交叉写） */
        var drift = verDrift(expectVer);
        if (drift) throw new Error(drift + '，计划已中止，请重新预览');
        var sid = stepId(planId, step, i);
        var cache = read(K.steps, {});
        if (cache[sid] && cache[sid].ok) {
          mergeVirtual(virtual, cache[sid].virtual);
          done.push({ index: i + 1, text: '已执行过（幂等跳过）：' + def.title, cached: true });
          continue;
        }
        /* 只读动作允许直接跑；写动作在 apply 前再用 dry 校一次前置条件 */
        var p = clone(step.params || {});
        /* 计划内「刚存的新题库」在预览时还是占位 id，执行时要按上一步的真实 id 重新物化 */
        if (def.resolve && (p.bank === '$new' || p.bankId === '$new' || (p.targets || []).some(function (t) { return t.bankId === '$new'; }))) {
          p = (await def.resolve({ mode: 'apply', planId: planId, stepId: sid, seq: i + 1, virtual: virtual, capture: function () {} }, p)) || p;
        }
        if (def.risk === 'R0') {
          var r0 = await def.run({ mode: 'apply', planId: planId, stepId: sid, seq: i + 1, virtual: virtual, capture: function () {} }, p);
          if (!r0 || r0.ok === false) throw new Error((r0 && (r0.text || r0.error)) || '执行失败');
          done.push({ index: i + 1, text: r0.text || def.title, result: r0.result || null });
          continue;
        }
        var cctx = { mode: 'dry', planId: planId, stepId: sid, seq: i + 1, virtual: virtual, capture: function () { throw new Error('dry 模式不能 capture'); } };
        var dry = await def.run(cctx, clone(p));
        if (!dry || dry.ok === false) throw new Error('前置条件不满足：' + ((dry && (dry.text || dry.error)) || ''));
        var actx = makeCtx(planId, step, sid, 'apply', virtual);
        var res;
        try {
          res = await def.run(actx, p);
        } catch (e) {
          finalizeStep(sid, false);
          throw e;
        }
        if (!res || res.ok === false) {
          finalizeStep(sid, false);
          throw new Error((res && (res.text || res.error)) || '执行失败');
        }
        finalizeStep(sid, true);
        expectVer = bumpVer('plan:' + planId).v;   /* 自己写成功：期望版本前移，别把自己判成漂移 */
        cache = read(K.steps, {});
        cache[sid] = { ok: true, result: res.result || null, virtual: res.virtual || null, ts: now() };
        var keys = Object.keys(cache);
        if (keys.length > MAX_STEP_CACHE) {
          keys.sort(function (a, b) { return (cache[a].ts || 0) - (cache[b].ts || 0); });
          keys.slice(0, keys.length - MAX_STEP_CACHE).forEach(function (k) { delete cache[k]; });
        }
        write(K.steps, cache);
        mergeVirtual(virtual, res.virtual);
        if (res.changed !== false) changed = true;
        done.push({ index: i + 1, text: res.text || def.title, result: res.result || null });
        var ps = read(K.plans, []); var rr = findPlan(ps, planId);
        if (rr) { rr.done = i + 1; savePlans(ps); }
      }
      var ps2 = read(K.plans, []); var rr2 = findPlan(ps2, planId);
      if (rr2) { rr2.status = 'completed'; rr2.completedAt = now(); rr2.done = steps.length; savePlans(ps2); }
      audit({ ts: now(), planId: planId, hash: token || '', risk: maxRisk(steps), status: 'completed', steps: steps.map(function (s) { return s.action; }) });
      return {
        ok: true, planId: planId, changed: changed, done: done,
        risk: maxRisk(steps), reversible: planReversible(steps)
      };
    } catch (e) {
      /* 失败即停：R1/R2 自动补偿，R3 留人工；R3 的已完成步骤不自动回滚 */
      var comp = compensatePlan(planId);
      bumpVer('compensate:' + planId);
      /* D-2：真「半途状态」才记 partial——有步骤落了地、但没能干净回滚（冲突或 R3 留人工），
         这种数据要人工看，resume() 才知道该收尾。干净回滚的直接记 failed。 */
      var partial = done.length > 0 && (comp.conflicts > 0 || comp.compensated === 0);
      var failStatus = partial ? 'partial' : 'failed';
      var ps3 = read(K.plans, []); var rr3 = findPlan(ps3, planId);
      if (rr3) {
        rr3.status = failStatus; rr3.error = msgOf(e); rr3.completedAt = now();
        rr3.done = done.length; rr3.compensated = comp.compensated; rr3.conflicts = comp.conflicts;
        savePlans(ps3);
      }
      audit({ ts: now(), planId: planId, hash: token || '', risk: maxRisk(steps), status: failStatus, error: msgOf(e), compensated: comp.compensated });
      return { ok: false, planId: planId, status: failStatus, error: msgOf(e), done: done, compensated: comp.compensated, conflicts: comp.conflicts, risk: maxRisk(steps) };
    } finally {
      releaseLock(planId);
    }
  }

  function compensatePlan(planId) {
    var wal = read(K.wal, []);
    var cache = read(K.steps, {});
    wal.forEach(function (e) {
      if (e.planId !== planId || e.status !== 'running') return;
      /* finalize 落盘失败但步骤其实成功了：以幂等缓存为准，别把成功步骤回滚掉 */
      if (cache[e.id] && cache[e.id].ok) { e.status = 'committed'; e.committed = true; }
    });
    var list = wal.filter(function (e) {
      return e.planId === planId && (e.status === 'running' || e.status === 'committed' || e.status === 'failed') && !walFullyCompensated(e);
    });
    list.sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); });
    var conflicts = 0, compensated = 0;
    list.forEach(function (e) {
      (e.keys || []).forEach(function (k) { if (!k.afterHash) k.afterHash = valHash(localStorage.getItem(k.key)); });
      if (e.status === 'running') e.status = 'failed';
      var act = getAction(e.action);
      if (e.risk === 'R3' || (act && act.autoCompensate === false)) { e.compensated = 'manual'; return; }
      var r = restoreEntry(e);
      conflicts += r.conflicts.length;
      if (!r.conflicts.length) { e.status = 'compensated'; compensated++; }
    });
    saveWal(wal, false);
    return { conflicts: conflicts, compensated: compensated };
  }

  function undoPlan(planId, force) {
    var plans = read(K.plans, []);
    var p = findPlan(plans, planId);
    if (p && p.reversible === false && !force) {
      return { ok: false, error: '这个计划含不可撤销步骤（例如 AI 批量打标签），不能整份撤销', conflicts: [], restored: 0 };
    }
    var wal = read(K.wal, []);
    var list = wal.filter(function (e) {
      return e.planId === planId && (e.status === 'committed' || e.status === 'failed') && !walFullyCompensated(e);
    });
    list.sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); });
    var conflicts = [], restored = 0;
    list.forEach(function (e) {
      var r = restoreEntry(e);
      conflicts = conflicts.concat(r.conflicts);
      restored += r.restored;
      if (!r.conflicts.length) e.status = 'compensated';
      else e.compensated = 'conflict';
    });
    saveWal(wal, false);
    bumpVer('undo:' + planId);   /* 撤销=数据变了，作废别的标签页里的旧预览 */
    if (p) {
      p.status = conflicts.length ? 'undo_partial' : 'undone';
      p.undoneAt = now();
      p.undoConflicts = conflicts.length;
      savePlans(plans);
    }
    audit({ ts: now(), planId: planId, status: conflicts.length ? 'undo_partial' : 'undone', restored: restored, conflicts: conflicts.length });
    return { ok: conflicts.length === 0, conflicts: conflicts, restored: restored };
  }

  function lastUndoable() {
    var plans = read(K.plans, []).slice().reverse();
    for (var i = 0; i < plans.length; i++) {
      var s = plans[i].status;
      /* partial/undo_partial 也要能被「撤销」找到：半途计划最需要回滚 */
      if (s === 'completed' || s === 'failed' || s === 'partial' || s === 'undo_partial') return plans[i];
    }
    return null;
  }

  function interrupted() {
    return read(K.plans, []).filter(function (p) { return p.status === 'running' || p.status === 'partial'; });
  }
  async function resume(planId) {
    var plans = read(K.plans, []);
    var p = findPlan(plans, planId);
    if (!p || (p.status !== 'running' && p.status !== 'partial')) return { ok: false, error: '没有可恢复的计划' };
    var wal = read(K.wal, []);
    var cache = read(K.steps, {});
    wal.forEach(function (e) {
      if (e.planId === planId && e.status === 'running' && cache[e.id] && cache[e.id].ok) {
        e.status = 'committed'; e.committed = true;
        (e.keys || []).forEach(function (k) { if (!k.afterHash) k.afterHash = valHash(localStorage.getItem(k.key)); });
      }
    });
    var half = wal.filter(function (e) { return e.planId === planId && e.status === 'running'; });
    for (var i = 0; i < half.length; i++) {
      if (half[i].risk === 'R3') return { ok: false, error: '有破坏性步骤执行到一半，无法安全恢复，请人工检查或回滚' };
      (half[i].keys || []).forEach(function (k) { if (!k.afterHash) k.afterHash = valHash(localStorage.getItem(k.key)); });
      var r = restoreEntry(half[i]);
      half[i].status = r.conflicts.length ? 'failed' : 'compensated';
    }
    saveWal(wal, false);
    return execute({ steps: p.steps }, null, { resume: true, planId: planId });
  }
  function rollback(planId) { return undoPlan(planId, true); }

  /* R0 只读：不做票据、不进 WAL，直接跑；有写风险就拒绝 */
  async function runNow(plan) {
    var steps;
    try { steps = normalize(plan); } catch (e) { return { ok: false, error: msgOf(e) }; }
    if (maxRisk(steps) !== 'R0') return { ok: false, error: '这不是只读计划，需要先预览确认' };
    var virtual = { deleted: {} }, done = [];
    for (var i = 0; i < steps.length; i++) {
      var def = getAction(steps[i].action);
      var p = clone(steps[i].params || {});
      var ctx = { mode: 'apply', planId: 'now', seq: i + 1, virtual: virtual, capture: function () {} };
      try {
        if (def.resolve) p = (await def.resolve(ctx, p)) || p;
        var r = await def.run(ctx, p);
        if (!r || r.ok === false) throw new Error((r && (r.text || r.error)) || '执行失败');
        if (r.virtual) virtual.newBank = r.virtual.newBank || r.virtual;
        done.push({ index: i + 1, text: r.text || def.title, result: r.result || null });
      } catch (e) {
        return { ok: false, error: '第 ' + (i + 1) + ' 步（' + def.title + '）：' + msgOf(e), done: done };
      }
    }
    return { ok: true, done: done };
  }

  function setKill(on) { write(K.kill, !!on); return !!on; }
  function isKill() { return !!read(K.kill, false); }
  function listActions(includeHidden) {
    return Object.keys(actions).filter(function (id) { return includeHidden || !actions[id].hidden; })
      .map(function (id) {
        var a = actions[id];
        return { id: a.id, title: a.title, risk: a.risk, reversible: a.reversible, readOnly: a.readOnly, paramsHint: a.paramsHint };
      });
  }
  function catalog() {
    return listActions(false).map(function (a) {
      return a.id + ' — ' + a.title + '（' + a.risk + (a.reversible === false ? '，不可撤销' : '，可撤销') + (a.readOnly ? '，只读' : '') + '）';
    }).join('\n');
  }
  function plans() {
    return read(K.plans, []).slice().reverse().map(function (p) {
      return { id: p.id, status: p.status, risk: p.risk, reversible: p.reversible, done: p.done || 0, startedAt: p.startedAt, completedAt: p.completedAt, error: p.error || null };
    });
  }
  function state(planId) {
    var p = read(K.plans, []).filter(function (x) { return x.id === planId; })[0];
    if (!p) return null;
    var wal = read(K.wal, []).filter(function (e) { return e.planId === planId; });
    return { plan: p, changes: wal };
  }

  /* ============================================================
     动作实现
     ============================================================ */

  /* ---------- 题库 ---------- */
  var BANK_KEYS = [
    'qbank.local.v2', 'qbank.answers.v2', 'qbank.favs.v2', 'qbank.notes.v2',
    'qbank.tags.v1', 'qbank.tagvocab.v1', 'qbank.tomb.v1', 'qbank.papers.v2',
    'qbank.qtn.v1', 'qbank.answerfix.v1', 'qbank.srs.v1'
  ];

  register({
    id: 'bank.delete', title: '删除题库', risk: 'R3', reversible: true,
    paramsHint: '{bankTitles:["题库名"]} 或 {bankIds:["id"]}',
    resolve: function (ctx, p) {
      var bs = targetBanks(p);
      if (!bs.length) throw new Error('没找到要删除的题库');
      var locals = bs.filter(function (b) { return b.source === 'local' && !b.paper; });
      if (!locals.length) throw new Error('这些是内置题库（banks/*.js），只能读，删不了');
      if (locals.length !== bs.length) {
        var built = bs.filter(function (b) { return b.source !== 'local' || b.paper; }).map(function (b) { return '《' + b.title + '》'; });
        throw new Error('内置题库不能删：' + built.join('、') + '。请分开处理');
      }
      p.bankIds = locals.map(function (b) { return b.id; });
      p.bankTitles = locals.map(function (b) { return b.title; });
      p.qCount = locals.reduce(function (n, b) { return n + (b.questions || []).length; }, 0);
      return p;
    },
    run: async function (ctx, p) {
      var names = (p.bankTitles || []).join('、');
      if (ctx.mode === 'dry') {
        return { ok: true, impact: { banks: (p.bankIds || []).length, questions: p.qCount || 0, summary: (p.bankIds || []).length + ' 个题库（' + (p.qCount || 0) + ' 题）：' + names } };
      }
      if (typeof CAT === 'undefined' || !CAT || !CAT.deleteBanks) return { ok: false, text: '题库模块没加载' };
      var keys = BANK_KEYS.slice();
      (p.bankIds || []).forEach(function (id) { keys.push('qbank.last.' + id); });
      ctx.capture(keys);
      var r = CAT.deleteBanks(p.bankIds);
      if (!r || !r.n) return { ok: false, text: '没有删掉任何题库' };
      return { ok: true, changed: true, text: '删除 ' + r.n + ' 个题库（' + r.q + ' 题）：' + (r.titles || []).join('、'), result: { n: r.n, q: r.q } };
    }
  });

  register({
    id: 'bank.rename', title: '重命名题库', risk: 'R1', reversible: true,
    paramsHint: '{bankTitle:"旧名", title:"新名"}',
    resolve: function (ctx, p) {
      var bs = targetBanks(p);
      if (bs.length !== 1) throw new Error('一次只能改一个题库的名字');
      if (bs[0].source !== 'local' || bs[0].paper) throw new Error('内置题库不能改名');
      p.bankId = bs[0].id; p.oldTitle = bs[0].title;
      p.title = String(p.title || p.newTitle || '').trim();
      if (!p.title) throw new Error('没给新名字');
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { banks: 1, summary: '《' + p.oldTitle + '》改名为《' + p.title + '》' } };
      ctx.capture(['qbank.local.v2']);
      var arr = (typeof LOCAL !== 'undefined' && Array.isArray(LOCAL)) ? LOCAL : read('qbank.local.v2', []);
      var b = arr.filter(function (x) { return String(x.id) === String(p.bankId); })[0];
      if (!b) return { ok: false, text: '题库不在了' };
      b.title = p.title;
      writeBanks(arr); invalidate();
      return { ok: true, changed: true, text: '题库已改名为《' + p.title + '》' };
    }
  });

  register({
    id: 'bank.move', title: '移动题库到目录', risk: 'R1', reversible: true,
    paramsHint: '{bankTitle:"题库名", catTitle:"目录名"}（catTitle 为空 = 顶层）',
    resolve: function (ctx, p) {
      var bs = targetBanks(p);
      if (bs.length !== 1) throw new Error('一次只能移动一个题库');
      if (bs[0].source !== 'local' || bs[0].paper) throw new Error('内置题库不能移动');
      p.bankId = bs[0].id; p.bankTitle = bs[0].title;
      p.catId = resolveCatId(p.catTitle, p.catId, true);
      p.catName = p.catId ? catName(p.catId) : '顶层';
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { banks: 1, summary: '把《' + p.bankTitle + '》移动到「' + p.catName + '」' } };
      if (typeof CAT === 'undefined' || !CAT || !CAT.moveBank) return { ok: false, text: '题库模块没加载' };
      ctx.capture(['qbank.cats.v1', 'qbank.local.v2']);
      if (!CAT.moveBank(p.bankId, p.catId || null, null)) return { ok: false, text: '移动失败' };
      CAT.save({ quiet: true });
      return { ok: true, changed: true, text: '已把《' + p.bankTitle + '》移动到「' + p.catName + '」' };
    }
  });

  /* ---------- 目录 ---------- */
  function catList() {
    try { return (typeof CAT !== 'undefined' && CAT && CAT.all) ? (CAT.all() || []) : []; } catch (e) { return []; }
  }
  function catName(id) {
    var c = catList().filter(function (x) { return String(x.id) === String(id); })[0];
    return c ? c.title : '目录';
  }
  function resolveCatId(title, id, allowRoot) {
    if (id && id !== '__ROOT__') return id;
    if (title == null || title === '' || /^(顶层|根目录|根|root)$/i.test(String(title))) {
      if (allowRoot) return null;
      throw new Error('没给目标目录');
    }
    var q = String(title).trim();
    var list = catList();
    var exact = list.filter(function (c) { return String(c.title).trim() === q; });
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) throw new Error('有多个同名目录「' + q + '」');
    var part = list.filter(function (c) { return String(c.title).indexOf(q) >= 0; });
    if (part.length === 1) return part[0].id;
    if (part.length > 1) throw new Error('「' + q + '」匹配到多个目录');
    throw new Error('没找到目录「' + q + '」');
  }
  register({
    id: 'cat.create', title: '新建目录', risk: 'R1', reversible: true,
    paramsHint: '{title:"目录名", parentTitle:"上级目录（可空）"}',
    resolve: function (ctx, p) {
      p.title = String(p.title || p.name || '').trim();
      if (!p.title) throw new Error('没给目录名');
      p.parentId = resolveCatId(p.parentTitle, p.parentId, true);
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { cats: 1, summary: '新建目录「' + p.title + '」' + (p.parentId ? ('（在「' + catName(p.parentId) + '」下）') : '（顶层）') } };
      if (typeof CAT === 'undefined' || !CAT || !CAT.create) return { ok: false, text: '目录模块没加载' };
      ctx.capture(['qbank.cats.v1', 'qbank.local.v2']);
      var id = CAT.create(p.parentId || null, p.title);
      if (!id) return { ok: false, text: '新建失败' };
      CAT.save({ quiet: true });
      return { ok: true, changed: true, text: '已新建目录「' + p.title + '」', result: { catId: id } };
    }
  });
  register({
    id: 'cat.rename', title: '重命名目录', risk: 'R1', reversible: true,
    paramsHint: '{catTitle:"旧名", title:"新名"}',
    resolve: function (ctx, p) {
      p.catId = resolveCatId(p.catTitle, p.catId, false);
      p.oldTitle = catName(p.catId);
      p.title = String(p.title || p.newTitle || '').trim();
      if (!p.title) throw new Error('没给新名字');
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { cats: 1, summary: '目录「' + p.oldTitle + '」改名为「' + p.title + '」' } };
      if (typeof CAT === 'undefined' || !CAT || !CAT.rename) return { ok: false, text: '目录模块没加载' };
      ctx.capture(['qbank.cats.v1', 'qbank.local.v2']);
      CAT.rename(p.catId, p.title); CAT.save({ quiet: true });
      return { ok: true, changed: true, text: '目录已改名为「' + p.title + '」' };
    }
  });
  register({
    id: 'cat.move', title: '移动目录', risk: 'R1', reversible: true,
    paramsHint: '{catTitle:"目录名", parentTitle:"新上级（空=顶层）"}',
    resolve: function (ctx, p) {
      p.catId = resolveCatId(p.catTitle, p.catId, false);
      p.oldTitle = catName(p.catId);
      p.parentId = resolveCatId(p.parentTitle, p.parentId, true);
      p.parentName = p.parentId ? catName(p.parentId) : '顶层';
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { cats: 1, summary: '把目录「' + p.oldTitle + '」移动到「' + p.parentName + '」' } };
      if (typeof CAT === 'undefined' || !CAT || !CAT.move) return { ok: false, text: '目录模块没加载' };
      ctx.capture(['qbank.cats.v1', 'qbank.local.v2']);
      if (!CAT.move(p.catId, p.parentId || null)) return { ok: false, text: '移动失败（不能移动到自己的子目录）' };
      CAT.save({ quiet: true });
      return { ok: true, changed: true, text: '已把目录「' + p.oldTitle + '」移动到「' + p.parentName + '」' };
    }
  });

  /* ---------- 题目 ---------- */
  var Q_KEYS = [
    'qbank.local.v2', 'qbank.answers.v2', 'qbank.favs.v2', 'qbank.notes.v2',
    'qbank.qtn.v1', 'qbank.answerfix.v1', 'qbank.tags.v1', 'qbank.tagvocab.v1',
    'qbank.papers.v2', 'qbank.tomb.v1'
  ];
  function checkTargets(p) {
    (p.targets || []).forEach(function (t) {
      var b = bankOf(t.bankId);
      if (!b) throw new Error('《' + t.title + '》不在了，请重新预览');
      var ids = {};
      (b.questions || []).forEach(function (q) { ids[q.id] = 1; });
      (t.qids || []).forEach(function (id) { if (!ids[id]) throw new Error('《' + t.title + '》里有题被删了，请重新预览'); });
    });
  }
  function targetImpact(p, verb) {
    var n = targetCount(p);
    var parts = (p.targets || []).map(function (t) {
      var nums = (t.nums || []).filter(function (x) { return x > 0; });
      return '《' + t.title + '》' + (nums.length ? ('第 ' + nums.join('、') + ' 题') : (t.qids || []).length + ' 题');
    });
    return { questions: n, banks: (p.targets || []).length, summary: verb + ' ' + n + ' 道题：' + parts.join('；') };
  }

  register({
    id: 'question.delete', title: '删除题目', risk: 'R3', reversible: true,
    paramsHint: '{bankTitle:"题库名", nums:[3,5]} 或 {currentQ:true}',
    resolve: function (ctx, p) {
      /* 套卷里说「删除这道题」：映射回原题库那道题再删 */
      if (p.currentQ) {
        var cq = currentQ();
        if (cq && cq.bank && cq.bank.paper && typeof delTargetOf === 'function') {
          var tgt = delTargetOf(cq.bank, cq.q);
          if (!tgt) throw new Error('这道题在套卷里，找不到原题库，删不了');
          p.bankId = tgt.bankId; p.qids = [tgt.qid];
          delete p.currentQ; delete p.current;
        }
      }
      var banks = targetBanks(p);
      if (!banks.length) throw new Error('没找到题库');
      var bad = banks.filter(function (b) { return b.source !== 'local' || b.paper; });
      if (bad.length) throw new Error('内置题库的题删不了：' + bad.map(function (b) { return '《' + b.title + '》'; }).join('、'));
      materialize(ctx, p);
      return p;
    },
    run: async function (ctx, p) {
      var imp = targetImpact(p, '从题库删除');
      var vq = [];
      (p.targets || []).forEach(function (t) { (t.qids || []).forEach(function (qid) { vq.push(t.bankId + '#' + qid); }); });
      if (ctx.mode === 'dry') return { ok: true, impact: imp, virtual: { deleted: vq } };
      checkTargets(p);
      ctx.capture(Q_KEYS);
      var n = 0;
      (p.targets || []).forEach(function (t) {
        (t.qids || []).forEach(function (qid) {
          try { var r = delBankQuestion(t.bankId, qid); if (r && r.ok) n++; } catch (e) {}
        });
      });
      if (!n) return { ok: false, text: '没有删掉任何题' };
      return { ok: true, changed: true, text: '已删除 ' + n + ' 道题：' + (p.targets || []).map(function (t) { return '《' + t.title + '》'; }).join('、'), result: { n: n }, virtual: { deleted: vq } };
    }
  });

  register({
    id: 'question.favorite', title: '收藏/取消收藏', risk: 'R1', reversible: true,
    paramsHint: '{bankTitle:"题库名", nums:[1,3], on:true}；不带题库且 on:false = 清空全部收藏',
    resolve: function (ctx, p) {
      if (p.on === undefined) p.on = true;
      var hasBank = !!(p.bankTitle || p.bankTitles || p.bankIds || p.bankId || p.current || p.currentQ || p.bank);
      if (!hasBank) {
        if (p.all && p.on === false) { p.allFav = true; return p; }
        throw new Error('没认出题库');
      }
      materialize(ctx, p, { defaultAll: true });
      return p;
    },
    run: async function (ctx, p) {
      var FAV = favData();
      if (p.allFav) {
        var keys = Object.keys(FAV).filter(function (k) { return FAV[k]; });
        if (ctx.mode === 'dry') return { ok: true, impact: { questions: keys.length, summary: '清空全部收藏（' + keys.length + ' 道题）' } };
        ctx.capture(['qbank.favs.v2', 'qbank.tomb.v1']);
        keys.forEach(function (k) { delete FAV[k]; tomb('fav', k); });
        saveFavSafe();
        return { ok: true, changed: true, text: '已清空 ' + keys.length + ' 个收藏' };
      }
      var imp = targetImpact(p, p.on === false ? '取消收藏' : '收藏');
      if (ctx.mode === 'dry') return { ok: true, impact: imp };
      checkTargets(p);
      ctx.capture(['qbank.favs.v2', 'qbank.tomb.v1']);
      var n = 0;
      (p.targets || []).forEach(function (t) {
        (t.qids || []).forEach(function (qid) {
          var k = t.bankId + '#' + qid;
          if (p.on === false) { if (FAV[k]) { delete FAV[k]; tomb('fav', k); n++; } }
          else if (!FAV[k]) { FAV[k] = now(); n++; }
        });
      });
      if (n) saveFavSafe();
      return { ok: true, changed: n > 0, text: (p.on === false ? '已取消收藏 ' : '已收藏 ') + n + ' 道题', result: { n: n } };
    }
  });
  alias('favorite.toggle', 'question.favorite');

  register({
    id: 'question.markWrong', title: '标为错题', risk: 'R1', reversible: true,
    paramsHint: '{bankTitle:"题库名", nums:[...]}',
    resolve: function (ctx, p) { materialize(ctx, p); return p; },
    run: async function (ctx, p) {
      var imp = targetImpact(p, '标为错题');
      if (ctx.mode === 'dry') return { ok: true, impact: imp };
      checkTargets(p);
      ctx.capture(['qbank.answers.v2', 'qbank.tomb.v1']);
      var ANS = ansData(), n = 0;
      (p.targets || []).forEach(function (t) {
        (t.qids || []).forEach(function (qid) {
          var k = t.bankId + '#' + qid;
          var a = ANS[k] || { sel: [], tries: 1, wrong: 0, ok: false, ts: now() };
          a.wrong = Math.max(1, a.wrong || 0); a.ok = false; a.redo = false; a.upd = now();
          ANS[k] = a; n++;
        });
      });
      saveAnsSafe();
      return { ok: true, changed: n > 0, text: '已把 ' + n + ' 道题标为错题', result: { n: n } };
    }
  });

  register({
    id: 'question.mastered', title: '错题标为已掌握', risk: 'R1', reversible: true,
    paramsHint: '{bankTitle:"题库名", wrong:true}',
    resolve: function (ctx, p) {
      materialize(ctx, p);
      /* 只保留确实有错题记录的，预览数字才准 */
      var ANS = ansData();
      p.targets.forEach(function (t) {
        t.qids = t.qids.filter(function (id) { var a = ANS[t.bankId + '#' + id]; return a && (a.wrong || 0) > 0; });
      });
      p.targets = p.targets.filter(function (t) { return t.qids.length; });
      if (!p.targets.length) throw new Error('这些题本来就没有错题记录');
      return p;
    },
    run: async function (ctx, p) {
      var imp = targetImpact(p, '清除错题标记');
      if (ctx.mode === 'dry') return { ok: true, impact: imp };
      checkTargets(p);
      ctx.capture(['qbank.answers.v2', 'qbank.tomb.v1']);
      var ANS = ansData(), n = 0;
      (p.targets || []).forEach(function (t) {
        (t.qids || []).forEach(function (qid) {
          var a = ANS[t.bankId + '#' + qid];
          if (a && (a.wrong || 0) > 0) { a.wrong = 0; a.ok = true; a.redo = false; a.upd = now(); n++; }
        });
      });
      if (n) saveAnsSafe();
      return { ok: true, changed: n > 0, text: '已清除 ' + n + ' 道题的错题标记', result: { n: n } };
    }
  });

  register({
    id: 'question.clearAnswers', title: '清空作答记录', risk: 'R3', reversible: true,
    paramsHint: '{bankTitle:"题库名", nums:[...]} 或 {all:true}',
    resolve: function (ctx, p) {
      materialize(ctx, p);
      var ANS = ansData();
      p.targets.forEach(function (t) {
        t.qids = t.qids.filter(function (id) { return ANS[t.bankId + '#' + id] != null; });
      });
      p.targets = p.targets.filter(function (t) { return t.qids.length; });
      if (!p.targets.length) throw new Error('这些题本来就没有作答记录');
      return p;
    },
    run: async function (ctx, p) {
      var imp = targetImpact(p, '清空作答记录');
      if (ctx.mode === 'dry') return { ok: true, impact: imp };
      checkTargets(p);
      ctx.capture(['qbank.answers.v2', 'qbank.tomb.v1', 'qbank.papers.v2']);
      var ANS = ansData(), n = 0;
      (p.targets || []).forEach(function (t) {
        (t.qids || []).forEach(function (qid) {
          var k = t.bankId + '#' + qid;
          if (ANS[k] != null) { delete ANS[k]; tomb('ans', k); n++; }
        });
      });
      if (n) saveAnsSafe();
      return { ok: true, changed: n > 0, text: '已清空 ' + n + ' 道题的作答记录', result: { n: n } };
    }
  });

  /* ---------- 标签 ---------- */
  register({
    id: 'tag.add', title: '给题打考点标签', risk: 'R1', reversible: true,
    paramsHint: '{bankTitle:"题库名", nums:[1,2], tags:["心衰"]}；bank:"$new" = 刚存的题库',
    resolve: function (ctx, p) {
      p.tags = uniq((p.tags || []).map(function (t) { return String(t || '').trim(); }).filter(Boolean)).slice(0, 20);
      if (!p.tags.length) throw new Error('没给标签');
      if (p.bank === '$new' || p.bankId === '$new') {
        var vb = ctx.virtual && ctx.virtual.newBank;
        if (!vb) throw new Error('上一步没有创建新题库');
        p.targets = [{ bankId: vb.id, title: vb.title, qids: (vb.qids || []).slice(), nums: [] }];
        p.virtualBank = true;
        return p;
      }
      materialize(ctx, p, { defaultAll: true });
      return p;
    },
    run: async function (ctx, p) {
      var n = targetCount(p);
      if (ctx.mode === 'dry') return { ok: true, impact: { questions: n, tags: p.tags, summary: '给 ' + n + ' 道题打上：' + p.tags.join('、') } };
      var targets = p.targets || [];
      var real = targets.map(function (t) {
        var b = bankOf(t.bankId);
        if (!b) throw new Error('题库《' + t.title + '》不在了，请重新预览');
        var have = {};
        (b.questions || []).forEach(function (q) { have[q.id] = 1; });
        (t.qids || []).forEach(function (qid) { if (!have[qid]) throw new Error('《' + b.title + '》里有题被删了，请重新预览'); });
        return { bank: b, qids: t.qids || [] };
      });
      ctx.capture(['qbank.tags.v1', 'qbank.tagvocab.v1']);
      var count = 0;
      real.forEach(function (t) {
        t.qids.forEach(function (qid) { try { addTags(t.bank.id + '#' + qid, p.tags); count++; } catch (e) {} });
      });
      try { if (window.TAGS && TAGS.rememberVocab) TAGS.rememberVocab(p.tags); } catch (e) {}
      if (!count) return { ok: false, text: '没有写成任何标签' };
      return { ok: true, changed: true, text: '给 ' + count + ' 道题打上：' + p.tags.join('、'), result: { n: count } };
    }
  });

  register({
    id: 'tag.aiOne', title: 'AI 给这道题打标签', risk: 'R1', reversible: true,
    paramsHint: '{currentQ:true} 或 {bankId:"id", qid:"id"}',
    resolve: function (ctx, p) {
      var cq = currentQ();
      if (p.qid) {
        var b = bankOf(p.bankId) || (cq && cq.bank);
        if (!b) throw new Error('没找到题库');
        p.bankId = b.id; p.bankTitle = b.title; p.qid = p.qid;
      } else {
        if (!cq) throw new Error('没有正在做的题。先打开一道题，或指明题库和题号');
        p.bankId = cq.bank.id; p.qid = cq.q.id; p.bankTitle = cq.bank.title;
      }
      return p;
    },
    run: async function (ctx, p) {
      if (typeof TAGS === 'undefined' || !TAGS || !TAGS.aiOne) return { ok: false, text: '标签模块没加载' };
      if (!TAGS.all || !TAGS.all().length) return { ok: false, text: '考点词表是空的，先导入或让 AI 起一份' };
      if (ctx.mode === 'dry') return { ok: true, impact: { questions: 1, summary: '让 AI 读《' + p.bankTitle + '》这道题，从词表里挑考点' } };
      ctx.capture(['qbank.tags.v1', 'qbank.tagvocab.v1']);
      var r = await TAGS.aiOne(p.bankId, p.qid);
      if (!r || !r.ok) return { ok: false, text: (r && r.err) || 'AI 打标签失败' };
      return { ok: true, changed: true, text: 'AI 给《' + p.bankTitle + '》这道题打上：' + (r.tags || []).join('、'), result: { tags: r.tags || [] } };
    }
  });

  register({
    id: 'tag.aiAll', title: 'AI 批量打标签（后台）', risk: 'R2', reversible: false,
    paramsHint: '{}',
    run: async function (ctx, p) {
      if (typeof TAGS === 'undefined' || !TAGS || !TAGS.tagAll) return { ok: false, text: '标签模块没加载' };
      if (!TAGS.all || !TAGS.all().length) return { ok: false, text: '考点词表是空的' };
      if (TAGS.job && TAGS.job.running) return { ok: false, text: 'AI 正在打标签，等它跑完或先停止' };
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '让 AI 给所有还没标签的题批量打标签（启动后在后台继续跑）' }, warnings: ['后台任务会持续写标签，这个计划不能整份撤销'] };
      ctx.capture(['qbank.tags.v1', 'qbank.tagvocab.v1']);
      TAGS.tagAll();
      await new Promise(function (r) { setTimeout(r, 500); });
      if (!TAGS.job || (!TAGS.job.running && !(TAGS.job.total > 0))) return { ok: false, text: (TAGS.job && TAGS.job.note) || '任务没启动' };
      return { ok: true, changed: true, text: 'AI 已开始给未标签的题打标签，进度看「学习统计 → 按考点」' };
    }
  });

  register({
    id: 'tag.vocabImport', title: '导入考点词表', risk: 'R1', reversible: true,
    paramsHint: '{text:"心衰、利尿、炎症"}',
    resolve: function (ctx, p) {
      if (typeof TAGS === 'undefined' || !TAGS || !TAGS.parseVocabList) throw new Error('标签模块没加载');
      var body = p.text || (p.lines || []).join('\n') || '';
      if (body.indexOf('\n') < 0) body = body.replace(/[、,，;；]+/g, '\n');
      var list = TAGS.parseVocabList(body);
      if (!list || !list.length) throw new Error('没解析出考点');
      p.vocab = list;
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { vocab: p.vocab.length, summary: '向词表加入 ' + p.vocab.length + ' 个考点' } };
      ctx.capture(['qbank.tagvocab.v1']);
      var r = TAGS.addVocabBulk(p.vocab);
      return { ok: true, changed: true, text: '词表加了 ' + (r.added || 0) + ' 个考点（现在共 ' + (r.total || 0) + ' 个）', result: r };
    }
  });

  register({
    id: 'tag.vocabGenerate', title: '让 AI 起一份考点词表', risk: 'R2', reversible: true,
    paramsHint: '{}',
    run: async function (ctx, p) {
      if (typeof TAGS === 'undefined' || !TAGS || !TAGS.genVocab) return { ok: false, text: '标签模块没加载' };
      if (TAGS.job && TAGS.job.running) return { ok: false, text: 'AI 正在忙，等它跑完' };
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '让 AI 按题库内容生成一份考点词表并存入词表' } };
      ctx.capture(['qbank.tagvocab.v1']);
      try { await TAGS.genVocab(); } catch (e) {}
      var v = (TAGS.job && TAGS.job.vocab) || [];
      if (!v.length) return { ok: false, text: (TAGS.job && TAGS.job.note) || 'AI 没生成词表' };
      var r = TAGS.addVocabBulk(v);
      return { ok: true, changed: true, text: 'AI 起了 ' + v.length + ' 个考点，已存入词表（共 ' + (r.total || 0) + ' 个）' };
    }
  });

  /* ---------- 设置 ---------- */
  function settingsAction(id, title, key, label, values) {
    register({
      id: id, title: title, risk: 'R1', reversible: true,
      paramsHint: values ? ('{' + key + ':"' + values.join('|') + '"}') : ('{' + key + ':true|false}'),
      resolve: function (ctx, p) {
        if (values) {
          var v = p[key];
          if (values.indexOf(v) < 0) throw new Error('参数 ' + key + ' 只能是：' + values.join('、'));
        }
        return p;
      },
      run: async function (ctx, p) {
        var raw = values ? p[key] : (p.on !== undefined ? p.on : p[key]);
        var val = values ? p[key] : (raw !== false);
        var SHOW = {
          theme: { dark: '深色', light: '浅色', auto: '跟随系统' },
          fs: { s: '小', m: '标准', l: '大', xl: '特大' },
          color: { blue: '蓝色', teal: '青色', indigo: '靛蓝', violet: '紫色', warm: '暖橙' }
        };
        var txt = values ? (label + '：' + ((SHOW[key] && SHOW[key][val]) || val)) : (label + '：' + (val ? '开' : '关'));
        if (ctx.mode === 'dry') return { ok: true, impact: { summary: txt } };
        ctx.capture(['qbank.settings.v2']);
        if (typeof setLook === 'function') setLook(key, val);
        else {
          var s = read('qbank.settings.v2', {}) || {};
          s[key] = val;
          write('qbank.settings.v2', s);
        }
        return { ok: true, changed: true, text: '已设置 ' + txt };
      }
    });
  }
  settingsAction('settings.theme', '切换深浅色', 'theme', '外观', ['dark', 'light', 'auto']);
  settingsAction('settings.font', '调整字号', 'fs', '字号', ['s', 'm', 'l', 'xl']);
  settingsAction('settings.color', '切换主题色', 'color', '主题色', ['blue', 'teal', 'indigo', 'violet', 'warm']);
  settingsAction('settings.autoNext', '自动下一题', 'autoNext', '自动下一题');
  settingsAction('settings.expOnOk', '答对也显示解析', 'expOnOk', '答对显示解析');
  alias('set.theme', 'settings.theme');
  alias('set.font', 'settings.font');
  alias('set.color', 'settings.color');
  alias('set.autoNext', 'settings.autoNext');
  alias('set.expOnOk', 'settings.expOnOk');

  /* ---------- 导出（R0 只读） ---------- */
  function fileSafe(s) { return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || '导出'; }
  function downloadFile(name, text, mime) {
    try { if (typeof window.download === 'function') { window.download(name, text, mime); return true; } } catch (e) {}
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 3000);
      return true;
    } catch (e) { return false; }
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function mdQuestion(out, title, idx, q, extra) {
    out.push('', '## 《' + title + '》第 ' + idx + ' 题' + (extra || ''), '', q.stem || q.title || '', '');
    (q.options || []).forEach(function (o, i) { out.push(String.fromCharCode(65 + i) + '. ' + o); });
    out.push('', '答案：' + (((q.answer || []).join('')) || '—'));
    if (q.explain) out.push('', '解析：' + q.explain);
  }

  register({
    id: 'export.bank', title: '导出题库文件', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{bankTitle:"题库名"}',
    resolve: function (ctx, p) {
      var bs = targetBanks(p);
      if (bs.length !== 1) throw new Error('一次导出一个题库');
      p.bankId = bs[0].id; p.bankTitle = bs[0].title; p.qCount = (bs[0].questions || []).length;
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { questions: p.qCount, summary: '导出《' + p.bankTitle + '》（' + p.qCount + ' 题）为 JSON' } };
      var b = bankOf(p.bankId);
      if (!b) return { ok: false, text: '题库不在了' };
      var data = { app: 'shuati-bank', title: b.title, subtitle: b.subtitle || '', questions: b.questions };
      var name = fileSafe(b.title) + '.json';
      if (!downloadFile(name, JSON.stringify(data, null, 2), 'application/json;charset=utf-8')) return { ok: false, text: '文件生成失败' };
      return { ok: true, changed: false, text: '已导出《' + b.title + '》→ ' + name, result: { name: name, n: b.questions.length } };
    }
  });

  register({
    id: 'export.wrong', title: '导出错题', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{all:true} 或 {bankTitle:"题库名"}',
    resolve: function (ctx, p) {
      if (!p.all) {
        var bs = targetBanks(p);
        if (bs.length) p.bankIds = bs.map(function (b) { return b.id; });
        else p.all = true;
      }
      return p;
    },
    run: async function (ctx, p) {
      var ANS = ansData();
      var bs = p.all ? banksAll() : (p.bankIds || []).map(bankOf).filter(Boolean);
      var n = 0;
      bs.forEach(function (b) { (b.questions || []).forEach(function (q) { var a = ANS[b.id + '#' + q.id]; if (a && (a.wrong || 0) > 0) n++; }); });
      if (!n) return { ok: false, text: '没有错题可导出' };
      if (ctx.mode === 'dry') return { ok: true, impact: { questions: n, summary: '导出 ' + n + ' 道错题' } };
      var out = ['# 错题导出', '', '> 导出时间：' + new Date().toLocaleString('zh-CN')];
      bs.forEach(function (b) {
        (b.questions || []).forEach(function (q, i) {
          var a = ANS[b.id + '#' + q.id];
          if (!a || !(a.wrong > 0)) return;
          mdQuestion(out, b.title, i + 1, q, '（错 ' + a.wrong + ' 次）');
        });
      });
      var name = '错题导出-' + stamp() + '.md';
      if (!downloadFile(name, out.join('\n'), 'text/markdown;charset=utf-8')) return { ok: false, text: '文件生成失败' };
      return { ok: true, changed: false, text: '已导出 ' + n + ' 道错题 → ' + name, result: { name: name, n: n } };
    }
  });

  register({
    id: 'export.fav', title: '导出收藏', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{all:true} 或 {bankTitle:"题库名"}',
    resolve: function (ctx, p) {
      if (!p.all) {
        var bs = targetBanks(p);
        if (bs.length) p.bankIds = bs.map(function (b) { return b.id; });
        else p.all = true;
      }
      return p;
    },
    run: async function (ctx, p) {
      var FAV = favData();
      var bs = p.all ? banksAll() : (p.bankIds || []).map(bankOf).filter(Boolean);
      var n = 0;
      bs.forEach(function (b) { (b.questions || []).forEach(function (q) { if (FAV[b.id + '#' + q.id]) n++; }); });
      if (!n) return { ok: false, text: '没有收藏可导出' };
      if (ctx.mode === 'dry') return { ok: true, impact: { questions: n, summary: '导出 ' + n + ' 道收藏题' } };
      var out = ['# 收藏导出', '', '> 导出时间：' + new Date().toLocaleString('zh-CN')];
      bs.forEach(function (b) {
        (b.questions || []).forEach(function (q, i) { if (FAV[b.id + '#' + q.id]) mdQuestion(out, b.title, i + 1, q); });
      });
      var name = '收藏导出-' + stamp() + '.md';
      if (!downloadFile(name, out.join('\n'), 'text/markdown;charset=utf-8')) return { ok: false, text: '文件生成失败' };
      return { ok: true, changed: false, text: '已导出 ' + n + ' 道收藏题 → ' + name, result: { name: name, n: n } };
    }
  });

  register({
    id: 'export.all', title: '导出全部数据备份', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{}',
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '导出全部数据（题库/作答/收藏/标签/设置/知识库）为 JSON 备份' } };
      if (typeof exportAllData !== 'function') return { ok: false, text: '备份模块没加载' };
      await exportAllData();
      return { ok: true, changed: false, text: '已生成全部数据备份文件（浏览器应该已经下载）' };
    }
  });

  register({
    id: 'export.kb', title: '导出知识库', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{name:"知识库名（可空）", keyword:"心衰（可空）"}',
    resolve: async function (ctx, p) {
      try { if (typeof kbEnsureFilesLoaded === 'function') await kbEnsureFilesLoaded(); } catch (e) {}
      var list = (typeof kbList === 'function') ? kbList() : [];
      if (!list.length) throw new Error('还没有知识库');
      var targets = list;
      if (p.name) {
        var hit = list.filter(function (k) { return k.name === p.name || String(k.name).indexOf(p.name) >= 0; });
        if (!hit.length) throw new Error('没找到知识库「' + p.name + '」');
        targets = hit;
      }
      p.kbIds = targets.map(function (k) { return k.id; });
      p.kbNames = targets.map(function (k) { return k.name; });
      return p;
    },
    run: async function (ctx, p) {
      var kw = String(p.keyword || '').trim();
      if (ctx.mode === 'dry') return { ok: true, impact: { docs: p.kbIds.length, summary: '导出知识库：' + p.kbNames.join('、') + (kw ? ('（只含「' + kw + '」相关段落）') : '') } };
      if (typeof kbEnsure !== 'function') return { ok: false, text: '知识库模块没加载' };
      try { if (typeof kbEnsureFilesLoaded === 'function') await kbEnsureFilesLoaded(); } catch (e) {}
      var list = (typeof kbList === 'function') ? kbList() : [];
      var targets = list.filter(function (k) { return p.kbIds.indexOf(k.id) >= 0; });
      if (!targets.length) targets = list;
      var out = ['# 知识库导出', '', '> 导出时间：' + new Date().toLocaleString('zh-CN')];
      if (kw) out.push('> 关键词：' + kw);
      var docsN = 0, chars = 0;
      for (var i = 0; i < targets.length; i++) {
        var k = targets[i];
        try { await kbEnsure(k.id); } catch (e) { continue; }
        var data = null;
        try { data = (typeof KB_MEM !== 'undefined' && KB_MEM[k.id]) ? KB_MEM[k.id] : null; } catch (e) {}
        if (!data) continue;
        (data.docs || []).forEach(function (d) {
          var t = (d.chunks || []).map(function (c) { return c.t || ''; }).join('\n') || d.text || '';
          if (!t) return;
          if (kw && t.indexOf(kw) < 0) return;
          out.push('', '## ' + k.name + ' · ' + (d.name || '资料'), '', t);
          docsN++; chars += t.length;
        });
      }
      if (!docsN) return { ok: false, text: '知识库里没找到' + (kw ? ('包含「' + kw + '」的段落') : '可导出的资料') };
      var name = '知识库' + (kw ? '-' + fileSafe(kw) : '') + '-' + stamp() + '.md';
      if (!downloadFile(name, out.join('\n'), 'text/markdown;charset=utf-8')) return { ok: false, text: '文件生成失败' };
      return { ok: true, changed: false, text: '已导出 ' + docsN + ' 篇 / ' + chars.toLocaleString() + ' 字 → ' + name, result: { name: name, docs: docsN } };
    }
  });

  /* ---------- 存题库 ---------- */
  register({
    id: 'save.quiz', title: '把上一条 AI 出题存成题库', risk: 'R1', reversible: true,
    paramsHint: '{sourceNode:"用户消息id", favorite:true|false}',
    resolve: function (ctx, p) {
      if (!p.sourceNode) throw new Error('没指定从哪条对话里取题');
      var q = null;
      try { q = (window.CHAT && CHAT.planQuiz) ? CHAT.planQuiz(p.sourceNode) : null; } catch (e) {}
      if (!q || !q.questions || !q.questions.length) throw new Error('往前翻没找到能解析成题库的题目：先让我出一套题');
      p.title = String(p.title || q.title || 'AI 出题').slice(0, 40);
      p.qCount = q.questions.length;
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') {
        var qd = CHAT.planQuiz(p.sourceNode);
        if (!qd || !qd.questions.length) return { ok: false, text: '题目不见了' };
        var vids = qd.questions.map(function (q, i) { return '$q' + i; });
        return {
          ok: true,
          impact: { banks: 1, questions: qd.questions.length, summary: '存成题库《' + p.title + '》（' + qd.questions.length + ' 题）' + (p.favorite ? '，并收藏全部题' : '') },
          virtual: { newBank: { id: '$new', title: p.title, qids: vids } }
        };
      }
      if (!window.VARIANT || !VARIANT.saveBankFromQuestions) return { ok: false, text: '存题库模块没加载' };
      var parsed = CHAT.planQuiz(p.sourceNode);
      if (!parsed || !parsed.questions.length) return { ok: false, text: '题目不见了' };
      if (p.qCount && parsed.questions.length !== p.qCount) return { ok: false, text: '题目数量和预览时不一样了，请重新预览' };
      ctx.capture(['qbank.local.v2', 'qbank.answerfix.v1', 'qbank.favs.v2', 'qbank.tomb.v1']);
      var id = VARIANT.saveBankFromQuestions(parsed.title || p.title || 'AI 出题', parsed.questions, { subtitle: '自建题库 · AI 对话出题 · ' + parsed.questions.length + ' 题' });
      if (!id) return { ok: false, text: '存题库失败' };
      var nb = bankOf(id);
      var favN = 0;
      if (p.favorite && nb) {
        var FAV = favData();
        (nb.questions || []).forEach(function (q) { var k = id + '#' + q.id; if (!FAV[k]) { FAV[k] = now(); favN++; } });
        if (favN) saveFavSafe();
      }
      return {
        ok: true, changed: true,
        text: '存成题库《' + ((nb && nb.title) || parsed.title || 'AI 出题') + '》（' + parsed.questions.length + ' 题）' + (p.favorite ? ('，收藏 ' + favN + ' 题') : ''),
        result: { bankId: id },
        virtual: { newBank: { id: id, title: (nb && nb.title) || parsed.title, qids: (nb ? nb.questions : parsed.questions).map(function (q) { return q.id; }) } }
      };
    }
  });

  /* ---------- 只读导航 ---------- */
  register({
    id: 'open.bank', title: '打开题库', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{bankTitle:"题库名"}',
    resolve: function (ctx, p) {
      var bs = targetBanks(p);
      if (!bs.length) throw new Error('没找到题库');
      p.bankId = bs[0].id; p.bankTitle = bs[0].title;
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '打开《' + p.bankTitle + '》' } };
      if (typeof go === 'function') go('#/bank/' + p.bankId);
      return { ok: true, changed: false, text: '打开《' + p.bankTitle + '》' };
    }
  });
  register({
    id: 'quiz.start', title: '开始刷题', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{bankTitle:"题库名"}',
    resolve: function (ctx, p) {
      var bs = targetBanks(p);
      if (!bs.length) throw new Error('没找到题库');
      p.bankId = bs[0].id; p.bankTitle = bs[0].title;
      return p;
    },
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '开始做《' + p.bankTitle + '》' } };
      if (typeof go === 'function') go('#/bank/' + p.bankId);
      return { ok: true, changed: false, text: '开始《' + p.bankTitle + '》' };
    }
  });
  register({
    id: 'quiz.review', title: '开始今日复习', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{}',
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '开始今日复习（60 题）' } };
      if (typeof startReview === 'function') startReview(60);
      return { ok: true, changed: false, text: '开始今日复习' };
    }
  });
  register({
    id: 'stats.recalc', title: '刷新统计', risk: 'R0', reversible: true, readOnly: true,
    paramsHint: '{}',
    run: async function (ctx, p) {
      if (ctx.mode === 'dry') return { ok: true, impact: { summary: '按最新数据刷新统计' } };
      invalidate();
      return { ok: true, changed: false, text: '统计已按最新数据刷新' };
    }
  });

  /* ---------------- 启动迁移（修 D-1 票据键名 bug） ---------------- */
  /* 旧版 K 表没有 tickets，preview/execute 读写的 K.tickets 是 undefined，
     票据实际被写进 localStorage 的字面量键 "undefined"。启动时搬回真键再清掉。 */
  function migrateLegacyTickets() {
    var raw = null;
    try { raw = localStorage.getItem('undefined'); } catch (e) { return; }
    if (!raw) return;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    var keys = Object.keys(parsed);
    if (!keys.length) return;
    var looksLikeTickets = keys.every(function (k) {
      var t = parsed[k];
      return t && typeof t === 'object' && t.hash === k && Array.isArray(t.steps);
    });
    if (!looksLikeTickets) return;   /* 不是票据（别的东西也用了 "undefined" 键）：不碰 */
    var cur = read(K.tickets, {}) || {}, n = 0;
    keys.forEach(function (k) { if (!cur[k]) { cur[k] = parsed[k]; n++; } });
    if (n) write(K.tickets, cur);
    try { localStorage.removeItem('undefined'); } catch (e) {}
  }
  try { migrateLegacyTickets(); } catch (e) {}

  /* ---------------- 对外 ---------------- */
  window.AI_OPS = {
    version: 2,
    register: register,
    alias: alias,
    getAction: getAction,
    actions: listActions,
    catalog: catalog,
    preview: preview,
    execute: execute,
    runNow: runNow,
    undoPlan: undoPlan,
    rollback: rollback,
    resume: resume,
    interrupted: interrupted,
    lastUndoable: lastUndoable,
    plans: plans,
    state: state,
    setKill: setKill,
    isKill: isKill,
    bumpVer: bumpVer,
    readVer: readVer,
    hashPlan: function (steps) { try { return hashPlan(normalize(steps)); } catch (e) { return ''; } },
    stepKey: function (planId, step, index) { return stepId(planId, { action: step.action, params: step.params || {}, index: index || 0 }, index); }
  };
})();
