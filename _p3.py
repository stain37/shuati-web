import io
p = "collection.js"
s = io.open(p, encoding="utf-8").read()
a = """function richBox(fk, text, custom, label) {"""
b = """/* 老数据的图片（NOTES[fk].imgs 数组）搬进正文末尾，只搬一次；搬完把 imgs 清掉。
   之后就只有一个地方存图片：Markdown 正文里的 ![](…) —— 用户要求的「不要独立图片区」。 */
function migrateNoteImgs(fk) {
  try {
    const n = NOTES[fk];
    if (!n || !Array.isArray(n.imgs) || !n.imgs.length) return;
    const lines = n.imgs.map((im, i) => '![图' + (i + 1) + '](' + im.src + (im.w ? ' =' + Math.round(im.w) + 'x' : '') + ')');
    const txt = String(n.text || '').replace(/\\s+$/, '');
    NOTES[fk] = { text: (txt ? txt + '\\n\\n' : '') + lines.join('\\n\\n'), ts: Date.now(), ai: n.ai || false };
    if (typeof saveNotes === 'function') saveNotes();
  } catch (e) {}
}
function richBox(fk, text, custom, label) {
  migrateNoteImgs(fk);"""
assert a in s
s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
