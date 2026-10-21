#!/usr/bin/env bash
# 打包便携版。
#
# 为什么不直接对开发目录打包：本机 electron-packager 的 --ignore 正则不生效，
# 而开发目录里有 edist/（约 250MB 的 Electron 运行时），会被整包进 app.asar。
# 所以先把干净源码汇集到 LuoguLabBuild，再在那里打包。
#
# 另一个坑：packager 会去 cwd 找 node_modules/electron/package.json，因此必须
# 显式传 --electron-version。
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD=/d/workspace/luogu++/build
OUT=/d/workspace/luogu++/pkg
PACKAGER="$SRC/node_modules/@electron/packager/bin/electron-packager.mjs"
VERSION="$(grep -m1 '"version"' "$SRC/package.json" | sed 's/.*: *"\([^"]*\)".*/\1/')"
[ -n "$VERSION" ] || { echo "cannot read version from package.json"; exit 1; }

rm -rf "$BUILD"
mkdir -p "$BUILD/src" "$BUILD/assets" "$BUILD/docs"
cp "$SRC/main.js" "$SRC/package.json" "$BUILD/"
cp "$SRC"/preload-*.js "$BUILD/"
# 整个 src 目录进包（不用名单）：名单制下每加一个 src 文件就要记得改
# 这里，漏一次就是"新装的用户少一个文件"。此前这份名单就漏过
# material.css / common.css / dock/ / icons.js —— 打出来的包主题是坏的。
cp -r "$SRC/src/." "$BUILD/src/"
cp "$SRC/assets/"* "$BUILD/assets/"
cp "$SRC/docs/FINAL-REPORT.md" "$BUILD/docs/"
[ -f "$SRC/docs/使用说明.txt" ] && cp "$SRC/docs/使用说明.txt" "$BUILD/"

cd "$BUILD"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node "$PACKAGER" . LuoguLab \
  --platform=win32 --arch=x64 --out="$OUT" --overwrite --asar \
  --icon=assets/icon.ico --app-version="$VERSION" --electron-version=39.8.10

# 辅助脚本必须落在 asar **外面**：bat 要被双击、py 要被系统 python 读，
# 塞进 asar 后外部进程打不开。
mkdir -p "$OUT/LuoguLab-win32-x64/tools"
cp "$SRC/tools/"* "$OUT/LuoguLab-win32-x64/tools/"

# 桌面部署目录里有一份松散的使用说明（不进 asar），打包时顺带放到 Pkg 根，
# 否则部署后它永远停在旧版本号（踩过）。
[ -f "$SRC/docs/使用说明.txt" ] && cp "$SRC/docs/使用说明.txt" "$OUT/LuoguLab-win32-x64/"

echo "packaged v$VERSION → $OUT/LuoguLab-win32-x64"
echo "tools → $OUT/LuoguLab-win32-x64/tools"
