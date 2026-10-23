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
/* 代码块：语言名 + 复制按钮 + language class。以前只出 <pre><code>，语言丢了、
   复制要手动选、深浅色下也没样式（对照 AFFiNE 的 code block 手感）。 */
const MD_LANG_NAME = { js:'JavaScript', javascript:'JavaScript', ts:'TypeScript', typescript:'TypeScript', jsx:'JSX', tsx:'TSX', py:'Python', python:'Python', java:'Java', c:'C', cpp:'C++', cs:'C#', go:'Go', rs:'Rust', html:'HTML', xml:'XML', css:'CSS', scss:'SCSS', less:'LESS', json:'JSON', yml:'YAML', yaml:'YAML', md:'Markdown', sql:'SQL', sh:'Shell', bash:'Shell', zsh:'Shell', ps:'PowerShell', txt:'文本', text:'文本' };
function mdFenceHtml(lang, body) {
  const l = String(lang || '').toLowerCase();
  if (window.DIAGRAM && (l === 'diagram' || l === 'mermaid' || l === 'mindmap' || l === 'mind')) {
    try {
      const r = window.DIAGRAM.render(l === 'mind' ? 'mindmap' : l, body);
      if (r && r.html) return r.html;
    } catch (e) {}
  }
  mdCopyInitOnce();
  const name = MD_LANG_NAME[l] || (l ? l : '代码');
  return '<div class="md-code" data-lang="' + l + '">' +
    '<div class="md-code-bar"><span class="md-code-lang">' + mdEscCode(name) + '</span>' +
    '<button type="button" class="md-code-copy" data-md-copy>复制</button></div>' +
    '<pre class="md-pre"><code class="language-' + (l || 'plain') + '">' + mdEscCode(body) + '</code></pre></div>';
}
/* 代码块「复制」：document 上委托一次（渲染次数再多也只绑一次） */
function mdCopyInitOnce() {
  if (window.__mdCopyInit || typeof document === 'undefined' || !document.addEventListener) return;
  window.__mdCopyInit = 1;
  document.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-md-copy]') : null;
    if (!b) return;
    const box = b.closest('.md-code');
    const code = box && box.querySelector('pre');
    if (!code) return;
    e.preventDefault();
    const txt = code.textContent || '';
    const ok = () => { const old = b.textContent; b.textContent = '已复制'; setTimeout(function () { b.textContent = old; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { mdCopyFallback(txt, ok); });
    else mdCopyFallback(txt, ok);
  });
}
function mdCopyFallback(txt, ok) {
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); ok();
  } catch (e) { if (typeof toast === 'function') toast('复制失败，请手动选中'); }
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
/* 公式：$$...$$ 独立成行 / $...$ 行内。先抽出来换成哨兵，正文按 markdown 正常走，
   最后统一用 KaTeX 渲染后塞回去（KaTeX 没加载就原样留 LaTeX，不丢内容）。 */
