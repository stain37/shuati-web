import io
p="index.html"
s=io.open(p,encoding="utf-8").read()
a="""  (async function boot() {
    if (typeof window.__bigLoad !== 'function') { render(); return; }
    /* IndexedDB 偶尔会卡几秒（比如上一次连接没关干净），不能让它拖着首屏不画：
       最多等 1.5 秒，超时先画，等它真读完了再补一次渲染。 */
    const p = window.__bigLoad().then(r => { window.__bootBl = r; }, e => { window.__bootBl = 'ERR ' + ((e && e.message) || e); });
    const r = await Promise.race([p, new Promise(res => setTimeout(() => res('timeout'), 1500))]);
    render();
    if (r === 'timeout') p.then(() => { try { render(); } catch (e) {} });
  })();"""
b="""  (function boot() {
    /* 先画一屏（本地数据本来就在内存里），IndexedDB 读完再补画一次。
       刻意不设「最多等 1.5 秒」那种定时器：无头/虚拟时钟下定时器会抢跑，
       真实用户那边又没必要为一次读盘拖住首屏。 */
    try { render(); } catch (e) { console.log('[boot] 首屏失败', e); }
    if (typeof window.__bigLoad !== 'function') { window.__bootBl = 'no-idb'; return; }
    window.__bigLoad().then(function (r) {
      window.__bootBl = r;
      try { if (typeof invalidateBanks === 'function') invalidateBanks(); } catch (e) {}
      try { render(); } catch (e) { console.log('[boot] 二次渲染失败', e); }
    }, function (e) {
      window.__bootBl = 'ERR ' + ((e && e.message) || e);
    });
  })();"""
assert a in s
s=s.replace(a,b,1)
io.open(p,"w",encoding="utf-8").write(s)
print("ok")
