#!/usr/bin/env bash
# 对【部署产物】（桌面 LuoguLab.exe）跑探针，使用隔离 profile，不打扰用户正在用的实例。
# 用法: bash scripts/run-probe.sh <名字> <输出目录> [--lg-xxx ...]
#   名字      探针 profile 名（probe/pr-<名字>），每个探针用独立 profile 互不干扰
#   输出目录  证据落盘目录
# 环境: LG_EXE 可覆盖 exe 路径；LG_PREP=1（默认）预置真实配置+账号+重复壁纸
set -e
# R42：宿主环境（IDE / AI 会话 / 某些启动器）会注入 ELECTRON_RUN_AS_NODE=1，
# 此时 Electron 二进制整个退化成 node：所有 --lg-* 被当成 node CLI 选项，
# 直接报 "bad option: --lg-xxx" 并退出——探针看起来"跑了"，实际一次都没启动。
# 这一条必须在调用 exe 之前清掉。
unset ELECTRON_RUN_AS_NODE
NAME="$1"; shift
OUTDIR="$1"; shift || true
EXE="${LG_EXE:-D:/workspace/luogu++/app/LuoguLab.exe}"
ROOT=/d/workspace/luogu++/dev/probe
PROF="$ROOT/pr-$NAME"
REAL="$APPDATA/LuoguLab"
mkdir -p "$PROF" "$OUTDIR"
# 预置用户真实配置（只读拷贝，绝不写回真实 profile）
[ -f "$PROF/luogu-glass-config.json" ] || cp "$REAL/luogu-glass-config.json" "$PROF/" 2>/dev/null || true
[ -f "$PROF/accounts.json" ] || cp "$REAL/accounts.json" "$PROF/" 2>/dev/null || true
# 壁纸集合：3 份同内容（验去重）+ 不同内容 1 份
if [ ! -d "$PROF/wallpapers" ]; then
  mkdir -p "$PROF/wallpapers"
  SRCWP=$(ls "$REAL/wallpapers/"* 2>/dev/null | head -1)
  if [ -n "$SRCWP" ]; then
    cp "$SRCWP" "$PROF/wallpapers/a-dupe1.webp"
    cp "$SRCWP" "$PROF/wallpapers/b-dupe2.webp"
    cp "$SRCWP" "$PROF/wallpapers/c-orig.webp"
  fi
fi
echo "probe=$NAME profile=$PROF exe=$EXE"
"$EXE" --lg-userdata="$(cygpath -w "$PROF")" "$@" >"$ROOT/$NAME.log" 2>&1
echo "exit=$? out=$OUTDIR"
