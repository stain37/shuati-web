/* kbq.js — 答题页内嵌 markdown 编辑器（v2）
   改动：白底卡片、点击即聚焦、按键不穿透到答题快捷键、工具栏（含图片上传/分屏预览）、
   每个二级标签一个存储单元 kbdoc.tag.<标签id>。 */
(function () {
  if (window.KBQ) return;
  var st = document.createElement('style');
  st.textContent = ''
    + '#kbqBar{display:flex;gap:16px;align-items:center;padding:8px 4px 8px;border-bottom:1px solid var(--line,#e8eaed);margin:2px 0 10px}'
    + '#kbqBar .kbq-t{padding:4px 2px 8px;font-size:14px;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent}'
    + '#kbqBar .kbq-t.on{color:#111827;font-weight:600;border-bottom-color:#111827}'
    + '#kbqBar .kbq-r{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:#6b7280}'
    + '#kbqBar .kbq-st{color:#9ca3af}'
    + '#kbqBar .kbq-b{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}'
    + '#kbqBar .kbq-b.p{background:#2f6fed;border-color:#2f6fed;color:#fff}'
    + '#kbqPane{display:none;padding:0 2px 30px}'
    + '#view.kbq-doc > *:not(#kbqBar):not(#kbqPane){display:none!important}'
    + '#view.kbq-doc > #kbqPane{display:block!important}'
    + '#kbqCard{background:#fff;border:1px solid #e6e8eb;border-radius:14px;box-shadow:0 2px 10px rgba(15,23,42,.05);padding:6px 10px 20px}'
    + '#kbqCard .vditor{background:#fff!important;border:0!important}'
    + '#kbqCard .vditor-toolbar{border-bottom:1px solid #eef0f2!important;background:#fff!important;padding:4px 6px!important}'
    + '#kbqCard .vditor-reset{background:#fff!important;color:#1f2328!important;font-size:15px;line-height:1.8;padding:10px 12px 40px!important;min-height:360px}'
    + '#kbqCard .vditor-reset:focus{outline:none}'
    + '#kbqCard .vditor-panel{background:#fff!important}'
    + '#kbqCard .vditor-wysiwyg:empty:before,#kbqCard .vditor-ir__node--expand:empty:before{content:"";}';
  document.head.appendChild(st);

  var key = '', title = '', vd = null, mounted = false, mode = 'ir';

  function tagFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var seg = h.split('/').filter(Boolean);
    return seg.length > 1 ? seg[seg.length - 1] : (seg[0] || '');
  }
  function tagTitle() {
    var el = document.querySelector('.nb-backpath, #view .crumb');
    return (el && el.textContent.trim()) || document.title.replace(/[-–|].*$/, '').trim() || '知识点';
  }
  function ensureVditor(cb) {
    if (window.Vditor) return cb();
    var s = document.createElement('script');
    s.src = 'vendor/vditor/dist/index.min.js';
    s.onload = cb; s.onerror = cb;
    document.head.appendChild(s);
  }
  function uploadHandler(files) {
    try {
      for (var i = 0; i < files.length; i++) {
        (function (f) {
          var r = new FileReader();
          r.onload = function (e) {
            var mark = '![' + (f.name || '图片') + '](' + e.target.result + ')';
            if (vd) vd.insertValue(mark);
          };
          r.readAsDataURL(f);
        })(files[i]);
      }
    } catch (e) {}
    return null;
  }
  function mount() {
    var val = '';
    try { val = localStorage.getItem('kbdoc.tag.' + key) || ''; } catch (e) {}
    if (!val) val = '# ' + title + '\n\n开始写…\n';
    if (vd) { try { vd.destroy(); } catch (e) {} vd = null; }
    vd = new Vditor(document.getElementById('kbqVd'), {
      mode: mode, lang: 'zh_CN', cdn: 'vendor/vditor', height: 'auto',
      cache: { enable: false },
      toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'list', 'ordered-list', 'check', 'quote', '|',
        'link', 'upload', 'table', '|', 'undo', 'redo', 'edit-mode', 'fullscreen'],
      toolbarConfig: { pin: true },
      upload: { accept: 'image/*', multiple: false, handler: uploadHandler },
      value: val,
      input: function () { setStatus('未保存'); },
      after: function () { setTimeout(function () { try { vd.focus(); } catch (e) {} }, 60); }
    });
    mounted = true;
  }
  function openDoc() {
    document.getElementById('view').classList.add('kbq-doc');
    var card = document.getElementById('kbqCard');
    if (!mounted) {
      ensureVditor(function () { mount(); });
    } else setTimeout(function () { try { vd.focus(); } catch (e) {} }, 60);
    setTab('kb');
  }
  function setTab(k) {
    document.querySelectorAll('#kbqBar .kbq-t').forEach(function (x) { x.classList.toggle('on', x.dataset.k === k); });
    if (k === 'kb') document.getElementById('view').classList.add('kbq-doc');
    else document.getElementById('view').classList.remove('kbq-doc');
  }
  function setStatus(t) { var e = document.querySelector('#kbqBar .kbq-st'); if (e) e.textContent = t || ''; }
  function save() {
    try {
      if (localStorage.getItem('kbdoc.sync') === '0') { setStatus('同步已关：未写入'); return; }
      localStorage.setItem('kbdoc.tag.' + key, vd ? vd.getValue() : '');
      setStatus('已保存到本地');
    } catch (e) { setStatus('保存失败'); }
  }
  function ensure() {
    var host = document.getElementById('view');
    if (!host) return;
    if (!host.querySelector('.qcard, .opts, .stem')) return;
    if (document.getElementById('kbqBar')) return;
    key = tagFromHash() || 'unknown';
    title = tagTitle();
    var bar = document.createElement('div');
    bar.id = 'kbqBar';
    bar.innerHTML = '<div class="kbq-t on" data-k="qz">刷题</div><div class="kbq-t" data-k="kb">知识点</div>'
      + '<span class="kbq-r"><span class="kbq-st"></span><label><input type="checkbox" class="kbq-sync"> 同步</label>'
      + '<button class="kbq-b kbq-split" title="分屏预览">分屏</button>'
      + '<button class="kbq-b kbq-save p">保存</button></span>';
    var pane = document.createElement('div');
    pane.id = 'kbqPane';
    pane.innerHTML = '<div id="kbqCard"><div id="kbqVd"></div></div>';
    var anchor = host.querySelector('.qcard') || host.firstElementChild;
    (anchor && anchor.parentNode ? anchor.parentNode : host).insertBefore(bar, anchor || host.firstChild);
    (anchor && anchor.parentNode ? anchor.parentNode : host).insertBefore(pane, anchor || host.firstChild);
    bar.querySelectorAll('.kbq-t').forEach(function (t) { t.onclick = function () { t.dataset.k === 'kb' ? openDoc() : setTab('qz'); }; });
    bar.querySelector('.kbq-save').onclick = save;
    bar.querySelector('.kbq-split').onclick = function () {
      mode = mode === 'ir' ? 'sv' : 'ir';
      this.textContent = mode === 'ir' ? '分屏' : '即时';
      if (mounted) mount();
    };
    var ck = bar.querySelector('.kbq-sync');
    ck.checked = localStorage.getItem('kbdoc.sync') !== '0';
    ck.onchange = function () { localStorage.setItem('kbdoc.sync', ck.checked ? '1' : '0'); };
    document.getElementById('kbqPane').addEventListener('keydown', function (e) { e.stopPropagation(); }, true);
    document.getElementById('kbqPane').addEventListener('keyup', function (e) { e.stopPropagation(); }, true);
  }
  var t = null;
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { try { ensure(); } catch (e) {} }, 120); })
    .observe(document.body, { childList: true, subtree: true });
  if (document.readyState !== 'loading') setTimeout(ensure, 300);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(ensure, 300); });
  window.KBQ = { ensure: ensure };
})();
