#!/usr/bin/env bash
# ============================================================
# Luogu++ — 一键回归（本地 / CI 共用）
# 用法: bash scripts/run-all-probes.sh [输出目录]
#
# 做什么：起一个隔离的测试实例 + 一个本地测试站，把 6 个 CDP 探针全跑一遍：
#   probe-v316.cjs           9 条  外壳与设置页
#   probe-glass.cjs         14 条  全站玻璃 / 排除名单 / 本站开关
#   probe-navhist.cjs        4 条  长按后退/前进的访问历史栈
#   probe-ipc-contract.cjs 194 条  IPC 契约
#   probe-design.cjs         5 条  设计令牌运行时量值
#   probe-ux.cjs            29 条  面板 / 焦点 / 键盘 / 几何 / F11 / R51 交互
#
# 环境变量（全部有本地默认值，CI 只覆盖路径与模式）：
#   LG_EXE            Electron 可执行文件（默认 <repo>/../app/LuoguLab.exe）
#   LG_APP_DIR        应用目录（默认 <repo>/../app；源码模式为仓库根）
#   LG_APP_ARG        传给 Electron 的应用参数（默认空；源码模式传 "."）
#   LG_PROBE_ROOT     探针输出/profile 根目录
#   LG_TESTPAGE       测试页（默认 dev/probe/audit/gxtest/index.html，
#                     找不到时回退到仓库 test/fixtures/gxtest/index.html）
#   LG_OUT / LG_LOG / LG_PROFILE
#   LG_READY_TIMEOUT  CDP 就绪等待秒数（默认 40，CI 建议 120）
#   LG_WINDOW_MODE    hidden（默认）/ livetest（透明、无可见窗口、输入真实）
#   LG_DEV            1（默认）传 --lg-dev；CI 设 0
#   LG_SERVE          python（默认，若存在）/ node
#   LG_PROBES         空格分隔的探针子集
#   PROBE_PORT / WEB_PORT
# ============================================================
set -u
cd "$(dirname "$0")/.."
REPO=$(pwd)

to_unix() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi
}
to_win() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

PROBE_ROOT="$(to_unix "${LG_PROBE_ROOT:-$(cd "$REPO/.." && pwd)/dev/probe}")"
APP_DIR="$(to_unix "${LG_APP_DIR:-$(cd "$REPO/.." && pwd)/app}")"
EXE="$(to_unix "${LG_EXE:-$APP_DIR/LuoguLab.exe}")"
APP_ARG="${LG_APP_ARG:-}"
OUT="$(to_unix "${1:-${LG_OUT:-$PROBE_ROOT/regress}}")"
PROFILE="$(to_unix "${LG_PROFILE:-$PROBE_ROOT/pr-regress}")"
LOG="$(to_unix "${LG_LOG:-$PROBE_ROOT/regress.log}")"
TESTPAGE="$(to_unix "${LG_TESTPAGE:-$PROBE_ROOT/audit/gxtest/index.html}")"
CDP_PORT=${PROBE_PORT:-9321}
WEB_PORT=${WEB_PORT:-8911}
READY_TIMEOUT=${LG_READY_TIMEOUT:-40}
WINDOW_MODE=${LG_WINDOW_MODE:-hidden}
SERVE=${LG_SERVE:-python}
PROBES=${LG_PROBES:-"probe-v316.cjs probe-glass.cjs probe-navhist.cjs probe-ipc-contract.cjs probe-design.cjs probe-ux.cjs"}

mkdir -p "$OUT" "$PROFILE" "$(dirname "$LOG")"
: > "$LOG"

fail=0
note() { printf "  %s\n" "$*"; }

cleanup() {
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  # 先走 CDP Browser.close 优雅关窗：Electron 在 Windows 上对 SIGTERM 不总是
  # 买账，直接 kill 会留下占着端口/profile 的僵尸进程。
  if [ -n "${APP_PID:-}" ]; then
    node -e '
const http=require("http");const p=Number(process.argv[1]);
http.get({host:"127.0.0.1",port:p,path:"/json/version",timeout:1500},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{const j=JSON.parse(d);const ws=new WebSocket(j.webSocketDebuggerUrl);ws.onopen=()=>ws.send(JSON.stringify({id:1,method:"Browser.close"}));}catch(e){}});}).on("error",()=>{});
setTimeout(()=>process.exit(0),1200);' "$CDP_PORT" >/dev/null 2>&1 || true
    sleep 1
    kill "$APP_PID" 2>/dev/null
  fi
  return 0
}
trap cleanup EXIT

