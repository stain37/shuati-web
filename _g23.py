import io
s=io.open("ai.js",encoding="utf-8").read().splitlines()
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(1081,1180)))
