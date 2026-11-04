/* 导出题目：筛选 → 勾选（可框选）→ 生成 HTML / 打印成 PDF
   只读现有题库与作答记录，不改任何数据。对外：EXP.open(bank) */
(function () {
  'use strict';
  var host = null, bank = null;
  var sel = {}, F = { subj: [], type: [], state: [], knows: [], q: '' };
  var sortBy = 'def', view = 'list', cellW = 120, ai = true, fmt = 'html';
  var press = null, suppressClick = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast2(m, t, k) { if (typeof window.toast === 'function') window.toast(m, t, k); }
  function basics() { try { return (window.TAGS && TAGS.basic) ? TAGS.basic() : ['生理', '生化', '病理', '内科', '外科', '人文', '政治']; } catch (e) { return ['生理', '生化', '病理', '内科', '外科', '人文', '政治']; } }
  function tagsOf(q) { try { return (window.qzTags ? qzTags(qzKey(bank, q)) : (TAGS.of ? TAGS.of(kOf(bank, q)) : [])) || []; } catch (e) { return []; } }
  function recOf(q) { try { return ANS[kOf(bank, q)] || null; } catch (e) { return null; } }
  function subjOf(q) { try { return qzBasicOf(bank, q, basics()); } catch (e) { return []; } }
  function knowsOf(q) { var b = basics(); return tagsOf(q).filter(function (t) { return b.indexOf(t) < 0; }); }
  function typeOf(q) { try { return qTypeOf(q); } catch (e) { return 'A1'; } }

  function rowsAll() {
    var qs = (bank && bank.questions) ? bank.questions.slice() : [];
    return qs.map(function (q) {
      var r = recOf(q), tries = (r && r.tries) || 0, wrong = (r && r.wrong) || 0;
      return {
        q: q, key: kOf(bank, q), subj: subjOf(q), knows: knowsOf(q), type: typeOf(q),
        tries: tries, wrong: wrong, pct: tries ? Math.round(wrong / tries * 100) : 0,
        done: tries > 0, ts: (r && r.ts) || 0, ink: !!(window.INK && INK.hasInk && INK.hasInk(bank, q))
      };
    });
  }

  function SY() {
    return { '心衰': ['心力衰竭', '洋地黄'], '心梗': ['心肌梗死', '肌红蛋白'], '心绞痛': ['心绞痛', '硝酸酯'],
      '肺炎': ['大叶性肺炎', '肺炎'], '溃疡': ['消化性溃疡'], 'tca': ['三羧酸循环'], '循环': ['三羧酸循环'],
      '真理': ['认识论'], '肾': ['肾小球滤过'], '哮喘': ['哮喘'], '血栓': ['栓塞', '血栓'] };
  }
  function fuzzyKnow(s, all) {
    s = String(s || '').toLowerCase(); if (!s) return [];
    var syn = SY()[s] || [];
    return all.filter(function (k) {
      if (k.toLowerCase().indexOf(s) >= 0) return true;
      for (var i = 0; i < syn.length; i++) if (k.indexOf(syn[i]) >= 0) return true;
      var hit = 0;
      for (var j = 0; j < s.length; j++) if (k.indexOf(s[j]) >= 0) hit++;
      return hit >= Math.ceil(s.length * 0.6) && s.length >= 2;
    });
  }

  function pass(r) {
    if (F.subj.length && !F.subj.some(function (s) { return r.subj.indexOf(s) >= 0; })) return false;
    if (F.type.length && F.type.indexOf(r.type) < 0) return false;
    if (F.state.length) {
      var st = r.done ? (r.wrong > 0 && !(r.q && false) ? 'wrong' : 'done') : 'undone';
      if (st === 'done' && r.wrong > 0) st = 'wrong';
      if (F.state.indexOf(st) < 0) return false;
    }
    if (F.knows.length && !F.knows.every(function (k) { return r.knows.indexOf(k) >= 0; })) return false;
    var s = F.q.trim(); if (!s) return true;
    var hay = (r.q.stem || '') + ' ' + (r.q.group || '') + ' ' + ((r.q.options || []).join(' ')) + ' ' + (r.q.explain || '') + ' ' + r.knows.join(' ');
    if (hay.indexOf(s) >= 0) return true;
    if (!ai) return false;
    if (s.length >= 2) {
      var hit = 0;
      for (var i = 0; i < s.length; i++) if (hay.indexOf(s[i]) >= 0) hit++;
      if (hit >= Math.ceil(s.length * 0.6) && hit >= 2) return true;
    }
    return false;
  }

  function filtered() {
    var rs = rowsAll().filter(pass);
    if (sortBy === 'rate') rs.sort(function (a, b) { return b.pct - a.pct; });
    else if (sortBy === 'num') rs.sort(function (a, b) { return b.wrong - a.wrong; });
    else if (sortBy === 'recent') rs.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return rs;
  }

  function chipsHtml(id, list) {
    return list.map(function (o) {
      return '<button class="exp-chip' + (o.v === '' ? ' on' : '') + '" data-v="' + esc(o.v) + '">' + esc(o.label) + '</button>';
    }).join('');
  }
  function bindChips(sel, key) {
    var el = host.querySelector(sel);
    el.onclick = function (ev) {
      var b = ev.target.closest('.exp-chip'); if (!b) return;
      var v = b.dataset.v;
      if (v === '') { F[key] = []; Array.prototype.forEach.call(el.children, function (x) { x.classList.toggle('on', x.dataset.v === ''); }); }
      else {
        var i = F[key].indexOf(v);
        if (i >= 0) { F[key].splice(i, 1); b.classList.remove('on'); }
        else { F[key].push(v); b.classList.add('on'); }
        el.firstElementChild.classList.toggle('on', !F[key].length);
      }
      render();
    };
  }

  function open(b) {
    if (!b) return;
    bank = b; sel = {}; F = { subj: [], type: [], state: [], knows: [], q: '' };
    close();
    host = document.createElement('div');
    host.className = 'exp-mask';
    var allKnow = [];
    rowsAll().forEach(function (r) { r.knows.forEach(function (k) { if (allKnow.indexOf(k) < 0) allKnow.push(k); }); });
    host.dataset.knows = JSON.stringify(allKnow.slice(0, 400));
    host.innerHTML =
      '<div class="exp-box">' +
      '<div class="exp-head"><b>导出题目</b><span class="exp-sub">' + esc(bank.title || '') + ' · ' + ((bank.questions || []).length) + ' 题</span>' +
      '<span class="spacer-grow"></span><button class="exp-close" title="关闭">✕</button></div>' +
      '<div class="exp-body">' +
      '<div class="exp-row"><span class="exp-lab">科目</span><span class="exp-chips" id="expSubj">' +
      chipsHtml('', [{ v: '', label: '全部' }].concat(basics().map(function (s) { return { v: s, label: s }; }))) + '</span></div>' +
      '<div class="exp-row"><span class="exp-lab">题型</span><span class="exp-chips" id="expType">' +
      chipsHtml('', [{ v: '', label: '全部' }, { v: 'A1', label: 'A1 单选' }, { v: 'A2', label: 'A2 病例' }, { v: 'B1', label: 'B1 配伍' }, { v: 'X', label: 'X 多选' }]) + '</span></div>' +
      '<div class="exp-row"><span class="exp-lab">状态</span><span class="exp-chips" id="expState">' +
      chipsHtml('', [{ v: '', label: '全部' }, { v: 'undone', label: '未做' }, { v: 'done', label: '已做' }, { v: 'wrong', label: '错的' }]) + '</span></div>' +
      '<div class="exp-row"><span class="exp-lab">知识点</span><span class="exp-know">' +
      '<input class="exp-kq" placeholder="输入知识点，AI 模糊匹配（可多选）">' +
      '<label class="exp-ai"><input type="checkbox" checked class="exp-aick"> AI 模糊</label>' +
      '<span class="exp-ksug"></span><span class="exp-kchips"></span></span></div>' +
      '<div class="exp-row"><input class="exp-sq" placeholder="题干 / 选项 / 解析里含有…">' +
      '<select class="exp-sort"><option value="def">默认顺序</option><option value="rate">错误率从高到低</option>' +
      '<option value="num">错误次数从多到少</option><option value="recent">最近做过的在前</option></select>' +
      '<span class="exp-view"><button data-v="list" class="on">▤ 列表</button><button data-v="grid">▦ 缩略图</button></span>' +
      '<input type="range" class="exp-size" min="70" max="220" step="10" value="120" style="display:none">' +
      '</div>' +
      '<div class="exp-row"><button class="exp-all">全选</button><button class="exp-inv">反选</button>' +
      '<span class="exp-hint">单击＝选中；按住拖动＝框选</span>' +
      '<span class="spacer-grow"></span><span class="exp-count">已选 0 题</span></div>' +
      '<div class="exp-list"></div>' +
      '<div class="exp-grid" style="display:none"></div>' +
      '</div>' +
      '<div class="exp-foot">' +
      '<span class="exp-lab">格式</span><span class="exp-fmt"><button data-v="html" class="on">HTML</button><button data-v="pdf">PDF</button></span>' +
      '<label class="exp-ck"><input type="checkbox" class="exp-ink" checked> 带批注</label>' +
      '<label class="exp-ck"><input type="checkbox" class="exp-ans"> 带答案</label>' +
      '<label class="exp-ck"><input type="checkbox" class="exp-exp" checked> 带解析</label>' +
      '<button class="exp-go btn primary" style="margin-left:auto">导出 0 题</button>' +
      '</div></div>';
    document.body.appendChild(host);

    host.querySelector('.exp-close').onclick = close;
    host.onclick = function (ev) { if (ev.target === host) close(); };
    bindChips('#expSubj', 'subj'); bindChips('#expType', 'type'); bindChips('#expState', 'state');
    host.querySelector('.exp-sq').oninput = function (e) { F.q = e.target.value; render(); };
    host.querySelector('.exp-aick').onchange = function (e) { ai = e.target.checked; };
    host.querySelector('.exp-sort').onchange = function (e) { sortBy = e.target.value; render(); };
    host.querySelector('.exp-view').onclick = function (ev) {
      var b2 = ev.target.closest('button'); if (!b2) return;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.remove('on'); });
      b2.classList.add('on'); view = b2.dataset.v; render();
    };
    host.querySelector('.exp-size').oninput = function (e) { cellW = +e.target.value; render(); };
    host.querySelector('.exp-all').onclick = function () { filtered().forEach(function (r) { sel[r.key] = 1; }); render(); };
    host.querySelector('.exp-inv').onclick = function () { filtered().forEach(function (r) { sel[r.key] = sel[r.key] ? 0 : 1; }); render(); };
    host.querySelector('.exp-fmt').onclick = function (ev) {
      var b3 = ev.target.closest('button'); if (!b3) return;
      Array.prototype.forEach.call(this.children, function (x) { x.classList.remove('on'); });
      b3.classList.add('on'); fmt = b3.dataset.v;
    };
    host.querySelector('.exp-go').onclick = doExport;

    var kq = host.querySelector('.exp-kq'), sug = host.querySelector('.exp-ksug');
    kq.oninput = function () {
      var s = kq.value.trim();
      if (!s) { sug.style.display = 'none'; return; }
      var all = JSON.parse(host.dataset.knows || '[]');
      var list = (host.querySelector('.exp-aick').checked ? fuzzyKnow(s, all) : all.filter(function (k) { return k.indexOf(s) >= 0; }))
        .filter(function (k) { return F.knows.indexOf(k) < 0; }).slice(0, 12);
      sug.innerHTML = list.map(function (k) { return '<div data-k="' + esc(k) + '">' + esc(k) + '</div>'; }).join('');
      sug.style.display = list.length ? 'block' : 'none';
      sug.onclick = function (ev) {
        var d = ev.target.closest('div'); if (!d) return;
        F.knows.push(d.dataset.k); kq.value = ''; sug.style.display = 'none'; paintKnow(); render();
      };
    };
    kq.onblur = function () { setTimeout(function () { sug.style.display = 'none'; }, 180); };

    bindGrid();
    paintKnow();
    render();
  }

  function paintKnow() {
    var box = host.querySelector('.exp-kchips');
    box.innerHTML = F.knows.map(function (k) {
      return '<span class="exp-kchip">' + esc(k) + '<b data-k="' + esc(k) + '">×</b></span>';
    }).join('');
    box.onclick = function (ev) {
      var b = ev.target.closest('b'); if (!b) return;
      F.knows = F.knows.filter(function (x) { return x !== b.dataset.k; });
      paintKnow(); render();
    };
  }

  function bindGrid() {
    var grid = host.querySelector('.exp-grid');
    grid.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      press = { x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId };
    });
    grid.addEventListener('pointermove', function (ev) {
      if (!press) return;
      if (!press.moved) {
        if (Math.abs(ev.clientX - press.x) <= 4 && Math.abs(ev.clientY - press.y) <= 4) return;
        press.moved = true;
        try { grid.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      var m = host.querySelector('.exp-marq');
      if (!m) { m = document.createElement('div'); m.className = 'exp-marq'; document.body.appendChild(m); }
      m.style.display = 'block';
      m.style.left = Math.min(press.x, ev.clientX) + 'px';
      m.style.top = Math.min(press.y, ev.clientY) + 'px';
      m.style.width = Math.abs(ev.clientX - press.x) + 'px';
      m.style.height = Math.abs(ev.clientY - press.y) + 'px';
    });
    grid.addEventListener('pointerup', function (ev) {
      if (!press) return;
      var moved = press.moved, sx = press.x, sy = press.y;
      press = null;
      var m = host.querySelector('.exp-marq'); if (m) m.style.display = 'none';
      try { grid.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (!moved) return;
      suppressClick = true; setTimeout(function () { suppressClick = false; }, 120);
      var l = Math.min(sx, ev.clientX), t = Math.min(sy, ev.clientY);
      var w = Math.abs(ev.clientX - sx), h = Math.abs(ev.clientY - sy);
      Array.prototype.forEach.call(grid.querySelectorAll('.exp-cell'), function (c) {
        var r = c.getBoundingClientRect();
        if (r.left < l + w && r.left + r.width > l && r.top < t + h && r.top + r.height > t) sel[c.dataset.k] = 1;
      });
      render();
    });
  }

  function render() {
    if (!host) return;
    var rs = filtered();
    var list = host.querySelector('.exp-list'), grid = host.querySelector('.exp-grid');
    list.style.display = view === 'list' ? '' : 'none';
    grid.style.display = view === 'grid' ? '' : 'none';
    host.querySelector('.exp-size').style.display = view === 'grid' ? '' : 'none';

    if (view === 'list') {
      list.innerHTML = rs.map(function (r, i) {
        return '<label class="exp-item' + (sel[r.key] ? ' on' : '') + '">' +
          '<input type="checkbox" data-k="' + esc(r.key) + '"' + (sel[r.key] ? ' checked' : '') + '>' +
          '<div><div class="exp-stem">' + esc(r.q.stem || '') + '</div>' +
          '<div class="exp-meta">' + esc(r.subj.join('、') || '未分科') + ' · ' + esc(typeName(r.type)) +
          ' · 错 ' + r.wrong + ' 次' + (r.tries ? ' · 错误率 ' + r.pct + '%' : '') + (r.ink ? ' · ✎' : '') +
          (r.knows.length ? ' · ' + esc(r.knows.join('、')) : '') + '</div></div></label>';
      }).join('');
      list.onclick = function (ev) {
        var it = ev.target.closest('.exp-item'); if (!it) return;
        ev.preventDefault();
        var k = it.querySelector('input').dataset.k;
        sel[k] = sel[k] ? 0 : 1;
        render();
      };
    } else {
      grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(' + cellW + 'px,1fr))';
      grid.innerHTML = rs.map(function (r) {
        return '<div class="exp-cell' + (sel[r.key] ? ' on' : '') + '" data-k="' + esc(r.key) + '">' +
          '<div class="exp-th" style="height:' + Math.round(cellW * 0.5) + 'px">' + (r.ink ? '✎' : '▤') + '</div>' +
          '<div class="exp-nm">' + esc(r.q.stem || '') + '</div>' +
          '<div class="exp-meta">' + esc(r.subj.join('、') || '未分科') + ' · 错' + r.wrong + '</div></div>';
      }).join('');
      grid.onclick = function (ev) {
        if (suppressClick) return;
        var c = ev.target.closest('.exp-cell'); if (!c) return;
        sel[c.dataset.k] = sel[c.dataset.k] ? 0 : 1; render();
      };
    }
    syncCount();
  }
  function syncCount() {
    var n = 0, total = filtered().length;
    for (var k in sel) if (sel[k]) n++;
    host.querySelector('.exp-count').textContent = '已选 ' + n + ' 题 / 当前 ' + total + ' 题';
    host.querySelector('.exp-go').textContent = '导出 ' + n + ' 题';
  }
  function typeName(t) { return ({ A1: 'A1 单选', A2: 'A2 病例', B1: 'B1 配伍', X: 'X 多选', C: 'C 型' })[t] || t; }

  function docHtml(rs) {
    var ink = host.querySelector('.exp-ink').checked;
    var ans = host.querySelector('.exp-ans').checked;
    var exp = host.querySelector('.exp-exp').checked;
    var d = new Date();
    var date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    var css = [
      '@page{size:A4;margin:14mm 12mm}',
      'body{font:14px/1.8 "Microsoft YaHei",system-ui,sans-serif;color:#0f172a;margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.wrap{max-width:760px;margin:0 auto;padding:8px 0 24px}',
      'h1{font-size:19px;margin:0 0 4px}',
      '.meta{font-size:12px;color:#64748b;margin:0 0 16px;padding-bottom:10px;border-bottom:2px solid #0f172a}',
      '.q{page-break-inside:avoid;break-inside:avoid;margin:0 0 14px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;position:relative}',
      '.qn{font-size:12px;color:#64748b;font-weight:600;margin-bottom:2px}',
      '.stem{font-size:14.5px;font-weight:600;line-height:1.75;margin:0 0 8px}',
      '.gstem{font-size:13.5px;color:#334155;background:#f8fafc;border-radius:6px;padding:6px 9px;margin:0 0 8px}',
      '.opt{font-size:14px;line-height:1.7;margin:0 0 3px}',
      '.opt b{display:inline-block;width:20px;color:#475569}',
      '.ans{font-size:13px;color:#0f766e;margin-top:8px;font-weight:600}',
      '.exp{font-size:13.5px;line-height:1.75;color:#334155;margin-top:6px;padding:7px 10px;border-left:3px solid #5eead4;background:#f0fdfa;border-radius:0 6px 6px 0;white-space:pre-wrap}',
      '.inkbox{position:absolute;inset:0;pointer-events:none}',
      '.inkbox img{width:100%;height:100%;object-fit:contain}',
      '.pad{height:14px}'
    ].join('\n');
    var body = rs.map(function (r, i) {
      var q = r.q;
      var h = '<div class="q"><div class="qn">第 ' + (i + 1) + ' 题 · ' + esc(r.subj.join('、') || '未分科') + ' · ' + esc(typeName(r.type)) +
        (r.tries ? ' · 错误率 ' + r.pct + '%' : '') + '</div>';
      if (q.group) h += '<div class="gstem"><b>共用题干：</b>' + esc(q.group) + '</div>';
      h += '<div class="stem">' + esc(q.stem || '') + '</div>';
      (q.options || []).forEach(function (o, j) {
        h += '<div class="opt"><b>' + 'ABCDEFGHIJKL'[j] + '</b>' + esc(o) + '</div>';
      });
      if (ans) h += '<div class="ans">答案：' + esc((q.answer || []).join('')) + '</div>';
      if (exp && q.explain) h += '<div class="exp">' + esc(q.explain) + '</div>';
      if (ink && r.ink) {
        var png = '';
        try { png = INK.pngOf(bank, q); } catch (e) {}
        if (png) h += '<div class="inkbox"><img src="' + png + '"></div>';
      }
      return h + '</div>';
    }).join('\n');
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>刷题站 · 题目导出</title><style>' + css + '</style></head><body><div class="wrap">' +
      '<h1>' + esc(bank.title || '题目导出') + '</h1>' +
      '<div class="meta">共 ' + rs.length + ' 题　' + date + '　' + (ink ? '含批注　' : '') + (ans ? '含答案　' : '') + (exp ? '含解析' : '') + '</div>' +
      body + '<div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:14px">— 由刷题站导出 —</div></div></body></html>';
  }

  function doExport() {
    var rs = filtered().filter(function (r) { return sel[r.key]; });
    if (!rs.length) { toast2('先勾选要导出的题', 1800, 'bad'); return; }
    var html = docHtml(rs);
    if (fmt === 'pdf') {
      var fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
      document.body.appendChild(fr);
      fr.srcdoc = html;
      fr.onload = function () {
        setTimeout(function () {
          try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast2('打印被浏览器拦了，换 HTML 打开再打印', 2600, 'bad'); }
          setTimeout(function () { fr.remove(); }, 60000);
        }, 250);
      };
    } else {
      var w = window.open('', '_blank');
      if (!w) { toast2('被浏览器拦了新窗口，允许弹出后再试', 2400, 'bad'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    }
    toast2(fmt === 'pdf' ? '已生成 ' + rs.length + ' 题，正在调起打印（另存为 PDF）' : '已在新标签打开 ' + rs.length + ' 题', 2400, 'good');
  }

  function close() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    var m = document.querySelector('.exp-marq'); if (m) m.remove();
    host = null;
  }

  window.EXP = { open: open, close: close };
})();
