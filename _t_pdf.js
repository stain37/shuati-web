const fs = require('fs');
const path = 'C:/Users/chen/Desktop/刷题站-在线版/pdf-index.json';
const idx = JSON.parse(fs.readFileSync(path, 'utf8'));
const norm = {};
for (const k in idx) norm[String(k).replace(/\s+/g, '')] = idx[k];
function resolve(name) {
  const n = String(name || '').trim();
  const keys = [n, n.replace(/\.pdf$/i, ''), n.replace(/\s+/g, ''), n.replace(/\.pdf$/i, '').replace(/\s+/g, '')];
  for (const k of keys) if (idx[k]) return idx[k];
  const core = n.replace(/\.pdf$/i, '').split('_')[0];
  for (const k in idx) if (k.indexOf(core) === 0 && core.length >= 4) return idx[k];
  const nk = n.replace(/\s+/g, '').replace(/\.pdf$/i, '');
  for (const k in norm) if (k.indexOf(nk) === 0 && nk.length >= 6) return norm[k];
  return '';
}
const names = [
  '1.10 生化 胆色素代谢 精编版（已勘误）',
  '1.10 生化 胆色素代谢 精编版（已勘误）.pdf',
  '1.1 COPD 精编版（已勘误）',
  '03 内科精编合集【原发性肾小球疾病到MDS】'
];
for (const n of names) console.log(n, '=>', resolve(n) || 'MISS');
