@echo off
REM ============================================================
REM  Build the tray server launcher with bundled portable TCC.
REM  No compiler installation required.
REM ============================================================
setlocal
cd /d "%~dp0"

copy /Y tray_launcher.cpp tray_launcher.c >nul
tcc\tcc\tcc.exe -DUNICODE -D_UNICODE -municode -I tcc-shim -I tcc\tcc\include\winapi tray_launcher.c tcc-shim\shell32.def -o marmot-server.exe -luser32 -lkernel32 -lgdi32 -ladvapi32 -lmsvcrt

if errorlevel 1 (
    echo.
    echo [build failed]
    del /q tray_launcher.c 2>nul
    exit /b 1
)
del /q tray_launcher.c 2>nul
echo.
echo [build ok] marmot-server.exe
endlocal
