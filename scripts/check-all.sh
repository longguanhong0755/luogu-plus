#!/usr/bin/env bash
# ============================================================
# Luogu++ — 静态检查总入口（CI 与本地提交前都跑这个）
# 用法: bash scripts/check-all.sh
# 退出码 0 = 全过
#
# 为什么不引入测试框架：本项目没有构建步骤（纯 Electron + 散文件），
# 跑通一次检查只要几秒；引入 jest/vitest 反而要处理 Electron 环境的
# 适配与转译。真正需要跑起来才能验的部分（界面行为）用 CDP 探针，
# 见 scripts/run-all-probes.sh。
# ============================================================
set -u
cd "$(dirname "$0")/.."
fail=0
step() { printf "\n=== %s ===\n" "$1"; }

step "1/5 材质配方 lint（面只能声明在 material.css）"
node scripts/lint-material.js || fail=1

step "2/5 契约静态检查（IPC 通道 / preload 方法 / 配置键三方对账）"
node scripts/lint-contracts.cjs || fail=1

step "3/5 JavaScript 语法"
bad=0
for f in main.js preload-*.js src/*.js src/chrome/*.js src/settings/*.js src/home/*.js \
         src/popup/*.js src/history/*.js src/dock/*.js scripts/*.js scripts/*.cjs; do
  [ -f "$f" ] || continue
  node --check "$f" >/dev/null 2>&1 || { echo "  语法错误: $f"; node --check "$f" 2>&1 | head -3; bad=1; }
done
[ "$bad" = 0 ] && echo "  全部通过"
[ "$bad" = 1 ] && fail=1

step "4/5 行尾守卫（被改文件的行尾风格必须与 HEAD 一致）"
bash scripts/check-eol.sh || fail=1

step "5/5 配置文件可解析"
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('  package.json OK')" || fail=1
node -e "JSON.parse(require('fs').readFileSync('scripts/lint-contracts.ignore.json','utf8')); console.log('  lint-contracts.ignore.json OK')" || fail=1

printf "\n"
if [ "$fail" = 0 ]; then
  echo "check-all: 全部通过"
else
  echo "check-all: 有失败项（见上）"
fi
exit $fail
