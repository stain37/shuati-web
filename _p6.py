import io
p="index.html"
s=io.open(p,encoding="utf-8").read()
a="""  (function boot() {"""
b="""  /* 探针/自动化环境：用连续的 204 请求把虚拟时钟拖住，否则无头浏览器的
     virtual-time 会把计时器一次性跑完，IndexedDB 的回调还没轮到就被判定超时。
     只在 window.__PUMP 被显式打开时启用，真实用户完全不受影响。 */
  if (window.__PUMP) {
    (function pump() {
      fetch('__pump').catch(function () {}).finally(function () { setTimeout(pump, 20); });
    })();
  }

  (function boot() {"""
assert a in s
s=s.replace(a,b,1)
io.open(p,"w",encoding="utf-8").write(s)
print("index ok")

p2="C:/Users/chen/Desktop/工作1/idb-probe.py"
t=io.open(p2,encoding="utf-8").read()
a2="seed_js = 'localStorage.clear();'"
b2="seed_js = 'window.__PUMP=1;localStorage.clear();'"
assert a2 in t
t=t.replace(a2,b2,1)
io.open(p2,"w",encoding="utf-8").write(t)
print("probe ok")
