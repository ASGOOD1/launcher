!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Downloading gamefiles"

  inetc::get \
      "https://asgood.ro/gamefiles.zip" \
      "$INSTDIR\gamefiles.zip" \
      /END
  Pop $0
  ${If} $0 != "OK"
      MessageBox MB_OK "Error downloading: $0"
      Abort
  ${EndIf}

  DetailPrint "Unzipping..."
  nsisunz::UnzipToLog "$INSTDIR\gamefiles.zip" "$INSTDIR"
  Pop $0
  ${If} $0 != "success"
      MessageBox MB_OK "Error unzipping: $0"
      Abort
  ${EndIf}
  Delete "$INSTDIR\gamefiles.zip"

  DetailPrint "Moving files into principal directory..."
  CopyFiles /SILENT "$INSTDIR\gamefiles\*.*" "$INSTDIR"

  RMDir /r "$INSTDIR\gamefiles"
!macroend