/* 调度核心测试：node sched.test.js */
const S = require('./sched.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log('FAIL', name, '\n  got ', got, '\n  want', want); }
}
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : extra); }
}

const DAY = 86400;
const CR = 20000;                     // collection 创建日
const T0 = CR * DAY;                  // 用整数天避免边界抖动
const ctx = (today, extra) => Object.assign({ today, crtDay: CR }, extra || {});

/* ---------- 字段 ---------- */
eq('fields roundtrip', S.decodeFields(S.encodeFields(['a', '', 'b']), 3), ['a', '', 'b']);
eq('fields pad', S.decodeFields('x', 3), ['x', '', '']);
ok('fields reject SEP', (() => { try { S.encodeFields(['a\x1fb']); return false; } catch (e) { return true; } })());
ok('fields reject extra', (() => { try { S.decodeFields('a\x1fb\x1fc', 2); return false; } catch (e) { return true; } })());
eq('orderByOrd', S.orderByOrd(['v0', 'v1', 'v2'], [2, 0, 1]), ['v1', 'v2', 'v0']);
ok('guid stable', S.guidFor('a', 'b') === S.guidFor('a', 'b'));
ok('guid 8 chars', S.guidFor('a', 'b').length === 8);

/* ---------- 新卡 ---------- */
let n = S.makeState({ type: 0, queue: 0, due: 0, ivl: 0 });
let r = S.answer(n, 3, T0, null, ctx(CR));
eq('new good -> learn step2', [r.type, r.queue, r.left, r.due - T0], [1, 1, 1, 600]);
r = S.answer(r, 3, T0 + 600, null, ctx(CR));
eq('learn good -> graduate', [r.type, r.queue, r.ivl, r.left, r.due], [2, 2, 1, 0, 1]);  // due = 相对 crt 的天数

r = S.answer(n, 1, T0, null, ctx(CR));
eq('new again -> step1 left2', [r.type, r.left, r.due - T0], [1, 2, 60]);
r = S.answer(n, 4, T0, null, ctx(CR));
eq('new easy -> 4d', [r.type, r.ivl, r.due], [2, 4, 4]);

/* ---------- 学习卡 ---------- */
let lrn = S.makeState({ type: 1, queue: 1, left: 2, due: T0 + 60 });
r = S.answer(lrn, 1, T0 + 60, null, ctx(CR));
eq('learn again reset', [r.left, r.due - (T0 + 60)], [2, 60]);
r = S.answer(lrn, 2, T0 + 60, null, ctx(CR));
eq('learn hard avg(1,10)=5m', [r.left, r.due - (T0 + 60)], [2, 300]);
let last = S.makeState({ type: 1, queue: 1, left: 1, due: T0 + 600 });
r = S.answer(last, 2, T0 + 600, null, ctx(CR));
eq('learn hard at last step 1.5x', r.due - (T0 + 600), 900);
r = S.answer(last, 3, T0 + 600, null, ctx(CR));
eq('learn good at last -> graduate', [r.type, r.ivl], [2, 1]);

/* ---------- 复习卡 ---------- */
function rev(ivl, factor, dueOffset, extra) {
  return S.makeState(Object.assign({ type: 2, queue: 2, ivl, factor, due: dueOffset, reps: 3 }, extra || {}));
}

eq('review good on time 10*2.5=25', S.answer(rev(10, 2500, 0), 3, T0, null, ctx(CR)).ivl, 25);
eq('review hard 10*1.2=12', S.answer(rev(10, 2500, 0), 2, T0, null, ctx(CR)).ivl, 12);
eq('review easy 10*2.5*1.3=33', S.answer(rev(10, 2500, 0), 4, T0, null, ctx(CR)).ivl, 33);
eq('review again -> relearn, ivl 1', (() => {
  const x = S.answer(rev(10, 2500, 0), 1, T0, null, ctx(CR));
  return [x.type, x.queue, x.left, x.ivl, x.factor, x.lapses];
})(), [3, 3, 1, 1, 2300, 1]);

/* 逾期：late 参与计算 */
eq('review good late 10d', S.answer(rev(10, 2500, 0), 3, T0 + 10 * DAY, null, ctx(CR + 10)).ivl, 38);
eq('review hard late 10d', S.answer(rev(10, 2500, 0), 2, T0 + 10 * DAY, null, ctx(CR + 10)).ivl, 15);
eq('review easy late 10d', S.answer(rev(10, 2500, 0), 4, T0 + 10 * DAY, null, ctx(CR + 10)).ivl, 65);

/* due 写入：今天 + 新间隔 */
eq('review due day (late 3 -> ivl 29)', S.answer(rev(10, 2500, 0), 3, T0, null, ctx(CR + 3)).due, 3 + 29);

/* ---------- 重学 ---------- */
let rl = S.makeState({ type: 3, queue: 3, left: 1, ivl: 10, factor: 2300 });
r = S.answer(rl, 3, T0, null, ctx(CR, { preLapseIvl: 10 }));
eq('relearn good -> graduate 1d', [r.type, r.ivl], [2, 1]);
r = S.answer(rl, 4, T0, null, ctx(CR, { preLapseIvl: 10 }));
eq('relearn easy -> graduate 1d', [r.type, r.ivl], [2, 1]);

/* ---------- 属性 ---------- */
(() => {
  for (let ivl = 1; ivl <= 200; ivl += 7) {
    for (const factor of [1300, 2000, 2500, 3000]) {
      const base = rev(ivl, factor, 0);
      const h = S.answer(base, 2, T0, null, ctx(CR)).ivl;
      const g = S.answer(base, 3, T0, null, ctx(CR)).ivl;
      const e = S.answer(base, 4, T0, null, ctx(CR)).ivl;
      ok('monotonic hard<=good<=easy', h <= g && g <= e, [ivl, factor, h, g, e]);
      ok('min interval', Math.min(h, g, e) >= 1);
    }
  }
  const capped = S.answer(rev(1000, 2500, 0), 4, T0, null, ctx(CR, {})).ivl;
  ok('max interval clamp', capped <= 36500);
  let f = 2500, st = rev(10, 2500, 0);
  for (let i = 0; i < 10; i++) {
    st = S.answer(st, 1, T0 + i, null, ctx(CR));          // Again：进重学，EF -200
    f = st.factor;
    st = S.makeState({ type: 2, queue: 2, ivl: 1, factor: f, due: 0, reps: i });  // 重学毕业后再回到复习
  }
  eq('10x again floor 1300', f, 1300);
  // Again 后必须进学习队列
  const again = S.answer(rev(10, 2500, 0), 1, T0, null, ctx(CR));
  ok('again leaves review queue', again.type !== 2, again.type);
  // 不修改入参
  const orig = rev(10, 2500, 0); const snap = JSON.stringify(orig);
  S.answer(orig, 3, T0, null, ctx(CR));
  eq('input not mutated', JSON.stringify(orig), snap);
  // 学习卡状态自洽
  for (const rating of [1, 2, 3, 4]) {
    const rr = S.answer(S.makeState({ type: 0, queue: 0, due: 0, ivl: 0 }), rating, T0, null, ctx(CR));
    eq('state self-consistent r' + rating, S.checkState(rr), []);
  }
})();

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