function mdMathExtract(md) {
  if (!window.katex || typeof window.katex.renderToString !== 'function') return null;
  const store = [];
  const put = (tex, display) => { store.push({ tex: tex, display: display }); return '\u0003M' + (store.length - 1) + '\u0003'; };
  let s = String(md).replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => put(t, true));
  s = s.replace(/(^|[^\\$\u0003])\$([^\n$]+?)\$(?!\d)/g, (m, pre, t) => pre + put(t, false));
  return store.length ? { txt: s, store: store } : null;
}
function mdMathBack(html, M) {
  if (!M) return html;
  return String(html).replace(/\u0003M(\d+)\u0003/g, (m, i) => {
    const it = M.store[+i];
    if (!it) return '';
    try { return window.katex.renderToString(it.tex, { displayMode: it.display, throwOnError: false, strict: 'ignore' }); }
    catch (e) { return esc(it.display ? '$$' + it.tex + '$$' : '$' + it.tex + '$'); }
  });
}
/* 题干 / 选项不走 markdown，但公式要能渲染：只把 $…$ / $$…$$ 换成 KaTeX，其余按纯文本转义（第 11 条覆盖到题干） */
window.renderMathText = function (raw) {
  const t = String(raw == null ? '' : raw);
  if (!window.katex || t.indexOf('$') < 0) return esc(t);
  const M = mdMathExtract(t);
  if (!M) return esc(t);
  return mdMathBack(esc(M.txt), M);
};
/* 列表树：缩进（2/4 空格或 Tab）决定层级；任务项带勾选框；序号列表按同级重新编号 */
var CALLOUT_ICON = { note: '📝', tip: '💡', warning: '⚠️', important: '❗', caution: '🚫' };
var CALLOUT_LABEL = { note: '说明', tip: '要点', warning: '注意', important: '重要', caution: '警告' };
function mdListHtml(items) {
  if (!items || !items.length) return '';
  const base = items[0].ind;
  const type = items[0].ord ? 'ol' : 'ul';
  const allTask = items.every(it => it.task);
  let html = '<' + type + (allTask ? ' class="md-tasks"' : '') + '>';
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.ind > base) { i++; continue; }            // 异常缩进：并进上一层，别把字吞了
    let j = i + 1;
    while (j < items.length && items[j].ind > base) j++;
    html += '<li' + (it.task ? ' class="md-task' + (it.on ? ' done' : '') + '"' : '') + '>' +
      (it.task ? '<span class="md-chk" data-md-chk="' + (it.on ? '1' : '0') + '"></span>' : '') +
      it.text + (j > i + 1 ? mdListHtml(items.slice(i + 1, j)) : '') + '</li>';
    i = j;
  }
  return html + '</' + type + '>';
}
function mdToHtml(md) {
  if (!md) return '';
  const F = mdFences(md);
  md = F.txt;
  md = mdTidy(md);
  const MATH = mdMathExtract(md);
  if (MATH) md = MATH.txt;
  let s = esc(mdColorize(mdEscOpen(md)));
  s = s.replace(/!\[([^\]]*)\]\(\s*(data:image\/[^)\s]+|[^)\s]+?)\s*(?:=\s*(\d*)\s*x\s*(\d*)\s*)?(?:\s+(?:&quot;|")([^<>]*?)(?:&quot;|"))?\)/g, (m, a, u, w, h, cap) => {
    /* 图片语法：![图](url =200x120 "图注")（尺寸与图注都可省；图注是 Notion 式 caption） */
    let extra = '';
    if (w) extra += ' width="' + w + '"';
    if (h) extra += ' height="' + h + '"';
    if (w || h) extra += ' style="' + (w ? 'width:' + w + 'px;' : '') + (h ? 'height:' + h + 'px;' : '') + 'max-width:100%"';
    const img = `<img alt="${a}" src="${u}"${extra}>`;
    if (cap && cap.trim()) return `<figure class="md-fig">${img}<figcaption class="md-cap">${cap}</figcaption></figure>`;
    return img;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
    /^(https?:|data:|\/|#)/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `${t}（${u}）`);
  /* 行内 code 先换成占位符：不然 `**x**` 会在 code 里再被加粗、`a*b` 的星号也会被清掉 */
  const MD_CODES = [];
  s = s.replace(/`([^`\n]+)`/g, (m0, c) => {
    MD_CODES.push(c);
    return '\u0004C' + (MD_CODES.length - 1) + '\u0004';
  });
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');                       /* 删除线（标准 Markdown 的 ~~x~~） */
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
  /* 把行内 code 的占位符还原成 <code>（到这里星号残渣已经清完，code 里的内容不会被误伤） */
  s = s.replace(/\u0004C(\d+)\u0004/g, (m0, i) => '<code>' + (MD_CODES[+i] == null ? '' : MD_CODES[+i]) + '</code>');
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
    /* 提示框（AFFiNE callout 的写法）：> [!tip] 一句话 → 带图标和颜色的块 */
    if ((m = t.match(/^&gt;\s*\[!(note|tip|warning|important|caution)\]\s*(.*)$/i))) {
      closeList();
      const kind = m[1].toLowerCase();
      out.push('<div class="callout callout-' + kind + '"><span class="callout-ico">' + (CALLOUT_ICON[kind] || '💡')
        + '</span><span class="callout-body"><b class="callout-t">' + (CALLOUT_LABEL[kind] || '提示') + '</b> ' + m[2] + '</span></div>');
      continue;
    }
    if ((m = t.match(/^&gt;\s?(.*)$/))) {
      closeList();
      /* 连续的 > 行属于同一个引用块（以前每行一个 blockquote，引用里的换行全丢了） */
      const parts = [m[1]];
      while (i + 1 < lines.length) {
        const nx = lines[i + 1].trim().match(/^&gt;\s?(.*)$/);
        if (!nx) break;
        parts.push(nx[1]);
        i++;
      }
      out.push('<blockquote>' + parts.join('<br>') + '</blockquote>');
      continue;
    }
    /* 列表（支持缩进嵌套 + 任务列表）：连续列表行整块收成一棵树再渲染，
       以前一律拍平，「鉴别诊断 1) 2) a) b)」会挤成一层。 */
    if (lines[i].match(/^[ \t]*([-*+]|\d+[.)])\s+/)) {
      closeList();
      const items = [];
      while (i < lines.length) {
        const rl = lines[i].replace(/\t/g, '  ');
        const mm = rl.match(/^([ ]*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!mm) break;
        const tm = mm[3].trim().match(/^\[([ xX])\]\s+(.*)$/);
        items.push({
          ind: mm[1].length,
          ord: /\d/.test(mm[2]) ? 1 : 0,
          text: tm ? tm[2] : mm[3].trim(),
          task: !!tm,
          on: !!(tm && tm[1].toLowerCase() === 'x')
        });
        i++;
      }
      i--;
      out.push(mdListHtml(items));
      continue;
    }
    if (/^<img\s/.test(t)) { closeList(); out.push(t); continue; }
    closeList(); out.push(`<p>${t}</p>`);
  }
  closeList();
  return mdMathBack(mdFencesBack(mdEscEnd(mdColorEnd(out.join('\n'))), F.fences), MATH);
}

/* 表格辅助 */
function splitRow(line) {
  let s = line.trim();
  /* 单元格里的竖线在 mdFromHtml 里写成 \|：先藏起来，分隔完再还原（以前不还原，
     表格改一次再编辑列就错位，用户反馈「表格渲染不行」） */
  s = s.replace(/\\\|/g, '\u0001');
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.slice(-1) === '|') s = s.slice(0, -1);
  return s.split('|').map(x => x.trim().replace(/\u0001/g, '|'));
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
  /* 列数取表头与所有行的最大值：以前按 header.length 截断，中间多写一列后面的内容就丢了 */
  const n = Math.max(header.length, 0, ...rows.map(r => r.length));
  const cell = (list, i) => (list[i] == null ? '' : list[i]);
  const head = '<tr>' + Array.from({ length: n }, (_, i) => `<th${st(i)}>${cell(header, i) || ''}</th>`).join('') + '</tr>';
  const body = rows.map(r => '<tr>' + Array.from({ length: n }, (_, i) => `<td${st(i)}>${cell(r, i)}</td>`).join('') + '</tr>').join('');
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
  const refreshOf = (t) => {
    if (!t) return;
    if (t.isContentEditable) { try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} return; }
    if (typeof t.oninput === 'function') t.oninput();
  };
  const refresh = () => refreshOf(el);
  const hasSel = () => (dom ? fmtDomHasSel(el) : fmtHasSel(el));
  /* 浮条位置按「选区矩形」算，不再用鼠标坐标 —— 拖动选中/键盘选中（Shift+方向键）时
     鼠标可能在远处，浮条就会飞走（AFFiNE 的 popper-position 也是这么做的）。 */
  const selRect = () => {
    try {
      const s = getSelection();
      if (s && s.rangeCount) {
        const r = s.getRangeAt(0).getBoundingClientRect();
        if (r && (r.width > 0 || r.height > 0)) return r;
      }
    } catch (e) {}
    const rr = el.getBoundingClientRect();
    return { left: rr.left, top: rr.top + 24, width: rr.width, height: 22 };
  };
  /* 格式反显：整段选区都在同一种格式里才算 active（AFFiNE command/utils.ts 的思路） */
  const fmtAncTag = n => {
    let x = n;
    while (x && x !== el) {
      if (x.nodeType === 1) {
        const t = x.tagName;
        if (t === 'CODE') return 'c';
        if (t === 'MARK') return 'h';
        if (t === 'B' || t === 'STRONG') return 'b';
        if (t === 'I' || t === 'EM') return 'i';
        if (t === 'SPAN' && x.style && x.style.color) return 'color:' + x.style.color;
      }
      x = x.parentNode;
    }
    return '';
  };
  const markActive = () => {
    Array.prototype.slice.call(bar.querySelectorAll('[data-fmt],[data-color]')).forEach(b => b.classList.remove('on'));
    if (!dom) return;
    const s = getSelection();
    if (!s || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    const set = sel => { const b = bar.querySelector(sel); if (b) b.classList.add('on'); };
    const qs = c => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    /* 加粗/斜体先问浏览器：选整段（甚至选到块元素）时也能给出正确状态 */
    if (qs('bold')) set('[data-fmt="b"]');
    if (qs('italic')) set('[data-fmt="i"]');
    /* 行内代码 / 高亮 / 颜色按祖先标签判断（先找一个选区内的文本节点当样本） */
    let sample = r.startContainer;
    if (sample && sample.nodeType === 1) sample = sample.firstChild || sample;
    const hit = sample && sample.nodeType === 3 ? fmtAncTag(sample) : '';
    const same = hit && r.endContainer !== r.startContainer ? fmtAncTag(r.endContainer.nodeType === 1 ? (r.endContainer.firstChild || r.endContainer) : r.endContainer) === hit : true;
    if (hit === 'c' && same) set('[data-fmt="c"]');
    else if (hit === 'h' && same) set('[data-fmt="h"]');
    else if (hit === 'b') set('[data-fmt="b"]');
    else if (hit === 'i') set('[data-fmt="i"]');
    else if (String(hit).indexOf('color:') === 0) {
      const c = String(hit).slice(6);
      Array.prototype.slice.call(bar.querySelectorAll('[data-color]')).forEach(b => {
        const el2 = b.querySelector('i');
        if (el2 && el2.style.background) {
          const t = document.createElement('span'); t.style.color = c; document.body.appendChild(t);
          const norm = getComputedStyle(t).color; t.remove();
          if (norm === el2.style.background || c === el2.style.background) b.classList.add('on');
        }
      });
    }
  };
  const showAt = () => {
    if (!hasSel()) { fmtBarHide(); return; }
    const r = selRect();
    fmtPlace(bar, r.left + r.width / 2, r.top - 4);
    markActive();
  };
  /* 点完按钮把浮条挪到编辑框正上方（选区变了，原先那个位置不一定还贴）。
     别拿浮条自己的 top 当参照 —— 第一次是 0，浮条就会飞到屏幕最上头。 */
  const keep = () => { if (!hasSel()) { fmtBarHide(); return; } showAt(); };
  bar.onmousedown = ev => ev.preventDefault();
  bar.onclick = ev => {
    const b = ev.target.closest ? ev.target.closest('button[data-fmt],button[data-color]') : null;
    if (!b) return;
    /* 页面上可能同时开着好几个解析框：浮条是公用的，谁最后被选中就用谁当目标。
       以前这里写死闭包里的 el，等于「点了颜色改到最后一个绑定的框上」（用户反馈：给解析加颜色没反应） */
    const t = (FMT_TA && FMT_TA.isConnected) ? FMT_TA : el;
    const isDom = !!t.isContentEditable;
    const again = () => refreshOf(t);
    const f = b.dataset.fmt;
    if (isDom) {
      try { t.focus({ preventScroll: true }); } catch (e) {}    // execCommand 要求焦点在编辑区里（点浮条时焦点可能已经不在）
      if (f === 'b') fmtDomCmd('bold');
      else if (f === 'i') fmtDomCmd('italic');
      else if (f === 'c') fmtDomWrap('<code>', '</code>');
      else if (f === 'h') fmtDomWrap('<mark>', '</mark>');
      else if (f === 'none') fmtDomClear();
      else if (b.dataset.color) fmtDomWrap('<span style="color:' + b.dataset.color + '">', '</span>');
      again();
    } else {
      if (f === 'b') fmtWrap(t, '**', '**', again);
      else if (f === 'i') fmtWrap(t, '*', '*', again);
      else if (f === 'c') fmtWrap(t, '`', '`', again);
      else if (f === 'h') fmtWrap(t, '==', '==', again);
      else if (f === 'none') fmtWrap(t, '', '', again);
      else if (b.dataset.color) fmtWrap(t, '<font color="' + b.dataset.color + '">', '</font>', again);
    }
    try { t.focus(); } catch (e) {}
    keep();
  };
  /* 元素上的监听只挂一次；bar 的 onclick 每次重指向当前目标（textarea 和 contenteditable 共用一条浮条） */
  if (el.dataset.fmtBound === '1') return;
  el.dataset.fmtBound = '1';
  el.addEventListener('mouseup', ev => { FMT_TA = el; setTimeout(() => showAt(), 0); });
  el.addEventListener('touchend', () => { FMT_TA = el; setTimeout(() => showAt(), 80); });
  el.addEventListener('keyup', ev => { if (ev.shiftKey || ev.key === 'Shift' || ev.key === 'Escape') { FMT_TA = el; showAt(); } });
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
    if (tag === 'del' || tag === 's' || tag === 'strike') return '~~' + inlineOf(n, inCode) + '~~';
    if (tag === 'a') { const h = n.getAttribute('href') || ''; return h ? '[' + inlineOf(n, inCode) + '](' + h + ')' : inlineOf(n, inCode); }
    if (tag === 'figure') {
      const im = n.querySelector('img');
      return im ? inlineEl(im, inCode) : inlineOf(n, inCode);
    }
    if (tag === 'img') {
      const w = n.getAttribute('width'), h = n.getAttribute('height');
      let size = '';
      if (w || h) {
        const sw = w || (n.style && /width:\s*(\d+)px/.exec(n.style.width || '') || [])[1] || '';
        const sh = h || (n.style && /height:\s*(\d+)px/.exec(n.style.height || '') || [])[1] || '';
        size = ' =' + sw + 'x' + sh;
      }
      /* 图注存在 figure>figcaption 或 img[data-cap]：写回 "图注" */
      const fig = n.closest ? n.closest('figure') : null;
      const fcap = fig ? (fig.querySelector('figcaption') || {}).textContent : '';
      const cap = String(n.getAttribute('data-cap') || fcap || '').replace(/"/g, '”').trim();
      return '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '') + size + (cap ? ' "' + cap + '"' : '') + ')';
    }
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
      /* 嵌套列表：缩进 = 层级；任务项还原成 - [x]；嵌套的 ul/ol 从 li 的行内文字里剔掉再递归 */
      const walkList = (el, depth, ord) => {
        Array.prototype.forEach.call(el.children, (li, idx) => {
          if (!li.tagName || li.tagName.toLowerCase() !== 'li') return;
          let text = '';
          const c = li.cloneNode ? li.cloneNode(true) : li;
          if (c.querySelectorAll) Array.prototype.forEach.call(c.querySelectorAll('ul,ol'), x => x.remove());
          const ck = c.querySelector ? c.querySelector('.md-chk') : null;
          if (ck) ck.remove();
          text = inlineOf(c, false).replace(/\n+/g, ' ').trim();
          const task = !!(li.classList && li.classList.contains('md-task'));
          const on = !!(li.classList && li.classList.contains('done'));
          const lead = task ? ('- [' + (on ? 'x' : ' ') + '] ') : (ord ? (idx + 1) + '. ' : '- ');
          pushRaw('  '.repeat(depth) + lead + text);
          Array.prototype.forEach.call(li.children, ch => {
            const tg = ch.tagName ? ch.tagName.toLowerCase() : '';
            if (tg === 'ul' || tg === 'ol') walkList(ch, depth + 1, tg === 'ol');
          });
        });
      };
      walkList(n, 0, tag === 'ol');
      return;
    }
    if (n.classList && n.classList.contains('callout')) {
      const cls = String(n.className || '');
      const km = cls.match(/callout-(note|tip|warning|important|caution)/);
      const kind = km ? km[1] : 'tip';
      const clone = n.cloneNode(true);
      const ico = clone.querySelector('.callout-ico'); if (ico) ico.remove();
      const lab = clone.querySelector('.callout-t'); if (lab) lab.remove();
      pushRaw('> [!' + kind + '] ' + inlineOf(clone, false).replace(/\s+/g, ' ').trim());
      return;
    }
    if (tag === 'blockquote') {
      inlineOf(n, false).split('\n').forEach(t => pushRaw('> ' + t.trim()));
      return;
    }
    if (tag === 'pre') {                             /* 代码块：还原成 ```lang 围栏（以前会退化成普通段落，再编辑时围栏和语言全丢） */
      const host = n.parentElement && n.parentElement.classList && n.parentElement.classList.contains('md-code') ? n.parentElement : null;
      const lang = host ? String(host.getAttribute('data-lang') || '') : '';
      pushRaw('```' + lang);
      n.textContent.replace(/^\n+|\n+$/g, '').split('\n').forEach(x => pushRaw(x));
      pushRaw('```');
      return;
    }
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
      if (n.classList && n.classList.contains('md-code-bar')) return;   /* 代码块的语言条只是 UI，不进 Markdown */
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
/* ---- 撤销 / 重做：innerHTML 快照 + 字符偏移光标（AFFiNE 的 undo 思路，不做 CRDT）。
   Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 生效；块拖动、块操作条、斜杠菜单都会先拍一张快照。 ---- */
