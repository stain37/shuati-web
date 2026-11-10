/* ===== 离线模式（2026-11-10）=====
   打开后：除了本站自己的静态文件（index.html / *.js / *.css / pdfjs/…），任何联网请求一律拦下并提示。
   这样「读 PDF」这类本地能力照常，AI / 云同步 / 外部接口会被明确拦住，一眼看出哪些动作会出网。
   开关存在 localStorage['qbank.offline.v1']，由「设置 → 离线模式」控制；window.OFFLINE 暴露状态。 */
(function () {
  var K = 'qbank.offline.v1';
  var ON = false;
  try { ON = localStorage.getItem(K) === '1'; } catch (e) {}
  var count = 0, warned = false;

  function sameOrigin(u) {
    try {
      var x = new URL(String(u), location.href);
      return x.origin === location.origin;
    } catch (e) { return true; }        /* 解析不了就当同源，别误拦 */
  }
  function note(what) {
    count++;
    try { console.warn('[offline] 拦截：' + what); } catch (e) {}
    try {
      if (window.toast && !warned) {
        warned = true;
        toast('离线模式：已拦下联网请求（' + what + '）', 3600, 'warn');
      }
    } catch (e) {}
  }

  /* fetch */
  var _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input) {
      var u = (typeof input === 'string') ? input : ((input && input.url) || '');
      if (ON && u && !sameOrigin(u)) {
        note(u.length > 70 ? u.slice(0, 70) + '…' : u);
        return Promise.reject(new Error('离线模式：不联网（' + (u.slice(0, 60)) + '）'));
      }
      return _fetch.apply(this, arguments);
    };
  }
  /* XHR */
  try {
    var _open = XMLHttpRequest.prototype.open;
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (ON && u && !sameOrigin(u)) {
        this.__off = true;
        note(String(u).slice(0, 70));
        return _open.call(this, m, 'about:blank', true);
      }
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__off) { try { this.abort(); } catch (e) {} return; }
      return _send.apply(this, arguments);
    };
  } catch (e) {}
  /* sendBeacon / WebSocket */
  try {
    var _beacon = navigator.sendBeacon;
    if (typeof _beacon === 'function') {
      navigator.sendBeacon = function (u) {
        if (ON && !sameOrigin(u)) { note('beacon ' + String(u).slice(0, 60)); return false; }
        return _beacon.apply(navigator, arguments);
      };
    }
  } catch (e) {}
  try {
    var _WS = window.WebSocket;
    if (typeof _WS === 'function') {
      window.WebSocket = function (u) {
        if (ON) { note('websocket ' + String(u).slice(0, 60)); throw new Error('离线模式：不联网'); }
        return new _WS(u);
      };
      window.WebSocket.prototype = _WS.prototype;
    }
  } catch (e) {}

  function badge() {
    var el = document.getElementById('offlineBadge');
    if (!ON) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'offlineBadge';
    el.textContent = '🔌 离线模式';
    el.setAttribute('title', '离线模式已开：AI 与云同步会被拦下，点这里去设置');
    el.style.cssText = 'position:fixed;left:10px;bottom:calc(96px + env(safe-area-inset-bottom));z-index:30040;'
      + 'padding:4px 10px;border-radius:999px;font-size:12px;line-height:18px;cursor:pointer;'
      + 'background:rgba(20,26,40,.82);color:#fff;box-shadow:0 6px 18px rgba(10,18,40,.28);'
      + 'backdrop-filter:blur(10px);user-select:none';
    el.addEventListener('click', function () {
      try { location.hash = '#/set'; } catch (e) {}
    });
    document.body.appendChild(el);
  }

  var OFFLINE = {
    on: function () { return ON; },
    count: function () { return count; },
    set: function (v) {
      ON = !!v; warned = false;
      try { localStorage.setItem(K, ON ? '1' : '0'); } catch (e) {}
      try { document.documentElement.setAttribute('data-offline', ON ? '1' : '0'); } catch (e) {}
      try { badge(); } catch (e) {}
      return ON;
    }
  };
  window.OFFLINE = OFFLINE;
  /* 自己再挂一层（不依赖 app.js 的绑定；两边都设一遍是幂等的） */
  try {
    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.id === 'setOffline') OFFLINE.set(!!t.checked);
    }, true);
  } catch (e) {}
  try { if (ON) document.documentElement.setAttribute('data-offline', '1'); } catch (e) {}
  try {
    if (document.body) badge();
    else document.addEventListener('DOMContentLoaded', badge);
  } catch (e) {}
})();
