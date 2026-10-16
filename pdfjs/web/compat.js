/* 老浏览器兼容垫片（刷题站自用，2026-10-16）
   为什么需要：pdf.js 5 的构建用了两个很新的 API，旧一点的 iPad / 安卓浏览器一碰就崩
   （表现就是「阅读器白屏 / 半天不出来」，手机和电脑新所以看不出来）：
     · Promise.withResolvers —— Safari 17.4+ / Chrome 119+
     · URL.parse            —— Safari 18+   / Chrome 126+
   这里补上等价实现。其他用到的（Object.hasOwn / Array.at / findLast / structuredClone / replaceAll）
   自 Safari 15.4 / Chrome 97 就有，不再垫。

   注意：viewer.html 里那条 CSP 是 script-src 'self'，内联脚本会被拦 —— 所以垫片必须独立成文件，
   放在 viewer.mjs 之前引入（经典脚本，先于 module 执行）。 */
(function () {
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }
  if (typeof URL.parse !== 'function') {
    /* 原生行为：解析失败返回 null；第二个参数是可选 base */
    URL.parse = function (url, base) {
      try { return base === undefined ? new URL(url) : new URL(url, base); } catch (e) { return null; }
    };
  }
})();
