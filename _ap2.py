import io
p="ai.js"; s=io.open(p,encoding="utf-8").read()
old="  aiSrcJump(ctx.hits.length, ctx.hits.map(h => aiSrcName(h)).slice(0, 4).join('\u3001'));"
new="  AI_SRC_HITS = ctx.hits.slice();\n" + old
assert s.count(old)==1, s.count(old)
s=s.replace(old,new)
# also clear hits when no hits
old2="    aiSrcJump(0, '');"
new2="    AI_SRC_HITS = [];\n    aiSrcJump(0, '');"
assert s.count(old2)==1
s=s.replace(old2,new2)
io.open(p,"w",encoding="utf-8").write(s); print("ok")
