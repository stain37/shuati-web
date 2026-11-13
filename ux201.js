/* Lucian UX/UI Prompt #201 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#201 */
/* 刷题站适配：把「导出备份」包成一条可视流程（节点 + 连线 + 光点 + 每步耗时） */
(function () {
  if (window.__ux201) return;
  window.__ux201 = 1;

  var STEPS = [
    { key: 'read', label: '读取本机数据', hint: '题库 / 笔记 / 记录' },
    { key: 'pack', label: '打包知识库', hint: '内嵌知识库分片' },
    { key: 'write', label: '写入文件', hint: '生成 JSON 备份' },
    { key: 'done', label: '完成', hint: '已保存到下载目录' }
  ];

  function board() {
    var d = document.createElement('div');
    d.className = 'u201b';
    d.innerHTML = '<div class="u201b-hd"><b>导出流程</b><span class="u201b-tot"></span></div>' +
      '<div class="u201b-flow">' +
      STEPS.map(function (s, i) {
        return '<div class="u201b-n" data-i="' + i + '"><i class="u201b-dot"></i>' +
          '<div class="u201b-tx"><b>' + s.label + '</b><span>' + s.hint + '</span></div>' +
          '<em class="u201b-ms"></em></div>' +
          (i < STEPS.length - 1 ? '<div class="u201b-l" data-i="' + i + '"><i></i></div>' : '');
      }).join('') + '</div>';
    return d;
  }

  var el = null, nodes = [], links = [], started = 0, doneAt = 0;

  function byLabel(label) {
    if (/读取/.test(label)) return 0;
    if (/打包/.test(label)) return 1;
    if (/写入/.test(label)) return 2;
    if (/完成/.test(label)) return 3;
    return -1;
  }

  function reset() {
    nodes.forEach(function (n) { n.classList.remove('is-run', 'is-done'); n.querySelector('.u201b-ms').textContent = ''; });
    links.forEach(function (l) { l.classList.remove('is-on'); });
    el.querySelector('.u201b-tot').textContent = '';
    started = 0;
  }

  function mark(i, pct) {
    if (i < 0) return;
    if (!started) started = performance.now();
    for (var k = 0; k < i; k++) {
      if (!nodes[k].classList.contains('is-done')) finish(k, started);
    }
    nodes[i].classList.add('is-run');
    if (i > 0) links[i - 1].classList.add('is-on');
    if (i < links.length) links[i].classList.add('is-on');
  }

  function fmt(ms) { return ms < 100 ? '<0.1s' : (ms / 1000).toFixed(1) + 's'; }

  function finish(i, t0) {
    var n = nodes[i];
    n.classList.remove('is-run'); n.classList.add('is-done');
    n.querySelector('.u201b-ms').textContent = fmt(performance.now() - t0);
  }

  function feed(pct, label) {
    if (!el) return;
    var i = byLabel(label || '');
    if (i >= 0) mark(i, pct);
    if (pct >= 1) {
      nodes.forEach(function (n, k) { if (!n.classList.contains('is-done')) finish(k, started || performance.now()); });
      links.forEach(function (l) { l.classList.add('is-on'); });
      doneAt = performance.now();
      el.classList.add('is-done');
      el.querySelector('.u201b-tot').textContent = '总耗时 ' + fmt(doneAt - started);
      setTimeout(function () { el.classList.remove('is-done'); }, 2400);
    }
  }

  function install() {
    var orig = window.exportAllData;
    if (typeof orig !== 'function') return false;
    if (orig.__ux201) return true;
    var wrapped = function (prog) {
      reset();
      return orig(function (p, label) {
        try { feed(p, label); } catch (e) {}
        if (typeof prog === 'function') return prog(p, label);
      });
    };
    wrapped.__ux201 = 1;
    window.exportAllData = wrapped;
    return true;
  }

  function mount() {
    var btn = document.querySelector('.u004-btn');
    if (!btn || !install()) { setTimeout(mount, 500); return; }
    if (el && el.isConnected && el.parentNode === btn.parentNode) return;
    var box = el || board();
    el = box;
    nodes = Array.prototype.slice.call(box.querySelectorAll('.u201b-n'));
    links = Array.prototype.slice.call(box.querySelectorAll('.u201b-l'));
    if (!box.isConnected) btn.parentNode.insertBefore(box, btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  var t = 0;
  document.addEventListener('click', function () { clearTimeout(t); t = setTimeout(mount, 300); }, true);
  window.addEventListener('scroll', function () {
    clearTimeout(t); t = setTimeout(mount, 200);
  }, { passive: true });
})();
