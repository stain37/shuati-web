import io
s=io.open("ai.js",encoding="utf-8").read().splitlines()
i=[k for k,l in enumerate(s) if "function aiSrcJump" in l][0]
j=[k for k,l in enumerate(s) if "function aiPaintSrc" in l][0]
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("AISRCJUMP\n"+"\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(i,min(i+40,len(s))))+"\n\nPAINTSRC\n"+"\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(j,min(j+50,len(s)))))
