# ---------------------------------------------------------------
# GZ AFL - chạy tự động trên Windows bằng Task Scheduler
#
# Dùng (PowerShell, chạy Administrator):
#   cd C:\gzafl
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-task.ps1
#
# Tuỳ chọn:
#   -AppDir "C:\gzafl"      thư mục repo
#   -TaskName "GZAFL"
#   -RunAs "SYSTEM"         hoặc tài khoản Windows cụ thể
#
# Gỡ bỏ:
#   Unregister-ScheduledTask -TaskName GZAFL -Confirm:$false
# ---------------------------------------------------------------
param(
    [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$TaskName = 'GZAFL',
    [string]$RunAs = 'SYSTEM'
)

$ErrorActionPreference = 'Stop'

$backend = Join-Path $AppDir 'backend'
if (-not (Test-Path (Join-Path $backend 'package.json'))) {
    throw "Không tìm thấy backend\package.json trong $AppDir"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    throw 'Không tìm thấy node trong PATH. Cài Node.js 24 LTS rồi chạy lại.'
}
$nodeExe = $nodeCmd.Source

# Kiểm tra node:sqlite dùng được
& $nodeExe -e "require('node:sqlite')" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Node $(& $nodeExe -v) không có node:sqlite. Cần Node >= 22.13 (khuyến nghị 24 LTS)."
}

# Tạo file .env lần đầu (nếu chưa có) và sinh JWT_SECRET
$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $AppDir 'deploy\.env.production.example') $envFile
    Write-Host 'Đã tạo backend\.env từ mẫu. Hãy sửa PUBLIC_BASE_URL + SMTP_* rồi chạy lại script.' -ForegroundColor Yellow
    Push-Location $backend
    & npm run gen-secret -- --write
    Pop-Location
    Write-Host 'Sửa backend\.env xong thì chạy lại script này để đăng ký task.' -ForegroundColor Yellow
    exit 0
}

# Thư mục dữ liệu
foreach ($d in @('data', 'uploads', 'backups', 'logs')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $backend $d) | Out-Null
}

Write-Host "Đăng ký task '$TaskName'..." -ForegroundColor Cyan

$action = New-ScheduledTaskAction `
    -Execute $nodeExe `
    -Argument 'scripts/start-prod.js' `
    -WorkingDirectory $backend

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

if ($RunAs -eq 'SYSTEM') {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
    $principal = New-ScheduledTaskPrincipal -UserId $RunAs -LogonType Interactive -RunLevel Highest
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'GZ AFL backend (Express + SQLite)' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host ''
Write-Host "Đã đăng ký và chạy task '$TaskName'." -ForegroundColor Green
Write-Host "Kiểm tra:  curl.exe http://127.0.0.1:3000/api/health"
Write-Host "Trạng thái: Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "Gỡ bỏ:      Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
