/* install.js — 「装成 App」（PWA 安装）
   作用：
   1) 接住 beforeinstallprompt，首页右下角出现「📱 装成 App」，点一下走系统安装；
   2) 浏览器不支持安装提示（华为浏览器/微信等）时，点它弹出对应平台的「添加到桌面」步骤；
   3) 已经在独立窗口里跑（安装过）就什么都不显示。
   独立成文件，避免动 app.js 的主流程。 */
(function () {
  'use strict';
  if (window.__INSTALL_JS__) return;
  window.__INSTALL_JS__ = 1;

  var BIP = null;
  var installed = false;
  try {
    installed = !!document.documentElement.getAttribute('data-native')   /* APK 壳里不用再装 */
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  } catch (e) {}

  /* ---------- 样式 ---------- */
  var css = ''
    + '#installChip{position:fixed;right:12px;z-index:30050;display:none;align-items:center;gap:6px;'
    + 'padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.5);'
    + 'background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;font-size:13px;font-weight:600;'
    + 'box-shadow:0 10px 26px rgba(37,99,235,.35);cursor:pointer;backdrop-filter:blur(8px);'
    + '-webkit-tap-highlight-color:transparent}'
    + '#installChip:active{transform:scale(.95)}'
    + 'body.quiz #installChip,body.focus #installChip{display:none!important}'
    + '#installMask{position:fixed;inset:0;z-index:30090;background:rgba(8,12,22,.5);'
    + 'display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(3px)}'
    + '#installMask.on{display:flex}'
    + '#installSheet{width:100%;max-width:520px;margin:0 8px 8px;background:var(--card,#fff);color:var(--text,#0f172a);'
    + 'border-radius:24px;padding:18px 18px 14px;box-shadow:0 -12px 40px rgba(0,0,0,.25);max-height:82vh;overflow:auto}'
    + '#installSheet h3{margin:0 0 4px;font-size:16px}'
    + '#installSheet .is-sub{font-size:12.5px;opacity:.62;margin-bottom:12px}'
    + '#installSheet ol{margin:0 0 12px;padding-left:20px;line-height:1.85;font-size:14px}'
    + '#installSheet ol b{color:#2563eb}'
    + '#installSheet .is-row{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}'
    + '#installSheet .is-tag{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:999px;'
    + 'background:rgba(37,99,235,.12);color:#2563eb;margin-left:6px;vertical-align:1px}';

  function addCss() {
    if (document.getElementById('installCss')) return;
    var s = document.createElement('style');
    s.id = 'installCss';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ua() {
    var u = navigator.userAgent || '';
    if (/MicroMessenger/i.test(u)) return 'wechat';
    if (/Huawei|HUAWEI|HarmonyOS/i.test(u)) return 'huawei';
    if (/iPhone|iPad|iPod/i.test(u)) return 'ios';
    if (/Edg/i.test(u)) return 'edge';
    if (/Chrome|CriOS/i.test(u)) return 'chrome';
    return 'other';
  }

  function stepsHtml() {
    var k = ua();
    if (k === 'wechat') {
      return '<ol><li>右上角 <b>…</b> → <b>在浏览器打开</b></li>'
        + '<li>在浏览器里再点右下角「📱 装成 App」看对应步骤</li></ol>'
        + '<div class="is-sub">微信里装不了 App</div>';
    }
    if (k === 'huawei') {
      return '<ol><li>华为浏览器右下角 <b>≡</b>（或底部「···」）</li>'
        + '<li>选 <b>添加到桌面</b> / <b>添加到主屏幕</b></li>'
        + '<li>回桌面找「刷题站」图标，打开就是全屏</li></ol>'
        + '<div class="is-sub">鸿蒙的「花瓣浏览器」叫「添加到主屏幕」，位置在底部菜单里</div>';
    }
    if (k === 'ios') {
      return '<ol><li>用 <b>Safari</b> 打开本站</li>'
        + '<li>点底部中间的 <b>分享</b> 按钮 ⬆️</li>'
        + '<li>往下滑，选 <b>添加到主屏幕</b> → 添加</li></ol>'
        + '<div class="is-sub">iOS 必须 Safari；Chrome for iOS 只能加书签</div>';
    }
    if (k === 'chrome' || k === 'edge') {
      return '<ol><li>点右上角 <b>⋮</b>（Edge 是「…」）</li>'
        + '<li>选 <b>安装应用</b> / <b>添加到主屏幕</b></li>'
        + '<li>桌面会出现「刷题站」图标，打开是无地址栏的全屏</li></ol>'
        + '<div class="is-sub">电脑上：地址栏右侧会出现安装小图标，点一下即可</div>';
    }
    return '<ol><li>浏览器菜单里找 <b>安装应用</b> / <b>添加到主屏幕</b></li>'
      + '<li>桌面出现图标后打开就是全屏</li></ol>';
  }

  function sheet(open) {
    var m = document.getElementById('installMask');
    if (!m) return;
    m.classList.toggle('on', !!open);
    if (open) document.body.appendChild(m);
  }

  function buildSheet() {
    if (document.getElementById('installMask')) return;
    var m = document.createElement('div');
    m.id = 'installMask';
    m.addEventListener('click', function (e) { if (e.target === m) sheet(false); });
    var d = document.createElement('div');
    d.id = 'installSheet';
    d.innerHTML = '<h3>装成 App<span class="is-tag">免安装包</span></h3>'
      + '<div class="is-sub">装到桌面后：全屏无地址栏、图标直达、原来的数据照旧保留。</div>'
      + '<div id="installSteps">' + stepsHtml() + '</div>'
      + '<div class="is-row"><button class="btn" id="installClose">知道了</button>'
      + '<button class="btn primary" id="installTry" style="display:none">直接安装</button></div>';
    m.appendChild(d);
    document.body.appendChild(m);
    d.querySelector('#installClose').onclick = function () { sheet(false); };
    d.querySelector('#installTry').onclick = function () { promptInstall(); };
  }

  function promptInstall() {
    if (!BIP) return false;
    try {
      BIP.prompt();
      if (BIP.userChoice) {
        BIP.userChoice.then(function (c) {
          BIP = null;
          refresh();
          if (c && c.outcome === 'accepted') sheet(false);
        });
      }
    } catch (e) {}
    return true;
  }

  function chip(show) {
    addCss();
    var b = document.getElementById('installChip');
    if (!b) {
      b = document.createElement('button');
      b.id = 'installChip';
      b.type = 'button';
      b.innerHTML = '📱 装成 App';
      b.addEventListener('click', function () {
        /* 先给步骤（哪个浏览器都看得懂），能直接装的话按钮里再放一个「直接安装」 */
        buildSheet();
        var t = document.querySelector('#installTry');
        if (t) t.style.display = BIP ? '' : 'none';
        sheet(true);
      });
      document.body.appendChild(b);
    }
    var on = show && !installed;
    b.style.display = on ? 'flex' : 'none';
    /* 站在底栏上方 */
    var bnav = document.querySelector('.bnav');
    var h = 74;
    if (bnav) {
      var r = bnav.getBoundingClientRect();
      h = Math.max(64, window.innerHeight - r.top + 12);
    }
    b.style.bottom = h + 'px';
  }

  function isHome() {
    var h = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return h === '' || h === 'home';
  }

  function refresh() { chip(isHome()); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    BIP = e;
    refresh();
  });
  window.addEventListener('appinstalled', function () {
    installed = true;
    BIP = null;
    chip(false);
  });
  window.addEventListener('hashchange', refresh);
  window.addEventListener('resize', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
  setTimeout(refresh, 800);
  setTimeout(refresh, 2200);

  window.__install = { chip: chip, sheet: sheet, prompt: promptInstall, refresh: refresh };
})();
