# CardVault Pro — GitHub push + old app cleanup
# Double-click to run, or right-click -> Run with PowerShell

$appDir    = "F:\My Drive\CardVault Pro\app"
$parentDir = "F:\My Drive\CardVault Pro"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  CardVault Pro — GitHub Setup Script" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ── 1. Work inside app/ ───────────────────────────────────────────────────────
Set-Location $appDir

Write-Host "[1/5] Checking git state..." -ForegroundColor Yellow
git status
git log --oneline -3

# ── 2. Stage any uncommitted new files ───────────────────────────────────────
Write-Host "`n[2/5] Staging all files..." -ForegroundColor Yellow
git add -A

$pending = git status --porcelain
if ($pending) {
    Write-Host "New files found — committing..." -ForegroundColor Green
    git commit -m "feat: bulk wizard, sealed redesign, dashboard updates, go-live prep"
} else {
    Write-Host "Nothing new to commit — all files already committed." -ForegroundColor Green
}

# ── 3. Rename branch master -> main ──────────────────────────────────────────
Write-Host "`n[3/5] Renaming branch to main..." -ForegroundColor Yellow
git branch -M main
Write-Host "Branch is now: main" -ForegroundColor Green

# ── 4. Force push (replaces old app on GitHub) ───────────────────────────────
Write-Host "`n[4/5] Force pushing to GitHub (replaces old app)..." -ForegroundColor Yellow
git push --force origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "GitHub push successful!" -ForegroundColor Green
} else {
    Write-Host "Push failed — check errors above." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# ── 5. Clean old app files from parent directory ─────────────────────────────
Write-Host "`n[5/5] Cleaning old app files from parent directory..." -ForegroundColor Yellow
Set-Location $parentDir

$toDelete = @(
    "backups",
    "railway-proxy",
    "stock_sheet",
    "cardvault-data.json",
    "ebay-auth-pending.json",
    "ebay-proxy.js",
    "ebay-seller-tokens.json",
    "Install Startup.bat",
    "MIGRATE_DATA.bat",
    "SETUP_LOCAL.ps1",
    "START_DEV.bat",
    "SYNC_SOURCE.bat",
    "Start eBay Proxy.bat",
    "run-backup.bat",
    "run-backup.ps1"
)

foreach ($item in $toDelete) {
    $path = Join-Path $parentDir $item
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path
        Write-Host "  Deleted: $item" -ForegroundColor DarkGray
    }
}

# Remove the setup script itself after running
$scriptPath = Join-Path $appDir "_deploy-setup.ps1"

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  All done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "  1. Go to vercel.com and import britton477/cardvault-pro" -ForegroundColor White
Write-Host "  2. Add environment variables from your .env.local" -ForegroundColor White
Write-Host "  3. Deploy!" -ForegroundColor White
Write-Host ""

Remove-Item -Force $scriptPath 2>$null

Read-Host "Press Enter to close"
