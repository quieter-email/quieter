param(
  [Parameter(Mandatory = $true)][string]$Uri,
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$UserData,
  [Parameter(Mandatory = $true)][int]$PrimaryPid,
  [Parameter(Mandatory = $true)][string]$Receipt
)

$ErrorActionPreference = "Stop"
$secondary = $null
$secondaryOwned = $false
$record = @{
  checks = @{
    currentUserCommandExact = $false
    effectiveCommandExact = $false
    urlProtocolPresent = $false
    delegateExecuteAbsent = $false
    ddeAbsent = $false
    userChoiceAllowed = $false
  }
  handlerVerified = $false
  launcherPid = $PID
  pathSpellingChanged = $false
  phase = "input-validation"
  secondary = @{ kind = "no-process-handle" }
}
try {
  if ($Uri -cne "com.quieter.desktop:/mail?mailboxId=native-smoke-mailbox&threadId=native-smoke-thread&messageId=native-smoke-message") {
    throw "Only the synthetic content URI is permitted."
  }
  $record.phase = "path-validation"
  $candidate = Get-Item -LiteralPath $Executable
  $profile = Get-Item -LiteralPath $UserData
  if (-not ($candidate -is [System.IO.FileInfo]) -or -not ($profile -is [System.IO.DirectoryInfo])) {
    throw "The owned launch paths have unexpected types."
  }
  $record.pathSpellingChanged = $candidate.FullName -cne $Executable -or $profile.FullName -cne $UserData
  if ($Executable -match '["\r\n]' -or $UserData -match '["\r\n]' -or $UserData.EndsWith('\')) {
    throw "The owned launch paths cannot be represented safely."
  }
  $expected = '"' + $Executable + '" "--user-data-dir=' + $UserData + '" "%1"'
  $record.phase = "current-user-command"
  $currentUser = Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\com.quieter.desktop\shell\open\command"
  $record.checks.currentUserCommandExact = [string]::Equals($currentUser.GetValue(''), $expected, [StringComparison]::Ordinal)
  $record.phase = "effective-command"
  $effective = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\com.quieter.desktop\shell\open\command"
  $record.checks.effectiveCommandExact = [string]::Equals($effective.GetValue(''), $expected, [StringComparison]::Ordinal)
  $record.checks.delegateExecuteAbsent = -not ($effective.GetValueNames() -contains "DelegateExecute")
  $record.checks.ddeAbsent = -not (Test-Path -LiteralPath "Registry::HKEY_CLASSES_ROOT\com.quieter.desktop\shell\open\ddeexec")
  $record.phase = "protocol-declaration"
  $scheme = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\com.quieter.desktop"
  $record.checks.urlProtocolPresent = $scheme.GetValueNames() -contains "URL Protocol"
  $record.phase = "handler-validation"
  if (-not $record.checks.currentUserCommandExact -or -not $record.checks.effectiveCommandExact -or
      -not $record.checks.urlProtocolPresent -or -not $record.checks.delegateExecuteAbsent -or
      -not $record.checks.ddeAbsent) {
    throw "The effective URI handler does not own the exact candidate and private profile."
  }
  $record.phase = "user-choice"
  $choicePath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\com.quieter.desktop\UserChoice"
  if (Test-Path -LiteralPath $choicePath) {
    $choice = Get-Item -LiteralPath $choicePath
    if ($choice.GetValue("ProgId") -cne "com.quieter.desktop") {
      throw "The URI has a different user-selected handler."
    }
  }
  $record.checks.userChoiceAllowed = $true
  $record.handlerVerified = $true
  $record.phase = "shell-launch"
  $launch = New-Object System.Diagnostics.ProcessStartInfo
  $launch.FileName = $Uri
  $launch.Verb = "open"
  $launch.UseShellExecute = $true
  $secondary = [System.Diagnostics.Process]::Start($launch)
  if ($null -ne $secondary) {
    $record.phase = "secondary-ownership"
    $record.secondary = @{ kind = "unverified"; pid = $secondary.Id }
    if ($secondary.Id -eq $PrimaryPid) {
      $record.secondary = @{ kind = "primary-handle"; pid = $secondary.Id }
      $secondary.Dispose()
      $secondary = $null
      throw "The OS returned the primary process handle."
    }
    if (-not $secondary.HasExited) {
      $image = $null
      try {
        $image = $secondary.MainModule.FileName
      } catch {
        if (-not $secondary.HasExited) { throw }
      }
      if (-not $secondary.HasExited -and -not [string]::Equals($image, $candidate.FullName, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The OS returned a process outside the owned candidate."
      }
      $secondaryOwned = $null -ne $image -and [string]::Equals($image, $candidate.FullName, [StringComparison]::OrdinalIgnoreCase)
    }
    $record.phase = "secondary-exit"
    $record.secondary = @{ kind = "running"; pid = $secondary.Id }
    $record | ConvertTo-Json -Depth 3 -Compress | Set-Content -LiteralPath $Receipt -Encoding UTF8
    if (-not $secondary.WaitForExit(20000)) {
      throw "The OS-launched secondary did not exit."
    }
    $secondary.Refresh()
    if ($secondary.ExitCode -ne 0) {
      throw "The OS-launched secondary failed."
    }
    $record.secondary = @{ kind = "exited"; pid = $secondary.Id; exitCode = $secondary.ExitCode }
  }
  $record.phase = "complete"
} finally {
  if ($null -ne $secondary -and -not $secondary.HasExited -and $secondaryOwned) {
    $secondary.Kill()
    if (-not $secondary.WaitForExit(5000)) {
      throw "The owned OS-launched secondary did not stop."
    }
    $record.secondary = @{ kind = "forced"; pid = $secondary.Id }
  }
  $record | ConvertTo-Json -Depth 3 -Compress | Set-Content -LiteralPath $Receipt -Encoding UTF8
  if ($null -ne $secondary) {
    $secondary.Dispose()
  }
}
