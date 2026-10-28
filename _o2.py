import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()
a = """        <button class="btn qn-open" id="btnQn" title="口诀 / 思路便签：独立浮窗，可拖动、右下角可拉大小；只在这个页面出现">✎ 口诀</button>"""
b = """        <button class="btn qn-open${((QTN[fk] || {}).text || '').trim() ? ' has-qn' : ''}" id="btnQn" title="口诀 / 思路便签：独立浮窗，可拖动、右下角可拉大小；只在这个页面出现">✎ 口诀</button>"""
assert a in s
s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
