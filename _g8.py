import io
L=io.open("app.js",encoding="utf-8").read().splitlines()
i=[k for k,l in enumerate(L) if "async function attAdd" in l][0]
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,L[k].rstrip()) for k in range(i+40,min(i+120,len(L)))))
