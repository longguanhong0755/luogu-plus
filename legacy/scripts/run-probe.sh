#!/usr/bin/env bash
# 对【部署产物】或【源码模式 Electron】跑单个探针，使用隔离 profile。
# 用法: bash scripts/run-probe.sh <名字> <输出目录> [--lg-xxx ...]
# 环境: LG_EXE / LG_APP_DIR / LG_APP_ARG / LG_PROBE_ROOT / LG_SKIP_REAL_PROFILE
set -e
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS
NAME="$1"; shift
OUTDIR="$1"; shift || true
cd "$(dirname "$0")/.."
REPO=$(pwd)
to_unix() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi
}
to_win() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}
ROOT="$(to_unix "${LG_PROBE_ROOT:-$(cd "$REPO/.." && pwd)/dev/probe}")"
EXE="$(to_unix "${LG_EXE:-$(cd "$REPO/.." && pwd)/app/LuoguLab.exe}")"
APP_DIR="$(to_unix "${LG_APP_DIR:-$(dirname "$EXE")}")"
APP_ARG="${LG_APP_ARG:-}"
PROF="$ROOT/pr-$NAME"
REAL="$APPDATA/LuoguLab"
mkdir -p "$PROF" "$OUTDIR"
# 预置用户真实配置（只读拷贝，绝不写回真实 profile）。CI/沙箱可整体跳过。
if [ "${LG_SKIP_REAL_PROFILE:-0}" != "1" ]; then
  [ -f "$PROF/luogu-glass-config.json" ] || cp "$REAL/luogu-glass-config.json" "$PROF/" 2>/dev/null || true
  [ -f "$PROF/accounts.json" ] || cp "$REAL/accounts.json" "$PROF/" 2>/dev/null || true
  if [ ! -d "$PROF/wallpapers" ]; then
    mkdir -p "$PROF/wallpapers"
    SRCWP=$(ls "$REAL/wallpapers/"* 2>/dev/null | head -1)
    if [ -n "$SRCWP" ]; then
      cp "$SRCWP" "$PROF/wallpapers/a-dupe1.webp"
      cp "$SRCWP" "$PROF/wallpapers/b-dupe2.webp"
      cp "$SRCWP" "$PROF/wallpapers/c-orig.webp"
    fi
  fi
fi
echo "probe=$NAME profile=$PROF exe=$EXE"
if [ "${LG_GPU:-0}" != "1" ]; then
  GPU_FLAGS=(
    --no-sandbox
    --disable-gpu-sandbox
    --disable-gpu
    --use-angle=swiftshader
    --disable-renderer-backgrounding
    --disable-backgrounding-occluded-windows
    --disable-background-timer-throttling
  )
else
  GPU_FLAGS=()
fi
APP_ARGS=()
[ -n "$APP_ARG" ] && APP_ARGS+=("$APP_ARG")
cd "$APP_DIR"
"$EXE" "${APP_ARGS[@]}" "${GPU_FLAGS[@]}" --lg-userdata="$(to_win "$PROF")" "$@" >"$ROOT/$NAME.log" 2>&1 && rc=0 || rc=$?
echo "exit=$rc out=$OUTDIR"
