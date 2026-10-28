import io
p="style.css"; s=io.open(p,encoding="utf-8").read()
old=".aisrc{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;max-height:26px;scrollbar-width:none}"
new=(".aisrc{display:flex;flex-wrap:wrap;align-items:center;gap:6px;overflow:visible;max-height:none}\n"
 + "/* 参考资料那一行以前被压成单行横滑、字被切掉，看着像坏了（web178 第 ⑧ 条）；现在正常换行 */\n"
 + ".aisrc .aitag{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"
 + "/* 「📎 资料 N」点开的浮层（第 ⑦ 条） */\n"
 + ".srcpop{position:fixed;z-index:9992;width:340px;max-height:60vh;overflow:auto;background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 36px rgba(16,24,40,.2);padding:6px}\n"
 + ".srcpop-h{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--sub);padding:6px 8px 8px}\n"
 + ".srcpop-x{cursor:pointer;padding:0 4px;font-size:13px;color:var(--sub)}\n"
 + ".srcpop-x:hover{color:var(--text)}\n"
 + ".srcpop-i{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:8px;cursor:pointer;color:var(--text)}\n"
 + ".srcpop-i:hover{background:var(--bg2,#f6f7fb)}\n"
 + ".srcpop-i b{display:block;font-size:12.5px;font-weight:600;margin-bottom:2px;color:var(--primary)}\n"
 + ".srcpop-i span{display:block;font-size:12px;color:var(--sub);line-height:1.5;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}\n"
 + ".srcsheet{max-width:760px;width:calc(100vw - 32px);max-height:82vh;display:flex;flex-direction:column}\n"
 + ".srcsheet-h{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;padding:12px 14px;border-bottom:1px solid var(--line)}\n"
 + ".srcsheet-x{margin-left:auto;cursor:pointer;color:var(--sub);font-size:15px;padding:0 4px}\n"
 + ".srcsheet-x:hover{color:var(--text)}\n"
 + ".srcsheet-b{padding:12px 14px;overflow:auto;line-height:1.8}")
assert s.count(old)==1
s=s.replace(old,new)
io.open(p,"w",encoding="utf-8").write(s); print("ok")
