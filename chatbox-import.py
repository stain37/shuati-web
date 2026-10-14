#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
刷题站 · 从 Chatbox 导入
------------------------------------------------
Chatbox（本机 AI 客户端）自己没有对外接口，但它把两样东西明文存在本机：
  1) API 配置：%APPDATA%\xyz.chatboxapp.app\config.json
     （里面有 provider、API Key、默认模型；base 地址用内置的，脚本按 provider 补全）
  2) 知识库文件清单：%APPDATA%\xyz.chatboxapp.app\chatbox-databases\chatbox_kb.db
     表 kb_file.filepath = 你当初加进知识库的那些原始文件的绝对路径（正文不存明文，所以按原文件重新解析）

本脚本把这两样转成刷题站能直接读的文件（放在刷题站目录里，刷新页面自动生效）：
  · AI配置.js   → window.__AICFG__  （刷题站 #/kb 页面会自动填好接口地址 / Key / 模型）
  · 知识库.js   → window.__KBS__    （刷题站自动挂载成知识库，AI 解析时就地检索）

用法（在刷题站目录里双击 从Chatbox导入.bat 也行）：
  python chatbox-import.py --key                 只导入 API 配置
  python chatbox-import.py --list                只列出 Chatbox 里的知识库和文件数
  python chatbox-import.py                       导入 API 配置 + 全部知识库（每个库一个知识库）
  python chatbox-import.py --only 7,5            只导入 id 为 7 和 5 的知识库
  python chatbox-import.py --kb 7                同上（可写多个：--kb 7 --kb 5）
  python chatbox-import.py --all                 把所有文件合成一个大库（总库）
  python chatbox-import.py --limit 20            每个库最多取前 20 个文件（先试水）
  python chatbox-import.py --max-chars 30000     单个文件最多取多少字（默认 60000）
  可选：--config 路径 --db 路径 --out 输出名 --per-file-cap --dry
