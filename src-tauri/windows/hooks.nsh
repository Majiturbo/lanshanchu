; 安装路径约定：用户选的是「父目录」时，自动装到其下的 ${PRODUCTNAME}；
; 已是以 ${PRODUCTNAME} 结尾则原样安装。不因自选路径报错，也不因旧版中文目录强迫卸载。

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1

  ; 末段不是产品目录名 → 装到「所选路径\LanshanChu」
  StrLen $R0 "${PRODUCTNAME}"
  StrCpy $R1 $INSTDIR "" -$R0
  ${If} $R1 != "${PRODUCTNAME}"
    StrCpy $INSTDIR "$INSTDIR\${PRODUCTNAME}"
  ${EndIf}

  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
