import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()
subs = [
 ("选项（每行一个，最多 8 个；空行会去掉，字母自动重排）", "选项（每行一个，最多 12 个＝A–L；空行会去掉，字母自动重排）"),
 ("if (inputs.length >= 8) { toast('最多 8 个选项'); return; }", "if (inputs.length >= 12) { toast('最多 12 个选项（A–L）'); return; }"),
 ("cur.options.length < 8", "cur.options.length < 12"),
]
for a, b in subs:
    n = s.count(a)
    s = s.replace(a, b)
    print(n, "->", a[:30])
io.open(p, "w", encoding="utf-8").write(s)
