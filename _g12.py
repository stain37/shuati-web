import io
s=io.open("chat.js",encoding="utf-8").read().splitlines()
out=[]
for k,l in enumerate(s):
    if ("出题" in l or "planQuiz" in l or "isChatCommand" in l or "quiz" in l and ("reg" in l or "test" in l)):
        out.append("%d: %s"%(k+1,l.strip()[:160]))
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join(out))
print(len(out))
