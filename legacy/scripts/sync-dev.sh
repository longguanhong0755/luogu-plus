#!/usr/bin/env bash
# 把源码树同步到开发运行目录（D:\workspace\luogu++\dev），
# 并顺带对齐桌面部署版的散文件目录（app/resources/app）。
# 运行目录必须在 workspace 之外——workspace 树内执行任何 exe 都会段错误。
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST=/d/workspace/luogu++/dev

# ---------- 同步一个目录的 src（整目录复制，不用名单）----------
# 为什么不用名单：名单制下每加一个 src 文件就要记得改这里，漏一次就是
# "新装的用户少一个文件"——build-dist.sh 就这么漏过 material.css /
# common.css / dock/ / icons.js，打出来的包是坏的。整目录复制从根上
# 消掉这类漏拷。
# "cp -r src/." 而不是 "cp -r src"：后者会在目标下再套一层 src/。
sync_src() {
  local dst="$1"
  mkdir -p "$dst/src"
  cp -r "$SRC/src/." "$dst/src/"
  # assets 漏拷过一次：外壳里的 <img src="../../assets/..."> 会退化成破图
  # 占位符，表现是"左上角图标渲染异常"。这里跟着 src 一起拷。
  mkdir -p "$dst/assets"
  cp -r "$SRC/assets/." "$dst/assets/" 2>/dev/null || true
  # main.js / preload / package.json 最后拷：部署版的 watcher 一看到
  # main.js 变动就 relaunch，src 必须已经就位（曾经"拷 main.js 在前、
  # material.css 在后"，重启撞上半成品 → ENOENT 起不来）。
  cp "$SRC/main.js" "$dst/main.js"
  cp "$SRC"/preload-*.js "$SRC/package.json" "$dst/"
}

sync_src "$DST"

# 常驻热部署目标：桌面部署版的散文件目录（resources/app）。
# 部署版由 resources/hot-apply.txt 进入热应用模式，这里同步后它的 watcher
# 直接热生效（main.js/preload 由它自己拷回并自动重启，这里只是兜底对齐）。
DEPLOY=/d/workspace/luogu++/app/resources/app
if [ -d "$DEPLOY" ]; then
  sync_src "$DEPLOY"
  echo "synced → $DEPLOY"
fi

cd "$DST"
for f in main.js preload-chrome.js preload-popup.js preload-page.js preload-dock.js src/inject.js src/material-lint.js src/chrome/chrome.js src/settings/settings.js src/history/history.js src/home/home.js src/popup/popup.js src/dock/dock.js; do
  [ -f "$f" ] && node -e "new Function(require('fs').readFileSync('$f','utf8'))" && echo "ok  $f"
done
echo "synced → $DST"
