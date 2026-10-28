import io
L=io.open("collection.js",encoding="utf-8").read().splitlines()
n=len(L)
i=[k for k,l in enumerate(L) if "function ctxMenu" in l or "function ctxShow" in l or "function ctxOpen" in l]
print("lines",n,"hits",i[:5])
s=i[0] if i else 0
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,L[k].rstrip()) for k in range(s,min(s+60,n))))
