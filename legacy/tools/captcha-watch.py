# -*- coding: utf-8 -*-
"""盯住"批量添加账号"吐出来的验证码图，识别后把答案回填给流程。

用法：
    python captcha-watch.py <captcha.png> <state.json> [answer.txt]

流程每 1.2 秒把当前验证码覆盖写到 <captcha.png>，状态写到 <state.json>；
本脚本认出**新图**（按内容哈希去重）后把答案写进 <answer.txt>，流程每秒
轮询该文件取答案。状态变成 done 后自动退出。

空白图会跳过：流程刚提交完上一轮时页面还在换图，抓到的是一张占位图，
识别它只会得到垃圾答案、白费一次尝试。
"""
import hashlib
import json
import os
import sys
import time

import ddddocr

if len(sys.argv) < 3:
    print("usage: captcha-watch.py <captcha.png> <state.json> [answer.txt]")
    sys.exit(2)

CAP = sys.argv[1]
JOB = sys.argv[2]
ANS = sys.argv[3] if len(sys.argv) > 3 else os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")), "LuoguLab", "captcha-answer.txt"
)
BLANK_MAX = 3000  # 小于这个字节数的 PNG 是占位/空白图，别识别

ocr = ddddocr.DdddOcr(show_ad=False)
seen = {}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def state():
    try:
        with open(JOB, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


log("watching %s" % CAP)
while True:
    d = state()
    if d.get("phase") == "done":
        log("batch phase=done -> exit")
        break
    try:
        with open(CAP, "rb") as f:
            blob = f.read()
    except Exception:
        time.sleep(0.4)
        continue
    if len(blob) < BLANK_MAX:
        time.sleep(0.4)
        continue
    h = hashlib.md5(blob).hexdigest()
    if h in seen:
        time.sleep(0.4)
        continue
    seen[h] = True
    try:
        ans = (ocr.classification(blob) or "").strip()
    except Exception as e:
        log("ocr error: %s" % e)
        time.sleep(1)
        continue
    if len(ans) < 3:
        log("low-confidence %r -> skip" % ans)
        time.sleep(0.4)
        continue
    log("index=%s captcha=%r -> writing answer" % (d.get("index"), ans))
    try:
        with open(ANS, "w", encoding="utf-8") as f:
            f.write(ans)
    except Exception as e:
        log("write error: %s" % e)
    time.sleep(0.4)
