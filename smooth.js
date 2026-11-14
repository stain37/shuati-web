/* 流畅模式（可选）：静态降级，不做滚动期来回切换
   - 外观层面的降级全部在 style.css 的 html[data-smooth="1"] 段（玻璃换成普通模糊、单层阴影）
   - 这里只做 JS 侧的两件安全事：新插入的图片懒加载 / 异步解码；提供 window.SMOOTH 供调试
   不改颜色、布局与文案；关掉开关立刻恢复原样。 */
(function () {
  var root = document.documentElement;
  function on() { return root.getAttribute('data-smooth') === '1'; }

  function tagImg(img) {
    if (!img || img.dataset.smDone) return;
    img.dataset.smDone = '1';
    if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
    if (!img.getAttribute('decoding')) img.setAttribute('decoding', 'async');
  }
  function scan(node) {
    if (!on() || !node || node.nodeType !== 1) return;
    if (node.tagName === 'IMG') tagImg(node);
    if (node.querySelectorAll) {
      var list = node.querySelectorAll('img:not([data-sm-done])');
      for (var i = 0; i < list.length; i++) tagImg(list[i]);
    }
  }
  new MutationObserver(function (list) {
    if (!on()) return;
    for (var i = 0; i < list.length; i++) {
      var added = list[i].addedNodes;
      for (var j = 0; j < added.length; j++) scan(added[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.SMOOTH = {
    on: on,
    stats: function () {
      return { on: on(), lazy: document.querySelectorAll('img[loading="lazy"]').length };
    }
  };
})();
