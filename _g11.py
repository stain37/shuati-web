import io
s=io.open("chat.js",encoding="utf-8").read().splitlines()
hits=[k+1 for k,l in enumerate(s) if ("出题" in l or "planQuiz" in l or "isChatCommand" in l)]
import collections
# print clusters
prev=None
for h in hits:
    if prev is None or h-prev>3: print("---")
    print(h, s[h-1].strip()[:150])
    prev=h
