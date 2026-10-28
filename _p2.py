import io
p = "collection.js"
s = io.open(p, encoding="utf-8").read()

# 3) 行内图片：包一层 .rich-img 便于选中 / 删除 / 改宽度；点图选中、× 删除、拖右下角改宽
a = """function richInsertImgAtRange(el, rng, src, alt) {"""
b = """/* 行内图片的交互（第 ⑥ 条）：点一下选中（再按 Delete 就删掉）、右上角 × 直接删、
   右下角手柄拖动改宽度（宽度写回 Markdown 的 =宽x 里，刷新还在）。 */
function richImgWrap(img) {
  if (!img || !img.parentNode) return null;
  if (img.parentNode.classList && img.parentNode.classList.contains('rich-img')) return img.parentNode;
  const sp = document.createElement('span');
  sp.className = 'rich-img in-text';
  img.parentNode.insertBefore(sp, img);
  sp.appendChild(img);
  const h = document.createElement('i'); h.className = 'rich-rz'; h.title = '拖动改图片宽度';
  const x = document.createElement('i'); x.className = 'rich-x'; x.title = '删掉这张图片（正文里的原图一起删）'; x.textContent = '×';
  sp.appendChild(h); sp.appendChild(x);
  return sp;
}
function richWrapAllImgs(el) {
  if (!el) return;
  Array.prototype.slice.call(el.querySelectorAll('img')).forEach(im => {
    if (im.closest && im.closest('.rich-img')) return;
    richImgWrap(im);
  });
}
function richImgInitOnce() {
  if (window.__richImgInit) return;
  window.__richImgInit = 1;
  document.addEventListener('mousedown', function (e) {
    const img = e.target && e.target.closest ? e.target.closest('.rich-edit img') : null;
    if (!img) return;
    const sp = img.closest('.rich-img');
    e.preventDefault();
    try {
      const r = document.createRange(); r.selectNode(sp || img);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (err) {}
  });
  document.addEventListener('click', function (e) {
    const x = e.target && e.target.closest ? e.target.closest('.rich-x') : null;
    if (!x) return;
    const sp = x.closest('.rich-img');
    const ed = x.closest('.rich-edit');
    e.preventDefault(); e.stopPropagation();
    if (sp) sp.remove();
    if (ed) { ed.dispatchEvent(new Event('input', { bubbles: true })); ed.focus(); }
  });
  /* 宽度手柄：按下拖动，span 与 img 同时改宽，松手触发 input 让它保存 */
  let drag = null;
  document.addEventListener('mousedown', function (e) {
    const h = e.target && e.target.closest ? e.target.closest('.rich-rz') : null;
    if (!h) return;
    const sp = h.closest('.rich-img');
    const img = sp && sp.querySelector('img');
    if (!img) return;
    e.preventDefault();
    const r = sp.getBoundingClientRect();
    drag = { sp: sp, img: img, x0: e.clientX, w0: r.width, max: Math.max(200, (sp.closest('.rich-edit') || document.body).clientWidth - 24) };
    document.body.classList.add('rz-drag');
  });
  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    const w = Math.max(60, Math.min(drag.max, drag.w0 + (e.clientX - drag.x0)));
    drag.sp.style.width = w + 'px';
    drag.img.style.width = '100%';
    drag.img.setAttribute('width', String(Math.round(w)));
  });
  document.addEventListener('mouseup', function () {
    if (!drag) return;
    const ed = drag.sp.closest('.rich-edit');
    document.body.classList.remove('rz-drag');
    drag = null;
    if (ed) ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function richInsertImgAtRange(el, rng, src, alt) {"""
assert a in s
s = s.replace(a, b, 1)

# 4) richBind 里把已有图片包一层
a2 = """  RICH = { el: el, fk: fk, save: save };"""
b2 = """  RICH = { el: el, fk: fk, save: save };
  try { richImgInitOnce(); richWrapAllImgs(el); } catch (e) {}"""
assert a2 in s
s = s.replace(a2, b2, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
