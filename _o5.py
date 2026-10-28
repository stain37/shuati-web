import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()
a = """        ${speed ? '' : `<button class="btn" id="doMore" title="改解析 / 改答案 / AI 解析 / AI 变式题 —— 这些管理动作收进抽屉里，不摊在题目下面">⋯ 更多</button>`}"""
b = """        ${speed ? '' : `<button class="btn" id="doMore" title="改解析 / 改答案 / AI 解析 / AI 变式题 —— 这些管理动作收进抽屉里，不摊在题目下面">⋯ 更多</button>`}
        <span class="srcjump" id="srcJump" hidden></span>"""
assert a in s
s = s.replace(a, b, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("app.js ok")
