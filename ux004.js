/* Lucian UX/UI Prompt #004 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#004
   刷题站落点：首页「数据备份」里的「导出全部数据」。按下后按钮自己变成进度条，
   导出完成折成圆形打勾、再展开成「已保存」。进度来自真实导出阶段（打包/写文件）。 */
(function () {
  'use strict';
  if (window.UX004) return;

  var rm = false;
  try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e0) {}

  function mount(btn, opt) {
    if (!btn || btn.__ux004) return;
    opt = opt || {};
    var host = document.createElement('button');
    host.type = 'button';
    host.className = 'u004-btn';
    host.setAttribute('aria-label', opt.aria || opt.label || '导出');
    host.innerHTML =
      '<span class="u004-track" aria-hidden="true"><span class="u004-bar"></span></span>' +
      '<span class="u004-idle" aria-hidden="true"><span class="u004-arw"><svg viewBox="0 0 24 24"><g class="u004-a"><path d="M12 4.5v11M7 11l5 5 5-5"/></g><path d="M5 19.5h14"/></svg></span><b></b></span>' +
      '<span class="u004-run" aria-hidden="true"><b class="u004-pct">0%</b><small class="u004-eta"></small></span>' +
      '<span class="u004-ok" aria-hidden="true"><i><svg viewBox="0 0 16 16"><path d="M3.5 8.4l3 3 6-6.4"/></svg></i><span></span></span>';
    host.querySelector('.u004-idle b').textContent = opt.label || '导出全部数据';
    host.querySelector('.u004-ok span').textContent = opt.done || '已保存';
    btn.replaceWith(host);
    host.__ux004 = 1;

    var pct = host.querySelector('.u004-pct'), eta = host.querySelector('.u004-eta');
    var bar = host.querySelector('.u004-bar');
    var live = document.createElement('span');
    live.className = 'u004-live'; live.setAttribute('aria-live', 'polite');
    host.parentNode.insertBefore(live, host.nextSibling);

    var state = 'idle', t = 0, raf = 0, target = 0, shown = 0;

    function setP(v, label) {
      target = Math.max(shown, Math.min(1, v));
      if (label) eta.textContent = label;
      if (!raf) raf = requestAnimationFrame(step);
    }
    function step() {
      raf = 0;
      shown += (target - shown) * (rm ? 1 : 0.3);
      if (Math.abs(target - shown) < 0.002) shown = target;
      bar.style.setProperty('--p', shown.toFixed(3));
      bar.style.transform = 'scaleX(' + shown.toFixed(3) + ')';
      pct.textContent = Math.round(shown * 100) + '%';
      if (shown < target) raf = requestAnimationFrame(step);
    }
    function setState(s) {
      state = s;
      host.dataset.state = s;
      host.classList.toggle('is-run', s === 'run');
      host.setAttribute('aria-busy', s === 'run' ? 'true' : 'false');
    }
    setState('idle');

    host.addEventListener('click', function () {
      if (state === 'run') {                 // 取消：只是收起动画，真实导出没有副作用
        setState('idle'); shown = target = 0;
        bar.style.transform = 'scaleX(0)'; pct.textContent = '0%';
        live.textContent = '已取消';
        return;
      }
      if (state !== 'idle') return;
      setState('run');
      shown = target = 0;
      bar.style.transform = 'scaleX(0)'; pct.textContent = '0%';
      live.textContent = '开始导出';
      var task = (typeof opt.run === 'function') ? opt.run : null;
      if (!task) { setState('idle'); return; }
      Promise.resolve(task(setP)).then(function () {
        setP(1, '完成');
        setTimeout(function () {
          setState('fold');
          live.textContent = '导出完成';
          clearTimeout(t);
          t = setTimeout(function () { setState('done'); }, rm ? 80 : 620);
          t = setTimeout(function () {
            setState('idle'); shown = target = 0;
            bar.style.transform = 'scaleX(0)'; pct.textContent = '0%';
            live.textContent = '';
          }, rm ? 1800 : 3600);
        }, rm ? 0 : 260);
      }).catch(function () {
        setState('idle'); shown = target = 0;
        bar.style.transform = 'scaleX(0)'; pct.textContent = '0%';
        live.textContent = '导出失败';
      });
    });
  }

  window.UX004 = { mount: mount };

  function boot() {
    var btns = document.querySelectorAll('#expAll, #expAll2, [data-ux004]');
    Array.prototype.forEach.call(btns, function (b) {
      mount(b, {
        label: b.id === 'expAll2' ? '导出全部数据' : '导出全部数据',
        done: '已保存',
        aria: '导出全部数据备份',
        run: function (setP) {
          if (typeof window.exportAllData !== 'function') {
            return Promise.reject(new Error('no export'));
          }
          return window.exportAllData(setP);
        }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('click', function () { setTimeout(boot, 60); }, true);
  try {
    new MutationObserver(function () { boot(); }).observe(document.body, { childList: true, subtree: true });
  } catch (e0) {}
})();
