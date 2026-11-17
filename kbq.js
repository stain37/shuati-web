/* kbq.js — 把知识点 markdown 编辑器塞进「答题界面」：
   二级标签进入的答题页顶部多一条「知识点 / 刷题」切换；每个二级标签一个存储单元
   （localStorage: kbdoc.tag.<标签id>）。刷题仍是原页面，不动 app.js。 */
(function () {
  if (window.KBQ) return;
  var st = document.createElement('style');
  st.textContent = ''
    + '#kbqBar{display:flex;gap:18px;align-items:center;padding:8px 4px 6px;border-bottom:1px solid var(--line,#e8eaed);margin:2px 0 10px}'
    + '#kbqBar .kbq-t{padding:4px 2px 8px;font-size:14px;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent}'
    + '#kbqBar .kbq-t.on{color:#111827;font-weight:600;border-bottom-color:#111827}'
    + '#kbqBar .kbq-r{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:12px;color:#6b7280}'
    + '#kbqBar .kbq-st{color:#9ca3af}'
    + '#kbqBar .kbq-b{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px}'
    + '#kbqBar .kbq-b.p{background:#2f6fed;border-color:#2f6fed;color:#fff}'
    + '#kbqPane{display:none;padding:6px 2px 30px}'
    + '#view.kbq-doc > *:not(#kbqBar):not(#kbqPane){display:none!important}'
    + '#view.kbq-doc > #kbqPane{display:block!important}'
    + '#kbqPane .vditor{border:0!important}#kbqPane .vditor-toolbar{display:none!important}';
  document.head.appendChild(st);

  var key = '', title = '', vd = null, mounted = false, mode = 'qz';

  function tagFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var seg = h.split('/').filter(Boolean);
    return seg.length > 1 ? seg[seg.length - 1] : (seg[0] || '');
  }
  function tagTitle() {
    var el = document.querySelector('.nb-backpath, .qcard .crumb, #view .crumb');
    return (el && el.textContent.trim()) || document.title.replace(/[-–|].*$/, '').trim() || '知识点';
  }

  function ensureVditor(cb) {
    if (window.Vditor) return cb();
    var s = document.createElement('script');
    s.src = 'vendor/vditor/dist/index.min.js';
    s.onload = cb; s.onerror = cb;
    document.head.appendChild(s);
  }
  function openDoc() {
    if (!mounted) {
      mounted = true;
      ensureVditor(function () {
        var val = '';
        try { val = localStorage.getItem('kbdoc.tag.' + key) || ''; } catch (e) {}
        if (!val) val = '# ' + title + '\n\n> 这个标签还没有知识点，直接写；保存后按标签存起来。\n';
        vd = new Vditor(document.getElementById('kbqVd'), {
          mode: 'ir', lang: 'zh_CN', cdn: 'vendor/vditor', height: 'auto',
          cache: { enable: false }, toolbar: [], value: val,
          input: function () { setStatus('未保存'); }
        });
      });
    }
    document.getElementById('view').classList.add('kbq-doc');
    setTab('kb');
  }
  function setTab(k) {
    mode = k;
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
    if (!host.querySelector('.qcard, .opts, .stem')) return;   /* 不是答题页就不插 */
    if (document.getElementById('kbqBar')) return;
    key = tagFromHash() || 'unknown';
    title = tagTitle();
    var bar = document.createElement('div');
    bar.id = 'kbqBar';
    bar.innerHTML = '<div class="kbq-t on" data-k="qz">刷题</div><div class="kbq-t" data-k="kb">知识点</div>'
      + '<span class="kbq-r"><span class="kbq-st"></span><label><input type="checkbox" class="kbq-sync"> 同步</label>'
      + '<button class="kbq-b kbq-save p">保存</button></span>';
    var pane = document.createElement('div');
    pane.id = 'kbqPane';
    pane.innerHTML = '<div id="kbqVd"></div>';
    var anchor = host.querySelector('.qcard') || host.firstElementChild;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(bar, anchor);
      anchor.parentNode.insertBefore(pane, anchor);
    } else { host.appendChild(pane); host.insertBefore(bar, host.firstChild); }
    bar.querySelectorAll('.kbq-t').forEach(function (t) { t.onclick = function () { t.dataset.k === 'kb' ? openDoc() : setTab('qz'); }; });
    bar.querySelector('.kbq-save').onclick = save;
    var ck = bar.querySelector('.kbq-sync');
    ck.checked = localStorage.getItem('kbdoc.sync') !== '0';
    ck.onchange = function () { localStorage.setItem('kbdoc.sync', ck.checked ? '1' : '0'); };
  }

  new MutationObserver(function () { try { ensure(); } catch (e) {} })
    .observe(document.body, { childList: true, subtree: true });
  if (document.readyState !== 'loading') setTimeout(ensure, 300);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(ensure, 300); });

  window.KBQ = { ensure: ensure };
})();
