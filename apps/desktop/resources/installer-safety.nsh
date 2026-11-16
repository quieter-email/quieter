!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close quieter before installing or removing it." /SD IDOK
    SetErrorLevel 2
    Quit
  ${ElseIf} $R0 != 603
    MessageBox MB_OK|MB_ICONEXCLAMATION "quieter could not check whether it is open. Close it, then try again." /SD IDOK
    SetErrorLevel 3
    Quit
  ${EndIf}
!macroend
