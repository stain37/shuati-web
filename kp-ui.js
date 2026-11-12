/* 知识点管理器 · 页面（依赖 kp.js 的 window.KP） */
(function () {
  'use strict';
  var QT = null;
  var SUBS = null;
  var S = { kps: [], tags: [], links: [], q: '', tagId: 0, showDeleted: false, open: {}, edit: null, err: '' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function toast(msg, ms, kind) { try { window.toast && window.toast(msg, ms || 1800, kind); } catch (e) {} }
  function $(sel, root) { return (root || document).querySelector(sel); }

  function load() {
    return window.KP.loadAll().then(function (all) {
      S.kps = all.kps; S.tags = all.tags; S.links = all.links;
    });
  }

  function alive(k) { return !k.is_deleted; }

  function childMap() {
    var m = {};
    S.kps.forEach(function (k) {
      if (!alive(k)) return;
      var p = k.parent_id || 0;
      (m[p] = m[p] || []).push(k);
    });
    Object.keys(m).forEach(function (p) {
      m[p].sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id; });
    });
    return m;
  }

  function tagNames(k) { return (k.tags || []).map(function (t) { return t.name; }); }

  function paint() {
    var view = document.getElementById('view');
    if (!view) return;
    var all = S.kps.filter(alive);
    var deleted = S.kps.filter(function (k) { return !alive(k); });
    var cm = childMap();
    var h = '';

    /* 题库统计：节点按名字 + 标签收题目 key，子树用并集去重；正确率按每题 tries/wrong 累加 */
    var QS = (window.KP && KP.questionStats) ? KP.questionStats() : { byTag: {}, byKey: {}, total: 0 };
    var CARDN = (window.KP && KP.cardLinks) ? KP.cardLinks() : {};
    var ownCache = {}, subCache = {}, metCache = {};
    function ownKeys(k) {
      if (ownCache[k.id]) return ownCache[k.id];
      var names = [k.name].concat(tagNames(k)), seen = {}, out = [];
      names.forEach(function (nm) {
        var key = (window.KP && KP.normTag) ? KP.normTag(nm) : String(nm || '').trim().toLowerCase();
        var slot = QS.byTag[key];
        if (!slot) return;
        slot.keys.forEach(function (qk) { if (!seen[qk]) { seen[qk] = 1; out.push(qk); } });
      });
      ownCache[k.id] = out;
      return out;
    }
    function subKeys(k) {
      if (subCache[k.id]) return subCache[k.id];
      var seen = {}, out = [];
      ownKeys(k).forEach(function (qk) { if (!seen[qk]) { seen[qk] = 1; out.push(qk); } });
      (cm[k.id] || []).forEach(function (c) {
        subKeys(c).forEach(function (qk) { if (!seen[qk]) { seen[qk] = 1; out.push(qk); } });
      });
      subCache[k.id] = out;
      return out;
    }
    function subMet(k) {
      if (metCache[k.id]) return metCache[k.id];
      var t = 0, w = 0;
      subKeys(k).forEach(function (qk) { var a = QS.byKey[qk]; if (a) { t += a.tries; w += a.wrong; } });
      var m = { q: subKeys(k).length, tries: t, wrong: w };
      metCache[k.id] = m;
      return m;
    }
    function rateText(m) {
      if (!m || !m.q) return '';
      var acc = m.tries ? Math.round((m.tries - m.wrong) * 100 / m.tries) : 0;
      return m.q + ' 题 · ' + acc + '% · 错 ' + m.wrong;
    }
    QT = { sub: subMet, text: rateText };
    SUBS = { keys: subKeys, met: subMet };
    var quad = { both: 0, blind: 0, study: 0, empty: 0 };
    var blindList = [];
    all.forEach(function (k) {
      if ((cm[k.id] || []).length) return;   /* 父节点是汇总，不参与象限 */
      var m = subMet(k), ncard = CARDN[k.id] || 0;
      if (m.q && ncard) quad.both++;
      else if (m.q) {
        quad.blind++;
        blindList.push({ name: k.name, q: m.q, wrong: m.wrong, acc: m.tries ? Math.round((m.tries - m.wrong) * 100 / m.tries) : 0 });
      } else if (ncard) quad.study++;
      else quad.empty++;
    });
    blindList.sort(function (x, y) { return y.q - x.q; });

    h += '<div class="card kpu-head">'
      + '<div class="kpu-htop"><div><b>知识点管理</b><span class="kpu-sub">把散在各处的考点收成一棵树 · 现在有 ' + all.length + ' 条</span></div>'
      + '<div class="kpu-hbtns">'
      + '<button class="btn primary" data-kpu="new">＋ 新建知识点</button>'
      + '<button class="btn" data-kpu="weakall" title="把最薄弱的几个知识点抽成一套练习">🎯 练最弱</button>'
      + '<button class="btn" data-kpu="fromtags" title="把题库里打过的标签批量变成知识点">🏷 一键导入题库标签</button>'
      + '<button class="btn" data-kpu="import">导入 CSV</button>'
      + '<button class="btn" data-kpu="export">导出</button>'
      + '</div></div>'
      + '<details class="kpu-help"' + (all.length ? '' : ' open') + '><summary>❓ 这是什么、怎么用（点开看 3 步）</summary>'
      + '<div class="kpu-help-b">'
      + '<p><b>它是什么：</b>一棵你自己整理的知识点树。每条可以有编码（像 A01.01）、摘要、标签，还能挂考点卡。</p>'
      + '<ol>'
      + '<li><b>先接现成的：</b>点「🏷 一键导入题库标签」，题库里打过的标签会变成树上的节点；同名不会重复建。</li>'
      + '<li><b>再按树整理：</b>「＋ 新建知识点」加根节点，行内「＋子」加下一层，「改」能改名字、编码、标签。</li>'
      + '<li><b>考点卡会自动出现：</b>在考点卡里点「🧩 挂到知识点」或整库一键挂，这里对应行会显示「N 张考点卡」。</li>'
      + '</ol>'
      + '<p class="kpu-help-tip">删错了不怕：删除是软删除，勾「显示已删除」能看到，点「恢复最近删除」能整批恢复。</p>'
      + '</div></details>'
      + '<div class="kpu-search">'
      + '<input id="kpuQ" class="kpu-q" placeholder="搜名称 / 摘要，两字也能搜…" value="' + esc(S.q) + '">'
      + '<select id="kpuTag" class="kpu-sel"><option value="0">全部标签</option>'
      + S.tags.map(function (t) { return '<option value="' + t.id + '"' + (S.tagId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('')
      + '</select>'
      + '<label class="kpu-chk"><input type="checkbox" id="kpuDel"' + (S.showDeleted ? ' checked' : '') + '> 显示已删除</label>'
      + (deleted.length ? '<button class="btn tiny" data-kpu="restore">恢复最近删除</button>' : '')
      + '</div>'
      + '<input type="file" id="kpuFile" accept=".csv,text/csv" hidden>'
      + (QS.total
        ? ('<div class="kpu-sum2">题库里共有 <b>' + QS.total + '</b> 道题；'
          + '有题又有考点卡 <b>' + quad.both + '</b> 个知识点，'
          + '<b class="hot">有题但没挂卡 ' + quad.blind + '</b> 个（盲区），'
          + '只挂了卡没题 ' + quad.study + ' 个，两边都空 ' + quad.empty + ' 个。</div>')
        : '')
      + (blindList.length
        ? ('<details class="kpu-blind"><summary>🔎 盲区：题库考了、但你还没挂考点卡的 ' + blindList.length + ' 个知识点</summary>'
          + '<div class="kpu-blind-body">'
          + blindList.slice(0, 12).map(function (x) {
              return '<div class="kpu-blind-row"><b>' + esc(x.name) + '</b><i>' + x.q + ' 题 · ' + x.acc + '% · 错 ' + x.wrong + '</i></div>';
            }).join('')
          + (blindList.length > 12 ? '<div class="kpu-blind-more">还有 ' + (blindList.length - 12) + ' 个，先做上面这些</div>' : '')
          + '</div></details>')
        : '')
      + '</div>';

    if (S.err) h += '<div class="card kpu-err">' + esc(S.err) + '</div>';

    if (S.edit) h += editHtml();

    /* 搜索结果：平铺 */
    if (S.q.trim() || S.tagId) {
      var rows = window.KP.search({ kps: S.kps, links: S.links }, S.q, { tagId: S.tagId || 0, includeDeleted: S.showDeleted });
      h += '<div class="card kpu-list">' + (rows.length ? rows.map(function (k) { return rowHtml(k, 0); }).join('') : '<div class="empty">没有匹配的知识点</div>') + '</div>';
    } else {
      h += all.length
        ? ('<div class="card kpu-list">' + treeHtml(cm, 0, null, 0) + '</div>')
        : '<div class="card kpu-empty">'
          + '<b>还没有知识点</b>'
          + '<p>第一次用，建议从「一键导入题库标签」开始——题库里打过的标签会直接变成这棵树；也可以手动新建。</p>'
          + '<div class="kpu-empty-btns">'
          + '<button class="btn primary" data-kpu="fromtags">🏷 一键导入题库标签</button>'
          + '<button class="btn" data-kpu="new">＋ 手动新建一个</button>'
          + '</div></div>';
    }
    view.innerHTML = h;
    bind();
  }

  function treeHtml(cm, parent, acc, depth) {
    var list = cm[parent] || [];
    if (!list.length) return parent === 0 ? '<div class="empty">还没有知识点，点右上角「＋ 新建」或导入 CSV</div>' : '';
    return list.map(function (k) {
      var kids = cm[k.id] || [];
      var open = !!S.open[k.id];
      var out = rowHtml(k, depth, kids.length, open);
      if (open && kids.length) out += treeHtml(cm, k.id, acc, depth + 1);
      return out;
    }).join('');
  }

  function rowHtml(k, depth, kidCount, open) {
    var kids = (childMap()[k.id] || []).length;
    var n = kidCount == null ? kids : kidCount;
    var tags = tagNames(k);
    return '<div class="kpu-row' + (k.is_deleted ? ' del' : '') + '" data-id="' + k.id + '" style="padding-left:' + (10 + depth * 18) + 'px">'
      + (n ? '<button class="kpu-caret" data-kpu="toggle" data-id="' + k.id + '">' + (open ? '▾' : '▸') + '</button>' : '<span class="kpu-caret ph"></span>')
      + '<div class="kpu-main"><div class="kpu-name">' + esc(k.name)
      + (k.code ? '<i class="kpu-code">' + esc(k.code) + '</i>' : '')
      + (n ? '<i class="kpu-kids">' + n + ' 子项</i>' : '')
      + ((QT && QT.text(QT.sub(k))) ? '<i class="kpu-stat">' + QT.text(QT.sub(k)) + '</i>' : '')
      + ((window.KP && KP.cardLinks && KP.cardLinks()[k.id]) ? '<i class="kpu-cards">' + KP.cardLinks()[k.id] + ' 张考点卡</i>' : '')
      + (k.is_deleted ? '<i class="kpu-dead">已删除</i>' : '')
      + '</div>'
      + (k.summary ? '<div class="kpu-sum">' + esc(k.summary.slice(0, 80)) + '</div>' : '')
      + (tags.length ? '<div class="kpu-tags">' + tags.map(function (t) { return '<i>' + esc(t) + '</i>'; }).join('') + '</div>' : '')
      + '</div>'
      + '<div class="kpu-acts">'
      + '<button class="btn tiny" data-kpu="practice" data-id="' + k.id + '" title="把这块子树里的题抽出来练一遍">练</button>'
      + '<button class="btn tiny" data-kpu="edit" data-id="' + k.id + '">改</button>'
      + (k.is_deleted ? '' : '<button class="btn tiny" data-kpu="addkid" data-id="' + k.id + '">＋子</button>')
      + (k.is_deleted ? '' : '<button class="btn tiny danger" data-kpu="del" data-id="' + k.id + '">删</button>')
      + '</div></div>';
  }

  function editHtml() {
    var e = S.edit;
    var isNew = !e.id;
    var cur = e.id ? S.kps.find(function (k) { return k.id === e.id; }) : null;
    var opts = '<option value="0">（顶层）</option>' + S.kps.filter(function (k) {
      return alive(k) && (!cur || k.id !== cur.id);
    }).map(function (k) {
      return '<option value="' + k.id + '"' + ((e.parentId || 0) === k.id ? ' selected' : '') + '>' + esc(k.name) + '</option>';
    }).join('');
    return '<div class="card kpu-edit">'
      + '<b>' + (isNew ? '新建知识点' : '编辑：' + esc(cur ? cur.name : '')) + '</b>'
      + '<div class="kpu-grid">'
      + '<label>名称<input id="kpuN" value="' + esc(e.name || '') + '" placeholder="例如：急性阑尾炎"></label>'
      + '<label>编码<input id="kpuC" value="' + esc(e.code || '') + '" placeholder="可留空，存活行里唯一"></label>'
      + '<label>父节点<select id="kpuP">' + opts + '</select></label>'
      + '<label>排序<input id="kpuS" type="number" value="' + (e.sort || 0) + '"></label>'
      + '<label class="wide">摘要<textarea id="kpuM" rows="3" placeholder="一句话定义 / 机制 / 判据">' + esc(e.summary || '') + '</textarea></label>'
      + '<label class="wide">标签（用 | 或空格分隔）<input id="kpuT" value="' + esc((e.tags || []).join(' | ')) + '"></label>'
      + '</div>'
      + '<div class="kpu-ebtns">'
      + '<button class="btn primary" data-kpu="save">保存</button>'
      + '<button class="btn" data-kpu="cancel">取消</button>'
      + (cur && alive(cur) ? '<button class="btn danger" data-kpu="del" data-id="' + cur.id + '">删除</button>' : '')
      + '</div></div>';
  }

  function readForm() {
    var e = S.edit || {};
    return {
      name: ($('#kpuN') || {}).value || '',
      code: ($('#kpuC') || {}).value || '',
      parentId: Number(($('#kpuP') || {}).value || 0) || null,
      sort: Number(($('#kpuS') || {}).value || 0) || 0,
      summary: ($('#kpuM') || {}).value || '',
      tags: String((($('#kpuT') || {}).value) || '').split(/[|,，;；\s]+/).filter(Boolean)
    };
  }

  function bind() {
    var view = document.getElementById('view');
    view.onclick = function (ev) {
      var b = ev.target.closest('[data-kpu]');
      if (!b) return;
      var act = b.getAttribute('data-kpu');
      var id = Number(b.getAttribute('data-id') || 0);
      if (act === 'toggle') { S.open[id] = !S.open[id]; paint(); return; }
      if (act === 'weakall') {
        if (typeof makePaper !== 'function') { toast('出题模块没加载，刷新一次再试', 2000); return; }
        var qs2 = (window.KP && KP.questionStats) ? KP.questionStats() : null;
        if (!qs2) return;
        var rows = Object.keys(qs2.byKey).map(function (qk) {
          var a = qs2.byKey[qk] || { tries: 0, wrong: 0 };
          var rate = a.tries ? (a.tries - a.wrong) / a.tries : 0.5;
          return { qk: qk, score: rate * (a.tries ? 1 : 0.8) };
        }).sort(function (a, b) { return a.score - b.score; });
        var take = rows.slice(0, 30).map(function (x) { return x.qk; });
        if (!take.length) { toast('题库里还没有作答记录', 2000); return; }
        toast('按最薄弱抽 ' + take.length + ' 题', 1800);
        makePaper('薄弱点练习 · ' + take.length + ' 题', take);
        return;
      }
      if (act === 'practice') {
        var kp = S.kps.find(function (x) { return x.id === id; });
        if (!kp) return;
        var keys = SUBS ? SUBS.keys(kp) : [];
        if (!keys.length) { toast('这个知识点下还没有题（先给题目打上同名标签）', 2400); return; }
        var qs = (window.KP && KP.questionStats) ? KP.questionStats() : null;
        var score = function (qk) {
          var a = qs && qs.byKey && qs.byKey[qk];
          if (!a || !a.tries) return 0.5;           /* 没做过：排中间偏前 */
          return (a.tries - a.wrong) / a.tries;
        };
        var picked = keys.slice().sort(function (a, b) { return score(a) - score(b); }).slice(0, Math.min(30, keys.length));
        if (typeof makePaper !== 'function') { toast('出题模块没加载，刷新一次再试', 2000); return; }
        toast('从「' + kp.name + '」抽 ' + picked.length + ' 题（最弱的先来）', 2000);
        makePaper('知识点练习 · ' + kp.name + ' · ' + picked.length + ' 题', picked);
        return;
      }
      if (act === 'new') { S.edit = { name: '', code: '', parentId: null, tags: [] }; S.err = ''; paint(); return; }
      if (act === 'fromtags') {
        window.KP.fromBankTags().then(function (r) {
          toast(r.total ? ('题库标签共 ' + r.total + ' 个，新建 ' + r.created + ' 个（同名跳过）') : '题库里还没有标签', 2600);
          return load();
        }).then(paint).catch(function (e) { toast('导入失败：' + e.message, 2600); });
        return;
      }
      if (act === 'addkid') {
        var p = S.kps.find(function (k) { return k.id === id; });
        S.edit = { name: '', code: '', parentId: id, tags: [] }; S.err = ''; paint(); return;
      }
      if (act === 'edit') {
        var k = S.kps.find(function (x) { return x.id === id; });
        if (!k) return;
        S.edit = { id: id, name: k.name, code: k.code, parentId: k.parent_id || null, sort: k.sort_order, summary: k.summary, tags: tagNames(k) };
        S.err = ''; paint(); return;
      }
      if (act === 'cancel') { S.edit = null; S.err = ''; paint(); return; }
      if (act === 'save') {
        var f = readForm();
        var p = S.edit.id ? window.KP.update(S.edit.id, f) : window.KP.create(f);
        p.then(function () { S.edit = null; S.err = ''; return load(); }).then(paint).catch(function (e) { S.err = e.message; paint(); });
        return;
      }
      if (act === 'del') {
        var k2 = S.kps.find(function (x) { return x.id === id; });
        var kids = window.KP.aliveChildren({ kps: S.kps }, id).length;
        var mode = 'leaf';
        if (kids) {
          if (!confirm('「' + k2.name + '」下面还有 ' + kids + ' 个子节点。\n\n整棵一起删？（恢复时可以一起恢复）')) return;
          mode = 'cascade';
        } else if (!confirm('删除「' + k2.name + '」？')) return;
        window.KP.softDelete(id, mode).then(function (r) {
          if (S.edit && S.edit.id === id) S.edit = null;
          toast('已删除 ' + r.n + ' 条；点「恢复最近删除」可整批找回', 2200);
          return load();
        }).then(paint).catch(function (e) { S.err = e.message; paint(); });
        return;
      }
      if (act === 'restore') {
        var stamp = null;
        S.kps.forEach(function (k) { if (k.deleted_at && (!stamp || k.deleted_at > stamp)) stamp = k.deleted_at; });
        if (!stamp) return toast('没有可恢复的删除');
        window.KP.restoreStamp(stamp).then(function (n) { toast('恢复了 ' + n + ' 条', 1800, 'ok'); return load(); }).then(paint).catch(function (e) { S.err = e.message; paint(); });
        return;
      }
      if (act === 'import') { var f2 = document.getElementById('kpuFile'); if (f2) f2.click(); return; }
      if (act === 'export') {
        window.KP.exportJSON().then(function (data) {
          var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'knowledge-points-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        });
        return;
      }
    };

    var q = document.getElementById('kpuQ');
    if (q) {
      q.oninput = function () { S.q = q.value; paint(); var el = document.getElementById('kpuQ'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
    }
    var tg = document.getElementById('kpuTag');
    if (tg) tg.onchange = function () { S.tagId = Number(tg.value || 0); paint(); };
    var dl = document.getElementById('kpuDel');
    if (dl) dl.onchange = function () { S.showDeleted = dl.checked; paint(); };
    var file = document.getElementById('kpuFile');
    if (file) {
      file.onchange = function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          window.KP.importCSV(String(rd.result), f.name).then(function (res) {
            var b = res.batch || {};
            toast((res.reused ? '同一份文件已导入过，直接复用上次结果（' : '导入完成：')
              + '新增 ' + (b.ok_rows || 0) + ' 条，失败 ' + (b.failed_rows || 0) + ' 行）', 3200);
            return load();
          }).then(paint).catch(function (e) { S.err = '导入失败：' + e.message; paint(); });
        };
        rd.readAsText(f, 'utf-8');
        file.value = '';
      };
    }
  }

  window.KPUI = {
    render: function () {
      var view = document.getElementById('view');
      if (view) view.innerHTML = '<div class="card"><div class="empty">正在打开知识点库…</div></div>';
      load().then(paint).catch(function (e) {
        if (view) view.innerHTML = '<div class="card"><div class="empty">知识点库打不开：' + esc(e.message) + '</div></div>';
      });
    }
  };
  /* 直接打开 #/kp 时，app.js 的首次路由可能比这里先跑（那时还没有 KPUI），补一次 */
  try { if (location.hash.indexOf('#/kp') === 0) window.KPUI.render(); } catch (e) {}
})();
