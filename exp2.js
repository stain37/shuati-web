/* 导出题目：筛选 → 勾选（可框选）→ 生成 HTML / 打印成 PDF
   只读现有题库与作答记录，不改任何数据。对外：EXP.open(bank) */
(function () {
  'use strict';
  var host = null, bank = null;
  var sel = {}, F = { subj: [], type: [], state: [], knows: [], q: '' };
  var sortBy = 'def', view = 'list', cellW = 120, ai = true, fmt = 'html', note = 'ink';
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
    try {
      var allQ = ((bank && bank.questions) || []).slice(0, 60);
      allQ.forEach(function (q) {
        if (!window.INK || !INK.bake) return;
        INK.bake(bank, q).then(function (b) { if (b && b.url) BAKED[q.id] = b.url; }).catch(function () {});
      });
    } catch (e) {}

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
      '<span class="exp-lab">附注</span><span class="exp-note"><button data-v="none">无</button><button data-v="ink" class="on">题目批注</button><button data-v="board">白板手稿</button><select class="exp-board" hidden></select></span>' +
      '<label class="exp-ck"><input type="checkbox" class="exp-ans"> 带答案</label>' +
      '<label class="exp-ck"><input type="checkbox" class="exp-exp" checked> 带解析</label>' +
      '<button class="exp-go btn primary" style="margin-left:auto" onclick="try{window.EXP._go()}catch(e){alert(\'\u5bfc\u51fa\u51fa\u9519\uff1a\'+(e&&e.message||e))}">导出 0 题</button>' +
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
    host.querySelector('.exp-note').onclick = function (ev) {
      var b4 = ev.target.closest('button'); if (!b4) return;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('on'); });
      b4.classList.add('on'); note = b4.dataset.v;
      var sel1 = host.querySelector('.exp-board');
      sel1.hidden = note !== 'board';
    };
    (function () {
      var sel1 = host.querySelector('.exp-board');
      var bs = [];
      try { bs = (window.INK && INK.boards) ? INK.boards() : []; } catch (e) {}
      sel1.innerHTML = bs.length ? bs.map(function (b, i) {
        return '<option value="' + b.id + '">' + (b.name || ('手稿 ' + (i + 1))) + '</option>';
      }).join('') : '<option value="">（还没有白板手稿）</option>';
    })();
    host.querySelector('.exp-go').onclick = doExport;
    try {
      var runSelf = function () {
        selfTest(function (r) {
          var m = document.createElement('div'); m.className = 'exp-mask';
          m.innerHTML = '<div class="exp-box" style="max-width:520px">' +
            '<div class="exp-head"><b>批注自检</b><button class="exp-x" title="关闭">✕</button></div>' +
            '<div style="padding:10px 14px"><textarea readonly style="width:100%;height:180px;font:12px/1.6 ui-monospace,Consolas,monospace;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--card2);color:var(--ink)"></textarea></div></div>';
          document.body.appendChild(m);
          var ta = m.querySelector('textarea');
          ta.value = JSON.stringify(r, null, 2);
          ta.onclick = function () { ta.select(); };
          ta.focus(); ta.select();
          m.querySelector('.exp-x').onclick = function () { m.remove(); };
          m.onclick = function (ev) { if (ev.target === m) m.remove(); };
        });
      };


    } catch (e) {}

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
      try { ev.preventDefault(); } catch (e) {}
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

  function zoomStyle(png, rec) {
    if (!png) return '';
    var need = 718 + Math.max(0, (png.cr.x - png.x)) + Math.max(0, (png.x + png.w) - (png.cr.x + png.cr.w)) + 10;
    var z = Math.min(1, 748 / need);
    return z < 0.995 ? ' style="zoom:' + z.toFixed(3) + '"' : '';
  }

  var BAKED = {};   /* qid -> 已烤好的批注整图（题目+批注对齐，导出不再算框） */
  function docHtml(rs, baked) {
    BAKED = baked || BAKED;
    var ans = host.querySelector('.exp-ans').checked;
    var exp = host.querySelector('.exp-exp').checked;
    var d = new Date();
    var date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    var de = document.documentElement, db = document.body;
    var attrStyle = de.getAttribute('data-style') || '', attrTheme = de.getAttribute('data-theme') || '';
    var attrBig = de.getAttribute('data-big') || '';
    var fsCls = (db.className.match(/\bfs-[a-z]+\b/) || [''])[0];
    /* 用站点自己的样式表，导出的题目排版和答题页一模一样（批注才对得上位置） */
    var css = [
      '@page{size:A4;margin:10mm}',
      'html,body{background:#fff!important}',
      'body::before,body::after{display:none!important}',
      '.doc{width:190mm;margin:0 auto;padding:4mm 0 8mm;background:#fff}',
      '.doc>h1{font-size:18px;margin:0 0 4px}',
      '.doc>.meta{font-size:12px;color:var(--sub,#64748b);margin:0 0 8mm;padding-bottom:6px;border-bottom:1px solid var(--line)}',
      '.qwrap{position:relative;margin:0 0 6mm;break-inside:avoid;page-break-inside:avoid}',
      '.qbox{position:relative;margin:0 0 6mm;break-inside:avoid;page-break-inside:avoid}',
      '.qbox>.qcard{position:relative;z-index:0}',
      '.qbox>.inkimg{position:absolute;left:0;top:0;z-index:5;pointer-events:none;max-width:none}',
      '.qwrap>.card{box-shadow:none;border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 16px}',
      '.qwrap .inkimg{position:absolute;pointer-events:none;max-width:none;z-index:2}',
      '.qwrap .qhead{flex-wrap:wrap;gap:6px}',
      '.doc .opts{margin-top:10px}',
      '.wpage{break-inside:avoid;page-break-inside:avoid;margin:0 0 6mm}',
      '.wpage>img{width:100%;border:1px solid var(--line);border-radius:8px;display:block}',
      '.wcap{font-size:12px;color:var(--sub,#64748b);margin:0 0 4px}',
      '@media print{.doc{width:auto;padding:0}}'
    ].join('\n');
    var dbgN = 0, dbgRec = 0, dbgGeo = 0;
    var body = rs.map(function (r, i) {
      var q = r.q, rec = null;
      if (BAKED && BAKED[q.id]) {
        var bk = BAKED[q.id];
        var hb = '<div class="qwrap"><img src="' + bk + '" style="width:718px;display:block;border-radius:10px"></div>';
        if (ans && false) hb += '';
        return hb;
      }
      try { rec = (window.INK && INK.inkRec) ? INK.inkRec(bank, q) : null; } catch (e) {}
      var png = null;
      if (note === 'ink' && rec && rec.ops && rec.ops.length) {
        try { png = INK.pngOf(bank, q, { paper: 'light' }); } catch (e) {}
      }
      /* 有批注时，外面再套一层「画布盒」：盒子尺寸＝题目卡片 ∪ 笔迹范围，
         题目卡片居中放进去，批注整张图铺在盒子上——这样画到题目外面的笔迹不会被页边裁掉 */
      var W = 718, geo = null;
      var imgs = [];
      try { imgs = (window.INK && INK.imgList) ? (INK.imgList(bank, q) || []) : []; } catch (e) {}
      /* cr 缺失时兜底：旧记录可能只有 vw/vh；再不行用 pngOf 的 cr 或 0,0 */
      if (rec && (!rec.cr)) {
        if (png && png.cr) rec.cr = png.cr;
        else {
          var cc = document.querySelector('#view .card');
          var cr1 = cc ? cc.getBoundingClientRect() : null;
          rec.cr = cr1 ? { x: Math.round(cr1.left + scrollX), y: Math.round(cr1.top + scrollY), w: Math.round(cr1.width), h: Math.round(cr1.height) }
                       : { x: 0, y: 0, w: 718, h: 600 };
        }
      }
      if (rec && rec.ops && rec.ops.length && rec.cr) {
        /* 外框 = 题目卡片 ∪ 笔迹图 ∪ 每张图片；哪怕只有图片、没有笔画也要出框 */
        var cr0 = rec.cr;
        var bx = cr0.x, by = cr0.y, bw = cr0.w, bh = cr0.h;
        if (png) {
          bx = Math.min(bx, png.x); by = Math.min(by, png.y);
          bw = Math.max(cr0.x + cr0.w, png.x + png.w) - bx;
          bh = Math.max(cr0.y + cr0.h, png.y + png.h) - by;
        }
        imgs.forEach(function (m) {
          bx = Math.min(bx, m.x); by = Math.min(by, m.y);
          bw = Math.max(cr0.x + cr0.w, m.x + m.w) - bx;
          bh = Math.max(cr0.y + cr0.h, m.y + m.h) - by;
        });
        var K = W / Math.max(1, cr0.w);
        geo = {
          w: Math.round(bw * K), h: Math.round(bh * K),
          cl: Math.round((cr0.x - bx) * K), ct: Math.round((cr0.y - by) * K),
          iw: png ? Math.round(png.w * K) : 0, url: png ? png.url : '',
          bx: bx, by: by, K: K
        };
        geo.z = Math.min(1, 700 / Math.max(1, geo.w), 1000 / Math.max(1, geo.h));
      }
      if (rec) dbgRec++; if (rec && rec.ops) dbgN += rec.ops.length; if (geo) dbgGeo++;
      var h = (geo ? '<div class="qbox" style="width:' + geo.w + 'px;height:' + Math.round(geo.h) +
        'px;zoom:' + (geo.z || 1).toFixed(3) + '">' : '<div class="qwrap">') +
        '<div class="card qcard"' + (geo ? ' style="margin-left:' + geo.cl + 'px;margin-top:' + geo.ct + 'px;width:' + W + 'px"' : '') + '>' +
        '<div class="qhead"><span class="qno">第 ' + (i + 1) + ' 题</span>' +
        '<span class="tag">' + esc(typeName(r.type)) + '</span>' +
        (r.tries ? '<span class="tag g">错误率 ' + r.pct + '%</span>' : '') +
        '<span class="tag g">' + esc(r.subj.join('、') || '未分科') + '</span></div>';
      if (q.group) h += '<div class="gstem"><b>共用题干：</b>' + esc(q.group) + '</div>';
      h += '<div class="stem">' + esc(q.stem || '') + '</div>';
      h += '<div class="opts">';
      (q.options || []).forEach(function (o, j) {
        h += '<div class="opt"><span class="k">' + 'ABCDEFGHIJKL'[j] + '</span><span>' + esc(o) + '</span></div>';
      });
      h += '</div>';
      if (ans) h += '<div class="exp" style="border-left-color:var(--primary)">答案：' + esc((q.answer || []).join('')) + '</div>';
      if (exp && q.explain) h += '<div class="exp">' + esc(q.explain) + '</div>';
      h += '</div>';
      if (geo) {
        if (geo.url) h += '<img class="inkimg" src="' + geo.url + '" style="left:0;top:0;width:' + geo.iw + 'px">';
        /* 图片笔迹不走 canvas，单独按同一套坐标叠上去；盒子已把图片外框算进去 */
        var imgs2 = [];
        try { imgs2 = (window.INK && INK.imgList) ? (INK.imgList(bank, q) || []) : []; } catch (e) {}
        imgs2.forEach(function (m) {
          h += '<img class="inkimg" src="' + m.data + '"' +
            ' style="left:' + Math.round((m.x - geo.bx) * geo.K) + 'px;top:' + Math.round((m.y - geo.by) * geo.K) + 'px;' +
            'width:' + Math.round(m.w * geo.K) + 'px;opacity:' + (m.op == null ? 1 : m.op) + '">';
        });
      }
      return h + '</div>';
    }).join('\n');
    var wb = '';
    if (note === 'board') {
      var sel = host.querySelector('.exp-board'), bid = sel && sel.value;
      var bs = [];
      try { bs = (window.INK && INK.boards) ? INK.boards() : []; } catch (e) {}
      var b = null;
      for (var i2 = 0; i2 < bs.length; i2++) if (String(bs[i2].id) === String(bid)) b = bs[i2];
      if (b) {
        var bp = '';
        try { bp = INK.boardPng(b); } catch (e) {}
        if (bp) wb = '<div class="wpage"><div class="wcap">白板手稿 · ' + esc(b.name || '未命名') + '</div><img src="' + bp + '"></div>';
      }
    }
    var head = '<!doctype html><html lang="zh-CN" data-style="' + esc(attrStyle) + '" data-theme="' + esc(attrTheme) + '"' +
      (attrBig ? ' data-big="' + esc(attrBig) + '"' : '') + '><head><meta charset="utf-8"><title>刷题站 · ' + esc(bank.title || '题目导出') + '</title>' +
      '<link rel="stylesheet" href="style.css"><style>' + css + '</style></head>';
    var bd = '<body class="' + esc(fsCls) + '"><div class="doc">' +
      '<h1>' + esc(bank.title || '题目导出') + '</h1>' +
      '<div class="meta">共 ' + rs.length + ' 题　' + date +
      (note === 'ink' ? '　含题目批注' : note === 'board' ? '　附白板手稿' : '') +
      (ans ? '　含答案' : '') + (exp ? '　含解析' : '') + '</div>' +
      body + wb + '<div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:10px">— 由刷题站导出 —</div></div></body></html>';
    return head + bd;
  }

  function doExport() {
    var bank0 = (typeof bankById === 'function' && QZ.bankId) ? bankById(QZ.bankId) : null;
    var all = filtered().filter(function (r) { return sel[r.key]; });
    if (!all.length) { try { toast2('先勾选要导出的题', 1800, 'bad'); } catch (e) {} return; }
    try { toast2('正在生成…', 1200); } catch (e) {}
    /* 必须在点击的同步阶段就开窗：等烤完图再 window.open 会被弹窗拦截，表现就是“没反应” */
    var preWin = null;
    try { preWin = window.open('', '_blank'); } catch (e) {}
    var go = function () { doExportNow(all, preWin); };
    if (!(window.INK && INK.bake && bank0)) return go();
    /* 点导出的这一刻现场烤图：等每道题的批注（含图片）都画进 canvas 再生成文档 */
    var jobs = all.map(function (r) {
      try { return INK.bake(bank0, r.q).catch(function () { return null; }); }
      catch (e) { return Promise.resolve(null); }
    });
    Promise.all(jobs).then(function (arr) {
      arr.forEach(function (bb, i) { if (bb && bb.url) BAKED[all[i].q.id] = bb.url; });
      go();
    }, function () { go(); });
  }

  function doExportNow(all, preWin) {
    var rs = all;
    if (!rs.length) { toast2('先勾选要导出的题', 1800, 'bad'); return; }
    var html = '';
    try { html = docHtml(rs); } catch (e) {
      try { console.error('[exp] docHtml failed', e); } catch (e2) {}
      try { window.__expErr = String((e && e.stack) || e); } catch (e5) {}
      try { toast2('导出失败：' + ((e && e.message) || e), 3200, 'bad'); } catch (e3) {}
      try {
        if (preWin) {
          preWin.document.open();
          preWin.document.write('<meta charset=utf-8><pre style="padding:20px;font:14px/1.7 monospace;white-space:pre-wrap">导出失败：' + String((e && e.stack) || e).replace(/</g, '&lt;') + '</pre>');
          preWin.document.close();
        }
      } catch (e9) {}

      return;
    }
    if (!html) { try { toast2('导出内容为空（批注数据可能异常）', 2600, 'bad'); } catch (e4) {} return; }
    if (fmt === 'pdf') {
      /* PDF：先在新窗口打开同一份 HTML，再调起打印（iframe 的 srcdoc 在部分浏览器里 onload 不触发，点了没反应） */
      var wp = preWin || window.open('', '_blank');
      if (!wp) { toast2('被浏览器拦了新窗口，允许弹出后再试', 2400, 'bad'); return; }
      try { wp.document.open(); wp.document.write(html); wp.document.close(); } catch (e) {}
      try { wp.focus(); } catch (e) {}
      setTimeout(function () { try { wp.print(); } catch (e) { toast2('打印被拦了：在打开的页面里按 Ctrl+P', 2600, 'bad'); } }, 700);
    } else {
      var w = preWin || window.open('', '_blank');
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

  /* 自检：不用手点，一句话跑完「全选 → 导出 → 看批注进没进去」 */
  function selfTest(cb) {
    var out = { sel: 0, baked: 0, inkimg: 0, len: 0, hasInk: false, err: '', hasBake: false };
    out.hasBake = !!(window.INK && typeof INK.bake === 'function');
    var bank = (typeof bankById === 'function' && QZ.bankId) ? bankById(QZ.bankId) : null;
    var qs = (bank && bank.questions) || [];
    var rs = qs.slice(0, 8).map(function (q) {
      return { q: q, key: q.id, subj: [], type: 'A1', tries: 0, pct: 0 };
    });
    out.sel = rs.length;
    if (!out.hasBake) { if (cb) cb(out); return out; }
    var jobs = rs.map(function (r) {
      try { return INK.bake(bank, r.q).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
    });
    Promise.all(jobs).then(function (arr) {
      arr.forEach(function (b, k) {
        if (b && b.url) { BAKED[rs[k].q.id] = b.url; out.baked++; }
      });
      try {
        var html = docHtml(rs, BAKED);
        out.len = html ? html.length : 0;
        out.inkimg = html ? (html.split('data:image/png').length - 1) : 0;
        out.hasInk = html ? html.indexOf('qwrap') >= 0 : false;
      } catch (e) { out.err = String((e && e.stack) || e); }
      if (cb) cb(out);
    });
    return out;
  }

  /* 导出按钮用「事件委托」兜底：面板每次重画都不会把点击绑丢 */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== document) {
      if (t.classList && t.classList.contains('exp-go')) {
        ev.preventDefault(); ev.stopPropagation();
        try { doExport(); } catch (e) {
          try { toast2('导出出错：' + ((e && e.message) || e), 3200, 'bad'); } catch (e2) {}
        }
        return;
      }
      t = t.parentNode;
    }
  }, true);

  window.EXP = { selfTest: selfTest, open: open, close: close, _go: doExport };
})();
