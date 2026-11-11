/* notes.js —「📚 知识点笔记」：把「在所有讲义里找这个知识点」的结果存下来
   数据：qbank.lec.notes.v1 = {v:1, list:[{id,sel,why,keys,q,ts,items:[{src,name,p,score,sents:[{t,hits,w}]}]}]}
   入口：#/notes（主页「更多」或设置里也有按钮）                                          */
(function () {
  'use strict';
  var KEY = 'qbank.lec.notes.v1';
  var OPEN = {};                                    // 展开状态（只在本机内存里）

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && Array.isArray(v.list)) return v;
    } catch (e) {}
    return { v: 1, list: [] };
  }
  function write(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }

  function save(note) {
    var d = read();
    for (var i = 0; i < d.list.length; i++) {
      var x = d.list[i];
      if (x.id === note.id) return { dup: true, id: x.id };
      if (x.sel === note.sel && Math.abs((x.ts || 0) - (note.ts || 0)) < 120000) return { dup: true, id: x.id };
    }
    d.list.unshift(note);
    if (d.list.length > 300) d.list.length = 300;
    write(d);
    try { if (window.toast) toast('已存进「📚 知识点笔记」', 1800, 'ok'); } catch (e) {}
    return { ok: true, id: note.id };
  }
  function del(id) { var d = read(); d.list = d.list.filter(function (x) { return x.id !== id; }); write(d); }
  function rename(id, t) { var d = read(); d.list.forEach(function (x) { if (x.id === id) x.sel = t; }); write(d); }
  function list() { return read().list; }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mark(s, hits) {
    var h = esc(s);
    (hits || []).forEach(function (k) { if (!k) return; h = h.split(esc(k)).join('<mark>' + esc(k) + '</mark>'); });
    return h;
  }
  function fmt(ts) {
    var d = new Date(ts || Date.now()), p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function filesOf(n) {
    var o = {};
    (n.items || []).forEach(function (x) { o[x.src] = 1; });
    return Object.keys(o).length;
  }

  function cardHtml(n) {
    var open = !!OPEN[n.id];
    var h = '<div class="nt-card' + (open ? ' on' : '') + '" data-nt="' + n.id + '">'
      + '<div class="nt-head" data-nt-act="toggle" data-id="' + n.id + '">'
      + '<b>' + esc(String(n.sel || '').slice(0, 46)) + (String(n.sel || '').length > 46 ? '…' : '') + '</b>'
      + '<span>' + fmt(n.ts) + ' · ' + filesOf(n) + ' 份讲义 · ' + (n.items || []).length + ' 句</span>'
      + '<i>' + (open ? '▾' : '▸') + '</i></div>';
    if (n.q) h += '<div class="nt-q">出自：' + esc(n.q) + '</div>';
    if (n.why) h += '<div class="nt-why">💡 ' + esc(n.why) + '</div>';
    if (open) {
      if (n.sum && n.sum.length) {
        h += '<div class="nt-sum"><b>✨ AI 总结</b>';
        n.sum.forEach(function (x) {
          h += '<button class="nt-sumitem" data-nt-act="go" data-id="' + n.id + '" data-src="' + esc(x.src || '') + '" data-p="' + (x.p || 1) + '">'
            + '<i>' + esc(x.t) + '</i><u>' + esc(String(x.name || '').replace(/\.pdf$/i, '').slice(0, 16)) + (x.name ? ' · 第 ' + (x.p || 1) + ' 页' : '') + '</u></button>';
        });
        h += '</div>';
      }
      var order = [], map = {};
      (n.items || []).forEach(function (x) { if (!map[x.src]) { map[x.src] = []; order.push(x.src); } map[x.src].push(x); });
      order.sort(function (a, b) { return (map[b][0].score || 0) - (map[a][0].score || 0); });
      order.forEach(function (src) {
        var arr = map[src];
        h += '<div class="nt-grp"><b>' + esc(String(arr[0].name || '').replace(/\.pdf$/i, '').slice(0, 44)) + '</b></div>';
        arr.forEach(function (x) {
          (x.sents || []).forEach(function (s) {
            h += '<button class="nt-sent" data-nt-act="go" data-id="' + n.id + '" data-src="' + esc(x.src) + '" data-p="' + x.p + '">'
              + '<u>第 ' + x.p + ' 页</u><i>' + mark(s.t, s.hits) + '</i></button>';
          });
        });
      });
      h += '<div class="nt-acts"><button class="btn tiny" data-nt-act="del" data-id="' + n.id + '">🗑 删除</button>'
        + '<button class="btn tiny" data-nt-act="copy" data-id="' + n.id + '">⧉ 复制</button></div>';
    }
    return h + '</div>';
  }

  function render() {
    var v = document.getElementById('view');
    if (!v) return;
    var arr = list();
    var h = '<div class="card nt-wrap"><div class="sec-head"><h2>📚 知识点笔记</h2>'
      + '<span class="nt-sub">在题目里选中一句话 → 右键 →「在所有讲义里找这个知识点」→ 存成笔记</span></div>';
    if (!arr.length) {
      h += '<div class="empty">还没有笔记。<br>做题时选中题干/选项/解析里的任意一句，右键选「📚 在所有讲义里找这个知识点」，结果面板底部点「💾 存成笔记」。</div>';
    } else {
      h += '<div class="nt-list">' + arr.map(cardHtml).join('') + '</div>';
    }
    v.innerHTML = h + '</div>';
    v.querySelectorAll('[data-nt-act]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var act = b.getAttribute('data-nt-act'), id = b.getAttribute('data-id');
        var note = list().filter(function (x) { return x.id === id; })[0];
        if (!note) return;
        if (act === 'toggle') { OPEN[id] = !OPEN[id]; render(); return; }
        if (act === 'del') { if (confirm('删除这条笔记？')) { del(id); render(); } return; }
        if (act === 'copy') {
          var txt = note.sel + '\n' + (note.items || []).map(function (x) { return '· ' + x.name + ' 第 ' + x.p + ' 页'; }).join('\n');
          try { navigator.clipboard.writeText(txt); if (window.toast) toast('已复制', 1400, 'ok'); } catch (e) {}
          return;
        }
        if (act === 'go') {
          var src = b.getAttribute('data-src'), p = +b.getAttribute('data-p') || 1;
          if (window.LECTURE && LECTURE.jumpFromNote) LECTURE.jumpFromNote(note, src, p);
          else if (window.toast) toast('讲义模块没加载', 1600, 'bad');
        }
      });
    });
  }

  window.LECNOTES = { save: save, del: del, rename: rename, list: list, render: render, KEY: KEY };
})();

try { window.NOTES = window.LECNOTES; } catch (e) {}
