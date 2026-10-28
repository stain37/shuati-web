import io
p = "cat.js"
s = io.open(p, encoding="utf-8").read()

# 1) sechead 加「合并题库」按钮
a1 = """      + (withChat ? '<button class="btn small" data-act="chatAll" title="把当前目录（含子目录）的题库都加进 AI 对话">💬 全部加进对话</button>' : '')"""
b1 = """      + (withChat ? '<button class="btn small" data-act="chatAll" title="把当前目录（含子目录）的题库都加进 AI 对话">💬 全部加进对话</button>' : '')
      + (withChat ? '<button class="btn small" data-act="mergebanks" title="把几个题库合成一个（同一道题只留一份；作答 / 收藏 / 解析 / 口诀跟着题一起搬）">⇄ 合并题库</button>' : '')"""
assert a1 in s
s = s.replace(a1, b1, 1)

# 2) 合并逻辑：追加在 deleteBanksPublic 之前
a2 = """  function deleteBanksPublic(ids) {"""
b2 = """  /* 一键合并题库：选一个「主题库」，其余题库的题并进去；每道题的作答 / 收藏 /
     自定义解析 / 口诀都按新键搬过去（bankId#qid 变了，不搬就等于丢），同题干的去重。 */
  function mergeBanksFlow() {
    if (typeof LOCAL === 'undefined' || !Array.isArray(LOCAL) || LOCAL.length < 2) { T('至少要有两个题库才能合并'); return; }
    BFUI.pick({
      title: '合并题库：先选「主题库」',
      desc: '其它被选中的题库会并进它，然后整体消失。题目上的作答记录、收藏、解析、口诀会跟着题一起搬过去。',
      items: LOCAL.map(function (b) {
        return { label: TITLE(b), note: ((b.questions || []).length) + ' 题', value: b.id };
      })
    }).then(function (id) { if (id) mergePickSources(id); });
  }
  function mergePickSources(targetId) {
    var t = bankOf(targetId); if (!t) return;
    var others = (LOCAL || []).filter(function (b) { return b.id !== targetId; });
    if (!others.length) { T('没有别的题库可以并进来'); return; }
    var mask = document.createElement('div');
    mask.className = 'mask bfMask';
    var sheet = document.createElement('div');
    sheet.className = 'sheet bfSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.innerHTML = '<h3 class="bfTitle">并进「' + E(TITLE(t)) + '」的题库</h3>'
      + '<div class="hint bfDesc">勾选的题库会把题目交给「' + E(TITLE(t)) + '」，然后整个题库消失（不可撤销，建议先导出备份）。</div>'
      + '<div class="mkList">' + others.map(function (b, i) {
        return '<label class="mkRow"><input type="checkbox" data-mksrc="' + E(b.id) + '"><span class="mkT">' + E(TITLE(b)) + '</span>'
          + '<span class="mkN">' + ((b.questions || []).length) + ' 题</span></label>';
      }).join('') + '</div>'
      + '<div class="actions"><button class="btn primary" data-mkok="1">合并</button><button class="btn" data-mkno="1">取消</button></div>';
    mask.appendChild(sheet);
    document.body.appendChild(mask);
    void mask.offsetWidth;
    mask.classList.add('show');
    function close() { mask.classList.remove('show'); setTimeout(function () { mask.remove(); }, 180); }
    sheet.querySelector('[data-mkno]').onclick = close;
    mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
    sheet.querySelector('[data-mkok]').onclick = function () {
      var ids = Array.prototype.slice.call(sheet.querySelectorAll('[data-mksrc]:checked')).map(function (x) { return x.dataset.mksrc; });
      if (!ids.length) { T('先勾一个题库'); return; }
      close();
      doMergeBanks(targetId, ids);
    };
  }
  function doMergeBanks(targetId, srcIds) {
    var t = bankOf(targetId); if (!t) return;
    if (!Array.isArray(t.questions)) t.questions = [];
    var moved = 0, dedupe = 0, total = 0;
    srcIds.forEach(function (sid) {
      var s = bankOf(sid); if (!s) return;
      (s.questions || []).forEach(function (q) {
        total++;
        var stemN = String(q.stem || '').trim();
        var dup = t.questions.some(function (x) { return String(x.stem || '').trim() === stemN; });
        if (dup) { dedupe++; return; }
        var qq = JSON.parse(JSON.stringify(q));
        var oldK = s.id + '#' + q.id;
        if (t.questions.some(function (x) { return String(x.id) === String(qq.id); })) {
          qq.id = String(qq.id) + '-m' + Math.random().toString(36).slice(2, 5);   /* 题号撞了换一个 */
        }
        var newK = t.id + '#' + qq.id;
        [['ans', ANS], ['fav', FAV], ['note', NOTES], ['qtn', (typeof QTN !== 'undefined' ? QTN : null)]].forEach(function (pair) {
          var name = pair[0], box = pair[1];
          if (!box || box[oldK] == null) return;
          box[newK] = box[oldK];
          delete box[oldK];
          if (typeof tombDel === 'function') tombDel(name, oldK);   /* 旧键的删除墓碑别把新键也压住 */
        });
        if (t.paper == null && s.paper != null) t.paper = s.paper;
        t.questions.push(qq);
        moved++;
      });
    });
    LOCAL = (LOCAL || []).filter(function (b) { return srcIds.indexOf(b.id) < 0; });
    try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
    if (typeof invalidateBanks === 'function') invalidateBanks();
    try { if (typeof saveAns === 'function') saveAns(); } catch (e) {}
    try { if (typeof saveFav === 'function') saveFav(); } catch (e) {}
    try { if (typeof saveNotes === 'function') saveNotes(); } catch (e) {}
    try { if (typeof saveQtn === 'function') saveQtn(); } catch (e) {}
    notifyFile();
    T('合并完成：搬进 ' + moved + ' 题' + (dedupe ? '，跳过重复 ' + dedupe + ' 题' : '') + (total !== moved + dedupe ? '，异常 ' + (total - moved - dedupe) + ' 题' : ''), 3200, 'ok');
    repaint();
  }
  function deleteBanksPublic(ids) {"""
assert a2 in s
s = s.replace(a2, b2, 1)

# 3) 事件分发
a3 = """        else if (v === 'del') askDelBank(id);"""
b3 = """        else if (v === 'del') askDelBank(id);
        else if (v === 'mergebanks') mergeBanksFlow();"""
assert a3 in s
s = s.replace(a3, b3, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
