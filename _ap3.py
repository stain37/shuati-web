# -*- coding: utf-8 -*-
# 已废弃：这个脚本原来往 ai.js 里塞 window.aiSrcHits = function(h){...}
# 但 ai.js 底下已经有一个同名真函数 aiSrcHits(v)（把 {hits,ts} / 裸数组都认成数组），
# 顶层函数声明挂在全局对象上是可写的，被顶掉后 aiSrcNorm / aiSrcMergeIn 拿到对象就 .slice()，
# 报「(h || []).slice is not a function」，云同步整条失败（web178 已经踩过）。
# 现在调试入口叫 window.aiSrcDebugHits，代码已直接写在 ai.js 里，这里保留成空操作，
# 防止有人回头再跑一遍把 bug 塞回去。
import io, sys
p = "ai.js"
s = io.open(p, encoding="utf-8").read()
assert "window.aiSrcHits = function" not in s, "ai.js 里又出现了 window.aiSrcHits 覆盖真身，先修掉再跑"
if "window.aiSrcDebugHits" not in s:
    sys.stdout.write("ai.js 里没有 window.aiSrcDebugHits（可能被改过），本脚本不做任何事\n")
else:
    sys.stdout.write("ok：调试入口已是 window.aiSrcDebugHits，无需改动\n")
