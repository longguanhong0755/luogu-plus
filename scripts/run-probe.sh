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
# R42：探针必须钉在软件渲染上。无 GPU 的机器上 GPU 进程会直接 FATAL 掉
# （整窗截图全白 / 视图不出帧），而**探针日志里看不到任何显式报错**——
# 脚本照常 exit=0，看起来"跑过了"，实际证据全是空的。
# 这组 flag 与当前在跑的探针实例（dev/probe/pr-v2，端口 9309）启动参数一致：
#   --disable-gpu + --use-angle=swiftshader  合成走 CPU，不碰 GPU 进程
#   --no-sandbox/--disable-gpu-sandbox        无 GPU 机上沙箱起不来，得放开
#   --disable-*-backgrounding/-timer-throttling  探针窗口被摆在屏幕外
#     (3200,120)，Chromium 会判它"被遮挡/不可见"从而冻结渲染进程与定时器，
#     动画和交互全停 —— 补上这三条才让离屏窗口保持正常响应。
# 需要真 GPU 时 LG_GPU=1 放开（默认关：探针要的是可复现，硬件合成各机器时机不同）。
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
# set -e 会让 exe 非零退出时直接掐掉脚本，底下的 exit= 根本没机会打印 ——
# 而"跑挂了"恰恰是最该被看见的情况。改成自己接退出码。
"$EXE" "${GPU_FLAGS[@]}" --lg-userdata="$(cygpath -w "$PROF")" "$@" >"$ROOT/$NAME.log" 2>&1 && rc=0 || rc=$?
echo "exit=$rc out=$OUTDIR"
