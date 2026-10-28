import io
s=io.open("collection.js",encoding="utf-8").read().splitlines()
i=[k for k,l in enumerate(s) if "tag === 'p'" in l or "if (tag === 'p'" in l]
print([x+1 for x in i][:5])
j=i[0]
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join("%d: %s"%(k+1,s[k].rstrip()) for k in range(j-2,min(j+30,len(s)))))
