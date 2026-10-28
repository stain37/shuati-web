import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()

a1 = """    <div class="card">
      <div class="qmode" role="tablist" aria-label="刷题模式">"""
b1 = """    <div class="card qcard">
      ${attRailHtml(fk)}
      <div class="qmode" role="tablist" aria-label="刷题模式">"""
assert a1 in s
s = s.replace(a1, b1, 1)

a2 = """  if (typeof varqBind === 'function') varqBind($('vStrip'), fk);"""
b2 = """  if (typeof varqBind === 'function') varqBind($('vStrip'), fk);
  /* 左侧附件快捷方式：先按缓存画一遍，再去 IndexedDB 补真数据（同步读取，不卡首屏） */
  try { attBind(fk); attPaint(fk); } catch (e) {}"""
assert a2 in s
s = s.replace(a2, b2, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
