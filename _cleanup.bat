@echo off
cd /d "F:\My Drive\CardVault Pro\app"
git rm -f _deploy-setup.bat _deploy-setup.ps1 2>nul
git add -A
git commit -m "chore: remove deploy setup scripts"
git push origin main
del /f /q "F:\My Drive\CardVault Pro\app\_cleanup.bat"
