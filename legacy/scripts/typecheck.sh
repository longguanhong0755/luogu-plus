#!/usr/bin/env bash
# ============================================================
# Luogu++ — 类型检查（渐进式，基线门禁）
# 用法: bash scripts/typecheck.sh [--update-baseline]
#
# 为什么是"基线"而不是"零错误"：项目是纯 JavaScript，一次性把类型错误
# 清零不现实（430 个里绝大多数是"对象字面量类型太窄"这类噪音）。但
# **类型检查最大的价值不是清零，是不再引入新的**——所以这里用基线：
# 记录当前每个文件的错误数，任何文件错误数增加就失败并列出新增项。
# 修掉一个就更新一次基线，基线只降不升。
#
# 基线文件：scripts/typecheck-baseline.json
# ============================================================
set -u
cd "$(dirname "$0")/.."
BASE=scripts/typecheck-baseline.json
TSC=node_modules/.bin/tsc

if [ ! -x "$TSC" ]; then
  echo "typecheck: 没装 typescript（npm install --no-save typescript@5），跳过"
  exit 0
fi

OUT=.typecheck-out.tmp
OUTJ=.typecheck-out.json
"$TSC" -p tsconfig.json > "$OUT" 2>&1 || true
ERRS=$(grep -c "error TS" "$OUT" || true)

# 按文件统计
node -e "
const fs=require('fs');
const out=fs.readFileSync(process.argv[1],'utf8');
const per={};
let total=0;
for(const line of out.split(/\r?\n/)){
  const m=/^([^(]+)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(line);
  if(!m) continue;
  total++;
  const f=m[1].replace(/\\\\/g,'/');
  per[f]=per[f]||{count:0,samples:[]};
  per[f].count++;
  if(per[f].samples.length<3) per[f].samples.push(m[3].slice(0,110));
}
fs.writeFileSync(process.argv[2], JSON.stringify({total,per},null,1));
" "$OUT" "$OUTJ"

if [ "${1:-}" = "--update-baseline" ]; then
  cp "$OUTJ" "$BASE"
  echo "typecheck: 基线已更新 → $BASE（$ERRS 个错误）"
  rm -f "$OUT" "$OUTJ"
  exit 0
fi

if [ ! -f "$BASE" ]; then
  cp "$OUTJ" "$BASE"
  echo "typecheck: 首次运行，已生成基线（$ERRS 个错误）。下次开始门禁。"
  rm -f "$OUT" "$OUTJ"
  exit 0
fi

node -e "
const fs=require('fs');
const cur=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const bad=[];
for(const [f,v] of Object.entries(cur.per)){
  const b=(base.per&&base.per[f])?base.per[f].count:0;
  if(v.count>b) bad.push({file:f, now:v.count, base:b, samples:v.samples});
}
if(!bad.length){
  console.log('typecheck: 通过（当前 '+cur.total+' 个错误，基线 '+base.total+'；没有新增）');
  process.exit(0);
}
console.log('typecheck: **新增类型错误 '+bad.length+' 处**（基线只降不升）');
for(const b of bad){
  console.log('  '+b.file+': '+b.now+'（基线 '+b.base+'）');
  for(const s of b.samples) console.log('      '+s);
}
process.exit(1);
" "$OUTJ" "$BASE"
rc=$?
rm -f "$OUT" "$OUTJ"
exit $rc
