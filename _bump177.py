import io, re
sw = io.open("sw.js", encoding="utf-8").read()
sw = re.sub(r"const VERSION = '[^']+';", "const VERSION = 'shuati-v68-web177';", sw, count=1)
sw = re.sub(r"(/\* 本轮[^\n]*\*/)", r"\1", sw)
lines = sw.splitlines()
for i, l in enumerate(lines):
    if l.strip().startswith("*") and ("web176" in l or "资料库拆分" in l):
        lines.insert(i + 1, " * 本轮（web177）：存储满了改 IndexedDB（笔记/题库搬家）、解析渲染加固（latex 围栏 / \\[ \\] / 裸 diagram）、图片并入解析编辑区、题目附件、一键合并题库、选项到 L、参考资料胶囊、口诀红点、AI 面板只读。")
        break
sw = "\n".join(lines) + "\n"
io.open("sw.js", "w", encoding="utf-8").write(sw)
idx = io.open("index.html", encoding="utf-8").read()
for f in ["app.js", "collection.js", "cat.js", "style.css", "ai.js", "sync.js"]:
    idx = re.sub(r'(["\']?)' + re.escape(f) + r'(\?v=[^"\']*)?(["\'])', lambda m: m.group(0).replace(m.group(1) + f, m.group(1) + f).split('?')[0] + '?v=20261111a' + m.group(3), idx)
io.open("index.html", "w", encoding="utf-8").write(idx)
print("VERSION", re.search(r"const VERSION = '([^']+)'", sw).group(1))
print([l for l in idx.splitlines() if "?v=20261111a" in l][:8])
