import io
s=io.open("collection.js",encoding="utf-8").read().splitlines()
out=[]
for k,l in enumerate(s):
    if any(x in l for x in ["rich-img","mdImg","'IMG'","tagName === 'IMG'","data-src","=W"]):
        out.append("%d: %s"%(k+1,l.strip()[:160]))
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join(out))
print(len(out))
