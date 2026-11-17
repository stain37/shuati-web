/* kbdoc.js — 知识库文档浮层：知识点（Vditor IR）+ 刷题，两 tab 互不打断
   入口：知识库页展开「明细」点篇名；或 KbDoc.open(title, md)
   行为：刷题里点「下一题」只换题、不跳回知识点；点「知识点」才回到 markdown，且保留阅读位置。 */
(function () {
  if (window.KbDoc) return;

  var Q = [
    { no: '多选', stem: '以下关于糖代谢关键酶调节的叙述，正确的有', opts: [
      ['己糖激酶可被 G-6-P 抑制', 1],
      ['磷酸果糖激酶-1 的最强激活剂是果糖-2,6-二磷酸', 1],
      ['丙酮酸激酶的激活剂是 ATP', 0],
      ['果糖双磷酸酶-1 可被果糖-1,6-二磷酸激活', 0]
    ]},
    { no: '单选', stem: '糖酵解途径中，催化底物水平磷酸化生成 ATP 的酶是', opts: [
      ['己糖激酶', 0],
      ['磷酸甘油酸激酶', 1],
      ['丙酮酸脱氢酶', 0],
      ['柠檬酸合酶', 0]
    ]},
    { no: '单选', stem: '长期服用异烟肼最可能导致缺乏的维生素是', opts: [
      ['维生素 B1', 0],
      ['维生素 B6', 1],
      ['维生素 PP', 0],
      ['维生素 C', 0]
    ]}
  ];

  var CSS = ''
    + '.kbdoc-mask{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:30080;display:none}'
    + '.kbdoc-mask.on{display:block}'
    + '.kbdoc-win{position:fixed;z-index:30081;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,94vw);height:min(86vh,860px);background:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.35);display:none;flex-direction:column;overflow:hidden}'
    + '.kbdoc-win.on{display:flex}'
    + '.kbdoc-hd{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e8eaed}'
    + '.kbdoc-hd b{flex:1;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.kbdoc-hd label{font-size:12px;color:#6b7280;display:flex;align-items:center;gap:4px}'
    + '.kbdoc-x{border:0;background:transparent;font-size:18px;cursor:pointer;color:#6b7280}'
    + '.kbdoc-tabs{display:flex;gap:22px;padding:0 16px;border-bottom:1px solid #e8eaed}'
    + '.kbdoc-tab{padding:10px 2px;font-size:14px;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent}'
    + '.kbdoc-tab.on{color:#111827;font-weight:600;border-bottom-color:#111827}'
    + '.kbdoc-body{flex:1;overflow:auto;padding:16px 18px}'
    + '.kbdoc-pane{display:none}.kbdoc-pane.on{display:block}'
    + '.kbdoc-win .vditor{border:0!important}'
    + '.kbdoc-win .vditor-toolbar{display:none!important}'
    + '.kdq-top{display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:8px}'
    + '.kdq-stem{font-weight:600;margin:6px 0 12px}'
    + '.kdq-opt{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer}'
    + '.kdq-opt.ok{border-color:#16a34a;background:#f0fdf4}.kdq-opt.bad{border-color:#dc2626;background:#fef2f2}'
    + '.kdq-fb{font-size:13px;color:#6b7280;min-height:20px;margin-top:6px}'
    + '.kdq-nav{display:flex;gap:10px;margin-top:16px}'
    + '.kdq-nav .b{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:7px 14px;cursor:pointer}'
    + '.kdq-nav .b.p{background:#111827;border-color:#111827;color:#fff}'
    + '.kbdoc-ft{display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;border-top:1px solid #e8eaed}'
    + '.kbdoc-ft .b{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}'
    + '.kbdoc-ft .b.p{background:#2f6fed;border-color:#2f6fed;color:#fff}'
    + '.kbdoc-more{border:1px solid #e5e7eb;background:#fff;border-radius:8px;width:34px;height:30px;cursor:pointer;font-size:18px;line-height:1;color:#475569}'
    + '.kbdoc-menu{position:fixed;background:#fff;border:1px solid #e8eaed;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:6px;display:none;z-index:5;min-width:150px}'
    + '.kbdoc-menu.on{display:block}'
    + '.kbdoc-menu div{padding:8px 10px;border-radius:8px;font-size:13px;color:#334155;cursor:pointer}'
    + '.kbdoc-menu div:hover{background:#f1f5f9}'
    + '@media (max-width:520px){.kbdoc-win{width:100vw;height:100%;left:0;top:0;transform:none;border-radius:0}}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  var host = null, vd = null, cur = { title: '', text: '' }, qi = 0, kbScroll = 0;

  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  function exportTagQs() {
    var tag = cur.tag ? decodeURIComponent(cur.tag) : '';
    if (!tag) { setStatus('这篇没有绑定考点'); return; }
    var rows = [];
    try {
      if (window.SCM && SCM.tagQList) rows = SCM.tagQList('tgcat:' + encodeURIComponent(tag)) || [];
    } catch (e) { rows = []; }
    if (!rows.length) { setStatus('这个考点下还没有题目'); return; }
    var out = ['# ' + tag + ' · 题目（共 ' + rows.length + ' 题）', ''];
    rows.forEach(function (r, i) {
      var q = (r && r.questions && r.questions[0]) || r || {};
      var qno = (i + 1);
      var stem = String(q.stem || q.title || q.q || q.name || '').replace(/\s+/g, ' ').trim();
      out.push('## ' + qno + '. ' + stem);
      var opts = q.options || q.opts || [];
      if (opts && opts.length) {
        opts.forEach(function (o, k) {
          out.push('ABCDEFGHIJKL'[k] + '. ' + String(o).replace(/\s+/g, ' ').trim());
        });
      }
      var ans = q.answer || q.ans || [];
      if (typeof ans === 'string') ans = ans.split(/[,\s]+/);
      if (ans && ans.length) out.push('答案：' + ans.join(''));
      var ex = q.explain || q.exp || q.analysis || '';
      if (ex) out.push('解析：' + String(ex).replace(/\s+/g, ' ').trim());
      out.push('');
    });
    var blob = new Blob([out.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a2 = document.createElement('a');
    a2.href = URL.createObjectURL(blob);
    a2.download = tag + '-题目.md';
    document.body.appendChild(a2); a2.click(); a2.remove();
    setStatus('已导出 ' + rows.length + ' 题');
  }

  function ensureDom() {
    if (host) return;
    host = h('<div class="kbdoc-mask"><div class="kbdoc-win">'
      + '<div class="kbdoc-hd"><b class="kbdoc-t">文档</b>'
      + '<button class="kbdoc-more" title="更多">⋯</button>'
      + '<label><input type="checkbox" class="kbdoc-sync"> 同步</label>'
      + '<button class="kbdoc-x" title="关闭">✕</button></div>'
      + '<div class="kbdoc-tabs"><div class="kbdoc-tab on" data-k="kb">知识点</div><div class="kbdoc-tab" data-k="qz">刷题</div></div>'
      + '<div class="kbdoc-body">'
      + '<div class="kbdoc-pane on" data-k="kb"><div class="kbdoc-vd"></div></div>'
      + '<div class="kbdoc-pane" data-k="qz">'
      + '<div class="kdq-top"><span class="kdq-no"></span><span class="kdq-idx"></span></div>'
      + '<div class="kdq-stem"></div><div class="kdq-opts"></div><div class="kdq-fb"></div>'
      + '<div class="kdq-nav"><button class="b kdq-prev">上一题</button><button class="b p kdq-next">下一题</button></div>'
      + '</div></div>'
      + '<div class="kbdoc-ft"><span class="kbdoc-st" style="flex:1;font-size:12px;color:#9ca3af"></span>'
      + '<button class="b kbdoc-goto">去题库</button><button class="b kbdoc-save p">保存</button><button class="b kbdoc-close">关闭</button></div>'
      + '</div></div>').firstChild;
    document.body.appendChild(host);
    var menu = h('<div class="kbdoc-menu"><div data-a="link">复制链接</div><div data-a="copy">复制正文</div><div data-a="export">导出 Markdown</div><div data-a="qexport">导出该考点题目</div><div data-a="clear">清空内容</div></div>');
    var win = host.classList.contains('kbdoc-win') ? host : host.querySelector('.kbdoc-win'); (win || host).appendChild(menu);
    var moreBtn = host.querySelector('.kbdoc-more');
    moreBtn.onclick = function (e) { e.stopPropagation(); var r = moreBtn.getBoundingClientRect(); menu.style.left = Math.max(8, r.right - 170) + 'px'; menu.style.top = (r.bottom + 6) + 'px'; menu.classList.toggle('on'); };
    document.addEventListener('click', function () { menu.classList.remove('on'); });
    menu.onclick = function (e) {
      var a = (e.target && e.target.dataset) ? e.target.dataset.a : '';
      if (!a) return;
      menu.classList.remove('on');
      var id = cur.tag || cur.title;
      if (a === 'link') {
        var u = location.origin + location.pathname + '#/kbdoc/' + encodeURIComponent(id);
        (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject());
        setStatus('链接已复制');
      } else if (a === 'copy') {
        var t = vd && vd.getMarkdown ? vd.getMarkdown() : '';
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject());
        setStatus('正文已复制');
      } else if (a === 'export') {
        var md = vd && vd.getMarkdown ? vd.getMarkdown() : '';
        var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        var a2 = document.createElement('a');
        a2.href = URL.createObjectURL(blob);
        a2.download = (cur.title || '知识点') + '.md';
        document.body.appendChild(a2); a2.click(); a2.remove();
        setStatus('已导出');
      } else if (a === 'qexport') {
        exportTagQs();
      } else if (a === 'clear') {
        if (!confirm('确定清空这篇内容？')) return;
        localStorage.removeItem(cur.tag ? 'kbdoc.tag.' + cur.tag : 'kbdoc.doc.' + cur.title);
        mountVditor('');
        setStatus('已清空');
      }
    };
    host.querySelector('.kbdoc-x').onclick = close;
    host.querySelector('.kbdoc-close').onclick = close;
    host.querySelector('.kbdoc-goto').onclick = function () {
      var id = cur.tag;
      close();
      if (!id) return;
      BYPASS = true;
      var b = document.querySelector('.nt2-t[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (b) b.click(); else BYPASS = false;
    };
    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    host.querySelectorAll('.kbdoc-tab').forEach(function (t) {
      t.onclick = function () { switchTab(t.dataset.k); };
    });
    host.querySelector('.kbdoc-save').onclick = save;
    host.querySelector('.kdq-next').onclick = function () { qi = (qi + 1) % Q.length; renderQuiz(); };
    host.querySelector('.kdq-prev').onclick = function () { qi = (qi - 1 + Q.length) % Q.length; renderQuiz(); };
    var ck = host.querySelector('.kbdoc-sync');
    ck.checked = localStorage.getItem('kbdoc.sync') !== '0';
    ck.onchange = function () { localStorage.setItem('kbdoc.sync', ck.checked ? '1' : '0'); };
  }

  function switchTab(k) {
    if (!host) return;
    var body = host.querySelector('.kbdoc-body');
    if (k === 'kb' && !host.querySelector('.kbdoc-pane[data-k=kb]').classList.contains('on')) {
      /* 从刷题切回知识点：保留 markdown 阅读位置 */
      var vdEl = host.querySelector('.vditor-reset') || host.querySelector('.kbdoc-vd');
      if (vdEl) vdEl.scrollTop = kbScroll;
    }
    host.querySelectorAll('.kbdoc-tab').forEach(function (x) { x.classList.toggle('on', x.dataset.k === k); });
    host.querySelectorAll('.kbdoc-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.k === k); });
    if (k === 'kb') {
      var reset = host.querySelector('.vditor-reset') || host.querySelector('.kbdoc-vd');
      if (reset) reset.scrollTop = kbScroll;
    } else {
      renderQuiz();
    }
  }

  function renderQuiz() {
    var q = Q[qi];
    host.querySelector('.kdq-no').textContent = '示例题 · ' + q.no;
    host.querySelector('.kdq-idx').textContent = (qi + 1) + ' / ' + Q.length;
    host.querySelector('.kdq-stem').textContent = q.stem;
    host.querySelector('.kdq-fb').textContent = '';
    var box = host.querySelector('.kdq-opts'); box.innerHTML = '';
    q.opts.forEach(function (o, i) {
      var d = document.createElement('div');
      d.className = 'kdq-opt';
      d.textContent = String.fromCharCode(65 + i) + '. ' + o[0];
      d.onclick = function () {
        d.classList.add(o[1] ? 'ok' : 'bad');
        host.querySelector('.kdq-fb').textContent = o[1] ? '✅ 正确' : '❌ 本题不选它';
      };
      box.appendChild(d);
    });
  }

  function ensureBN(cb) {
    if (window.BlockNoteMount) return cb();
    if (document.getElementById('bnCSS')) { loadScript(); return; }
    var css = document.createElement('link');
    css.id = 'bnCSS'; css.rel = 'stylesheet'; css.href = 'vendor/blocknote/editor.css';
    document.head.appendChild(css);
    loadScript();
    function loadScript() {
      var s = document.createElement('script');
      s.src = 'vendor/blocknote/editor.js';
      s.onload = cb; s.onerror = function () { cb(new Error('blocknote load fail')); };
      document.head.appendChild(s);
    }
  }

  function mountVditor(text) {
    if (vd) { try { vd.destroy(); } catch (e) {} vd = null; }
    var el = host.querySelector('.kbdoc-vd');
    if (!el || !window.BlockNoteMount) { if (el) el.textContent = '编辑器加载失败，请刷新重试'; return; }
    el.innerHTML = '';
    vd = window.BlockNoteMount(el, {
      value: text || '',
      onChange: function () { setStatus('未保存'); }
    });
  }

  function setStatus(t) { if (host) host.querySelector('.kbdoc-st').textContent = t || ''; }

  function save() {
    if (!vd) return;
    try {
      if (localStorage.getItem('kbdoc.sync') === '0') { setStatus('同步已关：未写入'); return; }
      if (cur.tag) localStorage.setItem('kbdoc.tag.' + cur.tag, vd.getMarkdown() || '');
      else localStorage.setItem('kbdoc.doc.' + cur.title, vd.getMarkdown() || '');
      setStatus('已保存到本地');
    } catch (e) { setStatus('保存失败'); }
  }

  /* ===== 侧栏目录树：二级标签 → 绑定一篇 markdown 知识点 ===== */
  var BYPASS = false;
  function tagTitle(id) {
    var b = document.querySelector('.nt2-t[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    return b ? b.textContent.trim() : '知识点';
  }
  function openTag(id, title, md) {
    ensureDom();
    cur.title = title || '知识点';
    cur.tag = id;
    host.querySelector('.kbdoc-t').textContent = cur.title;
    host.classList.add('on');
    switchTab('kb');
    ensureBN(function () {
      mountVditor(md || ('# ' + cur.title + '\n\n> 这篇知识点还没内容，直接在下面写；保存后就和这个标签绑定了。'));
      setStatus(md ? '已载入本地内容' : '');
    });
    renderQuiz();
  }
  document.addEventListener('click', function (e) {
    if (BYPASS) { BYPASS = false; return; }
    var btn = e.target.closest && e.target.closest('.nt2-t[data-id]');
    if (!btn) return;
    var node = btn.closest('.nt2-n');
    if (!node) return;
    var depth = 0, p = node.parentElement;
    while (p) { if (p.classList && p.classList.contains('nt2-n')) depth++; p = p.parentElement; }
    if (depth !== 1) return;                   /* 只绑「二级」：科目 > 章节，根与三级保持原行为 */
    var id = btn.getAttribute('data-id') || '';
    if (!id) return;
    var saved = null;
    try { saved = localStorage.getItem('kbdoc.tag.' + id); } catch (er) {}
    openTag(id, btn.textContent.trim(), saved || '');
    e.preventDefault();
    e.stopPropagation();
  }, true);

  function open(title, text) {
    ensureDom();
    cur.title = title || '文档';
    cur.text = text || '';
    cur.tag = '';
    host.querySelector('.kbdoc-t').textContent = cur.title;
    host.classList.add('on');
    switchTab('kb');
    var ov = null;
    try { ov = localStorage.getItem('kbdoc.doc.' + cur.title); } catch (e) {}
    ensureBN(function () { mountVditor(ov != null ? ov : cur.text); setStatus(ov != null ? '已载入本地修改' : ''); });
    renderQuiz();
  }

  function close() { if (host) host.classList.remove('on'); }

  function findDoc(name) {
    try {
      for (var id in KB_MEM) {
        var ds = (KB_MEM[id] && KB_MEM[id].docs) || [];
        for (var i = 0; i < ds.length; i++) if ((ds[i].name || '').trim() === name) return ds[i];
      }
    } catch (e) {}
    return null;
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('.kbDoc');
    if (!row || e.target.closest('button')) return;
    var span = row.querySelector('span');
    var nm = span ? span.textContent.trim() : '';
    if (!nm) return;
    var d = findDoc(nm);
    open(nm, d ? (d.text || '') : '');
  }, true);

  window.KbDoc = { open: open, openTag: openTag, close: close, findDoc: findDoc, tab: switchTab };
})();
