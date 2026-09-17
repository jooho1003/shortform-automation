param(
  [ValidateSet('keywords','rank')]
  [string]$Task = 'rank',
  [switch]$Install,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$pipelineDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $pipelineDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  throw "Python venv가 없습니다: $python"
}
$taskName = if ($Task -eq 'keywords') { 'Shortform-Blog-Weekly-Keywords' } else { 'Shortform-Blog-Daily-Rank' }

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "작업 스케줄러에서 제거: $taskName"
  exit 0
}

if ($Install) {
  $argument = "-m shortform blog $Task"
  $action = New-ScheduledTaskAction -Execute $python -Argument $argument -WorkingDirectory $pipelineDir
  $trigger = if ($Task -eq 'keywords') {
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '09:00'
  } else {
    New-ScheduledTaskTrigger -Daily -At '08:00'
  }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'shortform-automation 네이버 블로그 키워드·순위 작업' -Force | Out-Null
  Write-Output "작업 스케줄러에 등록: $taskName"
  exit 0
}

Push-Location $pipelineDir
try {
  & $python -m shortform blog $Task
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
