#!/usr/bin/env bash
# 把源码树同步到开发运行目录（D:\workspace\luogu++\dev）。
# 运行目录必须在 workspace 之外——workspace 树内执行任何 exe 都会段错误。
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST=/d/workspace/luogu++/dev
mkdir -p "$DST/src/chrome" "$DST/src/settings" "$DST/src/history" "$DST/src/popup" "$DST/src/home" "$DST/src/dock"
cp "$SRC/src/inject.js" "$SRC/src/inject.css" "$SRC/src/ext.css" "$SRC/src/common.css" "$SRC/src/material.css" "$SRC/src/material-lint.js" "$SRC/src/icons.js" "$DST/src/"
cp "$SRC/src/chrome/"* "$DST/src/chrome/"
cp "$SRC/src/settings/"* "$DST/src/settings/"
cp "$SRC/src/history/"* "$DST/src/history/"
cp "$SRC/src/popup/"* "$DST/src/popup/"
cp "$SRC/src/home/"* "$DST/src/home/"
cp "$SRC/src/dock/"* "$DST/src/dock/"
# main.js / preload / package.json 最后拷：部署版的 watcher 一看到 main.js 变动
# 就 relaunch，src 必须已经就位（曾经"拷 main.js 在前、material.css 在后"，
# 重启撞上半成品 → ENOENT 起不来）。
cp "$SRC/main.js" "$DST/main.js"
cp "$SRC"/preload-*.js "$SRC/package.json" "$DST/"
# assets 漏拷过一次：外壳里的 <img src="../../assets/..."> 会退化成破图占位符，
# 表现就是"左上角图标渲染异常"。这里补上，别再漏。
mkdir -p "$DST/assets"
cp "$SRC/assets/"* "$DST/assets/"
# 常驻热部署目标：桌面部署版的散文件目录（resources/app）。
# 部署版由 resources/hot-apply.txt 进入热应用模式，这里同步后它的 watcher
# 直接热生效（main.js/preload 由它自己拷回并自动重启，这里只是兜底对齐）。
DEPLOY=/d/workspace/luogu++/app/resources/app
if [ -d "$DEPLOY" ]; then
  mkdir -p "$DEPLOY/src/chrome" "$DEPLOY/src/settings" "$DEPLOY/src/history" "$DEPLOY/src/popup" "$DEPLOY/src/home" "$DEPLOY/src/dock" "$DEPLOY/assets"
  cp "$SRC/src/inject.js" "$SRC/src/inject.css" "$SRC/src/ext.css" "$SRC/src/common.css" "$SRC/src/material.css" "$SRC/src/material-lint.js" "$SRC/src/icons.js" "$DEPLOY/src/"
  cp "$SRC/src/chrome/"* "$DEPLOY/src/chrome/"
  cp "$SRC/src/settings/"* "$DEPLOY/src/settings/"
  cp "$SRC/src/history/"* "$DEPLOY/src/history/"
  cp "$SRC/src/popup/"* "$DEPLOY/src/popup/"
  cp "$SRC/src/home/"* "$DEPLOY/src/home/"
    cp "$SRC/src/dock/"* "$DEPLOY/src/dock/"
  cp "$SRC/assets/"* "$DEPLOY/assets/"
  # 同上：main.js/preload 放最后（relaunch 触发点）
  cp "$SRC/main.js" "$DEPLOY/main.js"
  cp "$SRC"/preload-*.js "$SRC/package.json" "$DEPLOY/"
  echo "synced → $DEPLOY"
fi
cd "$DST"
for f in main.js preload-chrome.js preload-popup.js preload-page.js preload-dock.js src/inject.js src/material-lint.js src/chrome/chrome.js src/settings/settings.js src/history/history.js src/home/home.js src/popup/popup.js src/dock/dock.js; do
  [ -f "$f" ] && node -e "new Function(require('fs').readFileSync('$f','utf8'))" && echo "ok  $f"
done
echo "synced → $DST"
