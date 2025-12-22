@echo off
setlocal

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM Convert Windows path to Unix-style path for Git Bash
set "UNIX_PATH=%SCRIPT_DIR%"
set "UNIX_PATH=%UNIX_PATH:\=/%"
set "UNIX_PATH=%UNIX_PATH:C:=/c%"
set "UNIX_PATH=%UNIX_PATH:c:=/c%"

REM Find Git Bash
set "GIT_BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GIT_BASH%" (
    set "GIT_BASH=C:\Program Files (x86)\Git\bin\bash.exe"
)

if not exist "%GIT_BASH%" (
    echo Error: Git Bash not found. Please install Git for Windows.
    echo Falling back to PowerShell...
    powershell.exe -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\gpull.ps1"
    exit /b %ERRORLEVEL%
)

"%GIT_BASH%" -c "cd '%UNIX_PATH%' && ./gpull.sh"

