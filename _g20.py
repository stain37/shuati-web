import io
s=io.open("collection.js",encoding="utf-8").read().splitlines()
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(1217,min(1275,len(s)))))
