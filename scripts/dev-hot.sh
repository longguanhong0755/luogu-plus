#!/usr/bin/env bash
# 快速迭代入口（热应用模式）：同步一次 → 起 dev 实例，直接监听**工作区源码**。
# 之后改代码什么都不用手动做：
#   inject.css / ext.css   → 页面不刷新，样式表直接热换（调玻璃/圆角/壁纸秒见）
#   chrome|settings|home|history|popup 下的文件 → 只刷对应那一层
#   inject.js              → 自动重灌全部页面
#   main.js / preload-*.js → 自动拷回 dev 目录并重启实例
# dev 实例有独立的用户数据目录（dev-profile），第一次启动会把真实配置
# 只读拷贝过来（壁纸/主题色和日常实例一致），绝不写回真实 profile。
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEV=/c/Users/Administrator/LuoguGlassDev
PROF="$DEV/dev-profile"
bash "$SRC/scripts/sync-dev.sh"
mkdir -p "$PROF"
# 真实配置只读拷贝（首次）：让 dev 实例的壁纸/主题色/侧坞和日常用的一致
[ -f "$PROF/luogu-glass-config.json" ] || cp "$APPDATA/LuoguLab/luogu-glass-config.json" "$PROF/" 2>/dev/null || true
cd "$DEV"
echo "[dev-hot] 热应用模式启动：编辑 $SRC 下的文件即改即见（Ctrl+C 退出）"
exec ./edist/electron.exe . \
  --lg-dev \
  --lg-watchsrc="$SRC/src" \
  --lg-userdata="$(cygpath -w "$PROF")" \
  --lg-url=https://www.luogu.com.cn/