只读：本脚本只读 Chatbox 的数据，不改动它任何文件。
"""
import argparse
import html
import io
import json
import os
import re
import sqlite3
import sys
import time
import zipfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROAM = os.path.join(os.environ.get('APPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming'),
                    'xyz.chatboxapp.app')
DEF_CONFIG = os.path.join(ROAM, 'config.json')
DEF_DB = os.path.join(ROAM, 'chatbox-databases', 'chatbox_kb.db')
HERE = os.path.dirname(os.path.abspath(__file__))

# Chatbox 内置 provider 的 base 地址（它不写在 config.json 里，这里补全）
PROVIDER_BASE = {
    'deepseek': 'https://api.deepseek.com/v1',
    'openai': 'https://api.openai.com/v1',
    'moonshot': 'https://api.moonshot.cn/v1',
    'siliconflow': 'https://api.siliconflow.cn/v1',
    'openrouter': 'https://openrouter.ai/api/v1',
    'chatbox-ai': '',
}

# Chatbox 里能跑、但官方接口上不存在的模型名 → 换成接口认的正名
# （DeepSeek 官方 /v1/models 目前只有 deepseek-flash 和 deepseek-v4-pro）
MODEL_FIX = {
    'deepseek-v4-flash': 'deepseek-flash',
}

TEXT_EXT = {'.txt', '.md', '.markdown', '.csv', '.log', '.srt', '.json'}
HTML_EXT = {'.html', '.htm', '.xhtml'}
DOCX_EXT = {'.docx'}
PDF_EXT = {'.pdf'}


def log(*a):
    print(*a)
    sys.stdout.flush()


def read_text(path):
    for enc in ('utf-8-sig', 'utf-8', 'gbk', 'gb18030', 'big5', 'latin-1'):
        try:
            with io.open(path, 'r', encoding=enc, errors='strict') as f:
                return f.read()
        except (UnicodeDecodeError, LookupError):
            continue
        except OSError:
            return None
    try:
        with io.open(path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except OSError:
        return None


def html_to_text(s):
    s = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', s)
    s = re.sub(r'(?i)<br\s*/?>', '\n', s)
    s = re.sub(r'(?i)</(p|div|li|tr|h[1-6])>', '\n', s)
    s = re.sub(r'(?s)<[^>]+>', ' ', s)
    s = html.unescape(s)
    return re.sub(r'[ \t\u00a0]+', ' ', s)


def docx_to_text(path):
    """不依赖 python-docx：docx 就是个 zip，直接读 word/document.xml"""
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read('word/document.xml').decode('utf-8', 'replace')
    except Exception:
        return None
    xml = re.sub(r'(?i)<w:tab[^>]*/>', '\t', xml)
    xml = re.sub(r'(?i)<w:br[^>]*/>', '\n', xml)
    xml = re.sub(r'(?i)</w:p>', '\n', xml)
    xml = re.sub(r'(?s)<[^>]+>', '', xml)
    return html.unescape(xml)


def pdf_to_text(path, max_pages=60):
    import contextlib
    import logging
    for nm in ('pypdf', 'PyPDF2'):
        try:
            logging.getLogger(nm).setLevel(logging.CRITICAL)
        except Exception:
            pass
    buf = io.StringIO()
    try:
        with contextlib.redirect_stderr(buf):
            return _pdf_do(path, max_pages)
    except Exception:
        return None


def _pdf_do(path, max_pages):
    lib = None
    try:
        import pypdf as lib
    except Exception:
        try:
            import PyPDF2 as lib
        except Exception:
            return None
    try:
        rd = lib.PdfReader(path)
        out = []
        for i, pg in enumerate(rd.pages):
            try:
                out.append(pg.extract_text() or '')
            except Exception:
                out.append('')
            if i + 1 >= max_pages:
                break
        return '\n'.join(out)
    except Exception:
        return None


def extract(path, cap, max_pages=60, skip_pdf=False):
    ext = os.path.splitext(path)[1].lower()
    txt = None
    if ext in TEXT_EXT:
        txt = read_text(path)
    elif ext in HTML_EXT:
        raw = read_text(path)
        txt = html_to_text(raw) if raw else None
    elif ext in DOCX_EXT:
        txt = docx_to_text(path)
    elif ext in PDF_EXT:
        if skip_pdf:
            return None, 'pdf-skip'
        txt = pdf_to_text(path, max_pages)
        if txt is None:
            return None, 'pdf-nolib'
    else:
        txt = read_text(path)
    if not txt:
        return None, 'empty'
    txt = txt.replace('\x00', ' ').strip()
    if len(txt) > cap:
        txt = txt[:cap] + '\n（本文件过长，已截断）'
    return txt, ''


def load_config(path):
    try:
        with io.open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log('[!] 读不到 Chatbox 配置：' + str(e))
        return None


def write_ai_cfg(cfg, out_path):
    s = (cfg or {}).get('settings') or {}
    provs = s.get('providers') or {}
    dm = s.get('defaultChatModel') or {}
    prov = dm.get('provider') or ''
    if prov not in provs:
        for k in provs:
            if k != 'chatbox-ai':
                prov = k
                break
    if not prov:
        log('[!] Chatbox 里没有可用的自定义 provider（只有 chatbox-ai 的话，Key 拿不到）')
        return None
    p = provs.get(prov) or {}
    key = (p.get('apiKey') or '').strip()
    base = PROVIDER_BASE.get(prov, '')
    if not base:
        # 有些版本会写 baseUrl
        base = (p.get('baseUrl') or p.get('apiHost') or '').strip()
    if base and not re.search(r'/v\d+$', base):
        base = base.rstrip('/') + '/v1'
    model = ''
    models = p.get('models') or []
    if dm.get('model') and (dm.get('provider') == prov):
        model = dm.get('model')
    if not model and models:
        m0 = models[0]
        model = m0.get('modelId') if isinstance(m0, dict) else str(m0)
    if model in MODEL_FIX:      # Chatbox 里的写法在官方接口上不存在时换成正名
        log('[!] 模型名 ' + model + ' 在 ' + (prov or '该') + ' 接口上不存在，已改用 ' + MODEL_FIX[model])
        model = MODEL_FIX[model]
    obj = {'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'provider': prov, 'base': base, 'model': model, 'key': key}
    body = 'window.__AICFG__ = ' + json.dumps(obj, ensure_ascii=False) + ';\n'
    with io.open(out_path, 'w', encoding='utf-8') as f:
        f.write('/* 由 chatbox-import.py 生成：刷题站打开时自动读取，#/kb 页面会用它填好 AI 配置。删掉本文件即不再自动填。 */\n')
        f.write(body)
    log('[OK] 写了 ' + os.path.basename(out_path) + '：' + prov + ' · ' + (base or '（没拿到地址）') + ' · 模型 ' + (model or '（自己填）')
        + ' · Key ' + (key[:6] + '…' + str(len(key)) + ' 位' if key else '（无）'))
    if not key:
        log('     （Chatbox 里这个 provider 没填 Key，去 #/kb 页面自己填一次也行）')
    return obj


def kb_table(con):
    rows = con.execute("select name from sqlite_master where type='table' and name='kb_file'").fetchall()
    return bool(rows)


def kb_names(con):
    names = {}
    try:
        cols = [r[1] for r in con.execute('PRAGMA table_info(knowledge_base)').fetchall()]
    except Exception:
        return names
    namecol = None
    for c in ('name', 'title', 'kb_name'):
        if c in cols:
            namecol = c
            break
    if not namecol:
        return names
    idcol = 'id' if 'id' in cols else cols[0]
    try:
        for r in con.execute('select ' + idcol + ', ' + namecol + ' from knowledge_base').fetchall():
            names[str(r[0])] = str(r[1] or '')
    except Exception:
        pass
    return names


def list_kbs(con):
    names = kb_names(con)
    rows = con.execute('select kb_id, count(*) from kb_file group by kb_id order by kb_id').fetchall()
    out = []
    for kid, n in rows:
        out.append({'id': str(kid), 'name': names.get(str(kid), '') or ('知识库' + str(kid)), 'files': n})
    return out


def js_escape(s):
    return s.replace('</', '<\\/')


def write_kb_js(libs, out_path):
    parts = []
    for lib in libs:
        docs = [{'name': d['name'], 'text': js_escape(d['text'])} for d in lib['docs']]
        parts.append({'id': lib['id'], 'name': lib['name'], 'src': 'file', 'docs': docs})
    payload = json.dumps(parts, ensure_ascii=False)
    with io.open(out_path, 'w', encoding='utf-8') as f:
        f.write('/* 由 chatbox-import.py 生成：刷题站打开时自动挂载成知识库（只读）。重新导入会覆盖本文件。 */\n')
        f.write('window.__KBS__ = (window.__KBS__ || []).concat(' + payload + ');\n')
    return os.path.getsize(out_path)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--config', default=DEF_CONFIG)
    ap.add_argument('--db', default=DEF_DB)
    ap.add_argument('--out', default='知识库.js')
    ap.add_argument('--aiout', default='AI配置.js')
    ap.add_argument('--key', action='store_true', help='只导入 API 配置')
    ap.add_argument('--list', action='store_true', help='只列出 Chatbox 知识库')
    ap.add_argument('--kb', action='append', default=[], help='指定知识库 id，可重复')
    ap.add_argument('--only', default='', help='指定知识库 id，逗号分隔')
    ap.add_argument('--all', action='store_true', help='所有文件合成一个大库（总库）')
    ap.add_argument('--limit', type=int, default=0, help='每个库最多取多少个文件（0=不限）')
    ap.add_argument('--max-chars', type=int, default=60000, help='单个文件最多取多少字')
    ap.add_argument('--max-total', type=int, default=12000000, help='所有文件合计上限（字）')
    ap.add_argument('--name', default='Chatbox 总库', help='--all 时的库名')
    ap.add_argument('--pdf-pages', type=int, default=60, help='每个 PDF 最多读多少页（默认 60，PDF 很慢）')
    ap.add_argument('--skip-pdf', action='store_true', help='跳过 PDF，只导入 md/txt/docx（最快）')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()

    log('== 刷题站 · 从 Chatbox 导入 ==')
    cfg = load_config(a.config)
    if cfg is not None:
        write_ai_cfg(cfg, os.path.join(HERE, a.aiout))
    else:
        log('    跳过 API 配置（没读到 config.json，用 --config 指定路径）')

    if not os.path.exists(a.db):
        log('[!] 找不到 Chatbox 知识库数据库：' + a.db)
        log('    正常应该在 %APPDATA%\\xyz.chatboxapp.app\\chatbox-databases\\chatbox_kb.db')
        return
    con = sqlite3.connect('file:' + a.db.replace('\\', '/') + '?mode=ro&immutable=1', uri=True)
    if not kb_table(con):
        log('[!] 这个库里没有 kb_file 表')
        return
    kbs = list_kbs(con)
    log('Chatbox 里的知识库：')
    for k in kbs:
        log('   id ' + k['id'] + '  ' + k['name'] + '  ' + str(k['files']) + ' 个文件')
    if a.list or a.key:
        log('（--list / --key 模式：不导入文件）')
        return

    want = set()
    for x in a.kb:
        want.add(str(x))
    for x in (a.only or '').split(','):
        if x.strip():
            want.add(x.strip())
    rows = con.execute('select kb_id, filepath from kb_file order by kb_id, id').fetchall()
    picked = []
    for kid, fp in rows:
        if want and str(kid) not in want:
            continue
        picked.append((str(kid), fp))
    if not picked:
        log('[!] 没挑到文件（用 --kb 7 指定知识库 id，或 --list 看看有哪些）')
        return

    if a.all:
        libs = [{'id': 'chatbox-all', 'name': a.name, 'docs': []}]
    else:
        libs = []
        for k in kbs:
            libs.append({'id': 'chatbox-' + k['id'], 'name': 'Chatbox·' + k['name'], 'docs': []})
    idx = {}
    for lib in libs:
        idx[lib['id']] = lib
    per_kb_count = {}
    total = 0
    ok_files = 0
    stats = {'pdf-nolib': 0, 'pdf-skip': 0, 'empty': 0, 'missing': 0}
    for kid, fp in picked:
        if a.limit:
            per_kb_count[kid] = per_kb_count.get(kid, 0)
            if per_kb_count[kid] >= a.limit:
                continue
        target = idx.get('chatbox-all' if a.all else 'chatbox-' + kid)
        if target is None:
            continue
        name = os.path.basename(fp)
        if not os.path.exists(fp):
            stats['missing'] += 1
            continue
        t1 = time.time()
        txt, err = extract(fp, a.max_chars, a.pdf_pages, a.skip_pdf)
        if time.time() - t1 > 3:
            log('   （' + name[:40] + ' 用了 ' + str(round(time.time() - t1, 1)) + ' 秒）')
        if txt is None:
            stats[err if err in stats else 'empty'] += 1
            continue
        if total + len(txt) > a.max_total:
            log('[!] 已达到合计上限 ' + str(a.max_total) + ' 字，后面的文件跳过（要更多就调 --max-total）')
            break
        per_kb_count[kid] = per_kb_count.get(kid, 0) + 1
        target['docs'].append({'name': name, 'text': txt})
        total += len(txt)
        ok_files += 1
        if ok_files % 25 == 0:
            log('   …已处理 ' + str(ok_files) + ' 个文件 / ' + str(total) + ' 字')
    libs = [l for l in libs if l['docs']]
    if not libs:
        log('[!] 一个文件都没解析成功。原因统计：' + json.dumps(stats, ensure_ascii=False)
            + '（pdf-nolib=没装 pypdf；pdf-skip=你要求跳过 PDF；missing=原始文件已不在；empty=读出来是空的）')
        return
    if a.dry:
        log('（--dry：只统计不写文件）')
        return
    size = write_kb_js(libs, os.path.join(HERE, a.out))
    log('[OK] 写了 ' + a.out + '：' + str(len(libs)) + ' 个知识库 / ' + str(ok_files) + ' 个文件 / '
        + str(total) + ' 字 / ' + str(round(size / 1024.0 / 1024.0, 2)) + ' MB')
    for l in libs:
        log('   · ' + l['name'] + '：' + str(len(l['docs'])) + ' 个文件')
    if stats['pdf-nolib']:
        log('[i] 有 ' + str(stats['pdf-nolib']) + ' 个 PDF 没解析：先跑一句  pip install pypdf  再重新导入')
    if stats['missing']:
        log('[i] 有 ' + str(stats['missing']) + ' 个原始文件已经不在了（网盘没下载 / 挪走了），已跳过')
    if stats['pdf-skip']:
        log('[i] 按你的要求跳过了 ' + str(stats['pdf-skip']) + ' 个 PDF')
    log('完成。回到刷题站刷新页面（Ctrl+F5），打开「AI」就能看到这些知识库。')


if __name__ == '__main__':
    main()
