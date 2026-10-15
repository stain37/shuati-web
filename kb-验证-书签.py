# -*- coding: utf-8 -*-
"""验证：知识库用的 PDF 书签有多细（含嵌套子书签）。
用来判断「考点 → 资料对应页码」能定位到「章」还是「节」。

用法：  python kb-验证-书签.py "C:\\Users\\chen\\Desktop\\精编大合集！"
        （不带参数默认扫 站点目录\\资料\\）
"""
import os, sys, io, logging

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# 压掉 pypdf 的一堆 "Ignoring wrong pointing object" 噪音
for nm in ('pypdf', 'PyPDF2'):
    try:
        logging.getLogger(nm).setLevel(logging.CRITICAL)
    except Exception:
        pass


def walk_outline(reader, items, depth, out):
    """递归遍历书签，收集 (层级, 标题, 0基页码)。"""
    for it in items:
        try:
            pg = reader.get_destination_page_number(it)
        except Exception:
            pg = -1
        if not isinstance(pg, int):
            pg = -1
        title = str(getattr(it, 'title', '') or '').strip()
        if title:
            out.append((depth, title, pg))
        try:
            if it.has_children():
                walk_outline(reader, list(it.children()), depth + 1, out)
        except Exception:
            pass


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '资料')
    if not os.path.isdir(folder):
        print('目录不存在：' + folder); return
    try:
        from pypdf import PdfReader
    except Exception:
        try:
            from PyPDF2 import PdfReader
        except Exception:
            print('需要先装 pypdf：  pip install pypdf'); return

    pdfs = []
    for cur, dirs, files in os.walk(folder):
        for fn in files:
            if fn.lower().endswith('.pdf'):
                pdfs.append(os.path.join(cur, fn))
    if not pdfs:
        print('这个目录里没有 PDF：' + folder); return
    # 小的先来，大的后跑（避免一个超大文件卡住看不到前面的结果）
    pdfs.sort(key=lambda p: os.path.getsize(p))

    print('扫描：' + folder)
    print('=' * 72)
    for p in pdfs:
        size_mb = os.path.getsize(p) / 1024.0 / 1024.0
        name = os.path.basename(p)
        try:
            r = PdfReader(p)
            npages = len(r.pages)
        except Exception as e:
            print('× %s（%.1f MB）　读不了：%s' % (name, size_mb, e)); sys.stdout.flush(); continue
        out = []
        try:
            top = r.outline or []
        except Exception:
            top = []
        walk_outline(r, top, 0, out)
        tmp = {}
        for d, t, pg in out:
            tmp[d] = tmp.get(d, 0) + 1
        maxd = max(tmp) if tmp else -1
        # 各层数量
        layers = ' / '.join('第%d层 %d 个' % (d + 1, tmp[d]) for d in sorted(tmp))
        print('')
        print('■ %s　%.1f MB，%d 页' % (name, size_mb, npages))
        print('  书签总数：%d　%s' % (len(out), ('（' + layers + '）') if layers else ''))
        if not out:
            print('  → 没有书签，只能当「整册一篇」。')
            sys.stdout.flush(); continue
        # 最深一层抽样（这才是能定位到多细的关键）
        if maxd >= 1:
            deep = [(t, pg) for d, t, pg in out if d == maxd and pg >= 0]
            print('  最细一层（第 %d 层）共 %d 项，抽样：' % (maxd + 1, len(deep)))
            for t, pg in deep[:6]:
                print('      第 %3d 页　%s' % (pg + 1, t))
            if len(deep) > 6:
                print('      … 共 %d 项' % len(deep))
            print('  → 可定位到「节」级，粒度够细 ✔')
        else:
            print('  只有顶层（章级）：')
            for d, t, pg in out[:6]:
                print('      第 %3d 页　%s' % (pg + 1, t))
            if len(out) > 6:
                print('      … 共 %d 章' % len(out))
            print('  → 只能定位到「章」级')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
