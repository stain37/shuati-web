# -*- coding: utf-8 -*-
"""验证：知识库用的 PDF 是否有书签、能不能拿到页码。
把 PDF 放进 资料\（或任意目录），再跑：  python kb-验证-书签.py 目录
逐个 PDF 打印：有没有书签、顶层书签数、每节标题和起始页码。
用来确认「考点 → 资料对应页码」这个功能到底能不能落地。"""
import os, sys, io
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

def outline_top(reader):
    out = []
    try:
        items = reader.outline or []
    except Exception:
        return out
    for it in items:
        try:
            pg = reader.get_destination_page_number(it)
        except Exception:
            continue
        title = str(getattr(it, 'title', '') or '').strip()
        if title and isinstance(pg, int) and pg >= 0:
            out.append((title, pg))
    out.sort(key=lambda x: x[1])
    return out

def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '资料')
    if not os.path.isdir(folder):
        print('目录不存在：' + folder); return
    pdfs = []
    for cur, dirs, files in os.walk(folder):
        for fn in files:
            if fn.lower().endswith('.pdf'):
                pdfs.append(os.path.join(cur, fn))
    if not pdfs:
        print('在这个目录里没找到 PDF：' + folder)
        print('把配套 PDF 放进来再跑，就能看每个 PDF 的书签 / 页码。')
        return
    try:
        from pypdf import PdfReader
    except Exception:
        try:
            from PyPDF2 import PdfReader
        except Exception:
            print('需要先装 pypdf：  pip install pypdf'); return
    ok = 0
    for p in sorted(pdfs):
        name = os.path.basename(p)
        try:
            r = PdfReader(p)
        except Exception as e:
            print('× %s　读不了（%s）' % (name, e)); continue
        bms = outline_top(r)
        npages = len(r.pages)
        if len(bms) >= 2:
            ok += 1
            print('√ %s　%d 页，%d 个书签，可按页码定位' % (name, npages, len(bms)))
            for t, pg in bms[:5]:
                print('      第 %3d 页　%s' % (pg + 1, t))
            if len(bms) > 5:
                print('      … 共 %d 节' % len(bms))
        else:
            print('△ %s　%d 页，书签只有 %d 个（不够切，页码定位不准）' % (name, npages, len(bms)))
    print('')
    print('结论：%d / %d 个 PDF 有足够书签，可做「考点→页码」。' % (ok, len(pdfs)))

if __name__ == '__main__':
    main()
