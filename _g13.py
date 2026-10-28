import io
s=io.open("chat.js",encoding="utf-8").read().splitlines()
out=[]
for k,l in enumerate(s):
    if any(x in l for x in ["skNow","SKILLS.active","没选技能","guessMode","quizTitle","TAG[guessMode"]):
        out.append("%d: %s"%(k+1,l.rstrip()[:170]))
io.open(r"C:\Users\chen\Desktop\工作1\_l.txt","w",encoding="utf-8").write("\n".join(out))
