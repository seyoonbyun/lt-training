@echo off
REM ============================================================
REM  LTT one-shot SMS run - 2026-08-23 10:00 KST
REM
REM  1) resend-stuck-sms.ts   : 2026-08-22 quota block left 16 messages
REM                             stuck at status 2000 (never delivered).
REM                             14 of them are payment confirmations for
REM                             people who already paid.
REM  2) send-resume-links.ts  : "resume payment" links for 4 unpaid groups.
REM
REM  Both scripts re-read the sheet / Solapi at run time, so anyone who
REM  pays before 10:00 is dropped automatically. No duplicate sends.
REM
REM  ASCII only - Korean text in .cmd is read as ANSI and breaks the parser.
REM ============================================================

setlocal
chcp 65001 >nul

REM ---- REAL SEND ----------------------------------------------
REM  .env has SOLAPI_DRY_RUN=1 for local work. send-resume-links.ts
REM  goes through server/services/solapi.ts, which honors that flag and
REM  would silently send NOTHING while the log still says "sent".
REM  Shell env wins over --env-file, so force it off for this run.
set SOLAPI_DRY_RUN=0

set PROJ=C:\DEV\lt-training
set NODE=C:\Program Files\nodejs\node.exe
set TSX=%PROJ%\node_modules\tsx\dist\cli.mjs
set LOGDIR=%PROJ%\logs
set LOG=%LOGDIR%\sms-20260823.log

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
cd /d "%PROJ%"

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo RUN START %date% %time% >> "%LOG%"
echo ============================================================ >> "%LOG%"

echo. >> "%LOG%"
echo --- [1/2] resend stuck messages --- >> "%LOG%"
"%NODE%" --env-file=.env "%TSX%" scripts\resend-stuck-sms.ts --send >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"

echo. >> "%LOG%"
echo --- [2/2] send resume payment links --- >> "%LOG%"
"%NODE%" --env-file=.env "%TSX%" scripts\send-resume-links.ts --send >> "%LOG%" 2>&1
echo exit=%errorlevel% >> "%LOG%"

echo. >> "%LOG%"
echo RUN END %date% %time% >> "%LOG%"
endlocal
