import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()
a = """    const rq = indexedDB.open('shuati-store', 1);
    rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };"""
b = """    const rq = indexedDB.open('shuati-store', 2);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('att')) db.createObjectStore('att');   /* 题目附件（本地引用，不上传） */
    };"""
assert a in s
s = s.replace(a, b)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
