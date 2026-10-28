import io
p = "ai.js"
s = io.open(p, encoding="utf-8").read()

# 1) 参考资料为空时，把「更多」旁边的资料小钮收起来
a1 = """    box.innerHTML = (typeof kbList === 'function' && kbList().length)
      ? '<span class="small muted">本次没用知识库（没勾选，或没命中相关内容）</span>'
      : '';
    return;"""
b1 = """    box.innerHTML = (typeof kbList === 'function' && kbList().length)
      ? '<span class="small muted">本次没用知识库（没勾选，或没命中相关内容）</span>'
      : '';
    aiSrcJump(0, '');
    return;"""
assert a1 in s
s = s.replace(a1, b1)

# 2) 有参考资料时同步「更多」旁边的资料小钮
a2 = """  const sig = aiSrcSig(ctx.hits);"""
b2 = """  const sig = aiSrcSig(ctx.hits);
  aiSrcJump(ctx.hits.length, ctx.hits.map(h => aiSrcName(h)).slice(0, 4).join('、'));"""
assert a2 in s
s = s.replace(a2, b2, 1)

# 3) 新增 aiSrcJump：把「更多」旁边那个空位填上（点一下就跳到参考资料）
a3 = """function aiPaintSrc(host, ctx) {"""
b3 = """/* 「更多」旁边那个空位：本次 AI 解析用了几条资料，就显示一个小小的「📎 资料 3」。
   点它 → 滚到参考资料那一行并闪一下（以前参考资料整块堆在正文下面，占高度还会上下滑）。 */
function aiSrcJump(n, names) {
  let el = null;
  try { el = document.getElementById('srcJump'); } catch (e) {}
  if (!el) return;
  if (!n) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = '📎 资料 ' + n;
  el.title = '这次解析引用了 ' + n + ' 条资料' + (names ? '：' + names : '') + '（点一下看原文）';
  if (!el.__bound) {
    el.__bound = 1;
    el.addEventListener('click', function () {
      const box = document.querySelector('.aisrc');
      if (!box) return;
      try { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { box.scrollIntoView(); }
      box.classList.add('flash');
      setTimeout(function () { box.classList.remove('flash'); }, 900);
      const t = box.querySelector('.aitag');
      if (t) t.click();
    });
  }
}
function aiPaintSrc(host, ctx) {"""
assert a3 in s
s = s.replace(a3, b3, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ai.js ok")
