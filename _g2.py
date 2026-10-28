import io
L=io.open("app.js",encoding="utf-8").read().splitlines()
n=len(L); print("lines", n)
start=max(0,n-90)
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,L[k].rstrip()) for k in range(start,n)))
