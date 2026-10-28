import io
p = "app.js"
s = io.open(p, encoding="utf-8").read()

ANCHOR = """window.__bigKeys = LS_BIG.slice();"""
MOD = """window.__bigKeys = LS_BIG.slice();

/* ===== 题目附件（第 ①-1 条）：答题区左侧的本地「快捷方式」 =====
   文件不上传、不进云同步：优先存 File System Access 的句柄（点开就是原文件，改了也能看到最新），
   浏览器不支持就退一步把副本放进 IndexedDB 的 att store。一个题目一条，键是 fk。 */
const ATT_TYPES = [
  { description: '文档 / 图片', accept: { 'text/html': ['.html', '.htm'], 'application/pdf': ['.pdf'], 'text/plain': ['.txt'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] } }
];
const ATT_MEM = Object.create(null);
function attIcon(name) {
  const e = String(name || '').toLowerCase().split('.').pop();
  return e === 'pdf' ? '📕' : e === 'html' || e === 'htm' ? '🌐' : e === 'txt' ? '📄'
    : e === 'docx' ? '📘' : (e === 'png' || e === 'jpg' || e === 'jpeg') ? '🖼' : '📎';
}
function attKindOk(name) { return /\\.(html?|pdf|txt|docx|png|jpe?g)$/i.test(String(name || '')); }
function attLoad(fk) {
  if (ATT_MEM[fk]) return Promise.resolve(ATT_MEM[fk]);
  return appIdbGet('att:' + fk).then(v => { ATT_MEM[fk] = Array.isArray(v) ? v : []; return ATT_MEM[fk]; },
    () => { ATT_MEM[fk] = []; return ATT_MEM[fk]; });
}
function attSet(fk, list) {
  ATT_MEM[fk] = list || [];
  return appIdbPut('att:' + fk, ATT_MEM[fk]).catch(() => {});
}
function attRailHtml(fk) {
  const list = ATT_MEM[fk] || [];
  return '<div class="attrail" id="attRail" data-fk="' + esc(fk) + '">' +
    '<button class="att-add" id="attAdd" title="给这道题挂一个本地文件（PDF / HTML / TXT / DOCX / PNG）。只在你这台设备上做个快捷方式，不上传、不同步">📎</button>' +
    (list.length ? '<div class="att-items">' + list.map((it, i) =>
      '<span class="att-chip" data-att="' + i + '" title="' + esc(it.name + (it.kind === 'handle' ? '（本地原文件）' : '（本机副本）')) + '">' +
      attIcon(it.name) + '<b>' + esc(it.name) + '</b><i class="att-x" data-attx="' + i + '" title="移除这个附件（不会删你电脑上的原文件）">×</i></span>').join('') + '</div>' : '') +
    '</div>';
}
function attPaint(fk) {
  attLoad(fk).then(list => {
    const old = document.getElementById('attRail');
    if (!old || old.dataset.fk !== String(fk)) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = attRailHtml(fk);
    old.replaceWith(tmp.firstChild);
    attBind(fk);
  });
}
function attOpenUrl(url, name, revoke) {
  const e = String(name || '').toLowerCase().split('.').pop();
  if (e === 'docx') {                     /* 浏览器不会渲染 docx：给个下载，让它用本机 Word 打开 */
    const a = document.createElement('a');
    a.href = url; a.download = name || 'document.docx';
    document.body.appendChild(a); a.click(); a.remove();
  } else {
    const w = window.open(url, '_blank');
    if (!w) toast('被浏览器拦了新窗口，允许弹窗后再点一次', 2600, 'warn');
  }
  if (revoke) setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
}
function attBind(fk) {
  const rail = document.getElementById('attRail');
  if (!rail) return;
  const add = rail.querySelector('#attAdd');
  if (add) add.onclick = () => attAdd(fk);
  rail.querySelectorAll('[data-att]').forEach(chip => {
    chip.onclick = ev => { if (ev.target.closest('[data-attx]')) return; attOpenItem(fk, +chip.dataset.att); };
  });
  rail.querySelectorAll('[data-attx]').forEach(x => {
    x.onclick = ev => {
      ev.stopPropagation();
      const i = +x.dataset.attx;
      attLoad(fk).then(list => {
        const it = list[i];
        if (!it) return;
        if (!confirm('移除附件「' + it.name + '」？只是去掉这个快捷方式，你电脑上的原文件不会动。')) return;
        list.splice(i, 1);
        attSet(fk, list).then(() => attPaint(fk));
      });
    };
  });
}
async function attAdd(fk) {
  const list = (await attLoad(fk)).slice();
  if (list.length >= 12) { toast('一道题最多挂 12 个附件', 2200, 'warn'); return; }
  /* 首选：系统文件选择器（能给到可持久保存的句柄） */
  if (window.showOpenFilePicker) {
    let handles = null;
    try { handles = await window.showOpenFilePicker({ multiple: true, types: ATT_TYPES, excludeAcceptAllOption: false }); }
    catch (e) { if (e && e.name === 'AbortError') return; }
    if (handles && handles.length) {
      for (const h of handles) {
        const f = await h.getFile();
        if (!attKindOk(f.name)) { toast('只支持 HTML / PDF / TXT / DOCX / PNG / JPG', 2600, 'warn'); continue; }
        list.push({ id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6), name: f.name, size: f.size, type: f.type, kind: 'handle', handle: h, ts: Date.now() });
      }
      await attSet(fk, list);
      attPaint(fk);
      return;
    }
  }
  /* 退路：普通 input，把文件副本存进 IndexedDB（同样不上传） */
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.html,.htm,.pdf,.txt,.docx,.png,.jpg,.jpeg';
  inp.multiple = true;
  inp.onchange = async () => {
    for (const f of Array.from(inp.files || [])) {
      if (!attKindOk(f.name)) { toast('只支持 HTML / PDF / TXT / DOCX / PNG / JPG', 2600, 'warn'); continue; }
      list.push({ id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6), name: f.name, size: f.size, type: f.type, kind: 'blob', blob: f, ts: Date.now() });
    }
    await attSet(fk, list);
    attPaint(fk);
  };
  inp.click();
}
async function attOpenItem(fk, i) {
  const list = await attLoad(fk);
  const it = list[i];
  if (!it) return;
  try {
    if (it.kind === 'handle' && it.handle) {
      const perm = it.handle.queryPermission ? await it.handle.queryPermission({ mode: 'read' }) : 'granted';
      if (perm !== 'granted') {
        const ask = it.handle.requestPermission ? await it.handle.requestPermission({ mode: 'read' }) : 'denied';
        if (ask !== 'granted') { toast('没有权限读这个文件，重新挂一次附件吧', 2600, 'warn'); return; }
      }
      const f = await it.handle.getFile();
      attOpenUrl(URL.createObjectURL(f), it.name, true);
    } else if (it.blob) {
      attOpenUrl(URL.createObjectURL(it.blob), it.name, true);
    } else {
      toast('这个附件只剩名字了（文件是你电脑上的，浏览器读不到），重新挂一次吧', 3200, 'warn');
    }
  } catch (e) {
    toast('打不开：' + (e && e.message ? e.message : '可能原文件被移走了'), 3000, 'warn');
  }
}
window.attRailHtml = attRailHtml;
window.attBind = attBind;
window.attPaint = attPaint;
window.__attLoad = attLoad;"""
assert ANCHOR in s
s = s.replace(ANCHOR, MOD, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("ok")
