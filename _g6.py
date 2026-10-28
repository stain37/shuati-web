import io
L=io.open("collection.js",encoding="utf-8").read().splitlines()
i=[k for k,l in enumerate(L) if "function blkHover" in l][0]
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,L[k].rstrip()) for k in range(i,min(i+95,len(L)))))
