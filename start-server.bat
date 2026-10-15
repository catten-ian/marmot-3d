@echo off
REM ===========================================================
REM  土拨鼠大作战 3D  —— 本地服务器启动脚本
REM
REM  用法：
REM    双击本文件直接启动（默认 8200 端口）
REM    start-server.bat 9000        指定端口
REM
REM  停止：关掉本窗口，或按 Ctrl+C
REM ===========================================================

setlocal enabledelayedexpansion
chcp 65001 >nul
title 土拨鼠大作战 3D - 本地服务器

REM ---------- 切换到脚本所在目录 ----------
cd /d "%~dp0"

REM ---------- 端口参数 ----------
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8200"

REM ---------- 定位 Node 运行时 ----------
set "NODE_EXE="

REM 1) 系统 PATH 中的 node
where node >nul 2>&1 && set "NODE_EXE=node"

REM 2) WorkBuddy 托管的 Node（若已加入 PATH 仍可兜底找到）
if "%NODE_EXE%"=="" (
    if exist "%USERPROFILE%\.workbuddy\binaries\node\current\node.exe" (
        set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\current\node.exe"
    )
)

REM 3) 常见的 Node 安装位置
if "%NODE_EXE%"=="" (
    if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
)
REM 4) 32 位 Node（注意：ProgramFiles(x86) 的括号在批处理里必须用
REM    延迟变量展开转义，否则会破坏 if 块的结构）
if "%NODE_EXE%"=="" (
    set "PF86=%ProgramFiles(x86)%"
    if exist "!PF86!\nodejs\node.exe" set "NODE_EXE=!PF86!\nodejs\node.exe"
)
if "%NODE_EXE%"=="" (
    if exist "%APPDATA%\nvm\current\node.exe" set "NODE_EXE=%APPDATA%\nvm\current\node.exe"
)

if "%NODE_EXE%"=="" (
    echo.
    echo   [错误] 找不到 Node.js 运行环境
    echo.
    echo   这个项目需要 Node.js 才能运行。请先安装：
    echo     https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM ---------- 依赖检查 ----------
if not exist "%~dp0vendor\three.module.js" (
    echo.
    echo   [错误] 缺少 vendor\three.module.js
    echo   请确认项目文件完整。
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0tools\serve.cjs" (
    echo.
    echo   [错误] 缺少 tools\serve.cjs
    echo.
    pause
    exit /b 1
)

REM ---------- 端口占用检查（仅提示，不阻断） ----------
REM 用 findstr 精确匹配 LISTENING 状态的监听行，避免误报
set "PORT_BUSY="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    if not defined PORT_BUSY set "PORT_BUSY=%%a"
)
if defined PORT_BUSY (
    echo.
    echo   [提示] 端口 %PORT% 已被占用（PID !PORT_BUSY!）
    echo         若页面打不开，请换个端口重试，例如：
    echo             start-server.bat 9000
    echo.
)

REM ---------- 启动 ----------
echo.
echo ==========================================================
echo   土拨鼠大作战 3D  -  第一人称 3D 网页游戏
echo ==========================================================
echo.
echo   Node    : %NODE_EXE%
echo   目录    : %CD%
echo   地址    : http://127.0.0.1:%PORT%/
echo.
echo   [浏览器将自动打开；若未打开请手动访问上面的地址]
echo   [关闭本窗口或按 Ctrl+C 即可停止服务]
echo.
echo ==========================================================
echo.

REM 先起浏览器再启动服务：浏览器会自动重试，比延迟更可靠。
REM start 的第一个引号是窗口标题（此处留空），不要省略。
start "" "http://127.0.0.1:%PORT%/"

"%NODE_EXE%" "%~dp0tools\serve.cjs" %PORT%

REM ---------- 启动结束 ----------
echo.
echo   服务器已停止。
echo.
pause
endlocal
