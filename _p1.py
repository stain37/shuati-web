import io
p = "collection.js"
s = io.open(p, encoding="utf-8").read()

# 1) 去掉「独立图片区」：图片全部在正文里
a1 = """  const imgs = (n && n.imgs) || [];
  const imgsHtml = imgs.length
    ? '<div class="rich-imgs">' + imgs.map((im, i) => `<span class="rich-img" data-imgi="${i}"${im.w ? ' style="width:' + im.w + 'px"' : ''}><img src="${im.src}" alt="${esc(im.name || '')}" loading="lazy"><i class="rich-rz" title="拖动改图片宽度"></i><i class="rich-mv" title="拖动调整图片先后顺序">⠿</i></span>`).join('') + '</div>'
    : '';"""
b1 = """  /* 第 ⑥ 条（2026-10-28）：不再有独立的图片区 —— 图片就是正文里的一个块，
     插在哪就显示在哪，粘贴时插在光标处，点图片可以直接删。老数据的 imgs 由 migrateNoteImgs() 搬进正文。 */"""
assert a1 in s
s = s.replace(a1, b1, 1)

a2 = """      <div class="exp rich-edit" contenteditable="true" spellcheck="false" data-note-for="${esc(fk)}" title="点进来就能改：选中文字会弹出小工具栏，改完点一下别处自动保存">${body}</div>
      ${imgsHtml}"""
b2 = """      <div class="exp rich-edit" contenteditable="true" spellcheck="false" data-note-for="${esc(fk)}" title="点进来就能改：选中文字会弹出小工具栏，Ctrl+V 可以直接粘截图；改完点一下别处自动保存">${body}</div>"""
assert a2 in s
s = s.replace(a2, b2, 1)

# 2) 粘贴图片：插在光标处（不是甩到末尾）
a3 = """      ev.preventDefault();
      (async () => {
        for (const it of imgs0) {
          const f = it.getAsFile();
          if (!f) continue;
          try { richInsertImgAtRange(el, null, await compressImage(f), f.name || '粘贴的图片'); }
          catch (err) { toast('图片粘贴失败：' + (f.name || '剪贴板图片')); }
        }
        richState(el, '未保存…', true);
      })();
      return;"""
b3 = """      ev.preventDefault();
      const rng0 = (() => {                         /* 记住光标位置：图就插在你正在写的那一段后面 */
        try { const sel = window.getSelection(); return sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; } catch (e) { return null; }
      })();
      (async () => {
        let at = rng0;
        for (const it of imgs0) {
          const f = it.getAsFile();
          if (!f) continue;
          try {
            const sp = richInsertImgAtRange(el, at, await compressImage(f), f.name || '粘贴的图片');
            if (sp) { const r = document.createRange(); r.setStartAfter(sp); r.collapse(true); at = r; }
          } catch (err) { toast('图片粘贴失败：' + (f.name || '剪贴板图片')); }
        }
        richState(el, '未保存…', true);
      })();
      return;"""
assert a3 in s
s = s.replace(a3, b3, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("step1 ok")
