/* ============================================================
   刷题站 · AI 对话 chat.js（主页内嵌 + #/chat 整页）
   ————————————————————————————————————————————————
   2026-10-17 第 3 版（按用户要求）：
     1) 对话直接放在主页（题库列表上面），拖着题库卡片往上一丢就行；
     2) 没有「模式」下拉：直接写 prompt（给我出 5 道… / 分析这个题库的易错点 / 问知识点），
        内部自动判断走哪条路（出题 / 问答 / 分析题库）；
     3) 「选题库」面板：一个个小文件卡片，能搜索筛选、点选、拉框框选、批量全选；
     4) 拖拽支持 txt / json / md / csv / pdf / docx / html / 图片等（PDF、docx 在本地抽文字）；
     5) 像 DeepSeek 网页端那样：消息可以「编辑后重答」、回复可以「重试」，旧版本变成分支，
        用 ‹ 1/2 › 切换；等待时有「正在思考 3 秒…」的实时提示，推理模型会显示「深度思考」过程；
     6) 对话记录存成树（qbank.chat.v1），刷新后分支和当前所在分支都还在。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'qbank.chat.v2';        /* 多段对话：{ chats:[{id,title,createdAt,updatedAt,tree}], cur } */
  var OLD_KEY = 'qbank.chat.v1';    /* 老的单树存档，加载时迁移 */
  var MAX_NODES = 110;
  var MAX_CHATS = 30;
  var TAG = { qa: '问知识点', quiz: '出题', analyze: '分析题库' };

  /* 节点：{ id, role:'user'|'ai', text, qtext, atts, tag, refs, acts, quizTitle, reason, thinkSec, parent, children:[], ts } */
  var DB = { chats: [], cur: null };
  var emptyTree = function () { return { nodes: {}, roots: [], active: null }; };
  var TREE = emptyTree();   /* 当前会话的树（别的代码都用它）；没有会话时是一棵临时空树 */

  var PEND = [];        // 待发附件
  var DRAFT = '';       // 输入框草稿
  var RUN = null;       // { node, ctl, timer, t0 }
  var EDIT = null;      // 正在编辑的用户消息 id
  var MEM = {};         // 会话内缓存（附件题库，供「导入」）
  var PICK = null;
  var SCROLL_NEXT = false;
  var LOG_STICK = true;   /* 对话区是否「跟着底部走」：用户往上翻后不再强制滚下去 */

  function $id(id) { return document.getElementById(id); }
  function E(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? (s.slice(0, n) + '…') : s; }
  function readLS(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function T(msg, ms, kind) { try { if (typeof toast === 'function') toast(msg, ms, kind); } catch (e) {} }
  function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  /* ============================================================
     对话树：读写 / 迁移 / 切分支
     ============================================================ */
  function node(id) { return TREE.nodes[id] || null; }
  function addNode(o) {
    o.id = o.id || uid();
    o.ts = o.ts || Date.now();
    o.children = o.children || [];
    TREE.nodes[o.id] = o;
    if (o.parent) {
      var p = node(o.parent);
      if (p) { if (p.children.indexOf(o.id) < 0) p.children.push(o.id); }
      else o.parent = null;
    }
    if (!o.parent && TREE.roots.indexOf(o.id) < 0) TREE.roots.push(o.id);
    return o;
  }
  function chatById(id) { for (var i = 0; i < DB.chats.length; i++) if (DB.chats[i].id === id) return DB.chats[i]; return null; }
  function mkChat(title) {
    return {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title: title || '新对话',
      createdAt: Date.now(), updatedAt: Date.now(),
      tree: { nodes: {}, roots: [], active: null }
    };
  }
  function curChat() { return chatById(DB.cur); }
  /* 真正要往树里写东西时才建会话（例如发出第一句话）：
     这样「删掉最后一段对话」之后列表可以是空的，不会立刻又冒出一个「新对话」 */
  function ensureChat() {
    var c = curChat();
    if (c) { TREE = c.tree; return c; }
    c = mkChat();
    DB.chats.unshift(c);
    DB.cur = c.id;
    TREE = c.tree;
    return c;
  }
  function deepestIn(tree, id) {
    var guard = 0;
    while (id && guard++ < 400) {
      var n = tree.nodes[id];
      if (!n || !n.children || !n.children.length) return id;
      id = n.children[n.children.length - 1];
    }
    return id;
  }
  function loadChat() {
    var v = readLS(KEY, null);
    if (v && v.v === 3 && Array.isArray(v.chats)) {
      if (!v.chats.length) { DB.chats = []; DB.cur = null; TREE = emptyTree(); return; }
      DB.chats = v.chats.map(function (c) {
        var tree = { nodes: {}, roots: [], active: null };
        var arr = (c.tree && Array.isArray(c.tree.nodes)) ? c.tree.nodes : [];
        arr.forEach(function (n) { if (n && n.id) { n.children = n.children || []; tree.nodes[n.id] = n; } });
        tree.roots = (c.tree && c.tree.roots) || [];
        if (!tree.roots.length) tree.roots = arr.filter(function (n) { return !n.parent; }).map(function (n) { return n.id; });
        tree.active = (c.tree && c.tree.active) || null;
        if (!tree.nodes[tree.active]) tree.active = tree.roots.length ? deepestIn(tree, tree.roots[tree.roots.length - 1]) : null;
        return { id: c.id, title: c.title || '新对话', createdAt: c.createdAt || c.updatedAt || Date.now(), updatedAt: c.updatedAt || Date.now(), tree: tree };
      });
      DB.cur = chatById(v.cur) ? v.cur : DB.chats[0].id;
      TREE = chatById(DB.cur).tree;
      return;
    }
    /* 迁移：老的单树（qbank.chat.v1：v2 树 或 更早的扁平 msgs）→ 一段对话 */
    var c = mkChat('新对话');
    TREE = c.tree;
    var old = readLS(OLD_KEY, null);
    if (old) {
      var msgs = [];
      if (old.v === 2 && Array.isArray(old.nodes)) {
        var map = {};
        old.nodes.forEach(function (n) { if (n && n.id) { n.children = n.children || []; map[n.id] = n; } });
        var cur = (old.roots && old.roots.length) ? old.roots[0] : null;
        while (cur && map[cur]) { var nn = map[cur]; msgs.push(nn); cur = nn.children && nn.children[0]; }
      } else if (Array.isArray(old.msgs)) {
        msgs = old.msgs;
      }
      var parent = null;
      msgs.forEach(function (m) {
        if (!m || (m.role !== 'user' && m.role !== 'ai')) return;
        var n = addNode({ role: m.role, text: m.text || '', qtext: m.text || '', tag: m.tag || '', refs: m.refs || [], acts: m.acts || [], quizTitle: m.quizTitle || '', parent: parent });
        parent = n.id;
      });
      TREE.active = parent;
      var firstU = msgs.filter(function (m) { return m.role === 'user'; })[0];
      if (firstU) c.title = clip(firstU.text || '', 22) || '新对话';
    }
    DB.chats = [c];
    DB.cur = c.id;
    saveChat();
  }
  function saveChat() {
    var c = curChat();
    if (!c) {
      if (!DB.chats.length) { writeLS(KEY, { v: 3, chats: [], cur: null, ts: Date.now() }); return; }
      DB.cur = DB.chats[0].id;   /* 兜底：有存档但 cur 丢了，别把整份记录写空 */
      c = DB.chats[0];
    }
    TREE = c.tree;
    var arr = Object.keys(TREE.nodes).map(function (k) { return TREE.nodes[k]; });
    if (arr.length > MAX_NODES) {
      /* 超了：保住当前这条分支 + 最近的其它节点 */
      var keep = {};
      var p = TREE.active;
      while (p) { keep[p] = 1; var nn = TREE.nodes[p]; p = nn && nn.parent; }
      var rest = arr.filter(function (n) { return !keep[n.id]; }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      var room = Math.max(10, MAX_NODES - Object.keys(keep).length);
      rest.slice(room).forEach(function (n) {
        delete TREE.nodes[n.id];
        var pp = n.parent ? TREE.nodes[n.parent] : null;
        if (pp) pp.children = pp.children.filter(function (x) { return x !== n.id; });
        TREE.roots = TREE.roots.filter(function (x) { return x !== n.id; });
      });
      arr = Object.keys(TREE.nodes).map(function (k) { return TREE.nodes[k]; });
    }
    c.updatedAt = Date.now();
    var out = DB.chats.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, MAX_CHATS).map(function (x) {
      var t = x.tree;
      return {
        id: x.id, title: x.title, createdAt: x.createdAt, updatedAt: x.updatedAt,
        tree: { nodes: Object.keys(t.nodes).map(function (k) { return t.nodes[k]; }), roots: t.roots, active: t.active }
      };
    });
    writeLS(KEY, { v: 3, chats: out, cur: DB.cur, ts: Date.now() });
  }
  function pathIds() {
    var out = [], p = TREE.active, guard = 0;
    while (p && guard++ < 400) { out.unshift(p); var n = node(p); p = n && n.parent; }
    return out;
  }
  function deepest(id) {
    var guard = 0;
    while (id && guard++ < 400) {
      var n = node(id);
      if (!n || !n.children || !n.children.length) return id;
      id = n.children[n.children.length - 1];
    }
    return id;
  }
  function siblingsOf(n) { return n.parent ? ((node(n.parent) || {}).children || []) : TREE.roots; }
  function pathBefore(n) {
    /* n 之前（不含 n）的那条链，给模型当上下文 */
    var out = [], p = n.parent, guard = 0;
    while (p && guard++ < 200) { out.unshift(p); var nn = node(p); p = nn && nn.parent; }
    return out.map(function (id) { return node(id); }).filter(Boolean);
  }
  function switchBranch(id, dir) {
    var n = node(id);
    if (!n) return;
    var sib = siblingsOf(n);
    var i = sib.indexOf(id);
    if (i < 0 || sib.length < 2) return;
    var target = sib[(i + dir + sib.length) % sib.length];
    TREE.active = deepest(target);
    EDIT = null;
    saveChat();
    paintLog();
  }

  /* ============================================================
     附件
     ============================================================ */
  function isImageName(n) { return /\.(png|jpe?g|gif|webp|bmp)$/i.test(n); }
  function isTextName(n) { return /\.(txt|md|markdown|json|js|csv|text|log)$/i.test(n); }

  function htmlToText(s) {
    return String(s || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|hr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  }
  function findZipEntry(buf, want) {
    try {
      var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      var n = buf.length, eocd = -1, i;
      for (i = n - 22; i >= Math.max(0, n - 65558); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) return null;
      var count = dv.getUint16(eocd + 10, true);
      var off = dv.getUint32(eocd + 16, true);
      for (var k = 0; k < count; k++) {
        if (off + 46 > n || dv.getUint32(off, true) !== 0x02014b50) return null;
        var method = dv.getUint16(off + 10, true);
        var csize = dv.getUint32(off + 20, true);
        var nameLen = dv.getUint16(off + 28, true);
        var extraLen = dv.getUint16(off + 30, true);
        var cmtLen = dv.getUint16(off + 32, true);
        var lho = dv.getUint32(off + 42, true);
        var name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
        if (name === want) {
          var lNameLen = dv.getUint16(lho + 26, true);
          var lExtra = dv.getUint16(lho + 28, true);
          var dataStart = lho + 30 + lNameLen + lExtra;
          return { method: method, data: buf.subarray(dataStart, dataStart + csize) };
        }
        off += 46 + nameLen + extraLen + cmtLen;
      }
    } catch (e) {}
    return null;
  }
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('这个浏览器不支持解压 docx'));
    try {
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    } catch (e) { return Promise.reject(e); }
  }
  function docxToText(file) {
    return file.arrayBuffer().then(function (ab) {
      var buf = new Uint8Array(ab);
      var ent = findZipEntry(buf, 'word/document.xml');
      if (!ent) throw new Error('不是标准的 .docx（老 .doc 请另存为 .docx 再拖）');
      var rawP = (ent.method === 0) ? Promise.resolve(ent.data) : (ent.method === 8 ? inflateRaw(ent.data) : Promise.reject(new Error('docx 压缩方式不支持')));
      return rawP.then(function (raw) {
        var xml = new TextDecoder().decode(raw);
        xml = xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n');
        var txt = xml.replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ');
        return txt.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      });
    });
  }
  /* PDF 文字抽取：用 pdf.js 3.11 的「经典版」（pdf.min.js + pdf.worker.min.js）。
     为什么不用 pdfjs/v4 的 .mjs：动态 import 在 file:// 下被浏览器直接禁掉（双击 index.html 打不开）；
     经典 <script> 在 file:// 下能加载，worker 建不起来时 pdf.js 会退化成主线程 fake worker。 */
  var PDF_LIB = null;
  function loadPdfLegacy() {
    if (PDF_LIB) return PDF_LIB;
    PDF_LIB = new Promise(function (resolve, reject) {
      var setup = function () {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/v3/pdf.worker.min.js', location.href).href;
        } catch (e) {}
      };
      if (window.pdfjsLib && window.pdfjsLib.getDocument) { setup(); resolve(window.pdfjsLib); return; }
      var s = document.createElement('script');
      s.src = new URL('pdfjs/v3/pdf.min.js', location.href).href;
      s.async = true;
      s.onload = function () {
        if (!window.pdfjsLib || !window.pdfjsLib.getDocument) { PDF_LIB = null; reject(new Error('pdf.js 没挂上')); return; }
        setup();
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { PDF_LIB = null; reject(new Error('pdfjs/v3/pdf.min.js 加载失败')); };
      document.head.appendChild(s);
    });
    return PDF_LIB;
  }
  function pdfToText(file) {
    return loadPdfLegacy().then(function (lib) {
      return file.arrayBuffer().then(function (ab) {
        var data = new Uint8Array(ab);
        return lib.getDocument({ data: data, isEvalSupported: false, disableFontFace: true }).promise;
      }).then(function (doc) {
        var pages = Math.min(doc.numPages, 40), out = [], total = 0;
        function step(i) {
          if (i > pages || total > 60000) return Promise.resolve();
          return doc.getPage(i).then(function (page) { return page.getTextContent(); }).then(function (tc) {
            var s = (tc.items || []).map(function (it) { return it.str || ''; }).join(' ').replace(/\s+/g, ' ').trim();
            if (s) { out.push('—— 第 ' + i + ' 页 ——\n' + s); total += s.length; }
            return step(i + 1);
          });
        }
        return step(1).then(function () {
          try { doc.destroy(); } catch (e) {}
          return { text: out.join('\n\n'), pages: doc.numPages };
        });
      });
    }).catch(function (e) {
      throw new Error('读不了这个 PDF：' + ((e && e.message) || e));
    });
  }

  function attachFile(file) {
    return new Promise(function (resolve) {
      var name = file.name || '未命名';
      var lower = name.toLowerCase();
      function done() { paintPend(); resolve(); }
      if (isImageName(lower) || /^image\//.test(file.type || '')) {
        if (file.size > 6 * 1024 * 1024) { T('图片太大（>6MB），换一张小点的', 2600, 'bad'); resolve(); return; }
        var fr = new FileReader();
        fr.onload = function () { PEND.push({ kind: 'image', name: name, dataUrl: String(fr.result || '') }); done(); };
        fr.onerror = function () { resolve(); };
        fr.readAsDataURL(file);
        return;
      }
      if (/\.pdf$/i.test(lower)) {
        if (file.size > 30 * 1024 * 1024) { T('PDF 太大（>30MB）', 2600, 'bad'); resolve(); return; }
        T('正在读 PDF 里的文字…', 1600);
        pdfToText(file).then(function (r) {
          if (!r.text) { T('这个 PDF 没抽出文字（可能是扫描件）', 2800, 'bad'); resolve(); return; }
          PEND.push({ kind: 'file-text', name: name, text: clip(r.text, 60000), note: 'PDF 共 ' + r.pages + ' 页' });
          done();
        }, function (e) { T((e && e.message) || 'PDF 读取失败', 3200, 'bad'); resolve(); });
        return;
      }
      if (/\.docx$/i.test(lower)) {
        if (file.size > 15 * 1024 * 1024) { T('docx 太大（>15MB）', 2600, 'bad'); resolve(); return; }
        docxToText(file).then(function (txt) {
          if (!txt) { T('docx 里没读出文字', 2400, 'bad'); resolve(); return; }
          PEND.push({ kind: 'file-text', name: name, text: clip(txt, 50000), note: 'Word 文档' });
          done();
        }, function (e) { T((e && e.message) || 'docx 读取失败', 3200, 'bad'); resolve(); });
        return;
      }
      if (/\.doc$/i.test(lower)) { T('老 .doc 读不了：另存为 .docx / PDF / txt 再拖', 3200, 'bad'); resolve(); return; }
      if (/\.html?$/i.test(lower)) {
        var fr2 = new FileReader();
        fr2.onload = function () {
          var txt = htmlToText(fr2.result);
          PEND.push({ kind: 'file-text', name: name, text: clip(txt, 50000), note: '网页文字' });
          done();
        };
        fr2.onerror = function () { resolve(); };
        fr2.readAsText(file, 'utf-8');
        return;
      }
      if (!isTextName(lower) && !/^text\//.test(file.type || '')) { T('这个文件类型不支持：' + name, 2400, 'bad'); resolve(); return; }
      var fr3 = new FileReader();
      fr3.onload = function () {
        var text = String(fr3.result || '');
        var bank = parseBankText(text, name.replace(/\.[a-z0-9]+$/i, ''));
        if (bank) PEND.push({ kind: 'file-bank', title: bank.title, questions: bank.questions });
        else PEND.push({ kind: 'file-text', name: name, text: clip(text, 60000) });
        done();
      };
      fr3.onerror = function () { resolve(); };
      fr3.readAsText(file, 'utf-8');
    });
  }

  function filesFromDrop(dt) {
    var allowed = /\.(txt|md|markdown|json|js|csv|pdf|docx?|html?|png|jpe?g|gif|webp|bmp)$/i;
    var pick = function (list) {
      return (list || []).filter(function (f) { return allowed.test(String(f.name || '')); });
    };
    /* 普通文件拖拽：直接用 dt.files —— 最稳（file:// 双击打开时也能拿到）。
       真实拖拽时 webkitGetAsEntry 那条路在个别环境会拿不到文件（用户实测就是全报「没认出」）；
       dt.files 有东西就不必走 entries，只有拖「文件夹」时 dt.files 才是空的。 */
    var plain = pick(dt && dt.files ? Array.prototype.slice.call(dt.files) : []);
    if (plain.length) return Promise.resolve(plain.slice(0, 80));
    var items = (dt && dt.items) ? Array.prototype.slice.call(dt.items) : [];
    var entries = [];
    items.forEach(function (it) {
      if (it.kind !== 'file') return;
      var en = null;
      try { en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; } catch (e) { en = null; }
      if (en) entries.push(en);
    });
    if (!entries.length) return Promise.resolve([]);
    var out = [];
    var SKIP = /(^|[\/\\])(\.|__MACOSX|node_modules)/;
    function walk(entry, depth) {
      return new Promise(function (resolve) {
        if (!entry || depth > 6) { resolve(); return; }
        if (SKIP.test(entry.fullPath || '')) { resolve(); return; }
        if (entry.isFile) { entry.file(function (f) { out.push(f); resolve(); }, function () { resolve(); }); return; }
        if (entry.isDirectory) {
          var rd = entry.createReader(), all = [];
          (function readBatch() {
            rd.readEntries(function (ents) {
              if (!ents.length) { Promise.all(all.map(function (e) { return walk(e, depth + 1); })).then(function () { resolve(); }); return; }
              all = all.concat(Array.prototype.slice.call(ents));
              readBatch();
            }, function () { resolve(); });
          })();
          return;
        }
        resolve();
      });
    }
    return Promise.all(entries.map(function (en) { return walk(en, 0); })).then(function () {
      /* 双保险：entries 拿不到就退回 dt.files（两路合起来去重） */
      var merged = pick(out).concat(plain);
      var seen = {}, uniq = [];
      merged.forEach(function (f) {
        var k = String(f.name || '') + '|' + f.size;
        if (!seen[k]) { seen[k] = 1; uniq.push(f); }
      });
      return uniq.slice(0, 80);
    });
  }

  /* 模型常把题库写成 Markdown（**加粗**、- A.、**答案：A**）；先还原成站点认的纯文本 */
  function normalizeBankText(text) {
    var t = String(text || '');
    t = t.replace(/```[a-zA-Z]*\s*\n?/g, '').replace(/```/g, '');
    t = t.replace(/^\s*>\s?/gm, '');
    /* 先去掉 Markdown 加粗，再识别「第1题 / （2）」和开场白 */
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1').replace(/`([^`\n]+)`/g, '$1');
    t = t.replace(/\*\*/g, '');
    var mHead = t.match(/^\s*#{1,2}\s+\S/m);
    if (mHead) t = t.slice(mHead.index);
    else {
      var mFirst = t.match(/^\s*(?:\d+[.、．)）]|[（(]\d+[）)]|第\s*\d+\s*题)\s*\S/m);
      if (mFirst) t = t.slice(mFirst.index);
    }
    t = t.replace(/^\s*第\s*(\d+)\s*题\s*/gm, '$1. ');
    t = t.replace(/^\s*[（(]\s*(\d+)\s*[）)]\s*/gm, '$1. ');
    t = t.replace(/^\s*[-*•]\s+(?=(?:\d+|[A-Ha-h])[.、．)）:：])/gm, '');
    t = t.replace(/【答案】/g, '答案：').replace(/【解析】/g, '解析：').replace(/【考点】/g, '考点：');
    t = t.replace(/(答案\s*[:：]\s*[A-Ha-h][A-Ha-h\s,，、\/|]*)[。.；;]\s*$/gm, '$1');
    t = t.replace(/(答案\s*[:：]\s*[A-Ha-h][A-Ha-h\s,，、\/|]*)\s+(?:解析|解释|考点)\s*[:：]\s*(.*)$/gm, '$1\n解析：$2');
    t = t.replace(/(答案\s*[:：]\s*[A-Ha-h]+)\s*[（(]([^）)]*)[）)]\s*$/gm, '$1\n解析：$2');
    return t;
  }
  
  function parseBankText(text, name) {
    if (typeof parseInput !== 'function') return null;
    var t = normalizeBankText(text);
    try {
      var r = parseInput(t, name || '导入的题库');
      if (r && r.error) return null;
      var qs = (r && r.bank && r.bank.questions) || [];
      if (!qs.length) return null;
      return { title: (r.bank.title || name || '导入的题库').slice(0, 40), questions: qs };
    } catch (e) { return null; }
  }

  /* ---------- 附件小标签 ---------- */
  function attLabel(a) {
    if (a.kind === 'bank') return '题库「' + a.title + '」';
    if (a.kind === 'cat') return '目录「' + a.title + '」（' + (a.n || '?') + ' 个题库）';
    if (a.kind === 'file-bank') return '题库文件「' + a.title + '」(' + (a.questions || []).length + ' 题)';
    if (a.kind === 'image') return '图片「' + a.name + '」';
    return '附件「' + a.name + '」' + (a.note ? '（' + a.note + '）' : '');
  }
  function pendHtml() {
    if (!PEND.length) return '';
    return PEND.map(function (a, i) {
      return '<span class="chat-att" data-i="' + i + '">' + E(attLabel(a)) + '<b data-x="' + i + '" title="移除">×</b></span>';
    }).join('');
  }
  function paintPend() {
    var box = $id('chatPend');
    if (!box) return;
    box.innerHTML = pendHtml();
    box.style.display = PEND.length ? '' : 'none';
    box.querySelectorAll('[data-x]').forEach(function (b) {
      b.onclick = function () { PEND.splice(+b.dataset.x, 1); paintPend(); };
    });
  }
  function addPend(item) {
    if ((item.kind === 'bank' || item.kind === 'cat') && PEND.some(function (x) { return x.kind === item.kind && x.id === item.id; })) return false;
    PEND.push(item);
    return true;
  }
  /* 存进对话树时给附件瘦身（图片太大就只留名字；文件题库留前 60 题） */
  function storeAtts(atts) {
    return (atts || []).map(function (a) {
      if (a.kind === 'image') return { kind: 'image', name: a.name, dataUrl: (a.dataUrl && a.dataUrl.length < 300000) ? a.dataUrl : '' };
      if (a.kind === 'file-bank') return { kind: 'file-bank', title: a.title, questions: (a.questions || []).slice(0, 60) };
      if (a.kind === 'file-text') return { kind: 'file-text', name: a.name, text: clip(a.text || '', 20000), note: a.note || '' };
      return { kind: a.kind, id: a.id, title: a.title, n: a.n };
    });
  }

  /* ============================================================
     知识库 / 题库数据
     ============================================================ */
  function kbChipsHtml() {
    var list = (typeof kbList === 'function') ? kbList() : [];
    if (!list.length) return '<span class="small muted">还没有知识库（去 <a href="#/kb">AI 与知识库</a> 导入；不选也能用，只是纯靠模型知识）</span>';
    var sel = {};
    ((typeof kbSelected === 'function') ? kbSelected() : []).forEach(function (id) { sel[id] = 1; });
    var allOn = list.every(function (k) { return sel[k.id]; });
    var h = '<span class="aichip aichip-all' + (allOn ? ' on' : '') + '" data-kb="__all__" title="一键选定全部资料">总库 · 全部</span>';
    h += list.map(function (k) {
      return '<span class="aichip' + (sel[k.id] ? ' on' : '') + '" data-kb="' + E(k.id) + '" title="' + (k.chars || 0).toLocaleString() + ' 字">' + E(k.name) + '</span>';
    }).join('');
    return h;
  }
  function bindChips(root) {
    root.querySelectorAll('.chat-kb .aichip').forEach(function (ch) {
      ch.onclick = function () {
        var id = ch.dataset.kb;
        if (id === '__all__') {
          var list = (typeof kbList === 'function') ? kbList() : [];
          var sel = (typeof kbSelected === 'function') ? kbSelected() : [];
          var allOn = list.length && list.every(function (k) { return sel.indexOf(k.id) >= 0; });
          list.forEach(function (k) { if (typeof kbSetSel === 'function') kbSetSel(k.id, !allOn); });
        } else if (typeof kbSetSel === 'function') {
          var on = !((typeof kbSelected === 'function' ? kbSelected() : []).indexOf(id) >= 0);
          kbSetSel(id, on);
        }
        var box = root.querySelector('.chat-kb');
        if (box) { box.innerHTML = kbChipsHtml(); bindChips(root); }
      };
    });
  }
  function kbBlocks(text, topK) {
    return new Promise(function (resolve) {
      var ids = (typeof kbSelected === 'function') ? kbSelected() : [];
      if (!ids.length || typeof kbSearch !== 'function' || !String(text || '').trim()) { resolve({ text: '', hits: [] }); return; }
      var go = function () {
        try {
          Promise.resolve(kbSearch(String(text).slice(0, 240), ids, topK || 4)).then(function (hits) {
            hits = (typeof aiUniqHits === 'function') ? aiUniqHits(hits || []) : (hits || []);
            var cfg = (typeof aiCfg === 'function') ? aiCfg() : {};
            var maxChars = Math.max(1200, Math.min(8000, +cfg.maxChars || 3500));
            var per = Math.max(400, Math.floor(maxChars / Math.max(1, hits.length)));
            var blocks = [], used = 0;
            hits.forEach(function (h) {
              var t = String(h.text || '').slice(0, per);
              if (used + t.length > maxChars && blocks.length) return;
              used += t.length;
              blocks.push('[' + (blocks.length + 1) + '] 《' + (h.doc || '资料') + (h.head ? ' · ' + h.head : '') + (h.page ? ' · 第' + h.page + '页' : '') + '》（知识库：' + (h.kb || '') + '）\n' + t);
            });
            resolve({ text: blocks.join('\n\n'), hits: hits.slice(0, blocks.length) });
          }, function () { resolve({ text: '', hits: [] }); });
        } catch (e) { resolve({ text: '', hits: [] }); }
      };
      if (typeof kbEnsureFilesLoaded === 'function') { try { kbEnsureFilesLoaded().then(go, go); } catch (e) { go(); } } else go();
    });
  }
  function hitRefs(hits) {
    return (hits || []).map(function (h) {
      var f = String(h.file || '').split(/[\\\/]/).pop();
      var name = (f || h.doc || '资料').replace(/\.[a-z0-9]+$/i, '').trim() || h.doc || '资料';
      return { name: clip(name, 40), page: h.page || '' };
    });
  }
  function recOf(bankId, q) {
    if (!bankId || typeof ANS === 'undefined') return null;
    var k = (typeof kOf === 'function') ? kOf({ id: bankId }, q) : '';
    return k ? (ANS[k] || null) : null;
  }
  function collectSets(atts) {
    var sets = [];
    (atts || []).forEach(function (a) {
      if (a.kind === 'bank' || a.kind === 'cat') {
        var banks = [];
        if (a.kind === 'bank') {
          var b = (typeof bankById === 'function') ? bankById(a.id) : null;
          if (b && !b.paper) banks = [b];
        } else if (typeof CAT !== 'undefined' && CAT && CAT.all) {
          var ids = [a.id].concat(CAT.descIds ? CAT.descIds(a.id) : []);
          var all = (typeof baseBanks === 'function') ? baseBanks() : [];
          banks = all.filter(function (x) { return ids.indexOf(x.cat) >= 0; });
        }
        banks.forEach(function (b) { sets.push({ title: b.title, bankId: b.id, questions: b.questions || [] }); });
      } else if (a.kind === 'file-bank') {
        sets.push({ title: a.title, bankId: '', questions: a.questions || [] });
      }
    });
    return sets;
  }
  function attsBrief(atts) {
    var sets = collectSets((atts || []).filter(function (a) { return a.kind === 'bank' || a.kind === 'cat' || a.kind === 'file-bank'; }));
    if (!sets.length) return '';
    var out = [];
    sets.slice(0, 4).forEach(function (s) {
      out.push('【附件题库】' + s.title + '（共 ' + (s.questions || []).length + ' 题）');
      (s.questions || []).slice(0, 12).forEach(function (q, i) {
        out.push((i + 1) + '. ' + clip(q.stem, 70) + '　答案：' + ((q.answer || []).join('') || '—'));
      });
    });
    return out.join('\n');
  }
  function statsText(sets, promptWords) {
    var total = 0, answered = 0, ok = 0, wrongQs = [], lines = [], tagHit = {};
    sets.forEach(function (s) {
      var done = 0, oks = 0, wr = 0;
      (s.questions || []).forEach(function (q) {
        total++;
        var rec = recOf(s.bankId, q);
        if (rec && !rec.redo) {
          done++; answered++;
          if (rec.ok) { oks++; ok++; } else wr++;
          if ((rec.wrong || 0) > 0) wrongQs.push({ t: s.title, q: q, wrong: rec.wrong || 0, tries: rec.tries || 0, sel: (rec.sel || []).join('') });
        }
        var tags = [];
        try { if (typeof tagsOf === 'function' && s.bankId) tags = tagsOf(((typeof kOf === 'function') ? kOf({ id: s.bankId }, q) : '')); } catch (e) {}
        tags.forEach(function (t) { tagHit[t] = (tagHit[t] || 0) + 1; });
      });
      if ((s.questions || []).length) lines.push('· 《' + s.title + '》：' + s.questions.length + ' 题，做过的 ' + done + '，对 ' + oks + (wr ? '，错过 ' + wr + ' 题' : ''));
    });
    wrongQs.sort(function (a, b) { return b.wrong - a.wrong; });
    var out = [];
    out.push('【题库概况】共 ' + sets.length + ' 个题库 / ' + total + ' 题；有作答记录的 ' + answered + ' 题（对 ' + ok + '）');
    out.push(lines.slice(0, 12).join('\n'));
    var tags = Object.keys(tagHit).sort(function (a, b) { return tagHit[b] - tagHit[a]; }).slice(0, 15);
    if (tags.length) out.push('【考点标签统计】' + tags.map(function (t) { return t + '(' + tagHit[t] + ')'; }).join('、'));
    var pick = wrongQs.filter(function (x) { return x.wrong > 0; }).slice(0, 40);
    var useAll = pick.length < 3;
    if (!pick.length) {
      var rough = [];
      sets.forEach(function (s) {
        (s.questions || []).slice(0, Math.max(0, 20 - rough.length)).forEach(function (q) { rough.push({ t: s.title, q: q, wrong: 0, tries: 0, sel: '' }); });
      });
      pick = rough.slice(0, 20);
      out.push('【说明】还没有错题记录（或这些题库没做过），下面抽了 ' + pick.length + ' 道题给你看整体。');
    }
    if (pick.length) {
      out.push('【' + (useAll ? '题目摘录' : '最常错的题（按错次排序，最多 40 道）') + '】');
      pick.forEach(function (x, i) {
        var q = x.q || {};
        out.push((i + 1) + '. [' + x.t + '] ' + clip(q.stem, 90)
          + '\n   答案：' + ((q.answer || []).join('') || '—') + (x.sel ? '；我选 ' + x.sel : '')
          + (x.tries ? '（作答 ' + x.tries + ' 次 / 错 ' + x.wrong + ' 次）' : '')
          + (q.explain ? '\n   解析：' + clip(q.explain, 110) : ''));
      });
    }
    var extra = (promptWords || '').trim();
    if (extra) out.push('【我的要求】' + extra);
    return out.join('\n');
  }

  /* ---------- 意图识别 ---------- */
  function guessMode(text, atts) {
    var t = String(text || '');
    var hasBank = (atts || []).some(function (a) { return a.kind === 'bank' || a.kind === 'cat' || a.kind === 'file-bank'; });
    var quiz = /出.{0,10}题|出题|生成.{0,10}题|出几道|来几道|出几题|来几题|来.{0,6}[0-9一二三四五六七八九十两几]{1,3}\s*(道|题)|(出|给|来|弄).{0,10}[0-9一二三四五六七八九十两几]{1,3}\s*(道|题)|考我|考考我|做题|组.{0,4}(套卷|卷子)|做.{0,3}(套卷|卷子)|做成.{0,6}题库|建.{0,6}题库/.test(t);
    var analyze = /分析|总结|归纳|梳理|易错|薄弱|错题|知识点|考点|统计|复习计划|复习建议/.test(t);
    if (quiz && !analyze) return 'quiz';
    if (analyze) return 'analyze';
    if (hasBank) return 'analyze';
    return 'qa';
  }

  /* ============================================================
     界面
     ============================================================ */
  function chatInnerHtml(mode) {
    return '<div class="card chat-card' + (mode === 'home' ? ' chat-home' : ' chat-full') + '">'
      + '<div class="chat-title-row"><b>💬 AI 对话</b><span class="small muted chat-sub">问知识点 / 出题 / 分析题库</span>'
      + '<span class="spacer-grow"></span>'
      + (mode === 'home' ? '<button class="btn tiny" id="chatFull" title="进入全屏对话">⤢ 全屏</button>' : '')
      + (mode === 'full' ? '<button class="btn tiny" id="chatClear" title="清空这段对话（不影响题库和作答）">清空</button>' : '')
      + '<button class="btn tiny" id="chatSkill" title="选择技能">🧩 技能</button>'
      + '</div>'
      + '<div class="chat-pickrow">'
      + '<span class="tl small muted">资料</span>'
      + '<div class="chat-kb" id="chatKb">' + kbChipsHtml() + '</div>'
      + '<button class="btn tiny" id="chatPickBank" title="从我的题库 / 目录里挑几个放进来">📚 选题库</button>'
      + '</div>'
      + '<div class="chat-log" id="chatLog"></div>'
      + '<div class="chat-pend" id="chatPend" style="display:none"></div>'
      + '<div class="chat-input">'
      + '<textarea id="chatTa" rows="2" placeholder="直接写：给我出 5 道「心衰」的题 / 慢阻肺和哮喘怎么鉴别 / 帮我分析这个题库的易错点；也能下令：删除题库《X》/ 给《X》打标签：心衰 / 收藏《X》第3题"></textarea>'
      + '<div class="chat-input-bar">'
      + '<button class="ch-ico" id="chatAttach" title="选文件：txt / json / md / pdf / docx / html / 图片">📎</button>'
      + '<input type="file" id="chatFile" multiple accept=".txt,.md,.markdown,.json,.js,.csv,.pdf,.docx,.doc,.html,.htm,image/*" style="display:none">'
      + '<span class="chat-hint-inline small muted">可拖：txt json md pdf docx html 图片 / 文件夹</span>'
      + '<span class="spacer-grow"></span>'
      + '<button class="btn tiny" id="chatStop" style="display:none">停止</button>'
      + '<button class="ch-send" id="chatSend" title="发送（Enter）">↑</button>'
      + '</div></div>'
      + '<div class="small muted chat-hint">Enter 发送，Shift+Enter 换行；文件直接拖到这个卡片上也能加进来；右下角拖动可调高对话区；说「你能做什么」看 AI 能替你操作什么。</div>'
      + '</div>';
  }

  function bindChat(root, mode) {
    bindChips(root);
    var send = $id('chatSend');
    if (send) send.onclick = doSend;
    var fullBtn = $id('chatFull');
    if (fullBtn) fullBtn.onclick = function () { if (typeof go === 'function') go('#/chat'); };
    var logBox = $id('chatLog');
    if (logBox) {
      logBox.addEventListener('scroll', function () {
        LOG_STICK = (logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight) < 48;
      });
      if (mode === 'home') {
        var savedH = +readLS('qbank.chat.h.v1', 0);
        if (savedH >= 140) logBox.style.height = Math.min(savedH, Math.round((window.innerHeight || 800) * .7)) + 'px';
        if (window.ResizeObserver) {
          var ro = new ResizeObserver(function () {
            var h = Math.round(logBox.offsetHeight);
            if (h >= 140) writeLS('qbank.chat.h.v1', h);
          });
          ro.observe(logBox);
        }
      }
    }
    var ta = $id('chatTa');
    if (ta) {
      ta.value = DRAFT || '';
      ta.addEventListener('input', function () { DRAFT = ta.value; });
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); }
      });
    }
    if (RUN) {
      var st = $id('chatStop'); if (st) st.style.display = '';
      if (send) send.disabled = true;
    }
    var attach = $id('chatAttach');
    var file = $id('chatFile');
    if (attach && file) {
      attach.onclick = function () { file.click(); };
      file.onchange = function (e) {
        var fs = Array.prototype.slice.call(e.target.files || []);
        e.target.value = '';
        if (!fs.length) return;
        Promise.all(fs.map(attachFile)).then(function () { paintPend(); });
      };
    }
    var pick = $id('chatPickBank');
    if (pick) pick.onclick = openPicker;
    var cl = $id('chatClear');
    if (cl) cl.onclick = function () {
      var ask = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(confirm(o.title)); };
      ask({ title: '清空这段对话？', html: '只清聊天记录，题库 / 作答 / 收藏都不动。', okText: '清空', danger: true }).then(function (ok) {
        if (!ok) return;
        var c = curChat();
        if (c) { c.tree.nodes = {}; c.tree.roots = []; c.tree.active = null; TREE = c.tree; }
        else { TREE = emptyTree(); }
        EDIT = null;
        saveChat(); paintLog(); paintChatList(); T('已清空这段对话');
      });
    };
    var skb = $id('chatSkill');
    if (skb) skb.onclick = function () {
      if (window.SKILLS) SKILLS.pick();
      else T('技能模块没加载', 1800, 'bad');
    };
    if (window.SKILLS) { try { SKILLS.syncButton(); } catch (e) {} }
    var stop = $id('chatStop');
    if (stop) stop.onclick = function () { if (RUN && RUN.ctl) { try { RUN.ctl.abort(); } catch (e) {} } };
    var card = root.querySelector('.chat-card');
    if (card && mode !== 'home') {
      card.addEventListener('dragover', function (e) { if (e.dataTransfer && (e.dataTransfer.types || []).length) { e.preventDefault(); card.classList.add('chat-drag'); } });
      card.addEventListener('dragleave', function (e) { if (!card.contains(e.relatedTarget)) card.classList.remove('chat-drag'); });
      card.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        card.classList.remove('chat-drag');
        handleDrop(e.dataTransfer).then(function (n) { if (n) paintPend(); });
      });
    }
    if (typeof kbEnsureFilesLoaded === 'function') {
      try {
        kbEnsureFilesLoaded().then(function () {
          var box = $id('chatKb');
          if (box) { box.innerHTML = kbChipsHtml(); bindChips(root); }
        }, function () {});
      } catch (e) {}
    }
  }

  /* ---------- 消息渲染 ---------- */
  function branchHtml(n) {
    var sib = siblingsOf(n);
    if (sib.length < 2) return '';
    var i = sib.indexOf(n.id);
    return '<span class="chat-branch" title="这是第 ' + (i + 1) + ' / ' + sib.length + ' 个版本">'
      + '<button class="ch-bn" data-sw="' + n.id + '" data-dir="-1" title="上一个版本">‹</button>'
      + '<span>' + (i + 1) + '/' + sib.length + '</span>'
      + '<button class="ch-bn" data-sw="' + n.id + '" data-dir="1" title="下一个版本">›</button>'
      + '</span>';
  }
  function statusHtml(n) {
    if (!n.streaming) return '';
    var txt = n.phase === 'retrieval' ? '正在检索知识库…' : (n.phase === 'thinking' ? '深度思考中' : '正在思考');
    return '<div class="chat-status" data-status="' + n.id + '"><i class="ch-dot"></i><span class="ch-stx">' + txt + ' 0 秒…</span></div>';
  }
  function reasonHtml(n) {
    if (!n.reason) return '';
    if (n.streaming) return '<div class="chat-reason-live small muted" data-reason="' + n.id + '">' + E(n.reason) + '</div>';
    return '<details class="chat-reason"><summary>已深度思考（用时 ' + (n.thinkSec || '?') + ' 秒）</summary><div class="ch-rt small muted">' + E(n.reason) + '</div></details>';
  }
  function actsHtml(n) {
    var acts = (n.acts || []);
    var out = '';
    if (acts.length) {
      out += '<div class="chat-acts">' + acts.map(function (a) {
        return '<button class="btn tiny' + (a.danger ? ' danger' : '') + '" data-act="' + E(a.id) + '" data-nid="' + E(n.id) + '">' + E(a.label) + '</button>';
      }).join('') + '</div>';
    }
    /* DeepSeek 风格：回复底下一排小图标 */
    out += '<div class="msg-tools">'
      + '<button class="ch-tool" data-act="copy" data-nid="' + E(n.id) + '" title="复制回答">⧉</button>'
      + (n.ops ? '' : ('<button class="ch-tool" data-act="retry" data-nid="' + E(n.id) + '" title="重新生成（旧版留成分支）">↻</button>'))
      + '</div>';
    return out;
  }
  function editHtml(n) {
    return '<div class="chat-edit">'
      + '<textarea class="ch-eta" id="chEditTa">' + E(n.qtext || n.text || '') + '</textarea>'
      + '<div class="chat-acts"><button class="btn tiny primary" data-edit-ok="' + E(n.id) + '">保存并重新回答</button>'
      + '<button class="btn tiny" data-edit-cancel="1">取消</button></div>'
      + '</div>';
  }
  function msgHtml(n) {
    var isUser = n.role === 'user';
    var editing = isUser && EDIT === n.id;
    var body = isUser ? E(n.text || '') : ((typeof mdToHtml === 'function') ? mdToHtml(n.text || '') : E(n.text || ''));
    var refs = (!isUser && n.refs && n.refs.length)
      ? '<div class="chat-refs small muted">参考资料：' + n.refs.map(function (r, j) {
        return '[' + (j + 1) + '] 《' + E(r.name) + '》' + (r.page ? ' 第 ' + r.page + ' 页' : '');
      }).join('　') + '</div>' : '';
    var tracePanel = '';
    if (!isUser && n.trace && n.trace.length) {
      var IC = { ok: '✅', err: '⚠', warn: '⏳', cache: '♻' };
      tracePanel = '<details class="ch-trace"><summary>工具调用 ' + n.trace.length + ' 次</summary>'
        + n.trace.map(function (t, i) {
          return '<div class="ch-trow"><span class="ch-tic">' + (IC[t.state] || '🛠') + '</span>'
            + '<b>' + (i + 1) + '. ' + E(t.name) + '</b>'
            + (t.ms != null ? '<span class="small muted"> ' + t.ms + 'ms</span>' : '')
            + '<div class="ch-tres small muted">' + E(t.result || '') + '</div></div>';
        }).join('') + '</details>';
    }
    return '<div class="chat-msg ' + (isUser ? 'user' : 'ai') + (n.streaming ? ' streaming' : '') + '" data-nid="' + E(n.id) + '">'
      + '<div class="chat-bubble">'
      + '<div class="chat-meta small muted">' + (isUser && n.tag ? '<span class="chat-tag">' + E(n.tag) + '</span>' : '') + branchHtml(n) + '</div>'
      + (editing ? editHtml(n) : ('<div class="chat-text">' + body + '</div>'))
      + tracePanel
      + (!isUser ? statusHtml(n) : '')
      + (!isUser && n.reason ? reasonHtml(n) : '')
      + refs
      + (isUser
        ? (editing ? '' : '<div class="msg-tools"><button class="ch-tool" data-edit="' + E(n.id) + '" title="编辑后重新回答">✎</button></div>')
        : actsHtml(n))
      + '</div></div>';
  }
  function paintLog() {
    var box = $id('chatLog');
    if (!box) return;
    var stick = LOG_STICK, prevTop = box.scrollTop;
    var ids = pathIds();
    var bar = opsInterruptedHtml();
    if (!ids.length) {
      box.innerHTML = bar + '<div class="chat-empty">'
        + '<div class="ce-t">可以这样问：</div>'
        + '<div class="chat-eg" data-eg="给我出 5 道「心肌梗死」的题">给我出 5 道「心肌梗死」的题</div>'
        + '<div class="chat-eg" data-eg="慢阻肺和支气管哮喘怎么鉴别？">慢阻肺和支气管哮喘怎么鉴别？</div>'
        + '<div class="chat-eg" data-eg="帮我分析这个题库里的易错点">帮我分析这个题库里的易错点</div>'
        + '</div>';
      box.querySelectorAll('[data-eg]').forEach(function (el) {
        el.onclick = function () {
          var ta = $id('chatTa');
          if (ta) { ta.value = el.dataset.eg; DRAFT = ta.value; ta.focus(); }
        };
      });
      bindOpsBanner(box);
      return;
    }
    box.innerHTML = bar + ids.map(function (id) { return msgHtml(node(id)); }).join('');
    box.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { doAct(b.dataset.act, b.dataset.nid); }; });
    box.querySelectorAll('[data-sw]').forEach(function (b) { b.onclick = function () { switchBranch(b.dataset.sw, +b.dataset.dir); }; });
    box.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { EDIT = b.dataset.edit; paintLog(); var t = $id('chEditTa'); if (t) { t.focus(); try { t.setSelectionRange(t.value.length, t.value.length); } catch (e) {} } }; });
    box.querySelectorAll('[data-edit-cancel]').forEach(function (b) { b.onclick = function () { EDIT = null; paintLog(); }; });
    box.querySelectorAll('[data-edit-ok]').forEach(function (b) { b.onclick = function () { saveEdit(b.dataset.editOk); }; });
    bindOpsBanner(box);
    if (stick) {
      box.scrollTop = box.scrollHeight;
      /* 刚挂载时高度可能还没算完，下一帧再贴一次底部 */
      setTimeout(function () { if (box.isConnected && LOG_STICK) box.scrollTop = box.scrollHeight; }, 80);
    } else box.scrollTop = prevTop;
  }

  /* 主页内嵌：cat.js 每次重画首页后调用 */
  function mountHome(holder) {
    var slot = (holder || document).querySelector('#chatHome');
    if (!slot) return;
    slot.innerHTML = chatInnerHtml('home');
    bindChat(slot, 'home');
    LOG_STICK = true;
    paintLog();
    paintPend();
    syncSideTab();
    if (SCROLL_NEXT) {
      SCROLL_NEXT = false;
      try { slot.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { slot.scrollIntoView(); } catch (e2) {} }
      slot.classList.add('chat-flash');
      setTimeout(function () { slot.classList.remove('chat-flash'); }, 1600);
    }
  }
  function render() {
    var view = $id('view');
    if (!view) return;
    var appT = $id('appTitle');
    if (appT) appT.textContent = 'AI 对话';
    view.innerHTML = '<div class="chat-page"><div class="chat-main">' + chatInnerHtml('full') + '</div></div>';
    try { window.scrollTo(0, 0); } catch (e) {}
    bindChat(view, 'full');
    LOG_STICK = true;
    paintLog();
    paintPend();
    paintChatList();
    syncSideTab();
    if (RUN) T('上一轮还在生成，等它写完或点「停止」', 2000);
  }

  /* ---------- 侧边「对话记录」抽屉（DeepSeek 式：左边一个小按钮，点开就是列表） ---------- */
  function ensureSideTab() {
    var b = $id('chatSideBtn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'chatSideBtn';
      b.type = 'button';
      b.className = 'chat-side-tab';
      b.title = '对话记录';
      b.setAttribute('aria-label', '对话记录');
      b.textContent = '☰';
      b.onclick = function () { var d = $id('chatDrawer'); if (d && d.classList.contains('show')) closeSide(); else openSide(); };
      document.body.appendChild(b);
    }
    return b;
  }
  function syncSideTab() {
    var on = !!document.querySelector('#chatHome, .chat-page');
    var b = ensureSideTab();
    b.style.display = on ? '' : 'none';
  }
  function ensureDrawer() {
    var d = $id('chatDrawer');
    if (d) return d;
    var mask = document.createElement('div');
    mask.id = 'chatDrawerMask';
    mask.className = 'chat-drawer-mask';
    mask.onclick = closeSide;
    d = document.createElement('aside');
    d.id = 'chatDrawer';
    d.className = 'chat-side chat-drawer';
    d.innerHTML = '<div class="chat-side-head"><b>对话</b><span class="spacer-grow"></span>'
      + '<button class="chat-drawer-x" id="chatDrawerX" type="button" title="收起" aria-label="收起">×</button></div>'
      + '<button class="chat-newbig" id="chatNew2" type="button"><span class="cn-plus">＋</span>开启新对话</button>'
      + '<div class="chat-side-list" id="chatSideList"></div>';
    document.body.appendChild(mask);
    document.body.appendChild(d);
    $id('chatDrawerX').onclick = closeSide;
    $id('chatNew2').onclick = function () {
      newChat();
      closeSide();
      if (!$id('chatLog') && typeof go === 'function') go('#/chat');
    };
    return d;
  }
  function openSide() {
    ensureDrawer();
    paintChatList();
    var m = $id('chatDrawerMask'), d = $id('chatDrawer');
    if (m) m.classList.add('show');
    if (d) d.classList.add('show');
  }
  function closeSide() {
    var m = $id('chatDrawerMask'), d = $id('chatDrawer');
    if (m) m.classList.remove('show');
    if (d) d.classList.remove('show');
  }

  /* ---------- 会话列表（像 DeepSeek 左边那栏） ---------- */
  function startOfDay(ts) { var d = new Date(ts || Date.now()); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function paintChatList() {
    ensureDrawer();
    var box = $id('chatSideList');
    if (!box) return;
    var list = DB.chats.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var today = startOfDay();
    var buckets = {};
    list.forEach(function (c) {
      var diff = Math.floor((today - startOfDay(c.updatedAt)) / 86400000);
      var lb = diff <= 0 ? '今天' : diff === 1 ? '昨天' : diff <= 7 ? '7 天内' : diff <= 30 ? '30 天内' : '更早';
      (buckets[lb] = buckets[lb] || []).push(c);
    });
    var html = '';
    ['今天', '昨天', '7 天内', '30 天内', '更早'].forEach(function (lb) {
      if (!buckets[lb]) return;
      html += '<div class="chat-side-g">' + lb + '</div>';
      buckets[lb].forEach(function (c) {
        html += '<div class="chat-item' + (c.id === DB.cur ? ' on' : '') + '" data-cid="' + E(c.id) + '">'
          + '<span class="ci-t" title="' + E(c.title) + '">' + E(c.title || '新对话') + '</span>'
          + '<button class="ci-x" data-del="' + E(c.id) + '" title="删除这段对话">×</button></div>';
      });
    });
    box.innerHTML = html || '<div class="chat-side-empty small muted">还没有对话<br><span>点上面的「开启新对话」开始</span></div>';
    box.querySelectorAll('.chat-item').forEach(function (el) {
      el.onclick = function (e) {
        if (e.target.closest('.ci-x')) return;
        closeSide();
        switchChat(el.dataset.cid);
        if (!$id('chatLog') && typeof go === 'function') go('#/chat');
      };
    });
    box.querySelectorAll('.ci-x').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); askDelChat(b.dataset.del); };
    });
  }
  function newChat() {
    saveChat();
    var c = mkChat('新对话');
    DB.chats.unshift(c);
    DB.cur = c.id;
    TREE = c.tree;
    EDIT = null;
    DRAFT = '';
    LOG_STICK = true;
    saveChat();
    paintLog(); paintPend(); paintChatList();
    var ta = $id('chatTa');
    if (ta) { ta.value = ''; try { ta.focus(); } catch (e) {} }
  }
  function switchChat(id) {
    if (!id || id === DB.cur) return;
    saveChat();
    var c = chatById(id);
    if (!c) return;
    DB.cur = id;
    TREE = c.tree;
    LOG_STICK = true;
    if (!TREE.nodes[TREE.active]) TREE.active = TREE.roots.length ? deepest(TREE.roots[TREE.roots.length - 1]) : null;
    EDIT = null;
    paintLog(); paintPend(); paintChatList();
  }
  function askDelChat(id) {
    var c = chatById(id);
    if (!c) return;
    var ask = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(confirm(o.title)); };
    ask({ title: '删除这段对话？', html: '「' + E(c.title) + '」的聊天记录会删掉（题库和作答不受影响）。', okText: '删除', danger: true }).then(function (ok) {
      if (!ok) return;
      DB.chats = DB.chats.filter(function (x) { return x.id !== id; });
      if (DB.cur === id) {
        var nxt = DB.chats.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0];
        if (nxt) { DB.cur = nxt.id; TREE = nxt.tree; }
        else { DB.cur = null; TREE = emptyTree(); }   /* 最后一段也能真删干净，不偷偷再建一段 */
      }
      EDIT = null;
      saveChat(); paintLog(); paintChatList();
    });
  }

  /* ============================================================
     选题库面板
     ============================================================ */
  function pickItems() {
    var items = [];
    var banks = (typeof baseBanks === 'function') ? baseBanks() : [];
    banks.forEach(function (b) { items.push({ key: 'b:' + b.id, kind: 'bank', id: b.id, title: b.title || '未命名题库', n: (b.questions || []).length + ' 题' }); });
    if (typeof CAT !== 'undefined' && CAT && CAT.all) {
      CAT.all().forEach(function (c) {
        var n = 0, q = 0;
        banks.forEach(function (b) { if (b.cat === c.id) { n++; q += (b.questions || []).length; } });
        items.push({ key: 'c:' + c.id, kind: 'cat', id: c.id, title: c.title || '目录', n: n + ' 个库 / ' + q + ' 题' });
      });
    }
    return items;
  }
  function pickVisible() {
    var q = (PICK.q || '').trim().toLowerCase();
    if (!q) return PICK.items;
    return PICK.items.filter(function (it) { return String(it.title).toLowerCase().indexOf(q) >= 0; });
  }
  function openPicker() {
    if (PICK) return;
    PICK = { sel: {}, q: '', items: pickItems() };
    if (!PICK.items.length) { T('本机还没有题库', 2000); PICK = null; return; }
    var mask = document.createElement('div');
    mask.className = 'mask show chat-pk-mask';
    mask.innerHTML = '<div class="sheet chat-pk">'
      + '<div class="shead"><h3>选题库 / 目录</h3><span class="spacer-grow"></span><button class="btn tiny" data-pk="close">关闭</button></div>'
      + '<div class="pk-bar"><input id="pkSearch" class="nb-search" placeholder="搜题库 / 目录名…（支持筛选）">'
      + '<button class="btn tiny" data-pk="all">全选（筛出来的）</button>'
      + '<button class="btn tiny" data-pk="inv">反选</button>'
      + '<button class="btn tiny" data-pk="none">清空</button></div>'
      + '<div class="pk-tip small muted">点一下选中 / 取消；鼠标在空白处拖一个方框 = 框选（按住 Ctrl / Shift 是追加）。</div>'
      + '<div class="pk-body"><div class="pk-grid" id="pkGrid"></div><div class="pk-marquee" id="pkMarq" style="display:none"></div></div>'
      + '<div class="pk-foot"><span class="small muted" id="pkCnt"></span><span class="spacer-grow"></span>'
      + '<button class="btn" data-pk="close">取消</button>'
      + '<button class="btn primary" data-pk="ok">加入对话</button></div>'
      + '</div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) { if (e.target === mask) closePick(); });
    mask.querySelectorAll('[data-pk]').forEach(function (b) { b.onclick = function () { pkAction(b.dataset.pk); }; });
    var search = mask.querySelector('#pkSearch');
    search.addEventListener('input', function () { PICK.q = search.value; paintPickGrid(); });
    bindPickMarquee(mask.querySelector('.pk-body'));
    paintPickGrid();
  }
  function closePick() {
    var m = document.querySelector('.chat-pk-mask');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    PICK = null;
  }
  function paintPickGrid() {
    var grid = $id('pkGrid');
    if (!grid || !PICK) return;
    var items = pickVisible();
    grid.innerHTML = items.length ? items.map(function (it) {
      var on = !!PICK.sel[it.key];
      return '<div class="pk-item' + (on ? ' on' : '') + '" data-key="' + E(it.key) + '" title="' + E(it.title) + '">'
        + '<span class="pk-ic">' + (it.kind === 'cat' ? '📁' : '📄') + '</span>'
        + '<span class="pk-name">' + E(it.title) + '</span>'
        + '<span class="pk-n">' + E(it.n) + '</span>'
        + '</div>';
    }).join('') : '<div class="empty" style="grid-column:1/-1">没有匹配的题库 / 目录</div>';
    grid.querySelectorAll('.pk-item').forEach(function (el) {
      el.onclick = function () {
        var k = el.dataset.key;
        if (PICK.sel[k]) delete PICK.sel[k]; else PICK.sel[k] = 1;
        el.classList.toggle('on', !!PICK.sel[k]);
        pkPaintCnt();
      };
    });
    pkPaintCnt();
  }
  function pkPaintCnt() {
    var cnt = $id('pkCnt');
    if (cnt) cnt.textContent = '已选 ' + Object.keys(PICK.sel).length + ' 项 · 共 ' + pickVisible().length + ' / ' + PICK.items.length;
  }
  function pkAction(a) {
    if (!PICK) return;
    if (a === 'close') { closePick(); return; }
    if (a === 'ok') {
      var n = 0;
      PICK.items.forEach(function (it) {
        if (!PICK.sel[it.key]) return;
        if (it.kind === 'bank') {
          var b = (typeof bankById === 'function') ? bankById(it.id) : null;
          if (b && addPend({ kind: 'bank', id: b.id, title: b.title })) n++;
        } else if (it.kind === 'cat') {
          var c = (typeof CAT !== 'undefined' && CAT && CAT.get) ? CAT.get(it.id) : null;
          var cnt = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
          var ids = [it.id].concat((typeof CAT !== 'undefined' && CAT && CAT.descIds) ? CAT.descIds(it.id) : []);
          all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) cnt++; });
          if (c && addPend({ kind: 'cat', id: it.id, title: c.title || '目录', n: cnt })) n++;
        }
      });
      closePick();
      paintPend();
      if (n) T('已加进对话：' + n + ' 项', 1800, 'ok');
      return;
    }
    var vis = pickVisible();
    if (a === 'all') vis.forEach(function (it) { PICK.sel[it.key] = 1; });
    else if (a === 'inv') vis.forEach(function (it) { if (PICK.sel[it.key]) delete PICK.sel[it.key]; else PICK.sel[it.key] = 1; });
    else if (a === 'none') PICK.sel = {};
    paintPickGrid();
  }
  function bindPickMarquee(body) {
    if (!body) return;
    var marq = body.querySelector('#pkMarq');
    var sx = 0, sy = 0, moved = false, additive = false, active = false;
    function paintMarq(x, y) {
      var l = Math.min(sx, x), t = Math.min(sy, y), w = Math.abs(x - sx), h = Math.abs(y - sy);
      if (!moved && (w > 5 || h > 5)) moved = true;
      if (!moved) return;
      marq.style.display = 'block';   /* 只有真正在拖的时候才放出来（默认 display:none 由 CSS 管） */
      marq.style.left = l + 'px'; marq.style.top = t + 'px';
      marq.style.width = w + 'px'; marq.style.height = h + 'px';
      var r = { l: l, t: t, r: l + w, b: t + h };
      body.querySelectorAll('.pk-item').forEach(function (el) {
        var b = el.getBoundingClientRect();
        el.classList.toggle('pk-hit', !(b.right < r.l || b.left > r.r || b.bottom < r.t || b.top > r.b));
      });
    }
    function finish() {
      if (!active) return;
      active = false;
      if (marq) marq.style.display = 'none';
      if (!moved) return;
      moved = false;
      var hits = [];
      body.querySelectorAll('.pk-item.pk-hit').forEach(function (el) { el.classList.remove('pk-hit'); hits.push(el.dataset.key); });
      if (!PICK) return;
      if (!additive) PICK.sel = {};
      hits.forEach(function (k) { PICK.sel[k] = 1; });
      paintPickGrid();
    }
    body.addEventListener('pointerdown', function (e) {
      /* 只在鼠标空白处按下时开始框选；触摸、点条目都不算 */
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('.pk-item')) return;
      active = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      additive = !!(e.ctrlKey || e.metaKey || e.shiftKey);
      if (marq) marq.style.display = 'none';
      try { body.setPointerCapture(e.pointerId); } catch (err) {}
    });
    body.addEventListener('pointermove', function (e) {
      if (!active || e.pointerType !== 'mouse') return;
      paintMarq(e.clientX, e.clientY);
    });
    body.addEventListener('pointerup', finish);
    body.addEventListener('pointercancel', finish);
  }

  /* ============================================================
     发送 / 重试 / 编辑
     ============================================================ */
  /* ============================================================
     AI 操作指令：能直接改本机的题库 / 标签 / 收藏 / 错题 / 设置
     —— 写操作先确认，执行后消息下面给「↶ 撤销」
     ============================================================ */
  /* 撤销：走 AI_OPS 的变更日志，不再整份快照覆盖 */
  function doUndo() {
    var id = TREE.active, guard = 0;
    while (id && guard++ < 400) {
      var n = node(id);
      if (n && n.ops && n.ops.planId && !n.ops.undone) {
        if (n.ops.reversible === false) { T('这次操作含不可撤销步骤，不能整份撤销', 2400, 'bad'); return; }
        opsUndo(n);
        return;
      }
      id = n && n.parent;
    }
    var last = (window.AI_OPS && AI_OPS.lastUndoable) ? AI_OPS.lastUndoable() : null;
    if (!last) { T('没有可撤销的操作', 1600); return; }
    var r = AI_OPS.undoPlan(last.id);
    if (!r || !r.ok) { T((r && r.error) || ('撤销没完成：有 ' + ((r && r.conflicts && r.conflicts.length) || 0) + ' 处数据已被手动改过，已保留'), 2800, 'bad'); return; }
    T('已撤销最近一次操作', 1800, 'ok');
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 400);
  }

  /* 从一句话里找题库：先认《书名号》，再认「标题出现在句子里」 */
  function cmdBanks(text) {
    var list = (typeof baseBanks === 'function') ? baseBanks() : [];
    var allM = text.match(/[《「“"]([^》」”"]{1,50})[》」”"]/g) || [];
    if (allM.length > 1) {
      var picked = [];
      allM.forEach(function (raw) {
        var q = raw.replace(/^[《「“"]|[》」”"]$/g, '').replace(/题库$/, '').trim();
        var f = list.filter(function (b) { return String(b.title).replace(/题库$/, '').trim() === q; });
        if (!f.length) f = list.filter(function (b) { return String(b.title).replace(/题库$/, '').indexOf(q) >= 0; });
        if (f.length === 1 && picked.indexOf(f[0]) < 0) picked.push(f[0]);
      });
      if (picked.length) return picked;
    }
    var m = text.match(/[《「“"]([^》」”"]{1,50})[》」”"]/);
    if (m) {
      var q = m[1].replace(/题库$/, '').trim();
      var exact = list.filter(function (b) { return String(b.title).replace(/题库$/, '').trim() === q; });
      if (!exact.length) exact = list.filter(function (b) { return String(b.title).replace(/题库$/, '').indexOf(q) >= 0; });
      if (exact.length) return exact;
    }
    var seen = {}, hits = [];
    list.forEach(function (b) {
      var t = String(b.title || '').replace(/题库$/, '').trim();
      if (t.length >= 4 && text.indexOf(t) >= 0 && !seen[b.id]) { seen[b.id] = 1; hits.push(b); }
    });
    return hits;
  }
  function cmdNums(text, max) {
    var m = text.match(/(?:第\s*)?([0-9]+(?:\s*[、,，和及\-–~至]\s*[0-9]+)*)\s*题/);
    if (!m) return [];
    var out = [];
    m[1].split(/\s*[、,，和及]\s*/).forEach(function (part) {
      var r = part.split(/\s*[-–~至]\s*/);
      if (r.length === 2) {
        var a = +r[0], b = +r[1];
        if (a > b) { var t = a; a = b; b = t; }
        for (var i = a; i <= b && out.length < 200; i++) out.push(i);
      } else if (r.length === 1 && +part) out.push(+part);
    });
    var uniq = [];
    out.forEach(function (n) { if (n >= 1 && n <= max && uniq.indexOf(n) < 0) uniq.push(n); });
    return uniq;
  }
  /* 当前正在做的那道题：#/chat 是另一个页面，但 QZ / 上次位置还在 */
  function currentQuestion() {
    try {
      var bid = null, qid = null;
      if (typeof QZ !== 'undefined' && QZ && QZ.bankId) { bid = QZ.bankId; qid = QZ.cur; }
      if (!bid) {
        var last = readLS('qbank.lastbank.v1', null);
        if (last) { bid = last.bankId; qid = last.qid; }
      }
      if (!bid) return null;
      var b = (typeof bankById === 'function') ? bankById(bid) : null;
      if (!b) return null;
      var q = (b.questions || []).find(function (x) { return String(x.id) === String(qid); }) || b.questions[0];
      if (!q) return null;
      if (b.paper && q._srcKey && typeof findQIn === 'function') {
        var f = findQIn((typeof baseBanks === 'function' ? baseBanks() : []), q._srcKey);
        if (f && f.bank && f.q) return { bank: f.bank, q: f.q, index: (f.bank.questions || []).indexOf(f.q) };
      }
      return { bank: b, q: q, index: (b.questions || []).indexOf(q) };
    } catch (e) { return null; }
  }
  function cmdTags(text) {
    var tail = '';
    var m = text.match(/(?:打标签|贴标签|标成|标记为|加上?标签|标签|考点)\s*[:：]?\s*(.+)$/);
    if (m) tail = m[1];
    else { m = text.match(/[：:]\s*(.+)$/); if (m) tail = m[1]; }
    tail = tail.replace(/[《「“"][^》」”"]*[》」”"]/g, ' ');
    tail = tail.replace(/第?\s*\d+\s*(?:[、,，和及\-–~至]\s*\d+\s*)*题/g, ' ');
    tail = tail.replace(/(这个|那个|题库|所有|全部|的|把|给|请|帮我|麻烦|一下|吧|。|！|!|？|\?)/g, ' ');
    var out = [];
    tail.split(/[、,，;；\s]+/).forEach(function (t) {
      t = String(t || '').replace(/^[「『"']|[」』"']$/g, '').trim();
      if (t && t.length <= 14 && out.indexOf(t) < 0 && !/^(标签|考点|知识点|题)$/.test(t)) out.push(t);
    });
    return out.slice(0, 6);
  }
  function cmdHelp() {
    return '我可以直接替你操作本机数据。写操作会先给你一张**预览卡**（列清影响多少题、什么风险），点「执行计划」才真的写入，做完可撤销：\n\n'
      + '• **题库**：删除题库《X》/ 批量删除《A》《B》/ 把《X》改名为《Y》/ 把《X》移动到「目录」\n'
      + '• **目录**：新建目录「X」/ 把目录「X」改名为「Y」/ 把目录「X」移动到「Y」\n'
      + '• **题目**：删除《X》第 3、5 题（支持 3-5 题）/ 删除这道题\n'
      + '• **收藏**：收藏《X》第 3 题 / 收藏《X》/ 取消收藏《X》/ 清空全部收藏\n'
      + '• **错题**：把《X》的错题标为已掌握 / 把《X》第 3 题标为错题 / 清空《X》的作答记录\n'
      + '• **考点标签**：给《X》打标签：心衰、利尿；给这道题打标签：糖酵解；让 AI 给这道题打标签；让 AI 给所有题打标签\n'
      + '• **考点词表**：导入考点词表：糖酵解、无氧氧化；让 AI 起一份考点词表\n'
      + '• **设置**：切换深色 / 浅色 / 跟随系统；字号大一点；主题色换成紫色；答对也显示解析；自动下一题开/关\n'
      + '• **导出文件**：导出知识库（可说「知识库里有关心衰的内容」）/ 导出题库《X》/ 导出错题 / 导出收藏 / 导出全部数据 —— 都会生成文件下载\n'
      + '• **出题后**：回复下面直接有「存入题库（N 题）」；想边存边做就点「存成新题库并开始做」\n'
      + '• **存题库**：把上面的题存成题库并收藏/打标签（从上一轮 AI 出的题里存）\n'
      + '• **撤销**：直接说「撤销」，或点上一条回复下面的「↶ 撤销」\n\n'
      + '多步可以连着说：\n「把这章错题打上糖酵解标签，然后导出错题」\n「把刚才的题存成题库、收藏，再打糖酵解标签」\n\n'
      + '不认识的说法会交给 AI 规划；AI 也只能从白名单动作里出计划，同样先预览再执行。';
  }
  function saveTextFile(name, text, mime) {
    try {
      if (typeof download === 'function') { download(name, text, mime || 'text/plain;charset=utf-8'); return true; }
    } catch (e) {}
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 3000);
      return true;
    } catch (e) { return false; }
  }
  function fileSafe(s) { return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || '导出'; }
  function cmdSysNote() {
    return '\n\n【站内操作提示】这个刷题站有一个本地动作层，能改题库、题目、标签、收藏、错题、目录和设置，并能导出文件。用户直接说目标就会执行；如果用户说「帮我分步：<目标>」，你可以只输出严格 JSON：{"steps":[{"action":"动作id","params":{}}]}，系统会先预览、等用户确认后才写入。可用动作 id 示例：bank.delete、bank.rename、bank.move、cat.create、cat.rename、cat.move、question.delete、question.favorite、question.markWrong、question.mastered、question.clearAnswers、tag.add、tag.aiOne、tag.vocabImport、settings.theme、settings.font、settings.color、export.bank、export.wrong、export.fav、export.kb、export.all、save.quiz。不要编造动作 id；普通知识问题不要输出计划 JSON；也不要说「我没有权限/无法写库」，告诉用户直接说目标即可。';
  }

  function isChatCommand(t) {
    t = String(t || '').trim();
    if (!t) return false;
    /* 问句豁免：问「风险 / 后果 / 影响 / 安全」的疑问句交给 AI 回答，不当成操作指令执行 */
    if (/(风险|后果|影响|安全|会丢|会删|误删|丢数据|能不能撤销|可不可以撤销|能不能回滚)/.test(t)
      && /([?？]|吗|呢|会不会|该不该|要不要|能不能|可以吗|什么|啥)/.test(t)) return false;
    /* 出题 + 存入题库：这是生成请求，不是操作指令；生成后由按钮保存 */
    if (/(出题|出几道|出几题|来几道|来几题|考我|考考我|(出|给|来|弄).{0,10}[0-9一二三四五六七八九十两几]{1,3}\s*(道|题))/.test(t)
      && /(存入?题库|存成题库|保存成题库|存题库)/.test(t)) return false;
    if (/(分析|总结|归纳|梳理|解释|为什么|怎么|如何|区别|鉴别)/.test(t)) return false;
    if (/清空.{0,6}(对话|聊天)/.test(t)) return false;
    if (/^(你能做什么|能做什么|你会什么|你会干啥|帮助|指令|命令|怎么用你)/.test(t)) return true;
    if (/^(撤销|撤回)$/.test(t)) return true;
    if (/^(帮我分步|分步执行|规划并执行|计划[:：])/.test(t)) return true;
    if (/(重命名|改名|移动|挪到|新建|创建).{0,12}(题库|分类|目录)/.test(t)) return true;
    if (/(打开|进入).{0,12}(题库|《)/.test(t)) return true;
    /* 通用：操作动词 + 题库/目录目标，避免「移动《X》到「Y」」被当成普通问题 */
    if (/(删除|删掉|删了|移除|清空|清除|打标签|贴标签|标成|标为|收藏|取消收藏|移动|挪到|改名|重命名|新建|创建|导出|下载|打开|进入|开始做|开始刷)/.test(t)
      && /(题库|题目|分类|目录|《|「)/.test(t)) return true;
    if (/(切换|切成|换成|改成|设为|设置|调成|开启|打开|关闭|关掉|用)\s*(深色|浅色|夜间|白天|跟随系统)/.test(t) || /^(深色|浅色|夜间|白天)模式/.test(t)) return true;
    if (/(字号|字大|字小)/.test(t) && /(大|小|标准|特大)/.test(t)) return true;
    if (/主题色|颜色/.test(t) && /(青|靛|紫|橙|蓝|换|改)/.test(t)) return true;
    if (/答对.*解析|自动下一题/.test(t)) return true;
    if (/(让\s*AI|AI\s*).{0,8}(打标签|标考点|分类)/.test(t)) return true;
    if (/(让\s*AI|AI|自动).{0,8}(这道题|这题|当前题|本题).{0,8}(打标签|标考点)/.test(t)) return true;
    if (/(导入|粘贴|加进|加入|补充).{0,8}(考点)?词表/.test(t) || /^考点词表\s*[:：]/.test(t)) return true;
    if (/(让\s*AI|AI).{0,8}(起|生成|做|编).{0,6}(考点)?词表/.test(t)) return true;
    if (/(导出|下载|保存成|保存为|存成|存为).{0,12}(知识库|资料|题库|全部数据|备份|错题|收藏)/.test(t)
      || /(知识库|资料).{0,10}(导出|下载|保存)/.test(t)) return true;
    if (/(存成|保存成|存为|保存为|存题库|保存题库|存成题库)/.test(t)) return true;
    if (/^(删除|删掉|删了|移除|批量删除|清空|清除|清理|打标签|贴标签|标成|标为|标记|收藏|取消收藏|把|给|将|请|帮我|麻烦)/.test(t)
      && /(删除|删掉|删了|移除|清空|清除|清理|打标签|打上|加上|贴标签|标成|标为|标记|收藏|取消收藏|已掌握|错题|作答)/.test(t)
      && /(题库|题|错题集|收藏|错题|标签|考点|作答|记录|知识库|资料|《|「|“|")/.test(t)) return true;
    return false;
  }
  function cmdReply(userNode, text, withUndo) {
    var ai = addNode({ role: 'ai', text: text, parent: userNode.id, acts: withUndo ? [{ id: 'undo', label: '↶ 撤销' }] : [] });
    TREE.active = ai.id;
    saveChat(); paintLog(); paintChatList();
    if ((location.hash === '' || location.hash === '#/') && window.CAT && CAT.render) {
      setTimeout(function () { try { CAT.render(); } catch (e) {} }, 320);
    }
  }
  async function runChatCommand(text, userNode) {
    if (/^(你能做什么|能做什么|你会什么|你会干啥|帮助|指令|命令|怎么用你)/.test(text)) { cmdReply(userNode, cmdHelp()); return; }
    if (/(权限|能不能|可以吗|能直接|你有没有)/.test(text) && /(操作|管理|删除|删掉|清空|清除|收藏|标签|导出|切换|改)/.test(text)) {
      cmdReply(userNode, '能。这是站内本地指令层，不走模型；直接发命令就会真的执行（写操作先确认，可撤销）。\n\n' + cmdHelp());
      return;
    }
    if (/^(撤销|撤回)$/.test(text)) { doUndo(); return; }

    /* 所有写操作都交给 AI_OPS：先预览（数量/风险），点执行才写入，事后可撤销 */
    var steps = null;
    try { steps = await autoPlan(text, userNode); } catch (e) { steps = null; }
    if (steps && steps.length) { await opsRun(steps, userNode, text); return; }
    cmdReply(userNode, '这条我没认出是操作指令。\n说「你能做什么」看支持的指令；普通问题会照常交给 AI 回答。');
  }


  /* ============================================================
     意图层：一句话 → 动作计划（只产出 JSON，不写数据）
     执行层统一在 ai-ops.js：preview → 用户确认 → execute → undo
     ============================================================ */
  function planTagsOf(text) {
    var m = String(text || '').match(/打上?\s*([^，,。；;]+?)\s*标签/);
    if (m) {
      return m[1].split(/[、,，\s]+/).map(function (t) { return t.replace(/[。.!！?？]/g, '').trim(); }).filter(Boolean).slice(0, 6);
    }
    return cmdTags(text);
  }
  function planTarget(text) {
    var t = String(text || '');
    var p = {};
    var current = /这章|这个题库|当前题库|本库|这题库|当前目录/.test(t);
    var currentQ = /这道题|这题|本题|当前题|刚才那题/.test(t);
    var books = t.match(/《([^》]{1,50})》/g) || [];
    if (books.length) {
      p.bankTitles = books.map(function (x) { return x.slice(1, -1).trim(); }).filter(Boolean);
    } else {
      var m = t.match(/[「“"]([^」”"]{1,50})[」”"]/);
      if (m) p.bankTitle = m[1];
      else if (!current && !currentQ) {
        var hits = cmdBanks(t);
        if (hits.length === 1) p.bankTitle = hits[0].title;
      }
    }
    if (current) p.current = true;
    if (currentQ) { p.current = true; p.currentQ = true; }
    var nums = cmdNums(t, 9999); if (nums.length) p.nums = nums;
    if (/错题/.test(t)) p.wrong = true;
    if (/所有|全部|每道|整库/.test(t)) p.all = true;
    return p;
  }

  function planStep(text) {
    var t = String(text || '').trim(); if (!t) return null;
    var p, tags, nums, mm;

    /* 导出知识库 / 资料（必须在「导出题库」之前判断） */
    if (/(导出|下载|保存成|保存为).{0,12}(知识库|资料)/.test(t) || /(知识库|资料).{0,40}(导出|下载|保存)/.test(t)) {
      var name = '', kw = '';
      var bm = t.match(/《([^》]{1,30})》/); if (bm) name = bm[1];
      var km = t.match(/(?:有关|关于)\s*["「“]?([^"」”\s，。；;的]{1,20})["」”]?/);
      if (km) kw = km[1].replace(/的?(内容|资料|部分|知识|知识点|题|题目)$/, '');
      if (!kw) { km = t.match(/["「“]([^"」”]{1,20})["」”]/); if (km) kw = km[1]; }
      return { action: 'export.kb', params: { name: name, keyword: kw } };
    }
    if (/(导出|下载|备份)/.test(t) && /全部数据|全部|备份/.test(t) && !/(收藏|错题|题库|知识库)/.test(t)) {
      return { action: 'export.all', params: {} };
    }

    /* 设置 */
    if (/(切换|切成|换成|改成|设为|设置|调成|开启|打开|关闭|关掉|用)/.test(t) && /深色|夜间|暗色/.test(t)) return { action: 'settings.theme', params: { theme: 'dark' } };
    if (/(切换|切成|换成|改成|设为|设置|调成)/.test(t) && /浅色|白天/.test(t)) return { action: 'settings.theme', params: { theme: 'light' } };
    if (/跟随系统/.test(t)) return { action: 'settings.theme', params: { theme: 'auto' } };
    if (/(字号|字大|字小)/.test(t) && /(大|小|标准|特大|超大)/.test(t)) {
      var fs = /特大|超大/.test(t) ? 'xl' : (/小/.test(t) ? 's' : (/标准|中等/.test(t) ? 'm' : 'l'));
      return { action: 'settings.font', params: { fs: fs } };
    }
    if (/(主题色|颜色)/.test(t) && /(青|靛|紫|橙|蓝|换|改)/.test(t)) {
      var col = /紫/.test(t) ? 'violet' : (/靛/.test(t) ? 'indigo' : (/橙/.test(t) ? 'warm' : (/青/.test(t) ? 'teal' : 'blue')));
      return { action: 'settings.color', params: { color: col } };
    }
    if (/自动下一题/.test(t)) return { action: 'settings.autoNext', params: { on: !/(不|关|别|取消|禁用)/.test(t) } };
    if (/答对.*解析|解析.*答对/.test(t)) return { action: 'settings.expOnOk', params: { on: !/(不|关|别|取消|禁用)/.test(t) } };

    /* 考点词表 */
    if (/(导入|粘贴|加进|加入|补充).{0,8}(考点)?词表/.test(t) || /^考点词表\s*[:：]/.test(t)) {
      var body = t.split(/(?:导入|粘贴|加进|加入|补充)(?:考点)?词表/)[1] || '';
      body = body.replace(/^[\s：:]+/, '').trim();
      if (!body) { var cm = t.match(/[：:]\s*([\s\S]+)$/); if (cm) body = cm[1]; }
      if (!body) {
        var pre = t.split(/(?:加进|加入|导入|粘贴|补充)(?:考点)?词表/)[0] || '';
        body = pre.replace(/^(请|帮我|麻烦|把|将|给|这些|以下|考点|词表)+/, '').trim();
      }
      return { action: 'tag.vocabImport', params: { text: body } };
    }
    if (/(让\s*AI|AI).{0,8}(起|生成|做|编).{0,6}(考点)?词表/.test(t)) return { action: 'tag.vocabGenerate', params: {} };

    /* AI 打标签 */
    if (/(让\s*AI|AI|自动).{0,8}(所有|全部|没标签).{0,8}(打标签|标考点|分类)/.test(t) || /(给所有题|全部题).{0,8}(打标签|标考点)/.test(t)) {
      return { action: 'tag.aiAll', params: {} };
    }
    if (/(让\s*AI|AI|自动).{0,8}(这道题|这题|当前题|本题).{0,8}(打标签|标考点)/.test(t)) {
      return { action: 'tag.aiOne', params: { currentQ: true } };
    }

    /* 导出错题 / 收藏 / 题库 */
    if (/(导出|下载)/.test(t) && /错题/.test(t)) {
      p = planTarget(t);
      if (!p.bankTitle && !p.bankTitles && !p.current) p.all = true;
      return { action: 'export.wrong', params: p };
    }
    if (/(导出|下载)/.test(t) && /收藏/.test(t)) {
      p = planTarget(t);
      if (!p.bankTitle && !p.bankTitles && !p.current) p.all = true;
      return { action: 'export.fav', params: p };
    }
    if (/(导出|下载)/.test(t) && /题库/.test(t)) {
      p = planTarget(t);
      if (!p.bankTitle && !p.bankTitles && !p.current) return null;
      return { action: 'export.bank', params: p };
    }

    /* 题库 / 目录的改名、移动、新建 */
    mm = t.match(/把?\s*《([^》]+)》\s*(?:移动|挪)到\s*[「《]([^」》]+)[」》]/) || t.match(/移动(?:题库)?\s*《([^》]+)》\s*到\s*[「《]([^」》]+)[」》]/);
    if (mm) return { action: 'bank.move', params: { bankTitle: mm[1], catTitle: mm[2] } };
    mm = t.match(/把?\s*《([^》]+)》\s*(?:改名为|重命名为|改成)\s*《([^》]+)》/) || t.match(/重命名(?:题库)?\s*《([^》]+)》\s*(?:为|成)\s*《([^》]+)》/);
    if (mm) return { action: 'bank.rename', params: { bankTitle: mm[1], title: mm[2] } };
    mm = t.match(/把\s*(?:分类|目录)\s*[「《]([^」》]+)[」》]\s*(?:移动|挪)到\s*[「《]([^」》]+)[」》]/);
    if (mm) return { action: 'cat.move', params: { catTitle: mm[1], parentTitle: mm[2] } };
    mm = t.match(/把\s*(?:分类|目录)\s*[「《]([^」》]+)[」》]\s*(?:改名为|重命名为|改成)\s*[「《]([^」》]+)[」》]/);
    if (mm) return { action: 'cat.rename', params: { catTitle: mm[1], title: mm[2] } };
    mm = t.match(/(?:新建|创建|建)\s*(?:一个)?\s*(?:分类|目录)\s*[「《]?([^」》\n]{1,30})[」》]?$/);
    if (mm) return { action: 'cat.create', params: { title: mm[1].trim() } };

    /* 手动打标签（只有标签本身是「错题 / 已掌握」时才让给错题动作） */
    tags = planTagsOf(t);
    var badTag = tags.length && tags.every(function (x) { return /错题|已?掌握/.test(x); });
    var masteredCmd = /标为(已)?掌握|标记为(已)?掌握|标为错题|标记为错题/.test(t);
    if (tags.length && !badTag && !masteredCmd && /打标签|打上|标成|标为|标签|考点/.test(t)) {
      p = planTarget(t); p.tags = tags;
      if (!p.bankTitle && !p.bankTitles && !p.current && !p.currentQ) p.current = true;
      if (!p.wrong && !p.currentQ && !p.nums) p.all = true;
      return { action: 'tag.add', params: p };
    }

    /* 删题 / 删题库 */
    nums = cmdNums(t, 9999);
    if (nums.length && /删除|删掉|删了|移除/.test(t)) {
      p = planTarget(t);
      if (!p.bankTitle && !p.bankTitles && !p.current) p.current = true;
      return { action: 'question.delete', params: p };
    }
    if (/(删除|删掉|删了|移除)/.test(t) && /题库/.test(t) && !/(错题|作答|收藏|标签)/.test(t)) {
      p = planTarget(t);
      return { action: 'bank.delete', params: p };
    }

    /* 收藏 */
    if (/(取消收藏|收藏)/.test(t) && !/导出|下载/.test(t)) {
      p = planTarget(t); p.on = !/(取消收藏|取消|清空|删除.{0,12}收藏|删掉.{0,12}收藏|移除.{0,12}收藏)/.test(t);
      var hasBank = !!(p.bankTitle || p.bankTitles || p.current);
      if (!hasBank && /全部|所有|清空|删除|删掉|移除/.test(t)) p.all = true;
      if (!hasBank && !p.all) return null;
      if (!p.nums && !p.currentQ && hasBank) p.all = true;
      return { action: 'question.favorite', params: p };
    }

    /* 错题 / 作答记录 */
    if (/已掌握|掌握|清除.*错题|清空.*错题|删.*错题|错题.*(清|删)/.test(t)) {
      p = planTarget(t); p.wrong = true;
      if (!p.bankTitle && !p.bankTitles && !p.current) {
        if (/我题库|题库里|全部|所有|整个/.test(t)) p.allBanks = true;
        else p.current = true;
      }
      return { action: 'question.mastered', params: p };
    }
    if (/标为错题|标记为错题|标成错题/.test(t)) {
      p = planTarget(t);
      if (!p.bankTitle && !p.bankTitles && !p.current) p.current = true;
      if (!p.nums && !p.currentQ) p.all = true;
      return { action: 'question.markWrong', params: p };
    }
    if (/清空.*作答|清除.*作答|清空.*记录/.test(t)) {
      p = planTarget(t);
      if (!p.bankTitle && !p.bankTitles && !p.current) {
        if (/我题库|题库里|全部|所有|整个/.test(t)) p.allBanks = true;
        else p.current = true;
      }
      if (!p.nums && !p.currentQ) p.all = true;
      return { action: 'question.clearAnswers', params: p };
    }

    /* 打开 / 开始 / 复习 / 统计 */
    if (/今日复习|开始复习/.test(t)) return { action: 'quiz.review', params: {} };
    if (/(开始做|开始刷|去做|刷题)/.test(t)) {
      p = planTarget(t);
      if (p.bankTitle || p.bankTitles || p.current) return { action: 'quiz.start', params: p };
    }
    if (/(打开|进入)/.test(t) && /题库|《/.test(t)) {
      p = planTarget(t);
      if (p.bankTitle || p.bankTitles || p.current) return { action: 'open.bank', params: p };
    }
    if (/更新统计|刷新统计|重新统计/.test(t)) return { action: 'stats.recalc', params: {} };
    return null;
  }

  function planSplit(text) {
    var parts = String(text || '').split(/然后|接着|最后|并且|；|;|，(?=再|并)|再(?=把|给|删|导|收|打|切|清)|并(?=把|给|删|导|收|打|切|清)/)
      .map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length < 2) return null;
    var steps = [];
    for (var i = 0; i < parts.length; i++) {
      var st = planStep(parts[i]);
      if (!st) return null;
      steps.push(st);
    }
    return steps;
  }
  function planSaveQuiz(text) {
    if (!/(存成|保存成|存为|保存为|存题库|保存题库|存成题库)/.test(text)) return null;
    var tags = planTagsOf(text);
    var steps = [{ action: 'save.quiz', params: { favorite: /收藏/.test(text) } }];
    if (tags.length) steps.push({ action: 'tag.add', params: { bank: '$new', all: true, tags: tags } });
    return steps;
  }
  /* 给模型看的 few-shot：三条覆盖「改名 / 多步（打标签 + 收藏）/ 只读导出」，
     比只给动作清单更能压住「自创参数名」「动作名写错」这两类失败。 */
  function opsFewShot() {
    return ['示例 1：把《内科》题库改名成《内科学》'
      + '\n{"steps":[{"action":"bank.rename","params":{"bankTitle":"内科","title":"内科学"}}]}',
    '示例 2：给当前这道题打上「心衰」「利尿剂」，然后收藏它'
      + '\n{"steps":[{"action":"tag.add","params":{"currentQ":true,"tags":["心衰","利尿剂"]}},{"action":"question.favorite","params":{"currentQ":true,"favorite":true}}]}',
    '示例 3：导出错题'
      + '\n{"steps":[{"action":"export.wrong","params":{}}]}'].join('\n\n');
  }
  /* 把模型输出解析成步骤；返回 {steps, bad}，bad 是模型写了但站里没有的动作名 */
  function parsePlanObj(txt) {
    var m = String(txt || '').match(/\{[\s\S]*\}/);
    if (!m) return { steps: null, bad: [] };
    var obj;
    try { obj = JSON.parse(m[0]); } catch (e) { return { steps: null, bad: [] }; }
    var steps = [], bad = [];
    (obj.steps || []).forEach(function (s) {
      if (!s) return;
      if (s.tool && window.SKILLS && SKILLS.toolToStep) {
        var st = SKILLS.toolToStep(s.tool, s.args || {});
        if (st && AI_OPS.getAction(st.action)) steps.push(st);
        else bad.push(String(s.tool));
        return;
      }
      if (s.action && AI_OPS.getAction(s.action)) steps.push({ action: s.action, params: s.params || {} });
      else if (s.action) bad.push(String(s.action));
    });
    return { steps: steps, bad: bad };
  }
  async function planByModel(text) {
    if (!window.AI_OPS || typeof aiChat !== 'function') return null;
    var sk = (window.SKILLS) ? SKILLS.active() : null;
    var toolCat = (window.SKILLS && SKILLS.toolCatalog) ? SKILLS.toolCatalog() : '';
    var skillTxt = sk ? ('\n\n【当前技能：' + sk.name + '】\n' + sk.system) : '';
    var head, tail;
    if (toolCat) {
      head = '你是刷题站的本地操作规划器。当前技能只允许使用下面这些工具，不要发明工具：\n' + toolCat
        + '\n\n输出严格 JSON：{"steps":[{"tool":"工具名","args":{}}]}，不要解释、不要代码块。'
        + '\nargs 用工具说明里的参数名；不需要参数就写 {}。'
        + skillTxt + '\n用户目标：';
      tail = '';
    } else {
      head = '你是刷题站的本地操作规划器。只能使用下面这些动作，不要发明新动作：\n' + AI_OPS.catalog()
        + '\n\n参数写法：{"bankTitle":"题库名"}、{"bankTitles":["A","B"]}、{"current":true}、{"currentQ":true}、'
        + '{"nums":[3,5]}、{"qids":["q1"]}、{"wrong":true}、{"all":true}、{"tags":["标签"]}、{"on":true}、'
        + '{"title":"新名字"}、{"catTitle":"目录名"}、{"parentTitle":"上级目录"}、{"theme":"dark|light|auto"}、'
        + '{"fs":"s|m|l|xl"}、{"color":"blue|teal|indigo|violet|warm"}、{"text":"词表内容"}、'
        + '{"name":"知识库名","keyword":"关键词"}、{"favorite":true}。'
        + '\n输出严格 JSON：{"steps":[{"action":"动作id","params":{}}]}，不要解释、不要代码块。'
        + skillTxt;
      tail = '\n\n' + opsFewShot();
    }
    async function ask(extra) {
      try {
        return await aiChat([
          { role: 'system', content: '你只输出站内动作计划 JSON。' },
          { role: 'user', content: head + text + tail + extra }
        ], function () { });
      } catch (e) { return ''; }
    }
    var parsed = parsePlanObj(await ask(''));
    /* 失败重试一次：没解析出来，或者写了站里没有的动作名 —— 把原因回给模型，别直接放弃 */
    if (!parsed.steps || parsed.steps.length === 0 || parsed.bad.length) {
      var why = parsed.bad.length
        ? '\n\n上一次用了站里没有的动作：' + parsed.bad.slice(0, 6).join('、') + '。只能从上面清单里选。'
        : '\n\n上一次输出不是合法 JSON（或没有 steps）。这次只输出 JSON 本体。';
      var second = parsePlanObj(await ask(why));
      if (second.steps && second.steps.length && !second.bad.length) parsed = second;
      else if (!parsed.steps || !parsed.steps.length) parsed = second;
    }
    var steps = parsed.steps || [];
    var allow = (window.SKILLS) ? SKILLS.allowedActions() : null;
    if (allow && allow.length) steps = steps.filter(function (s) { return allow.indexOf(s.action) >= 0; });
    return steps.length ? steps : null;
  }
  async function autoPlan(text, userNode) {
    var t = String(text || '').trim();
    /* 「帮我分步：…」是明确的模型规划请求：别让规则层抢先误解析 */
    var byModel = /^(帮我分步|分步执行|规划并执行|计划)[:：\s]/.test(t);
    var multi = /(然后|接着|最后|并且|；|;)/.test(t) || /再(?=把|给|删|导|收|打|切|清)/.test(t);
    var saveQuiz = /(存成|保存成|存为|保存为|存题库|保存题库|存成题库)/.test(t);
    var steps = null;
    if (!byModel && saveQuiz) steps = planSaveQuiz(t);
    if (!byModel && !steps && multi) steps = planSplit(t);
    if (!byModel && !steps) { var one = planStep(t); if (one) steps = [one]; }
    if (!steps) steps = await planByModel(t.replace(/^(帮我分步|分步执行|规划并执行|计划)[:：\s]*/, ''));
    if (!steps || !steps.length) return null;
    steps.forEach(function (s) {
      if (s.action === 'save.quiz' && !s.params.sourceNode) s.params.sourceNode = userNode.id;
    });
    return steps;
  }

  /* ---------- 预览卡 / 执行 / 撤销 ---------- */
  function opsRiskLabel(r) {
    return { R0: '只读', R1: '可撤销', R2: '批量 · 可撤销', R3: '破坏性 · 失败后需手动检查', R4: '外发' }[r] || r;
  }
  function opsPreviewText(pv, title) {
    var out = [];
    var riskTxt = pv.reversible === false ? (pv.risk === 'R3' ? '破坏性 · 不可撤销' : '不可撤销') : opsRiskLabel(pv.risk);
    out.push('**' + (title ? ('计划：' + clip(title, 40)) : '操作预览') + '**（' + pv.steps.length + ' 步 · ' + riskTxt + '）');
    pv.steps.forEach(function (s, i) {
      var imp = s.impact || {};
      out.push('');
      out.push((i + 1) + '. **' + s.title + '**' + (imp.summary ? ('：' + imp.summary) : ''));
      (s.warnings || []).forEach(function (w) { out.push('   - ⚠ ' + w); });
    });
    if (pv.reversible === false) out.push('', '⚠ 这个计划含**不可撤销**步骤，执行后不能整份撤销。');
    if (pv.risk === 'R3') out.push('', '⚠ 破坏性操作。执行中途失败时**不会自动回滚**已完成的破坏性步骤，需要你手动检查；成功执行后可用下面的「撤销」恢复执行前的数据（你手动改过的部分会保留）。');
    out.push('', '预览编号 `' + pv.hash + '`，5 分钟内有效。点下面的「执行计划」才会写入。');
    return out.join('\n');
  }
  function opsShowPreview(pv, userNode, title) {
    var n = addNode({
      role: 'ai', text: opsPreviewText(pv, title), parent: userNode.id,
      acts: [
        { id: 'ops-run', label: '执行计划', danger: pv.risk === 'R3' },
        { id: 'ops-cancel', label: '取消' }
      ],
      ops: { hash: pv.hash, steps: pv.plan.steps, risk: pv.risk, reversible: pv.reversible, title: title || '', executed: false }
    });
    TREE.active = n.id;
    saveChat(); paintLog(); paintChatList();
    return n;
  }
  async function opsRun(steps, userNode, title) {
    if (!window.AI_OPS) { cmdReply(userNode, '⚠ 操作执行核没加载（ai-ops.js）'); return; }
    var pv;
    try { pv = await AI_OPS.preview(steps); }
    catch (e) { cmdReply(userNode, '⚠ 预览失败：' + ((e && e.message) || e)); return; }
    if (!pv.ok) { cmdReply(userNode, '⚠ ' + (pv.error || '不能执行')); return; }
    if (pv.risk === 'R0') {
      var r = await AI_OPS.runNow(pv.plan.steps);
      if (!r.ok) { cmdReply(userNode, '⚠ ' + (r.error || '执行失败')); return; }
      cmdReply(userNode, '✅ ' + r.done.map(function (d) { return d.index + '. ' + d.text; }).join('\n'));
      return;
    }
    opsShowPreview(pv, userNode, title);
  }
  async function opsExecute(n) {
    if (!n || !n.ops || n.ops.busy || n.ops.executed) return;
    n.ops.busy = true; n.acts = []; paintLog();
    var r;
    try { r = await AI_OPS.execute({ steps: n.ops.steps }, n.ops.hash); }
    catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    n.ops.busy = false; n.ops.executed = true;
    n.ops.planId = r.planId || null;
    var lines = [];
    if (r.ok) {
      lines.push('✅ **已执行 ' + r.done.length + ' 步**');
      r.done.forEach(function (d) { lines.push(d.index + '. ' + d.text); });
      n.ops.reversible = r.reversible !== false;
      var hasBgTag = (n.ops.steps || []).some(function (s) { return s.action === 'tag.aiAll'; });
      if (hasBgTag) n.acts = [{ id: 'ops-stop-tag', label: '停止后台打标签' }];
      else n.acts = n.ops.reversible ? [{ id: 'ops-undo', label: '↶ 撤销这次操作' }] : [];
      if (!n.ops.reversible) lines.push('', '⚠ 含不可撤销步骤，不能整份撤销。');
    } else {
      lines.push('⚠ **执行失败**：' + (r.error || '未知错误'));
      if (r.done && r.done.length) {
        lines.push('', '已完成的步骤：');
        r.done.forEach(function (d) { lines.push(d.index + '. ' + d.text); });
      }
      if (r.compensated) lines.push('', '已自动回滚 ' + r.compensated + ' 步。');
      if (r.planId && r.done && r.done.length) n.acts = [{ id: 'ops-undo', label: '↶ 撤销已执行部分' }];
    }
    n.text = (n.text || '') + '\n\n---\n' + lines.join('\n');
    saveChat(); paintLog(); paintChatList();
  }
  async function opsUndo(n) {
    if (!n || !n.ops || !n.ops.planId || n.ops.undoing) return;
    n.ops.undoing = true; n.acts = []; paintLog();
    var r;
    try { r = AI_OPS.undoPlan(n.ops.planId); }
    catch (e) { r = { ok: false, error: (e && e.message) || String(e), conflicts: [], restored: 0 }; }
    n.ops.undoing = false;
    if (r.ok) {
      n.ops.undone = true;
      n.text = (n.text || '') + '\n\n↶ **已撤销**：恢复 ' + r.restored + ' 个存储项。';
      saveChat(); paintLog(); paintChatList();
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 450);
    } else {
      n.text = (n.text || '') + '\n\n⚠ **撤销没完成**：' + (r.error || ('有 ' + r.conflicts.length + ' 处数据在你操作后又被改过，已保留当前值。'));
      saveChat(); paintLog(); paintChatList();
    }
  }

  /* ---------- 未完成计划横幅：刷新/关页面把执行中计划打断后，别让它悄悄躺着 ---------- */
  var OPS_BANNER_HIDE = false;
  function opsInterruptedHtml() {
    if (OPS_BANNER_HIDE || !window.AI_OPS || !AI_OPS.interrupted) return '';
    var list = [];
    try { list = AI_OPS.interrupted() || []; } catch (e) { list = []; }
    if (!list.length) return '';
    var p = list[list.length - 1];
    var at = (p.done || 0) + 1;
    return '<div class="chat-ops-banner">'
      + '<div class="cob-t"><b>⚠ 上次有没跑完的操作计划</b>'
      + '<span class="small muted">（停在执行第 ' + at + ' 步，可能是刷新/关页面打断' + (p.error ? '：' + E(clip(p.error, 60)) : '') + '）</span></div>'
      + '<div class="cob-acts">'
      + '<button class="btn tiny" type="button" data-opsresume="' + E(p.id) + '">继续执行</button>'
      + '<button class="btn tiny" type="button" data-opsrollback="' + E(p.id) + '">回滚这次操作</button>'
      + '<button class="btn tiny" type="button" data-opsbarx="1">先不管</button>'
      + (list.length > 1 ? '<span class="small muted">还有 ' + (list.length - 1) + ' 个更早的未完成计划</span>' : '')
      + '</div></div>';
  }
  function bindOpsBanner(box) {
    if (!box) return;
    box.querySelectorAll('[data-opsresume]').forEach(function (b) { b.onclick = function () { opsResumePlan(b.dataset.opsresume); }; });
    box.querySelectorAll('[data-opsrollback]').forEach(function (b) { b.onclick = function () { opsRollbackPlan(b.dataset.opsrollback); }; });
    box.querySelectorAll('[data-opsbarx]').forEach(function (b) { b.onclick = function () { OPS_BANNER_HIDE = true; paintLog(); }; });
  }
  async function opsResumePlan(planId) {
    if (!planId || !window.AI_OPS) return;
    OPS_BANNER_HIDE = true;
    var r;
    try { r = await AI_OPS.resume(planId); }
    catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    var text;
    if (r.ok) {
      text = '✅ **已继续执行到完成**';
      if (r.done && r.done.length) text += '\n' + r.done.map(function (d) { return d.index + '. ' + d.text; }).join('\n');
    } else {
      text = '⚠ **没能继续**：' + (r.error || '未知错误');
      if (r.done && r.done.length) text += '\n\n已经完成的步骤：\n' + r.done.map(function (d) { return d.index + '. ' + d.text; }).join('\n');
    }
    addNode({ role: 'ai', text: text, parent: null });
    saveChat(); paintLog(); paintChatList();
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 700);
  }
  function opsRollbackPlan(planId) {
    if (!planId || !window.AI_OPS) return;
    OPS_BANNER_HIDE = true;
    var r;
    try { r = AI_OPS.rollback(planId); }
    catch (e) { r = { ok: false, error: (e && e.message) || String(e), conflicts: [], restored: 0 }; }
    var text = r.ok
      ? ('↶ **已回滚**：恢复 ' + (r.restored || 0) + ' 个存储项。')
      : ('⚠ **回滚没完成**：' + (r.error || ('有 ' + ((r.conflicts || []).length) + ' 处数据在你操作后又被改过，已保留当前值。')));
    addNode({ role: 'ai', text: text, parent: null });
    saveChat(); paintLog(); paintChatList();
    if (r.ok) setTimeout(function () { try { location.reload(); } catch (e) {} }, 700);
  }

  function doSend() {
    if (RUN) { T('上一轮还在生成，等它写完或点「停止」', 2000); return; }
    var ta = $id('chatTa');
    var text = ta ? ta.value.trim() : '';
    if (!text && !PEND.length) { if (ta) ta.focus(); return; }
    if (ta) ta.value = '';
    DRAFT = '';
    var atts = PEND.slice();
    PEND = [];
    paintPend();
    LOG_STICK = true;   /* 主动发消息才回到底部；生成途中用户往上翻就不再拽回去 */
    var cc = ensureChat();   /* 删光后第一次发问：这里才真正建会话 */
    var isCmd = isChatCommand(text);
    var user = addNode({
      role: 'user', qtext: text,
      text: text + (atts.length ? ((text ? '\n' : '') + '📎 ' + atts.map(attLabel).join('；')) : ''),
      atts: storeAtts(atts),
      tag: isCmd ? '操作' : (TAG[guessMode(text, atts)] || ''),
      parent: TREE.active
    });
    /* 第一句话给对话起个名字（会话列表里用） */
    if (!cc.title || cc.title === '新对话') cc.title = clip(text || (atts.length ? '附件分析' : '对话'), 22);
    saveChat();
    paintChatList();
    if (isCmd) {
      runChatCommand(text, user).catch(function (e) { cmdReply(user, '⚠ 操作没完成：' + ((e && e.message) || e)); });
      return;
    }
    answerFor(user);
  }
  function saveEdit(nid) {
    var n = node(nid);
    if (!n || n.role !== 'user') return;
    var ta = $id('chEditTa');
    var text = ta ? ta.value.trim() : '';
    if (!text) { T('内容不能为空', 1800, 'bad'); return; }
    EDIT = null;
    var atts = (n.atts || []).map(function (a) { return a; });
    var user = addNode({
      role: 'user', qtext: text,
      text: text + (atts.length ? ((text ? '\n' : '') + '📎 ' + atts.map(attLabel).join('；')) : ''),
      atts: atts,
      tag: n.tag || TAG[guessMode(text, atts)] || '',
      parent: n.parent || null
    });
    answerFor(user);
  }
  /* 给某条用户消息生成回复（重试 = 给同一条用户消息再加一个 AI 子节点） */
  function answerFor(userNode) {
    if (RUN) { T('上一轮还在生成，等它写完或点「停止」', 2000); return; }
    var ai = addNode({ role: 'ai', text: '', parent: userNode.id, streaming: true });
    TREE.active = ai.id;
    saveChat();
    paintLog();
    var atts = materializeAtts(userNode.atts || []);
    MEM.__lastFileBanks = atts.filter(function (a) { return a.kind === 'file-bank'; }).map(function (a) { return { title: a.title, questions: a.questions }; });
    RUN = { ctl: ('AbortController' in window) ? new AbortController() : null, node: ai, t0: Date.now(), firstTok: 0, timer: null };
    var stopBtn = $id('chatStop'); if (stopBtn) stopBtn.style.display = '';
    var sendBtn = $id('chatSend'); if (sendBtn) sendBtn.disabled = true;
    RUN.timer = setInterval(function () { tickStatus(ai); }, 400);
    function finish(err) {
      if (RUN && RUN.timer) { clearInterval(RUN.timer); RUN.timer = null; }
      ai.streaming = false;
      ai.thinkSec = Math.max(1, Math.round((Date.now() - RUN.t0) / 1000));
      if (err) ai.text = (ai.text ? ai.text + '\n\n' : '') + '⚠ ' + err;
      if (!ai.text && !ai.reason) ai.text = '（没有内容：模型没返回东西）';
      if (!ai.text && ai.reason) ai.text = '（模型只给了思考过程，没有正文）';
      RUN = null;
      maybeAttachQuizSave(ai);
      saveChat();
      if ($id('chatStop')) $id('chatStop').style.display = 'none';
      if ($id('chatSend')) $id('chatSend').disabled = false;
      paintLog();
    }
    var mode = guessMode(userNode.qtext || '', atts);
    var useAgent = (mode === 'qa' && window.SKILLS && SKILLS.hasTools && SKILLS.hasTools());
    var p = (mode === 'quiz') ? runQuiz(userNode.qtext || '', atts, ai)
      : (mode === 'analyze') ? runAnalyze(userNode.qtext || '', atts, ai)
        : (useAgent ? runAgentChat(userNode.qtext || '', atts, ai) : runQA(userNode.qtext || '', atts, ai));
    p.then(function () { finish(null); }, function (e) {
      var aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      if (aborted) { finish('（已停止）'); return; }
      var info = (typeof aiErrInfo === 'function') ? aiErrInfo(e) : { msg: (e && e.message) || '出错', hint: '' };
      finish(info.msg + (info.hint ? ('\n' + info.hint) : ''));
    });
  }
  function materializeAtts(stored) {
    var out = [];
    (stored || []).forEach(function (a) {
      if (!a || !a.kind) return;
      if (a.kind === 'bank' || a.kind === 'cat' || a.kind === 'file-bank' || a.kind === 'file-text' || a.kind === 'image') out.push(a);
    });
    return out;
  }
  /* 思考中计时：每 0.4 秒把「正在思考 X 秒…」刷到对应气泡里 */
  function tickStatus(n) {
    if (!n || !n.streaming) return;
    var el = document.querySelector('[data-status="' + n.id + '"] .ch-stx');
    if (!el) return;
    var sec = Math.max(0, Math.round((Date.now() - (RUN ? RUN.t0 : n.ts)) / 1000));
    var base = n.phase === 'retrieval' ? '正在检索知识库' : (n.phase === 'tool' ? '正在调用工具' : (n.phase === 'thinking' ? '深度思考中' : '正在思考'));
    /* 分级看门狗：10 秒还没首个字 / 15 秒以上 / 45 秒以上，各给一句人话，别让用户干等 */
    var extra = '';
    if (sec >= 45) extra = '（等了 ' + sec + ' 秒还没回：可点「停止」，再用消息上的 ↻ 重试）';
    else if (sec >= 15) extra = '（网络或模型可能卡住了，可点「停止」后重试）';
    else if (sec >= 10) extra = '（模型还没开始输出，再等一下）';
    el.textContent = base + ' ' + sec + ' 秒…' + extra;
  }
  function phase(n, p) {
    n.phase = p;
    if (n.streaming) tickStatus(n);
  }
  window.__chatTick = tickStatus;

  function streamInto(n, msgs, opts) {
    return new Promise(function (resolve, reject) {
      var onDelta = function (full, reas) {
        if (!RUN || !RUN.firstTok) RUN && (RUN.firstTok = Date.now());
        if (reas) n.reason = clip(reas, 6000);
        n.text = String(full || '');
        /* 正文还没出来、只在吐思考：算「深度思考中」 */
        phase(n, n.text ? 'stream' : (reas ? 'thinking' : 'stream'));
        var box = document.querySelector('.chat-msg[data-nid="' + n.id + '"]');
        if (box) {
          var t = box.querySelector('.chat-text');
          if (t) t.textContent = n.text;
          var r = box.querySelector('[data-reason="' + n.id + '"]');
          if (r) r.textContent = n.reason || '';
          else if (n.reason) {
            var rb = box.querySelector('.chat-reason-live');
            if (!rb) {
              rb = document.createElement('div');
              rb.className = 'chat-reason-live small muted';
              rb.setAttribute('data-reason', n.id);
              var st = box.querySelector('.chat-status');
              if (st) st.parentNode.insertBefore(rb, st.nextSibling);
              else box.querySelector('.chat-bubble').appendChild(rb);
            }
            rb.textContent = n.reason;
          }
          if (n.text) {
            var st2 = box.querySelector('.chat-status');
            if (st2) st2.style.display = 'none';
          }
        }
        var logEl = $id('chatLog');
        if (logEl && LOG_STICK) logEl.scrollTop = logEl.scrollHeight;
      };
      Promise.resolve(aiChat(msgs, onDelta, RUN && RUN.ctl ? RUN.ctl.signal : undefined, opts || {})).then(function (full) {
        n.text = String(full || n.text || '');
        resolve(n.text);
      }, reject);
    });
  }

  /* 粗估 token：中文按 1 字≈1 token，其余按 4 字符≈1 token（AQBot 同思路，不引第三方分词器） */
  function estTok(s) {
    var t = String(s || ''), cjk = (t.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    return Math.ceil(cjk + (t.length - cjk) / 4);
  }
  /* 历史消息：按 token 预算裁剪，且「一问一答」整组保留/整组丢弃（不会留下没有问题的回答） */
  function histMsgs(userNode, n) {
    var BUDGET = 5000;   /* 历史总预算（token），超了就从最早的一轮整组丢 */
    var groups = [];
    pathBefore(userNode).forEach(function (m) {
      if (!m || !m.text) return;
      if (m.role === 'user') {
        groups.push([{ role: 'user', content: clip(m.qtext || m.text, 1500) }]);
      } else if (m.role === 'ai' && m.text) {
        var msg = { role: 'assistant', content: clip(m.text, 1800) };
        if (groups.length && groups[groups.length - 1].length < 2) groups[groups.length - 1].push(msg);
        else groups.push([msg]);
      }
    });
    var max = n || 6, keep = [], used = 0;
    for (var i = groups.length - 1; i >= 0 && keep.length < max; i--) {
      var g = groups[i], cost = 0;
      for (var j = 0; j < g.length; j++) cost += estTok(g[j].content);
      if (keep.length && used + cost > BUDGET) break;   /* 至少留最新一轮 */
      keep.unshift(g); used += cost;
    }
    var out = [];
    keep.forEach(function (g) { g.forEach(function (m) { out.push(m); }); });
    return out;
  }
  function ensureAI() {
    var cfg = (typeof aiCfg === 'function') ? aiCfg() : null;
    if (!cfg || !cfg.model || !cfg.base) return '还没配 AI：去 <a href="#/kb">AI 与知识库</a> 选一个服务、填上模型和 Key（本地 Ollama 也行）。';
    if (typeof aiChat !== 'function') return 'AI 模块没加载。';
    return '';
  }

  /* ---------- agent loop：只读工具自动执行，结果回填给模型 ---------- */
  /* 工具轨迹四态（AQBot / Zed 风格）：✅ 成功 · ⚠ 失败 · ⏳ 未执行 · ♻ 复用上次结果，并带耗时 */
  function agentTraceText(trace) {
    var ICON = { ok: '✅', err: '⚠', warn: '⏳', cache: '♻' };
    return (trace || []).map(function (t, i) {
      var ic = ICON[t.state] || '🛠';
      var took = (t.ms != null) ? (' · ' + t.ms + 'ms') : '';
      return ic + ' ' + (i + 1) + '. ' + t.name + took + ' → ' + clip(t.result || '', 500);
    }).join('\n');
  }
  function agentParse(out) {
    var raw = String(out || '');
    var s = raw.trim().replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/```\s*$/, '').trim();
    if (!/^\{[\s\S]*\}$/.test(s)) return { text: raw };
    try {
      var j = JSON.parse(s);
      if (j && j.tool && typeof j.tool === 'string') return { tool: j.tool, args: j.args || {} };
      if (j && j.tool_calls && j.tool_calls[0]) {
        var c = j.tool_calls[0], fn = c.function || c;
        var args = fn.arguments != null ? fn.arguments : (c.arguments != null ? c.arguments : {});
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
        return { tool: fn.name || c.name, args: args || {} };
      }
    } catch (e) {}
    return { text: raw };
  }
  async function runAgentChat(text, atts, n) {
    var bad = ensureAI(); if (bad) { n.text = bad; return; }
    var tools = (window.SKILLS && SKILLS.tools) ? SKILLS.tools() : [];
    if (!tools.length) return runQA(text, atts, n);
    phase(n, 'retrieval'); n.text = ''; paintLog();
    var kb = await kbBlocks(text, (typeof aiCfg === 'function' ? (aiCfg().topK || 4) : 4));
    n.refs = hitRefs(kb.hits);
    var toolCat = SKILLS.toolCatalog();
    var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是我的私人刷题助教。')
      + '\n\n【本次任务】回答我的问题。你可以使用下面这些工具；需要数据时先调用工具，拿到结果再回答。'
      + '\n\n【可用工具】\n' + toolCat
      + '\n\n【工具调用格式】需要工具时，只输出一个 JSON 对象：{"tool":"工具名","args":{}}；'
      + '不要输出解释或代码块。不需要工具时直接用中文回答。一次只调用一个工具。'
      + (window.SKILLS ? SKILLS.sysNote() : '');
    var msgs = [{ role: 'system', content: sys }];
    histMsgs(userOf(n), 6).forEach(function (m) { msgs.push(m); });
    var parts = [];
    if (kb.text) parts.push('【参考资料】\n' + kb.text);
    var extra = [];
    atts.forEach(function (a) { if (a.kind === 'file-text') extra.push('【附件 ' + a.name + '】\n' + clip(a.text, 12000)); });
    if (extra.length) parts.push(extra.join('\n\n'));
    var brief = attsBrief(atts);
    if (brief) parts.push(brief);
    parts.push('【我的问题】' + (text || '（见附件）'));
    msgs.push({ role: 'user', content: parts.join('\n\n') });
    var trace = [], cache = {}, MAX = 4, lastKey = '';
    for (var step = 0; step < MAX; step++) {
      if (RUN && RUN.ctl && RUN.ctl.signal && RUN.ctl.signal.aborted) {
        var ae = new Error('aborted'); ae.name = 'AbortError'; throw ae;
      }
      phase(n, step === 0 ? 'waiting' : 'tool');
      var out = await aiChat(msgs, function () {}, RUN && RUN.ctl ? RUN.ctl.signal : undefined, { stream: false });
      var parsed = agentParse(out);
      if (!parsed.tool) {
        var answer = String(parsed.text || '').trim() || '（模型没有返回正文）';
        n.trace = trace.slice();
        n.text = (trace.length ? agentTraceText(trace) + '\n\n' : '') + answer;
        return;
      }
      var tool = null;
      for (var i = 0; i < tools.length; i++) if (tools[i].name === parsed.tool) { tool = tools[i]; break; }
      if (!tool) {
        trace.push({ name: parsed.tool, result: '工具不存在或不在当前技能里', state: 'warn' });
        msgs.push({ role: 'assistant', content: JSON.stringify({ tool: parsed.tool, args: parsed.args || {} }) });
        msgs.push({ role: 'user', content: '【工具结果】\n工具不存在或不在当前技能里。请改用可用工具，或直接回答。' });
        n.trace = trace.slice();
        n.text = agentTraceText(trace) + '\n\n（正在根据工具结果继续…）';
        paintLog();
        continue;
      }
      var callArgs = parsed.args || {};
      var key = tool.name + ':' + JSON.stringify(callArgs);
      /* 重复动作检测：连续两次完全相同的调用说明模型在原地打转，直接收尾 */
      if (key === lastKey && trace.length) {
        trace.push({ name: tool.name, result: '连续两次调用同一工具、同一参数，已停止（避免空转）', state: 'warn' });
        n.trace = trace.slice();
        n.text = agentTraceText(trace) + '\n\n（模型在重复同一个调用，先按已有结果回答）';
        return;
      }
      lastKey = key;
      if (cache[key]) {
        trace.push({ name: tool.name, result: cache[key], state: 'cache' });
        msgs.push({ role: 'assistant', content: JSON.stringify({ tool: tool.name, args: callArgs }) });
        msgs.push({ role: 'user', content: '【工具结果：' + tool.name + '】\n' + clip(cache[key], 4000) + '\n请继续。' });
        n.trace = trace.slice();
        n.text = agentTraceText(trace) + '\n\n（正在根据工具结果继续…）';
        paintLog();
        continue;
      }
      var stepObj = (SKILLS && SKILLS.toolToStep) ? SKILLS.toolToStep(tool.name, callArgs) : null;
      var def = stepObj && AI_OPS.getAction(stepObj.action);
      if (!stepObj || !def) {
        trace.push({ name: tool.name, result: '工具映射失败', state: 'warn' });
        msgs.push({ role: 'assistant', content: JSON.stringify({ tool: tool.name, args: callArgs }) });
        msgs.push({ role: 'user', content: '【工具结果】\n工具映射失败，请直接回答。' });
        n.trace = trace.slice();
        n.text = agentTraceText(trace);
        continue;
      }
      /* 参数不全先反问，不要拿半截参数去预览/执行（AQBot: missing params → ask） */
      var chkP = (AI_OPS && AI_OPS.checkParams) ? AI_OPS.checkParams(def.id, callArgs) : { ok: true };
      if (!chkP.ok) {
        trace.push({ name: tool.name, result: '参数不全：缺 ' + chkP.missing.join('、'), state: 'warn' });
        n.trace = trace.slice();
        n.text = agentTraceText(trace) + '\n\n要执行「' + def.title + '」还差：' + chkP.missing.join('、')
          + '\n把这几项告诉我就能继续。格式示例：' + (chkP.example || chkP.hint || '');
        paintLog();
        return;
      }
      if (def.risk !== 'R0' || /^(open\.|quiz\.)/.test(def.id)) {
        if (def.risk === 'R0') {
          var navMsg = '这个工具会切换页面，不能在 agent loop 里自动执行。';
          trace.push({ name: tool.name, result: navMsg, state: 'warn' });
          msgs.push({ role: 'assistant', content: JSON.stringify({ tool: tool.name, args: callArgs }) });
          msgs.push({ role: 'user', content: '【工具结果】\n' + navMsg + '\n请直接回答，或让用户手动执行。' });
          n.trace = trace.slice();
          n.text = agentTraceText(trace) + '\n\n（正在根据工具结果继续…）';
          paintLog();
          continue;
        }
        var pv;
        try { pv = await AI_OPS.preview([stepObj]); }
        catch (e) { pv = { ok: false, error: (e && e.message) || String(e) }; }
        if (!pv.ok) {
          trace.push({ name: tool.name, result: '预览失败：' + (pv.error || ''), state: 'err' });
          n.trace = trace.slice();
          n.text = agentTraceText(trace);
          return;
        }
        n.trace = trace.slice();
        n.text = (trace.length ? agentTraceText(trace) + '\n\n' : '')
          + '🛠 已请求写操作「' + tool.name + '」，请在下方预览卡确认。';
        opsShowPreview(pv, n, '技能工具：' + tool.name);
        return;
      }
      var result, t0 = Date.now(), okRun = true;
      n.trace = trace.slice();
      n.text = agentTraceText(trace) + (trace.length ? '\n\n' : '') + '⏳ ' + (trace.length + 1) + '/' + MAX + '. ' + tool.name + ' 正在执行…';
      paintLog();
      try {
        var r = await AI_OPS.runNow([stepObj]);
        okRun = !!r.ok;
        result = r.ok ? (r.done || []).map(function (d) { return d.text; }).join('\n') : ('工具失败：' + (r.error || ''));
      } catch (e2) { okRun = false; result = '工具失败：' + ((e2 && e2.message) || e2); }
      cache[key] = result;
      trace.push({ name: tool.name, result: result, state: okRun ? 'ok' : 'err', ms: Date.now() - t0 });
      n.trace = trace.slice();
      n.text = agentTraceText(trace) + '\n\n（正在根据工具结果继续…）';
      paintLog();
      msgs.push({ role: 'assistant', content: JSON.stringify({ tool: tool.name, args: callArgs }) });
      msgs.push({ role: 'user', content: '【工具结果：' + tool.name + '】\n' + clip(result, 4000) + '\n请基于结果继续回答；还需要工具就继续输出工具调用 JSON，否则直接回答。' });
    }
    n.trace = trace.slice();
    n.text = agentTraceText(trace) + '\n\n（工具调用达到上限，先把已有结果给你）';
  }

  function runQA(text, atts, n) {
    var bad = ensureAI(); if (bad) { n.text = bad; return Promise.resolve(); }
    phase(n, 'retrieval');
    n.text = '';
    paintLog();
    return kbBlocks(text, (typeof aiCfg === 'function' ? (aiCfg().topK || 4) : 4)).then(function (kb) {
      n.refs = hitRefs(kb.hits);
      phase(n, 'waiting');
      var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是我的私人刷题助教。')
        + '\n\n【本次任务】回答我的问题（知识点 / 机制 / 对比 / 记忆法都行）。如果给了【参考资料】：优先用资料里的说法，并在句末标 [1] [2] 这样的编号；资料没覆盖的用自己的知识补充，但要注明「（模型补充）」。回答完给 2–4 条「记住这个」的要点。' + cmdSysNote() + (window.SKILLS ? SKILLS.sysNote() : '');
      var msgs = [{ role: 'system', content: sys }];
      histMsgs(userOf(n), 6).forEach(function (m) { msgs.push(m); });
      var parts = [];
      if (kb.text) parts.push('【参考资料】\n' + kb.text);
      var extra = [];
      atts.forEach(function (a) { if (a.kind === 'file-text') extra.push('【附件 ' + a.name + '】\n' + clip(a.text, 12000)); });
      if (extra.length) parts.push(extra.join('\n\n'));
      var brief = attsBrief(atts);
      if (brief) parts.push(brief);
      parts.push('【我的问题】' + (text || '（见附件）'));
      var imgs = atts.filter(function (a) { return a.kind === 'image' && a.dataUrl; }).slice(0, 3);
      if (imgs.length) {
        msgs.push({ role: 'user', content: [{ type: 'text', text: parts.join('\n\n') }].concat(imgs.map(function (a) { return { type: 'image_url', image_url: { url: a.dataUrl } }; })) });
      } else {
        msgs.push({ role: 'user', content: parts.join('\n\n') });
      }
      paintLog();
      return streamInto(n, msgs, {});
    });
  }
  function looksLikeQuizText(t) {
    t = String(t || '');
    return /(^|\n)\s*(?:\d+[.、．)）]|[A-H][.、．)）])/.test(t)
      && /(答案|正确答案)\s*[:：]/.test(t)
      && /(^|\n)\s*[A-H][.、．)）]/.test(t);
  }
  /* 任何一条 AI 回复只要能被解析成题库，就在下面挂「存入题库」按钮 */
  function maybeAttachQuizSave(n) {
    if (!n || n.role !== 'ai' || !n.text) return;
    var acts = n.acts || [];
    for (var i = 0; i < acts.length; i++) {
      if (acts[i] && (acts[i].id === 'quiz-save' || acts[i].id === 'quiz-save-start')) return;
    }
    var parsed = parseBankText(String(n.text), n.quizTitle || 'AI 出题');
    if (!parsed || !parsed.questions || !parsed.questions.length) {
      if (looksLikeQuizText(n.text)) n.acts = acts.concat([{ id: 'quiz-import', label: '去导入页检查并存入' }]);
      return;
    }
    var nQ = parsed.questions.length;
    n.acts = acts.concat([
      { id: 'quiz-save', label: '存入题库（' + nQ + ' 题）' },
      { id: 'quiz-save-start', label: '存成新题库并开始做（' + nQ + ' 题）' }
    ]);
  }
  /* 点击「存入题库」：走 AI_OPS save.quiz，写入有 WAL，消息下面可撤销 */
  async function saveQuizFromNode(n, start) {
    if (!n || n.quizSaving) return;
    if (!window.AI_OPS) { T('操作执行核没加载', 2400, 'bad'); return; }
    n.quizSaving = true;
    var pv;
    try { pv = await AI_OPS.preview([{ action: 'save.quiz', params: { sourceNode: n.id, favorite: false } }]); }
    catch (e) { n.quizSaving = false; T('解析失败：' + ((e && e.message) || e), 2600, 'bad'); return; }
    if (!pv.ok) { n.quizSaving = false; T('没解析成题库：' + (pv.error || ''), 2800, 'bad'); return; }
    var r;
    try { r = await AI_OPS.execute({ steps: pv.plan.steps }, pv.hash); }
    catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    n.quizSaving = false;
    if (!r.ok) { T('存入失败：' + (r.error || ''), 2800, 'bad'); return; }
    var done = r.done && r.done[0];
    var bid = done && done.result && done.result.bankId;
    n.text = (n.text || '') + '\n\n---\n✅ ' + (done && done.text ? done.text : '已存入题库');
    n.ops = { planId: r.planId, reversible: true, undone: false };
    n.acts = [{ id: 'ops-undo', label: '↶ 撤销存入' }];
    saveChat(); paintLog();
    T('已存入题库', 1800, 'ok');
    if (start && bid && typeof startBank === 'function') {
      setTimeout(function () { try { startBank(bid); } catch (e) {} }, 250);
    }
  }

  function runQuiz(text, atts, n) {
    var bad = ensureAI(); if (bad) { n.text = bad; return Promise.resolve(); }
    phase(n, 'retrieval');
    n.text = '';
    paintLog();
    var cfg = (typeof aiCfg === 'function') ? aiCfg() : {};
    return kbBlocks(text, Math.min(6, (+cfg.topK || 4) + 1)).then(function (kb) {
      n.refs = hitRefs(kb.hits);
      phase(n, 'waiting');
      var num = 6;
      var mm = String(text).match(/([0-9一二三四五六七八九十两几]{1,3})\s*(?:道|题)/);
      if (mm) {
        var x = mm[1];
        var zh = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
        num = /^\d+$/.test(x) ? +x : (zh[x] || 5);
      }
      num = Math.max(2, Math.min(15, num));
      var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是一位命题老师。')
        + '\n\n【本次任务】你是命题老师，根据我给的知识点 / 要求出 ' + num + ' 道单选题或多选题。'
        + '\n要求：1) 题目要贴合考试（题干情景化、四个选项都要有干扰性）；2) 每题给正确答案和简短解析（解析里点出考点）；'
        + '\n3) 严格按站内的纯文本题库格式输出，不要写表格、不要代码块、不要额外解释：'
        + '\n# 题库名（自己起一个）\n\n1. 题干…\nA. …\nB. …\nC. …\nD. …\n答案：X\n解析：…'
        + '\n4) 多选答案连写（如 ABD）；题与题之间空一行。'
        + '\n5) 不要用 ** 加粗、不要写表格 / 代码块 / 额外交代；答案必须单独一行写「答案：X」。生成后站点会自动出现「存入题库」按钮，不需要你在回答里做保存操作。' + (window.SKILLS ? SKILLS.sysNote() : '');
      var msgs = [{ role: 'system', content: sys }];
      histMsgs(userOf(n), 2).forEach(function (m) { msgs.push(m); });
      var body = [];
      if (kb.text) body.push('【参考资料】\n' + kb.text);
      atts.forEach(function (a) {
        if (a.kind === 'file-text') body.push('【附件 ' + a.name + '】\n' + clip(a.text, 8000));
        if (a.kind === 'file-bank') body.push('【附件题库 ' + a.title + '】参考它的出题风格，共 ' + a.questions.length + ' 题。');
      });
      body.push('【知识点 / 要求】' + (text || '出一道覆盖上述资料的题'));
      body.push('【题数】' + num);
      msgs.push({ role: 'user', content: body.join('\n\n') });
      paintLog();
      return streamInto(n, msgs, {});
    }).then(function () {
      var raw = String(n.text || '').replace(/```[a-zA-Z]*\s*\n/g, '').replace(/```/g, '');
      var parsed = parseBankText(raw, 'AI 出题');
      if (parsed && parsed.questions.length) {
        n.quizTitle = parsed.title;
        n.acts = [
          { id: 'quiz-save', label: '存入题库（' + parsed.questions.length + ' 题）' },
          { id: 'quiz-save-start', label: '存成新题库并开始做（' + parsed.questions.length + ' 题）' }
        ];
        n.text = raw;
        T('出好了 ' + parsed.questions.length + ' 道题', 1800);
      } else {
        n.text = raw + '\n\n（这版没解析成题目：点「复制」自己改，或把要求写细一点再试。）';
      }
      paintLog();
    });
  }
  function runAnalyze(text, atts, n) {
    var sets = collectSets(atts);
    if (!sets.length) {
      var all = (typeof baseBanks === 'function') ? baseBanks() : [];
      sets = all.map(function (b) { return { title: b.title, bankId: b.id, questions: b.questions || [] }; });
      if (!sets.length) { n.text = '还没有题库可以分析：先导入题库，或者把题库拖进对话。'; return Promise.resolve(); }
    }
    var data = statsText(sets, text);
    var imgs = atts.filter(function (a) { return a.kind === 'image' && a.dataUrl; }).slice(0, 2);
    var bad = ensureAI();
    if (bad) { n.text = bad + '\n\n下面是本机算好的统计（可以先看）：\n' + data; return Promise.resolve(); }
    phase(n, 'waiting');
    var sys = ((typeof aiSysText === 'function') ? aiSysText() : '你是我的刷题助教。')
      + '\n\n【本次任务】根据我给的题库数据（含作答记录）和我的要求，帮我：'
      + '\n1) 总结我最容易错的知识点 / 题型（引用题号或题干片段佐证）；'
      + '\n2) 逐个说清这些点为什么容易错、正确思路是什么（能对比就给对比表）；'
      + '\n3) 给一份可执行的复习清单（先补什么、再练什么，控制在 5 条内）。'
      + '\n不要编造数据里没有的记录；数据不足就直说。' + cmdSysNote() + (window.SKILLS ? SKILLS.sysNote() : '');
    var msgs = [{ role: 'system', content: sys }];
    histMsgs(userOf(n), 4).forEach(function (m) { msgs.push(m); });
    if (imgs.length) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: data }].concat(imgs.map(function (a) { return { type: 'image_url', image_url: { url: a.dataUrl } }; })) });
    } else {
      msgs.push({ role: 'user', content: data });
    }
    n.text = '';
    paintLog();
    return streamInto(n, msgs, {}).then(function () {
      var files = atts.filter(function (a) { return a.kind === 'file-bank'; });
      if (files.length) n.acts = (n.acts || []).concat([{ id: 'import-files', label: '把这 ' + files.length + ' 个题库导入到我的题库' }]);
      paintLog();
    });
  }
  function userOf(aiNode) { return aiNode && aiNode.parent ? node(aiNode.parent) : null; }

  /* ---------- 消息上的按钮 ---------- */
  function doAct(act, nid) {
    var n = node(nid);
    if (!n) return;
    if (act === 'undo') { doUndo(); return; }
    if (act === 'ops-run') { opsExecute(n); return; }
    if (act === 'ops-undo') { opsUndo(n); return; }
    if (act === 'ops-cancel') {
      n.text = (n.text || '') + '\n\n已取消，没有写入任何数据。';
      n.acts = [];
      saveChat(); paintLog();
      return;
    }
    if (act === 'copy') {
      var t = document.createElement('textarea');
      t.value = n.text || ''; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); T('已复制'); } catch (e) { T('复制失败，手动选中吧'); }
      t.remove();
      return;
    }
    if (act === 'retry') {
      var u = userOf(n);
      if (!u) return;
      answerFor(u);
      return;
    }
    if (act === 'quiz-save' || act === 'quiz-save-start') {
      saveQuizFromNode(n, act === 'quiz-save-start');
      return;
    }
    if (act === 'quiz-import') {
      try {
        if (window.SS && SS.set) { SS.set('importText', normalizeBankText(n.text || '')); SS.set('editing', ''); }
        if (typeof go === 'function') go('#/import');
        else T('导入页没打开', 2200, 'bad');
      } catch (e) { T('导入页没打开', 2200, 'bad'); }
      return;
    }
    if (act === 'import-files') {
      var cache = MEM.__lastFileBanks;
      if (!cache || !cache.length) { T('这轮附件的题库不在了，重新拖一次文件吧', 2600, 'bad'); return; }
      var cnt = 0;
      cache.forEach(function (b) {
        var id2 = (window.VARIANT && VARIANT.saveBankFromQuestions) ? VARIANT.saveBankFromQuestions(b.title, b.questions, { subtitle: '自建题库 · 从文件导入 · ' + b.questions.length + ' 题' }) : '';
        if (id2) cnt++;
      });
      T(cnt ? ('已导入 ' + cnt + ' 个题库') : '导入失败', 2600);
    }
  }

  /* ============================================================
     主页拖拽入口
     ============================================================ */
  function bindChatHome() {
    if (bindChatHome._done) return;
    bindChatHome._done = true;
    /* 拖文件进页面时，把对话卡片亮一下：告诉用户可以往这里丢 */
    document.addEventListener('dragover', function (e) {
      var dt = e.dataTransfer;
      if (!dt || !Array.prototype.some.call(dt.types || [], function (t) { return t === 'Files'; })) return;
      var slot = document.getElementById('chatHome');
      if (slot && !slot.classList.contains('chat-drag')) slot.classList.add('chat-drag');
    }, true);
    var clearHot = function () {
      var slot = document.getElementById('chatHome');
      if (slot) slot.classList.remove('chat-drag');
    };
    document.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget) clearHot();
    }, true);
    document.addEventListener('dragover', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('#chatHome') : null;
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      card.classList.add('chat-drag');
    }, true);
    document.addEventListener('dragleave', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('#chatHome') : null;
      if (card) card.classList.remove('chat-drag');
    }, true);
    document.addEventListener('drop', function (e) {
      var card = e.target && e.target.closest ? e.target.closest('#chatHome') : null;
      if (!card) return;
      clearHot();
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('chat-drag');
      var dt = e.dataTransfer;
      var internal = '';
      try { internal = String(dt.getData('text/plain') || ''); } catch (err) {}
      try {
        /* 普通模式框选后拖任意一个选中项：把整框都加进来 */
        var csel = (typeof CAT !== 'undefined' && CAT && CAT.chatSel) ? CAT.chatSel() : null;
        if (internal && csel && csel.banks.concat(csel.cats).indexOf(internal) >= 0) {
          var addedSel = addRef(csel);
          if (CAT && CAT.clearChatSel) CAT.clearChatSel();
          paintPend();
          T(addedSel ? ('已加进对话：' + addedSel + ' 项') : '这些内容已经在对话里了', 2200);
          setTimeout(function () { try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e2) {} }, 50);
          return;
        }
        var batch = (typeof CAT !== 'undefined' && CAT && CAT.batch) ? CAT.batch() : null;
        if (internal && batch && batch.n > 1 && batch.ids.indexOf(internal) >= 0) {
          var added = 0;
          batch.ids.forEach(function (bid) {
            var bb = (typeof bankById === 'function') ? bankById(bid) : null;
            if (bb && addPend({ kind: 'bank', id: bb.id, title: bb.title })) added++;
          });
          paintPend();
          T(added ? ('已加进对话：' + added + ' 个题库') : '这些题库已经在对话里了', 2000);
          setTimeout(function () { try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (err) {} }, 50);
          return;
        }
      } catch (err) {}
      if (internal && typeof bankById === 'function' && bankById(internal)) {
        var b = bankById(internal);
        addPend({ kind: 'bank', id: b.id, title: b.title });
        paintPend();
        T('题库已加进对话，写句要求再发送', 2000);
        setTimeout(function () { try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (err) {} }, 50);
        return;
      }
      if (internal && typeof CAT !== 'undefined' && CAT && CAT.get && CAT.get(internal)) {
        var c = CAT.get(internal);
        var n = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
        var ids = [internal].concat(CAT.descIds ? CAT.descIds(internal) : []);
        all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) n++; });
        addPend({ kind: 'cat', id: internal, title: c.title || '目录', n: n });
        paintPend();
        T('目录已加进对话（' + n + ' 个题库）', 2200);
        setTimeout(function () { try { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (err) {} }, 50);
        return;
      }
      handleDrop(dt).then(function (n2) { if (n2) paintPend(); });
    }, true);
    /* 拖到页面其它地方的文件（不是 txt/json 那种题库文件）也接进对话：
       bf.js 在 window 上有个全局 drop，对 PDF / 图片之类只会弹「只认得 .json 题库文件」——那体验很迷惑。 */
    document.addEventListener('drop', function (e) {
      if (e.target && e.target.closest && e.target.closest('#chatHome')) return;   /* 上面那个处理了 */
      /* 只在聊天页兜底：做题页的「改解析 / 解析块」自己收图片，别抢过来加进 AI 对话 */
      if (!document.getElementById('chatHome') && !document.getElementById('chatLog')) return;
      if (e.target && e.target.closest && e.target.closest('[contenteditable="true"], .ed, .rich-edit, textarea, input')) return;
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      var names = Array.prototype.slice.call(dt.files).map(function (f) { return String(f.name || '').toLowerCase(); });
      var interesting = names.some(function (n) { return /\.(pdf|docx?|html?|png|jpe?g|gif|webp|bmp)$/.test(n); });
      if (!interesting) return;   /* .txt / .json 留给原来的「拖进网页 = 导入题库」 */
      e.preventDefault();
      e.stopPropagation();
      clearHot();
      handleDrop(dt).then(function (n) { if (n) { paintPend(); T('已加到 AI 对话：' + n + ' 个文件', 2400); } });
    }, true);
  }

  function handleDrop(dt) {
    return filesFromDrop(dt).then(function (files) {
      if (!files || !files.length) {
        var internal = '';
        try { internal = dt ? String(dt.getData('text/plain') || '') : ''; } catch (e) {}
        if (internal && typeof bankById === 'function' && bankById(internal)) {
          var b = bankById(internal);
          addPend({ kind: 'bank', id: b.id, title: b.title });
          return 1;
        }
        if (internal && typeof CAT !== 'undefined' && CAT && CAT.get && CAT.get(internal)) {
          var c = CAT.get(internal);
          var n = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
          var ids = [internal].concat(CAT.descIds ? CAT.descIds(internal) : []);
          all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) n++; });
          addPend({ kind: 'cat', id: internal, title: c.title || '目录', n: n });
          return 1;
        }
        T('没认出文件（支持 txt / json / md / pdf / docx / html / 图片，或整文件夹）', 2800);
        return 0;
      }
      return Promise.all(files.map(attachFile)).then(function () {
        var nb = PEND.filter(function (a) { return a.kind === 'file-bank'; }).length;
        T('收到 ' + files.length + ' 个文件' + (nb ? ('，认出 ' + nb + ' 个题库') : ''), 2600);
        return files.length;
      });
    });
  }

  /* ---------- 对外 ---------- */
  function addInternal(v) {
    if (/^b:/.test(v)) {
      var b = (typeof bankById === 'function') ? bankById(v.slice(2)) : null;
      if (b) addPend({ kind: 'bank', id: b.id, title: b.title });
    } else if (/^c:/.test(v)) {
      var cid = v.slice(2);
      var c = (typeof CAT !== 'undefined' && CAT && CAT.get) ? CAT.get(cid) : null;
      var n = 0, all = (typeof baseBanks === 'function') ? baseBanks() : [];
      var ids = [cid].concat((typeof CAT !== 'undefined' && CAT && CAT.descIds) ? CAT.descIds(cid) : []);
      all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) n++; });
      if (c) addPend({ kind: 'cat', id: cid, title: c.title || '目录', n: n });
    }
    paintPend();
  }
  function goHomeAndChat() {
    SCROLL_NEXT = true;
    if ((location.hash || '#/') === '#/' || location.hash === '') {
      if (window.CAT && CAT.render) { try { CAT.render(); } catch (e) {} }
      else { try { render(); } catch (e) {} }
    } else {
      location.hash = '#/';
    }
  }
  /* 主页拖动题库 / 目录时，固定投放条把 ref（{banks:[],cats:[]}）交给这里 */
  function addRef(ref) {
    var n = 0;
    ((ref && ref.banks) || []).forEach(function (id) {
      var b = (typeof bankById === 'function') ? bankById(id) : null;
      if (b && addPend({ kind: 'bank', id: b.id, title: b.title })) n++;
    });
    ((ref && ref.cats) || []).forEach(function (id) {
      var c = (typeof CAT !== 'undefined' && CAT && CAT.get) ? CAT.get(id) : null;
      if (!c) return;
      var all = (typeof baseBanks === 'function') ? baseBanks() : [];
      var ids = [id].concat((typeof CAT !== 'undefined' && CAT && CAT.descIds) ? CAT.descIds(id) : []);
      var cnt = 0;
      all.forEach(function (x) { if (ids.indexOf(x.cat) >= 0) cnt++; });
      if (addPend({ kind: 'cat', id: id, title: c.title || '目录', n: cnt })) n++;
    });
    if (n) paintPend();
    return n;
  }
  function focusChat() {
    var slot = $id('chatHome');
    if (!slot) { if (typeof go === 'function') go('#/chat'); return; }
    try { slot.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { slot.scrollIntoView(); } catch (e2) {} }
    slot.classList.add('chat-flash');
    setTimeout(function () { slot.classList.remove('chat-flash'); }, 1600);
  }

  window.CHAT = {
    render: render,
    mountHome: mountHome,
    openWith: function (v) { if (v) addInternal(v); goHomeAndChat(); },
    openBank: function (id) { if (id) addInternal('b:' + id); goHomeAndChat(); },
    parseBankText: function (text, name) { return parseBankText(text, name); },
    normalizeBankText: function (text) { return normalizeBankText(text); },
    planQuiz: function (userNodeId) {
      var u = node(userNodeId);
      if (!u) return null;
      if (u.role === 'ai' && u.text) {
        var self = parseBankText(u.text, u.quizTitle || 'AI 出题');
        if (self && self.questions && self.questions.length) {
          return { title: self.title || u.quizTitle || 'AI 出题', questions: self.questions, node: u.id };
        }
      }
      var chain = pathBefore(u).slice().reverse();
      for (var i = 0; i < chain.length; i++) {
        var cand = chain[i];
        if (!cand || cand.role !== 'ai' || !cand.text) continue;
        var p = parseBankText(cand.text, cand.quizTitle || 'AI 出题');
        if (p && p.questions && p.questions.length) return { title: p.title || cand.quizTitle || 'AI 出题', questions: p.questions, node: cand.id };
      }
      return null;
    },
    openCat: function (id) { if (id) addInternal('c:' + id); goHomeAndChat(); },
    addRef: function (ref) { var n = addRef(ref); if (n) focusChat(); return n; },
    tree: function () { return TREE; },
    active: function () { return TREE.active; },
    bound: function () { return !!bindChatHome._done; },
    clear: function () {
      var c = curChat();
      if (c) { c.tree.nodes = {}; c.tree.roots = []; c.tree.active = null; TREE = c.tree; }
      else { TREE = emptyTree(); }
      saveChat();
    }
  };

  /* 在别的页面时侧边按钮隐藏；按 Esc 收起抽屉 */
  try {
    window.addEventListener('hashchange', function () {
      setTimeout(syncSideTab, 60);
      setTimeout(syncSideTab, 350);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var d = $id('chatDrawer');
        if (d && d.classList.contains('show')) closeSide();
      }
    });
  } catch (e) {}

  /* 启动：读存档失败也不能耽误「拖拽/入口按钮」的绑定（file:// 下 localStorage 可能被禁）；
     绑定只挂 document 监听，脚本执行时就能挂，不必等 DOMContentLoaded（否则刚打开的一瞬间拖拽会丢）。 */
  try { loadChat(); } catch (e) {}
  try { bindChatHome(); } catch (e) {}
})();
