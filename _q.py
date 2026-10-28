import io
p="index.html"
s=io.open(p,encoding="utf-8").read()
a="""      (function boot(){"""
i=s.find(a)
print(s[i-200:i+800] if i>=0 else "NOT FOUND")
