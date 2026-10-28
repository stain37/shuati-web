import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()
a = """function renderRich(k, text) {
  const n = noteOf(k);
  let html = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text);
  if (n && n.imgs && n.imgs.length) {
    html += '<div class="rich-imgs">' + n.imgs.map(im => `<img src="${im.src}" alt="${esc(im.name || '')}" loading="lazy">`).join('') + '</div>';
  }
  return html;
}"""
b = """function renderRich(k, text) {
  /* 第 ⑥ 条：不再往解析末尾拼独立的图片区；老数据由 collection.js 的 migrateNoteImgs() 搬进正文 */
  if (typeof migrateNoteImgs === 'function') { try { migrateNoteImgs(k); } catch (e) {} }
  const n = noteOf(k);
  const body = (n && n.text) ? n.text : text;
  return (typeof mdToHtml === 'function') ? mdToHtml(body) : esc(body);
}"""
assert a in s
s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