function caretOff(el) {
  try {
    const s = getSelection();
    if (!s || !s.rangeCount) return 0;
    const r = s.getRangeAt(0);
    if (!el.contains(r.startContainer)) return 0;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  } catch (e) { return 0; }
}
function caretTo(el, off) {
  try {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let acc = 0, n;
    while ((n = w.nextNode())) {
      const len = n.data.length;
      if (acc + len >= off) {
        const r = document.createRange();
        r.setStart(n, Math.max(0, Math.min(len, off - acc)));
        r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return;
      }
      acc += len;
    }
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  } catch (e) {}
}
function undoState(el) { return el.__undo || (el.__undo = { s: [], i: -1, t: 0, c: [] }); }
function undoSnap(el, force) {
  if (!el || !el.isContentEditable) return;
  const u = undoState(el), html = el.innerHTML;
  if (u.s[u.i] === html) return;
  /* 连续打字 700ms 内合成一步，撤销才是一次撤一串，不是一个字一个字往回退 */
  if (!force && u.i >= 0 && u.i === u.s.length - 1 && Date.now() - u.t < 700) {
    u.s[u.i] = html; u.c[u.i] = caretOff(el); u.t = Date.now(); return;
  }
  u.s.length = u.i + 1;
  u.s.push(html); u.c[u.i + 1] = caretOff(el);
  if (u.s.length > 80) { u.s.shift(); u.c.shift(); }
  u.i = u.s.length - 1; u.t = Date.now();
}
function undoStep(el, dir) {
  const u = undoState(el);
  const j = u.i + dir;
  if (j < 0 || j >= u.s.length) return false;
  u.i = j;
  el.innerHTML = u.s[j];
  el.dispatchEvent(new Event('input', { bubbles: true }));
  caretTo(el, u.c[j] == null ? 0 : u.c[j]);
  return true;
}

function richState(el, txt, keep) {
  const w = el.closest ? el.closest('.exp-wrap') : null;
  const s = w && w.querySelector('.exp-state');
  if (!s) return;
  if (s._t) { clearTimeout(s._t); s._t = null; }
  s.textContent = txt || '';
  if (txt && !keep) s._t = setTimeout(() => { s.textContent = ''; s._t = null; }, 1500);
}
/* 解析块（含图片）：显示态即编辑态。label 走上面那行，图片不参与 contenteditable */
const EXPFOLD = readLS('qbank.expfold.v1', {}) || {};
function expFoldToggle(fk) {
  if (EXPFOLD[fk]) delete EXPFOLD[fk]; else EXPFOLD[fk] = 1;
  writeLS('qbank.expfold.v1', EXPFOLD);
  document.querySelectorAll('.exp-wrap[data-note-for="' + fk.replace(/"/g, '') + '"]').forEach(w => {
    const on = !!EXPFOLD[fk];
    w.classList.toggle('collapsed', on);
    const b = w.querySelector('.exp-fold');
    if (b) b.textContent = on ? '▸ 展开' : '▾ 收起';
  });
}
function richBox(fk, text, custom, label) {
  const n = (typeof noteOf === 'function') ? noteOf(fk) : null;
  const imgs = (n && n.imgs) || [];
  const imgsHtml = imgs.length
    ? '<div class="rich-imgs">' + imgs.map((im, i) => `<span class="rich-img" data-imgi="${i}"${im.w ? ' style="width:' + im.w + 'px"' : ''}><img src="${im.src}" alt="${esc(im.name || '')}" loading="lazy"><i class="rich-rz" title="拖动改图片宽度"></i><i class="rich-mv" title="拖动调整图片先后顺序">⠿</i></span>`).join('') + '</div>'
    : '';
  const body = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text || '');
  return `<div class="exp-wrap${EXPFOLD[fk] ? ' collapsed' : ''}" data-note-for="${esc(fk)}">
      <div class="exp lb-row"><span class="lb">${esc(label || '解析')}${custom ? '（自定义）' : ''}：</span><span class="exp-state small muted" aria-live="polite"></span><button class="btn tiny exp-fold" data-fold="${esc(fk)}" title="把解析收起来，只留标题行；再点一次展开">${EXPFOLD[fk] ? '▸ 展开' : '▾ 收起'}</button><button class="btn tiny blk-toggle" data-blk="${esc(fk)}" title="块排序：打开后把鼠标放到某一块左边的小把手上拖动，段落 / 表格 / 图片整块换位置（第 19 条第一轮）">⠿ 块排序</button></div>
      <div class="exp rich-edit" contenteditable="true" spellcheck="false" data-note-for="${esc(fk)}" title="点进来就能改：选中文字会弹出小工具栏，改完点一下别处自动保存">${body}</div>
      ${imgsHtml}
      <div class="aisrc-saved" data-aisrc="${esc(fk)}"></div>
    </div>`;
}
function richInsertImgAtRange(el, rng, src, alt) {
  const x = document.createElement('img');
  x.src = src; x.alt = alt || ''; x.loading = 'lazy';
  const sp = document.createElement('span');
  sp.className = 'rich-img in-text';
  sp.appendChild(x);
  const h = document.createElement('i');
  h.className = 'rich-rz'; h.title = '拖动改图片宽度';
  sp.appendChild(h);
  if (rng && el.contains(rng.startContainer)) {
    rng.deleteContents();
    rng.insertNode(sp);
    const after = document.createRange();
    after.setStartAfter(sp); after.collapse(true);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(after); }
  } else el.appendChild(sp);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return sp;
}
/* ---- 斜杠菜单：行首打 / 选块类型（对照 Notion / AFFiNE 的 slash menu）。
   改的是 DOM 本身（不是插入文本），所以保存时 mdFromHtml 照常还原成 Markdown。 ---- */
