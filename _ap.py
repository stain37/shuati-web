import io
p="ai.js"
s=io.open(p,encoding="utf-8").read()
old_start='/* 「更多」旁边那个空位'
i=s.index(old_start)
j=s.index("function aiPaintSrc(host, ctx) {", i)
new='''/* 「更多」旁边那个空位：本次 AI 解析用了几条资料，就显示一个小小的「📎 资料 3」。
   点它 → 直接在按钮旁边摊开列表，点某条就地看原文（web178 第 ⑦ 条：不再只是把你滚过去）。 */
let AI_SRC_HITS = [];
function aiSrcJump(n, names) {
  let el = null;
  try { el = document.getElementById('srcJump'); } catch (e) {}
  if (!el) return;
  if (!n) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = '📎 资料 ' + n;
  el.title = '这次解析引用了 ' + n + ' 条资料' + (names ? '：' + names : '') + '（点一下直接看原文）';
  if (!el.__bound) {
    el.__bound = 1;
    el.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      aiSrcPanel(el);
    });
  }
}
let AI_SRC_PANEL = null;
function aiSrcPanel(anchor) {
  const close = () => { if (AI_SRC_PANEL) { AI_SRC_PANEL.remove(); AI_SRC_PANEL = null; } };
  if (AI_SRC_PANEL) { close(); return; }
  const hits = AI_SRC_HITS || [];
  if (!hits.length) return;
  const box = document.createElement('div');
  box.className = 'srcpop';
  box.innerHTML = '<div class="srcpop-h">参考资料 · ' + hits.length + ' 条<span class="srcpop-x" title="关掉">✕</span></div>'
    + hits.map(function (h, i) {
      return '<button type="button" class="srcpop-i" data-i="' + i + '">'
        + '<b>[' + (i + 1) + '] ' + esc(aiSrcName(h)) + (h.page ? ' 第 ' + h.page + ' 页' : '') + '</b>'
        + '<span>' + esc(String(h.head || h.snip || '').slice(0, 90)) + '</span></button>';
    }).join('');
  document.body.appendChild(box);
  AI_SRC_PANEL = box;
  const r = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
  let x = Math.min(r.left, window.innerWidth - br.width - 8);
  let y = r.bottom + 6;
  if (y + br.height > window.innerHeight - 8) y = Math.max(8, r.top - br.height - 6);
  box.style.left = Math.max(8, x) + 'px';
  box.style.top = y + 'px';
  box.querySelector('.srcpop-x').onclick = close;
  Array.prototype.forEach.call(box.querySelectorAll('.srcpop-i'), function (b) {
    b.onclick = function () {
      const h = hits[+b.getAttribute('data-i')];
      if (!h) return;
      close();
      aiSrcModal(h);
    };
  });
  setTimeout(function () {
    document.addEventListener('click', function onDoc(e) {
      if (!AI_SRC_PANEL) { document.removeEventListener('click', onDoc, true); return; }
      if (AI_SRC_PANEL.contains(e.target)) return;
      close(); document.removeEventListener('click', onDoc, true);
    }, true);
  }, 0);
}
/* 原文弹窗：整节正文，可滚动 */
function aiSrcModal(h) {
  const old = document.getElementById('srcModal');
  if (old) old.remove();
  const full = String(h.full || h.text || h.snip || '');
  const m = document.createElement('div');
  m.className = 'mask show srcmodal';
  m.id = 'srcModal';
  m.innerHTML = '<div class="sheet srcsheet"><div class="srcsheet-h">《' + esc(aiSrcName(h)) + '》'
    + (h.page ? '第 ' + h.page + ' 页' : '') + (h.head ? '　·　' + esc(h.head) : '')
    + '<span class="srcsheet-x" title="关掉">✕</span></div><div class="srcsheet-b">' + aiPdfBlockHtml(h, full) + '</div></div>';
  document.body.appendChild(m);
  aiBindPdfInline(m);
  const close = function () { m.remove(); };
  m.querySelector('.srcsheet-x').onclick = close;
  m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2, true); }
  }, true);
}
window.aiSrcPanel = aiSrcPanel;
window.aiSrcModal = aiSrcModal;
'''
s = s[:i] + new + s[j:]
io.open(p,"w",encoding="utf-8").write(s)
print("ok", len(s))
