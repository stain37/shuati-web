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
      '#kbqBar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #e6eaf0;background:#fff;position:sticky;top:0;z-index:22;font:14px/1.5 system-ui,"PingFang SC","Microsoft YaHei"}',
      '#kbqBar .kbq-tab{padding:6px 10px;border-radius:8px;cursor:pointer;color:#64748b}',
      '#kbqBar .kbq-tab.on{background:#eef4ff;color:#1d4ed8;font-weight:600}',
      '#kbqBar .kbq-sp{flex:1}',
      '#kbqBar label{display:flex;align-items:center;gap:5px;color:#64748b;font-size:13px}',
      '#kbqBar button{padding:6px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;cursor:pointer}',
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

  var mount = null, mountedFor = '';

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
    });
    document.getElementById('kbqSave').onclick = saveNow;
  }

  function setMode(m) {
    var bar = document.getElementById('kbqBar');
    if (!bar) return;
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
    if (document.getElementById('view')) {
      ensureBar();
      if (document.body.classList.contains('kbq-doc')) mountDoc();
    }
  }

  var mo = new MutationObserver(function () { tick(); });
  function boot() {
    tick();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
