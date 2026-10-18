/* ============================================================
   刷题站 · collection.js
   错题本 / 收藏 / 统计 / 批量操作 / 套卷 / 自定义解析 / 导出
   依赖 app.js 的全局：ANS FAV NOTES SET allBanks baseBanks esc $ on toast download
   ============================================================ */

/* ---------------- Markdown 渲染 ---------------- */
/* 颜色 / 高亮支持：Markdown 本身没颜色，这里支持三种写法（渲染成安全的内联样式，不放开任意 HTML）：
     <font color="red">红字</font>         → 红字
     <span style="color:red">红字</span>   → 红字
     ==高亮==                              → 黄色高亮（<mark>）
   颜色值只收颜色名（red/green/…）或 #hex；其它一律按原文显示，不会执行任何脚本。 */
const MD_C_OPEN = '\u0001C', MD_C_END = '\u0001', MD_C_CLOSE = '\u0001/C\u0001';
const MD_H_OPEN = '\u0001H\u0001', MD_H_CLOSE = '\u0001/H\u0001';
function mdValidColor(c) {
  c = String(c || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(c) || /^[a-zA-Z]{2,20}$/.test(c);
}
function mdColorize(s) {
  s = s.replace(/==([^=\n](?:[^\n]*?[^=\n])?)==/g, (m, t) => MD_H_OPEN + t + MD_H_CLOSE);
  s = s.replace(/<font\s+color\s*=\s*["']?\s*([^\s"'>]+)\s*["']?\s*>\s*([\s\S]*?)\s*<\/font\s*>/gi, (m, c, inner) =>
    mdValidColor(c) ? (MD_C_OPEN + c.trim() + MD_C_END + inner + MD_C_CLOSE) : m);
  s = s.replace(/<span\s+style\s*=\s*["']?\s*color\s*:\s*([^\s;"'>]+)[^>]*>\s*([\s\S]*?)\s*<\/span\s*>/gi, (m, c, inner) =>
    mdValidColor(c) ? (MD_C_OPEN + c.trim() + MD_C_END + inner + MD_C_CLOSE) : m);
  return s;
}
function mdColorEnd(html) {
  return String(html)
    .replace(/\u0001C([^\u0001]+)\u0001/g, '<span style="color:$1">')
    .replace(/\u0001\/C\u0001/g, '</span>')
    .replace(/\u0001H\u0001/g, '<mark>')
    .replace(/\u0001\/H\u0001/g, '</mark>');
}
/* 反斜杠转义：让用户打的 * _ ` [ ] = < 这些符号不会被当成格式（方案十的就地编辑器要用）。
   先把 \x 换成占位符（渲染全程不参与匹配），最后一步再还原成字面量。 */
function mdEscOpen(s) {
  return String(s).replace(/\\([\\*_`\[\]=<>#\-+.])/g, (m, c) => '\u0002' + c.charCodeAt(0).toString(36) + '\u0002');
}
function mdEscEnd(html) {
  return String(html).replace(/\u0002([0-9a-z]{1,3})\u0002/g, (m, code) => {
    const ch = String.fromCharCode(parseInt(code, 36));
    return ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch;
  });
}
/* 修「记号点重了」攒出来的垃圾：浮条连记号一起选中再加粗，**A** 会攒成 ****A**** / ******A******（
   每点一次多一对）。渲染前把 3 个以上的同种记号收成一个正常记号（本应用的 mdToHtml 只认 ** 和 *，
   三颗星它也渲染不出来，只会显示成星号）。 */
function mdTidy(s) {
  return String(s == null ? '' : s)
    .replace(/＊/g, '*')          /* 全角星号（中文输入法打的）先归一到半角，不然下面所有规则都认不到它 */
    .replace(/\*{4,}/g, '**')
    .replace(/={4,}/g, '==')
    .replace(/`{4,}/g, '`');
}
/* 代码块：先把围栏整块抽出来（换成占位符），再走 Markdown 流程。
   不先抽的话，围栏里的 * _ == ` 会被后面的格式规则改掉。
   图类（diagram / mermaid / mindmap）交给 diagram.js 渲染成 SVG；
   其它语言、或解析失败，原样收进 <pre>，内容一个字不丢。 */
const MD_FENCE = '\u0004';
function mdEscCode(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdFenceHtml(lang, body) {
  const l = String(lang || '').toLowerCase();
  if (window.DIAGRAM && (l === 'diagram' || l === 'mermaid' || l === 'mindmap' || l === 'mind')) {
    try {
      const r = window.DIAGRAM.render(l === 'mind' ? 'mindmap' : l, body);
      if (r && r.html) return r.html;
    } catch (e) {}
  }
  return '<pre class="md-pre"><code>' + mdEscCode(body) + '</code></pre>';
}
function mdFences(md) {
  const fences = [];
  const txt = String(md).replace(/^[ \t]*`{3,}([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^[ \t]*`{3,}[ \t]*$/gm,
    (m, lang, body) => {
      fences.push({ lang: lang, body: body.replace(/\s+$/, '') });
      return MD_FENCE + 'F' + (fences.length - 1) + MD_FENCE;
    });
  return { txt: txt, fences: fences };
}
function mdFencesBack(html, fences) {
  if (!fences || !fences.length) return html;
  const put = (i) => mdFenceHtml(fences[i].lang, fences[i].body);
  return String(html)
    .replace(new RegExp('<p>\\s*' + MD_FENCE + 'F(\\d+)' + MD_FENCE + '\\s*</p>', 'g'), (m, i) => put(+i))
    .replace(new RegExp(MD_FENCE + 'F(\\d+)' + MD_FENCE, 'g'), (m, i) => put(+i));
}
function mdToHtml(md) {
  if (!md) return '';
  const F = mdFences(md);
  md = F.txt;
  md = mdTidy(md);
  let s = esc(mdColorize(mdEscOpen(md)));
  s = s.replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+|[^)\s]+)\)/g, (m, a, u) => `<img alt="${a}" src="${u}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
    /^(https?:|data:|\/|#)/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `${t}（${u}）`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');   /* 三颗星 = 加粗+斜体（标准 Markdown） */
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  /* 配对完还剩的 ** 记号 = 历史残渣（加粗点重了攒出来的），别让它显示成一串星号。
     整行的 *** 是分隔线，先变成 --- 再清，免得误伤。 */
  s = s.replace(/^(\s*)\*{3,}\s*$/gm, '$1---');
  s = s.replace(/\*{2,}/g, '');
  s = s.replace(/＊{2,}/g, '');      /* 全角星号成串的（旧数据）也别显示 */
  /* 落单的单星号（斜体只配了一半）也清掉：先把 2*3 这种乘法的星号藏起来，清完再换回去。
     到这里为止配好的记号早就变成 <strong>/<em> 了，剩下的星号全是残渣。 */
  for (let i = 0; i < 3; i++) s = s.replace(/(\d)\*(\d)/g, '$1\uE000$2');
  s = s.replace(/\*/g, '');
  s = s.replace(/\uE000/g, '*');
  const lines = s.split(/\r?\n/);
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { closeList(); continue; }
    let m;
    /* 表格：本行含 | 且下一行是分隔行  | a | b |\n| --- | --- | */
    if (t.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeList();
      const header = splitRow(t);
      const aligns = splitRow(lines[i + 1]).map(c => {
        const l = c.trim().charAt(0) === ':', r = c.trim().slice(-1) === ':';
        return (l && r) ? 'center' : (r ? 'right' : 'left');
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) { rows.push(splitRow(lines[i])); i++; }
      i--;
      out.push(renderTable(header, rows, aligns));
      continue;
    }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) { closeList(); const n = m[1].length + 2; out.push(`<h${n}>${m[2]}</h${n}>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { closeList(); out.push('<hr>'); continue; }
    if ((m = t.match(/^&gt;\s?(.*)$/))) { closeList(); out.push(`<blockquote>${m[1]}</blockquote>`); continue; }
    if ((m = t.match(/^[-*+]\s+(.*)$/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${m[1]}</li>`); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${m[1]}</li>`); continue; }
    if (/^<img\s/.test(t)) { closeList(); out.push(t); continue; }
    closeList(); out.push(`<p>${t}</p>`);
  }
  closeList();
  return mdFencesBack(mdEscEnd(mdColorEnd(out.join('\n'))), F.fences);
}

/* 表格辅助 */
function splitRow(line) {
  let s = line.trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.slice(-1) === '|') s = s.slice(0, -1);
  return s.split('|').map(x => x.trim());
}
function isTableSep(line) {
  let s = String(line).trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.slice(-1) === '|') s = s.slice(0, -1);
  if (!s.trim()) return false;
  return s.split('|').every(c => /^\s*:?-{1,}:?\s*$/.test(c));
}
function renderTable(header, rows, aligns) {
  const st = i => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '');
  const n = header.length;
  const head = '<tr>' + header.map((c, i) => `<th${st(i)}>${c || ''}</th>`).join('') + '</tr>';
  const body = rows.map(r => '<tr>' + header.map((_, i) => `<td${st(i)}>${r[i] == null ? '' : r[i]}</td>`).join('') + '</tr>').join('');
  return `<div class="tbl-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/* ---------------- 图片 ---------------- */
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('读取失败'));
    fr.readAsDataURL(file);
  });
}
async function compressImage(file, maxW, quality) {
  maxW = maxW || 1100; quality = quality || 0.82;
  const raw = await fileToDataURL(file);
  if (/image\/gif/i.test(file.type || '')) return raw;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('图片解码失败'));
      i.src = raw;
    });
    const scale = Math.min(1, maxW / (img.width || maxW));
    if (scale >= 1 && raw.length < 250 * 1024) return raw;
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = c.toDataURL('image/jpeg', quality);
    return out.length < raw.length ? out : raw;
  } catch (e) { return raw; }
}

/* ---------------- 解析编辑器 ---------------- */
let ED = null;

/* §9：选中文字弹「Notion 式」小浮条 —— 只往 Markdown 里插语法，存储格式一个字没改。
   浮条是 fixed 定位、挂在 body 上（编辑器重画也不受影响），按钮上 mousedown 会 preventDefault，
   这样点按钮时 textarea 不会失焦、选区不丢。 */
const FMT_COLORS = [['red', '红'], ['#f97316', '橙'], ['green', '绿'], ['#2563eb', '蓝'], ['#7c3aed', '紫'], ['gray', '灰']];
let FMT_EL = null, FMT_TA = null, FMT_DOC = false;
function fmtBarEl() {
  if (FMT_EL && FMT_EL.isConnected) return FMT_EL;
  const bar = document.createElement('div');
  bar.className = 'fmt-bar';
  bar.hidden = true;
  bar.innerHTML =
    '<button type="button" data-fmt="b" title="加粗（**文字**）"><b>B</b></button>' +
    '<button type="button" data-fmt="i" title="斜体（*文字*）"><i>I</i></button>' +
    '<button type="button" data-fmt="c" title="行内代码（`文字`）">&lt;/&gt;</button>' +
    '<button type="button" data-fmt="h" title="高亮（==文字==）">▨</button>' +
    '<span class="fmt-sep"></span>' +
    FMT_COLORS.map(c => '<button type="button" class="fmt-dot" data-color="' + c[0] + '" title="改成' + c[1] + '色"><i style="background:' + c[0] + '"></i></button>').join('') +
    '<span class="fmt-sep"></span>' +
    '<button type="button" data-fmt="none" title="清除选中文字上的格式">✕</button>';
  document.body.appendChild(bar);
  FMT_EL = bar;
  return bar;
}
function fmtBarHide() { if (FMT_EL) FMT_EL.hidden = true; }
function fmtPlace(bar, x, y) {
  bar.hidden = false;
  const r = bar.getBoundingClientRect(), pad = 8;
  let left = Math.min(Math.max(pad, x - r.width / 2), Math.max(pad, window.innerWidth - r.width - pad));
  let top = y - r.height - 10;
  if (top < pad) top = Math.min(y + 18, window.innerHeight - r.height - pad);
  bar.style.left = Math.round(left) + 'px';
  bar.style.top = Math.round(top) + 'px';
}
/* 把选中的文字用 open/close 包起来；open 为空是「清除格式」；已经包着的再点一下就脱掉 */
function fmtWrap(ta, open, close, refresh) {
  let s = ta.selectionStart, e = ta.selectionEnd;
  if (s == null || e == null || s === e) return false;
  let v = ta.value, sel = v.slice(s, e);
  let nv, ns, ne;
  if (!open) {
    /* 往外剥一层：选区正好被一对记号夹着。刚点过色点 / 加粗，接着点 ✕ 就是这种情况 ——
       这时选区里的字本身是干净的，不往外剥就等于「点了没反应」。 */
    const before = v.slice(Math.max(0, s - 48), s);
    const mf = /<font\s+color=["']?[^"'>]+["']?\s*>$/.exec(before);
    if (mf && v.slice(e, e + 7).toLowerCase() === '</font>') { s -= mf[0].length; e += 7; sel = v.slice(s, e); }
    else {
      const pairs = [['**', '**'], ['==', '=='], ['`', '`'], ['*', '*']];
      for (let i = 0; i < pairs.length; i++) {
        const op = pairs[i][0], cl = pairs[i][1];
        if (v.slice(s - op.length, s) === op && v.slice(e, e + cl.length) === cl) {
          s -= op.length; e += cl.length; sel = v.slice(s, e); break;
        }
      }
    }
    const plain = sel
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/==([\s\S]+?)==/g, '$1')
      .replace(/`([\s\S]+?)`/g, '$1').replace(/\*([^*\n]+?)\*/g, '$1')
      .replace(/<font\s+color=["']?[^"'>]+["']?\s*>([\s\S]*?)<\/font>/gi, '$1')
      .replace(/<span\s+style=["']?\s*color:[^"'>]+["']?\s*>([\s\S]*?)<\/span>/gi, '$1');
    nv = v.slice(0, s) + plain + v.slice(e);
    ns = s; ne = s + plain.length;
  } else if (v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
    nv = v.slice(0, s - open.length) + sel + v.slice(e + close.length);
    ns = s - open.length; ne = ns + sel.length;
  } else if (sel.slice(0, open.length) === open && sel.slice(sel.length - close.length) === close
             && sel.length >= open.length + close.length + 1) {
    /* 选区**连着记号一起框住了**（`**A**` 里连星号一起选）→ 再点一次就是取消。
       不认这一种就会套娃：** + **A** + ** = ******A******（用户报的就是这个）。 */
    const inner = sel.slice(open.length, sel.length - close.length);
    nv = v.slice(0, s) + inner + v.slice(e);
    ns = s; ne = s + inner.length;
  } else {
    nv = v.slice(0, s) + open + sel + close + v.slice(e);
    ns = s + open.length; ne = ns + sel.length;
  }
  ta.value = nv;
  ta.setSelectionRange(ns, ne);
  if (typeof refresh === 'function') refresh();
  return true;
}
function fmtHasSel(ta) { return ta.selectionStart != null && ta.selectionEnd != null && ta.selectionStart !== ta.selectionEnd; }

/* ---- 方案十：浮条作用在 contenteditable 上时，直接改 DOM（不再插 Markdown 记号） ---- */
function fmtDomHasSel(el) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return false;
  const n = s.getRangeAt(0).commonAncestorContainer;
  return !!el && el.contains(n.nodeType === 1 ? n : n.parentNode);
}
function fmtDomCmd(cmd) { try { document.execCommand(cmd, false, null); return true; } catch (e) { return false; } }
function fmtDomWrap(open, close) {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return false;
  const r = s.getRangeAt(0);
  const box = document.createElement('div');
  box.appendChild(r.cloneContents());
  const html = open + box.innerHTML + close;
  try { document.execCommand('insertHTML', false, html); return true; } catch (e) {
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    const frag = document.createDocumentFragment();
    while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    const last = frag.lastChild;
    r.deleteContents(); r.insertNode(frag);
    if (last) { const nr = document.createRange(); nr.selectNodeContents(last); s.removeAllRanges(); s.addRange(nr); }
    return true;
  }
}
function fmtDomClear() {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return false;
  fmtDomCmd('removeFormat');
  const r = s.getRangeAt(0);
  const n = r.commonAncestorContainer;
  const start = n.nodeType === 1 ? n : n.parentNode;
  const host = (start && start.closest) ? start.closest('.rich-edit') : null;
  const isWrap = w => !!(w && w.matches && w.matches('mark, span[style*="color"], font[color]'));
  const cand = [];
  for (let w = start; w && w !== host; w = w.parentElement) if (isWrap(w)) cand.push(w);   // 选区整个落在 <mark> 里时，标记本身就是共同祖先
  if (host && host.querySelectorAll) {
    Array.prototype.slice.call(host.querySelectorAll('mark, span[style*="color"], font[color]')).forEach(w => {
      if (cand.indexOf(w) >= 0) return;
      if (r.intersectsNode && !r.intersectsNode(w)) return;
      cand.push(w);
    });
  }
  cand.forEach(w => {
    const p = w.parentNode; if (!p) return;
    while (w.firstChild) p.insertBefore(w.firstChild, w);
    p.removeChild(w);
  });
  return true;
}
function fmtBarInit(el) {
  const bar = fmtBarEl();
  FMT_TA = el;
  const dom = !!el.isContentEditable;                 // contenteditable（方案十）还是 textarea（§9 的完整编辑器）
  const refresh = () => {
    if (dom) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} return; }
    if (typeof el.oninput === 'function') el.oninput();
  };
  const hasSel = () => (dom ? fmtDomHasSel(el) : fmtHasSel(el));
  const showAt = (x, y) => {
    if (!hasSel()) { fmtBarHide(); return; }
    if (x == null) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + 46; }
    fmtPlace(bar, x, y);
  };
  /* 点完按钮把浮条挪到编辑框正上方（选区变了，原先那个位置不一定还贴）。
     别拿浮条自己的 top 当参照 —— 第一次是 0，浮条就会飞到屏幕最上头。 */
  const keep = () => { if (!hasSel()) { fmtBarHide(); return; } const r = el.getBoundingClientRect(); fmtPlace(bar, r.left + r.width / 2, r.top + 8); };
  bar.onmousedown = ev => ev.preventDefault();
  bar.onclick = ev => {
    const b = ev.target.closest ? ev.target.closest('button[data-fmt],button[data-color]') : null;
    if (!b) return;
    const f = b.dataset.fmt;
    if (dom) {
      try { el.focus({ preventScroll: true }); } catch (e) {}    // execCommand 要求焦点在编辑区里（点浮条时焦点可能已经不在）
      if (f === 'b') fmtDomCmd('bold');
      else if (f === 'i') fmtDomCmd('italic');
      else if (f === 'c') fmtDomWrap('<code>', '</code>');
      else if (f === 'h') fmtDomWrap('<mark>', '</mark>');
      else if (f === 'none') fmtDomClear();
      else if (b.dataset.color) fmtDomWrap('<span style="color:' + b.dataset.color + '">', '</span>');
      refresh();
    } else {
      if (f === 'b') fmtWrap(el, '**', '**', refresh);
      else if (f === 'i') fmtWrap(el, '*', '*', refresh);
      else if (f === 'c') fmtWrap(el, '`', '`', refresh);
      else if (f === 'h') fmtWrap(el, '==', '==', refresh);
      else if (f === 'none') fmtWrap(el, '', '', refresh);
      else if (b.dataset.color) fmtWrap(el, '<font color="' + b.dataset.color + '">', '</font>', refresh);
    }
    try { el.focus(); } catch (e) {}
    keep();
  };
  /* 元素上的监听只挂一次；bar 的 onclick 每次重指向当前目标（textarea 和 contenteditable 共用一条浮条） */
  if (el.dataset.fmtBound === '1') return;
  el.dataset.fmtBound = '1';
  el.addEventListener('mouseup', ev => setTimeout(() => showAt(ev.clientX, ev.clientY - 6), 0));
  el.addEventListener('touchend', () => setTimeout(() => showAt(), 80));
  el.addEventListener('keyup', ev => { if (ev.shiftKey || ev.key === 'Shift' || ev.key === 'Escape') showAt(); });
  el.addEventListener('scroll', fmtBarHide);
  el.addEventListener('blur', () => setTimeout(() => { if (!bar.matches(':hover')) fmtBarHide(); }, 160));
  if (!FMT_DOC) {
    FMT_DOC = true;
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fmtBarHide(); });
    document.addEventListener('mousedown', ev => { if (FMT_EL && !FMT_EL.hidden && !FMT_EL.contains(ev.target)) fmtBarHide(); });
  }
}

/* ============================================================
   方案十：解析块「Notion 式」就地编辑
   显示态就是编辑态（contenteditable），存储格式**仍然是 Markdown**。
   所以核心是一对互转：mdToHtml（已有）↔ mdFromHtml（下面这个）。
   为了互转可靠，可编辑格式限制在方案十第 2 节那张表的子集里，未知标签一律取纯文字。
   ============================================================ */
function mdColorHex(c) {
  c = String(c || '').trim();
  const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) c = '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
  return mdValidColor(c) ? c : '';
}
/* 文本节点里那些「会被当成格式」的符号，加反斜杠转义（mdEscOpen 认这个） */
function mdEscText(s) {
  return String(s)
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`')
    .replace(/==/g, '\\=\\=')
    .replace(/\[([^\]\n]*)\]\(/g, '\\[$1\\](')
    .replace(/<(?=\/?\s*(?:font|span)\b)/gi, '\\<');
}
/* 行首的 # - > + 1. 这类块级记号也要挡一下（不然用户打的字会变成标题 / 列表） */
function mdEscLineStart(s) {
  return /^(#{1,6}\s|[-*+]\s|&gt;\s|>\s|\d+[.)]\s)/.test(s) ? '\\' + s : s;
}
const MD_BLOCK_TAGS = { P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, TABLE: 1, UL: 1, OL: 1, HR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, FIGURE: 1, MAIN: 1, ASIDE: 1, NAV: 1 };
/* §3.6-P1⑤：解析里的字母壳（.optjump）只是显示用的装饰，存 Markdown 之前先脱掉 ——
   不然点一下选项，那个 **A** 就会写进你自己的解析里。所有读编辑器的路径都走这里，所以在这儿剥最稳。 */
function stripOptJump(root) {
  if (!root) return root;
  try {
    if (typeof root === 'string') return root.replace(/<b class="optjump"[^>]*>([A-H])<\/b>/g, '$1');
    root.querySelectorAll('.optjump').forEach(b => b.replaceWith(document.createTextNode(b.textContent)));
  } catch (e) {}
  return root;
}
function mdFromHtml(root) {
  stripOptJump(root);
  /* 块之间要留一个空行 —— mdToHtml 是按行识别的，两段之间没空行就会被粘成一段（往返一次就丢格式）。 */
  const blocks = [];                                // 每个块一个字符串，块内用 \n 分行
  let cur = [];
  const flush = () => { if (cur.length) { blocks.push(cur.join('\n')); cur = []; } };
  const pushRaw = s => cur.push(String(s).replace(/[ \t]+$/, ''));
  const pushText = s => String(s).split('\n').forEach(x => cur.push(mdEscLineStart(x.replace(/[ \t]+$/, ''))));

  function inlineOf(node, inCode) {                 // 行内内容 → Markdown 片段
    let s = '';
    Array.prototype.forEach.call(node.childNodes, n => {
      if (n.nodeType === 3) {
        const raw = n.nodeValue.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
        s += inCode ? raw.replace(/`/g, '') : mdEscText(raw);
      } else if (n.nodeType === 1) s += inlineEl(n, inCode);
    });
    return s;
  }
  function inlineEl(n, inCode) {
    const tag = n.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return '**' + inlineOf(n, inCode) + '**';
    if (tag === 'em' || tag === 'i') return '*' + inlineOf(n, inCode) + '*';
    if (tag === 'mark') return '==' + inlineOf(n, inCode) + '==';
    if (tag === 'code') return '`' + inlineOf(n, true) + '`';
    if (tag === 'del' || tag === 's' || tag === 'strike') return inlineOf(n, inCode);
    if (tag === 'a') { const h = n.getAttribute('href') || ''; return h ? '[' + inlineOf(n, inCode) + '](' + h + ')' : inlineOf(n, inCode); }
    if (tag === 'img') return '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '') + ')';
    const c = (n.style && n.style.color) ? mdColorHex(n.style.color) : (tag === 'font' ? mdColorHex(n.getAttribute('color')) : '');
    if (c) return '<font color="' + c + '">' + inlineOf(n, inCode) + '</font>';
    return inlineOf(n, inCode);                     // 未知标签：丢标签、留文字
  }
  function hasBlockChild(n) {                       // 外层只是壳（比如表格的 .tbl-wrap）时还要往里找块
    if (!n.children || !n.children.length) return false;
    return Array.prototype.some.call(n.children, c =>
      MD_BLOCK_TAGS[c.tagName] || (c.children && c.children.length && hasBlockChild(c)));
  }
  function blockOf(n) {
    const tag = n.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) { pushRaw('#'.repeat(Math.min(4, Math.max(1, (+tag[1]) - 2))) + ' ' + inlineOf(n, false).trim()); return; }
    if (tag === 'hr') { pushRaw('---'); return; }
    if (tag === 'ul' || tag === 'ol') {
      Array.prototype.forEach.call(n.children, (li, i) => {
        if (li.tagName.toLowerCase() !== 'li') return;
        pushRaw((tag === 'ol' ? (i + 1) + '. ' : '- ') + inlineOf(li, false).replace(/\n+/g, ' ').trim());
      });
      return;
    }
    if (tag === 'blockquote') {
      inlineOf(n, false).split('\n').forEach(t => pushRaw('> ' + t.trim()));
      return;
    }
    if (tag === 'pre') { pushText(n.textContent.replace(/^\n+|\n+$/g, '')); return; }
    if (tag === 'table') {
      const rows = Array.prototype.slice.call(n.querySelectorAll('tr'));
      rows.forEach((tr, ri) => {
        const cells = Array.prototype.slice.call(tr.children).map(td => inlineOf(td, false).replace(/\n+/g, ' ').trim().replace(/\|/g, '\\|'));
        if (!cells.length) return;
        pushRaw('| ' + cells.join(' | ') + ' |');
        if (ri === 0) pushRaw('| ' + cells.map(() => '---').join(' | ') + ' |');
      });
      return;
    }
    if (hasBlockChild(n)) { walk(n); return; }      // 只是壳（div / section）：进去接着找块
    inlineOf(n, false).split('\n').forEach(t => pushText(t));   // p / li / 其它块级
  }
  function walk(node) {
    Array.prototype.forEach.call(node.childNodes, n => {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) pushText(t);
        return;
      }
      if (n.nodeType !== 1) return;
      if (MD_BLOCK_TAGS[n.tagName]) { flush(); blockOf(n); flush(); }
      else inlineEl(n, false).split('\n').forEach(t => pushText(t));
    });
  }
  walk(root);
  flush();
  let md = blocks.join('\n\n');
  md = md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  return mdTidy(md);
}

/* ---- 就地编辑器：渲染 / 绑定 / 保存 / 收尾 ---- */
let RICH = null;                                    // 当前活着的那个就地编辑器
function richState(el, txt, keep) {
  const w = el.closest ? el.closest('.exp-wrap') : null;
  const s = w && w.querySelector('.exp-state');
  if (!s) return;
  if (s._t) { clearTimeout(s._t); s._t = null; }
  s.textContent = txt || '';
  if (txt && !keep) s._t = setTimeout(() => { s.textContent = ''; s._t = null; }, 1500);
}
/* 解析块（含图片）：显示态即编辑态。label 走上面那行，图片不参与 contenteditable */
function richBox(fk, text, custom, label) {
  const n = (typeof noteOf === 'function') ? noteOf(fk) : null;
  const imgs = (n && n.imgs) || [];
  const imgsHtml = imgs.length
    ? '<div class="rich-imgs">' + imgs.map(im => `<img src="${im.src}" alt="${esc(im.name || '')}" loading="lazy">`).join('') + '</div>'
    : '';
  const body = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text || '');
  return `<div class="exp-wrap" data-note-for="${esc(fk)}">
      <div class="exp lb-row"><span class="lb">${esc(label || '解析')}${custom ? '（自定义）' : ''}：</span><span class="exp-state small muted" aria-live="polite"></span></div>
      <div class="exp rich-edit" contenteditable="true" spellcheck="false" data-note-for="${esc(fk)}" title="点进来就能改：选中文字会弹出小工具栏，改完点一下别处自动保存">${body}</div>
      ${imgsHtml}
      <div class="aisrc-saved" data-aisrc="${esc(fk)}"></div>
    </div>`;
}
function richBind(el, fk) {
  if (!el || !fk) return null;
  let before = el.innerHTML;
  const save = () => {
    if (!el.isConnected || el.innerHTML === before) return;
    let md;
    try { md = mdFromHtml(el.cloneNode(true)); } catch (e) { toast('这段格式没认出来，先没保存（原文一个字没动）', 3000, 'bad'); return; }
    const cur = NOTES[fk] || {};
    NOTES[fk] = { text: md, imgs: cur.imgs || [], ts: Date.now(), ai: cur.ai || false };
    if (typeof saveNotes === 'function' && saveNotes() === false) { toast('保存失败：浏览器存储满了', 3000, 'bad'); return; }
    before = el.innerHTML;
    const w = el.closest('.exp-wrap');
    const lb = w && w.querySelector('.lb');
    if (lb && lb.textContent.indexOf('自定义') < 0) lb.textContent = '解析（自定义）：';
    richState(el, '已保存');
  };
  RICH = { el: el, fk: fk, save: save };
  el.addEventListener('input', () => { richState(el, el.innerHTML === before ? '' : '未保存…', true); });
  el.addEventListener('blur', save, true);
  el.addEventListener('paste', ev => {              // 从网页 / Word 粘进来的一律只留纯文字
    ev.preventDefault();
    const cb = ev.clipboardData || window.clipboardData;
    const t = (cb ? cb.getData('text/plain') : '') || '';
    if (!t) return;
    let doneOk = false;
    try { doneOk = document.execCommand('insertText', false, t) !== false; } catch (e) { doneOk = false; }
    if (!doneOk || el.textContent.indexOf(t) < 0) {  // execCommand 被废弃 / 不支持时退化成手工插纯文本节点
      const node = document.createTextNode(t);
      const sel = window.getSelection();
      if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        r.deleteContents(); r.insertNode(node); r.setStartAfter(node); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      } else { el.appendChild(node); }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    richState(el, '未保存…', true);
  });
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); el.blur(); }
  });
  /* 拖图片到解析块：存进这道题的图片区（和「改解析 → 插入图片」同一份数据） */
  const filesIn = e => !!(e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files'));
  el.addEventListener('dragover', e => {
    if (!filesIn(e)) return;
    e.preventDefault(); e.stopPropagation();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
    el.classList.add('drop-hot');
  });
  el.addEventListener('dragleave', e => {
    if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove('drop-hot');
  });
  el.addEventListener('drop', async e => {
    if (!filesIn(e)) return;
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-hot');
    const files = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || ''));
    if (!files.length) { toast('这里只接图片：png / jpg / webp / gif'); return; }
    toast('正在处理图片…', 900);
    const added = [];
    for (const f of files) {
      try { added.push({ name: f.name || '', src: await compressImage(f) }); }
      catch (err) { toast('图片读取失败：' + f.name); }
    }
    if (!added.length) return;
    let md = '';
    try { md = mdFromHtml(el.cloneNode(true)); } catch (err) { md = (NOTES[fk] || {}).text || ''; }
    const cur = NOTES[fk] || {};
    NOTES[fk] = { text: md || cur.text || '', imgs: (cur.imgs || []).concat(added), ts: Date.now(), ai: cur.ai || false };
    if (typeof saveNotes === 'function' && saveNotes() === false) { toast('保存失败：浏览器存储满了', 3000, 'bad'); return; }
    const wrap = el.closest('.exp-wrap');
    let box = wrap && wrap.querySelector('.rich-imgs');
    if (!box && wrap) { box = document.createElement('div'); box.className = 'rich-imgs'; wrap.appendChild(box); }
    if (box) added.forEach(im => {
      const x = document.createElement('img'); x.src = im.src; x.alt = im.name || ''; x.loading = 'lazy'; box.appendChild(x);
    });
    richState(el, '已保存');
    toast('已插入 ' + added.length + ' 张图片');
  });
  fmtBarInit(el);
  return RICH;
}
/* 一次把页面上还没绑过的就地编辑器都绑上（重画完调一次就行） */function richBindAll(root) {
  const scope = root || document;
  if (!scope.querySelectorAll) return;
  Array.prototype.slice.call(scope.querySelectorAll('.rich-edit[contenteditable]')).forEach(el => {
    if (el.dataset.richBound === '1') return;
    const fk = el.dataset.noteFor;
    if (!fk) return;
    el.dataset.richBound = '1';
    richBind(el, fk);
  });
  /* 解析下面那行「参考资料」（存过 AI 参考资料的题）：就地画出来，点开就是 PDF */
  if (typeof aiSrcPaintFor === 'function') {
    Array.prototype.slice.call(scope.querySelectorAll('.aisrc-saved[data-aisrc]')).forEach(el => {
      if (el.dataset.srcBound === '1') return;
      el.dataset.srcBound = '1';
      try { aiSrcPaintFor(el, el.dataset.aisrc); } catch (e) {}
    });
  }
}
/* 完整编辑器（textarea）关掉之后，把浮条重新指回页面上的就地编辑器 */
function fmtBarRebind() {
  const el = document.querySelector('.rich-edit[contenteditable]');
  if (el) fmtBarInit(el);
}
/* 切题 / 重画 / 离开页面前，先把没保存的改动落盘（方案十 4.2） */
function richFlush() {
  const r = RICH;
  RICH = null;
  if (r && r.el && r.el.isConnected) { try { r.save(); } catch (e) {} }
}
if (!window.__richHooks) {
  window.__richHooks = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) richFlush(); });
  window.addEventListener('beforeunload', richFlush);
}
function openNoteEditor(k, host, q, onDone) {
  const cur = NOTES[k] || {};
  ED = { k: k, text: cur.text || '', imgs: (cur.imgs || []).map(x => ({ name: x.name || '', src: x.src })), host: host, q: q, onDone: onDone };
  paintEditor();
}
function paintEditor() {
  const host = ED.host, k = ED.k;
  const custom = !!NOTES[k];
  host.innerHTML = `
    <div class="ed">
      <div class="hint">支持 Markdown：<b>**加粗**</b>、*斜体*、\`代码\`、# 标题、- 列表、&gt; 引用、[链接](url)，以及表格（如 \`| 表头 | 表头 |\` 下一行 \`| --- | --- |\`）。图片可以直接插进来。<br><b>选中文字会弹出小工具栏</b>：加粗 / 斜体 / 代码 / 高亮 / 改颜色，不用自己敲符号。</div>
      <textarea class="ed-ta" id="edTa" placeholder="在这里写解析…">${esc(ED.text)}</textarea>
      ${ED.imgs.length ? `<div class="ed-imgs">${ED.imgs.map((im, i) => `
        <div class="thumb"><img src="${im.src}" alt=""><button class="x" data-imgdel="${i}" title="删除">×</button></div>`).join('')}</div>` : ''}
      <div class="actions">
        <button class="btn" id="edImg">＋ 插入图片</button>
        <button class="btn" id="edAI" title="让 AI 生成一份解析，写进下面的编辑框">AI 生成解析</button>
        <button class="btn primary" id="edSave">保存解析</button>
        <button class="btn" id="edCancel">取消</button>
        ${custom ? `<button class="btn danger" id="edReset">恢复默认解析</button>` : ''}
        <input type="file" id="edFile" accept="image/*" multiple style="display:none">
      </div>
      <div class="ai-host"></div>
      <div class="hint" style="margin-top:10px">预览</div>
      <div class="ed-preview">${mdToHtml(ED.text)}${ED.imgs.map(im => `<img src="${im.src}" alt="">`).join('')}</div>
    </div>`;

  const ta = $('edTa');
  ta.oninput = () => { ED.text = ta.value; host.querySelector('.ed-preview').innerHTML = mdToHtml(ED.text) + ED.imgs.map(im => `<img src="${im.src}" alt="">`).join(''); };
  /* §9：选中文字弹浮条（加粗 / 斜体 / 代码 / 高亮 / 颜色） */
  fmtBarInit(ta);
  /* 拖图片进「改解析」：直接加到下面的图片区。stopPropagation 是必须的 ——
     chat.js 在 document 捕获阶段有个「拖文件 = 加进 AI 对话」的兜底，会把这里的 drop 抢走。 */
  const edRoot = host.querySelector('.ed');
  if (edRoot) {
    const filesIn = e => !!(e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files'));
    edRoot.addEventListener('dragover', e => {
      if (!filesIn(e)) return;
      e.preventDefault(); e.stopPropagation();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
      edRoot.classList.add('drag-on');
    });
    edRoot.addEventListener('dragleave', e => {
      if (e.target === edRoot || !edRoot.contains(e.relatedTarget)) edRoot.classList.remove('drag-on');
    });
    edRoot.addEventListener('drop', async e => {
      if (!filesIn(e)) return;
      e.preventDefault(); e.stopPropagation();
      edRoot.classList.remove('drag-on');
      const files = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name || ''));
      if (!files.length) { toast('这里只接图片：png / jpg / webp / gif'); return; }
      ED.text = ta.value || ED.text;
      toast('正在处理图片…', 900);
      for (const f of files) {
        try { ED.imgs.push({ name: f.name || '', src: await compressImage(f) }); }
        catch (err) { toast('图片读取失败：' + f.name); }
      }
      paintEditor();
    });
  }
  on('edImg', () => $('edFile').click());
  on('edAI', () => { if (typeof aiOpenPanel === 'function') aiOpenPanel(host.querySelector('.ai-host'), k, ED.q, txt => { ED.text = txt; paintEditor(); }); else toast('AI 模块没加载（ai.js）'); });
  on('edFile', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    toast('正在处理图片…', 900);
    for (const f of files) {
      try { ED.imgs.push({ name: f.name || '', src: await compressImage(f) }); } catch (err) { toast('图片读取失败：' + f.name); }
    }
    paintEditor();
  }, 'change');
  host.querySelectorAll('[data-imgdel]').forEach(b => b.onclick = () => { ED.imgs.splice(+b.dataset.imgdel, 1); paintEditor(); });
  /* 重画编辑器之后把「AI 生成解析」的面板挂回来（生成到一半被重画也不会断） */
  if (typeof aiReopenFor === 'function') { try { aiReopenFor(host.querySelector('.ai-host'), k); } catch (e) {} }
  on('edCancel', () => { if (typeof aiForget === 'function') aiForget(host.querySelector('.ai-host')); fmtBarHide(); host.innerHTML = ''; ED = null; fmtBarRebind(); });
  on('edReset', () => {
    if (!confirm('恢复成题库自带的解析？你写的 Markdown 和图片都会删掉。')) return;
    delete NOTES[k];
    tombAdd('note', k);
    saveNotes();
    if (typeof aiForget === 'function') aiForget(host.querySelector('.ai-host'));
    fmtBarHide(); host.innerHTML = ''; ED = null; fmtBarRebind(); toast('已恢复默认解析'); render();
  });
  on('edSave', () => {
    const text = mdTidy(($('edTa').value || '').trim());
    if (!text && !ED.imgs.length) { delete NOTES[k]; tombAdd('note', k); }
    else NOTES[k] = { text: text, imgs: ED.imgs.slice(), ts: Date.now() };
    if (!saveNotes()) { toast('保存失败：浏览器存储空间已满，建议把图片压小或先导出备份'); return; }
    const mb = storageBytes() / 1024 / 1024;
    toast(mb > 4 ? '已保存（本机存储已用 ' + mb.toFixed(2) + ' MB，接近上限）' : '已保存');
    if (typeof aiForget === 'function') aiForget(host.querySelector('.ai-host'));
    fmtBarHide(); host.innerHTML = ''; ED = null; fmtBarRebind();
    render();
  });
}

/* ---------------- 列表页状态 ---------------- */
const SORTS = {
  wrong: { label: '错次', def: -1, cmp: (a, b) => (a.rec.wrong || 0) - (b.rec.wrong || 0) || (a.rec.ts || 0) - (b.rec.ts || 0) },
  rate: { label: '正确率', def: 1, cmp: (a, b) => rateOf(a.rec) - rateOf(b.rec) },
  tries: { label: '作答次数', def: -1, cmp: (a, b) => (a.rec.tries || 0) - (b.rec.tries || 0) },
  recent: { label: '最近作答', def: -1, cmp: (a, b) => (a.rec.ts || 0) - (b.rec.ts || 0) },
  id: { label: '题号', def: 1, cmp: (a, b) => String(a.bank.title).localeCompare(String(b.bank.title)) || String(a.q.id).localeCompare(String(b.q.id), 'zh', { numeric: true }) }
};
const ARROW = d => (d > 0 ? '↑' : '↓');
const mkState = () => ({ bank: 'all', sort: 'wrong', dir: -1, minWrong: 0, onlyOpen: false, onlyDue: false, withExp: true, withImg: true, withSel: true, withStat: true, open: new Set(), sel: new Set(), shown: [], scope: 'all', kw: '', tag: '', base: '' });
const LP = { wrong: mkState(), fav: mkState(), search: mkState() };
let LP_KW_T = null;                                  /* 「找词」输入的防抖计时器 */
let LP_COMPOSING = false;                             /* 拼音候选阶段：不重画，否则选字会退回拼音 */
const QAI_KEY = 'qbank.qsearch.ai.v1';
const QAI_SCOPES = [['all', '全部'], ['stem', '题干'], ['options', '选项'], ['explain', '解析']];
const QAI = { on: false, scope: 'all', cache: new Map(), timer: 0, abort: null, runQ: '', seq: 0 };
try {
  const qaiSt = (typeof readLS === 'function') ? readLS(QAI_KEY, {}) : null;
  QAI.on = !!(qaiSt && qaiSt.on);
  QAI.scope = (qaiSt && QAI_SCOPES.some(x => x[0] === qaiSt.scope)) ? qaiSt.scope : 'all';
} catch (e) { QAI.on = false; QAI.scope = 'all'; }
let QAI_LIST_MODE = 'wrong';
let QAI_FOCUS = null;

/* 这道题贴了哪些考点标签（tags.js 可能还没加载，兜住） */
function tagListOf(k) {
  try { return (typeof tagsOf === 'function' && tagsOf(k)) || []; } catch (e) { return []; }
}
function basicTags() {
  try { if (window.TAGS && typeof window.TAGS.basic === 'function') return window.TAGS.basic(); } catch (e) {}
  return ['生理', '生化', '病理', '内科', '外科', '人文'];
}

/* 考点词表 → 「批量加标签」输入框的候选（tags.js 没加载就空着） */
function tagVocabOptions(excludeBasic) {
  try {
    let all = (window.TAGS && typeof window.TAGS.all === 'function') ? window.TAGS.all() : [];
    if (excludeBasic) { const bs = basicTags(); all = (all || []).filter(t => bs.indexOf(t) < 0); }
    return (all || []).map(t => `<option value="${esc(t)}"></option>`).join('');
  } catch (e) { return ''; }
}

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
  return r;
}
/* 列表里那条「第 N 题」：题号是数字就直接用，不然退回到它在题库里的第几题
   （以前直接写 q.id，遇到题库里 id 是 q1 这种就会显示成「第 q1 题」） */
function qLabel(it) {
  const id = it && it.q ? String(it.q.id == null ? '' : it.q.id) : '';
  if (/^\d+$/.test(id)) return '第 ' + id + ' 题';
  const qs = (it && it.bank && it.bank.questions) || [];
  const at = qs.indexOf(it.q);
  if (at >= 0) return '第 ' + (at + 1) + ' 题';
  return '第 ' + (id || '?') + ' 题';
}
function dueText(k) {
  const d = dueOf(k);
  if (d == null) return '';
  const days = Math.round((d - Date.now()) / DAY);
  if (days <= 0) return '今天到期';
  if (days === 1) return '明天复习';
  return days + ' 天后复习';
}

/* 关键词：空格分隔多个词＝每个词都要命中（AND），大小写不敏感 */
function splitKw(kw) {
  return String(kw == null ? '' : kw).trim().toLowerCase().split(/\s+/).filter(Boolean);
}
function hayOf(k, q, b) {
  return (q.stem + ' ' + (q.group || '') + ' ' + (q.options || []).join(' ') + ' ' + explainOf(k, q) + ' ' + ((b && b.title) || '')).toLowerCase();
}
/* 这一行为什么会命中：题干里没有关键词时，告诉用户是「选项 / 解析 / 题库名」命中的
   （不然搜「B 型题里的某个词」，列表里每条题干看起来都跟关键词无关，很容易以为搜错了） */
function hitWhere(it) {
  const terms = splitKw(HL_KW);
  if (!terms.length) return '';
  const q = it.q, b = it.bank;
  const has = s => { const t = String(s == null ? '' : s).toLowerCase(); return terms.every(w => t.indexOf(w) >= 0); };
  if (has(q.stem)) return '';                        // 题干里就有，不用解释
  const where = [];
  if (has((q.options || []).join(' '))) where.push('选项');
  if (has(explainOf(it.k, q))) where.push('解析');
  if (has((b && b.title) || '')) where.push('题库名');
  if (!where.length) where.push('题干补充');
  return where.join(' / ');
}
/* 关键词匹配用的 haystack 按题库缓存：几千道题时，每敲一个字都重拼一遍字符串很浪费
   （实测 5000 题：每次重拼 18ms → 缓存后 1ms）。题库/解析/修正答案一变就 bumpHay()。 */
let HAY_VER = 0;
const HAY_CACHE = new Map();
function bumpHay() { HAY_VER++; }
function hayListOf(b) {
  const c = HAY_CACHE.get(b.id);
  if (c && c.ver === HAY_VER && c.n === b.questions.length) return c.arr;
  const arr = b.questions.map(q => { const k = kOf(b, q); return { k: k, q: q, hay: hayOf(k, q, b) }; });
  HAY_CACHE.set(b.id, { ver: HAY_VER, n: b.questions.length, arr: arr });
  return arr;
}
function collect(mode, kw, scope) {
  const out = [];
  const terms = splitKw(kw);
  allBanks().forEach(b => {
    if (b.paper) return;                       // 套卷自己的记录不进这些列表
    const list = hayListOf(b);
    for (let idx = 0; idx < list.length; idx++) {
      const it = list[idx], k = it.k, q = it.q, rec = recOf(k);
      if (mode === 'wrong') { if (!rec || (rec.wrong || 0) <= 0) continue; }
      else if (mode === 'fav') { if (!FAV[k]) continue; }
      else if (mode === 'due') { if (!isDue(k)) continue; }
      if (terms.length) {
        const hay = scope ? qaiHay(it, scope) : it.hay;
        let miss = false;
        for (let i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) { miss = true; break; }
        if (miss) continue;
      }
      out.push({ bank: b, q: q, k: k, rec: rec || { tries: 0, wrong: 0, ok: null, sel: [] } });
    }
  });
  return out;
}

/* ---------- 错题 / 收藏 / 搜索页的 AI 模糊（默认关） ----------
   不把整库题目发给模型：只让 AI 把用户描述扩成同义词 / 相关考点词，
   再在本地题目里做包含匹配。省 token，也不传题目内容。 */
function qaiSave() {
  try { if (typeof writeLS === 'function') writeLS(QAI_KEY, { on: !!QAI.on, scope: QAI.scope }); } catch (e) {}
}
function qaiAbort() {
  QAI.seq++;
  if (QAI.abort) { try { QAI.abort.abort(); } catch (e) {} QAI.abort = null; }
  QAI.runQ = '';
}
function qaiCached(q) { return QAI.cache.get(q) || null; }
function qaiCurrentQ() {
  if (document.getElementById('lkw')) return String((LP[QAI_LIST_MODE] && LP[QAI_LIST_MODE].kw) || '');
  if (document.getElementById('sq')) return String(LP.search.kw || '');
  return '';
}
function qaiSchedule(q, delay) {
  clearTimeout(QAI.timer); QAI.timer = 0;
  q = String(q || '').trim();
  if (!QAI.on || q.length < 2) { qaiAbort(); return; }
  if (QAI.runQ && QAI.runQ !== q) qaiAbort();
  QAI.timer = setTimeout(function () { QAI.timer = 0; qaiExpand(q); }, delay == null ? 900 : delay);
}
function qaiParse(text, q) {
  var s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  var j = null;
  try { j = JSON.parse(s); } catch (e) { j = null; }
  var arr = j ? (Array.isArray(j) ? j : (Array.isArray(j.terms) ? j.terms : [])) : [];
  var out = [], seen = {};
  function add(t) {
    t = String(t == null ? '' : t).trim().replace(/^[“”"']+|[“”"']+$/g, '');
    if (t.length < 2 || t.length > 24) return;
    var k = t.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(t);
  }
  /* 只展示 AI 真正扩展出来的词；原始关键词由本地筛选单独处理，不混进「AI 扩展」胶囊 */
  arr.forEach(function (x) { add(typeof x === 'string' ? x : ((x && (x.term || x.text || x.word)) || '')); });
  return out.slice(0, 12);
}
function qaiMatch(items, terms, limit) {
  var low = [], seen = {};
  (terms || []).forEach(function (t) {
    t = String(t || '').toLowerCase();
    if (t.length < 2 || seen[t]) return;
    seen[t] = 1; low.push(t);
  });
  if (!low.length) return [];
  var hits = [];
  (items || []).forEach(function (it) {
    var hay = qaiHay(it, QAI.scope), n = 0;
    for (var i = 0; i < low.length; i++) if (hay.indexOf(low[i]) >= 0) n++;
    if (n) hits.push({ it: it, n: n });
  });
  hits.sort(function (a, b) { return b.n - a.n || String(a.it.bank.title).localeCompare(String(b.it.bank.title), 'zh'); });
  return hits.slice(0, limit || 120).map(function (x) { return x.it; });
}
function qaiHay(it, scope) {
  const q = it.q, k = it.k;
  if (scope === 'stem') return (q.stem + ' ' + (q.group || '')).toLowerCase();
  if (scope === 'options') return (q.options || []).join(' ').toLowerCase();
  if (scope === 'explain') return explainOf(k, q).toLowerCase();
  return (q.stem + ' ' + (q.group || '') + ' ' + (q.options || []).join(' ') + ' ' + explainOf(k, q)).toLowerCase();
}
function qaiScopeHtml() {
  return '<div class="tools qai-scope-row"' + (QAI.on ? '' : ' style="display:none"') + '>'
    + '<span class="tl">AI 命中范围</span>'
    + QAI_SCOPES.map(function (x) {
        return '<button type="button" class="chip' + (QAI.scope === x[0] ? ' on' : '') + '" data-qscope="' + x[0] + '">' + x[1] + '</button>';
      }).join('')
    + '<span class="small muted">只影响 AI 模糊；开启时本地筛选也按这个范围</span>'
    + '</div>';
}
function qaiPaintScope() {
  document.querySelectorAll('[data-qscope]').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-qscope') === QAI.scope);
  });
  document.querySelectorAll('.qai-scope-row').forEach(function (r) {
    r.style.display = QAI.on ? '' : 'none';
  });
}
function qaiPickTerm(term) {
  term = String(term || '').trim();
  if (!term) return;
  if (document.getElementById('lkw')) {
    const st = LP[QAI_LIST_MODE] || LP.wrong;
    st.kw = term;
    const el = $('lkw'); if (el) el.value = term;
    QAI_FOCUS = { pos: term.length, t: Date.now() };
    render();
    const el2 = $('lkw'); if (el2) { try { el2.focus(); el2.setSelectionRange(term.length, term.length); } catch (e) {} }
  } else if (document.getElementById('sq')) {
    LP.search.kw = term;
    const el = $('sq'); if (el) el.value = term;
    const c = $('sqClear'); if (c) c.style.display = term ? '' : 'none';
    paintSearch();
    try { const el2 = $('sq'); if (el2) { el2.focus(); el2.setSelectionRange(term.length, term.length); } } catch (e) {}
  }
}
function qaiNoteHtml(q, hitCount) {
  q = String(q || '').trim();
  if (!QAI.on || q.length < 2) return '';
  var c = qaiCached(q), inner;
  if (c && c.error) {
    var msg = String(c.error.msg || '出错').slice(0, 80);
    inner = '<span class="ai-qico">✨</span><b>AI 模糊</b>'
      + '<span class="ai-qerr">没成功：' + esc(msg) + '</span>'
      + '<button type="button" class="btn tiny" id="aiQRetry">重试</button>';
  } else if (c && c.terms && c.terms.length) {
    inner = '<span class="ai-qico">✨</span><b>AI 扩展</b>'
      + '<span class="ai-qterms">' + c.terms.map(function (t) { return '<button type="button" class="ai-term" data-qterm="' + esc(t) + '" title="用这个词搜">' + esc(t) + '</button>'; }).join('') + '</span>'
      + '<span class="ai-qhint">' + (hitCount ? '命中 ' + hitCount + ' 题' : '没命中') + '</span>';
  } else if (c && c.terms) {
    inner = '<span class="ai-qico">✨</span><b>AI 模糊</b><span class="ai-qhint">没扩展出词；换个说法再按回车</span>';
  } else if (QAI.runQ === q) {
    inner = '<span class="ai-qico">✨</span><b>AI 模糊</b><span class="ai-qhint">正在扩展检索词…</span>';
  } else {
    inner = '<span class="ai-qico">✨</span><b>AI 模糊</b><span class="ai-qhint">输入后按回车，AI 再扩展检索词（只发关键词，不传题目）</span>';
  }
  return '<div class="ai-qnote">' + inner + '</div>';
}
function qaiEmptyText(q) {
  var c = qaiCached(q);
  if (c && c.error) return 'AI 没成功，本地也没找到。可以点上面的「重试」。';
  if (c && c.terms && c.terms.length) return 'AI 扩展后也没找到，试试写科目 / 症状 / 检查 / 药名。';
  if (c && c.terms && !c.terms.length) return 'AI 没扩展出词；换个说法再按回车。';
  if (QAI.runQ === q) return '本地没找到，AI 正在扩展检索词…';
  return '本地没找到。按回车，让 AI 按描述再找一遍。';
}
function qaiBindNote(host, q) {
  if (!host) return;
  var r = host.querySelector('#aiQRetry');
  if (r) r.onclick = function (e) { e.preventDefault(); QAI.cache.delete(q); qaiSchedule(q, 0); };
  host.querySelectorAll('[data-qterm]').forEach(function (b) {
    b.onclick = function (e) { e.preventDefault(); qaiPickTerm(b.getAttribute('data-qterm')); };
  });
}
function qaiApply() {
  if (document.getElementById('lkw')) {
    var st = LP[QAI_LIST_MODE] || LP.wrong;
    QAI_FOCUS = { pos: String(st.kw || '').length, t: Date.now() };
    render();
  } else if (document.getElementById('sq')) {
    paintSearch();
  }
}
async function qaiExpand(q) {
  q = String(q || '').trim();
  if (!QAI.on || q.length < 2) return;
  var c = qaiCached(q);
  if (c) { if (q === qaiCurrentQ().trim()) qaiApply(); return; }
  if (QAI.runQ === q) return;
  var seq = ++QAI.seq;
  if (QAI.abort) { try { QAI.abort.abort(); } catch (e) {} }
  var ctl = ('AbortController' in window) ? new AbortController() : null;
  QAI.abort = ctl; QAI.runQ = q;
  if (q === qaiCurrentQ().trim()) qaiApply();       /* 先把「正在扩展」画出来 */
  var timedOut = false;
  var timer = setTimeout(function () { timedOut = true; if (ctl) { try { ctl.abort(); } catch (e) {} } }, 15000);
  var sys = '你是医学刷题站的检索助手。用户想在自己的题里找一道题，但不记得原题关键词。'
    + '把用户描述扩展成最多 10 个检索词（同义词、缩写、相关考点 / 药物 / 检查），用于在本站题目文本里做包含匹配。'
    + '每个词 1–12 个字；不要整句；不要解释；只输出一行 JSON：{"terms":["...","..."]}。';
  var user = '用户描述：\n"""' + q.slice(0, 300) + '"""';
  try {
    if (typeof aiChat !== 'function') throw new Error('AI 模块没加载');
    var txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: user }],
      null, ctl ? ctl.signal : null, { stream: false, temp: 0.2, maxTokens: 500 });
    if (seq !== QAI.seq) return;
    var terms = qaiParse(txt, q);
    QAI.cache.set(q, { terms: terms, ts: Date.now() });
    if (q === qaiCurrentQ().trim()) qaiApply();
  } catch (e) {
    if (seq !== QAI.seq) return;
    if (e && e.name === 'AbortError' && !timedOut) return;
    var info;
    if (e && e.name === 'AbortError' && timedOut) info = { msg: 'AI 15 秒没返回', hint: '模型服务可能太慢；可以换个小模型，或稍后点重试。' };
    else info = (typeof aiErrInfo === 'function') ? aiErrInfo(e) : { msg: (e && e.message) || '出错', hint: '' };
    QAI.cache.set(q, { error: info, ts: Date.now() });
    if (q === qaiCurrentQ().trim()) qaiApply();
  } finally {
    clearTimeout(timer);
    if (QAI.runQ === q) QAI.runQ = '';
    if (QAI.abort === ctl) QAI.abort = null;
  }
}
function qaiBtnHtml(id) {
  return '<button type="button" class="btn qai-btn' + (QAI.on ? ' primary on' : '') + '" id="' + id + '" aria-pressed="' + (QAI.on ? 'true' : 'false') + '" title="'
    + (QAI.on ? 'AI 模糊已开 · 输入后按回车才发请求，再点关闭' : 'AI 模糊搜索：默认关；按回车才把关键词发给 AI 扩展，不传题目内容') + '">'
    + '<span aria-hidden="true">✨</span> AI 模糊</button>';
}
function qaiPaintBtn() {
  document.querySelectorAll('.qai-btn').forEach(function (b) {
    b.classList.toggle('primary', QAI.on);
    b.classList.toggle('on', QAI.on);
    b.setAttribute('aria-pressed', QAI.on ? 'true' : 'false');
    b.title = QAI.on ? 'AI 模糊已开 · 输入后按回车才发请求，再点关闭' : 'AI 模糊搜索：默认关；按回车才把关键词发给 AI 扩展，不传题目内容';
  });
}
function qaiSetOn(on) {
  QAI.on = !!on;
  qaiSave();
  if (!QAI.on) { clearTimeout(QAI.timer); QAI.timer = 0; qaiAbort(); }
  qaiPaintBtn();
  qaiPaintScope();
}
function qaiToggleList() {
  var st = LP[QAI_LIST_MODE] || LP.wrong;
  qaiSetOn(!QAI.on);
  QAI_FOCUS = { pos: String(st.kw || '').length, t: Date.now() };
  render();
  if (QAI.on) toast('AI 模糊已开：输入后按回车，才把关键词发给 AI（不传题目）', 2400);
  else toast('AI 模糊已关', 1400);
  setTimeout(function () {
    var el = $('lkw');
    if (el && (!document.activeElement || document.activeElement === document.body)) {
      try { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
    }
  }, 30);
}
function qaiToggleSearch() {
  qaiSetOn(!QAI.on);
  paintSearch();
  var el = $('sq');
  try { if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } catch (e) {}
  if (QAI.on) toast('AI 模糊已开：输入后按回车，才把关键词发给 AI（不传题目）', 2400);
  else toast('AI 模糊已关', 1400);
}

function renderWrong() { renderList('wrong'); }
function renderFav() { renderList('fav'); }

function renderList(mode) {
  richFlush();                                   // 方案十：重画前先把就地编辑的改动落盘
  const st = LP[mode];
  QAI_LIST_MODE = mode;
  const isWrong = (mode === 'wrong');
  $('appTitle').textContent = isWrong ? '错题本' : '我的收藏';
  $('stat').textContent = ''; $('bar').style.width = '0%';

  const items = collect(mode);
  const banksWith = {};
  items.forEach(it => { banksWith[it.bank.id] = (banksWith[it.bank.id] || 0) + 1; });

  const totalTries = items.reduce((s, it) => s + (it.rec.tries || 0), 0);
  const totalWrong = items.reduce((s, it) => s + (it.rec.wrong || 0), 0);
  const acc = totalTries ? Math.round((totalTries - totalWrong) / totalTries * 100) : 0;
  const openN = items.filter(it => !(it.rec.ok === true && !it.rec.redo)).length;

  const basics = basicTags();
  let baseShown = items.slice();
  if (isWrong) baseShown = baseShown.filter(it => (it.rec.wrong || 0) >= (st.minWrong || 0));
  if (st.onlyOpen) baseShown = baseShown.filter(it => !(it.rec.ok === true && !it.rec.redo));
  if (isWrong && st.onlyDue) baseShown = baseShown.filter(it => isDue(it.k));
  if (st.bank !== 'all') baseShown = baseShown.filter(it => it.bank.id === st.bank);
  /* 候补池 G：按考点标签筛 + 列表里直接找词（都只作用于当前这个列表） */
  if (st.base) baseShown = baseShown.filter(it => tagListOf(it.k).indexOf(st.base) >= 0);
  if (st.tag) baseShown = baseShown.filter(it => tagListOf(it.k).indexOf(st.tag) >= 0);
  const kwTerms = splitKw(st.kw);
  let localShown = baseShown;
  if (kwTerms.length) localShown = localShown.filter(it => {
    const h = QAI.on ? qaiHay(it, QAI.scope) : hayOf(it.k, it.q, it.bank);
    return kwTerms.every(w => h.indexOf(w) >= 0);
  });
  const kwQ = String(st.kw || '').trim();
  const aiCache = (QAI.on && kwQ.length >= 2) ? qaiCached(kwQ) : null;
  const aiTerms = (aiCache && aiCache.terms) || [];
  const aiHits = aiTerms.length ? qaiMatch(baseShown, aiTerms, 120) : [];
  const aiKeys = new Set(aiHits.map(it => it.k));
  HL_KW = st.kw || '';
  const S = SORTS[st.sort] || SORTS.wrong;
  const cmp = (a, b) => S.cmp(a, b) * (st.dir > 0 ? 1 : -1);
  let shown;
  if (aiHits.length) {
    shown = aiHits.slice();                       /* AI 命中的按相关度排最前 */
    shown = shown.concat(localShown.filter(it => !aiKeys.has(it.k)).sort(cmp));
  } else {
    shown = localShown.slice().sort(cmp);
  }
  st.shown = shown;

  const dueItems = isWrong ? items.filter(it => isDue(it.k)) : [];
  const selN = shown.filter(it => st.sel.has(it.k)).length;
  const selKeys = shown.filter(it => st.sel.has(it.k)).map(it => it.k);

  const bankChips = [`<button class="chip${st.bank === 'all' ? ' on' : ''}" data-b="all">全部 ${items.length}</button>`]
    .concat(Object.keys(banksWith).map(id => {
      const b = allBanks().find(x => x.id === id) || { title: id };
      return `<button class="chip${st.bank === id ? ' on' : ''}" data-b="${id}">${esc(b.title)} ${banksWith[id]}</button>`;
    })).join('');

  /* 候补池 G：考点标签筛选（只列当前列表里真有的标签，按题数排） */
  const tagCount = {};
  items.forEach(it => tagListOf(it.k).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const tagNames = Object.keys(tagCount).filter(t => basics.indexOf(t) < 0).sort((a, b) => tagCount[b] - tagCount[a] || a.localeCompare(b, 'zh'));
  const basicChips = `<div class="basic-seg tag-basic-filter">
        <span class="basic-seg-label">基本</span>
        <div class="basic-seg-opts">
          <button type="button" class="basic-opt${st.base ? '' : ' on'}" data-basic="">全部<i>${items.length}</i></button>
          ${basics.map(t => `<button type="button" class="basic-opt${st.base === t ? ' on' : ''}" data-basic="${esc(t)}">${esc(t)}<i>${tagCount[t] || 0}</i></button>`).join('')}
        </div>
      </div>`;
  const tagChips = tagNames.length ? `
      <div class="chips-inline"><span class="tl" style="align-self:center">按考点</span>
        <button class="chip${st.tag ? '' : ' on'}" data-t="">全部 ${items.length}</button>
        ${tagNames.map(t => `<button class="chip${st.tag === t ? ' on' : ''}" data-t="${esc(t)}">${esc(t)} ${tagCount[t]}</button>`).join('')}
      </div>` : '';

  $('view').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="stats">
        <div><b>${items.length}</b><span>${isWrong ? '错题' : '收藏'}题目</span></div>
        <div><b>${openN}</b><span>还没做对</span></div>
        ${isWrong ? `<div><b>${dueItems.length}</b><span>今天到期</span></div>` : ''}
        <div><b>${totalTries}</b><span>累计作答</span></div>
        <div><b>${totalWrong}</b><span>累计答错</span></div>
        <div><b>${acc}%</b><span>总正确率</span></div>
      </div>
      ${isWrong ? `<div class="revbar">
        <div class="dueinfo"><b>${dueItems.length ? '今天有 ' + dueItems.length + ' 道错题到期该复习' : '今天没有到期的错题'}</b>
          <span class="small muted">间隔重复：答对拉长间隔（1/3/8/20… 天），答错当天打回队列</span></div>
        <button class="btn primary" id="wRevAll" ${dueItems.length ? '' : 'disabled'}>开始复习（${dueItems.length} 题）</button>
        <button class="btn" id="wRevSel" ${selKeys.length ? '' : 'disabled'}>复习选中的 ${selKeys.length} 题</button>
      </div>` : ''}
      <div class="chips-inline">${bankChips}</div>
      ${basicChips}
      ${(tagNames.length || st.tag) ? `<div class="tools tag-search-row">
        <span class="tl">标签</span>
        <input type="text" id="tagFind" class="num" list="tagFindList" style="min-width:160px;flex:1 1 160px" placeholder="输入标签查找，回车选定" value="${esc(st.tag || '')}">
        <datalist id="tagFindList">${tagNames.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
        ${st.tag ? '<button class="btn tiny" id="tagFindClear">清除</button>' : ''}
      </div>` : ''}

      <div class="tools">
        <span class="tl">找词</span>
        <input type="text" id="lkw" class="num" style="min-width:160px;flex:1 1 160px" placeholder="题干 / 选项 / 解析里的词，空格分多个" value="${esc(st.kw)}">
        ${st.kw ? '<button class="btn" id="lkwClear">清掉</button>' : ''}
        ${qaiBtnHtml('lkwAi')}
      </div>
      ${QAI.on ? qaiScopeHtml() : ''}
      ${QAI.on && kwQ.length >= 2 ? `<div class="tools" id="lkwAiRow">${qaiNoteHtml(kwQ, aiHits.length)}</div>` : ''}

      <div class="tools">
        <span class="tl">排序（点第二次反向）</span>
        ${Object.keys(SORTS).map(id => {
          const active = st.sort === id;
          const dir = active ? st.dir : SORTS[id].def;
          return `<button class="chip${active ? ' on' : ''}" data-s="${id}">${SORTS[id].label} ${ARROW(dir)}</button>`;
        }).join('')}
      </div>

      ${isWrong ? `<div class="tools">
        <span class="tl">筛选</span>
        <span class="tl">错次 ≥</span><input type="number" min="0" value="${st.minWrong}" id="minW" class="num">
        <label class="chk mini"><input type="checkbox" id="onlyOpen" ${st.onlyOpen ? 'checked' : ''}>只看还没做对的</label>
        <label class="chk mini"><input type="checkbox" id="onlyDue" ${st.onlyDue ? 'checked' : ''}>只看今天该复习的</label>
      </div>` : ''}

      <details class="fold">
        <summary>批量操作与导出 · 已选 <b>${selN}</b> 题</summary>
        <div class="fold-body">
          <div class="tools">
            <span class="tl">勾选</span>
            <button class="btn" id="selAll">全选（${shown.length}）</button>
            <button class="btn" id="selInv">反选</button>
            <button class="btn" id="selNone">清空</button>
          </div>

          <div class="tools">
            <span class="tl">对选中的题</span>
            <button class="btn" data-batch="fav">☆ 收藏</button>
            <button class="btn" data-batch="unfav">取消收藏</button>
            ${isWrong ? `<button class="btn" data-batch="kick">✗ 剔除错题（保留记录）</button>
            <button class="btn" data-batch="mastered">✓ 标记已掌握</button>
            <button class="btn" data-batch="clearCount">清空作答/错误次数</button>
            <button class="btn danger" data-batch="drop">移除记录</button>` : ''}
            <button class="btn" data-batch="tagAdd" title="给选中的题一起加一个考点标签（标签会加进你的考点词表）">+ 加考点标签</button>
            <button class="btn primary" data-batch="paper">组成套卷重做</button>
            <button class="btn" data-batch="exam">模拟考试</button>
          </div>

          <div class="tools" id="tagRow" style="display:none">
            <span class="tl">考点标签</span>
            <input type="text" id="batchTag" class="num" list="batchTagList" placeholder="写一个考点名（可从词表里挑）" style="min-width:170px;flex:1 1 170px">
            <datalist id="batchTagList">${tagVocabOptions()}</datalist>
            <button class="btn primary" id="batchTagOk">给选中的加</button>
            <button class="btn" id="batchTagCancel">取消</button>
          </div>

          ${paperRowsHtml()}

          <div class="tools">
            <span class="tl">导出</span>
            <label class="chk mini"><input type="checkbox" id="withExp" ${st.withExp ? 'checked' : ''}>含解析</label>
            <label class="chk mini"><input type="checkbox" id="withImg" ${st.withImg ? 'checked' : ''}>含图片</label>
            <label class="chk mini"><input type="checkbox" id="withSel" ${st.withSel ? 'checked' : ''}>含我的选择（错项）</label>
            <label class="chk mini"><input type="checkbox" id="withStat" ${st.withStat ? 'checked' : ''}>含错次统计</label>
            <select id="fmtSel" class="num">
              <option value="md">Markdown</option>
              <option value="html">HTML（可打印成PDF）</option>
              <option value="json">JSON</option>
            </select>
            <button class="btn primary" id="expSel" ${selN ? '' : 'disabled'}>导出选中（${selN}）</button>
            <button class="btn" id="expShown">导出当前列表（${shown.length}）</button>
          </div>
        </div>
      </details>
    </div>

    ${shown.length ? shown.map(it => itemHtml(it, mode, aiKeys.has(it.k))).join('')
      : `<div class="card"><div class="empty">${
        !items.length ? (isWrong ? '还没有错题。答错的题会自动进来。' : '还没有收藏。刷题时点右上角「☆ 收藏」。')
        : (!baseShown.length ? '当前筛选条件下没有题目，放宽一下条件试试。'
          : (QAI.on && kwQ.length >= 2 ? qaiEmptyText(kwQ) : '当前筛选条件下没有题目，放宽一下条件试试。'))
      }</div></div>`}
  `;

  staggerList($('view'));

  /* 事件 */
  $('view').querySelectorAll('.chips-inline .chip[data-b]').forEach(c => c.onclick = () => { st.bank = c.dataset.b; render(); });
  $('view').querySelectorAll('.tag-basic-filter [data-basic]').forEach(c => c.onclick = () => {
    st.base = c.getAttribute('data-basic') || '';
    render();
  });
  /* 考点标签 chip（和题库 chip 分开绑：它们没有 data-b） */
  $('view').querySelectorAll('.chips-inline .chip[data-t]').forEach(c => c.onclick = () => { st.tag = c.dataset.t || ''; render(); });
  const tagFind = $('tagFind');
  if (tagFind) {
    const applyTag = () => {
      const v = tagFind.value.trim();
      if (v === st.tag) return;
      st.tag = v;
      render();
      setTimeout(() => {
        const el = $('tagFind');
        if (el && (!document.activeElement || document.activeElement === document.body)) {
          try { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
        }
      }, 20);
    };
    tagFind.addEventListener('change', () => setTimeout(applyTag, 0));   /* 让点击别的按钮先落下去，别被重画吞掉 */
    tagFind.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); applyTag(); }
    });
  }
  on('tagFindClear', () => { st.tag = ''; render(); });
  /* 找词：边打边筛，但拼音候选期间绝不重画（否则选字会退回拼音） */
  const lkwEl = $('lkw');
  const applyLkw = () => {
    const el0 = $('lkw');
    if (!el0) return;
    const typing = document.activeElement && document.activeElement.id === 'lkw';
    st.kw = el0.value;
    render();
    if (typing) {
      const el = $('lkw');
      if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
    }
  };
  if (lkwEl) {
    lkwEl.addEventListener('compositionstart', () => {
      LP_COMPOSING = true;
      clearTimeout(LP_KW_T);
      clearTimeout(QAI.timer); QAI.timer = 0;
      qaiAbort();
    });
    lkwEl.addEventListener('compositionend', () => {
      LP_COMPOSING = false;
      clearTimeout(LP_KW_T);
      LP_KW_T = setTimeout(applyLkw, 60);
    });
    lkwEl.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(LP_KW_T);
      applyLkw();                              /* 先按当前词本地筛 */
      if (QAI.on) qaiSchedule(st.kw, 0);       /* 回车才发 AI */
    });
  }
  on('lkw', (e) => {
    if (LP_COMPOSING || (e && (e.isComposing || e.keyCode === 229))) return;
    clearTimeout(LP_KW_T);
    clearTimeout(QAI.timer); QAI.timer = 0;
    qaiAbort();                                  /* 改了词：取消还没回来的旧请求，省 token */
    LP_KW_T = setTimeout(applyLkw, 260);
  }, 'input');
  on('lkwClear', () => { clearTimeout(LP_KW_T); clearTimeout(QAI.timer); QAI.timer = 0; qaiAbort(); st.kw = ''; render(); });
  on('lkwAi', qaiToggleList);
  $('view').querySelectorAll('[data-qscope]').forEach(c => c.onclick = () => {
    QAI.scope = c.getAttribute('data-qscope') || 'all';
    qaiSave();
    qaiPaintScope();
    render();
  });
  qaiBindNote($('view'), kwQ);
  $('view').querySelectorAll('[data-s]').forEach(c => c.onclick = () => {
    const id = c.dataset.s;
    if (st.sort === id) st.dir = -(st.dir || SORTS[id].def);
    else { st.sort = id; st.dir = SORTS[id].def; }
    render();
  });
  on('minW', () => { st.minWrong = Math.max(0, +$('minW').value || 0); render(); }, 'change');
  on('onlyOpen', () => { st.onlyOpen = $('onlyOpen').checked; render(); }, 'change');
  on('onlyDue', () => { st.onlyDue = $('onlyDue').checked; render(); }, 'change');
  on('wRevAll', () => makePaper('错题复习 · ' + dueItems.length + ' 题', dueItems.map(it => it.k)));
  on('wRevSel', () => makePaper('错题复习 · ' + selKeys.length + ' 题', selKeys));
  on('withExp', () => { st.withExp = $('withExp').checked; render(); }, 'change');
  on('withImg', () => { st.withImg = $('withImg').checked; render(); }, 'change');
  on('withSel', () => { st.withSel = $('withSel').checked; render(); }, 'change');
  on('withStat', () => { st.withStat = $('withStat').checked; render(); }, 'change');
  bindCommonTools(mode, shown);
  on('expSel', () => doExport(mode, shown.filter(it => st.sel.has(it.k)), $('fmtSel').value, st));
  on('expShown', () => doExport(mode, shown, $('fmtSel').value, st));

  $('view').querySelectorAll('.wi').forEach(node => {
    const it = shown.find(x => x.k === node.dataset.k);
    if (it) bindItem(node, mode, it);
  });
  richBindAll($('view'));                        // 方案十：展开着的解析块可以就地改
  /* AI 结果回来会重画整页；把「找词」焦点和光标接回去（组合输入期间不会走到这里） */
  if (QAI_FOCUS && Date.now() - QAI_FOCUS.t < 1600 && (!document.activeElement || document.activeElement === document.body)) {
    const el = $('lkw');
    if (el) { try { el.focus(); el.setSelectionRange(QAI_FOCUS.pos, QAI_FOCUS.pos); } catch (e) {} }
  }
  QAI_FOCUS = null;
}

/* 列表页通用交互：勾选 + 批量 + 套卷/试卷命名行（各列表页共用） */
function bindCommonTools(mode, shown) {
  const st = LP[mode];
  on('selAll', () => { shown.forEach(it => st.sel.add(it.k)); render(); });
  on('selInv', () => { shown.forEach(it => st.sel.has(it.k) ? st.sel.delete(it.k) : st.sel.add(it.k)); render(); });
  on('selNone', () => { st.sel.clear(); render(); });
  document.querySelectorAll('[data-batch]').forEach(b => b.onclick = () => batch(mode, b.dataset.batch));
  /* ③ 批量加考点标签：输入框里写名字（候选来自考点词表），一次给选中的题都贴上 */
  on('batchTagOk', () => {
    const el = $('batchTag');
    const name = String((el && el.value) || '').trim().replace(/\s+/g, ' ').slice(0, 14);
    if (!name) { toast('先写一个考点名'); return; }
    if (!(window.TAGS && typeof window.TAGS.add === 'function')) { toast('标签模块没加载'); return; }
    const keys = (st.shown || []).filter(it => st.sel.has(it.k)).map(it => it.k);
    if (!keys.length) { toast('先勾选题目'); return; }
    const snap = keys.map(k => [k, window.TAGS.of(k)]);
    keys.forEach(k => window.TAGS.add(k, [name]));
    try { if (typeof window.TAGS.rememberVocab === 'function') window.TAGS.rememberVocab([name]); } catch (e) {}
    if (el) el.value = '';
    const row = $('tagRow'); if (row) row.style.display = 'none';
    render();
    toast(`已给 ${keys.length} 题加上「${name}」`, 5000, '', {
      label: '撤销', fn: () => { snap.forEach(([k, v]) => window.TAGS.set(k, v)); render(); toast('已撤销', 1400, 'ok'); }
    });
  });
  on('batchTagCancel', () => { const row = $('tagRow'); if (row) row.style.display = 'none'; });
  on('paperOk', () => makePaper(($('paperName').value || '').trim() || '临时套卷', st.pendingKeys || []));
  on('paperCancel', () => { st.pendingKeys = []; $('paperRow').style.display = 'none'; });
  on('examOk', () => {
    const keysAll = st.pendingKeys || [];
    const lim = Math.max(1, Math.min(keysAll.length, +$('examLimit').value || keysAll.length));
    const mins = Math.max(0, +$('examMin').value || 0);
    const nm = ($('examName').value || '').trim() || ('模拟考试 · ' + lim + ' 题');
    makePaper(nm, shuffle(keysAll).slice(0, lim), { exam: true, duration: mins * 60 });
  });
  on('examCancel', () => { st.pendingKeys = []; $('examRow').style.display = 'none'; });
}

/* 套卷 / 试卷命名行 */
function paperRowsHtml() {
  return `
      <div class="tools" id="paperRow" style="display:none">
        <span class="tl">套卷名称</span>
        <input type="text" id="paperName" class="num" style="min-width:180px;flex:1 1 180px">
        <button class="btn primary" id="paperOk">生成并开始做</button>
        <button class="btn" id="paperCancel">取消</button>
      </div>
      <div class="tools" id="examRow" style="display:none">
        <span class="tl">试卷名称</span>
        <input type="text" id="examName" class="num" style="min-width:150px;flex:1 1 150px">
        <span class="tl">题数</span><input type="number" id="examLimit" class="num" min="1" style="width:76px">
        <span class="tl">时长(分钟)</span><input type="number" id="examMin" class="num" min="0" style="width:76px">
        <button class="btn primary" id="examOk">开始考试</button>
        <button class="btn" id="examCancel">取消</button>
      </div>`;
}
function batch(mode, op) {
  const st = LP[mode];
  const sel = (st.shown || []).filter(it => st.sel.has(it.k));
  if (!sel.length) { toast('先勾选题目'); return; }
  const n = sel.length;
  const keys = sel.map(it => it.k);

  if (op === 'fav') {
    keys.forEach(k => FAV[k] = Date.now());
    saveFav(); toast(`已收藏 ${n} 题`); render();
  } else if (op === 'unfav') {
    keys.forEach(k => { delete FAV[k]; tombAdd('fav', k); });
    saveFav(); toast(`已取消收藏 ${n} 题`); render();
  } else if (op === 'kick' || op === 'mastered') {
    /* 核心功能 ③：批量「剔除错题 / 标记已掌握」——只动「错题 / 待复习」标记，作答历史留着 */
    const snap = [];
    keys.forEach(k => {
      const a = ANS[k];
      if (!a) return;
      snap.push([k, JSON.parse(JSON.stringify(a))]);
      a.wrong = 0;                             /* inSrs() 看的就是 wrong>0：清了它就不算错题、也不排复习了 */
      if (op === 'mastered') { a.ok = true; a.redo = false; }
      a.upd = Date.now();                      /* 时间戳往后推：云同步合并时不会被旧记录盖回来 */
    });
    saveAns(); keys.forEach(k => st.sel.delete(k)); render();
    const what = (op === 'mastered') ? '标记已掌握' : '剔除';
    toast(`已${what} ${snap.length} 题（作答记录留着）`, 5000, '', {
      label: '撤销', fn: () => {
        snap.forEach(([k, v]) => { v.upd = Date.now(); ANS[k] = v; });   /* 时间戳再往后推：不然合并时被刚才那条更新的记录挡住 */
        saveAns(); render(); toast(`已恢复 ${snap.length} 题`, 1400, 'ok');
      }
    });
  } else if (op === 'tagAdd') {
    const row = $('tagRow');
    if (!row) return;
    row.style.display = (row.style.display === 'none' || !row.style.display) ? '' : 'none';
    if (row.style.display !== 'none') { const el = $('batchTag'); if (el) el.focus(); }
  } else if (op === 'drop') {
    if (!confirm(`把选中的 ${n} 道题的作答记录（含错题次数）移除？不可恢复。`)) return;
    /* 候补池 E：先拍一份快照，5 秒内可以撤销（连带把墓碑删掉，不然同步会又把它删回来） */
    const snap = keys.map(k => [k, ANS[k] ? JSON.parse(JSON.stringify(ANS[k])) : null]);
    keys.forEach(k => { delete ANS[k]; tombAdd('ans', k); st.sel.delete(k); });
    saveAns(); render();
    toast(`已移除 ${n} 题`, 5000, '', {
      label: '撤销', fn: () => {
        snap.forEach(([k, v]) => { if (v) ANS[k] = v; });
        try { if (typeof TOMB !== 'undefined' && TOMB.ans) { keys.forEach(k => delete TOMB.ans[k]); writeLS(TOMB_KEY, TOMB); } } catch (e) {}
        saveAns(); render(); toast(`已恢复 ${n} 题`, 1400, 'ok');
      }
    });
  } else if (op === 'clearCount') {
    if (!confirm(`把选中的 ${n} 道题的作答次数和答错次数清零？题目本身不删，但清零后就不再算「错题」了（想留着可以先收藏）。`)) return;
    const snap = keys.map(k => [k, ANS[k] ? JSON.parse(JSON.stringify(ANS[k])) : null]);
    keys.forEach(k => {
      const a = ANS[k];
      if (!a) return;
      a.tries = 0; a.wrong = 0; a.ts = 0; a.upd = Date.now(); a.redo = true;   // upd 让「清零」在合并时也不会被旧记录盖回去
    });
    saveAns(); render();
    toast(`已清空 ${n} 题的次数`, 5000, '', {
      label: '撤销', fn: () => {
        snap.forEach(([k, v]) => { if (v) ANS[k] = v; });
        saveAns(); render(); toast(`已恢复 ${n} 题`, 1400, 'ok');
      }
    });
  } else if (op === 'paper') {
    const suggest = (mode === 'wrong' ? '错题套卷' : mode === 'fav' ? '收藏套卷' : '复习套卷') + ' · ' + n + ' 题';
    st.pendingKeys = keys;
    const row = $('paperRow');
    if (row) {
      row.style.display = 'flex';
      $('paperName').value = suggest;
      $('paperName').focus();
      toast('给套卷起个名字，点「生成并开始做」');
    } else { makePaper(suggest, keys); }
  } else if (op === 'exam') {
    st.pendingKeys = keys;
    const row = $('examRow');
    if (!row) { makePaper('模拟考试 · ' + n + ' 题', shuffle(keys).slice(0, 50), { exam: true, duration: 3600 }); return; }
    row.style.display = 'flex';
    $('examName').value = '模拟考试 · ' + n + ' 题';
    $('examLimit').value = Math.min(n, 50);
    $('examMin').value = 60;
    $('examName').focus();
    toast('设好题数和时长，点「开始考试」');
  }
}

/* 搜索高亮：没有关键词时等同于 esc()，有就包一层 <mark>。
   关键词也要先转义，才能和转义后的正文对齐。 */
let HL_KW = '';
function hl(s) {
  const t = esc(s == null ? '' : s);
  const parts = splitKw(HL_KW).map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!parts.length) return t;
  try { return t.replace(new RegExp('(' + parts.join('|') + ')', 'gi'), '<mark>$1</mark>'); } catch (e) { return t; }
}

/* 关键词不在题干里时，抠一小段带关键词的原文出来（搜索列表里不用展开就能看到命中处） */
function hitSnippet(it) {
  const terms = splitKw(HL_KW);
  if (!terms.length) return null;
  const q = it.q, b = it.bank;
  const low = s => String(s == null ? '' : s).toLowerCase();
  const pick = (label, text) => {
    const t = String(text == null ? '' : text);
    const at = low(t).indexOf(terms[0]);
    if (at < 0) return null;
    const from = Math.max(0, at - 24), to = Math.min(t.length, at + terms[0].length + 40);
    return { label: label, text: (from > 0 ? '…' : '') + t.slice(from, to) + (to < t.length ? '…' : '') };
  };
  if (low(q.stem).indexOf(terms[0]) >= 0) return null;        // 题干里就有，不用另抠
  const opts = (q.options || []).map((o, i) => pick('选项 ' + 'ABCDEFGH'[i], optText(o, 'ABCDEFGH'[i]))).filter(Boolean);
  return opts[0] || pick('解析', explainOf(it.k, q)) || pick('题库名', b && b.title) || pick('题干补充', q.group);
}

/* ---------------- 单条 ---------------- */
function itemHtml(it, mode, aiHit) {
  const k = it.k, q = it.q, rec = it.rec, st = LP[mode];
  const open = st.open.has(k);
  const sel = st.sel.has(k);
  const custom = !!noteOf(k);
  const fav = !!FAV[k];
  const mastered = rec.ok === true && !rec.redo;
  const stem = q.stem.length > 46 ? q.stem.slice(0, 46) + '…' : q.stem;
  const where = (mode === 'search') ? hitWhere(it) : '';
  const snippet = (mode === 'search') ? hitSnippet(it) : null;
  return `
  <div class="card wi${aiHit ? ' ai-wi' : ''}" data-k="${esc(k)}">
    <div class="wi-head">
      <input type="checkbox" class="wsel" ${sel ? 'checked' : ''} title="勾选后可批量操作">
      <span class="wno">${qLabel(it)}</span>
      <span class="tag g">${esc(it.bank.title)}</span>
      ${aiHit ? '<span class="mini-tag ai" title="AI 把描述扩展成同义词后命中的">AI 模糊</span>' : ''}
      ${where ? `<span class="mini-tag hit" title="关键词不在题干里，是在这里命中的">命中：${esc(where)}</span>` : ''}
      ${hasFix(k) ? '<span class="mini-tag" title="答案是你手动改过的，只在本机生效">答案已修正</span>' : ''}
      ${mode === 'wrong'
        ? `<span class="wmeta ${mastered ? 'good' : 'bad'}">错 ${rec.wrong || 0} 次 · 作答 ${rec.tries || 0} 次 · 正确率 ${rateOf(rec)}%${mastered ? ' · 已做对' : ''}</span>`
        : mode === 'due'
        ? `<span class="wmeta">${dueText(k)} · 错 ${rec.wrong || 0} 次 / 作答 ${rec.tries || 0} 次 · 正确率 ${rateOf(rec)}%</span>`
        : `<span class="wmeta">${rec.tries ? `作答 ${rec.tries} 次 · 错 ${rec.wrong || 0} 次 · 正确率 ${rateOf(rec)}%` : '还没做过'}${mode === 'search' ? ' · ' + dueText(k) : ''}</span>`}
      <span class="spacer-grow"></span>
      <button class="btn tiny" data-act="open">${open ? '收起' : '展开'}</button>
      <button class="btn tiny" data-act="fav">${fav ? '★' : '☆'}</button>
      ${(mode === 'wrong' || mode === 'fav') ? `<button class="btn tiny danger" data-act="${mode === 'wrong' ? 'drop' : 'unfav'}" title="${mode === 'wrong' ? '移除这条记录' : '取消收藏'}">×</button>` : ''}
    </div>
    ${open ? '' : `<div class="wi-stem">${hl(stem)}</div>`}
    ${(open || !snippet) ? '' : `<div class="wi-hit"><b>${esc(snippet.label)}</b>${hl(snippet.text)}</div>`}
    ${open ? `
    <div class="wi-body">
      ${q.group ? `<div class="gstem"><b>共用题干：</b>${hl(q.group)}</div>` : ''}
      <div class="stem-sm">${hl(q.stem)}</div>
      <div class="opts-sm">${q.options.map((o, i) => {
        const K = 'ABCDEFGH'[i];
        const right = ansOf(k, q).includes(K);
        const mine = (rec.sel || []).includes(K);
        return `<div class="o ${right ? 'r' : ''}${mine && !right ? ' w' : ''}"><b>${K}</b>${hl(optText(o, K))}${right ? '<span class="mini-tag ok">正确</span>' : ''}${mine && !right ? '<span class="mini-tag bad">我选的</span>' : ''}</div>`;
      }).join('')}</div>
      <div class="small" style="margin:6px 0">我的选择：<b>${(rec.sel || []).join('') || '—'}</b>${rec.ts ? `　最近作答：${fmtTime(rec.ts)}` : ''}　错 ${rec.wrong || 0} 次 / 作答 ${rec.tries || 0} 次${custom ? '　<span class="mini-tag">已自定义解析</span>' : ''}</div>
      ${richBox(k, explainOf(k, q), custom, '解析')}
      <div class="actions" style="margin-top:10px">
        <button class="btn" data-act="note">${custom ? '改解析' : '写解析'}</button>
        <button class="btn" data-act="fix" title="题库答案写错了 / 自己点错了：可以在这里改">${hasFix(k) ? '改答案（已修正）' : '改答案'}</button>
        <button class="btn" data-act="ai" title="让 AI 写解析（可以带上本地知识库的资料）">AI 解析</button>
        <button class="btn" data-act="variant" title="让 AI 照这道题出几道同考点的新题（变式题），并跟库里相似的老题对比">变式题</button>
        ${(mode === 'wrong' || mode === 'due') ? `<button class="btn" data-act="kick" title="只把「错题 / 待复习」标记去掉，作答次数、收藏、自定义解析都留着（5 秒内可撤销）">✗ 剔除错题</button>` : ''}
        <button class="btn" data-act="link">去题库里做这道题</button>
      </div>
      <div class="note-host"></div>
      <div class="fix-host"></div>
      <div class="ai-host"></div>
      <div class="v-host"></div>
    </div>` : ''}
  </div>`;
}

/* 面板宿主：卡片没展开时那一格还没生成 —— 先展开，再把面板开在新行里 */
function itemHost(node, st, k, sel) {
  let h = node.querySelector(sel);
  if (!h) {
    st.open.add(k); render();
    const nd = document.querySelector('[data-k="' + String(k).replace(/["\\]/g, '\\$&') + '"]');
    h = nd && nd.querySelector(sel);
  }
  return h;
}

function bindItem(node, mode, it) {
  const st = LP[mode], k = node.dataset.k;
  const box = node.querySelector('.wsel');
  if (box) box.onchange = () => { box.checked ? st.sel.add(k) : st.sel.delete(k); render(); };
  node.querySelectorAll('[data-act]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'open') { st.open.has(k) ? st.open.delete(k) : st.open.add(k); render(); }
    else if (act === 'fav') { toggleFav(k, btn); }
    else if (act === 'unfav') { delete FAV[k]; tombAdd('fav', k); saveFav(); st.sel.delete(k); toast('已取消收藏'); render(); }
    else if (act === 'drop') {
      if (!confirm('把这道题的作答记录（含错题次数）移除？不可恢复。')) return;
      delete ANS[k]; tombAdd('ans', k); saveAns(); st.sel.delete(k); toast('已移除'); render();
    }
    else if (act === 'kick') {
      /* 核心功能 ②：单题一键剔除 —— 只清「错题 / 待复习」标记，作答次数、收藏、自定义解析都留着 */
      const a = ANS[k];
      if (!a) { toast('这道题没有作答记录'); return; }
      const snap = JSON.parse(JSON.stringify(a));
      a.wrong = 0; a.upd = Date.now();
      saveAns(); st.sel.delete(k); render();
      toast('已从错题本剔除（作答记录留着）', 5000, '', {
        label: '撤销', fn: () => { snap.upd = Date.now(); ANS[k] = snap; saveAns(); render(); toast('已恢复', 1400, 'ok'); }
      });
    }
    else if (act === 'note') openNoteEditor(k, node.querySelector('.note-host'), it.q, render);
    else if (act === 'fix') openAnsEditor(node.querySelector('.fix-host'), k, it.q, render);
    else if (act === 'ai' || act === 'variant') {
      const fn = act === 'ai' ? window.aiOpenPanel : window.openVariant;
      const cls = act === 'ai' ? '.ai-host' : '.v-host';
      if (typeof fn !== 'function') { toast((act === 'ai' ? 'AI 模块' : '变式题模块') + '没加载'); return; }
      const h = itemHost(node, st, k, cls);
      if (h) fn(h, k, it.q);
    }
    else if (act === 'link') {
      const b = allBanks().find(x => !x.paper && k.indexOf(x.id + '#') === 0);
      if (!b) return;
      const qid = k.slice(b.id.length + 1);
      /* 搜索页筛的是「错题 / 收藏 / 待复习 / 没做过」时，进答题页继续按这个范围走 */
      const sc = (typeof LP !== 'undefined' && LP && LP.search && LP.search.scope) || 'all';
      QZ.filter = (sc === 'wrong' || sc === 'fav' || sc === 'due' || sc === 'undone') ? sc : 'all';
      QZ.order = null; QZ.cur = isNaN(+qid) ? qid : +qid;
      QZ.focusCur = true;
      go('#/bank/' + b.id);
    }
  });
  /* 重画之后把这一行的「AI 解析」面板挂回来：勾选 / 展开收起 / 收藏 / 别的标签页同步都不会再冲掉正在生成的解析 */
  { const ah = node.querySelector('.ai-host');
    if (ah && typeof aiReopenFor === 'function') { try { aiReopenFor(ah, k); } catch (e) {} } }
}

/* ---------------- 导出 ---------------- */
function doExport(mode, items, fmt, st) {
  if (!items.length) { toast('没有可导出的题目'); return; }
  const withExp = st.withExp !== false, withImg = st.withImg !== false;
  const withSel = st.withSel !== false, withStat = st.withStat !== false;
  const bankName = st.bank === 'all' ? '' : (allBanks().find(b => b.id === st.bank) || {}).title;
  const title = (mode === 'wrong' ? '错题集' : mode === 'fav' ? '收藏集' : '搜索结果') + (bankName ? ' · ' + bankName : '');
  const base = safeName(title) + '-' + stamp();
  const opt = { withExp: withExp, withImg: withImg, withSel: withSel, withStat: withStat };

  if (fmt === 'json') {
    const data = {
      kind: mode, exportedAt: new Date().toISOString(), options: opt,
      items: items.map(it => ({
        bankId: it.bank.id, bankTitle: it.bank.title, qid: it.q.id,
        stem: it.q.stem, group: it.q.group || '', options: it.q.options, answer: ansOf(it.k, it.q),
        explain: withExp ? explainOf(it.k, it.q) : '',
        custom: !!noteOf(it.k),
        images: withImg ? ((noteOf(it.k) || {}).imgs || []).map(x => x.src) : [],
        myChoice: withSel ? (it.rec.sel || []) : [],
        tries: withStat ? (it.rec.tries || 0) : null,
        wrong: withStat ? (it.rec.wrong || 0) : null
      }))
    };
    download(base + '.json', JSON.stringify(data, null, 2), 'application/json');
  } else if (fmt === 'html') {
    download(base + '.html', buildHtml(title, items, opt), 'text/html');
  } else {
    download(base + '.md', buildMd(title, items, opt), 'text/markdown');
  }
  toast('已导出 ' + items.length + ' 题');
}

function metaLine(it, o) {
  const parts = ['**正确答案：' + ansOf(it.k, it.q).join('') + '**'];
  if (o.withSel) parts.push('我的选择：' + ((it.rec.sel || []).join('') || '—'));
  if (o.withStat) parts.push(`错 ${it.rec.wrong || 0} 次 / 作答 ${it.rec.tries || 0} 次　正确率 ${rateOf(it.rec)}%`);
  return parts.join('　');
}
function metaLineHtml(it, o) {
  const parts = ['<b>正确答案：' + ansOf(it.k, it.q).join('') + '</b>'];
  if (o.withSel) parts.push('我的选择：' + ((it.rec.sel || []).join('') || '—'));
  if (o.withStat) parts.push(`错 ${it.rec.wrong || 0} 次 / 作答 ${it.rec.tries || 0} 次　正确率 ${rateOf(it.rec)}%`);
  return parts.join('　');
}

function buildMd(title, items, o) {
  const L = [];
  L.push('# ' + title);
  L.push('');
  L.push('> 导出时间：' + fmtTime(Date.now()) + '　共 ' + items.length + ' 题' + (o.withStat ? '' : ''));
  L.push('');
  items.forEach((it, i) => {
    L.push('---');
    L.push('');
    L.push(`## ${i + 1}. ${it.bank.title} · ${qLabel(it)}`);
    L.push('');
    if (it.q.group) { L.push('> **共用题干**：' + it.q.group); L.push(''); }
    L.push(it.q.stem);
    L.push('');
    it.q.options.forEach((opt, j) => L.push('ABCDEFGH'[j] + '. ' + opt));
    L.push('');
    L.push(metaLine(it, o));
    L.push('');
    if (o.withExp) {
      const ex = explainOf(it.k, it.q);
      if (ex) { L.push('**解析**'); L.push(''); L.push(ex); L.push(''); }
      if (o.withImg) ((noteOf(it.k) || {}).imgs || []).forEach(im => { L.push(`![${im.name || '图'}]( ${im.src} )`); L.push(''); });
    }
  });
  return L.join('\n');
}

