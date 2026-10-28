import io
p="ai.js"; s=io.open(p,encoding="utf-8").read()
old="window.aiSrcPanel = aiSrcPanel;\nwindow.aiSrcModal = aiSrcModal;"
new=("window.aiSrcPanel = aiSrcPanel;\nwindow.aiSrcModal = aiSrcModal;\n"
     "/* 调试/探针用：直接塞一批 hits，看资料面板长什么样 */\n"
     "window.aiSrcHits = function (h) { AI_SRC_HITS = (h || []).slice(); };")
assert s.count(old)==1
s=s.replace(old,new); io.open(p,"w",encoding="utf-8").write(s); print("ok")
