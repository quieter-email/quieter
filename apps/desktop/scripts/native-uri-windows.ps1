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
$record = @{ handlerVerified = $false; launcherPid = $PID; secondary = @{ kind = "no-process-handle" } }
try {
  if ($Uri -cne "com.quieter.desktop:/mail?mailboxId=native-smoke-mailbox&threadId=native-smoke-thread&messageId=native-smoke-message") {
    throw "Only the synthetic content URI is permitted."
  }
  $candidate = (Get-Item -LiteralPath $Executable).FullName
  $profile = (Get-Item -LiteralPath $UserData).FullName
  if ($candidate -match '["\r\n]' -or $profile -match '["\r\n]' -or $profile.EndsWith('\')) {
    throw "The owned launch paths cannot be represented safely."
  }
  $expected = '"' + $candidate + '" "--user-data-dir=' + $profile + '" "%1"'
  $currentUser = Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\com.quieter.desktop\shell\open\command"
  $effective = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\com.quieter.desktop\shell\open\command"
  $scheme = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\com.quieter.desktop"
  if ($currentUser.GetValue('') -cne $expected -or $effective.GetValue('') -cne $expected -or
      -not ($scheme.GetValueNames() -contains "URL Protocol") -or
      $effective.GetValueNames() -contains "DelegateExecute" -or
      (Test-Path -LiteralPath "Registry::HKEY_CLASSES_ROOT\com.quieter.desktop\shell\open\ddeexec")) {
    throw "The effective URI handler does not own the exact candidate and private profile."
  }
  $choicePath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\com.quieter.desktop\UserChoice"
  if (Test-Path -LiteralPath $choicePath) {
    $choice = Get-Item -LiteralPath $choicePath
    if ($choice.GetValue("ProgId") -cne "com.quieter.desktop") {
      throw "The URI has a different user-selected handler."
    }
  }
  $record.handlerVerified = $true
  $launch = New-Object System.Diagnostics.ProcessStartInfo
  $launch.FileName = $Uri
  $launch.Verb = "open"
  $launch.UseShellExecute = $true
  $secondary = [System.Diagnostics.Process]::Start($launch)
  if ($null -ne $secondary) {
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
      if (-not $secondary.HasExited -and -not [string]::Equals($image, $candidate, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The OS returned a process outside the owned candidate."
      }
      $secondaryOwned = $null -ne $image -and [string]::Equals($image, $candidate, [StringComparison]::OrdinalIgnoreCase)
    }
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
