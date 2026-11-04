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
      '<button class="btn" id="expSelf" style="margin-left:auto" title="检查批注有没有进导出">自检</button>' +
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
      try { host.querySelector('#expSelf').onclick = runSelf; } catch (e) {}
      setTimeout(function () { try { runSelf(); } catch (e) {} }, 400);
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

  function dateStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function metaStr(rs, withAns, withExp, noteMode) {
    return '共 ' + rs.length + ' 题　' + dateStr() +
      (noteMode === 'ink' ? '　含题目批注' : noteMode === 'board' ? '　附白板手稿' : '') +
      (withAns ? '　含答案' : '') + (withExp ? '　含解析' : '');
  }

  /* ============ 一道题 → 一段可测量的 HTML ============
     web237：不再把整题换成一张「只有批注」的图（老版 bake 画了笔迹没画题目，
     导出就只剩墨迹）。现在永远输出真题干 + 选项 + 解析，笔迹作为绝对定位的
     透明 PNG 叠回同一个盒子里。 */
  function blockHtml(r, i, withAns, withExp, noteMode) {
    var q = r.q, rec = null;
    try { rec = (window.INK && INK.inkRec) ? INK.inkRec(bank, q) : null; } catch (e) {}
    var png = null;
    if (noteMode === 'ink' && rec && rec.ops && rec.ops.length) {
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
    var h = (geo ? '<div class="qbox" data-no="' + (i + 1) + '" style="width:' + geo.w + 'px;height:' + Math.round(geo.h) +
      'px;zoom:' + (geo.z || 1).toFixed(3) + '">' : '<div class="qwrap" data-no="' + (i + 1) + '">') +
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
    if (withAns) h += '<div class="exp" style="border-left-color:var(--primary)">答案：' + esc((q.answer || []).join('')) + '</div>';
    if (withExp && q.explain) h += '<div class="exp">' + esc(q.explain) + '</div>';
    h += '</div>';
    if (geo) {
      if (geo.url) h += '<img class="inkimg" src="' + geo.url + '" style="left:0;top:0;width:' + geo.iw + 'px">';
      /* 图片笔迹不走 canvas，单独按同一套坐标叠上去；盒子已把图片外框算进去 */
      imgs.forEach(function (m) {
        h += '<img class="inkimg" src="' + m.data + '"' +
          ' style="left:' + Math.round((m.x - geo.bx) * geo.K) + 'px;top:' + Math.round((m.y - geo.by) * geo.K) + 'px;' +
          'width:' + Math.round(m.w * geo.K) + 'px;opacity:' + (m.op == null ? 1 : m.op) + '">';
      });
    }
    return h + '</div>';
  }

  /* ============ 导出文档样式：屏幕预览与 A4 打印共用一套 ============ */
  function docCss(paged) {
    var css = [
      '@page{size:A4;margin:' + (paged ? '0' : '10mm') + '}',
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
      '.wcap{font-size:12px;color:var(--sub,#64748b);margin:0 0 4px}'
    ];
    if (paged) {
      /* 固定页盒：每页自己带页眉页脚和页码，打印时不再靠浏览器猜分页点 */
      css.push('.doc.paged{width:auto;margin:0;padding:0}');
      css.push('.pg{width:210mm;height:297mm;padding:10mm 10mm 12mm;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;page-break-after:always;break-after:page;overflow:hidden}');
      css.push('.pg:last-of-type{page-break-after:auto;break-after:auto}');
      css.push('.phead{flex:0 0 auto;display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:11px;color:var(--sub,#64748b);border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:10px}');
      css.push('.pbody{flex:1 1 auto;position:relative;overflow:hidden}');
      css.push('.pbody>div{margin-bottom:22px}');
      css.push('.pbody>div:last-child{margin-bottom:0}');
      css.push('.pfoot{flex:0 0 auto;display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8;border-top:1px solid var(--line);padding-top:5px;margin-top:8px}');
      css.push('.pg.flow{height:auto;min-height:297mm}');
      css.push('.pg.flow .pbody{overflow:visible}');
    } else {
      css.push('@media print{.doc{width:auto;padding:0}}');
    }
    return css.join('\n');
  }

  /* ============ 整篇导出文档（流式：先给 HTML 导出 / 再交给分页器） ============ */
  function docHtml(rs, opt) {
    opt = opt || {};
    var ansEl = host && host.querySelector('.exp-ans');
    var expEl = host && host.querySelector('.exp-exp');
    var withAns = opt.ans != null ? !!opt.ans : !!(ansEl && ansEl.checked);
    var withExp = opt.exp != null ? !!opt.exp : (expEl ? !!expEl.checked : true);
    var noteMode = opt.note != null ? opt.note : note;
    var de = document.documentElement, db = document.body;
    var attrStyle = de.getAttribute('data-style') || '', attrTheme = de.getAttribute('data-theme') || '';
    var attrBig = de.getAttribute('data-big') || '';
    var fsCls = (db.className.match(/\bfs-[a-z]+\b/) || [''])[0];
    /* 用站点自己的样式表，导出的题目排版和答题页一模一样（批注才对得上位置） */
    var css = docCss(!!opt.paged);
    var body = rs.map(function (r, i) { return blockHtml(r, i, withAns, withExp, noteMode); }).join('\n');
    var wb = '';
    if (noteMode === 'board') {
      var sel1 = host && host.querySelector('.exp-board'), bid = sel1 && sel1.value;
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
    var title = (bank && bank.title) || '题目导出';
    var head = '<!doctype html><html lang="zh-CN" data-style="' + esc(attrStyle) + '" data-theme="' + esc(attrTheme) + '"' +
      (attrBig ? ' data-big="' + esc(attrBig) + '"' : '') + '><head><meta charset="utf-8"><title>刷题站 · ' + esc(title) + '</title>' +
      '<link rel="stylesheet" href="style.css"><style>' + css + '</style></head>';
    var bd = '<body class="' + esc(fsCls) + '"><div class="doc">' +
      '<h1>' + esc(title) + '</h1>' +
      '<div class="meta">' + esc(metaStr(rs, withAns, withExp, noteMode)) + '</div>' +
      body + wb + '<div class="doc-end" style="text-align:center;font-size:11px;color:#94a3b8;margin-top:10px">— 由刷题站导出 —</div></div></body></html>';
    return head + bd;
  }

  /* ============ 资源就绪：字体 + 图片都到位再量高度 ============ */
  function rafN(win, n) {
    return new Promise(function (res) {
      var k = 0;
      (function step() { k++; if (k >= n) res(); else (win.requestAnimationFrame ? win.requestAnimationFrame(step) : setTimeout(step, 16)); })();
    });
  }
  function whenReady(doc) {
    var jobs = [];
    try {
      if (doc.fonts && doc.fonts.ready) jobs.push(Promise.resolve(doc.fonts.ready).catch(function () {}));
    } catch (e) {}
    var imgs = [];
    try { imgs = Array.prototype.slice.call(doc.images || []); } catch (e) {}
    imgs.forEach(function (im) {
      if (im.complete) return;
      jobs.push(new Promise(function (res) {
        im.addEventListener('load', res);
        im.addEventListener('error', res);
        setTimeout(res, 6000);
      }));
    });
    return Promise.all(jobs).then(function () { return rafN(doc.defaultView || window, 2); });
  }

  /* ============ 内容感知分页 ============
     SeamlessPDF 那套是「先栅格化再按像素找干净切割线」；我们是文字文档，
     直接把每道题当一个不可切的块，量出真实高度后装箱，比像素扫描更准，
     而且导出仍然是可选中的文字（不是一张大图）。
       ① 用空页量「一页正文能放多高」
       ② 量每道题的高度（整题不切断）
       ③ 装箱：装不下就换页；单题比一页还高时，给它单独一页并允许自然续页
       ④ 生成带页眉页脚的固定页盒，页码已知，不用等浏览器排版 */
  function paginateDoc(doc, title, meta) {
    var root = doc.querySelector('.doc') || doc.body;
    var all = Array.prototype.slice.call(root.children);
    var h1 = null, metaEl = null, blocks = [];
    all.forEach(function (el) {
      if (!h1 && el.tagName === 'H1') { h1 = el; return; }
      if (!metaEl && el.className === 'meta') { metaEl = el; return; }
      if (el.className === 'doc-end') return;   /* 落款不单独占一页，页脚已经有了 */
      blocks.push(el);
    });
    if (!blocks.length) return { pages: 0, oversized: 0, avail: 0, used: [] };

    /* ① 空页量正文高度 */
    var probe = doc.createElement('div');
    probe.className = 'pg';
    probe.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden';
    probe.innerHTML = '<div class="phead">x</div><div class="pbody"></div><div class="pfoot">y</div>';
    doc.body.appendChild(probe);
    var avail = Math.floor(probe.querySelector('.pbody').getBoundingClientRect().height);
    probe.parentNode.removeChild(probe);
    if (!avail || avail < 200) avail = 960;   /* 兜底：A4 版心 275mm≈1039px，减掉页眉页脚 */
    avail = Math.max(200, avail - 8);         /* 留 8px 安全边：别让四舍五入把最后一题顶出页 */

    /* ② 量高度（含下外边距；区块间距在 .pbody 里由 CSS 再给一层） */
    var items = blocks.map(function (el) {
      var h = el.getBoundingClientRect().height;
      var mb = 0;
      try { mb = parseFloat(doc.defaultView.getComputedStyle(el).marginBottom) || 0; } catch (e) {}
      var total = Math.ceil(h + mb) + 1;
      return { el: el, h: total, tall: total > avail };
    });

    /* ③ 装箱：装不下的题先试「题干+选项留本页、解析续到下一页」，
       实在连题干都放不下才整题换页；单题比一页还高时独占一页并允许自然续页。
       留白太多是打印稿最显眼的毛病，这一步就是用来把它压下去的。 */
    var pages = [], cur = null, used = 0, oversized = 0;
    function flush() {
      if (cur && cur.length) pages.push({ items: cur, flow: false });
      cur = null; used = 0;
    }
    var queue = items.slice(), guard = 0;
    while (queue.length && guard++ < 5000) {
      var it = queue.shift();
      if (it.tall) {
        oversized++;
        flush();
        pages.push({ items: [it], flow: true });
        continue;
      }
      if (!cur) cur = [];
      if (used + it.h <= avail) { cur.push(it); used += it.h; continue; }
      var sp = trySplitTail(it, avail - used, queue[0]);
      if (sp) {
        cur.push({ el: sp.head, h: sp.headH });
        used += sp.headH;
        flush();
        queue.unshift(sp.tail);
        continue;
      }
      flush();
      queue.unshift(it);
    }
    flush();

    /* 把「解析」这几块拆到续页（题干和选项留在原页，批注也跟着原页）
       只有本页剩余空间够放下题干才拆，否则宁可整题换页 */
    function trySplitTail(item, room, next) {
      /* 拆了必须能省页：续页还要接得住下一块，接不住就是白白多一页 */
      if (room < 300 || !next || next.tall) return null;
      var el = item.el, card = el.querySelector('.qcard');
      if (!card) return null;
      var exps = [], c = card.firstElementChild;
      for (; c; c = c.nextElementSibling) if (c.className === 'exp') exps.push(c);
      if (!exps.length) return null;
      var old = exps.map(function (e) { return e.style.display; });
      exps.forEach(function (e) { e.style.display = 'none'; });
      /* 量的是卡片本身：带批注的 .qbox 有固定高度，量外壳会永远量成整题高度 */
      var headH = Math.ceil(card.getBoundingClientRect().height) + 22;
      exps.forEach(function (e, k) { e.style.display = old[k]; });
      if (headH > room) return null;

      var tail = el.cloneNode(false);
      if (tail.style) { tail.style.height = 'auto'; tail.style.zoom = ''; }
      var card2 = card.cloneNode(false);
      if (card2.style) { card2.style.marginLeft = '0'; card2.style.marginTop = '0'; }
      exps.forEach(function (e) { card2.appendChild(e); });
      var tip = doc.createElement('div');
      tip.className = 'qno';
      tip.textContent = '第 ' + (el.getAttribute('data-no') || '') + ' 题 · 解析（接上页）';
      card2.insertBefore(tip, card2.firstChild);
      tail.appendChild(card2);
      root.appendChild(tail);                     /* 先挂回文档里，才量得到高度 */
      var h2 = Math.ceil(tail.getBoundingClientRect().height) + 22;
      if (h2 + next.h > avail) {                  /* 续页接不住下一块，撤销这次拆分 */
        if (tail.parentNode) tail.parentNode.removeChild(tail);
        exps.forEach(function (e) { card.appendChild(e); });
        return null;
      }
      return { head: el, headH: headH, tail: { el: tail, h: h2, tall: h2 > avail } };
    }

    /* ④ 落成页盒（页码按「空盒数 + 续页数」累加） */
    function mk(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    var total = 0;
    pages.forEach(function (p) { p.span = p.flow ? Math.max(1, Math.ceil(p.items[0].h / avail)) : 1; total += p.span; });

    var frag = doc.createDocumentFragment();
    var n = 0;
    pages.forEach(function (p) {
      var box = mk('div', 'pg' + (p.flow ? ' flow' : ''));
      var hd = mk('div', 'phead');
      hd.appendChild(mk('span', '', title));
      hd.appendChild(mk('span', '', meta));
      var bd = mk('div', 'pbody');
      p.items.forEach(function (it) { bd.appendChild(it.el); });
      var ft = mk('div', 'pfoot');
      ft.appendChild(mk('span', '', '刷题站导出'));
      var startNo = n + 1;
      n += p.span;
      ft.appendChild(mk('span', '', p.flow ? ('第 ' + startNo + ' 页起，跨 ' + p.span + ' 页') : ('第 ' + startNo + ' / ' + total + ' 页')));
      box.appendChild(hd); box.appendChild(bd); box.appendChild(ft);
      frag.appendChild(box);
    });

    if (h1 && h1.parentNode) h1.parentNode.removeChild(h1);
    if (metaEl && metaEl.parentNode) metaEl.parentNode.removeChild(metaEl);
    root.innerHTML = '';
    root.className = 'doc paged';
    root.appendChild(frag);

    return {
      pages: pages.length,
      totalPages: total,
      oversized: oversized,
      avail: avail,
      used: pages.map(function (p) { return Math.round(p.items.reduce(function (s, it) { return s + it.h; }, 0)); })
    };
  }

  /* ============ PDF 导出：iframe 里排版 → 调起打印 ============ */
  function printPaged(html, title, meta) {
    var fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(fr);
    var printed = false;
    fr.onload = function () {
      var doc = null;
      try { doc = fr.contentDocument; } catch (e) {}
      if (!doc) { toast2('导出文档打不开，换 HTML 再打印', 2600, 'bad'); return; }
      whenReady(doc).then(function () {
        var info;
        try { info = paginateDoc(doc, title, meta); } catch (e) {
          try { console.warn('[exp] 分页失败，退回整篇打印', e); } catch (e2) {}
          info = { pages: 0, totalPages: 0, err: String((e && e.message) || e) };
        }
        return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return info; });
      }).then(function (info) {
        if (printed) return;
        printed = true;
        try { fr.contentWindow.focus(); fr.contentWindow.print(); }
        catch (e) { toast2('打印被浏览器拦了，换 HTML 打开再打印', 2600, 'bad'); }
        var np = info && info.totalPages ? info.totalPages : 1;
        toast2('已排好 ' + np + ' 页，正在调起打印（另存为 PDF）' + (info && info.oversized ? '　有 ' + info.oversized + ' 题超一页' : ''), 3000, 'good');
        setTimeout(function () { fr.remove(); }, 60000);
      }).catch(function (e) {
        try { console.warn('[exp] 排版异常', e); } catch (e2) {}
        if (printed) return;
        printed = true;
        try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e3) { toast2('打印被浏览器拦了，换 HTML 打开再打印', 2600, 'bad'); }
        setTimeout(function () { fr.remove(); }, 60000);
      });
    };
    fr.srcdoc = html;
    return fr;
  }

  function openHtmlDoc(html) {
    var w = window.open('', '_blank');
    if (!w) return false;
    w.document.open();
    try { w.document.charset = 'utf-8'; } catch (e) {}
    w.document.write('<!DOCTYPE html><meta charset="utf-8">' + html);
    w.document.close();
    return true;
  }

  function doExport() {
    var rs = filtered().filter(function (r) { return sel[r.key]; });
    if (!rs.length) { toast2('先勾选要导出的题', 1800, 'bad'); return; }
    var ansEl = host && host.querySelector('.exp-ans');
    var expEl = host && host.querySelector('.exp-exp');
    var withAns = !!(ansEl && ansEl.checked);
    var withExp = expEl ? !!expEl.checked : true;
    var html = '';
    try { html = docHtml(rs, { ans: withAns, exp: withExp, paged: fmt === 'pdf' }); } catch (e) {
      try { console.error('[exp] docHtml failed', e); } catch (e2) {}
      try { window.__expErr = String((e && e.stack) || e); } catch (e5) {}
      try { toast2('导出失败：' + ((e && e.message) || e), 3200, 'bad'); } catch (e3) {}
      return;
    }
    if (!html) { try { toast2('导出内容为空（批注数据可能异常）', 2600, 'bad'); } catch (e4) {} return; }
    var title = (bank && bank.title) || '题目导出';
    var meta = metaStr(rs, withAns, withExp, note);
    if (fmt === 'pdf') {
      toast2('正在排版 ' + rs.length + ' 题…', 1200);
      printPaged(html, title, meta);
    } else {
      if (openHtmlDoc(html)) toast2('已在新标签打开 ' + rs.length + ' 题', 2400, 'good');
      else {
        /* 弹窗被拦时退一步：直接把 HTML 存成文件，用户双击也能看能打印 */
        try {
          var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (title || '题目导出') + '.html';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.remove(); }, 4000);
          toast2('新窗口被拦了，已下载 HTML 文件：双击就能看，浏览器里 Ctrl+P 存 PDF', 3600, 'good');
        } catch (e) { toast2('被浏览器拦了新窗口，允许弹出后再试', 2400, 'bad'); }
      }
    }
  }

  function close() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    var m = document.querySelector('.exp-marq'); if (m) m.remove();
    host = null;
  }

  function pageRows(b, n) {
    var qs = (b && b.questions) || [];
    return qs.slice(0, n).map(function (q) {
      return { q: q, key: (q && q.id) || '', subj: [], type: 'A1', tries: 0, pct: 0 };
    });
  }

  /* 自检：不用手点，跑完「建文档 → 真实分页 → 看题干/批注在不在」 */
  function selfTest(cb) {
    var out = { sel: 0, hasStem: false, hasCard: false, inkimg: 0, len: 0, pages: 0, totalPages: 0, oversized: 0, avail: 0, err: '' };
    var b = bank || ((typeof bankById === 'function' && window.QZ && QZ.bankId) ? bankById(QZ.bankId) : null);
    if (!b) { out.err = 'no bank'; if (cb) cb(out); return out; }
    var old = bank; bank = b;
    var rs = pageRows(b, 8);
    out.sel = rs.length;
    try {
      var html = docHtml(rs, { paged: true });
      out.len = html.length;
      out.inkimg = html.split('data:image/png').length - 1;
      out.hasStem = html.indexOf('class="stem"') >= 0;
      out.hasCard = html.indexOf('qcard') >= 0;
      paginateTest(rs.length, {}, function (info) {
        if (info) {
          out.pages = info.pages || 0;
          out.totalPages = info.totalPages || 0;
          out.oversized = info.oversized || 0;
          out.avail = info.avail || 0;
          if (info.err) out.err = String(info.err);
        }
        bank = old;
        if (cb) cb(out);
      });
    } catch (e) {
      out.err = String((e && e.stack) || e);
      bank = old;
      if (cb) cb(out);
    }
    return out;
  }

  /* 排版测试：跑一遍真实分页，返回页数 / 超页题数 / 每页用量。
     opt.show=true 时把 iframe 显示出来（210mm×297mm），方便截图看效果 */
  function paginateTest(n, opt, cb) {
    opt = opt || {};
    var b = bank || ((typeof bankById === 'function' && window.QZ && QZ.bankId) ? bankById(QZ.bankId) : null);
    if (!b) { if (cb) cb({ err: 'no bank' }); return null; }
    bank = b;
    var rs = pageRows(b, n || 8);
    var html = docHtml(rs, { paged: true });
    var fr = document.createElement('iframe');
    fr.style.cssText = opt.show
      ? 'position:fixed;left:8px;top:8px;width:210mm;height:297mm;border:1px solid #94a3b8;background:#fff;z-index:2147483000;box-shadow:0 8px 30px rgba(0,0,0,.25)'
      : 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(fr);
    fr.onload = function () {
      var doc = null;
      try { doc = fr.contentDocument; } catch (e) {}
      whenReady(doc).then(function () {
        var info = paginateDoc(doc, (b && b.title) || '题目导出', metaStr(rs, false, true, note));
        if (cb) cb(info, fr);
      }).catch(function (e) {
        if (cb) cb({ err: String((e && e.message) || e) }, fr);
      });
    };
    fr.srcdoc = html;
    return fr;
  }

  window.EXP = { selfTest: selfTest, open: open, close: close, paginateTest: paginateTest, doExport: doExport };
})();
