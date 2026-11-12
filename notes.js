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

  function save(note, force) {
    var d = read();
    for (var i = 0; i < d.list.length; i++) {
      var x = d.list[i];
      if (x.id === note.id) {
        if (!force) return { dup: true, id: x.id };
        d.list[i] = note; write(d);
        return { ok: true, id: x.id };
      }
      if (!note.manual && x.sel === note.sel && Math.abs((x.ts || 0) - (note.ts || 0)) < 120000) return { dup: true, id: x.id };
    }
    d.list.unshift(note);
    if (d.list.length > 300) d.list.length = 300;
    write(d);
    try { if (window.toast) toast('已存进「📚 知识点笔记」', 1800, 'ok'); } catch (e) {}
    return { ok: true, id: note.id };
  }
  function del(id) { var d = read(); d.list = d.list.filter(function (x) { return x.id !== id; }); write(d); }
  function rename(id, t) { var d = read(); d.list.forEach(function (x) { if (x.id === id) x.sel = t; }); write(d); }
  function keyOf(st) {
    return (st.keys || []).map(function (x) { return String(x).toLowerCase(); }).join('/');
  }

  /* 同一知识点再存一次：更新原来那条，旧版本压进 hist（最多 5 个） */
  function saveOverview(st) {
    var o = st.ov || {}, items = [];
    (o.sections || []).forEach(function (sec) {
      (sec.paras || []).forEach(function (p) {
        (p.cites || []).forEach(function (c) {
          items.push({ src: c.src, name: c.name, p: c.p, score: 1, sents: [{ t: String(p.raw || '').slice(0, 120), hits: [] }] });
        });
      });
      (sec.items || []).forEach(function (it) {
        (it.cites || []).forEach(function (c) {
          items.push({ src: c.src, name: c.name, p: c.p, score: 1, sents: [{ t: it.t, hits: [] }] });
        });
      });
    });
    var note = {
      v: 1, id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sel: String(st.sel || '').slice(0, 200),
      why: '知识点讲解（' + (st.mode === 'chapter' ? '整章' : '标准') + '）',
      keys: st.keys || [], q: '', ts: Date.now(), items: items,
      ov: st.ov, mode: st.mode, sources: (st.sources || []).slice(0, 40)
    };
    var d = read(), k = keyOf(st), found = null;
    if (k) {
      for (var i = 0; i < d.list.length; i++) {
        if (keyOf(d.list[i]) === k) { found = d.list[i]; break; }
      }
    }
    if (found) {
      var hist = (found.hist || []).slice();
      hist.unshift({ ts: found.ts, ov: found.ov, mode: found.mode, items: found.items, sources: found.sources, edit: found.edit || '' });
      note.id = found.id;
      note.hist = hist.slice(0, 5);
      var idx = d.list.indexOf(found);
      d.list[idx] = note;
      write(d);
      return { ok: true, id: note.id, updated: true };
    }
    return save(note);
  }

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

  var EDIT = {};

  /* 正文里的 [[n]] → 可点的上标出处 */
  function chapInline(s0, sources, hits, id) {
    var out = '', re = /\[\[(\d+)\]\]/g, last = 0, m;
    while ((m = re.exec(s0))) {
      if (m.index > last) out += mark(s0.slice(last, m.index), hits);
      var n2 = +m[1], c = (sources || [])[n2 - 1];
      if (c) out += '<sup class="nt-csup" data-nt-act="go" data-id="' + id + '" data-src="' + esc(c.src) + '" data-p="' + c.p
        + '" title="' + esc(String(c.name || '') + ' · 第 ' + c.p + ' 页') + '">' + n2 + '</sup>';
      last = m.index + m[0].length;
    }
    if (last < s0.length) out += mark(s0.slice(last), hits);
    return ntLinkify(out);
  }

  /* 把 [¹](url) / [文字](url) 变成可点的链接（讲义角标、外链都走这里） */
  function ntLinkify(s0) {
    return String(s0 || '').replace(/\[([^\]<]{1,48})\]\((https?:\/\/[^)\s<>]+|#[^)\s<>]+)\)/g,
      function (m, txt, url) {
        return '<a class="nt-a" href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          + '" target="_blank" rel="noopener">' + txt + '</a>';
      });
  }

  /* 首句当结论句加粗 */
  function chapPara(t, sources, hits, id) {
    var s0 = String(t || '');
    if (/\n/.test(s0) || /!\[/.test(s0) || /\]\(/.test(s0)) {   /* 含 Markdown 链接（讲义角标）也走 md 渲染 */
      var md = ntMdBlock(s0, sources, hits, id);
      if (md) return md;
    }
    var m = /^([\s\S]{8,52}?[。；])/.exec(s0);
    if (!m || m[1].length >= s0.length) return chapInline(s0, sources, hits, id);
    return '<b class="nt-ovld">' + chapInline(m[1], sources, hits, id) + '</b>' + chapInline(s0.slice(m[1].length), sources, hits, id);
  }

  function parseEdited(raw) {
    var secs = [], cur = { h: '', paras: [] }, buf = [];
    secs._title = '';
    function flush() {
      var t = buf.join('\n').replace(/^\s+|\s+$/g, '');
      buf = [];
      if (t) cur.paras.push({ t: t });
    }
    String(raw || '').split('\n').forEach(function (ln) {
      ln = ln.replace(/\r$/, '');
      if (/^#\s+/.test(ln)) { flush(); secs._title = ln.replace(/^#\s+/, '').trim(); return; }
      if (/^##\s+/.test(ln)) {
        flush();
        if (cur.h || cur.paras.length) secs.push(cur);
        cur = { h: ln.replace(/^##\s+/, '').trim(), paras: [] };
        return;
      }
      if (!ln.trim()) { flush(); return; }   /* 空行分段：表格/图片块因此不会被拆散 */
      buf.push(ln);
    });
    flush();
    if (cur.h || cur.paras.length) secs.push(cur);
    return secs;
  }

  /* 含换行或图片的块按 Markdown 渲染（表格、图片、列表），其余仍走高亮+上标的老路径 */
  function ntMdBlock(s0, sources, hits, id) {
    if (!window.mdToHtml) return '';
    var html = '';
    try { html = window.mdToHtml(s0); } catch (e) { return ''; }
    if (!html) return '';
    html = html.replace(/\[\[(\d+)\]\]/g, function (m, n) {
      return '<sup class="nt-csup" data-nt-act="go" data-i="' + n + '">' + n + '</sup>';
    });
    return '<div class="nt-mdblock">' + ntLinkify(html) + '</div>';
  }

  function ntCaretInsert(ta, text) {
    if (!ta) return;
    var s0 = ta.selectionStart || 0, e0 = ta.selectionEnd || 0, val = ta.value;
    ta.value = val.slice(0, s0) + text + val.slice(e0);
    var pos = s0 + text.length;
    try { ta.focus(); ta.setSelectionRange(pos, pos); } catch (e) {}
    ta.dispatchEvent(new Event('input'));
  }

  function ntPrevRender(v, id) {
    var ta = v.querySelector('[data-nt-ed="' + id + '"]');
    var pv = v.querySelector('[data-nt-prev="' + id + '"]');
    if (!ta || !pv || pv.hasAttribute('hidden')) return;
    var html = '';
    try { html = window.mdToHtml ? window.mdToHtml(ta.value) : ''; } catch (e) { html = ''; }
    html = String(html || '').replace(/\[\[(\d+)\]\]/g, function (m, n) {
      return '<sup class="nt-csup" data-nt-act="go" data-i="' + n + '">' + n + '</sup>';
    });
    pv.innerHTML = html || '<i class="nt-edempty">（这里会实时显示渲染结果）</i>';
  }

  function chapEditSrc(n) {
    if (n.edit) return n.edit;            /* 改过的笔记：编辑器里放改动后的正文，别拿 AI 原文覆盖 */
    var o = n.ov || {}, out = [];
    if (o.title) out.push('# ' + o.title);
    if (o.lead) out.push(o.lead);
    (o.sections || []).forEach(function (sec) {
      out.push('## ' + (sec.h || ''));
      (sec.paras || []).forEach(function (p) { out.push(p.t); });
    });
    return out.join('\n');
  }

  function chapHtml(n) {
    var o = n.ov || {}, srcs = n.sources || [], h = '';
    var ed = n.edit ? parseEdited(n.edit) : null;
    if (!ed) {
      if (o.title) h += '<div class="nt-ovtitle">' + esc(o.title) + '</div>';
      if (o.lead) h += '<div class="nt-ovlead">' + esc(o.lead) + '</div>';
      var nsec3 = (o.sections || []).length;
      var ncite = 0;
      (o.sections || []).forEach(function (sec) { (sec.paras || []).forEach(function (pp) { ncite += (pp.cites || []).length; }); });
      h += '<div class="nt-ovmeta">' + nsec3 + ' 节 · ' + ncite + ' 处出处'
        + (o.coverage ? (' · 覆盖 ' + (o.coverage.hit || 0) + '/' + (o.coverage.total || 0) + ' 份讲义') : '')
        + '</div>';
    } else {
      h += '<div class="nt-ovedit">✏️ 已编辑（出处仍可点）</div>';
      if (ed._title) h += '<div class="nt-ovtitle">' + esc(ed._title) + '</div>';
    }
    var secs = ed || o.sections || [];
    secs.forEach(function (sec) {
      if (sec.h) h += '<div class="nt-ovh">' + esc(sec.h) + '</div>';
      (sec.paras || []).forEach(function (p) {
        h += '<p class="nt-ovp">' + chapPara(p.t, srcs, n.keys, n.id) + '</p>';
      });
      if (sec.conflict) h += '<div class="nt-ovwarn">⚠️ ' + esc(sec.conflict) + '</div>';
    });
    if (o.conflict) h += '<div class="nt-ovwarn">⚠️ 说法不一致：' + esc(o.conflict) + '</div>';
    return h;
  }

  /* 编辑区：标题 / 说明 / 标签 始终可改；正文只对「有正文」的笔记开放 */
  function edWrap(n, canBody) {
    var id = n.id;
    var h = '<div class="nt-edwrap" data-nt-wrap="' + id + '">'
      + '<div class="nt-edhead">'
      + '<label class="nt-fl"><span>标题</span><input class="nt-inp nt-inp-t" data-nt-title="' + id + '" value="' + esc(n.sel || '') + '" placeholder="这条笔记叫什么（列表里显示的就是它）"></label>'
      + '<label class="nt-fl"><span>说明</span><input class="nt-inp" data-nt-why="' + id + '" value="' + esc(n.why || '') + '" placeholder="一句话备注，比如「讲义 + 笔记整理」"></label>'
      + '<label class="nt-fl"><span>标签</span><input class="nt-inp" data-nt-keys="' + id + '" value="' + esc((n.keys || []).join('，')) + '" placeholder="用逗号分隔，会按第一个标签归组"></label>'
      + '</div>';
    if (canBody) {
      h += '<div class="nt-edtools">'
        + '<button class="btn tiny" data-nt-act="edImg" data-id="' + id + '">🖼 插入图片</button>'
        + '<button class="btn tiny" data-nt-act="edTable" data-id="' + id + '">▦ 插入表格</button>'
        + '<button class="btn tiny" data-nt-act="edPrev" data-id="' + id + '">👁 预览</button>'
        + '<input type="file" accept="image/*" class="nt-edfile" data-nt-file="' + id + '" hidden>'
        + '</div>'
        + '<textarea class="nt-edit" data-nt-ed="' + id + '" placeholder="# 标题\n\n导语一句话。\n\n## 一、小节\n正文一段。（空行分段，表格/图片可用上面的按钮插入）">' + esc(chapEditSrc(n)) + '</textarea>'
        + '<div class="nt-edprev" data-nt-prev="' + id + '" hidden></div>';
    } else {
      h += '<div class="nt-ednote">这是从讲义摘句存下的笔记，正文由那些句子组成，不能直接改字。'
        + '要自己写，点下面的「✍ 写成正文」，原摘句会保留在卡片里。</div>';
    }
    h += '<div class="nt-edbar"><span>'
      + (canBody ? '「## 小节标题」开新节，空行分段；表格/图片都是 Markdown，[[n]] 是出处编号' : '标题、说明、标签随时可改')
      + '</span>'
      + (canBody ? '' : '<button class="btn tiny" data-nt-act="toChap" data-id="' + id + '">✍ 写成正文</button>')
      + '<button class="btn tiny nt-save" data-nt-act="editSave" data-id="' + id + '">保存</button>'
      + '<button class="btn tiny" data-nt-act="editCancel" data-id="' + id + '">取消</button></div></div>';
    return h;
  }

  function cardHtml(n) {
    var open = !!OPEN[n.id];
    var h = '<div class="nt-card' + (open ? ' on' : '') + '" data-nt="' + n.id + '">'
      + '<div class="nt-head" data-nt-act="toggle" data-id="' + n.id + '">'
      + ((typeof U !== 'undefined' && U.sel) ? ('<button class="nt-pick" data-nt-pick="' + n.id + '">' + (U.picked[n.id] ? '☑' : '☐') + '</button>') : '')
      + '<b>' + esc(String(n.sel || '').slice(0, 46)) + (String(n.sel || '').length > 46 ? '…' : '') + '</b>'
      + '<span>' + fmt(n.ts) + ' · ' + (n.manual ? ('手写' + ((n.edit || '').replace(/\s/g, '').length ? ' · ' + (n.edit || '').replace(/\s/g, '').length + ' 字' : '')) : (filesOf(n) + ' 份讲义 · ' + (n.items || []).length + ' 句')) + '</span>'
      + '<i>' + (open ? '▾' : '▸') + '</i></div>';
    if (n.q) h += '<div class="nt-q">出自：' + esc(n.q) + '</div>';
    if (n.why) h += '<div class="nt-why">💡 ' + esc(n.why) + '</div>';
    if (open) {
      var isChap = !!(n.manual || (n.ov && n.ov.sections && n.ov.sections.length && n.ov.sections[0].paras));
      if (EDIT[n.id]) {
        h += edWrap(n, isChap);
      } else if (isChap) {
        {
          h += chapHtml(n);
          h += '<div class="nt-acts"><button class="btn tiny" data-nt-act="edit" data-id="' + n.id + '">✏️ 编辑</button>'
            + (n.edit && !n.manual ? '<button class="btn tiny" data-nt-act="editReset" data-id="' + n.id + '">↺ 还原 AI 原文</button>' : '')
            + ((n.hist && n.hist.length) ? '<button class="btn tiny" data-nt-act="restore" data-id="' + n.id + '">🕘 上一版（' + n.hist.length + '）</button>' : '')
            + '<button class="btn tiny" data-nt-act="del" data-id="' + n.id + '">🗑 删除</button>'
            + '<button class="btn tiny" data-nt-act="copy" data-id="' + n.id + '">⧉ 复制</button></div>';
        }
      }
      if (!isChap && n.ov && n.ov.sections && n.ov.sections.length) {
        n.ov.sections.forEach(function (sec) {
          h += '<div class="nt-ovh">' + esc(sec.h) + '</div>';
          (sec.items || []).forEach(function (it) {
            var cites = (it.cites || []).map(function (c) {
              return '<button class="nt-cite" data-nt-act="go" data-id="' + n.id + '" data-src="' + esc(c.src) + '" data-p="' + c.p + '">📖 ' + esc(String(c.name || '').slice(0, 14)) + ' · 第 ' + c.p + ' 页</button>';
            }).join('');
            h += '<div class="nt-ovli">' + esc(it.t) + cites + '</div>';
          });
          if (sec.conflict) h += '<div class="nt-ovwarn">⚠️ ' + esc(sec.conflict) + '</div>';
        });
        if (n.ov.conflict) h += '<div class="nt-ovwarn">⚠️ ' + esc(n.ov.conflict) + '</div>';
        if (n.sum && n.sum.length) {
          h += '<div class="nt-sum"><b>✨ AI 总结</b>';
          n.sum.forEach(function (x) {
            h += '<button class="nt-sumitem" data-nt-act="go" data-id="' + n.id + '" data-src="' + esc(x.src || '') + '" data-p="' + (x.p || 1) + '">'
              + '<i>' + esc(x.t) + '</i><u>' + esc(String(x.name || '').replace(/\.pdf$/i, '').slice(0, 16)) + (x.name ? ' · 第 ' + (x.p || 1) + ' 页' : '') + '</u></button>';
          });
          h += '</div>';
        }
      }
      if (!isChap) {
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
        h += '<div class="nt-acts"><button class="btn tiny" data-nt-act="edit" data-id="' + n.id + '">✏️ 改标题</button>'
          + '<button class="btn tiny" data-nt-act="toChap" data-id="' + n.id + '">✍ 写成正文</button>'
          + '<button class="btn tiny" data-nt-act="del" data-id="' + n.id + '">🗑 删除</button>'
          + '<button class="btn tiny" data-nt-act="copy" data-id="' + n.id + '">⧉ 复制</button></div>';
      }
    }
    return h + '</div>';
  }

  var U = { q: '', flt: 'all', sel: false, picked: {} };

  function subjOfName(src) {
    var m = String(src || '').match(/pdf\/([^/]+)\//);
    return m ? m[1] : '其他';
  }

  function matchQ(n, q) {
    if (!q) return true;
    var s = [n.sel, n.q, n.why].concat((n.keys || [])).join(' ') + ' ' +
      (n.items || []).map(function (x) { return (x.name || '') + ' ' + ((x.sents || []).map(function (y) { return y.t; }).join(' ')); }).join(' ');
    return s.toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }

  function render() {
    var v = document.getElementById('view');
    if (!v) return;
    var all = list();
    var subs = {};
    all.forEach(function (n) { (n.items || []).forEach(function (x) { subs[subjOfName(x.src)] = 1; }); });
    var subKeys = Object.keys(subs);
    var arr = all.filter(function (n) {
      if (!matchQ(n, U.q)) return false;
      if (U.flt === 'all') return true;
      return (n.items || []).some(function (x) { return subjOfName(x.src) === U.flt; });
    });

    var h = '<div class="card nt-wrap"><div class="sec-head"><h2>📚 知识点笔记</h2>'
      + '<span class="nt-sub">在题目里选中一句话 → 右键 →「在所有讲义里找这个知识点」→ 存成笔记</span></div>';

    /* 工具条：搜索 + 筛选 + 归组 + 批量 */
    h += '<div class="nt-bar">'
      + '<input class="nt-search" id="ntQ" placeholder="搜笔记：知识点 / 题干 / 讲义句子…" value="' + esc(U.q) + '">'
      + '<button class="btn tiny nt-new" id="ntNew">＋ 新建笔记</button>'
      + '<button class="btn tiny" id="ntGroup" title="把同一知识点的笔记归成一组">🧩 按知识点归组</button>'
      + '<button class="btn tiny" id="ntSel">' + (U.sel ? '✓ 退出选择' : '☑ 批量管理') + '</button>'
      + '</div>';
    h += '<div class="nt-chips"><button class="nt-chip' + (U.flt === 'all' ? ' on' : '') + '" data-nt-flt="all">全部 ' + all.length + '</button>';
    subKeys.forEach(function (s) {
      var c = all.filter(function (n) { return (n.items || []).some(function (x) { return subjOfName(x.src) === s; }); }).length;
      h += '<button class="nt-chip' + (U.flt === s ? ' on' : '') + '" data-nt-flt="' + esc(s) + '">' + esc(s) + ' ' + c + '</button>';
    });
    h += '</div>';

    if (U.sel) {
      h += '<div class="nt-selbar"><span>已选 <b id="ntCnt">' + Object.keys(U.picked).length + '</b> 条</span>'
        + '<button class="btn tiny" id="ntAll">全选</button>'
        + '<button class="btn tiny" id="ntDel">🗑 删除所选</button></div>';
    }

    if (!arr.length) {
      h += '<div class="empty">' + (all.length ? '没有匹配的笔记，换个关键词或筛选。' : '还没有笔记。<br>做题时选中题干/选项/解析里的任意一句，右键选「📚 在所有讲义里找这个知识点」，结果面板底部点「💾 存成笔记」；<br>也可以直接点上面的「＋ 新建笔记」自己写。') + '</div>';
    } else if (U.group) {
      var g = {}, go = [];
      arr.forEach(function (n) {
        var k = (n.keys && n.keys[0]) || (n.sel || '').slice(0, 12);
        if (!g[k]) { g[k] = []; go.push(k); }
        g[k].push(n);
      });
      go.sort(function (a, b) { return g[b].length - g[a].length; });
      go.forEach(function (k) {
        h += '<div class="nt-ghead"><b>' + esc(k) + '</b><span>' + g[k].length + ' 条</span></div>'
          + '<div class="nt-list">' + g[k].map(cardHtml).join('') + '</div>';
      });
    } else {
      h += '<div class="nt-list">' + arr.map(cardHtml).join('') + '</div>';
    }
    v.innerHTML = h + '</div>';

    var q = document.getElementById('ntQ');
    if (q) q.addEventListener('input', function () { U.q = q.value; var pos = q.selectionStart; render(); var q2 = document.getElementById('ntQ'); if (q2) { q2.focus(); q2.setSelectionRange(pos, pos); } });
    var nb = document.getElementById('ntNew');
    if (nb) nb.addEventListener('click', function () {
      var id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      var note = {
        v: 1, id: id, sel: '新笔记', why: '手动创建', keys: [], q: '', ts: Date.now(),
        manual: 1, items: [], sources: [], hist: [],
        ov: { title: '新笔记', lead: '', sections: [] }
      };
      save(note, true);
      U.group = false; U.flt = 'all'; U.q = '';
      OPEN[id] = 1; EDIT[id] = 1;
      render();
      var ta = document.querySelector('[data-nt-ed="' + id + '"]');
      if (ta) { ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }
      if (window.toast) toast('新笔记：先写标题和正文，写完点「保存」', 2200, 'ok');
    });
    var gb = document.getElementById('ntGroup');
    if (gb) gb.addEventListener('click', function () { U.group = !U.group; render(); });
    var sb = document.getElementById('ntSel');
    if (sb) sb.addEventListener('click', function () { U.sel = !U.sel; U.picked = {}; render(); });
    v.querySelectorAll('[data-nt-flt]').forEach(function (b) {
      b.addEventListener('click', function () { U.flt = b.getAttribute('data-nt-flt'); render(); });
    });
    var allb = document.getElementById('ntAll');
    if (allb) allb.addEventListener('click', function () {
      var on = Object.keys(U.picked).length < arr.length;
      U.picked = {}; if (on) arr.forEach(function (n) { U.picked[n.id] = 1; }); render();
    });
    var dlb = document.getElementById('ntDel');
    if (dlb) dlb.addEventListener('click', function () {
      var ids = Object.keys(U.picked);
      if (!ids.length) { if (window.toast) toast('还没选', 1400, 'bad'); return; }
      if (!confirm('删除选中的 ' + ids.length + ' 条笔记？')) return;
      ids.forEach(function (id) { del(id); });
      U.picked = {}; render();
    });
    v.querySelectorAll('[data-nt-pick]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = b.getAttribute('data-nt-pick');
        if (U.picked[id]) delete U.picked[id]; else U.picked[id] = 1;
        render();
      });
    });

    v.querySelectorAll('[data-nt-ed]').forEach(function (ta) {
      ta.addEventListener('input', function () { ntPrevRender(v, ta.getAttribute('data-nt-ed')); });
    });
    v.querySelectorAll('[data-nt-file]').forEach(function (fi) {
      fi.addEventListener('change', function () {
        var f = fi.files && fi.files[0]; if (!f) return;
        var id2 = fi.getAttribute('data-nt-file');
        var ta2 = v.querySelector('[data-nt-ed="' + id2 + '"]');
        if (window.toast) toast('正在压缩图片…', 1200);
        Promise.resolve(window.compressImage ? window.compressImage(f, 900, 0.8) : null).then(function (url) {
          if (!url) throw new Error('读取图片失败');
          ntCaretInsert(ta2, '\n\n![图](' + url + ')\n\n');
          ntPrevRender(v, id2);
          if (window.toast) toast('图片已插入（会一起存进笔记）', 1600, 'ok');
        }).catch(function (e) {
          if (window.toast) toast('插入图片失败：' + ((e && e.message) || e), 2200, 'bad');
        });
        fi.value = '';
      });
    });
    v.querySelectorAll('[data-nt-act]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var act = b.getAttribute('data-nt-act'), id = b.getAttribute('data-id');
        var note = list().filter(function (x) { return x.id === id; })[0];
        if (!note) return;
        if (act === 'toggle') { OPEN[id] = !OPEN[id]; render(); return; }
        if (act === 'edit') { EDIT[id] = 1; render(); return; }
        if (act === 'edImg') {
          var fi = v.querySelector('[data-nt-file="' + id + '"]'); if (fi) fi.click(); return;
        }
        if (act === 'edTable') {
          var t1 = v.querySelector('[data-nt-ed="' + id + '"]');
          ntCaretInsert(t1, (t1 && t1.value.trim() ? '\n\n' : '') + '| 项目 | 说明 |\n|---|---|\n|  |  |\n');
          ntPrevRender(v, id);
          return;
        }
        if (act === 'edPrev') {
          var pv = v.querySelector('[data-nt-prev="' + id + '"]');
          if (pv) {
            if (pv.hasAttribute('hidden')) { pv.removeAttribute('hidden'); ntPrevRender(v, id); b.textContent = '👁 收起预览'; }
            else { pv.setAttribute('hidden', ''); b.textContent = '👁 预览'; }
          }
          return;
        }
        if (act === 'editCancel') { delete EDIT[id]; render(); return; }
        if (act === 'editSave') {
          var ta = v.querySelector('[data-nt-ed="' + id + '"]');
          var ti = v.querySelector('[data-nt-title="' + id + '"]');
          var wh = v.querySelector('[data-nt-why="' + id + '"]');
          var ky = v.querySelector('[data-nt-keys="' + id + '"]');
          var ttl = ti ? String(ti.value || '').replace(/^\s+|\s+$/g, '') : '';
          if (ttl) { note.sel = ttl; note.ov = note.ov || {}; note.ov.title = ttl; }
          if (wh) note.why = String(wh.value || '');
          if (ky) note.keys = String(ky.value || '').split(/[，,\s]+/).filter(Boolean).slice(0, 12);
          if (ta) { note.edit = ta.value; note.editTs = Date.now(); }
          if (note.manual && !note.edit) { note.edit = '# ' + (note.sel || '新笔记') + '\n'; }
          save(note, true); delete EDIT[id]; OPEN[id] = 1; render();
          if (window.toast) toast('已保存', 1400, 'ok');
          return;
        }
        if (act === 'toChap') {
          note.manual = 1;
          note.ov = note.ov || { title: note.sel || '', lead: '', sections: [] };
          note.ov.title = note.ov.title || note.sel || '';
          if (!note.ov.sections) note.ov.sections = [];
          save(note, true); EDIT[id] = 1; OPEN[id] = 1; render();
          if (window.toast) toast('已切成可编辑正文（原来的摘句还在，往下看）', 2200, 'ok');
          return;
        }
        if (act === 'restore') {
          if (!note.hist || !note.hist.length) return;
          var prev = note.hist.shift();
          note.ov = prev.ov; note.mode = prev.mode;
          if (prev.items) note.items = prev.items;
          if (prev.sources) note.sources = prev.sources;
          if (prev.edit) note.edit = prev.edit; else delete note.edit;
          save(note, true); render();
          if (window.toast) toast('已回到上一版（再点可继续往前）', 1600, 'ok');
          return;
        }
        if (act === 'editReset') {
          delete note.edit; save(note, true); render();
          if (window.toast) toast('已还原成 AI 原文', 1400, 'ok');
          return;
        }
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

  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('#ntOpen');
    if (b) { location.hash = '#/notes'; }
  });
  window.__ntOpenBound = 1;

  /* 站内深链：笔记里点 #/lec/<key> 直接开讲义面板，不切页面 */
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href*="#/lec/"]') : null;
    if (!a) return;
    ev.preventDefault();
    var h = a.getAttribute('href') || '';
    var key = decodeURIComponent(h.split('#/lec/')[1] || '').split(/[?#]/)[0];
    if (!key) return;
    if (window.LECTURE && window.LECTURE.openKey) {
      try { window.LECTURE.openKey(key); } catch (e) { location.hash = '#/lec/' + key; }
    } else location.hash = '#/lec/' + key;
  }, true);

  window.LECNOTES = { save: save, saveOverview: saveOverview, del: del, rename: rename, list: list, render: render, KEY: KEY,
    search: function (q) { U.q = String(q || ''); U.flt = 'all'; U.group = false; render(); var box = document.getElementById('ntQ'); if (box) box.value = U.q; try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {} } };
})();

try { window.NOTES = window.LECNOTES; } catch (e) {}