const SLASH_ITEMS = [
  { k: 'h', t: '标题', d: '这一段变成小标题' },
  { k: 'ul', t: '无序列表', d: '• 一条一条列' },
  { k: 'ol', t: '有序列表', d: '1. 2. 3.' },
  { k: 'task', t: '任务清单', d: '带勾选框的待办' },
  { k: 'code', t: '代码块', d: '语言名 + 复制按钮' },
  { k: 'quote', t: '引用', d: '缩进一条引用' },
  { k: 'callout', t: '提示框', d: '带图标的一句话（要点 / 注意）' },
  { k: 'table', t: '表格', d: '2×2 表格' },
  { k: 'hr', t: '分隔线', d: '一条横线' }
];
let SLASH = null;
function slashClose() {
  if (SLASH && SLASH.el && SLASH.el.parentNode) SLASH.el.parentNode.removeChild(SLASH.el);
  SLASH = null;
}
function slashBlockOf(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.anchorNode;
  if (!n) return null;
  while (n && n.parentNode && n.parentNode !== el) n = n.parentNode;
  return n && (n.nodeType === 3 || n.nodeType === 1) ? n : null;
}
function slashMenu(el) {
  slashClose();
  const box = document.createElement('div');
  box.className = 'slash-menu';
  box.innerHTML = SLASH_ITEMS.map(it => `<button type="button" class="slash-item" data-slash="${it.k}"><b>${it.t}</b><span>${it.d}</span></button>`).join('');
  document.body.appendChild(box);
  const sel = window.getSelection();
  const rr = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  const er = el.getBoundingClientRect();
  const x = Math.max(8, Math.min((rr && rr.left ? rr.left : er.left), innerWidth - 250));
  const y = Math.max(8, Math.min((rr && rr.bottom ? rr.bottom : er.top) + 6, innerHeight - 330));
  box.style.left = x + 'px'; box.style.top = y + 'px';
  Array.prototype.forEach.call(box.querySelectorAll('[data-slash]'), (b, i) => {
    b.addEventListener('mousedown', e2 => e2.preventDefault());
    b.addEventListener('mouseenter', () => {
      Array.prototype.forEach.call(box.querySelectorAll('[data-slash]'), x => x.classList.remove('on'));
      b.classList.add('on');
      if (SLASH) SLASH.idx = i;
    });
    b.addEventListener('click', () => { const k = b.getAttribute('data-slash'); slashClose(); slashApply(el, k); });
  });
  SLASH = { el: box, idx: 0 };
  const first0 = box.querySelector('[data-slash]');
  if (first0) first0.classList.add('on');
}
function slashApply(el, kind) {
  let b = slashBlockOf(el);
  if (!b) return;
  undoSnap(el, true);                                // 换块类型也能 Ctrl+Z 撤回
  if (b.nodeType === 3) {                            // 光秃秃的文字行：先包成 p 再换
    const p = document.createElement('p');
    b.parentNode.insertBefore(p, b); p.appendChild(b); b = p;
  }
  const txt = String(b.textContent || '').replace(/\s+/g, ' ').trim();
  const mk = (tag, cls) => { const d = document.createElement(tag); if (cls) d.className = cls; return d; };
  let node = null;
  if (kind === 'h') { node = mk('h3'); node.textContent = txt || '小标题'; }
  else if (kind === 'ul' || kind === 'ol') {
    node = mk(kind); const li = mk('li'); li.textContent = txt || '列表项'; node.appendChild(li);
  } else if (kind === 'task') {
    node = mk('ul', 'md-tasks');
    const li = mk('li', 'md-task');
    const chk = mk('span', 'md-chk'); chk.setAttribute('data-md-chk', '0');
    li.appendChild(chk); li.appendChild(document.createTextNode(txt || '待办'));
    node.appendChild(li);
  } else if (kind === 'quote') { node = mk('blockquote'); node.textContent = txt || '引用'; }
  else if (kind === 'callout') {
    const d = mk('div', 'callout callout-tip');
    const ic = mk('span', 'callout-ico'); ic.textContent = CALLOUT_ICON.tip;
    const bd = mk('span', 'callout-body');
    const lb = mk('b', 'callout-t'); lb.textContent = CALLOUT_LABEL.tip;
    bd.appendChild(lb); bd.appendChild(document.createTextNode(' ' + (txt || '要点')));
    d.appendChild(ic); d.appendChild(bd); node = d;
  }
  else if (kind === 'code') {
    const holder = document.createElement('div');
    holder.innerHTML = mdFenceHtml('', txt || '');
    node = holder.firstElementChild;
  } else if (kind === 'table') {
    const holder = document.createElement('div');
    holder.innerHTML = renderTable(['列1', '列2'], [['', ''], ['', '']], ['left', 'left']);
    node = holder.firstElementChild;
  } else if (kind === 'hr') {
    const hr = mk('hr');
    const p = mk('p'); p.appendChild(document.createElement('br'));
    b.parentNode.replaceChild(hr, b);
    hr.parentNode.insertBefore(p, hr.nextSibling);
    node = p;
  }
  if (!node) return;
  if (kind !== 'hr') b.parentNode.replaceChild(node, b);
  let caret = node;
  if (kind === 'ul' || kind === 'ol' || kind === 'task') caret = node.querySelector('li') || node;
  else if (kind === 'code') caret = node.querySelector('code') || node;
  else if (kind === 'table') caret = node.querySelector('td') || node;
  const r2 = document.createRange();
  r2.selectNodeContents(caret); r2.collapse(false);
  const s2 = window.getSelection();
  if (s2) { s2.removeAllRanges(); s2.addRange(r2); }
  el.focus();
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
  el.addEventListener('input', () => { undoSnap(el); richState(el, el.innerHTML === before ? '' : '未保存…', true); });
  el.addEventListener('blur', save, true);
  el.addEventListener('paste', ev => {              // 从网页 / Word 粘进来的一律只留纯文字
    const cb0 = ev.clipboardData || window.clipboardData;
    const imgs0 = cb0 && cb0.items ? Array.prototype.slice.call(cb0.items).filter(it => /^image\//.test(it.type || '')) : [];
    if (imgs0.length) {                              // 第 9 条：Ctrl+V 直接把截图粘进正文
      ev.preventDefault();
      (async () => {
        for (const it of imgs0) {
          const f = it.getAsFile();
          if (!f) continue;
          try { richInsertImgAtRange(el, null, await compressImage(f), f.name || '粘贴的图片'); }
          catch (err) { toast('图片粘贴失败：' + (f.name || '剪贴板图片')); }
        }
        richState(el, '未保存…', true);
      })();
      return;
    }
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
    if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'z') {
      ev.preventDefault();
      if (!undoStep(el, ev.shiftKey ? 1 : -1)) toast(ev.shiftKey ? '没有可重做的步骤了' : '没有可撤销的步骤了');
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'y') {
      ev.preventDefault(); undoStep(el, 1); return;
    }
    if (ev.key === 'Escape') {
      if (SLASH) { slashClose(); ev.stopPropagation(); return; }   // 先关菜单，别一按就直接收起编辑
      ev.stopPropagation(); el.blur(); return;
    }
    if (SLASH && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter')) {
      ev.preventDefault();
      const btns = Array.prototype.slice.call(SLASH.el.querySelectorAll('[data-slash]'));
      if (!btns.length) return;
      if (ev.key === 'Enter') {
        const k = btns[Math.min(SLASH.idx || 0, btns.length - 1)].getAttribute('data-slash');
        slashClose(); slashApply(el, k); return;
      }
      SLASH.idx = Math.max(0, Math.min(btns.length - 1, (SLASH.idx || 0) + (ev.key === 'ArrowDown' ? 1 : -1)));
      btns.forEach((b, i) => b.classList.toggle('on', i === SLASH.idx));
      return;
    }
    if (SLASH) slashClose();
    if ((ev.key === '/' || ev.key === '、') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const blk = slashBlockOf(el);
      const sel0 = window.getSelection();
      const r0 = sel0 && sel0.rangeCount ? sel0.getRangeAt(0) : null;
      const pre = r0 && r0.startContainer && r0.startContainer.nodeType === 3
        ? String(r0.startContainer.data || '').slice(0, r0.startOffset) : '';
      const empty = blk && !String(blk.textContent || '').trim();
      if (empty || !pre.trim()) { ev.preventDefault(); slashMenu(el); }
    }
  });
  el.addEventListener('blur', () => slashClose(), true);
  if (!window.__slashCloseBound) {                    // 点空白处也把斜杠菜单收掉（整页只绑一次）
    window.__slashCloseBound = 1;
    document.addEventListener('click', ev => {
      if (SLASH && !(ev.target && ev.target.closest && ev.target.closest('.slash-menu'))) slashClose();
    }, true);
  }
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
    NOTES[fk] = { text: md || cur.text || '', imgs: cur.imgs || [], ts: Date.now(), ai: cur.ai || false };
    if (typeof saveNotes === 'function' && saveNotes() === false) { toast('保存失败：浏览器存储满了', 3000, 'bad'); return; }
    const wrap = el.closest('.exp-wrap');
    added.forEach(im => { richInsertImgAtRange(el, null, im.src, im.name || ''); });
    if (wrap && typeof richImgsBind === 'function') richImgsBind(wrap);
    richState(el, '已保存');
    toast('已插入 ' + added.length + ' 张图片');
  });
  fmtBarInit(el);
  undoSnap(el, true);                                  // 打开编辑框先存一张原始快照，Ctrl+Z 有起点
  return RICH;
}
/* 解析里的图片：右下角手柄拖动改宽度，宽度存进 NOTES[fk].imgs[i].w（第 20 条） */
function richImgsBind(wrap) {
  if (!wrap || !wrap.dataset) return;
  const fk = wrap.dataset.noteFor;
  Array.prototype.slice.call(wrap.querySelectorAll('.rich-img')).forEach(sp => {
    if (sp.dataset.rzBound === '1') return;
    sp.dataset.rzBound = '1';
    const h = sp.querySelector('.rich-rz');
    if (!h) return;
    h.addEventListener('pointerdown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const startX = ev.clientX, startW = sp.getBoundingClientRect().width;
      let last = Math.round(startW);
      const move = e2 => {
        const w = Math.max(60, Math.round(startW + (e2.clientX - startX)));
        sp.style.width = w + 'px';
        last = w;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const n = NOTES[fk] || {};
        const imgs = n.imgs || [];
        const i = parseInt(sp.dataset.imgi, 10);
        if (imgs[i]) {
          imgs[i].w = last;
          NOTES[fk] = { text: n.text || '', imgs: imgs, ts: Date.now(), ai: n.ai || false };
          if (typeof saveNotes === 'function') saveNotes();
          toast('图片宽度已保存：' + last + 'px');
        } else {
          const ed = sp.closest('.rich-edit');
          if (ed) ed.dispatchEvent(new Event('input', { bubbles: true }));
          toast('图片宽度已改：' + last + 'px（点到别处自动保存）');
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });
  /* 双击图片写图注（Notion caption）：写成 figure>figcaption，mdFromHtml 会还原成 ![]( "图注") */
  wrap.addEventListener('dblclick', function (ev) {
    const img = ev.target.closest ? ev.target.closest('img') : null;
    if (!img) return;
    ev.preventDefault();
    const fig0 = img.closest('figure');
    const cur = (img.getAttribute('data-cap') || (fig0 && fig0.querySelector('figcaption') ? fig0.querySelector('figcaption').textContent : '') || '');
    const v = window.prompt('图片说明（留空 = 不要说明）', cur);
    if (v == null) return;
    const txt = v.trim();
    let fig = img.closest('figure');
    if (txt) {
      img.setAttribute('data-cap', txt);
      if (!fig) { fig = document.createElement('figure'); fig.className = 'md-fig'; img.parentNode.insertBefore(fig, img); fig.appendChild(img); }
      let cap = fig.querySelector('figcaption');
      if (!cap) { cap = document.createElement('figcaption'); cap.className = 'md-cap'; fig.appendChild(cap); }
      cap.textContent = txt; cap.contentEditable = 'true';
    } else {
      img.removeAttribute('data-cap');
      if (fig) { const cap = fig.querySelector('figcaption'); if (cap) cap.remove(); if (!fig.querySelector('figcaption') && fig.parentNode) { fig.parentNode.insertBefore(img, fig); fig.remove(); } }
    }
    const host = img.closest('.rich-edit');
    if (host) { host.dispatchEvent(new Event('input', { bubbles: true })); richState(host, '未保存…', true); }
  });
  /* 第 19 条第三轮：图片区的图片也能整块换位置 —— 拖左上角 ⠿ 到另一张图的前/后，顺序存进 NOTES[fk].imgs */
  if (wrap.dataset.mvBound === '1') return;
  wrap.dataset.mvBound = '1';
  const box = wrap.querySelector('.rich-imgs');
  if (!box) return;
  box.addEventListener('pointerdown', ev => {
    const h = ev.target && ev.target.closest ? ev.target.closest('.rich-mv') : null;
    if (!h) return;
    const sp = h.closest('.rich-img');
    if (!sp || sp.parentElement !== box) return;
    ev.preventDefault(); ev.stopPropagation();
    const fk2 = wrap.dataset.noteFor;
    sp.classList.add('mv-src');
    let over = null;
    const move = e2 => {
      const el = document.elementFromPoint(e2.clientX, e2.clientY);
      const t = (el && el.closest) ? el.closest('.rich-img') : null;
      if (t && t !== sp && t.parentElement === box) {
        if (over && over !== t) over.classList.remove('mv-over');
        over = t; t.classList.add('mv-over');
      }
    };
    const up = e2 => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      sp.classList.remove('mv-src');
      if (!over) return;
      over.classList.remove('mv-over');
      const r = over.getBoundingClientRect();
      if (e2.clientX > r.left + r.width / 2) box.insertBefore(sp, over.nextSibling);
      else box.insertBefore(sp, over);
      const cur0 = NOTES[fk2] || {};
      const old = cur0.imgs || [];
      const spans = Array.prototype.slice.call(box.querySelectorAll('.rich-img'));
      const imgs = spans.map(x => old[parseInt(x.dataset.imgi, 10)]).filter(Boolean);
      if (imgs.length !== old.length) return;
      spans.forEach((x, i) => { x.dataset.imgi = String(i); });
      NOTES[fk2] = { text: cur0.text || '', imgs: imgs, ts: Date.now(), ai: cur0.ai || false };
      if (typeof saveNotes === 'function') saveNotes();
      richState(sp, '图片顺序已保存');
      toast('图片顺序已保存');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
/* 第 19 条第一轮：解析块的拖拽排序。块的顺序就是 markdown 的行序，
   拖完按新 DOM 顺序重新序列化（mdFromHtml），所以段落 / 表格 / 图片都能整块换位置。 */
var BLK = { grip: null, el: null, node: null, dragging: false };
function blkGripEl() {
  if (BLK.grip) return BLK.grip;
  const g = document.createElement('button');
  g.type = 'button';
  g.className = 'blk-grip';
  g.hidden = true;
  g.textContent = '⠿';
  g.title = '拖动这一块';
  document.body.appendChild(g);
  BLK.grip = g;
  g.addEventListener('pointerdown', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const node = BLK.node, el = BLK.el;
    if (!node || !el) return;
    BLK.dragging = true;
    node.classList.add('blk-ghost');
    let tgt = null, after = false;
    const kids = () => Array.prototype.slice.call(el.children);
    const move = e2 => {
      const list = kids();
      list.forEach(k => { k.classList.remove('blk-over'); k.classList.remove('blk-over-after'); });
      const hit = list.find(k => { const r = k.getBoundingClientRect(); return e2.clientY >= r.top && e2.clientY <= r.bottom; });
      if (!hit || hit === node) { tgt = null; if (g) g.hidden = true; return; }
      const r = hit.getBoundingClientRect();
      after = e2.clientY > r.top + r.height / 2;
      hit.classList.add('blk-over');
      if (after) hit.classList.add('blk-over-after');
      tgt = hit;
      const wr = el.getBoundingClientRect();
      g.hidden = false;
      g.style.left = Math.max(2, wr.left - 22) + 'px';
      g.style.top = (after ? r.bottom - 14 : r.top - 12) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      node.classList.remove('blk-ghost');
      kids().forEach(k => { k.classList.remove('blk-over'); k.classList.remove('blk-over-after'); });
      BLK.dragging = false;
      if (tgt && tgt !== node) {
        undoSnap(el, true);                          // 拖动前的位置也留一张快照
        if (after) tgt.after(node); else tgt.before(node);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        richState(el, '未保存…', true);
        toast('块位置已换（点到别处自动保存）');
      }
      g.hidden = true;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  return g;
}
function blkHover(ev) {
  if (BLK.dragging || !BLK.grip) return;
  const onGripOrBar = !!(ev.target && ev.target.closest && ev.target.closest('.blk-grip, .blk-bar'));
  if (onGripOrBar) return;                        /* 鼠标移到把手 / 操作条上：保持显示，别闪 */
  const el = (ev.target && ev.target.closest) ? ev.target.closest('.rich-edit.blk-mode') : null;
  if (!el) { BLK.grip.hidden = true; blkBarHide(); return; }
  const kids = Array.prototype.slice.call(el.children);
  const hit = kids.find(k => { const r = k.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY <= r.bottom; });
  if (!hit) { BLK.grip.hidden = true; blkBarHide(); return; }
  BLK.el = el; BLK.node = hit;
  const wr = el.getBoundingClientRect(), hr = hit.getBoundingClientRect();
  BLK.grip.hidden = false;
  BLK.grip.style.left = Math.max(2, wr.left - 22) + 'px';
  BLK.grip.style.top = (hr.top + Math.max(0, (Math.min(hr.height, 90) - 26) / 2)) + 'px';
  blkBarShow(el, hit);
}
/* 第 19 条第二轮：块的复制 / 上移下移 / 插入空段落 / 删除。
   操作条跟着鼠标悬停的那一块走（在把手右边），点按钮只动 DOM，存盘沿用 mdFromHtml 那条线。 */
var BLKBAR = null;
function blkBarEl() {
  if (BLKBAR) return BLKBAR;
  const bar = document.createElement('div');
  bar.className = 'blk-bar';
  bar.hidden = true;
  bar.innerHTML = [
    ['copy', '⧉', '复制这一块'],
    ['up', '↑', '上移一块'],
    ['down', '↓', '下移一块'],
    ['ins', '＋', '在这一块下面插入空段落'],
    ['del', '🗑', '删除这一块']
  ].map(a => `<button type="button" class="blk-bbtn" data-bkact="${a[0]}" title="${a[2]}">${a[1]}</button>`).join('');
  document.body.appendChild(bar);
  bar.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); });
  bar.addEventListener('pointermove', ev => { ev.stopPropagation(); });
  bar.addEventListener('click', ev => {
    const b = ev.target && ev.target.closest ? ev.target.closest('[data-bkact]') : null;
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    blkAct(b.getAttribute('data-bkact'));
  });
  BLKBAR = bar;
  return bar;
}
function blkBarShow(el, node) {
  const bar = blkBarEl();
  const hr = node.getBoundingClientRect();
  const w = bar.offsetWidth || 148;
  bar.hidden = false;
  bar.style.left = Math.max(2, Math.min(window.innerWidth - w - 8, hr.left + 16)) + 'px';
  bar.style.top = Math.max(2, hr.top - 34) + 'px';
  BLKBAR._el = el; BLKBAR._node = node;
}
function blkBarHide() { if (BLKBAR) BLKBAR.hidden = true; }
/* 直接按当前 DOM 序列化存一份（块操作不经过 focus/blur，得自己落盘） */
function blkSaveNow(el) {
  try {
    const wrap = el.closest ? el.closest('.exp-wrap') : null;
    const fk = (wrap && wrap.dataset && wrap.dataset.noteFor) || '';
    if (!fk) return;
    const md = (typeof mdFromHtml === 'function') ? mdFromHtml(el.cloneNode(true)) : '';
    const cur = (typeof NOTES === 'object' && NOTES) ? (NOTES[fk] || {}) : {};
    NOTES[fk] = { text: md, imgs: cur.imgs || [], ts: Date.now(), ai: cur.ai || false };
    if (typeof saveNotes === 'function' && saveNotes() === false) { toast('保存失败：浏览器存储满了', 3000, 'bad'); return; }
    richState(el, '已保存');
  } catch (e) { toast('这一块存不下来：' + (e && e.message), 3000, 'bad'); }
}
function blkAct(act) {
  const el = (BLKBAR && BLKBAR._el) || BLK.el;
  const node = (BLKBAR && BLKBAR._node) || BLK.node;
  if (!el || !node || !node.isConnected || !el.contains(node)) { blkBarHide(); return; }
  undoSnap(el, true);                                  // 块操作前拍一张，Ctrl+Z 能整块搬回去
  const kids = Array.prototype.slice.call(el.children);
  if (act === 'copy') {
    const c = node.cloneNode(true);
    if (c.removeAttribute) c.removeAttribute('id');
    node.after(c);
    toast('已复制这一块（存盘后生效）');
  } else if (act === 'up') {
    const p = node.previousElementSibling;
    if (!p) { toast('已经是第一块了'); return; }
    node.parentNode.insertBefore(node, p);
  } else if (act === 'down') {
    const n = node.nextElementSibling;
    if (!n) { toast('已经是最后一块了'); return; }
    node.parentNode.insertBefore(n, node);
  } else if (act === 'ins') {
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    node.after(p);
    try {
      const r = document.createRange();
      r.setStart(p, 0); r.collapse(true);
      const s = window.getSelection();
      if (s) { s.removeAllRanges(); s.addRange(r); }
      el.focus();
    } catch (e) {}
    toast('下面插了一个空段落');
  } else if (act === 'del') {
    if (kids.length <= 1) { toast('这是唯一一块，删了就空了'); return; }
    node.remove();
    toast('已删除这一块（存盘后生效）');
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  richState(el, '未保存…', true);
  blkSaveNow(el);
  BLK.node = null;
  blkBarHide();
  if (BLK.grip) BLK.grip.hidden = true;
}
function blkInitOnce() {
  if (window.__blkInit) return;
  window.__blkInit = true;
  blkGripEl();
  blkBarEl();                                   /* 先把操作条建好（默认 hidden），别等第一次悬停 */
  document.addEventListener('pointermove', blkHover, { passive: true });
  document.addEventListener('click', ev => {
    const f = (ev.target && ev.target.closest) ? ev.target.closest('.exp-fold') : null;
    if (f) { expFoldToggle(f.dataset.fold || ''); return; }
    const b = (ev.target && ev.target.closest) ? ev.target.closest('.blk-toggle') : null;
    if (!b) return;
    const wrap = b.closest('.exp-wrap');
    const ed = wrap && wrap.querySelector('.rich-edit');
    if (!ed) return;
    const on = !ed.classList.contains('blk-mode');
    ed.classList.toggle('blk-mode', on);
    b.classList.toggle('btn-primary', on);
    b.textContent = on ? '⠿ 块排序（开）' : '⠿ 块排序';
    if (on) toast('块排序已打开：左边 ⠿ 拖动换位置，悬停时上方出现 复制 / 上移 / 下移 / 插入 / 删除', 3000);
    else if (BLK.grip) BLK.grip.hidden = true;
  });
}
/* 一次把页面上还没绑过的就地编辑器都绑上（重画完调一次就行） */
/* 解析目录（④）：标题多了给一个「☰ 目录」按钮，点开列标题、点条目跳过去。
   只在 .exp-wrap 里做，跟着 richBindAll 重画，幂等（已存在就不重复建）。 */
function mdTocInitOnce() {
  if (window.__mdToc) return;
  window.__mdToc = 1;
  document.addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('.md-toc-btn') : null;
    const panel = document.getElementById('mdTocPanel');
    if (!b) { if (panel && !(e.target.closest && e.target.closest('#mdTocPanel'))) panel.remove(); return; }
    e.preventDefault();
    const wrap = b.closest('.exp-wrap');
    if (!wrap) return;
    if (panel && panel._for === wrap) { panel.remove(); return; }
    if (panel) panel.remove();
    const ed = wrap.querySelector('.rich-edit');
    if (!ed) return;
    const hs = Array.prototype.slice.call(ed.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    if (!hs.length) { if (typeof toast === 'function') toast('这篇解析里还没有小标题'); return; }
    const box = document.createElement('div');
    box.id = 'mdTocPanel'; box._for = wrap; box.className = 'md-toc-panel';
    box.innerHTML = '<div class="md-toc-h">目录</div>' + hs.map(function (h, i) {
      return '<button class="md-toc-i" data-toc="' + i + '" style="padding-left:' + (8 + (+h.tagName[1] - 1) * 12) + 'px">'
        + esc((h.textContent || '').trim() || '（空标题）') + '</button>';
    }).join('');
    box.querySelectorAll('[data-toc]').forEach(function (x) {
      x.onclick = function () {
        const t = hs[+x.dataset.toc];
        if (t) {
          t.scrollIntoView({ block: 'center', behavior: 'smooth' });
          t.classList.add('md-toc-flash');
          setTimeout(function () { t.classList.remove('md-toc-flash'); }, 900);
        }
        box.remove();
      };
    });
    document.body.appendChild(box);
    const r = b.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min((window.innerWidth || 1200) - 230, r.left)) + 'px';
    box.style.top = Math.max(8, r.bottom + 6) + 'px';
  });
}
function mdTocButtons(root) {
  mdTocInitOnce();
  const box = root || document;
  if (!box.querySelectorAll) return;
  Array.prototype.forEach.call(box.querySelectorAll('.exp-wrap'), function (wrap) {
    const ed = wrap.querySelector('.rich-edit');
    if (!ed) return;
    const n = ed.querySelectorAll('h1,h2,h3,h4,h5,h6').length;
    const old = wrap.querySelector(':scope > .md-toc-btn');
    if (n >= 3 && !old) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'md-toc-btn'; b.textContent = '☰ 目录';
      wrap.insertBefore(b, wrap.firstChild);
    } else if (n < 3 && old) old.remove();
  });
}
function richBindAll(root) {
  const scope = root || document;
  if (!scope.querySelectorAll) return;
  mdTocButtons(scope);
  blkInitOnce();
  Array.prototype.slice.call(scope.querySelectorAll('.exp-wrap')).forEach(w => richImgsBind(w));
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
  /* 题库名 + 考点标签也进命中范围：以前只有题干/选项/解析，搜「内科」「心衰标签」时
     普通搜索找不到、只有 AI 模糊能沾到边（用户反馈命中范围不该 AI 独有） */
  return (q.stem + ' ' + (q.group || '') + ' ' + (q.options || []).join(' ') + ' ' + explainOf(k, q) + ' ' + ((b && b.title) || '') + ' ' + tagListOf(k).join(' ')).toLowerCase();
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
        /* AI 命中范围只用来「加宽」：本地全文（含题库名、标签）永远都算命中，
           不然开了 AI 之后反而搜不到题库名（用户反馈的老毛病） */
        const hay = scope ? (it.hay + ' ' + qaiHay(it, scope)) : it.hay;
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
/* 题库管理页的「库内搜索」也可以开 AI 模糊（第 17 条），但全站开关可能是关的，
   所以这里导出两个小口子：读已扩展的词 / 主动扩展一次 */
window.qaiTerms = function (kw) {
  var c = QAI.cache.get(String(kw == null ? '' : kw).trim());
  return (c && c.terms) || [];
};
window.qaiExpandAny = function (kw) {
  var was = QAI.on;
  QAI.on = true;
  try { qaiExpand(kw); } catch (e) {} finally { QAI.on = was; }
};
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

  /* ⑧ 题库筛选：换成可搜索 + AI 模糊的选择器（题目多的站点 chip 装不下） */
  const bankChips = `<div class="tools" style="margin-top:2px"><span class="tl">题库</span>`
    + ((typeof bankPickerHtml === 'function')
      ? bankPickerHtml('listBank', st.bank || 'all', { all: true, allLabel: '全部题库 ' + items.length })
      : `<select id="listBank" class="inp tiny"><option value="all">全部题库 ${items.length}</option></select>`)
    + `<span class="small muted">共 ${Object.keys(banksWith).length} 个题库有${isWrong ? '错题' : '收藏'}</span></div>`;

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
      ${bankChips}
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
  if (typeof bankPickerBind === 'function') bankPickerBind($('view'), 'listBank', v => { st.bank = v || 'all'; render(); });
  const lbSel = $('view').querySelector('#listBank');
  if (lbSel && lbSel.tagName === 'SELECT') lbSel.onchange = () => { st.bank = lbSel.value || 'all'; render(); };
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
  /* 第 16 条：搜索支持按题库筛选（st.bank 早就存在 mkState 里，但一直没用上） */
  const bankOK = it => !st.bank || st.bank === 'all' || (it.bank && it.bank.id === st.bank);
  let local = kw ? collect('all', kw, QAI.on ? QAI.scope : '').filter(scopeOK).filter(bankOK).filter(tagOK).filter(baseOK) : [];
  const aiCache = (QAI.on && kw.length >= 2) ? qaiCached(kw) : null;
  const aiTerms = (aiCache && aiCache.terms) || [];
  const aiHits = aiTerms.length ? qaiMatch(collect('all').filter(scopeOK).filter(bankOK).filter(tagOK).filter(baseOK), aiTerms, 120) : [];
  const aiKeys = new Set(aiHits.map(it => it.k));
  let items = [];
  if (kw) {
    items = aiHits.slice();
    items = items.concat(local.filter(it => !aiKeys.has(it.k)));
  } else if (st.tag || st.base || (st.bank && st.bank !== 'all')) {
    /* 只有标签 / 基本标签 / 题库、没有关键词：也把筛选下的题列出来 */
    items = collect('all').filter(scopeOK).filter(bankOK).filter(tagOK).filter(baseOK);
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
        <span class="tl" style="margin-left:10px">题库</span>
        ${(typeof bankPickerHtml === 'function') ? bankPickerHtml('sBank', st.bank || 'all', { all: true }) : `<select id="sBank" class="inp tiny" title="只在选中的题库里搜">
          <option value="all">全部题库</option>
          ${allBanks().filter(b => !b.paper).map(b => `<option value="${esc(b.id)}"${st.bank === b.id ? ' selected' : ''}>${esc(b.title || b.id)}</option>`).join('')}
        </select>`}
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
  const sbk = host.querySelector('#sBank');
  if (sbk) sbk.onchange = () => { st.bank = sbk.value || 'all'; paintSearch(true); };
  if (typeof bankPickerBind === 'function') bankPickerBind(host, 'sBank', v => { st.bank = v || 'all'; paintSearch(true); });
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


/* ===== 右键菜单 / 长按菜单（照 AppFlowy 的「按块类型给菜单」思路：动作表 + 扁平数组 + SEP） =====
   桌面：contextmenu；触屏：长按 480ms。
   解析块上给块操作 + 行内格式 + 转成；题目卡片上给收藏 / 错题 / 复制。 */
var CTX_SEP = { sep: true };
var CTX_MENU = null;
var CTX_LP = { t: 0, x: 0, y: 0, el: null };

function ctxEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function ctxEl() {
  if (CTX_MENU) return CTX_MENU;
  CTX_MENU = document.createElement('div');
  CTX_MENU.className = 'ctx-menu';
  CTX_MENU.hidden = true;
  CTX_MENU.setAttribute('role', 'menu');
  document.body.appendChild(CTX_MENU);
  CTX_MENU.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
  document.addEventListener('pointerdown', function (ev) {
    if (!CTX_MENU || CTX_MENU.hidden) return;
    if (CTX_MENU.contains(ev.target)) return;
    ctxClose();
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (!CTX_MENU || CTX_MENU.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ctxClose(); }
  }, true);
  window.addEventListener('scroll', function () { ctxClose(); }, true);
  return CTX_MENU;
}
function ctxClose() {
  if (CTX_MENU) CTX_MENU.hidden = true;
}
/* items: [{t, d, icon, danger, run}] 或 CTX_SEP */
function ctxOpen(items, x, y) {
  var box = ctxEl();
  var html = '';
  items.forEach(function (it, i) {
    if (it === CTX_SEP) { html += '<div class="ctx-sep"></div>'; return; }
    html += '<button type="button" class="ctx-item' + (it.danger ? ' danger' : '') + '" data-ci="' + i + '">'
      + '<i class="ctx-ico">' + ctxEsc(it.icon || '') + '</i>'
      + '<span class="ctx-t">' + ctxEsc(it.t) + '</span>'
      + (it.d ? '<span class="ctx-d">' + ctxEsc(it.d) + '</span>' : '')
      + '</button>';
  });
  box.innerHTML = html;
  box.hidden = false;
  box.style.left = '0px'; box.style.top = '0px';
  var r = box.getBoundingClientRect();
  var left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8));
  var top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8));
  box.style.left = left + 'px';
  box.style.top = top + 'px';
  box.querySelectorAll('.ctx-item').forEach(function (b) {
    b.onclick = function () {
      var it = items[+b.getAttribute('data-ci')];
      ctxClose();
      try { if (it && it.run) it.run(); } catch (e) { if (typeof toast === 'function') toast('操作失败：' + e.message, 2200, 'err'); }
    };
  });
}
/* ---- 解析块：块操作 + 行内格式 + 转成 ---- */
function ctxRichNode(el, target) {
  var n = target && el.contains(target) ? target : el;
  while (n && n.parentNode && n.parentNode !== el) n = n.parentNode;
  if (!n || n.parentNode !== el) n = el.firstElementChild;
  return n;
}
function ctxRichItems(el, node) {
  var pick = function (act) {
    return function () {
      if (typeof BLKBAR === 'undefined') return;
      BLKBAR._el = el; BLKBAR._node = node;
      blkAct(act);
      ctxClose();
    };
  };
  var fmt = function (cmd, val) {
    return function () {
      el.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
      try { document.execCommand(cmd, false, val || null); } catch (e) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
  };
  var code = function () {
    el.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { if (typeof toast === 'function') toast('先选中要变成行内代码的文字', 1600, 'warn'); return; }
    var r = sel.getRangeAt(0);
    var c = document.createElement('code');
    try { r.surroundContents(c); } catch (e) { return; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  var conv = function (kind) { return function () { if (typeof slashApply === 'function') slashApply(el, kind); }; };
  return [
    { t: '复制这块', icon: '⧉', run: pick('copy') },
    { t: '上移', icon: '↑', run: pick('up') },
    { t: '下移', icon: '↓', run: pick('down') },
    { t: '插入空段落', icon: '＋', run: pick('ins') },
    { t: '删除这块', icon: '🗑', danger: true, run: pick('del') },
    CTX_SEP,
    { t: '加粗', icon: 'B', d: 'Ctrl+B', run: fmt('bold') },
    { t: '斜体', icon: 'I', d: 'Ctrl+I', run: fmt('italic') },
    { t: '删除线', icon: 'S', run: fmt('strikeThrough') },
    { t: '行内代码', icon: '‹›', run: code },
    CTX_SEP,
    { t: '转成标题', icon: 'H', run: conv('h3') },
    { t: '转成无序清单', icon: '•', run: conv('ul') },
    { t: '转成有序清单', icon: '1.', run: conv('ol') },
    { t: '转成引用', icon: '❝', run: conv('quote') }
  ];
}
/* ---- 题目卡片：收藏 / 错题 / 复制 ---- */
function ctxCopy(text) {
  var done = function () { if (typeof toast === 'function') toast('已复制', 1200, 'ok'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    });
  }
}
function ctxQOf(k) {
  var bankId = String(k).split('#')[0];
  var b = (typeof bankById === 'function') ? bankById(bankId) : null;
  if (!b) return { b: null, q: null };
  var qid = String(k).split('#')[1];
  return { b: b, q: (b.questions || []).filter(function (x) { return String(x.id) === String(qid); })[0] || null };
}
function ctxItemItems(k) {
  var o = ctxQOf(k);
  var q = o.q || {};
  var isFav = (typeof FAV !== 'undefined') && FAV[k];
  var a = (typeof ANS !== 'undefined') ? ANS[k] : null;
  var inWrong = !!(a && a.wrong > 0);
  var st = null;
  try { st = (typeof LP !== 'undefined') ? (location.hash.indexOf('#/wrong') >= 0 ? LP.wrong : LP.fav) : null; } catch (e) {}
  var selKeys = (st && st.sel) ? Array.from(st.sel) : [];
  var multi = selKeys.length > 1 && selKeys.indexOf(k) >= 0;
  var items = [
    { t: '打开这道题', icon: '↗', run: function () { location.hash = '#/bank/' + String(k).split('#')[0]; } },
    {
      t: isFav ? '取消收藏' : '加入收藏', icon: isFav ? '☆' : '★', run: function () {
        if (typeof toggleFav === 'function') toggleFav(k);
        if (typeof render === 'function') render();
      }
    },
    {
      t: inWrong ? '移出错题本' : '加入错题本', icon: inWrong ? '↩' : '＋', run: function () {
        var x = (typeof ANS !== 'undefined') ? (ANS[k] || (ANS[k] = { sel: [], ok: false, tries: 0, wrong: 0, ts: Date.now(), upd: Date.now() })) : null;
        if (!x) return;
        x.wrong = (x.wrong || 0) > 0 ? 0 : Math.max(1, x.wrong || 0);
        x.ts = x.ts || Date.now(); x.upd = Date.now();
        if (typeof saveAns === 'function') saveAns();
        if (typeof toast === 'function') toast(x.wrong ? '已加入错题本' : '已移出错题本', 1400, 'ok');
        if (typeof render === 'function') render();
      }
    },
    CTX_SEP,
    { t: '复制题干', icon: '⧉', run: function () { ctxCopy(String(q.stem || '')); } },
    { t: '复制解析', icon: '⧉', run: function () { ctxCopy(String(q.explain || '')); } }
  ];
  if (multi) {
    items = [{
      t: '选中的 ' + selKeys.length + ' 道一起' + (inWrong ? '移出错题本' : '加入错题本'), icon: '⛭', run: function () {
        selKeys.forEach(function (kk) {
          var y = (typeof ANS !== 'undefined') ? (ANS[kk] || (ANS[kk] = { sel: [], ok: false, tries: 0, wrong: 0, ts: Date.now(), upd: Date.now() })) : null;
          if (!y) return;
          if (inWrong) y.wrong = 0; else y.wrong = Math.max(1, y.wrong || 0);
          y.upd = Date.now();
        });
        if (typeof saveAns === 'function') saveAns();
        if (typeof toast === 'function') toast('已处理 ' + selKeys.length + ' 道', 1600, 'ok');
        if (typeof render === 'function') render();
      }
    }, CTX_SEP].concat(items);
  }
  return items;
}
(function () {
  if (window.__ctxInit) return;
  window.__ctxInit = 1;
  document.addEventListener('contextmenu', function (ev) {
    var rich = ev.target.closest ? ev.target.closest('.rich-edit') : null;
    if (rich) {
      ev.preventDefault();
      ctxOpen(ctxRichItems(rich, ctxRichNode(rich, ev.target)), ev.clientX, ev.clientY);
      return;
    }
    var wi = ev.target.closest ? ev.target.closest('.wi[data-k], [data-k].wi') : null;
    if (wi && wi.getAttribute('data-k')) {
      ev.preventDefault();
      ctxOpen(ctxItemItems(wi.getAttribute('data-k')), ev.clientX, ev.clientY);
    }
  });
  /* 触屏长按（480ms）：解析块 / 题目卡片；选项上的长按留给答题页的「排除选项」 */
  document.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'mouse') return;
    var t = ev.target.closest ? ev.target.closest('.rich-edit, .wi[data-k], [data-k].wi') : null;
    if (!t) return;
    if (ev.target.closest && ev.target.closest('.opt')) return;
    CTX_LP.el = t; CTX_LP.x = ev.clientX; CTX_LP.y = ev.clientY;
    clearTimeout(CTX_LP.t);
    CTX_LP.t = setTimeout(function () {
      var rich = CTX_LP.el.closest('.rich-edit');
      if (rich) ctxOpen(ctxRichItems(rich, ctxRichNode(rich, CTX_LP.el)), CTX_LP.x, CTX_LP.y);
      else if (CTX_LP.el.getAttribute('data-k')) ctxOpen(ctxItemItems(CTX_LP.el.getAttribute('data-k')), CTX_LP.x, CTX_LP.y);
    }, 480);
  }, true);
  var cancel = function () { clearTimeout(CTX_LP.t); };
  document.addEventListener('pointermove', function (ev) { if (CTX_LP.el && (Math.abs(ev.clientX - CTX_LP.x) > 8 || Math.abs(ev.clientY - CTX_LP.y) > 8)) cancel(); }, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
})();
