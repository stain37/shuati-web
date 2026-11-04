/* ============================================================
   刷题站 · CSV 导入 / 导出（web257）
   ——————————————————————————————————————————————
   为什么要有它：题库能导出 JSON，但 JSON 只能给本网站用；
   想看题目、想用 Excel / WPS 排错、想把题库发给同学合并，
   最通用的还是 CSV（表格软件都认）。

   这里只做两件事：
     1) 导出一个题库 → .csv（带 BOM，Excel 双击打开中文不乱码）；
        列：题号 / 题型 / 题干 / 选项A…选项H / 答案 / 解析 / 共用题干
     2) 读入 .csv → 转成站点现有的纯文本题格式，灌进「导入」页的文本框，
        后面的「解析预览 / 保存题库」完全走老流程（不新增一条解析链）。

   顺手处理两个国内最常见的坑：
     · Excel 默认存的是 GBK —— UTF-8 读出来是乱码时自动用 GBK 再读一遍；
     · 字段里带逗号 / 引号 / 换行 —— 按 RFC 4180 加引号、内部引号写两个。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 基础：转义 / 拼行 ---------- */
  function cell(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n');
  }

  /* ---------- 解析：RFC 4180（引号内可含逗号/换行，"" 表示一个引号） ---------- */
  function parse(text) {
    var s = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', q = false, i = 0, c;
    while (i < s.length) {
      c = s.charAt(i);
      if (q) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cur += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(cur); cur = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += c; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    /* 去掉纯空行 */
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }

  /* ---------- 表头识别（宽容：中文 / 英文 / 带空格括号都认） ---------- */
  function norm(h) {
    return String(h == null ? '' : h)
      .replace(/[\s\u3000]/g, '')
      .replace(/[（(].*?[）)]/g, '')
      .replace(/[：:]/g, '')
      .toLowerCase();
  }
  var KEY = {
    no: ['题号', '序号', 'no', 'id', '#'],
    type: ['题型', '类型', 'type'],
    stem: ['题干', '题目', '问题', '内容', 'stem', 'question'],
    answer: ['答案', '正确答案', 'answer', 'key'],
    explain: ['解析', '答案解析', '说明', '解释', 'explain', 'explanation', 'analysis'],
    group: ['共用题干', '材料', '病例', 'case', 'group', 'groupstem']
  };
  function pick(head, list) {
    for (var i = 0; i < head.length; i++) {
      var h = norm(head[i]);
      for (var j = 0; j < list.length; j++) if (h === norm(list[j])) return i;
    }
    /* 再来一轮「包含」匹配，容忍「题目内容」「正确答案(字母)」这类写法 */
    for (var k = 0; k < head.length; k++) {
      var g = norm(head[k]);
      for (var m = 0; m < list.length; m++) {
        var t = norm(list[m]);
        if (t.length > 1 && g.indexOf(t) >= 0) return k;
      }
    }
    return -1;
  }
  function pickOption(head, ch) {
    var names = [
      '选项' + ch, ch, '选项' + ch.toLowerCase(), ch.toLowerCase(),
      'option' + ch, 'option' + ch.toLowerCase(), 'opt' + ch
    ];
    for (var i = 0; i < head.length; i++) {
      var h = norm(head[i]);
      for (var j = 0; j < names.length; j++) if (h === norm(names[j])) return i;
    }
    /* 「选项1 / A选项 / 选项(A)」 */
    var idx = 'ABCDEFGH'.indexOf(ch) + 1;
    for (var k = 0; k < head.length; k++) {
      var g = norm(head[k]);
      if (g === norm('选项' + idx) || g === norm(ch + '选项') || g === norm('选项' + ch.toLowerCase())) return k;
    }
    return -1;
  }

  /* ---------- CSV → 站点纯文本题格式 ---------- */
  function toText(text, title) {
    var rows = parse(text);
    if (!rows.length) return { error: '文件是空的' };
    var head = rows[0];
    var col = {
      no: pick(head, KEY.no), type: pick(head, KEY.type), stem: pick(head, KEY.stem),
      answer: pick(head, KEY.answer), explain: pick(head, KEY.explain), group: pick(head, KEY.group)
    };
    var optCols = [];
    for (var c = 0; c < 8; c++) optCols.push(pickOption(head, 'ABCDEFGH'.charAt(c)));
    if (col.stem < 0) {
      /* 没有表头（第一行就是题目）：整表按 题干/选项/答案/解析 位置猜 */
      var first = head.join(',');
      if (first.length > 40 && !/题干|题目|stem|question/i.test(first)) {
        var guess = { no: -1, type: -1, stem: 0, answer: -1, explain: -1, group: -1 };
        var oc = [];
        for (var x = 1; x <= 8; x++) oc.push(head[x] ? x : -1);
        col = guess; optCols = oc; rows = [head].concat(rows.slice(1));
      } else {
        return { error: '没找到「题干 / 题目」这一列。表头至少要有一列叫 题干（或 题目 / stem）。' };
      }
    }
    var out = [], n = 0, skipped = 0;
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var stem = (row[col.stem] || '').trim();
      if (!stem) { skipped++; continue; }
      n++;
      var opts = [];
      for (var oi = 0; oi < optCols.length; oi++) {
        var v = optCols[oi] >= 0 ? (row[optCols[oi]] || '').trim() : '';
        if (v) opts.push(v);
      }
      var ans = col.answer >= 0 ? (row[col.answer] || '').trim().toUpperCase().replace(/[^A-H]/g, '') : '';
      var exp = col.explain >= 0 ? (row[col.explain] || '').trim() : '';
      var grp = col.group >= 0 ? (row[col.group] || '').trim() : '';
      if (grp) out.push('## ' + grp);
      out.push(n + '. ' + stem.replace(/\r?\n/g, ' '));
      for (var k2 = 0; k2 < opts.length; k2++) {
        out.push('ABCDEFGH'.charAt(k2) + '. ' + opts[k2].replace(/\r?\n/g, ' '));
      }
      if (ans) out.push('答案：' + ans);
      if (exp) out.push('解析：' + exp.replace(/\r?\n/g, '\n'));
      out.push('');
    }
    if (!n) return { error: '一行题目都没读出来（题干列全是空的）' };
    return {
      text: (title ? '# ' + title + '\n\n' : '') + out.join('\n').replace(/\n{3,}/g, '\n\n'),
      count: n, skipped: skipped
    };
  }

  /* ---------- 读文件：UTF-8 → 乱码则退回 GBK（Excel 常存 GBK） ---------- */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('读文件失败')); };
      fr.onload = function () {
        var txt = String(fr.result || '');
        var bad = (txt.match(/\uFFFD/g) || []).length;
        if (!bad) { resolve(txt); return; }
        try {
          var fr2 = new FileReader();
          fr2.onload = function () {
            try {
              var buf = fr2.result;
              var dec = new TextDecoder('gbk');
              var g = dec.decode(new Uint8Array(buf));
              var bad2 = (g.match(/\uFFFD/g) || []).length;
              resolve(bad2 < bad ? g : txt);
            } catch (e) { resolve(txt); }
          };
          fr2.onerror = function () { resolve(txt); };
          fr2.readAsArrayBuffer(file);
        } catch (e) { resolve(txt); }
      };
      fr.readAsText(file, 'utf-8');
    });
  }

  /* ---------- 导出一个题库 → CSV ---------- */
  function exportBank(b) {
    if (!b || !b.questions || !b.questions.length) { if (window.toast) toast('这个题库还没有题目'); return; }
    var maxOpt = 0;
    b.questions.forEach(function (q) { maxOpt = Math.max(maxOpt, (q.options || []).length); });
    maxOpt = Math.max(2, Math.min(8, maxOpt));
    var head = ['题号', '题型', '题干'];
    for (var i = 0; i < maxOpt; i++) head.push('选项' + 'ABCDEFGH'.charAt(i));
    head.push('答案', '解析', '共用题干');
    var rows = [head];
    b.questions.forEach(function (q, idx) {
      var opts = q.options || [];
      var row = [String(idx + 1), typeName(q, opts), String(q.stem || '')];
      for (var k = 0; k < maxOpt; k++) row.push(String(opts[k] == null ? '' : opts[k]));
      var ans = Array.isArray(q.answer) ? q.answer.join('') : String(q.answer || '').replace(/[^A-H]/gi, '').toUpperCase();
      row.push(ans, String(q.explain || ''));
      row.push(String(q.groupTitle || ''));
      rows.push(row);
    });
    var d = new Date();
    var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var name = String(b.title || '题库').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '-' + stamp + '.csv';
    var body = '\uFEFF' + toCsv(rows);            // BOM：Excel 才认 UTF-8
    if (typeof window.download === 'function') { window.download(name, body, 'text/csv;charset=utf-8'); }
    else {
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(body);
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    if (window.toast) toast('已导出 ' + b.questions.length + ' 题到 ' + name);
  }

  function typeName(q, opts) {
    var ans = Array.isArray(q.answer) ? q.answer : (q.answer ? [q.answer] : []);
    if (/判断|对错/.test(String(q.type || ''))) return '判断';
    if (!opts.length || ans.length > 1) return ans.length > 1 ? '多选' : '单选';
    if (ans.length > 1) return '多选';
    return '单选';
  }

  window.CSVQ = { parse: parse, toText: toText, readFile: readFile, exportBank: exportBank, toCsv: toCsv };
})();
