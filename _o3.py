import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()
a = """      saveQtn();
      if (st) { st.textContent = v ? '已存' : ''; setTimeout(() => { if (st) st.textContent = ''; }, 1200); }"""
b = """      saveQtn();
      const qb = document.getElementById('btnQn');
      if (qb) qb.classList.toggle('has-qn', !!v);      /* 右上角小红点：这条题有没有口诀 / 思路 */
      if (st) { st.textContent = v ? '已存' : ''; setTimeout(() => { if (st) st.textContent = ''; }, 1200); }"""
assert a in s
s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
