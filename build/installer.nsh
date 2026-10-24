; Bij verwijderen (niet bij bijwerken): de Claude Code-hook weghalen, anders blijft Claude Code
; bij elke start een programma aanroepen dat er niet meer is.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --remove-hook'
  ${endIf}
!macroend
