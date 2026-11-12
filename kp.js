/* ============================================================
   知识点管理器（站内版）kp.js
   · 存储：IndexedDB `shuati-kp`，按「表」分开：kp / tags / links / imports
   · 约束在应用层实现（浏览器没有 SQLite）：
       - code 只在存活行里唯一（模拟 partial unique index）
       - 软删除默认只允许叶子；cascade 给整棵子树打同一个 deleted_at
       - has_children 只统计存活子节点
       - 导入幂等键是文件 sha256，不是批次号
       - 标签先 norm() 再落 slug，碎片进不来
   · 搜索：名称/摘要子串（两字词也能搜），名称命中优先
   ============================================================ */
(function () {
  'use strict';

  var DB_NAME = 'shuati-kp';
  var DB_VER = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('这台浏览器没有 IndexedDB'));
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('kp')) {
          var s = db.createObjectStore('kp', { keyPath: 'id' });
          s.createIndex('code', 'code', { unique: false });
          s.createIndex('parent', 'parent_id', { unique: false });
        }
        if (!db.objectStoreNames.contains('tags')) {
          var t = db.createObjectStore('tags', { keyPath: 'id' });
          t.createIndex('slug', 'slug', { unique: true });
        }
        if (!db.objectStoreNames.contains('links')) {
          db.createObjectStore('links', { keyPath: ['kpId', 'tagId'] });
        }
        if (!db.objectStoreNames.contains('imports')) {
          var im = db.createObjectStore('imports', { keyPath: 'id' });
          im.createIndex('sha', 'sha256', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('IndexedDB 打不开')); };
    });
    return dbp;
  }

  function run(storeNames, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(storeNames, mode);
        var out;
        tx.oncomplete = function () { res(out); };
        tx.onerror = function () { rej(tx.error || new Error('数据库出错')); };
        tx.onabort = function () { rej(tx.error || new Error('数据库中止')); };
        try { out = fn(tx); } catch (e) { rej(e); }
      });
    });
  }

  function reqq(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }

  function getAll(store) {
    return run([store], 'readonly', function (tx) {
      return reqq(tx.objectStore(store).getAll());
    });
  }

  function seq(key) {
    return run(['meta'], 'readwrite', function (tx) {
      var st = tx.objectStore('meta');
      return reqq(st.get(key)).then(function (row) {
        var n = ((row && row.v) || 0) + 1;
        st.put({ k: key, v: n });
        return n;
      });
    });
  }

  /* ---------- 归一化：全角→半角、折叠空白、大小写 ---------- */
  function normTag(raw) {
    var s = String(raw == null ? '' : raw);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.toLowerCase) s = s.toLowerCase(); else s = s.toLowerCase();
    return s;
  }

  function normCode(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, '').trim().toUpperCase();
  }

  /* ---------- 读取 ---------- */
  function loadAll() {
    return Promise.all([getAll('kp'), getAll('tags'), getAll('links')]).then(function (a) {
      var kps = a[0] || [], tags = a[1] || [], links = a[2] || [];
      var byTag = {};
      tags.forEach(function (t) { byTag[t.id] = t; });
      var tagOf = {};
      links.forEach(function (l) {
        (tagOf[l.kpId] = tagOf[l.kpId] || []).push(byTag[l.tagId] || { id: l.tagId, name: '?' });
      });
      kps.forEach(function (k) { k.tags = tagOf[k.id] || []; });
      return { kps: kps, tags: tags, links: links };
    });
  }

  function alive(k) { return !k.is_deleted; }

  function aliveChildren(all, id) {
    return all.kps.filter(function (k) { return k.parent_id === id && alive(k); });
  }

  function codeTaken(all, code, exceptId) {
    var c = normCode(code);
    return all.kps.some(function (k) {
      return alive(k) && k.code && normCode(k.code) === c && k.id !== exceptId;
    });
  }

  function levelOf(all, k) {
    var n = 1, cur = k, guard = 0;
    while (cur && cur.parent_id && guard++ < 50) {
      var p = all.kps.find(function (x) { return x.id === cur.parent_id; });
      if (!p) break;
      n++; cur = p;
    }
    return n;
  }

  function childrenMap(all) {
    var m = {};
    all.kps.forEach(function (k) { if (alive(k)) (m[k.parent_id || 0] = m[k.parent_id || 0] || []).push(k); });
    Object.keys(m).forEach(function (p) {
      m[p].sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id; });
    });
    return m;
  }

  /* ---------- 校验：父链不能成环 ---------- */
  function wouldCycle(all, id, parentId) {
    var guard = 0, cur = parentId;
    while (cur && guard++ < 200) {
      if (cur === id) return true;
      var p = all.kps.find(function (x) { return x.id === cur; });
      cur = p ? p.parent_id : null;
    }
    return false;
  }

  /* ---------- 写入 ---------- */
  function ensureTags(names) {
    var list = (names || []).map(normTag).filter(Boolean);
    list = list.filter(function (v, i) { return list.indexOf(v) === i; });
    if (!list.length) return Promise.resolve([]);
    return getAll('tags').then(function (tags) {
      var bySlug = {};
      tags.forEach(function (t) { bySlug[t.slug] = t; });
      var pending = list.filter(function (s) { return !bySlug[s]; });
      if (!pending.length) return list.map(function (s) { return bySlug[s]; });
      return Promise.all(pending.map(function (s) { return seq('tag'); })).then(function (ids) {
        return run(['tags'], 'readwrite', function (tx) {
          var st = tx.objectStore('tags');
          pending.forEach(function (s, i) {
            var t = { id: ids[i], name: s, slug: s, created_at: Date.now() };
            bySlug[s] = t;
            st.put(t);
          });
          return list.map(function (s) { return bySlug[s]; });
        });
      });
    });
  }

  function linkTags(kpId, tagIds) {
    return run(['links'], 'readwrite', function (tx) {
      var st = tx.objectStore('links');
      var r = st.openCursor();
      r.onsuccess = function () {
        var c = r.result;
        if (!c) return;
        if (c.value.kpId === kpId) c.delete();
        c.continue();
      };
      (tagIds || []).forEach(function (id) { st.put({ kpId: kpId, tagId: id }); });
    });
  }

  function create(input) {
    return loadAll().then(function (all) {
      var code = normCode(input.code);
      if (!input.name || !String(input.name).trim()) throw new Error('名称不能为空');
      if (code && codeTaken(all, code)) throw new Error('编码已存在（存活行里唯一）：' + code);
      if (input.parentId && !all.kps.some(function (k) { return k.id === input.parentId && alive(k); })) throw new Error('父节点不存在或已删除');
      return seq('kp').then(function (id) {
        var now = Date.now();
        var row = {
          id: id, code: code || '', name: String(input.name).trim(),
          summary: String(input.summary || '').trim(),
          parent_id: input.parentId || null,
          sort_order: Number(input.sort || 0) || 0,
          is_deleted: 0, deleted_at: null, created_at: now, updated_at: now
        };
        return run(['kp'], 'readwrite', function (tx) { tx.objectStore('kp').put(row); return row; });
      }).then(function (row) {
        return ensureTags(input.tags).then(function (tags) {
          return linkTags(row.id, tags.map(function (t) { return t.id; })).then(function () { return row; });
        });
      });
    });
  }

  function update(id, patch) {
    return loadAll().then(function (all) {
      var row = all.kps.find(function (k) { return k.id === id; });
      if (!row) throw new Error('这条知识点不在了');
      if (!alive(row)) throw new Error('已删除的先恢复再改');
      var next = Object.assign({}, row);
      if (patch.name != null) {
        if (!String(patch.name).trim()) throw new Error('名称不能为空');
        next.name = String(patch.name).trim();
      }
      if (patch.code != null) {
        var code = normCode(patch.code);
        if (code && codeTaken(all, code, id)) throw new Error('编码已存在（存活行里唯一）：' + code);
        next.code = code;
      }
      if (patch.summary != null) next.summary = String(patch.summary).trim();
      if (patch.sort != null) next.sort_order = Number(patch.sort) || 0;
      if (patch.parentId !== undefined) {
        var pid = patch.parentId || null;
        if (pid) {
          if (pid === id) throw new Error('不能把自己设成父节点');
          if (!all.kps.some(function (k) { return k.id === pid && alive(k); })) throw new Error('父节点不存在或已删除');
          if (wouldCycle(all, id, pid)) throw new Error('这样会成环');
        }
        next.parent_id = pid;
        /* 层级重新计算 */
        next.level = 0;
      }
      next.updated_at = Date.now();
      return run(['kp'], 'readwrite', function (tx) { tx.objectStore('kp').put(next); return next; })
        .then(function (r) {
          if (!patch.tags) return r;
          return ensureTags(patch.tags).then(function (tags) {
            return linkTags(id, tags.map(function (t) { return t.id; })).then(function () { return r; });
          });
        });
    });
  }

  /* 软删除：默认只允许叶子；cascade 整棵子树用同一个 deleted_at */
  function softDelete(id, mode) {
    return loadAll().then(function (all) {
      var row = all.kps.find(function (k) { return k.id === id; });
      if (!row) throw new Error('这条知识点不在了');
      var kids = aliveChildren(all, id);
      if (kids.length && mode !== 'cascade') throw new Error('这个节点下面还有 ' + kids.length + ' 个子节点；要先选「整棵删」');
      var stamp = Date.now();
      var ids = [];
      (function walk(nid) {
        ids.push(nid);
        aliveChildren(all, nid).forEach(function (c) { walk(c.id); });
      })(id);
      return run(['kp'], 'readwrite', function (tx) {
        var st = tx.objectStore('kp');
        ids.forEach(function (nid) {
          var k = all.kps.find(function (x) { return x.id === nid; });
          k.is_deleted = 1; k.deleted_at = stamp; k.updated_at = stamp;
          st.put(k);
        });
        return { n: ids.length, stamp: stamp };
      });
    });
  }

  function restoreStamp(stamp) {
    return getAll('kp').then(function (rows) {
      var hit = rows.filter(function (k) { return k.deleted_at === stamp; });
      var byId = {};
      rows.forEach(function (k) { byId[k.id] = k; });
      /* 连祖先一起恢复：父链上还有被删的，单恢复子节点会让它挂在树外看不见 */
      var set = {};
      hit.forEach(function (k) { set[k.id] = 1; });
      hit.forEach(function (k) {
        var p = k.parent_id, guard = 0;
        while (p && byId[p] && guard++ < 60) {
          if (byId[p].is_deleted) set[p] = 1;
          p = byId[p].parent_id;
        }
      });
      return run(['kp'], 'readwrite', function (tx) {
        var st = tx.objectStore('kp');
        var n = 0;
        Object.keys(set).forEach(function (id) {
          var k = byId[id];
          if (!k) return;
          k.is_deleted = 0; k.deleted_at = null; k.updated_at = Date.now();
          st.put(k); n++;
        });
        return n;
      });
    });
  }

  /* ---------- 搜索：名称/摘要子串；名称前缀 > 名称 > 摘要 ---------- */
  function search(all, q, opt) {
    opt = opt || {};
    var s = String(q || '').trim().toLowerCase();
    var list = all.kps.filter(function (k) { return (opt.includeDeleted ? true : alive(k)); });
    if (opt.tagId) {
      var ids = {};
      all.links.forEach(function (l) { if (l.tagId === opt.tagId) ids[l.kpId] = 1; });
      list = list.filter(function (k) { return ids[k.id]; });
    }
    if (!s) return list.sort(function (a, b) { return b.updated_at - a.updated_at; });
    var words = s.split(/\s+/).filter(Boolean);
    var out = [];
    list.forEach(function (k) {
      var name = (k.name || '').toLowerCase(), sum = (k.summary || '').toLowerCase();
      var hitAll = words.every(function (w) { return name.indexOf(w) >= 0 || sum.indexOf(w) >= 0; });
      if (!hitAll) return;
      var score = 0;
      words.forEach(function (w) {
        if (name.indexOf(w) === 0) score += 100;
        else if (name.indexOf(w) >= 0) score += 40;
        if (sum.indexOf(w) >= 0) score += 10;
      });
      out.push({ k: k, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score || a.k.name.length - b.k.name.length; });
    return out.map(function (x) { return x.k; });
  }

  /* ---------- 导入：sha256 幂等 + 两遍建层级 + 整批环检测 ---------- */
  function sha256(text) {
    var enc = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      return [].map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }

  function importCSV(text, fileName) {
    return sha256(text).then(function (hash) {
      return run(['imports'], 'readonly', function (tx) {
        var idx = tx.objectStore('imports').index('sha');
        return reqq(idx.getAll(hash));
      }).then(function (old) {
        var done = (old || []).filter(function (b) { return b.status === 1; })[0];
        if (done) return { reused: true, batch: done };
        return doImport(text, fileName, hash);
      });
    });
  }

  function doImport(text, fileName, hash) {
    var rows = parseCSV(text);
    if (rows.length < 2) return Promise.reject(new Error('CSV 至少要有一行表头 + 一行数据'));
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    function col(name, fallback) { var i = head.indexOf(name); return i >= 0 ? i : fallback; }
    var ci = { code: col('code', 0), parent: col('parent_code', 1), name: col('name', 2), summary: col('summary', 3), tags: col('tags', 4), sort: col('sort', 5) };

    return loadAll().then(function (all) {
      var created = [], patched = [];
      var codeToId = {};
      all.kps.forEach(function (k) { if (alive(k) && k.code) codeToId[normCode(k.code)] = k.id; });
      var errors = [];

      /* 第 1 遍：节点（parent 先留空） */
      var p1 = rows.slice(1).reduce(function (chain, r, idx) {
        return chain.then(function () {
          var code = normCode(r[ci.code]);
          var name = String(r[ci.name] || '').trim();
          if (!name) { errors.push({ line: idx + 2, msg: '没有名称' }); return; }
          if (code && codeToId[code]) return;         /* 已有：这遍不改，第二遍再连父 */
          return seq('kp').then(function (id) {
            var now = Date.now();
            var row = {
              id: id, code: code, name: name,
              summary: String(r[ci.summary] || '').trim(),
              parent_id: null, sort_order: Number(r[ci.sort] || 0) || 0,
              is_deleted: 0, deleted_at: null, created_at: now, updated_at: now
            };
            created.push({ id: id, code: code });
            if (code) codeToId[code] = id;
            return run(['kp'], 'readwrite', function (tx) { tx.objectStore('kp').put(row); });
          });
        });
      }, Promise.resolve());

      return p1.then(function () {
        /* 第 2 遍：连线 */
        return run(['kp'], 'readwrite', function (tx) {
          var st = tx.objectStore('kp');
          return reqq(st.getAll()).then(function (now) {
            var byId = {};
            now.forEach(function (k) { byId[k.id] = k; });
            rows.slice(1).forEach(function (r, idx) {
              var code = normCode(r[ci.code]);
              var pcode = normCode(r[ci.parent]);
              var id = code ? codeToId[code] : null;
              if (!id || !pcode) return;
              var pid = codeToId[pcode];
              if (!pid) { errors.push({ line: idx + 2, msg: '父节点不存在：' + pcode }); return; }
              if (pid === id) { errors.push({ line: idx + 2, msg: '自己指向自己' }); return; }
              var k = byId[id];
              if (!k || k.parent_id === pid) return;
              patched.push({ id: id, old: k.parent_id });
              k.parent_id = pid; k.updated_at = Date.now();
              st.put(k);
            });
            return now;
          });
        }).then(function (now) {
          /* 第 3 遍：整批环检测（沿父链走，最多 50 层） */
          var byId = {};
          now.forEach(function (k) { byId[k.id] = k; });
          var bad = [];
          now.forEach(function (k) {
            var seen = {}, cur = k, n = 0;
            while (cur && cur.parent_id && n++ < 50) {
              if (seen[cur.id]) { bad.push(k.code || k.name); return; }
              seen[cur.id] = 1;
              cur = byId[cur.parent_id];
            }
            if (n >= 50) bad.push(k.code || k.name);
          });
          if (bad.length) {
            /* 整批回滚：删掉本批新建、还原父链 */
            return rollback(created, patched).then(function () {
              throw new Error('这批数据里有环或父子链超 50 层：' + bad.slice(0, 3).join('、'));
            });
          }
          /* 标签（新建的） */
          var tagChains = created.reduce(function (ch, c) {
            var idx = rows.slice(1).findIndex(function (r) { return normCode(r[ci.code]) === c.code; });
            var raw = idx >= 0 ? String(rows[idx + 1][ci.tags] || '') : '';
            var names = raw.split(/[|;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
            return ch.then(function () {
              return ensureTags(names).then(function (tags) { if (tags.length) return linkTags(c.id, tags.map(function (t) { return t.id; })); });
            });
          }, Promise.resolve());
          return tagChains.then(function () {
            return seq('imp').then(function (bid) {
              var done = created.length, failed = errors.length;
              var batch = {
                id: bid, sha256: hash, file: fileName || '', status: failed ? 2 : 1,
                total_rows: rows.length - 1, ok_rows: done, failed_rows: failed,
                errors: errors.slice(0, 50), created_at: Date.now(), finished_at: Date.now()
              };
              return run(['imports'], 'readwrite', function (tx) { tx.objectStore('imports').put(batch); return batch; });
            });
          });
        });
      });
    });
  }

  function rollback(created, patched) {
    return run(['kp'], 'readwrite', function (tx) {
      var st = tx.objectStore('kp');
      created.forEach(function (c) { st.delete(c.id); });
      patched.forEach(function (p) { reqq(st.get(p.id)).then(function (k) { if (k) { k.parent_id = p.old; st.put(k); } }); });
    });
  }

  /* ---------- 云端同步：整库导出 / 按 updated_at 合并 ---------- */
  function dump() {
    return loadAll().then(function (all) {
      return { v: 1, at: Date.now(), kp: all.kps, tags: all.tags, links: all.links };
    });
  }

  function merge(d) {
    if (!d || !Array.isArray(d.kp)) return Promise.resolve({ kp: 0, tags: 0, links: 0 });
    return loadAll().then(function (all) {
      var byId = {}, bySlug = {}, linkKey = {};
      all.kps.forEach(function (k) { byId[k.id] = k; });
      all.tags.forEach(function (t) { bySlug[t.slug] = t; });
      all.links.forEach(function (l) { linkKey[l.kpId + '|' + l.tagId] = l; });

      var nKp = 0, nTag = 0, nLink = 0;
      d.kp.forEach(function (k) {
        if (!k || !k.id) return;
        var cur = byId[k.id];
        if (!cur || (+k.updated_at || 0) > (+cur.updated_at || 0)) { byId[k.id] = k; nKp++; }
      });
      (d.tags || []).forEach(function (t) {
        if (!t || !t.slug) return;
        if (!bySlug[t.slug]) { bySlug[t.slug] = t; nTag++; }
      });
      (d.links || []).forEach(function (l) {
        if (!l || !l.kpId || !l.tagId) return;
        var k = l.kpId + '|' + l.tagId;
        if (!linkKey[k]) { linkKey[k] = l; nLink++; }
      });

      var kps = Object.keys(byId).map(function (k) { return byId[k]; });
      var tags = Object.keys(bySlug).map(function (k) { return bySlug[k]; });
      var links = Object.keys(linkKey).map(function (k) { return linkKey[k]; });
      var maxKp = kps.reduce(function (m, x) { return Math.max(m, +x.id || 0); }, 0);
      var maxTag = tags.reduce(function (m, x) { return Math.max(m, +x.id || 0); }, 0);

      return run(['kp', 'tags', 'links', 'meta'], 'readwrite', function (tx) {
        kps.forEach(function (x) { tx.objectStore('kp').put(x); });
        tags.forEach(function (x) { tx.objectStore('tags').put(x); });
        links.forEach(function (x) { tx.objectStore('links').put(x); });
        var meta = tx.objectStore('meta');
        return reqq(meta.get('kp')).then(function (row) {
          if (((row && row.v) || 0) < maxKp) meta.put({ k: 'kp', v: maxKp });
          return reqq(meta.get('tag'));
        }).then(function (row2) {
          if (((row2 && row2.v) || 0) < maxTag) meta.put({ k: 'tag', v: maxTag });
        });
      }).then(function () { return { kp: nKp, tags: nTag, links: nLink }; });
    });
  }

  /* ---------- 打通：考点卡 / 题库标签 ---------- */
  var CARDMAP_KEY = 'qbank.cards.kp.v1';

  function cardMap() {
    try { return JSON.parse(localStorage.getItem(CARDMAP_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function cardMapWrite(m) {
    try { localStorage.setItem(CARDMAP_KEY, JSON.stringify(m)); } catch (e) {}
  }

  /* 把一张考点卡（考点名）挂到知识点树：同名就在树上复用，没有就建一个 */
  function attachCard(card) {
    var name = String((card && card.name) || '').trim();
    if (!name) return Promise.reject(new Error('这个考点没有名字'));
    var norm = normTag(name);
    return loadAll().then(function (all) {
      var aliveKps = all.kps.filter(alive);
      var hit = aliveKps.filter(function (k) { return normTag(k.name) === norm; })[0];
      var rootP = hit ? Promise.resolve(hit) : ensureRoot('考点卡', 'CARDR');
      return rootP.then(function (root) {
        if (hit) return hit;
        return aliveKps.filter(function (k) { return k.parent_id === root.id && normTag(k.name) === norm; })[0]
          || create({ name: name, parentId: root.id, summary: (card && card.subj) ? ('考点卡 · ' + card.subj) : '考点卡' });
      });
    }).then(function (node) {
      var m = cardMap();
      m[card.key || name] = { id: node.id, name: node.name, at: Date.now() };
      cardMapWrite(m);
      return node;
    });
  }

  function cardEntry(key) {
    var m = cardMap(), v = m[key];
    if (!v) return null;
    return (typeof v === 'object') ? v : { id: v, name: '' };
  }

  function cardLinks() {
    var m = cardMap(), cnt = {};
    Object.keys(m).forEach(function (k) {
      var v = m[k], id = (v && typeof v === 'object') ? v.id : v;
      if (!id) return;
      cnt[id] = (cnt[id] || 0) + 1;
    });
    return cnt;
  }

  /* ---------- 题库答题统计：按标签名汇总题数/尝试/错误（给知识点树做子树聚合） ---------- */
  function readLSJson(key, dflt) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; }
  }

  function questionStats() {
    var tags = readLSJson('qbank.tags.v1', {});
    var ans = readLSJson('qbank.answers.v2', {});
    var byTag = {}, byKey = {};
    Object.keys(tags).forEach(function (qk) {
      var st = ans[qk] || {};
      byKey[qk] = { tries: Number(st.tries || 0), wrong: Number(st.wrong || 0) };
      (tags[qk] || []).forEach(function (nm) {
        var k = normTag(nm);
        var slot = byTag[k] || (byTag[k] = { name: nm, keys: [] });
        slot.keys.push(qk);
      });
    });
    return { byTag: byTag, byKey: byKey, total: Object.keys(tags).length };
  }

  function ensureRoot(name, code) {
    return loadAll().then(function (all) {
      var hit = all.kps.filter(alive).filter(function (k) {
        return !k.parent_id && normTag(k.name) === normTag(name);
      })[0];
      if (hit) return hit;
      return create({ name: name, code: code });
    });
  }

  /* 把题库里已有的标签（qbank.tags.v1）批量变成知识点 */
  function fromBankTags() {
    var raw = {};
    try { raw = JSON.parse(localStorage.getItem('qbank.tags.v1') || '{}') || {}; } catch (e) { raw = {}; }
    var names = [], seen = {};
    Object.keys(raw).forEach(function (qid) {
      var arr = Array.isArray(raw[qid]) ? raw[qid] : (raw[qid] ? [raw[qid]] : []);
      arr.forEach(function (t) {
        var s = String(t || '').trim();
        if (!s) return;
        var key = normTag(s);
        if (seen[key]) return;
        seen[key] = 1; names.push(s);
      });
    });
    if (!names.length) return Promise.resolve({ created: 0, total: 0 });
    return ensureRoot('题库标签', 'TAGR').then(function (root) {
      return loadAll().then(function (all) {
        var have = {};
        all.kps.filter(alive).forEach(function (k) { have[normTag(k.name)] = 1; });
        var todo = names.filter(function (n) { return !have[normTag(n)]; });
        var created = 0;
        return todo.reduce(function (p, n) {
          return p.then(function () {
            return create({ name: n, parentId: root.id, summary: '来自题库标签' }).then(function () { created++; })
              .catch(function () {});
          });
        }, Promise.resolve()).then(function () { return { created: created, total: names.length }; });
      });
    });
  }

  function exportJSON() {
    return loadAll().then(function (all) {
      return {
        v: 1, exported_at: new Date().toISOString(),
        knowledge_points: all.kps,
        tags: all.tags,
        links: all.links
      };
    });
  }

  /* ---------- 对外 ---------- */
  window.KP = {
    cardEntry: cardEntry,
    open: open, loadAll: loadAll, childrenMap: childrenMap, levelOf: levelOf, aliveChildren: aliveChildren,
    create: create, update: update, softDelete: softDelete, restoreStamp: restoreStamp,
    search: search, importCSV: importCSV, exportJSON: exportJSON, normTag: normTag, normCode: normCode,
    wouldCycle: wouldCycle, sha256: sha256, parseCSV: parseCSV,
    dump: dump, merge: merge, attachCard: attachCard, cardLinks: cardLinks, fromBankTags: fromBankTags,
    questionStats: questionStats,
    CARDMAP_KEY: CARDMAP_KEY
  };
})();
