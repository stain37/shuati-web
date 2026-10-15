# -*- coding: utf-8 -*-
"""抽查「分开的精编版」：每个小 PDF 的页数 / 书签 / 能不能抽出正文。
用来确认「一篇一个文件」这套做「考点→页码」是否靠谱。

用法：  python kb-验证-精编版.py
"""
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

DESKTOP = r'C:\Users\chen\Desktop'
FOLDERS = [
    ('外科', os.path.join(DESKTOP, '外科精编版')),
    ('内科', os.path.join(DESKTOP, '内科精编版本')),
    ('生化', os.path.join(DESKTOP, '生化精编版本')),
    ('生理', os.path.join(DESKTOP, '27精编生理合集【不带导图】')),
]


def main():
    try:
        from pypdf import PdfReader
    except Exception:
        try:
            from PyPDF2 import PdfReader
        except Exception:
            print('需要先装 pypdf：  pip install pypdf'); return

    for label, folder in FOLDERS:
        if not os.path.isdir(folder):
            print('× 找不到目录：' + folder); continue
        pdfs = sorted([os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith('.pdf')])
        print('=' * 72)
        print('【%s】%s' % (label, folder))
        print('  共 %d 个 PDF' % len(pdfs))
        if not pdfs:
            continue
        # 抽查：头 2 个 + 中间 1 个 + 尾 1 个
        picks = pdfs[:2] + ([pdfs[len(pdfs) // 2]] if len(pdfs) > 2 else []) + ([pdfs[-1]] if len(pdfs) > 1 else [])
        tot_pages = 0
        bad = 0
        for p in pdfs:
            try:
                r = PdfReader(p)
                npg = len(r.pages)
                tot_pages += npg
            except Exception:
                bad += 1
        print('  总页数：%d' % tot_pages)
        print('  抽查明细：')
        for p in picks:
            name = os.path.basename(p)
            try:
                r = PdfReader(p)
                npg = len(r.pages)
                txt = ''
                for pg in list(r.pages)[:3]:
                    txt += (pg.extract_text() or '')
                nb = 0
                try:
                    nb = len(r.outline or [])
                except Exception:
                    nb = 0
                flag = '✔ 有正文' if len(txt.strip()) > 50 else '× 抽不出正文（可能是扫描图）'
                print('    %-42s %3d 页　书签 %d 个　%s（前3页 %d 字）' % (name[:42], npg, nb, flag, len(txt.strip())))
            except Exception as e:
                print('    %-42s 读不了：%s' % (name[:42], e))
            sys.stdout.flush()
        if bad:
            print('  ⚠ 有 %d 个 PDF 读不了' % bad)
    print('')
    print('结论：看抽查里有没有「× 抽不出正文」——有的话那批得先 OCR 才进知识库。')


if __name__ == '__main__':
    main()