printf "\n=== 0/4 前置检查 ===\n"
if [ ! -f "$TESTPAGE" ]; then
  ALT="$REPO/test/fixtures/gxtest/index.html"
  if [ -f "$ALT" ]; then
    TESTPAGE="$ALT"
    note "使用仓库 fixture: $TESTPAGE"
  else
    echo "  缺少测试页: $TESTPAGE"
    exit 2
  fi
fi
note "测试页 ok: $TESTPAGE"
if [ ! -f "$EXE" ]; then
  echo "  缺少可执行文件: $EXE"
  echo "  本地请先跑 bash scripts/sync-dev.sh，或设置 LG_EXE/LG_APP_DIR"
  exit 2
fi
note "可执行文件 ok: $EXE"

printf "\n=== 1/4 起本地测试站（端口 %s，%s）===\n" "$WEB_PORT" "$SERVE"
SERVER_ROOT="$(dirname "$TESTPAGE")"
if [ "$SERVE" = "node" ] || ! command -v python >/dev/null 2>&1; then
  node "$REPO/scripts/serve-fixture.cjs" "$WEB_PORT" "$SERVER_ROOT" >>"$LOG" 2>&1 &
else
  (cd "$SERVER_ROOT" && python -m http.server "$WEB_PORT" --bind 127.0.0.1 >>"$LOG" 2>&1) &
fi
WEB_PID=$!
sleep 2
if ! node -e "const h=require('http');h.get({host:'127.0.0.1',port:$WEB_PORT,path:'/',timeout:4000},r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>{process.exit(1)})"; then
  echo "  测试站没起来（看 $LOG）"
  exit 2
fi
note "测试站 ok (pid $WEB_PID)"

printf "\n=== 2/4 起隔离测试实例（CDP %s）===\n" "$CDP_PORT"
cd "$APP_DIR"
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS
APP_ARGS=()
[ -n "$APP_ARG" ] && APP_ARGS+=("$APP_ARG")
MODE_FLAG="--lg-hidden"
[ "$WINDOW_MODE" = "livetest" ] && MODE_FLAG="--lg-livetest"
DEV_FLAG=()
[ "${LG_DEV:-1}" = "1" ] && DEV_FLAG+=(--lg-dev)
"$EXE" "${APP_ARGS[@]}" \
  --no-sandbox --disable-gpu-sandbox --disable-gpu --use-angle=swiftshader \
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --disable-background-timer-throttling \
  "$MODE_FLAG" "${DEV_FLAG[@]}" --remote-debugging-port="$CDP_PORT" \
  --lg-userdata="$(to_win "$PROFILE")" >>"$LOG" 2>&1 &
APP_PID=$!
ready=0
for i in $(seq 1 "$READY_TIMEOUT"); do
  if node -e "const h=require('http');h.get({host:'127.0.0.1',port:$CDP_PORT,path:'/json/version',timeout:1500},()=>{process.exit(0)}).on('error',()=>{process.exit(1)})" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo "  实例没起来（看 $LOG）"
  exit 2
fi
note "实例 ok (pid $APP_PID, mode=$WINDOW_MODE)"

printf "\n=== 3/4 跑探针 ===\n"
cd "$REPO"
run_probe() {
  local name="$1"; shift
  printf "\n--- %s ---\n" "$name"
  if node "scripts/$name" "$CDP_PORT" "$@" "$OUT/${name%.cjs}-result.json"; then
    note "$name 通过"
  else
    note "$name 失败"
    fail=1
  fi
}
for p in $PROBES; do
  case "$p" in
    probe-glass.cjs) PROBE_WEB="http://127.0.0.1:$WEB_PORT" run_probe "$p" "http://127.0.0.1:$WEB_PORT/?regress=1" ;;
    probe-navhist.cjs) PROBE_WEB="http://127.0.0.1:$WEB_PORT" run_probe "$p" ;;
    *) run_probe "$p" ;;
  esac
done

printf "\n=== 4/4 汇总 ===\n"
for f in "$OUT"/*-result.json; do
  [ -f "$f" ] || continue
  node -e "
    const r=require('$f');
    const bad=r.results.filter(x=>!x.pass);
    console.log('  ' + '$f'.split('/').pop() + ': ' + (r.results.length-bad.length) + '/' + r.results.length + ' 通过');
  " 2>/dev/null || true
done

if [ "$fail" = 0 ]; then
  echo "  回归全部通过"
else
  echo "  回归有失败项（结果在 $OUT）"
fi
exit $fail
