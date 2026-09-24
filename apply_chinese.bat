@echo off
chcp 65001 >nul
title Antigravity 永久汉化生效工具
echo ================================================================
echo          正在永久应用 Google Antigravity 客户端汉化包
echo ================================================================
echo.
echo [*] 正在关闭 Antigravity 客户端及后台托盘驻留进程...
taskkill /F /IM Antigravity.exe >nul 2>&1
timeout /t 2 /nobreak >nul

set "RES_DIR=%LOCALAPPDATA%\Programs\antigravity\resources"

if not exist "%RES_DIR%\app.asar.patched" (
    echo [错误] 未检测到汉化包文件: %RES_DIR%\app.asar.patched
    echo 请确认汉化封包已成功生成。
    pause
    exit /b 1
)

echo [*] 正在替换核心文件 (app.asar)...
copy /Y "%RES_DIR%\app.asar.patched" "%RES_DIR%\app.asar" >nul
if %errorlevel% neq 0 (
    echo [错误] 替换 app.asar 失败，请检查是否有进程仍占用文件！
    pause
    exit /b 1
)

if exist "%RES_DIR%\app.asar.patched.unpacked" (
    echo [*] 正在更新 unpacked 依赖库...
    rmdir /S /Q "%RES_DIR%\app.asar.unpacked" >nul 2>&1
    xcopy /E /I /Y "%RES_DIR%\app.asar.patched.unpacked" "%RES_DIR%\app.asar.unpacked" >nul
)

echo.
echo [✓] 核心包替换成功！汉化已永久写入硬盘。
echo [*] 正在重新启动 Antigravity 客户端...
start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
echo [✓] 启动完成，自此以后重启或更新都不会丢失中文！
echo ================================================================
timeout /t 3