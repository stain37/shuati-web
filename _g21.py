import io
s=io.open("collection.js",encoding="utf-8").read().splitlines()
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(120,160)))
io.open(r"C:\Users\chen\Desktop\工作1\_l2.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(60,90)))
io.open(r"C:\Users\chen\Desktop\工作1\_l3.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(320,370)))
