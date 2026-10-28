import io,re
s=io.open("index.html",encoding="utf-8").read()
print("stamps", s.count("20261111a"))
print("len", len(s))
for l in s.splitlines():
    if "script src" in l or "stylesheet" in l:
        print(l.strip())