function buildHtml(title, items, o) {
  const body = items.map((it, i) => {
    const opts = it.q.options.map((t, j) => {
      const K = 'ABCDEFGH'[j], right = ansOf(it.k, it.q).includes(K), mine = (it.rec.sel || []).includes(K);
      return `<div class="o${right ? ' r' : ''}${mine && !right ? ' w' : ''}"><b>${K}</b> ${esc(t)}${right ? '<span class="t ok">正确</span>' : ''}${mine && !right ? '<span class="t bad">我选的</span>' : ''}</div>`;
    }).join('');
    const imgs = o.withImg ? ((noteOf(it.k) || {}).imgs || []) : [];
    return `<section class="q">
      <h2>${i + 1}. ${esc(it.bank.title)} · ${esc(qLabel(it))}</h2>
      ${it.q.group ? `<div class="g"><b>共用题干：</b>${esc(it.q.group)}</div>` : ''}
      <div class="stem">${esc(it.q.stem)}</div>
      <div class="opts">${opts}</div>
      <div class="meta">${metaLineHtml(it, o)}</div>
      ${o.withExp ? `<div class="exp"><b>解析</b>${mdToHtml(explainOf(it.k, it.q))}${imgs.map(im => `<img src="${im.src}" alt="">`).join('')}</div>` : ''}
    </section>`;
  }).join('\n');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
body{font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#1c1f23}
.tbl-wrap{overflow-x:auto;margin:10px 0}
h1{font-size:22px} .intro{color:#6b7280;font-size:13px;margin-bottom:20px}
.q{border-top:1px solid #e5e7eb;padding:18px 0}
.q h2{font-size:15px;margin:0 0 10px}
.g{background:#f8fafc;border-left:3px solid #cbd5e1;padding:8px 12px;margin-bottom:10px;font-size:14px;color:#334155}
.stem{margin-bottom:10px;white-space:pre-wrap}
.o{border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin-bottom:6px}
.o.r{background:#eaf7ee;border-color:#86efac} .o.w{background:#fdeeee;border-color:#fca5a5}
.t{font-size:11px;padding:1px 7px;border-radius:99px;margin-left:6px}
.t.ok{background:#15803d;color:#fff} .t.bad{background:#dc2626;color:#fff}
.meta{font-size:13.5px;color:#374151;margin:10px 0}
.exp{border-top:1px dashed #d9dde3;padding-top:10px;font-size:14px;color:#374151}
.exp img{max-width:100%;display:block;margin:10px 0;border:1px solid #e5e7eb;border-radius:8px}
.exp h1,.exp h2,.exp h3,.exp h4{font-size:15px;margin:10px 0 6px}
.exp blockquote{border-left:3px solid #cbd5e1;margin:8px 0;padding:2px 10px;color:#475569}
.exp code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:13px}
.exp table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13.5px}
.exp th,.exp td{border:1px solid #e5e7eb;padding:6px 9px;vertical-align:top;text-align:left}
.exp th{background:#f8fafc;font-weight:700}
.exp tbody tr:nth-child(even){background:#fcfdfe}
@media print{ body{padding:0} .q{page-break-inside:avoid} }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="intro">导出时间：${fmtTime(Date.now())}　共 ${items.length} 题　（用浏览器「打印 → 另存为 PDF」即可得到 PDF）</div>
${body}
</body></html>`;
}

/* ---------------- 搜索 ---------------- */
/* ⚠ 搜索框千万不能在输入过程中被重建：<input> 一被销毁重建，中文输入法的候选就断了，
   最后只剩一串拼音字母。所以这里把「搜索框骨架」和「结果区」拆开：
   骨架只在进入搜索页时搭一次，之后打字 / 切范围 / 展开题目都只重画 #sres。 */
const HIST_KEY = 'qbank.searchhist.v1';
let SHIST = readLS(HIST_KEY, []);
if (!Array.isArray(SHIST)) SHIST = [];
let sTimer = 0, sComposing = false;

function pushHist(kw) {
  kw = String(kw || '').trim();
  if (!kw) return;
  if (SHIST[0] && (kw.indexOf(SHIST[0]) === 0 || SHIST[0].indexOf(kw) === 0)) SHIST[0] = kw;   // 一边打一边搜，只留最后一条
  else if (SHIST[0] !== kw) SHIST.unshift(kw);
  SHIST = SHIST.filter((x, i) => x && SHIST.indexOf(x) === i).slice(0, 12);
  writeLS(HIST_KEY, SHIST);
}

function scheduleSearch(now) {
  clearTimeout(sTimer);
  sTimer = setTimeout(() => { pushHist(LP.search.kw); paintSearch(); }, now ? 0 : 170);
}

/* 上次搜的关键词 / 范围也存一份：下次进搜索页自动带出来（在搜索框里清空就没了） */
const LAST_KEY = 'qbank.searchlast.v1';
function saveLast() {
  try { writeLS(LAST_KEY, { kw: LP.search.kw || '', scope: LP.search.scope || 'all' }); } catch (e) {}
}
function readLast() {
  const v = readLS(LAST_KEY, null);
  return (v && typeof v === 'object') ? v : null;
}

function renderSearch() {
  const st = LP.search;
  /* 这一轮第一次进搜索页：把上次的关键词和范围带回来 */
  if (!st.touched) {
    st.touched = true;
    const L = readLast();
    if (L && L.kw) { st.kw = L.kw; st.scope = L.scope || 'all'; }
  }
  $('appTitle').textContent = '搜索题目';
  $('stat').textContent = ''; $('bar').style.width = '0%';

  const shell = $('sbar');
  if (!shell || !$('view').contains(shell)) {
    $('view').innerHTML = `
      <div class="card sbar-sticky" id="sbar" style="margin-bottom:14px">
        <div class="field" style="margin-top:0">
          <label>关键词（题干 / 选项 / 解析 / 题库名都能搜；空格分开＝每个词都要命中）　按 <b>/</b> 可直接聚焦这里</label>
          <div class="sbox-row">
            <div class="sbox">
              <input type="text" id="sq" value="${esc(st.kw || '')}" placeholder="例如：肾素　PaO2　树胶样肿" autocomplete="off" spellcheck="false">
              <button class="btn tiny" id="sqClear" title="清空" style="display:${st.kw ? '' : 'none'}">×</button>
            </div>
            ${qaiBtnHtml('sqAi')}
          </div>
          ${qaiScopeHtml()}
          <div class="basic-seg tag-basic-filter" id="sqBasicRow">
            <span class="basic-seg-label">基本</span>
            <div class="basic-seg-opts">
              <button type="button" class="basic-opt${st.base ? '' : ' on'}" data-basic="">全部</button>
              ${basicTags().map(t => `<button type="button" class="basic-opt${st.base === t ? ' on' : ''}" data-basic="${esc(t)}">${esc(t)}</button>`).join('')}
            </div>
          </div>
          <div class="tools tag-search-row">
            <span class="tl">标签</span>
            <input type="text" id="sqTag" class="num" list="sqTagList" style="min-width:160px;flex:1 1 160px" placeholder="输入标签查找，回车选定" value="${esc(st.tag || '')}">
            <datalist id="sqTagList">${tagVocabOptions(true)}</datalist>
            <button class="btn tiny" id="sqTagClear" style="display:${st.tag ? '' : 'none'}">清除</button>
          </div>
        </div>
        <div class="tools" id="shistRow" style="margin-top:8px"></div>
      </div>
      <div id="sres"></div>`;

    const el = $('sq');
    /* 中文输入法：组合期间绝不重画结果，等 compositionend 再搜 */
    el.addEventListener('compositionstart', () => {
      sComposing = true;
      clearTimeout(QAI.timer); QAI.timer = 0;
      qaiAbort();
    });
    el.addEventListener('compositionend', () => {
      sComposing = false;
      st.kw = el.value;
      clearTimeout(sTimer);
      pushHist(st.kw);
      paintSearch();
    });
    el.addEventListener('input', () => {
      st.kw = el.value;
      const c = $('sqClear'); if (c) c.style.display = el.value ? '' : 'none';
      if (sComposing) return;                 // 拼音还在候选框里，先别搜
      scheduleSearch(false);
      clearTimeout(QAI.timer); QAI.timer = 0; qaiAbort();   /* 打字不发 AI；回车才发 */
    });
    el.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;   /* 回车选字不能当成「立刻搜」 */
      if (e.key === 'Enter') {
        e.preventDefault(); clearTimeout(sTimer); st.kw = el.value; pushHist(st.kw); paintSearch(true);
        if (QAI.on) qaiSchedule(st.kw, 0);
      }
      else if (e.key === 'Escape') {
        e.preventDefault(); st.kw = ''; el.value = '';
        const c = $('sqClear'); if (c) c.style.display = 'none';
        clearTimeout(QAI.timer); QAI.timer = 0; qaiAbort();
        paintSearch();
      }
    });
    on('sqClear', () => { st.kw = ''; el.value = ''; const c = $('sqClear'); if (c) c.style.display = 'none'; clearTimeout(QAI.timer); QAI.timer = 0; qaiAbort(); el.focus(); paintSearch(); });
    on('sqAi', qaiToggleSearch);
    $('sbar').querySelectorAll('[data-qscope]').forEach(c => c.onclick = () => {
      QAI.scope = c.getAttribute('data-qscope') || 'all';
      qaiSave();
      qaiPaintScope();
      paintSearch();
    });
    $('sbar').querySelectorAll('[data-basic]').forEach(c => c.onclick = () => {
      st.base = c.getAttribute('data-basic') || '';
      $('sbar').querySelectorAll('[data-basic]').forEach(b => {
        b.classList.toggle('on', (b.getAttribute('data-basic') || '') === st.base);
      });
      paintSearch();
    });
    const sqTag = $('sqTag');
    if (sqTag) {
      const applyTag = () => {
        st.tag = sqTag.value.trim();
        const c = $('sqTagClear'); if (c) c.style.display = st.tag ? '' : 'none';
        paintSearch();
      };
      sqTag.addEventListener('change', applyTag);
      sqTag.addEventListener('keydown', e => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); applyTag(); }
      });
    }
    on('sqTagClear', () => {
      st.tag = '';
      const el = $('sqTag'); if (el) el.value = '';
      const c = $('sqTagClear'); if (c) c.style.display = 'none';
      const el2 = $('sqTag'); if (el2) el2.focus();
      paintSearch();
    });
    setTimeout(() => { try { el.focus(); } catch (e) {} }, 40);
  }
  paintSearch();
}

function paintSearch(anim) {
  const st = LP.search, host = $('sres');
  if (!host) return;
  const kw = String(st.kw || '').trim();
  HL_KW = kw;
  const scope = st.scope || 'all';
  const scopeOK = it => scope === 'all' ? true
    : scope === 'wrong' ? (it.rec.wrong || 0) > 0
    : scope === 'fav' ? !!FAV[it.k]
    : scope === 'due' ? isDue(it.k)
    : scope === 'undone' ? !ANS[it.k] : true;
  const tagOK = it => !st.tag || tagListOf(it.k).indexOf(st.tag) >= 0;
  const baseOK = it => !st.base || tagListOf(it.k).indexOf(st.base) >= 0;
  let local = kw ? collect('all', kw, QAI.on ? QAI.scope : '').filter(scopeOK).filter(tagOK).filter(baseOK) : [];
  const aiCache = (QAI.on && kw.length >= 2) ? qaiCached(kw) : null;
  const aiTerms = (aiCache && aiCache.terms) || [];
  const aiHits = aiTerms.length ? qaiMatch(collect('all').filter(scopeOK).filter(tagOK).filter(baseOK), aiTerms, 120) : [];
  const aiKeys = new Set(aiHits.map(it => it.k));
  let items = [];
  if (kw) {
    items = aiHits.slice();
    items = items.concat(local.filter(it => !aiKeys.has(it.k)));
  } else if (st.tag || st.base) {
    /* 只有标签 / 基本标签、没有关键词：也把筛选下的题列出来 */
    items = collect('all').filter(scopeOK).filter(tagOK).filter(baseOK);
  }
  const total = items.length;
  const filterBits = [];
  if (st.tag) filterBits.push('标签「' + st.tag + '」');
  if (st.base) filterBits.push('基本「' + st.base + '」');
  const filterLabel = filterBits.join(' · ');
  const shown = items.slice(0, 300);
  st.shown = shown;

  const scopes = [['all', '全部'], ['wrong', '错题'], ['fav', '收藏'], ['due', '待复习'], ['undone', '没做过的']];
  host.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="tools" style="margin-top:0">
        <span class="tl">范围</span>
        ${scopes.map(([k, t]) => `<button class="chip${scope === k ? ' on' : ''}" data-scope="${k}">${t}</button>`).join('')}
        <span class="spacer-grow"></span>
        <span class="tl">${kw ? '命中 ' + total + ' 题' + (total > shown.length ? '（只显示前 ' + shown.length + ' 条）' : '') : (filterLabel ? esc(filterLabel) + '：' + total + ' 题' : '输入关键词开始搜索')}</span>
        ${QAI.on && kw.length >= 2 ? qaiNoteHtml(kw, aiHits.length) : ''}
        ${shown.length ? '<button class="btn" id="sExp">导出这 ' + shown.length + ' 题</button>' : ''}
        ${shown.length ? '<button class="btn primary" id="sPaper">组成套卷做一遍</button>' : ''}
      </div>
    </div>
    ${shown.length ? shown.map(it => itemHtml(it, 'search', aiKeys.has(it.k))).join('')
      : (kw ? '<div class="card"><div class="empty">' + (QAI.on ? qaiEmptyText(kw) : '没搜到。换个关键词，或者把范围放宽到「全部」。') + '</div></div>'
        : (filterLabel ? '<div class="card"><div class="empty">' + esc(filterLabel) + ' 下还没有题目。换个标签 / 基本标签，或者输入关键词再搜。</div></div>' : ''))}`;
  HL_KW = '';
  paintHist();
  saveLast();
  qaiBindNote(host, kw);
  /* 只在「点范围 / 按回车搜 / 清空」这种明确动作时播入场，
     敲字的时候不播（每敲一下重播会闪） */
  if (anim) staggerList($('sres'));

  host.querySelectorAll('[data-scope]').forEach(c => c.onclick = () => { st.scope = c.dataset.scope; paintSearch(true); });
  host.querySelectorAll('.wi').forEach(node => {
    const it = shown.find(x => x.k === node.dataset.k);
    if (it) bindItem(node, 'search', it);
  });
  richBindAll(host);
  on('sExp', () => doExport('search', shown, 'md', st));
  on('sPaper', () => makePaper('搜索套卷 · ' + shown.length + ' 题', shown.map(it => it.k)));
}

function paintHist() {
  const row = $('shistRow');
  if (!row) return;
  if (!SHIST.length) { row.innerHTML = '<span class="tl">搜过的关键词会留在这里，下次点一下就能再搜</span>'; return; }
  row.innerHTML = '<span class="tl">最近搜过</span>' + SHIST.map((k, i) => `<button class="chip" data-hist="${i}">${esc(k)}</button>`).join('') + '<button class="btn tiny ghost" id="histClear">清空</button>';
  row.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => {
    const kw = SHIST[+b.dataset.hist] || '';
    const el = $('sq');
    LP.search.kw = kw;
    if (el) { el.value = kw; const c = $('sqClear'); if (c) c.style.display = 'none'; el.focus(); }
    paintSearch();
  });
  on('histClear', () => { SHIST = []; writeLS(HIST_KEY, []); paintHist(); });
}

/* 启动：改由 index.html 在所有模块都加载完之后统一调用 render()，
   否则直接打开 #/exam/... 或 #/kb 时，renderExam / renderKb 还没定义，页面会空白 */
