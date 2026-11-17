/* kbq.js — 答题页内嵌知识点编辑器（BlockNote 版） */
(function () {
  'use strict';
  var CDN = 'vendor/blocknote/';
  var loaded = false, loading = null;

  function loadOnce(cb) {
    if (loaded) return cb();
    if (loading) { loading.push(cb); return; }
    loading = [cb];
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = CDN + 'editor.css';
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = CDN + 'editor.js';
    s.onload = function () {
      loaded = true;
      var q = loading; loading = null;
      q.forEach(function (f) { try { f(); } catch (e) {} });
    };
    s.onerror = function () { loading = null; };
    document.head.appendChild(s);
  }

  function tagId() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    return h.length ? h[h.length - 1] : (document.title || 'default');
  }

  function key() { return 'kbdoc.tag.' + tagId(); }

  function syncOn() { return localStorage.getItem('kbdoc.sync') !== '0'; }

  function injectCSS() {
    if (document.getElementById('kbqCSS')) return;
    var st = document.createElement('style');
    st.id = 'kbqCSS';
    st.textContent = [
      '#kbqBar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #e6eaf0;background:#fff;position:relative;z-index:5;font:14px/1.5 system-ui,"PingFang SC","Microsoft YaHei"}',
      '#kbqBar .kbq-tab{padding:6px 10px;border-radius:8px;cursor:pointer;color:#64748b}',
      '#kbqBar .kbq-tab.on{background:#eef4ff;color:#1d4ed8;font-weight:600}',
      '#kbqBar .kbq-sp{flex:1}',
      '#kbqBar label{display:flex;align-items:center;gap:5px;color:#64748b;font-size:13px}',
      '#kbqBar button{padding:6px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;cursor:pointer}',
      '#kbqBar #kbqMore{background:#f1f5f9;color:#475569;padding:6px 12px}',
      '#kbqBar{position:relative}',
      '.kbq-menu{position:absolute;right:10px;top:44px;min-width:150px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 14px 40px rgba(15,23,42,.18);padding:6px;display:none;z-index:30}',
      '.kbq-menu.on{display:block}',
      '.kbq-menu div{padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:#334155}',
      '.kbq-menu div:hover{background:#f1f5f9}',
      '#kbqPane{display:none;background:#fff}',
      'body.kbq-doc #view{position:relative}',
      'body.kbq-doc #view > *:not(#kbqBar):not(#kbqPane){display:none!important}',
      'body.kbq-doc #kbqPane{display:block}',
      '#kbqPane .kbq-card{margin:14px;background:#fff;border:1px solid #e8edf4;border-radius:14px;box-shadow:0 6px 24px rgba(15,23,42,.06);padding:6px 6px 20px}',
      '#kbqPane .kbq-inner{min-height:60vh;padding:6px 10px}',
      '.bn-container{font-size:15px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  var mount = null, mountedFor = '', mountEl = null, MODE = 'q';

  function pane() { return document.getElementById('kbqPane'); }

  function ensureBar() {
    var view = document.getElementById('view');
    if (!view || view.querySelector('#kbqBar')) return;
    injectCSS();
    var bar = document.createElement('div');
    bar.id = 'kbqBar';
    bar.innerHTML = '<span class="kbq-tab on" data-m="q">刷题</span>'
      + '<span class="kbq-tab" data-m="doc">知识点</span>'
      + '<span class="kbq-sp"></span>'
      + '<label><input type="checkbox" id="kbqSync"> 同步</label>'
      + '<button id="kbqExp" title="把所有知识点导出为 Markdown 文件">导出</button>'
      + '<button id="kbqMore" title="更多">⋯</button>'
      + '<button id="kbqSave">保存</button>';
    var p = document.createElement('div');
    p.id = 'kbqPane';
    p.innerHTML = '<div class="kbq-card"><div class="kbq-inner"></div></div>';
    view.insertBefore(p, view.firstChild);
    view.insertBefore(bar, view.firstChild);
    document.getElementById('kbqSync').checked = syncOn();
    document.getElementById('kbqSync').onchange = function () {
      localStorage.setItem('kbdoc.sync', this.checked ? '1' : '0');
    };
    bar.querySelectorAll('.kbq-tab').forEach(function (t) {
      t.onclick = function () { setMode(t.getAttribute('data-m')); };
      t.classList.toggle('on', t.getAttribute('data-m') === MODE);
    });
    if (MODE === 'doc') document.body.classList.add('kbq-doc');
    document.getElementById('kbqSave').onclick = saveNow;
    document.getElementById('kbqExp').onclick = exportAll;
    var menu = document.createElement('div');
    menu.className = 'kbq-menu';
    menu.innerHTML = '<div data-act="link">复制链接</div><div data-act="copy">复制内容</div>'
      + '<div data-act="exp">导出本篇</div><div data-act="clear">清空本篇</div><div data-act="del">删除本篇</div>';
    bar.appendChild(menu);
    document.getElementById('kbqMore').onclick = function (e) { e.stopPropagation(); menu.classList.toggle('on'); };
    document.addEventListener('click', function () { menu.classList.remove('on'); });
    menu.onclick = function (e) {
      var act = e.target.getAttribute('data-act');
      if (!act) return;
      var md = mount ? (mount.getMarkdown() || '') : (localStorage.getItem(key()) || '');
      if (act === 'link') { try { navigator.clipboard.writeText(location.href); } catch (err) {} }
      if (act === 'copy') { try { navigator.clipboard.writeText(md); } catch (err) {} }
      if (act === 'exp') downloadOne(md);
      if (act === 'clear' || act === 'del') {
        if (!confirm('清空这篇知识点？此操作只清本机这一篇。')) { menu.classList.remove('on'); return; }
        localStorage.removeItem(key());
        mountedFor = '';
        if (mount) { try { mount.destroy(); } catch (err) {} mount = null; }
        var inn = pane() && pane().querySelector('.kbq-inner');
        if (inn) inn.innerHTML = '';
        mountDoc();
      }
      menu.classList.remove('on');
    };
  }

  function setMode(m) {
    var bar = document.getElementById('kbqBar');
    if (!bar) return;
    MODE = m;
    bar.querySelectorAll('.kbq-tab').forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-m') === m);
    });
    if (m === 'doc') {
      document.body.classList.add('kbq-doc');
      mountDoc();
    } else {
      document.body.classList.remove('kbq-doc');
    }
  }

  function downloadOne(md) {
    var blob = new Blob([md || ''], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tagId().replace(/[\\/:*?"<>|]/g, '_') + '.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function exportAll() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('kbdoc.tag.') === 0) keys.push(k);
    }
    keys.sort();
    var out = '# 知识点导出\n\n> 导出于 ' + new Date().toLocaleString() + '，共 ' + keys.length + ' 篇\n\n';
    keys.forEach(function (k) {
      var tag = k.slice('kbdoc.tag.'.length);
      var body = localStorage.getItem(k) || '';
      out += '## ' + tag + '\n\n' + body + '\n\n---\n\n';
    });
    var blob = new Blob([out], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '知识点导出-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function saveNow() {
    if (!mount) return;
    var md = mount.getMarkdown() || '';
    localStorage.setItem(key(), md);
    var btn = document.getElementById('kbqSave');
    if (btn) { var o = btn.textContent; btn.textContent = '已保存'; setTimeout(function () { btn.textContent = o; }, 900); }
  }

  function mountDoc() {
    var inner = pane() && pane().querySelector('.kbq-inner');
    if (!inner) return;
    /* 页面重渲染会把 #view 整块换掉：旧容器已不在文档里就重新挂，避免「有时打不开编辑器」 */
    if (mountEl && !document.contains(mountEl)) { mount = null; mountedFor = ''; mountEl = null; }
    var t = tagId();
    if (mountedFor === t && mount) return;
    if (mount) { try { mount.destroy(); } catch (e) {} mount = null; }
    inner.innerHTML = '';
    loadOnce(function () {
      if (!window.BlockNoteMount) { inner.textContent = '编辑器加载失败'; return; }
      mount = window.BlockNoteMount(inner, {
        value: localStorage.getItem(key()) || '',
        onChange: function (md) {
          if (!syncOn()) return;
          clearTimeout(mount._t);
          mount._t = setTimeout(function () { localStorage.setItem(key(), md); }, 800);
        }
      });
      mountedFor = t;
    });
  }

  function tick() {
    var view = document.getElementById('view');
    if (!view) return;
    var bar = document.getElementById('kbqBar');
    var p = document.getElementById('kbqPane');
    /* #view 被整体重画后，bar/pane 可能只剩一个或都掉了；先清残件再重建。 */
    if ((bar && !document.contains(bar)) || (p && !document.contains(p)) || (bar && !p)) {
      if (bar) { try { bar.remove(); } catch (e) {} }
      if (p) { try { p.remove(); } catch (e) {} }
      mount = null; mountEl = null; mountedFor = '';
    }
    ensureBar();
    if (MODE === 'doc') mountDoc();
  }

  var mo = new MutationObserver(function () { tick(); });
  function boot() {
    tick();
    mo.observe(document.body, { childList: true, subtree: true });
    /* 兜底：页面长时间停留时，万一宿主重排把编辑器挤掉，也能自己挂回来。 */
    setInterval(tick, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
