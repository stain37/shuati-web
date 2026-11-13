/* 刷题站 · 按天流水（qbank.days.v1）
   目的：答题记录只存每题最后一次结果，无法还原"每天做了多少/复习多少"。
   做法：拦截 qbank.answers.v2 的写入，把发生变化的题目按当天记一行；
   首次运行用现有记录回填一次（近似，按每题最后作答日）。 */
(function () {
  if (window.__daylog) return;
  window.__daylog = 1;

  var ANS = 'qbank.answers.v2';
  var DAYS = 'qbank.days.v1';
  var MAXDAY = 400;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dstr(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function table() {
    var t = read(DAYS);
    if (!t || t.v !== 1) t = { v: 1, d: {} };
    return t;
  }
  function save(t) {
    var keys = Object.keys(t.d).sort();
    if (keys.length > MAXDAY) keys.slice(0, keys.length - MAXDAY).forEach(function (k) { delete t.d[k]; });
    try { localStorage.setItem(DAYS, JSON.stringify(t)); } catch (e) {}
  }
  function bump(day, ok, again) {
    var t = table();
    var b = t.d[day] || (t.d[day] = { done: 0, ok: 0, again: 0 });
    b.done++; if (ok) b.ok++; if (again) b.again++;
    save(t);
  }

  var last = null;
  function snapshot() { last = read(ANS) || {}; }

  function diffInto(next) {
    if (!next || typeof next !== 'object') return;
    var prev = last || {};
    Object.keys(next).forEach(function (k) {
      var a = next[k] || {}, b = prev[k] || {};
      var stamp = a.ts || a.gts || a.upd || 0;
      var oldStamp = b.ts || b.gts || b.upd || 0;
      if (stamp && stamp !== oldStamp) bump(dstr(stamp), !!a.ok, (a.tries || 1) > 1);
    });
    last = next;
  }

  // 1) 回填一次（只在完全没有流水时）
  if (!read(DAYS)) {
    var ans = read(ANS) || {};
    var t = { v: 1, d: {} };
    Object.keys(ans).forEach(function (k) {
      var a = ans[k] || {};
      var stamp = a.ts || a.gts || a.upd;
      if (!stamp) return;
      var day = dstr(stamp);
      var b = t.d[day] || (t.d[day] = { done: 0, ok: 0, again: 0 });
      b.done++; if (a.ok) b.ok++; if ((a.tries || 1) > 1) b.again++;
    });
    t.backfill = 1;
    try { localStorage.setItem(DAYS, JSON.stringify(t)); } catch (e) {}
  }
  snapshot();

  // 2) 拦截写入
  var raw = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    try {
      if (k === ANS) {
        var next = null;
        try { next = JSON.parse(v); } catch (e) { next = null; }
        diffInto(next);
      }
    } catch (e) {}
    return raw.apply(this, arguments);
  };

  // 3) 其它页签写入也能同步到内存快照
  window.addEventListener('storage', function (e) {
    if (e.key === ANS) { try { last = JSON.parse(e.newValue || '{}'); } catch (er) {} }
  });

  window.DAYLOG = {
    get: function () { var t = table(); return t.d; },
    raw: function () { return table(); }
  };
})();
