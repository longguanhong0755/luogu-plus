#!/usr/bin/env bash
# ============================================================
# Luogu++ — 一键回归（本地）
# 用法: bash scripts/run-all-probes.sh [输出目录]
#
# 做什么：起一个隔离的测试实例 + 一个本地测试站，把三个 CDP 探针全跑一遍：
#   probe-v316.cjs    9 条  外壳与设置页（搜索框/明暗三态/圆角 token/面色分档/
#                          悬停预览卡片/通用样式注入）
#   probe-glass.cjs   9 条  站外自动玻璃化六类对象 + 能力注册表幂等
#   probe-navhist.cjs 4 条  长按后退/前进的访问历史栈
#
# 隔离原则（别踩过的坑）：
#   · 必须用独立 --lg-userdata，否则和用户正在用的实例抢单实例锁
#   · 测试站必须用 run_in_background 起的进程，(cmd &) 起的会随 shell 退出
#     被回收 → 应用侧 ERR_CONNECTION_REFUSED（而 curl 走系统代理会返回 502，
#     两个错误码指向完全不同的原因，别误判成代理问题）
#   · 探针要显式设视口（后台标签的布局是 0，一切依赖尺寸的判定会全部落空）
#   · 走 CDP 的端口要用命令行 --remote-debugging-port 传，热应用里的 9223
#     会被覆盖
# ============================================================
set -u
cd "$(dirname "$0")/.."
REPO=$(pwd)
OUT="${1:-/d/workspace/luogu++/dev/probe/regress}"
PROBE_DIR=/d/workspace/luogu++/dev/probe
TESTPAGE="$PROBE_DIR/audit/gxtest/index.html"
APP=/d/workspace/luogu++/app
CDP_PORT=${PROBE_PORT:-9321}
WEB_PORT=${WEB_PORT:-8911}
PROFILE="$PROBE_DIR/pr-regress"
LOG="$PROBE_DIR/regress.log"

mkdir -p "$OUT" "$PROFILE"
: > "$LOG"

fail=0
note() { printf "  %s\n" "$*"; }

cleanup() {
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

printf "\n=== 0/4 前置检查 ===\n"
if [ ! -f "$TESTPAGE" ]; then
  echo "  缺少测试页: $TESTPAGE"
  exit 2
fi
note "测试页 ok"
if [ ! -f "$APP/LuoguLab.exe" ]; then
  echo "  缺少部署产物: $APP/LuoguLab.exe（先跑 bash scripts/sync-dev.sh）"
  exit 2
fi
note "部署产物 ok"

printf "\n=== 1/4 起本地测试站（端口 %s）===\n" "$WEB_PORT"
cd "$(dirname "$TESTPAGE")"
python -m http.server "$WEB_PORT" --bind 127.0.0.1 >>"$LOG" 2>&1 &
WEB_PID=$!
sleep 2
if ! node -e "const h=require('http');h.get({host:'127.0.0.1',port:$WEB_PORT,path:'/',timeout:4000},r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>{process.exit(1)})"; then
  echo "  测试站没起来（看 $LOG）"
  exit 2
fi
note "测试站 ok (pid $WEB_PID)"

printf "\n=== 2/4 起隔离测试实例（CDP %s）===\n" "$CDP_PORT"
cd "$APP"
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS
./LuoguLab.exe \
  --no-sandbox --disable-gpu-sandbox --disable-gpu --use-angle=swiftshader \
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --disable-background-timer-throttling \
  --lg-dev --remote-debugging-port="$CDP_PORT" \
  --lg-userdata="$(cygpath -w "$PROFILE")" >>"$LOG" 2>&1 &
APP_PID=$!
ready=0
for i in $(seq 1 40); do
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
note "实例 ok (pid $APP_PID)"

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
run_probe probe-v316.cjs
run_probe probe-glass.cjs "http://127.0.0.1:$WEB_PORT/?regress=1"
PROBE_WEB="http://127.0.0.1:$WEB_PORT" PROBE_WEB="http://127.0.0.1:$WEB_PORT" run_probe probe-navhist.cjs
# 存量 IPC 契约：把每个 preload 暴露的方法都调一遍，抓"调用即崩"的通道
run_probe probe-ipc-contract.cjs
# 设计令牌运行时：按钮高度/圆角/字号是否真的统一（静态 lint 看不出来，
# 得量实际渲染值——.nav-item 的圆角曾被同规则里第二处声明静默顶掉）
run_probe probe-design.cjs

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
