#!/usr/bin/env bash
# 行尾守卫：本仓库按字节保真（.gitattributes 里 * -text），检出什么就是什么。
# 源文件历史上是**混合**行尾（main.js / chrome.js / inject.css / material.css
# 等是 CRLF；chrome.css / home.* / settings.css 等是 LF），所以不能用"全仓统一"
# 的规矩来判，只能逐文件与 HEAD 比对：改了谁，谁的行尾风格就必须与 HEAD 一致。
# 历史上踩过：批量改 CSS 时用 Node 字符串拼接重写文件，把 CRLF 全变成 LF，
# git diff 于是显示成"删 762 行 + 加 630 行"的全量重写，评审时看不出真实改动。
set -u
cd "$(dirname "$0")/.."
bad=0
# 本地默认与 HEAD 比；CI 传 LG_EOL_REF=<base> 时按 base...HEAD 的改动文件比，
# 这样干净检出上也能真正检查这次提交有没有批量改行尾。
REF="${LG_EOL_REF:-HEAD}"
if [ "$REF" != "HEAD" ] && git rev-parse --verify "$REF" >/dev/null 2>&1; then
  CHANGED=$(git diff --name-only --diff-filter=ACMR "$REF" HEAD | grep -v '^$')
  echo "check-eol: base=$REF"
else
  REF=HEAD
  CHANGED=$(git status --porcelain | awk '{print $2}' | grep -v '^$')
fi
# 新增文件（REF 里没有）：按同目录多数风格决定
for f in $CHANGED; do
  [ -f "$f" ] || continue
  if git cat-file -e "$REF:$f" 2>/dev/null; then
    # 已有文件：行尾风格必须与 REF 一致
    head_cr=$(git show "$REF:$f" | tr -cd '\r' | wc -c)
    head_lines=$(git show "$REF:$f" | wc -l)
  else
    head_cr=""; head_lines=""
  fi
  now_cr=$(tr -cd '\r' < "$f" | wc -c)
  now_lines=$(wc -l < "$f")
  if [ -n "$head_cr" ]; then
    head_lf=$((head_lines - head_cr))
    now_lf=$((now_lines - now_cr))
    if [ "$head_cr" = "0" ]; then want="LF"; else want="CRLF"; fi
    if [ "$head_cr" = "0" ] && [ "$now_cr" != "0" ]; then
      echo "行尾不一致: $f  期望 $want（HEAD 是 LF） 现状 CRLF=$now_cr/$now_lines"
      bad=1
    elif [ "$head_cr" != "0" ] && [ "$now_lf" != "$head_lf" ]; then
      # CRLF 文件里可能本来就有个别 LF 行（design-log.md 的 R42 行是历史遗留）；
      # 判据改成"LF 行数量不许变"，既不放过批量转换，也不误报历史混合行尾。
      echo "行尾不一致: $f  期望 $want（HEAD CRLF=$head_cr/$head_lines，LF 行=$head_lf） 现状 CRLF=$now_cr/$now_lines，LF 行=$now_lf"
      bad=1
    fi
  else
    # 新增文件：HEAD 里没有可比对，改按**同目录多数**判断（src/ 下是 CRLF，
    # src/chrome/、src/home/ 等是 LF）。没有同目录参照就不管。
    d=$(dirname "$f")
    sib=$(ls "$d"/*.js "$d"/*.css 2>/dev/null | head -20)
    if [ -n "$sib" ]; then
      crlf=0; lf=0
      for g in $sib; do
        c=$(tr -cd '\r' < "$g" | wc -c)
        t=$(wc -l < "$g")
        if [ "$c" -gt 0 ] && [ "$c" = "$t" ]; then crlf=$((crlf+1)); else lf=$((lf+1)); fi
      done
      now_cr=$(tr -cd '\r' < "$f" | wc -c)
      now_t=$(wc -l < "$f")
      if [ "$crlf" -gt "$lf" ] && [ "$now_cr" != "$now_t" ]; then
        echo "行尾不一致: $f  新文件应为 CRLF（同目录多数风格） 现状 CRLF=$now_cr/$now_t"
        bad=1
      elif [ "$lf" -gt "$crlf" ] && [ "$now_cr" != "0" ]; then
        echo "行尾不一致: $f  新文件应为 LF（同目录多数风格） 现状 CRLF=$now_cr/$now_t"
        bad=1
      fi
    fi
  fi
done
if [ "$bad" = "0" ]; then echo "check-eol: clean（被改文件的行尾风格与 HEAD 一致）"; else echo "check-eol: 有问题（见上）"; fi
exit $bad
