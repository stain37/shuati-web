import io
p="index.html"; s=io.open(p,encoding="utf-8").read()
a="""  if (window.__PUMP) {
    (function pump() {
      fetch('__pump').catch(function () {}).finally(function () { setTimeout(pump, 20); });
    })();
  }"""
b="""  if (window.__PUMP) {
    (function pump() {
      var n = 0;
      (function step() {
        if (n++ > 120) return;   /* 只在前 ~2.4s 虚拟时间里拖住时钟，够 IndexedDB 开库即可 */
        fetch('__pump').catch(function () {}).finally(function () { setTimeout(step, 20); });
      })();
    })();
  }"""
assert a in s
s=s.replace(a,b,1); io.open(p,"w",encoding="utf-8").write(s); print("ok")
