@echo off
title CardVault Pro - GitHub Setup
color 0A

echo.
echo ========================================
echo   CardVault Pro - GitHub Push + Cleanup
echo ========================================
echo.

cd /d "F:\My Drive\CardVault Pro\app"

echo [1/5] Checking git state...
git log --oneline -3
echo.

echo [2/5] Staging any uncommitted files...
git add -A
git status
echo.

echo [3/5] Committing if anything is new...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "feat: bulk wizard, sealed redesign, dashboard updates, go-live prep"
    echo Committed!
) else (
    echo Nothing new to commit - already up to date.
)
echo.

echo [4/5] Renaming branch to main...
git branch -M main
echo Branch is now: main
echo.

echo [5/5] Force pushing to GitHub (replaces old app)...
git push --force origin main
if errorlevel 1 (
    echo.
    echo ERROR: Push failed. See above for details.
    pause
    exit /b 1
)
echo Push successful!
echo.

echo Cleaning up old app files from parent directory...
cd /d "F:\My Drive\CardVault Pro"

if exist "backups"                   rmdir /s /q "backups"                   && echo   Deleted: backups/
if exist "railway-proxy"             rmdir /s /q "railway-proxy"             && echo   Deleted: railway-proxy/
if exist "stock_sheet"               rmdir /s /q "stock_sheet"               && echo   Deleted: stock_sheet/
if exist "cardvault-data.json"       del /f /q "cardvault-data.json"         && echo   Deleted: cardvault-data.json
if exist "ebay-auth-pending.json"    del /f /q "ebay-auth-pending.json"      && echo   Deleted: ebay-auth-pending.json
if exist "ebay-proxy.js"             del /f /q "ebay-proxy.js"               && echo   Deleted: ebay-proxy.js
if exist "ebay-seller-tokens.json"   del /f /q "ebay-seller-tokens.json"     && echo   Deleted: ebay-seller-tokens.json
if exist "Install Startup.bat"       del /f /q "Install Startup.bat"         && echo   Deleted: Install Startup.bat
if exist "MIGRATE_DATA.bat"          del /f /q "MIGRATE_DATA.bat"            && echo   Deleted: MIGRATE_DATA.bat
if exist "SETUP_LOCAL.ps1"           del /f /q "SETUP_LOCAL.ps1"             && echo   Deleted: SETUP_LOCAL.ps1
if exist "START_DEV.bat"             del /f /q "START_DEV.bat"               && echo   Deleted: START_DEV.bat
if exist "SYNC_SOURCE.bat"           del /f /q "SYNC_SOURCE.bat"             && echo   Deleted: SYNC_SOURCE.bat
if exist "Start eBay Proxy.bat"      del /f /q "Start eBay Proxy.bat"        && echo   Deleted: Start eBay Proxy.bat
if exist "run-backup.bat"            del /f /q "run-backup.bat"              && echo   Deleted: run-backup.bat
if exist "run-backup.ps1"            del /f /q "run-backup.ps1"              && echo   Deleted: run-backup.ps1

echo.
echo ========================================
echo   ALL DONE!
echo ========================================
echo.
echo   GitHub now has the new Next.js app.
echo   Old app files have been removed.
echo.
echo   Next step: go to vercel.com and
echo   import britton477/cardvault-pro
echo.

del /f /q "F:\My Drive\CardVault Pro\app\_deploy-setup.bat" 2>nul
del /f /q "F:\My Drive\CardVault Pro\app\_deploy-setup.ps1" 2>nul

pause
