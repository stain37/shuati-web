# -*- coding: utf-8 -*-
"""检查一个文件夹里所有 PDF：页数 / 能不能抽出正文。用法： python kb-检查目录.py "目录" """
import os, sys, io, logging
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
for nm in ('pypdf', 'PyPDF2'):
    try:
        logging.getLogger(nm).setLevel(logging.CRITICAL)
    except Exception:
        pass

def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else '.'
    try:
        from pypdf import PdfReader
    except Exception:
        print('需要 pypdf： pip install pypdf'); return
    pdfs = []
    for cur, dirs, files in os.walk(folder):
        for fn in files:
            if fn.lower().endswith('.pdf'):
                pdfs.append(os.path.join(cur, fn))
    pdfs.sort()
    print('目录：' + folder)
    print('共 %d 个 PDF' % len(pdfs))
    print('-' * 84)
    bad = []
    total_pages = 0
    for p in pdfs:
        name = os.path.basename(p)
        mb = os.path.getsize(p) / 1024.0 / 1024.0
        try:
            r = PdfReader(p)
            npg = len(r.pages)
            total_pages += npg
            txt = ''
            for pg in list(r.pages)[:3]:
                txt += (pg.extract_text() or '')
            n = len(txt.strip())
            if n < 50:
                bad.append(name)
                flag = '× 抽不出正文'
            elif n < 300:
                flag = '△ 正文偏少'
            else:
                flag = '✔'
            print('  %-46s %4d页 %5.1fMB %s (%d字/前3页)' % (name[:46], npg, mb, flag, n))
        except Exception as e:
            bad.append(name)
            print('  %-46s 读不了：%s' % (name[:46], e))
        sys.stdout.flush()
    print('-' * 84)
    print('总页数：%d' % total_pages)
    if bad:
        print('⚠ 需要 OCR 的：%d 个' % len(bad))
        for b in bad:
            print('   - ' + b)
    else:
        print('全部有正文，不用 OCR。')

if __name__ == '__main__':
    main()
