#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AppPath,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256,
  [string]$ReportPath = (Join-Path $PWD 'desktop-acceptance.json'),
  [switch]$RequireAuthenticode,
  [switch]$Launch,
  [switch]$DisposableVm,
  [switch]$Interactive
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'SKIP: native desktop acceptance requires Windows; this is not a pass.' }
if ($Launch -and -not $DisposableVm) { throw 'Launch requires explicit -DisposableVm. Do not use a production profile.' }
$resolved = (Resolve-Path -LiteralPath $AppPath).Path
$hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Artifact SHA256 mismatch; executable was NOT launched.' }
$signature = Get-AuthenticodeSignature -LiteralPath $resolved
if ($RequireAuthenticode -and $signature.Status -ne 'Valid') { throw ('Authenticode not valid: ' + $signature.Status) }
$cases = @(
  @{ id = 'D01'; task = 'Fresh disposable Windows10/11 VM, no system Node: installed sidecar, health, PTY executed output/resize/exit work.' },
  @{ id = 'D02'; task = 'Tray OFF: edit immediately then OS Alt+F4/native close; reopen and verify exact latest content.' },
  @{ id = 'D03'; task = 'Real storage transaction/quota/permission failure: close/quit/update stays open, visible native warning, no backend stop/installer dispatch. Retry after recovery works.' },
  @{ id = 'D04'; task = 'Tray ON: close checkpoints then hides without stopping agents/backend; tray Open restores; tray Quit checkpoints and stops process tree.' },
  @{ id = 'D05'; task = 'Tray, autostart, notifications default OFF in new profile; independent opt-ins persist; disabling tray restores visible main window. --minimized without tray never strands app.' },
  @{ id = 'D06'; task = 'Opt-in native notifications only unfocused; no consent=no toast, focused=no toast, bounded generic content, rate limit and Windows DoNotDisturb respected.' },
  @{ id = 'D07'; task = 'Two independent automation+native notification consents required; no duplicate browser notification on desktop.' },
  @{ id = 'D08'; task = 'Signed STAGING updater: mutate during download; final checkpoint is after download; success upgrade preserves latest data. Install failure restores backend.' },
  @{ id = 'D09'; task = 'PTY/exec/MCP long-lived descendants gone after explicit quit/restart/update; no unrelated user processes targeted. External editor ownership limitation documented.' },
  @{ id = 'D10'; task = 'Checkpoint timeout/retry and duplicate close clicks do not exit, install twice or accept late ACK. Busy updater keeps app open.' },
  @{ id = 'D11'; task = 'Actual updater signature, latest.json artifact URL/version/signature match installed target; invalid signature rejected. Authenticode is a separate check.' }
)
$results = @()
foreach ($case in $cases) { $results += [pscustomobject]@{ id = $case.id; scenario = $case.task; result = 'NOT_RUN'; evidence = '' } }
$report = [ordered]@{
  schema = 1; artifact = $resolved; sha256 = $hash; hashVerified = $true;
  authenticode = [string]$signature.Status; authenticodeRequired = [bool]$RequireAuthenticode;
  os = [Environment]::OSVersion.VersionString; powershell = $PSVersionTable.PSVersion.ToString();
  startedUtc = [DateTime]::UtcNow.ToString('o'); launchedPid = $null;
  evidenceType = 'operator-observed; not an automated Windows/runtime/signature certification';
  status = 'NOT_ACCEPTED'; cases = $results
}
function Save-Report {
  $full = [IO.Path]::GetFullPath($ReportPath)
  $parent = [IO.Path]::GetDirectoryName($full)
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  $temp = $full + '.' + $PID + '.tmp'
  $report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $full -Force
}
Save-Report
if ($Launch) {
  $app = Start-Process -FilePath $resolved -PassThru
  $report.launchedPid = $app.Id
  Save-Report
}
if ($Interactive) {
  foreach ($case in $report.cases) {
    Write-Host ($case.id + ': ' + $case.scenario)
    $answer = Read-Host 'Observed result (PASS / FAIL / SKIP)'
    if ($answer -notin @('PASS','FAIL','SKIP')) { $answer = 'SKIP' }
    $case.result = $answer.ToUpperInvariant()
    $case.evidence = Read-Host 'Evidence/log reference (no secrets or user document content)'
    Save-Report
  }
  if (@($report.cases | Where-Object { $_.result -ne 'PASS' }).Count -eq 0) { $report.status = 'OPERATOR_REPORTED_PASS' }
}
$report.finishedUtc = [DateTime]::UtcNow.ToString('o')
Save-Report
Write-Host ('Report: ' + $ReportPath + '; status=' + $report.status)
Write-Host 'Forced kill/power loss is NOT prevented by a checkpoint. No signed artifact is certified by file size/hash alone.'
if ($report.status -ne 'OPERATOR_REPORTED_PASS') { exit 2 }
