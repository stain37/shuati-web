/* theme.js —— 主题保存器 + 主题商店（2026-11-11）
   主题包 = 一套「皮肤 style + 主题色 color + 深浅 theme + 背景 bg + 质感(磨砂/发光/不透明) + 自定义 CSS」
   存储：本机 localStorage qbank.themes.mine.v1（我的主题）、qbank.themes.active.v1（当前套用的主题 id）
   商店：仓库里的 themes/index.json（目录）+ themes/<id>.theme.json（单个主题，点了才下载）
   上传：只有站长往仓库里部署文件，别人只能看目录、按需下载。
*/
(function () {
  if (window.THEMEBOX) return;

  var K_MINE = 'qbank.themes.mine.v1';
  var K_ACT = 'qbank.themes.active.v1';
  var CSS_ID = 'themePackCss';
  var STORE = 'themes/index.json';

  /* 会被主题包记录的外观字段（其余设置不属于「外观」，不动） */
  var LOOK_KEYS = ['style', 'styleAuto', 'color', 'theme', 'bg', 'fs', 'frost', 'frostPx',
    'uiAlpha', 'glowMode', 'glowColor', 'autoContrast', 'uiText', 'uiTextPick', 'reduceMotion'];

  function $(s, r) { return (r || document).querySelector(s); }
  function readJSON(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(m, ms) { try { if (typeof window.toast === 'function') window.toast(m, ms || 2000, 'ok'); } catch (e) {} }
  function esc(x) { return String(x == null ? '' : x).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  /* ---------- 收集 / 套用 ---------- */
  function snapshot(fields) {
    fields = fields || {};
    var look = {};
    LOOK_KEYS.forEach(function (k) { if (window.SET && SET[k] != null) look[k] = SET[k]; });
    return {
      v: 1,
      name: fields.name || '未命名主题',
      author: fields.author || '',
      desc: fields.desc || '',
      tags: fields.tags || [],
      createdAt: Date.now(),
      look: look,
      css: fields.css != null ? fields.css : currentCss(),
      swatch: swatchOf(look)
    };
  }
  function currentCss() {
    var el = document.getElementById(CSS_ID);
    return el ? (el.textContent || '') : '';
  }
  function swatchOf(look) {
    try {
      var cs = getComputedStyle(document.body);
      var h = document.documentElement, hs = getComputedStyle(h);
      return {
        bg: (look.bg && look.bg !== 'default' ? '' : '') || hs.backgroundColor || '',
        card: hs.getPropertyValue('--card') || '#ffffff',
        accent: hs.getPropertyValue('--primary') || '#2563eb',
        text: hs.getPropertyValue('--text') || '#111a26',
        style: look.style || 'default',
        theme: look.theme || 'auto'
      };
    } catch (e) { return { style: look.style, theme: look.theme }; }
  }

  function setCss(css) {
    var el = document.getElementById(CSS_ID);
    if (!css) { if (el && el.parentNode) el.parentNode.removeChild(el); return; }
    if (!el) { el = document.createElement('style'); el.id = CSS_ID; document.head.appendChild(el); }
    el.textContent = css;
  }

  function apply(t, opts) {
    if (!t || !t.look) return false;
    Object.keys(t.look).forEach(function (k) { try { SET[k] = t.look[k]; } catch (e) {} });
    try { if (typeof writeLS === 'function' && window.LS && LS.set) writeLS(LS.set, SET); } catch (e) {}
    try { if (typeof applyLook === 'function') applyLook(); } catch (e) {}
    setCss(t.css || '');
    try { localStorage.setItem(K_ACT, t.id || t.name || ''); } catch (e) {}
    document.documentElement.setAttribute('data-theme-pack', t.id || t.name || '');
    if (!opts || !opts.quiet) toast('已套用主题「' + (t.name || '') + '」', 1800);
    renderMine();
    return true;
  }

  /* ---------- 我的主题 ---------- */
  function mine() { var a = readJSON(K_MINE, []); return Array.isArray(a) ? a : []; }
  function addMine(t) {
    var list = mine();
    var id = t.id || ('t' + Date.now().toString(36));
    t.id = id;
    var i = list.findIndex(function (x) { return x && (x.id === id || (x.name === t.name && x.source === t.source)); });
    if (i >= 0) list[i] = t; else list.unshift(t);
    while (list.length > 40) list.pop();
    writeJSON(K_MINE, list);
    renderMine();
    return t;
  }
  function delMine(id) {
    writeJSON(K_MINE, mine().filter(function (x) { return x && x.id !== id; }));
    renderMine();
  }
  function renderMine() {
    var box = $('#thMine');
    if (!box) return;
    var list = mine(), act = '';
    try { act = localStorage.getItem(K_ACT) || ''; } catch (e) {}
    if (!list.length) { box.innerHTML = '本机还没有存过主题：调好外观后点「💾 存成主题包」，或去商店下载一个。'; return; }
    box.innerHTML = '我的主题（' + list.length + '）：' + list.map(function (t) {
      return '<button class="th-chip" data-th="use" data-id="' + esc(t.id) + '" title="套用这个主题">' +
        (t.id === act ? '✓ ' : '') + esc(t.name) + '</button>' +
        '<button class="th-x" data-th="del" data-id="' + esc(t.id) + '" title="从本机删除">×</button>';
    }).join(' ');
  }

  /* ---------- 保存 / 导入 / 导出 ---------- */
  function askName(def) {
    var v = window.prompt('给这个主题起个名字（之后能在「我的主题」里找到）', def || ('我的主题 ' + (mine().length + 1)));
    return v == null ? null : String(v).trim().slice(0, 40);
  }
  function download(obj, filename) {
    try {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || ((obj.name || 'theme').replace(/[\\/:*?"<>|]+/g, '_') + '.theme.json');
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 800);
    } catch (e) { toast('导出失败：' + (e.message || e)); }
  }
  function saveCurrent() {
    var name = askName();
    if (!name) return;
    var t = snapshot({ name: name });
    t.id = 'mine' + Date.now().toString(36);
    addMine(t);
    download(t);
    toast('已存成「' + name + '」，同时下载了一份 .theme.json', 2600);
  }
  function importFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var t = null;
      try { t = JSON.parse(String(fr.result)); } catch (e) {}
      if (!t || !t.look) { toast('这个文件不是主题包'); return; }
      t.id = t.id || ('imp' + Date.now().toString(36));
      t.source = 'local';
      addMine(t);
      apply(t);
    };
    fr.readAsText(file);
  }
  function resetLook() {
    var D = { style: 'default', styleAuto: true, color: 'teal', theme: 'auto', bg: 'default', fs: 'm',
      frost: true, frostPx: 14, uiAlpha: 1, glowMode: 'auto', glowColor: '', autoContrast: true,
      uiText: 'auto', uiTextPick: '#0b1220', reduceMotion: false };
    Object.keys(D).forEach(function (k) { try { SET[k] = D[k]; } catch (e) {} });
    try { if (typeof writeLS === 'function' && window.LS && LS.set) writeLS(LS.set, SET); } catch (e) {}
    try { if (typeof applyLook === 'function') applyLook(); } catch (e) {}
    setCss('');
    try { localStorage.removeItem(K_ACT); } catch (e) {}
    document.documentElement.removeAttribute('data-theme-pack');
    renderMine();
    toast('已恢复官方外观', 1800);
  }

  /* ---------- 主题商店（只按需下载） ---------- */
  function modal(html) {
    var mask = document.createElement('div');
    mask.className = 'th-mask';
    mask.innerHTML = '<div class="th-sheet" role="dialog" aria-label="主题商店"><div class="th-head"><b>🛍 主题商店</b>' +
      '<span class="th-sub">目录来自 themes/index.json；点「下载并套用」才会拉那一份主题</span>' +
      '<button class="th-close" data-th="close" title="关闭">×</button></div><div class="th-body">' + html + '</div></div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-th]');
      if (!b) { if (ev.target === mask) mask.remove(); return; }
      var a = b.getAttribute('data-th');
      if (a === 'close') mask.remove();
      else if (a === 'get') fetchTheme(b.getAttribute('data-file'), b);
    });
    return mask;
  }
  function store() {
    var m = modal('<div class="th-loading">正在取主题目录…</div>');
    fetch(STORE + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (list) {
      var arr = (list && list.themes) || (Array.isArray(list) ? list : []);
      if (!arr.length) { m.querySelector('.th-body').innerHTML = '<div class="th-loading">商店里还没有主题</div>'; return; }
      m.querySelector('.th-body').innerHTML = arr.map(function (t, i) {
        var sw = t.swatch || {};
        return '<div class="th-card">' +
          '<div class="th-prev" style="background:' + esc(sw.bg || 'linear-gradient(135deg,#dbeafe,#f5e9ff)') + '">' +
          '<span style="background:' + esc(sw.card || '#fff') + ';color:' + esc(sw.text || '#111') + ';border-color:' + esc(sw.accent || '#2563eb') + '">Aa</span>' +
          '<i style="background:' + esc(sw.accent || '#2563eb') + '"></i></div>' +
          '<div class="th-meta"><b>' + esc(t.name) + '</b>' +
          '<i class="th-tag">' + esc(t.style || '') + (t.theme ? ' · ' + esc(t.theme) : '') + '</i>' +
          '<p>' + esc(t.desc || '') + '</p>' +
          '<div class="th-btns"><button class="btn small" data-th="get" data-file="' + esc(t.file || ('themes/' + t.id + '.theme.json')) + '">下载并套用</button>' +
          (t.author ? '<span class="th-author">by ' + esc(t.author) + '</span>' : '') + '</div></div></div>';
      }).join('');
    }).catch(function (e) {
      m.querySelector('.th-body').innerHTML = '<div class="th-loading">取不到主题目录（' + esc(e.message || e) + '）：' +
        '线上要等 Pages 构建完；离线模式下也会被拦。</div>';
    });
  }
  function fetchTheme(file, btn) {
    if (!file) return;
    if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
    var url = /^https?:/i.test(file) ? file : file + (file.indexOf('?') < 0 ? ('?t=' + Date.now()) : '');
    fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (t) {
      if (!t || !t.look) throw new Error('包里没有 look');
      t.id = t.id || file.replace(/^.*\//, '').replace(/\.theme\.json$/, '');
      t.source = 'store';
      addMine(t);
      apply(t);
      toast('已下载并套用「' + (t.name || '') + '」', 2200);
    }).catch(function (e) {
      toast('下载失败：' + (e.message || e));
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '下载并套用'; }
    });
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    var s = $('#thSave'); if (s) s.onclick = saveCurrent;
    var st = $('#thStore'); if (st) st.onclick = store;
    var rs = $('#thReset'); if (rs) rs.onclick = resetLook;
    var im = $('#thImport'); var fi = $('#thFile');
    if (im && fi) {
      im.onclick = function () { fi.value = ''; fi.click(); };
      fi.onchange = function () { importFile(this.files && this.files[0]); };
    }
    var box = $('#thMine');
    if (box) box.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-th]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var t = mine().filter(function (x) { return x && x.id === id; })[0];
      if (!t) return;
      if (b.getAttribute('data-th') === 'use') apply(t);
      else { delMine(id); toast('已从本机删除「' + (t.name || '') + '」', 1500); }
    });
    renderMine();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.THEMEBOX = { snapshot: snapshot, apply: apply, save: saveCurrent, store: store, reset: resetLook,
    mine: mine, css: currentCss, setCss: setCss };
})();
