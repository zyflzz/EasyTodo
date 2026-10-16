@echo off
rem ============================================================
rem  EasyTodo 环境配置脚本
rem  功能：1) 创建默认数据目录 data\
rem        2) 在桌面创建「EasyTodo」快捷方式（图标 + 工作目录）
rem  使用：右键"以管理员身份运行"非必需，普通双击即可。
rem ============================================================
chcp 65001 >nul
title EasyTodo 环境配置

set "APP_DIR=%~dp0"

echo ============================================
echo    EasyTodo 环境配置
echo ============================================
echo.

rem ---------- 1. 创建默认数据目录 ----------
if not exist "%APP_DIR%data\" mkdir "%APP_DIR%data"
echo [1/2] 数据目录已就绪: %APP_DIR%data

rem ---------- 2. 创建桌面快捷方式 ----------
rem 使用 PowerShell 获取真实桌面路径（兼容 OneDrive 重定向）
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$desktop=[Environment]::GetFolderPath('Desktop');$ws=New-Object -ComObject WScript.Shell;$lnk=$ws.CreateShortcut((Join-Path $desktop 'EasyTodo.lnk'));$lnk.TargetPath='%APP_DIR%EasyTodo.html';$lnk.WorkingDirectory='%APP_DIR%';$lnk.IconLocation='%APP_DIR%ico\EasyTodo.ico,0';$lnk.Description='EasyTodo · 极简待办清单';$lnk.Save();if (Test-Path (Join-Path $desktop 'EasyTodo.lnk')) { exit 0 } else { exit 1 }"

if %errorlevel%==0 (
  echo [2/2] 桌面快捷方式已创建: EasyTodo.lnk
) else (
  echo [2/2] 快捷方式创建失败，请检查系统策略后重试。
)

echo.
echo 配置完成！双击桌面「EasyTodo」即可开始使用。
echo 首次使用建议在应用内绑定本项目文件夹，数据将保存至 data\easytodo-data.json
echo.
pause
