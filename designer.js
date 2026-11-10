/* designer.js —— 主题设计器（2026-11-11）
   用途：逐模块调控「主页 / 答题页 / 全局」的颜色、透明度、边框、圆角、阴影、
        模糊(backdrop-filter)、饱和度、亮度(filter)、字号/字重/行高。
   数据：本机 localStorage qbank.dz.v1；生成的 CSS 注入 <style id="dzCss">，
        选择器带 html[data-dz="1"] body 前缀，保证压过 skins.css 的 !important。
   导出：design.theme.json（{ v, mods }），可再次导入；也能导出纯 CSS。
*/
(function () {
  if (window.DZ) return;

  var K = 'qbank.dz.v1';
  var CSS_ID = 'dzCss';

  /* ---------- 模块表 ----------
     caps: b=底色 bd=边框 f=文字 r=圆角 s=阴影 fx=模糊/饱和/亮度 ft=字号
     sel 里的选择器前面会加 html[data-dz="1"] body（body 自身除外） */
  var MODS = [
    { id: 'body', g: 'all', name: '页面底色', sel: 'body', caps: 'bfx', raw: true },
    { id: 'top', g: 'home', name: '顶栏', sel: '.top', caps: 'bdfrsx' },
    { id: 'hero', g: 'home', name: '首页顶部统计区', sel: '.hero', caps: 'bdfrsx' },
    { id: 'hs', g: 'home', name: '统计小格', sel: '.hstat .hs', caps: 'bdfrsftx' },
    { id: 'card', g: 'home', name: '卡片（通用）', sel: '.card', caps: 'bdfrsx' },
    { id: 'vbcard', g: 'home', name: '便当格', sel: '.vb-card', caps: 'bdfrsx' },
    { id: 'vbq', g: 'home', name: '便当里的快捷键', sel: '.vb-q', caps: 'bdfrsx' },
    { id: 'btn', g: 'home', name: '按钮（普通）', sel: '.btn', caps: 'bdfrsftx' },
    { id: 'btnp', g: 'home', name: '按钮（主按钮）', sel: '.btn.primary', caps: 'bdfrsftx' },
    { id: 'bnav', g: 'home', name: '底部导航', sel: '.bnav', caps: 'bdfrsx' },
    { id: 'bnavon', g: 'home', name: '底部导航（选中项）', sel: '.bnav .btn.on', caps: 'bdfrsx' },

    { id: 'qcard', g: 'quiz', name: '答题卡外框', sel: '.qcard', caps: 'bdfrsx' },
    { id: 'qmode', g: 'quiz', name: '模式条', sel: '.qmode .chip', caps: 'bdfrsftx' },
    { id: 'qhead', g: 'quiz', name: '题头（题号/标签）', sel: '.qhead', caps: 'bfrsftx' },
    { id: 'stem', g: 'quiz', name: '题干文字', sel: '.stem', caps: 'bdfrsftx' },
    { id: 'opt', g: 'quiz', name: '选项（普通）', sel: '.opts .opt', caps: 'bdfrsftx' },
    { id: 'optsel', g: 'quiz', name: '选项（选中）', sel: '.opt.sel', caps: 'bdfrsx' },
    { id: 'optright', g: 'quiz', name: '选项（正确）', sel: '.opt.right', caps: 'bdfrsx' },
    { id: 'optwrong', g: 'quiz', name: '选项（错误）', sel: '.opt.wrong', caps: 'bdfrsx' },
    { id: 'optk', g: 'quiz', name: '选项字母块', sel: '.opt .k', caps: 'bdfrsftx' },
    { id: 'fb', g: 'quiz', name: '解析框', sel: '.fb', caps: 'bdfrsx' },
    { id: 'exp', g: 'quiz', name: '解析文字', sel: '.exp', caps: 'bdfrsftx' },
    { id: 'actions', g: 'quiz', name: '底部操作区', sel: '.actions', caps: 'bdfrsftx' },

    { id: 'surfaces', g: 'all', name: '所有块（统一圆角/模糊/阴影）', sel: '.card,.vb-card,.hs,.qcard,.top,.bnav,.opts .opt,.qmode .chip,.fb', caps: 'rsx' }
  ];

  var st = load();
  var tab = 'home';

  function load() {
    try { var v = JSON.parse(localStorage.getItem(K) || 'null'); if (v && v.mods) return { v: 1, mods: v.mods }; } catch (e) {}
    return { v: 1, mods: {} };
  }
  var saveT = 0;
  function save() { clearTimeout(saveT); saveT = setTimeout(function () { try { localStorage.setItem(K, JSON.stringify(st)); } catch (e) {} }, 250); }

  function modState(id) { return st.mods[id] || (st.mods[id] = {}); }
  function has(id) { var m = st.mods[id] || {}; return Object.keys(m).some(function (k) { return m[k] !== '' && m[k] != null; }); }

  /* ---------- 生成 CSS ---------- */
  function hex2rgb(h) {
    h = String(h || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    var c = hex2rgb(hex);
    a = a == null ? 1 : Math.max(0, Math.min(1, a / 100));
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function css(m) {
    var out = [], s = modState(m.id);
    if (s.bg) {
      var c = rgba(s.bg, s.bgA == null ? 100 : s.bgA);
      out.push('background-image:linear-gradient(' + c + ',' + c + ')!important');
      out.push('background-color:' + c + '!important');
    }
    if (s.fg) out.push('color:' + rgba(s.fg, s.fgA == null ? 100 : s.fgA) + '!important');
    if (s.bd) {
      out.push('border-color:' + rgba(s.bd, s.bdA == null ? 100 : s.bdA) + '!important');
      out.push('border-style:solid!important');
    }
    if (s.bw != null && s.bw !== '') out.push('border-width:' + (+s.bw) + 'px!important');
    if (s.rad != null && s.rad !== '') out.push('border-radius:' + (+s.rad) + 'px!important');
    if (s.sh) out.push('box-shadow:0 ' + Math.round(+s.sh * 0.4) + 'px ' + (+s.sh) + 'px rgba(15,23,42,' + Math.min(0.5, (+s.sh) / 80).toFixed(2) + ')!important');
    if (s.blur) {
      out.push('backdrop-filter:blur(' + (+s.blur) + 'px)!important');
      out.push('-webkit-backdrop-filter:blur(' + (+s.blur) + 'px)!important');
    }
    /* body 上写 filter 会把 position:fixed 的后代（顶栏 / 底栏 / 浮标 / 面板）的包含块
       从视口改成 body，它们会跑到长文档的最底部 —— 表现就是「底部导航栏呼唤不起来」。
       body 的饱和度 / 亮度改用 #dzTint 的 backdrop-filter 来叠加（见 updateTint）。 */
    if ((s.sat || s.bri) && m.id !== 'body') {
      var f = [];
      if (s.sat) f.push('saturate(' + (+s.sat) + '%)');
      if (s.bri) f.push('brightness(' + (+s.bri) + '%)');
      out.push('filter:' + f.join(' ') + '!important');
    }
    if (s.fs) out.push('font-size:' + (+s.fs) + 'px!important');
    if (s.fw) out.push('font-weight:' + (+s.fw) + '!important');
    if (s.lh) out.push('line-height:' + (+s.lh) + '!important');
    if (!out.length) return '';
    var sel = m.raw ? ('html[data-dz="1"] ' + m.sel) : ('html[data-dz="1"] body ' + m.sel);
    return sel + '{' + out.join(';') + '}';
  }
  function buildCss() {
    var parts = MODS.map(css).filter(Boolean);
    return parts.join('\n');
  }
  /* body 的饱和度 / 亮度不能写成 body{filter:…}（会让 fixed 后代失去视口包含块），
     改用一个铺满视口、不接收点击的 #dzTint，用它的 backdrop-filter 去作用在底下所有内容上 */
  function updateTint() {
    var s = modState('body') || {};
    var t = document.getElementById('dzTint');
    if (!s.sat && !s.bri) { if (t) t.style.display = 'none'; return; }
    if (!t) {
      t = document.createElement('div');
      t.id = 'dzTint';
      document.body.appendChild(t);
    }
    var f = [];
    if (s.sat) f.push('saturate(' + (+s.sat) + '%)');
    if (s.bri) f.push('brightness(' + (+s.bri) + '%)');
    t.style.display = 'block';
    t.style.backdropFilter = f.join(' ');
    t.style.webkitBackdropFilter = f.join(' ');
  }
  function apply() {
    var text = buildCss();
    var el = document.getElementById(CSS_ID);
    if (!text) {
      if (el) el.remove();
      document.documentElement.removeAttribute('data-dz');
      updateTint();
      return;
    }
    if (!el) { el = document.createElement('style'); el.id = CSS_ID; document.head.appendChild(el); }
    el.textContent = text;
    document.documentElement.setAttribute('data-dz', '1');
    updateTint();
  }
  function exportCssText() { return buildCss(); }

  /* ---------- 面板 UI ---------- */
  var CSS_TEXT = [
    '#dzFab{position:fixed;right:12px;bottom:calc(96px + env(safe-area-inset-bottom));z-index:20040;width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,.6);',
    'background:linear-gradient(160deg,#fff,#eef2ff);color:#1e293b;font-size:20px;box-shadow:0 8px 22px rgba(15,23,42,.22);cursor:pointer}',
    '#dzFab:active{transform:scale(.96)}',
    '#dzTint{position:fixed;inset:0;z-index:12000;pointer-events:none;display:none}',
    '.dz{position:fixed;top:0;right:0;bottom:0;width:392px;max-width:100%;z-index:20050;display:none;flex-direction:column;',
    'background:rgba(252,253,255,.97);backdrop-filter:blur(18px);color:#111a26;border-left:1px solid rgba(15,23,42,.12);box-shadow:-10px 0 40px rgba(15,23,42,.18);font-size:13px}',
    '.dz.on{display:flex}',
    '.dz-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(15,23,42,.1)}',
    '.dz-head b{font-size:14px}',
    '.dz-head .dz-sub{font-size:11px;color:#64748b;flex:1;line-height:1.35}',
    '.dz-x{border:0;background:transparent;font-size:20px;line-height:1;color:#475569;cursor:pointer}',
    '.dz-tabs{display:flex;gap:6px;padding:8px 12px 0}',
    '.dz-tabs button{flex:1;padding:6px 0;border-radius:9px;border:1px solid rgba(15,23,42,.14);background:#fff;color:#334155;font-size:12px;cursor:pointer}',
    '.dz-tabs button.on{background:#1e293b;color:#fff;border-color:#1e293b}',
    '.dz-body{flex:1;overflow:auto;padding:10px 12px 14px}',
    '.dz-mod{border:1px solid rgba(15,23,42,.12);border-radius:11px;margin-bottom:8px;background:#fff;overflow:hidden}',
    '.dz-mod[data-has="1"]{border-color:#2563eb}',
    '.dz-mod>summary{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;list-style:none}',
    '.dz-mod>summary::-webkit-details-marker{display:none}',
    '.dz-mod>summary b{font-size:12.5px;font-weight:600;flex:1}',
    '.dz-mod>summary code{font-size:10.5px;color:#94a3b8;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dz-rst{border:1px solid rgba(15,23,42,.16);background:#f8fafc;border-radius:7px;font-size:11px;padding:1px 6px;color:#475569;cursor:pointer}',
    '.dz-ct{padding:4px 10px 10px;display:grid;gap:7px}',
    '.dz-row{display:grid;grid-template-columns:64px 1fr 74px;align-items:center;gap:6px}',
    '.dz-row label{font-size:11.5px;color:#475569}',
    '.dz-row input[type=color]{width:100%;height:26px;padding:0;border:1px solid rgba(15,23,42,.16);border-radius:7px;background:#fff}',
    '.dz-row input[type=range]{width:100%;accent-color:#2563eb}',
    '.dz-row .dz-val{font-size:11px;color:#64748b;text-align:right;font-variant-numeric:tabular-nums}',
    '.dz-row select{height:26px;border-radius:7px;border:1px solid rgba(15,23,42,.16);background:#fff;font-size:11.5px}',
    '.dz-foot{display:flex;gap:6px;padding:9px 12px calc(9px + env(safe-area-inset-bottom));border-top:1px solid rgba(15,23,42,.1)}',
    '.dz-foot button{flex:1;padding:7px 0;border-radius:9px;border:1px solid rgba(15,23,42,.16);background:#fff;font-size:12px;color:#1e293b;cursor:pointer}',
    '.dz-foot button.dz-primary{background:#1e293b;color:#fff;border-color:#1e293b}',
    '@media (max-width:560px){.dz{width:100%;border-left:0}}'
  ].join('\n');

  function esc(x) { return String(x == null ? '' : x).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function rowColor(m, s, key, label, alphaKey) {
    return '<div class="dz-row"><label>' + label + '</label>' +
      '<input type="color" data-mod="' + m.id + '" data-k="' + key + '" value="' + (s[key] || '#ffffff') + '">' +
      '<input type="range" min="0" max="100" data-mod="' + m.id + '" data-k="' + (alphaKey || (key + 'A')) + '" value="' + (s[alphaKey || (key + 'A')] == null ? 100 : s[alphaKey || (key + 'A')]) + '">' +
      '</div>';
  }
  function rowRange(m, s, key, label, min, max, step, unit, def) {
    return '<div class="dz-row"><label>' + label + '</label>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" data-mod="' + m.id + '" data-k="' + key + '" value="' + (s[key] == null || s[key] === '' ? def : s[key]) + '">' +
      '<span class="dz-val" data-val="' + m.id + ':' + key + '">' + (s[key] == null || s[key] === '' ? '—' : s[key] + unit) + '</span></div>';
  }
  function rowWeight(m, s) {
    var opts = ['', '300', '400', '500', '600', '700', '800'].map(function (v) {
      return '<option value="' + v + '"' + (String(s.fw || '') === v ? ' selected' : '') + '>' + (v || '默认') + '</option>';
    }).join('');
    return '<div class="dz-row"><label>字重</label><select data-mod="' + m.id + '" data-k="fw">' + opts + '</select><span class="dz-val">' + (s.fw || '—') + '</span></div>';
  }

  function moduleHtml(m) {
    var s = modState(m.id), c = m.caps || '', h = [];
    if (c.indexOf('b') >= 0) h.push(rowColor(m, s, 'bg', '底色'));
    if (c.indexOf('f') >= 0) h.push(rowColor(m, s, 'fg', '文字色'));
    if (c.indexOf('d') >= 0) h.push(rowColor(m, s, 'bd', '边框色'));
    if (c.indexOf('d') >= 0) h.push(rowRange(m, s, 'bw', '边框粗细', 0, 8, 1, 'px', 0));
    if (c.indexOf('r') >= 0) h.push(rowRange(m, s, 'rad', '圆角', 0, 40, 1, 'px', 12));
    if (c.indexOf('s') >= 0) h.push(rowRange(m, s, 'sh', '阴影', 0, 40, 1, 'px', 0));
    if (c.indexOf('x') >= 0) {
      h.push(rowRange(m, s, 'blur', '模糊', 0, 40, 1, 'px', 0));
      h.push(rowRange(m, s, 'sat', '饱和度', 0, 200, 5, '%', 100));
      h.push(rowRange(m, s, 'bri', '亮度', 20, 180, 5, '%', 100));
    }
    if (c.indexOf('t') >= 0) {
      h.push(rowRange(m, s, 'fs', '字号', 10, 42, 1, 'px', 14));
      h.push(rowWeight(m, s));
      h.push(rowRange(m, s, 'lh', '行高', 1, 2.4, 0.05, '', 1.5));
    }
    return '<details class="dz-mod" data-mod="' + m.id + '" data-has="' + (has(m.id) ? 1 : 0) + '">' +
      '<summary><b>' + esc(m.name) + '</b><code>' + esc(m.sel) + '</code>' +
      '<button class="dz-rst" data-dz-rst="' + m.id + '" title="这块全部还原">↺</button></summary>' +
      '<div class="dz-ct">' + h.join('') + '</div></details>';
  }

  function renderBody() {
    var box = document.getElementById('dzBody');
    if (!box) return;
    var list = MODS.filter(function (m) { return m.g === tab; });
    box.innerHTML = list.map(moduleHtml).join('');
    list.forEach(seedModule);
  }

  /* 颜色选择器默认显示「这一块现在的颜色」，方便从现状开始拖；没点过就不写入 state */
  function seedModule(m) {
    var host = document.querySelector('#dzBody details[data-mod="' + m.id + '"]');
    if (!host) return;
    var target = document.querySelector(m.sel);
    if (!target) return;
    var cs = null;
    try { cs = getComputedStyle(target); } catch (e) { return; }
    if (!cs) return;
    function toHex(c) {
      var mm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
      if (!mm) return '';
      return '#' + [1, 2, 3].map(function (i) { var v = (+mm[i]).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
    }
    var map = { bg: cs.backgroundColor, fg: cs.color, bd: cs.borderTopColor };
    Array.prototype.forEach.call(host.querySelectorAll('input[type=color]'), function (el) {
      var k = el.getAttribute('data-k');
      var hex = toHex(map[k] || '');
      if (!hex) return;
      el.setAttribute('data-seed', hex);
      if (!modState(m.id)[k]) el.value = hex;
    });
  }

  function buildPanel() {
    if (document.getElementById('dzPanel')) return;
    var style = document.createElement('style');
    style.id = 'dzCssUI';
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<button id="dzFab" title="主题设计器：逐块调颜色/透明/圆角/模糊">🎨</button>' +
      '<div class="dz" id="dzPanel">' +
      '<div class="dz-head"><b>🎨 主题设计器</b><span class="dz-sub">点开一块，拖就生效；改动自动存本机</span>' +
      '<button class="dz-x" data-dz="close">×</button></div>' +
      '<div class="dz-tabs"><button data-dz-tab="home" class="on">主页</button>' +
      '<button data-dz-tab="quiz">答题页</button><button data-dz-tab="all">全局</button></div>' +
      '<div class="dz-body" id="dzBody"></div>' +
      '<div class="dz-foot"><button data-dz="export">⬇ 导出</button>' +
      '<button data-dz="import">⬆ 导入</button>' +
      '<button data-dz="exportCss">⬇ CSS</button>' +
      '<button data-dz="reset" class="dz-primary">↺ 全部重置</button></div>' +
      '<input type="file" id="dzFile" accept=".json,application/json" style="display:none">' +
      '</div>';
    document.body.appendChild(wrap);
    bind();
    renderBody();
  }

  function bind() {
    if (window.__dzBound) return;
    window.__dzBound = 1;
    var panel = document.getElementById('dzPanel');

    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('#dzFab')) { panel.classList.toggle('on'); if (panel.classList.contains('on')) renderBody(); return; }
      if (t.closest('#dzOpen,#dzQuick')) {
        ev.preventDefault();
        panel.classList.add('on'); renderBody();
        return;
      }
      var tabBtn = t.closest('[data-dz-tab]');
      if (tabBtn) {
        tab = tabBtn.getAttribute('data-dz-tab');
        Array.prototype.forEach.call(document.querySelectorAll('[data-dz-tab]'), function (b) { b.classList.toggle('on', b === tabBtn); });
        renderBody();
        return;
      }
      var rst = t.closest('[data-dz-rst]');
      if (rst) {
        ev.preventDefault(); ev.stopPropagation();
        var id = rst.getAttribute('data-dz-rst');
        delete st.mods[id]; save(); apply();
        var d = document.querySelector('details[data-mod="' + id + '"]');
        if (d) { d.outerHTML = moduleHtml(MODS.filter(function (m) { return m.id === id; })[0]); }
        return;
      }
      var act = t.closest('[data-dz]');
      if (act) {
        var a = act.getAttribute('data-dz');
        if (a === 'close') panel.classList.remove('on');
        else if (a === 'reset') { if (confirm('把所有模块的调控都清掉，回到皮肤原样？')) { st = { v: 1, mods: {} }; save(); apply(); renderBody(); } }
        else if (a === 'export') exportPack();
        else if (a === 'exportCss') exportCss();
        else if (a === 'import') { var f = document.getElementById('dzFile'); if (f) { f.value = ''; f.click(); } }
        return;
      }
    }, true);

    function onInput(ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) return;
      var id = el.getAttribute('data-mod'), k = el.getAttribute('data-k');
      if (!id || !k) return;
      var s = modState(id);
      var v = el.type === 'range' ? +el.value : el.value;
      /* 只拖了透明度、还没选颜色时，用选择器里显示的那个颜色兜底 */
      if (/A$/.test(k) && !s[k.slice(0, -1)]) {
        var cEl = document.querySelector('details[data-mod="' + id + '"] input[type=color][data-k="' + k.slice(0, -1) + '"]');
        if (cEl && cEl.value) s[k.slice(0, -1)] = cEl.value;
      }
      if (el.type === 'range' && (k === 'sh' || k === 'blur' || k === 'rad' || k === 'bw' || k === 'fs' || k === 'lh' || k === 'sat' || k === 'bri' || k === 'fw')) {
        /* 0 / 100 视作「不改」的几项保留原值即可，真正清靠 ↺ */
      }
      s[k] = v;
      save(); apply();
      var lbl = document.querySelector('[data-val="' + id + ':' + k + '"]');
      if (lbl) {
        var unit = { sh: 'px', blur: 'px', rad: 'px', bw: 'px', fs: 'px', sat: '%', bri: '%', lh: '', bgA: '%', fgA: '%', bdA: '%' }[k] || '';
        lbl.textContent = v === '' ? '—' : (v + unit);
      }
      var mod = document.querySelector('details[data-mod="' + id + '"]');
      if (mod) mod.setAttribute('data-has', has(id) ? '1' : '0');
    }
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', function (ev) {
      var el = ev.target;
      if (el && el.id === 'dzFile') {
        var file = el.files && el.files[0];
        if (!file) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var obj = JSON.parse(String(fr.result));
            if (!obj || !obj.mods) throw new Error('不是设计包');
            st = { v: 1, mods: obj.mods }; save(); apply(); renderBody();
            if (window.toast) toast('设计包已导入', 2000, 'ok');
          } catch (e) { if (window.toast) toast('导入失败：' + (e.message || e)); }
        };
        fr.readAsText(file);
        return;
      }
      onInput(ev);
    }, true);
  }

  function download(name, text, type) {
    var b = new Blob([text], { type: type || 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  }
  function exportPack() {
    download('design.theme.json', JSON.stringify({ v: 1, mods: st.mods }, null, 2));
    try { if (window.toast) toast('已导出 design.theme.json（导入同一个文件就能恢复）', 2400, 'ok'); } catch (e) {}
  }
  function exportCss() {
    download('design.css', exportCssText(), 'text/css;charset=utf-8');
    try { if (window.toast) toast('已导出 design.css（可以直接贴进主题包的 css 字段）', 2400, 'ok'); } catch (e) {}
  }

  function open() { buildPanel(); var p = document.getElementById('dzPanel'); if (p) { p.classList.add('on'); renderBody(); } }
  function close() { var p = document.getElementById('dzPanel'); if (p) p.classList.remove('on'); }

  function boot() {
    buildPanel();
    apply();
    var fab = document.getElementById('dzFab');
    if (fab) fab.style.display = '';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.DZ = {
    open: open, close: close, state: function () { return st; }, css: exportCssText,
    apply: apply, mods: MODS,
    set: function (id, patch) {
      if (!id || !patch) return false;
      var s = modState(id);
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      save(); apply(); renderBody(); return true;
    },
    resetAll: function () { st = { v: 1, mods: {} }; save(); apply(); },
    importPack: function (obj) {
      if (!obj || !obj.mods) return false;
      st = { v: 1, mods: obj.mods }; save(); apply(); renderBody(); return true;
    }
  };
})();
