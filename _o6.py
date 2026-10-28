import io
p = "ai.js"
s = io.open(p, encoding="utf-8").read()
a = """  L.push('<div class="aiout small"></div>');"""
b = """  L.push('<div class="aiout small" data-readonly="1" title="只读：AI 输出的文字不能选中也不能改，要复制请点上面的「复制」"></div>');"""
assert a in s
s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
