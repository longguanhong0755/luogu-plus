@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "TOOLS=%~dp0tools"
set "OUT=%TOOLS%\out"
set "LIST=%TOOLS%\accounts-to-add.txt"

if not exist "%OUT%" mkdir "%OUT%"

tasklist /fi "imagename eq LuoguLab.exe" 2>nul | find /i "LuoguLab.exe" >nul
if not errorlevel 1 (
  echo.
  echo   [!] LuoguLab 正在运行。请先完全退出它,再运行本脚本。
  echo       ^(同一个数据目录只能有一个实例^)
  echo.
  pause
  exit /b 1
)

if not exist "%LIST%" (
  >"%LIST%" echo # 每行一个账号,格式:  邮箱----密码----用户名
  >>"%LIST%" echo # 井号开头的行会被忽略。填好保存并关闭记事本,本窗口会自动继续。
  >>"%LIST%" echo #
)

echo.
echo   打开账号清单: %LIST%
echo   每行一个账号,格式  邮箱----密码----用户名
echo   填好保存并关闭记事本,本窗口就会自动继续。
echo.
start /wait notepad "%LIST%"

echo.
echo   开始批量添加(图形验证码会自动识别),请不要关闭本窗口...
echo.

start "lg-captcha-watch" /min cmd /c python "%TOOLS%\captcha-watch.py" "%OUT%\acct.cap.png" "%OUT%\acct.json" ^>"%OUT%\watch.log" 2^>^&1

"%~dp0LuoguLab.exe" --lg-addacct-batch --lg-selftest="%OUT%\acct.png"

echo.
echo   ===== 结果 =====
python -c "import io,json;d=json.load(io.open(r'%OUT%\acct.json',encoding='utf-8'));[print('  OK  ' if r['ok'] else '  FAIL',r['email'],r.get('stage','')) for r in d.get('results',[])]" 2>nul
if errorlevel 1 type "%OUT%\acct.json"
echo.
echo   识别过程日志: %OUT%\watch.log
echo   详细状态:     %OUT%\acct.json
echo.
pause
