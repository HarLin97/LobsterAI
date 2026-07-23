!include "FileFunc.nsh"

Var lobsterCurrentProcessPid

!ifndef BUILD_UNINSTALLER
  ; Cross-hook state used by the update fast path and the electron-builder
  ; template timing hooks. These are installer variables (not registers) so
  ; nested NSIS macros cannot accidentally overwrite an in-flight timer.
  Var lobsterOldInstallOriginalPath
  Var lobsterOldInstallOriginalPathNormalized
  Var lobsterOldInstallRegisteredPath
  Var lobsterOldInstallRegisteredPathNormalized
  Var lobsterOldInstallAlternateRegisteredPath
  Var lobsterOldInstallAlternateRegisteredPathNormalized
  Var lobsterOldInstallBackupPath
  Var lobsterOldInstallFailedPath
  Var lobsterOldInstallRenameStatus
  Var lobsterOldInstallRenameReason
  Var lobsterOldInstallRenameError
  Var lobsterOldInstallRenameAttempts
  Var lobsterOldInstallRollbackReason
  Var lobsterOldInstallRollbackStatus
  Var lobsterOldInstallRollbackError
  Var lobsterOldInstallCurrentDirectory
  Var lobsterOldUninstallCandidatePath
  Var lobsterOldUninstallCandidatePathNormalized
  Var lobsterOldUninstallStartTick
  Var lobsterOldUninstallLaunchStatus
  Var lobsterNewInstallValidationStatus
  Var lobsterNewInstallValidationReason
  !ifndef APP_PACKAGE_URL
    Var lobsterPackageMaterializeStartTick
  !endif
  Var lobsterPackageExtractStartTick
  Var lobsterPackageCopyStartTick
  Var lobsterInstallerCacheCopyStartTick
  !ifndef ESTIMATED_SIZE
    Var lobsterEstimatedSizeScanStartTick
    Var lobsterEstimatedSizeValue
  !endif
!endif

; -- Design invariant --
; Nothing destructive may run before the user confirms the wizard (or the
; uninstall prompt). electron-builder inserts customInit in .onInit, which
; runs when the installer is merely opened -- cancelling at the welcome or
; directory page must leave the existing installation and running app
; untouched. All destructive work (stopping processes, backing up skills,
; renaming the old install dir) therefore lives in customCheckAppRunning,
; which electron-builder inserts inside the install section -- right after
; the user clicks Install and, critically, *before* uninstallOldVersion.

; Timestamp from NSIS built-ins (FileFunc ${GetTime}). The previous
; implementation spawned a PowerShell process per call just to format a
; timestamp -- with 20+ call sites that added tens of seconds per install on
; machines where security software inspects every process launch. Second
; precision is enough: phase durations are carried separately as elapsed_ms.
;
; Preserves every register (unlike the old version, which clobbered $0; the
; "copy exit codes to $R2 first" convention at call sites is kept anyway).
; OUTVAR must not be $0-$6.
!macro GetTimestamp OUTVAR
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  !ifdef BUILD_UNINSTALLER
    ${un.GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  !else
    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  !endif
  ; $0=day $1=month $2=year $3=day-of-week name $4=hour $5=minute $6=second
  IntFmt $0 "%02d" $0
  IntFmt $1 "%02d" $1
  IntFmt $4 "%02d" $4
  IntFmt $5 "%02d" $5
  IntFmt $6 "%02d" $6
  StrCpy $0 "$2-$1-$0 $4:$5:$6"
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
  Pop ${OUTVAR}
!macroend

!macro customHeader
  ; Request admin privileges for script execution (tar extract, etc.)
  ; This does NOT change the default install path -- just ensures UAC elevation.
  RequestExecutionLevel admin

  ; Keep only the progress bar visible. The details box stays hidden and
  ; NSIS/electron-builder retains the default status text behavior.
  ShowInstDetails nevershow
!macroend

; -- Stop every process that might hold file handles in the install dir --
;
; 1. LobsterAI.exe -- the main app AND the OpenClaw gateway (ELECTRON_RUN_AS_NODE)
; 2. node.exe whose binary lives inside the LobsterAI install tree
;    (Web Search bridge server, MCP servers spawned with detached:true)
;
; Stop-Process -Force is equivalent to taskkill /F -- the processes have no
; chance to run before-quit cleanup, so file handles may linger briefly as
; "ghost handles" in the Windows kernel. We poll until no matching process
; remains before proceeding.
;
; Shared between the installer and the uninstaller via customCheckAppRunning.
!macro stopLobsterAIProcesses
  DetailPrint "[Installer] Stopping running LobsterAI processes"
  System::Call 'kernel32::GetCurrentProcessId()i .r4'
  StrCpy $lobsterCurrentProcessPid $4
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    Stop-Process -Name LobsterAI -Force -ErrorAction SilentlyContinue;\
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*LobsterAI*\" } | Stop-Process -Force -ErrorAction SilentlyContinue;\
    for ($$i = 0; $$i -lt 15; $$i++) {\
      $$procs = @();\
      $$procs += Get-Process -Name LobsterAI -ErrorAction SilentlyContinue;\
      $$procs += Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*LobsterAI*\" };\
      if ($$procs.Count -eq 0) { break };\
      Start-Sleep -Milliseconds 500;\
    }"'
  Pop $0
  StrCpy $R2 $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  CreateDirectory "$APPDATA\LobsterAI"
  FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $9 0 END
  !insertmacro GetTimestamp $8
  !ifdef BUILD_UNINSTALLER
    FileWrite $9 "$8 phase=process-stop-complete role=uninstaller pid=$lobsterCurrentProcessPid exit=$R2 elapsed_ms=$5$\r$\n"
  !else
    FileWrite $9 "$8 phase=process-stop-complete role=installer pid=$lobsterCurrentProcessPid exit=$R2 elapsed_ms=$5$\r$\n"
  !endif
  FileClose $9
!macroend

!macro customInit
  ; Diagnostics only -- .onInit runs before the user has confirmed anything,
  ; so this macro must stay non-destructive.
  CreateDirectory "$APPDATA\LobsterAI"
  FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" w
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=custom-init-start instdir=$INSTDIR appdata=$APPDATA$\r$\n"
  FileClose $9
!macroend

!ifndef BUILD_UNINSTALLER
  ; Restore the complete previous tree whenever a controlled installer failure
  ; occurs after the fast-path rename but before the new install is committed.
  ; Direct NSIS Quit calls bypass callbacks, so patched template exit sites call
  ; customBeforeInstallerQuit explicitly; interactive failure/cancel callbacks
  ; use the same function as a second line of defence.
  Function lobsterRollbackOldInstall
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    Push $6
    Push $7
    Push $8
    Push $9

    StrCmp $lobsterOldInstallRenameStatus "success" 0 LobsterRollbackDone
    StrCpy $lobsterOldInstallRollbackStatus "started"
    StrCpy $lobsterOldInstallRollbackError "0"
    StrCpy $lobsterOldInstallRenameStatus "rollback-in-progress"
    System::Call 'kernel32::GetTickCount()i .r7'
    System::Call 'kernel32::GetCurrentProcessId()i .r4'
    StrCpy $lobsterOldInstallFailedPath "$lobsterOldInstallOriginalPath.failed.$4.$7"

    InitPluginsDir
    SetOutPath "$PLUGINSDIR"

    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=old-install-rollback-start reason=$lobsterOldInstallRollbackReason source=$lobsterOldInstallOriginalPath backup=$lobsterOldInstallBackupPath displaced=$lobsterOldInstallFailedPath$\r$\n"
    FileClose $9

    ; Remove an empty target directory first. If the new payload already wrote
    ; files, move the partial tree aside so the complete backup can return to
    ; the exact registered path without destructive deletion.
    RMDir "$lobsterOldInstallOriginalPath"
    StrCpy $2 "false"
    System::Call 'kernel32::MoveFileW(w "$lobsterOldInstallOriginalPath", w "$lobsterOldInstallFailedPath") i .r0 ?e'
    Pop $1
    IntCmp $0 0 LobsterRollbackTargetMoveFailed LobsterRollbackTargetMoved LobsterRollbackTargetMoved

    LobsterRollbackTargetMoved:
      StrCpy $2 "true"
      Goto LobsterRollbackRestoreBackup

    LobsterRollbackTargetMoveFailed:
      ; ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND is expected when payload
      ; extraction had not created the target yet. The restore attempt below
      ; is the authority on whether rollback can complete.
      StrCpy $lobsterOldInstallRollbackError "target-move:$1"

    LobsterRollbackRestoreBackup:
    System::Call 'kernel32::MoveFileW(w "$lobsterOldInstallBackupPath", w "$lobsterOldInstallOriginalPath") i .r0 ?e'
    Pop $1
    IntCmp $0 0 LobsterRollbackRestoreFailed LobsterRollbackRestoreSucceeded LobsterRollbackRestoreSucceeded

    LobsterRollbackRestoreSucceeded:
      StrCpy $lobsterOldInstallRollbackStatus "success"
      StrCpy $lobsterOldInstallRollbackError "0"
      StrCpy $lobsterOldInstallRenameStatus "rolled-back"

      ; A failed update must not leave its broad, install-scope Defender
      ; exclusion protecting the restored application indefinitely.
      nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Remove-MpPreference -ExclusionPath \"$lobsterOldInstallOriginalPath\" -ErrorAction SilentlyContinue } catch {}"'
      Pop $0
      Pop $1

      ; The displaced tree is never needed after a verified restore. Pass its
      ; exact path through the child environment instead of interpolating it
      ; into cmd/PowerShell code: custom install directories may contain shell
      ; metacharacters. Exec is deliberately non-blocking.
      StrCmp $2 "true" 0 LobsterRollbackLog
      System::Call 'Kernel32::SetEnvironmentVariable(t "LOBSTERAI_FAILED_CLEANUP_PATH", t "$lobsterOldInstallFailedPath")i'
      ClearErrors
      Exec 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Remove-Item -LiteralPath $$env:LOBSTERAI_FAILED_CLEANUP_PATH -Recurse -Force -ErrorAction SilentlyContinue"'
      System::Call 'Kernel32::SetEnvironmentVariable(t "LOBSTERAI_FAILED_CLEANUP_PATH", t "")i'
      Goto LobsterRollbackLog

    LobsterRollbackRestoreFailed:
      StrCpy $lobsterOldInstallRollbackStatus "failed"
      StrCpy $lobsterOldInstallRollbackError "backup-restore:$1"
      StrCpy $lobsterOldInstallRenameStatus "rollback-failed"

      ; If the partial tree was displaced but the complete backup could not be
      ; restored, put the partial tree back. Never delete either tree when the
      ; recovery state is ambiguous.
      StrCmp $2 "true" 0 LobsterRollbackLog
      System::Call 'kernel32::MoveFileW(w "$lobsterOldInstallFailedPath", w "$lobsterOldInstallOriginalPath") i .r0 ?e'
      Pop $3
      IntCmp $0 0 0 LobsterRollbackLog LobsterRollbackLog
      StrCpy $lobsterOldInstallRollbackError "$lobsterOldInstallRollbackError;partial-restore:$3"

    LobsterRollbackLog:
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    StrCpy $2 "false"
    StrCpy $3 "false"
    IfFileExists "$lobsterOldInstallOriginalPath\*.*" 0 LobsterRollbackSourceChecked
      StrCpy $2 "true"
    LobsterRollbackSourceChecked:
    IfFileExists "$lobsterOldInstallBackupPath\*.*" 0 LobsterRollbackBackupChecked
      StrCpy $3 "true"
    LobsterRollbackBackupChecked:
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=old-install-rollback-complete status=$lobsterOldInstallRollbackStatus reason=$lobsterOldInstallRollbackReason error=$lobsterOldInstallRollbackError elapsed_ms=$5 source_exists=$2 backup_exists=$3 displaced=$lobsterOldInstallFailedPath$\r$\n"
    FileClose $9

    LobsterRollbackDone:
    Pop $9
    Pop $8
    Pop $7
    Pop $6
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  !macro customRollbackOldInstall REASON
    StrCpy $lobsterOldInstallRollbackReason "${REASON}"
    Call lobsterRollbackOldInstall
  !macroend

  !macro customBeforeInstallerQuit REASON
    !insertmacro customRollbackOldInstall "${REASON}"
  !macroend

  !macro customInstallerFailed
    !insertmacro customRollbackOldInstall "installer-failed"
  !macroend

  !macro customInstallerUserAbort
    !insertmacro customRollbackOldInstall "user-abort"
  !macroend
!endif

; Replaces electron-builder's built-in CHECK_APP_RUNNING. Inserted:
;  - installer: inside the install section, right after the user confirms,
;    before uninstallOldVersion and file extraction
;  - uninstaller: un.install section (assisted) or un.onInit (silent /S)
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; Silent installs (/S -- e.g. enterprise IT deployments; in-app updates
    ; use --updated mode with a visible progress page instead) have no
    ; installer UI at all, so without this the machine looks idle for minutes
    ; mid-replace. Banner is a plugin-owned window, so it shows even in
    ; silent mode. The window dies with the installer process, so no failure
    ; path can leave it behind.
    ;
    ; The text is "Updating LobsterAI, please wait..." in Chinese, written as
    ; ${U+xxxx} escapes because this file must stay pure ASCII: the darwin
    ; makensis builds used for local syntax checks reject any non-ASCII byte
    ; (the escapes are fine on the Windows build machine -- the webPackage
    ; patch ships them in production already).
    ${If} ${Silent}
      Banner::show /NOUNLOAD "${U+6B63}${U+5728}${U+66F4}${U+65B0} LobsterAI${U+FF0C}${U+8BF7}${U+7A0D}${U+5019}${U+2026}"
    ${EndIf}
  !endif

  !insertmacro stopLobsterAIProcesses

  !ifndef BUILD_UNINSTALLER
    ; -- Backup user-created skills to AppData before extraction overwrites them --
    ; Copy non-bundled skills to %APPDATA%\LobsterAI\skills-backup\ so they are
    ; preserved when NSIS extracts the new version over the existing install.
    ; The backup is restored in customInstall after extraction completes.
    ; Must run before the $INSTDIR rename below -- it reads from $INSTDIR.
    ;
    ; Quoting note: paths use \"..\" (backslash-escaped quote) -- NOT $\"..$\" --
    ; because $\"..$\" produces raw quotes that Windows CRT argv parsing consumes,
    ; leaving the path unquoted and causing PowerShell method calls to fail.
    DetailPrint "[Installer] Backing up user-created skills"
    System::Call 'kernel32::GetTickCount()i .r7'
    ClearErrors
    FileOpen $R0 "$APPDATA\LobsterAI\skill-migrate.log" w
    IfErrors BackupLogOpenFailed
      !insertmacro GetTimestamp $8
      FileWrite $R0 "$8 phase=backup-start instdir=$INSTDIR appdata=$APPDATA$\r$\n"
      Goto BackupDoExec
    BackupLogOpenFailed:
      StrCpy $R0 ""
    BackupDoExec:

    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$ErrorActionPreference = \"Stop\";\
      $$src     = \"$INSTDIR\resources\SKILLs\";\
      $$backup  = \"$APPDATA\LobsterAI\skills-backup\";\
      $$staging = \"$APPDATA\LobsterAI\skills-backup.new.$lobsterCurrentProcessPid\";\
      $$config  = \"$$src\skills.config.json\";\
      try {\
        if (Test-Path $$staging) { Remove-Item -Path $$staging -Recurse -Force };\
        if (Test-Path $$src) {\
          $$bundled = @(try {\
            if (Test-Path $$config) {\
              (Get-Content $$config -Raw | ConvertFrom-Json).defaults.PSObject.Properties.Name\
            }\
          } catch { });\
          $$userSkills = @(Get-ChildItem -Path $$src -Directory -ErrorAction Stop | Where-Object { $$bundled -notcontains $$_.Name });\
          if ($$userSkills.Count -gt 0) {\
            New-Item -ItemType Directory -Path $$staging -Force | Out-Null;\
            $$userSkills | ForEach-Object {\
              Copy-Item -Path $$_.FullName -Destination (Join-Path $$staging $$_.Name) -Recurse -Force -ErrorAction Stop\
            };\
            if (Test-Path $$backup) { Remove-Item -Path $$backup -Recurse -Force -ErrorAction Stop };\
            Move-Item -Path $$staging -Destination $$backup -Force -ErrorAction Stop;\
            Write-Output (\"backed-up:\" + $$userSkills.Count)\
          } else {\
            Write-Output \"no-user-skills-existing-backup-preserved\"\
          }\
        } else {\
          Write-Output \"source-missing-existing-backup-preserved\"\
        };\
        exit 0\
      } catch {\
        if (Test-Path $$staging) { Remove-Item -Path $$staging -Recurse -Force -ErrorAction SilentlyContinue };\
        Write-Error $$_.Exception.Message;\
        exit 1\
      }"'
    Pop $0
    Pop $1
    StrCpy $R2 $0
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7

    StrCmp $R0 "" BackupSkipCloseLog
      !insertmacro GetTimestamp $8
      FileWrite $R0 "$8 phase=backup-end exit=$R2 elapsed_ms=$5$\r$\n"
      FileWrite $R0 "$8 phase=backup-output text=$1$\r$\n"
      FileClose $R0
    BackupSkipCloseLog:
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=skill-backup-complete exit=$R2 elapsed_ms=$5$\r$\n"
    FileClose $9

    ; User-created skills live inside the installation tree. If their backup
    ; did not complete, stop before the directory swap so the only authoritative
    ; copy remains untouched. An update that fails closed is recoverable; a
    ; fast update that silently drops user data is not.
    StrCmp $R2 "0" SkillBackupValidated
      FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $9 0 END
      !insertmacro GetTimestamp $8
      FileWrite $9 "$8 phase=skill-backup-failed-abort exit=$R2 action=old-install-preserved$\r$\n"
      FileClose $9
      ${If} ${Silent}
        Banner::destroy
      ${EndIf}
      MessageBox MB_OK|MB_ICONEXCLAMATION "The LobsterAI update stopped because user skills could not be backed up. The previous installation was not replaced. Please retry the update. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
      SetErrorLevel 2
      Quit
    SkillBackupValidated:

    ; -- Move the previous installation out of the target path --
    ;
    ; electron-builder's .onInit calls SetOutPath $INSTDIR. On Windows that
    ; makes $INSTDIR the installer's current directory, which prevents the
    ; directory itself from being renamed. Move the current directory to the
    ; plugin temp directory before attempting the update fast path.
    ;
    ; The fast path is deliberately limited to an in-app update whose selected
    ; registry root owns this exact install directory. Manual reinstalls and
    ; ambiguous/mismatched installs retain electron-builder's old-uninstaller
    ; fallback. A successful backup is not deleted until customInstall runs,
    ; so extraction does not compete with a recursive old-tree deletion.
    DetailPrint "[Installer] Preparing previous installation for replacement"
    System::Call 'kernel32::GetTickCount()i .r7'
    StrCpy $lobsterOldInstallOriginalPath "$INSTDIR"
    GetFullPathName $lobsterOldInstallOriginalPathNormalized "$INSTDIR"
    StrCpy $lobsterOldInstallRegisteredPath ""
    StrCpy $lobsterOldInstallRegisteredPathNormalized ""
    StrCpy $lobsterOldInstallAlternateRegisteredPath ""
    StrCpy $lobsterOldInstallAlternateRegisteredPathNormalized ""
    StrCpy $lobsterOldInstallBackupPath ""
    StrCpy $lobsterOldInstallFailedPath ""
    StrCpy $lobsterOldInstallRenameStatus "not-applicable"
    StrCpy $lobsterOldInstallRenameReason "not-updated"
    StrCpy $lobsterOldInstallRenameError "0"
    StrCpy $lobsterOldInstallRenameAttempts "0"
    StrCpy $lobsterOldInstallRollbackReason ""
    StrCpy $lobsterOldInstallRollbackStatus "not-needed"
    StrCpy $lobsterOldInstallRollbackError "0"

    ClearErrors
    ReadRegStr $lobsterOldInstallRegisteredPath SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp $lobsterOldInstallRegisteredPath "" OldInstallRegisteredPathReady
      GetFullPathName $lobsterOldInstallRegisteredPathNormalized "$lobsterOldInstallRegisteredPath"
    OldInstallRegisteredPathReady:

    GetFullPathName $lobsterOldInstallCurrentDirectory "."
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"

    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=old-install-rename-start instdir=$lobsterOldInstallOriginalPath registered_instdir=$lobsterOldInstallRegisteredPath current_directory=$lobsterOldInstallCurrentDirectory install_mode=$installMode$\r$\n"
    FileClose $9

    ${IfNot} ${isUpdated}
      Goto OldInstallRenameComplete
    ${EndIf}

    StrCpy $lobsterOldInstallRenameReason "registered-install-missing"
    StrCmp $lobsterOldInstallRegisteredPathNormalized "" OldInstallRenameComplete

    StrCpy $lobsterOldInstallRenameReason "install-location-mismatch"
    StrCmp $lobsterOldInstallRegisteredPathNormalized $lobsterOldInstallOriginalPathNormalized 0 OldInstallRenameComplete

    ; A machine install can have a stale per-user registration pointing at the
    ; same directory. Fast-path skipping both roots would preserve a duplicate
    ; Add/Remove Programs entry whose uninstaller targets the live machine
    ; install, so treat this ambiguous state as fallback-only.
    ${If} $installMode == "all"
      ClearErrors
      ReadRegStr $lobsterOldInstallAlternateRegisteredPath HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
      StrCmp $lobsterOldInstallAlternateRegisteredPath "" OldInstallAlternateRegisteredPathReady
        GetFullPathName $lobsterOldInstallAlternateRegisteredPathNormalized "$lobsterOldInstallAlternateRegisteredPath"
      OldInstallAlternateRegisteredPathReady:
      StrCpy $lobsterOldInstallRenameReason "ambiguous-dual-registration"
      StrCmp $lobsterOldInstallAlternateRegisteredPathNormalized $lobsterOldInstallOriginalPathNormalized OldInstallRenameComplete
    ${EndIf}

    StrCpy $lobsterOldInstallRenameReason "install-files-missing"
    IfFileExists "$lobsterOldInstallOriginalPath\${APP_EXECUTABLE_FILENAME}" OldInstallRenameEligible
    IfFileExists "$lobsterOldInstallOriginalPath\${UNINSTALL_FILENAME}" OldInstallRenameEligible
    Goto OldInstallRenameComplete

    OldInstallRenameEligible:
      StrCpy $lobsterOldInstallRenameStatus "failed"
      StrCpy $lobsterOldInstallRenameReason "rename-failed"
      System::Call 'kernel32::GetCurrentProcessId()i .r4'
      StrCpy $lobsterCurrentProcessPid $4
      System::Call 'kernel32::GetTickCount()i .r4'
      StrCpy $lobsterOldInstallBackupPath "$lobsterOldInstallOriginalPath.old.$lobsterCurrentProcessPid.$4"

    OldInstallRenameAttempt:
      IntOp $lobsterOldInstallRenameAttempts $lobsterOldInstallRenameAttempts + 1
      ; Capture the Win32 error in the same System plug-in invocation as the
      ; move. GetLastError after an NSIS Rename/logging call can be stale.
      System::Call 'kernel32::MoveFileW(w "$lobsterOldInstallOriginalPath", w "$lobsterOldInstallBackupPath") i .r4 ?e'
      Pop $lobsterOldInstallRenameError
      IntCmp $4 0 OldInstallRenameAttemptFailed OldInstallRenameAttemptSucceeded OldInstallRenameAttemptSucceeded

    OldInstallRenameAttemptSucceeded:
      StrCpy $lobsterOldInstallRenameStatus "success"

      ; Rename success is only accepted when the source tree is gone and the
      ; complete backup tree is visible at the unique destination.
      IfFileExists "$lobsterOldInstallOriginalPath\*.*" OldInstallRenameVerificationFailed
      IfFileExists "$lobsterOldInstallBackupPath\*.*" 0 OldInstallRenameVerificationFailed
      StrCpy $lobsterOldInstallRenameStatus "success"
      StrCpy $lobsterOldInstallRenameReason "renamed"
      StrCpy $lobsterOldInstallRenameError "0"
      Goto OldInstallRenameComplete

    OldInstallRenameAttemptFailed:
      FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $9 0 END
      !insertmacro GetTimestamp $8
      FileWrite $9 "$8 phase=old-install-rename-attempt attempt=$lobsterOldInstallRenameAttempts result=failed win32_error=$lobsterOldInstallRenameError$\r$\n"
      FileClose $9
      IntCmp $lobsterOldInstallRenameAttempts 3 OldInstallRenameComplete OldInstallRenameRetry OldInstallRenameComplete

    OldInstallRenameRetry:
      Sleep 250
      Goto OldInstallRenameAttempt

    OldInstallRenameVerificationFailed:
      StrCpy $lobsterOldInstallRenameReason "verification-failed"
      StrCpy $lobsterOldInstallRenameError "verification-failed"
      !insertmacro customRollbackOldInstall "rename-verification-failed"
      Goto OldInstallRenameComplete

    OldInstallRenameComplete:
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    StrCpy $2 "false"
    StrCpy $3 "false"
    IfFileExists "$lobsterOldInstallOriginalPath\*.*" 0 OldInstallRenameSourceChecked
      StrCpy $2 "true"
    OldInstallRenameSourceChecked:
    StrCmp $lobsterOldInstallBackupPath "" OldInstallRenameBackupChecked
    IfFileExists "$lobsterOldInstallBackupPath\*.*" 0 OldInstallRenameBackupChecked
      StrCpy $3 "true"
    OldInstallRenameBackupChecked:
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=old-install-rename-complete status=$lobsterOldInstallRenameStatus reason=$lobsterOldInstallRenameReason attempts=$lobsterOldInstallRenameAttempts win32_error=$lobsterOldInstallRenameError elapsed_ms=$5 source_exists=$2 backup_exists=$3 backup_path=$lobsterOldInstallBackupPath cleanup_mode=deferred$\r$\n"
    FileClose $9

    ; The install-scope Defender exclusion is intentionally added by
    ; customAfterUninstallOldVersions, after every legacy uninstaller has
    ; returned. Older uninstallers remove these exclusions during --updated;
    ; adding here would let them undo the protection before payload extraction.
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  ; electron-builder delegates each registry root to this wrapper. A successful
  ; fast-path rename is matched against that root's InstallLocation explicitly;
  ; only the matching legacy uninstaller is skipped. Every other case retains
  ; the stock uninstallOldVersion fallback and its error handling.
  !macro customUninstallOldVersion ROOT_KEY
    StrCpy $lobsterOldUninstallCandidatePath ""
    StrCpy $lobsterOldUninstallCandidatePathNormalized ""
    ClearErrors
    !insertmacro readReg $lobsterOldUninstallCandidatePath ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp $lobsterOldUninstallCandidatePath "" CustomOldUninstallCandidateReady_${ROOT_KEY}
      GetFullPathName $lobsterOldUninstallCandidatePathNormalized "$lobsterOldUninstallCandidatePath"
    CustomOldUninstallCandidateReady_${ROOT_KEY}:

    ${If} $lobsterOldInstallRenameStatus == "success"
    ${AndIf} $lobsterOldUninstallCandidatePathNormalized != ""
    ${AndIf} $lobsterOldUninstallCandidatePathNormalized == $lobsterOldInstallOriginalPathNormalized
      ClearErrors
      StrCpy $R0 0
      FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $9 0 END
      !insertmacro GetTimestamp $8
      FileWrite $9 "$8 phase=old-uninstaller-skipped root=${ROOT_KEY} reason=rename-success registered_instdir=$lobsterOldUninstallCandidatePath backup_path=$lobsterOldInstallBackupPath$\r$\n"
      FileClose $9
    ${Else}
      System::Call 'kernel32::GetTickCount()i .r4'
      StrCpy $lobsterOldUninstallStartTick $4
      FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $9 0 END
      !insertmacro GetTimestamp $8
      FileWrite $9 "$8 phase=old-uninstaller-start root=${ROOT_KEY} registered_instdir=$lobsterOldUninstallCandidatePath rename_status=$lobsterOldInstallRenameStatus$\r$\n"
      FileClose $9

      !insertmacro uninstallOldVersion ${ROOT_KEY}
      IfErrors CustomOldUninstallerLaunchFailed_${ROOT_KEY}
      StrCpy $lobsterOldUninstallLaunchStatus "returned"
      Goto CustomOldUninstallerReturned_${ROOT_KEY}

      CustomOldUninstallerLaunchFailed_${ROOT_KEY}:
      StrCpy $lobsterOldUninstallLaunchStatus "launch-error"

      CustomOldUninstallerReturned_${ROOT_KEY}:
      System::Call 'kernel32::GetTickCount()i .r6'
      IntOp $5 $6 - $lobsterOldUninstallStartTick
      FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $9 0 END
      !insertmacro GetTimestamp $8
      FileWrite $9 "$8 phase=old-uninstaller-returned root=${ROOT_KEY} status=$lobsterOldUninstallLaunchStatus exit=$R0 elapsed_ms=$5$\r$\n"
      FileClose $9

      ; handleUninstallResult calls Quit for a non-zero legacy uninstaller.
      ; Roll the fast-path directory swap back before handing it that result.
      ${If} $R0 != 0
        !insertmacro customRollbackOldInstall "old-uninstaller-nonzero"
      ${EndIf}

      ; The diagnostic writes above can change NSIS' error flag. Recreate the
      ; exact result expected by electron-builder's stock handler.
      StrCmp $lobsterOldUninstallLaunchStatus "launch-error" CustomOldUninstallerRestoreError_${ROOT_KEY}
      ClearErrors
      Goto CustomOldUninstallerHandle_${ROOT_KEY}
      CustomOldUninstallerRestoreError_${ROOT_KEY}:
      SetErrors
      CustomOldUninstallerHandle_${ROOT_KEY}:
      !insertmacro handleUninstallResult ${ROOT_KEY}

      System::Call 'kernel32::GetTickCount()i .r6'
      IntOp $5 $6 - $lobsterOldUninstallStartTick
      FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $9 0 END
      !insertmacro GetTimestamp $8
      FileWrite $9 "$8 phase=old-uninstaller-complete root=${ROOT_KEY} status=handled exit=$R0 elapsed_ms=$5$\r$\n"
      FileClose $9
    ${EndIf}
  !macroend

  ; Runs after every old-install root has either been skipped or fully
  ; uninstalled, immediately before installApplicationFiles. This ordering is
  ; important for transition upgrades: already-installed legacy uninstallers
  ; remove LobsterAI exclusions at the end of their --updated flow.
  !macro customAfterUninstallOldVersions
    DetailPrint "[Installer] Applying Windows Defender install-scope exclusion"
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=defender-exclusion-start point=post-old-uninstaller rename_status=$lobsterOldInstallRenameStatus$\r$\n"
    FileClose $9
    System::Call 'kernel32::GetTickCount()i .r7'

    ${GetParameters} $R9
    ClearErrors
    ${GetOptions} $R9 "/NoDefenderExclusion" $R8
    IfErrors 0 DefenderPostUninstallQueryOnly

    CreateDirectory "$INSTDIR"
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$target = \"$INSTDIR\";\
      try { $$beforePaths = @((Get-MpPreference -ErrorAction Stop).ExclusionPath); $$before = if ($$beforePaths -contains $$target) { \"present\" } else { \"absent\" } } catch { $$before = \"query-failed\" };\
      try { Add-MpPreference -ExclusionPath $$target -ErrorAction Stop; $$add = \"added\" } catch { $$add = \"skipped:\" + $$_.Exception.Message.Trim() };\
      try { $$afterPaths = @((Get-MpPreference -ErrorAction Stop).ExclusionPath); $$after = if ($$afterPaths -contains $$target) { \"present\" } else { \"absent\" } } catch { $$after = \"query-failed\" };\
      Write-Output (\"before=\" + $$before + \" add=\" + $$add + \" after=\" + $$after)"'
    Goto DefenderPostUninstallCommandDone

    DefenderPostUninstallQueryOnly:
    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$targets = @();\
      $$targets += \"$INSTDIR\";\
      $$targets += \"$INSTDIR\resources\cfmind\";\
      $$targets += \"$INSTDIR\resources\python-win\";\
      $$targets += \"$INSTDIR\resources\SKILLs\";\
      $$targets += \"$INSTDIR\resources\app.asar.unpacked\";\
      $$targets += \"$INSTDIR\resources\app.asar\";\
      $$targets += \"$INSTDIR\resources\win-resources.tar\";\
      try { $$beforePaths = @((Get-MpPreference -ErrorAction Stop).ExclusionPath); $$before = @($$targets | Where-Object { $$beforePaths -contains $$_ }).Count } catch { $$before = \"query-failed\" };\
      try { Remove-MpPreference -ExclusionPath $$targets -ErrorAction Stop; $$remove = \"requested\" } catch { $$remove = \"failed:\" + $$_.Exception.Message.Trim() };\
      try { $$afterPaths = @((Get-MpPreference -ErrorAction Stop).ExclusionPath); $$after = @($$targets | Where-Object { $$afterPaths -contains $$_ }).Count } catch { $$after = \"query-failed\" };\
      Write-Output (\"before_count=\" + $$before + \" add=disabled remove=\" + $$remove + \" after_count=\" + $$after)"'

    DefenderPostUninstallCommandDone:
    Pop $0
    Pop $1
    StrCpy $R2 $0
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=defender-exclusion-complete point=post-old-uninstaller exit=$R2 elapsed_ms=$5 output=$1$\r$\n"
    FileClose $9
  !macroend

  ; The remaining hooks are invoked from the version-pinned app-builder-lib
  ; template patch. They use only built-in timing/file operations so the
  ; diagnostics do not add more security-scanned child processes.
  !macro customAppPackageMaterializeStart
    Push $0
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    StrCpy $lobsterPackageMaterializeStartTick $0
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=payload-materialize-start arch=$packageArch dest=$PLUGINSDIR\app-$packageArch.${COMPRESSION_METHOD}$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $0
  !macroend

  !macro customAppPackageMaterializeEnd
    Push $0
    Push $1
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    IntOp $1 $0 - $lobsterPackageMaterializeStartTick
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=payload-materialize-complete arch=$packageArch elapsed_ms=$1$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $1
    Pop $0
  !macroend

  !macro customAppPackageExtractStart MODE SOURCE
    Push $0
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    StrCpy $lobsterPackageExtractStartTick $0
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=payload-7z-extract-start mode=${MODE} arch=$packageArch source=${SOURCE} dest=$OUTDIR$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $0
  !macroend

  !macro customAppPackageExtractEnd MODE RESULT
    Push $0
    Push $1
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    IntOp $1 $0 - $lobsterPackageExtractStartTick
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=payload-7z-extract-complete mode=${MODE} arch=$packageArch result=${RESULT} elapsed_ms=$1$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $1
    Pop $0
  !macroend

  !macro customAppPackageCopyStart
    Push $0
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    StrCpy $lobsterPackageCopyStartTick $0
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=payload-copy-start attempt=$R1 source=$PLUGINSDIR\7z-out dest=$OUTDIR$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $0
  !macroend

  !macro customAppPackageCopyEnd RESULT
    Push $0
    Push $1
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    IntOp $1 $0 - $lobsterPackageCopyStartTick
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=payload-copy-complete attempt=$R1 result=${RESULT} elapsed_ms=$1$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $1
    Pop $0
  !macroend

  !macro customInstallerCacheCopyStart KIND
    Push $0
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    StrCpy $lobsterInstallerCacheCopyStartTick $0
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=installer-cache-copy-start kind=${KIND}$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $0
  !macroend

  !macro customInstallerCacheCopyEnd KIND RESULT
    Push $0
    Push $1
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    IntOp $1 $0 - $lobsterInstallerCacheCopyStartTick
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=installer-cache-copy-complete kind=${KIND} result=${RESULT} elapsed_ms=$1$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $1
    Pop $0
  !macroend

  !macro customEstimatedSizeKnown VALUE
    Push $8
    Push $9
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=estimated-size-scan-skipped source=build-estimate value_kb=${VALUE}$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
  !macroend

  !macro customEstimatedSizeScanStart
    Push $0
    System::Call 'kernel32::GetTickCount()i .r0'
    StrCpy $lobsterEstimatedSizeScanStartTick $0
    Pop $0
  !macroend

  !macro customEstimatedSizeScanEnd VALUE
    StrCpy $lobsterEstimatedSizeValue ${VALUE}
    Push $0
    Push $1
    Push $8
    Push $9
    System::Call 'kernel32::GetTickCount()i .r0'
    IntOp $1 $0 - $lobsterEstimatedSizeScanStartTick
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=estimated-size-scan-complete value_kb=$lobsterEstimatedSizeValue elapsed_ms=$1$\r$\n"
    FileClose $9
    Pop $9
    Pop $8
    Pop $1
    Pop $0
  !macroend
!endif

!macro customInstall
  ; -- Install Timing Log --
  ; Write timestamps to help diagnose slow installation phases.
  ; Log file: %APPDATA%\LobsterAI\install-timing.log

  CreateDirectory "$APPDATA\LobsterAI"
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=app-files-install-complete$\r$\n"
  FileWrite $2 "$8 phase=nsis-extract-complete$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Preparing installation steps"

  ; -- Extract combined resource archive (win-resources.tar) --
  ; All large resource directories (cfmind/, SKILLs/, python-win/) are packed
  ; into a single tar file. NSIS 7z extracts one large file almost instantly;
  ; we then unpack the tar here using Electron's Node runtime.
  ;
  ; The install-scope Defender exclusion was added after every legacy
  ; uninstaller returned and immediately before the NSIS payload extraction;
  ; temporary/legacy entries are trimmed at the end of this macro.

  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'

  DetailPrint "[Installer] Extracting bundled resources"
  ; $R2 = current extractor exit code, $R3 = extractor id for logs.
  ; ($R2 survives GetTimestamp, which clobbers $0 -- see the macro note.)
  StrCpy $R2 ""
  StrCpy $R3 "none"

  ; -- Attempt 1: Windows built-in bsdtar (Win10 1803+) --
  ; Runs a trusted system binary instead of the freshly written app exe,
  ; which security software tends to freeze for cloud analysis on its first
  ; execution (the root cause of installers hanging at this phase).
  IfFileExists "$SYSDIR\tar.exe" 0 TarExtractElectron
  StrCpy $R3 "system-tar"
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-start extractor=system-tar tar=$INSTDIR\resources\win-resources.tar dest=$INSTDIR\resources$\r$\n"
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog '"$SYSDIR\tar.exe" -xf "$INSTDIR\resources\win-resources.tar" -C "$INSTDIR\resources"'
  Pop $0
  StrCpy $R2 $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-exit extractor=system-tar exit=$R2 elapsed_ms=$5$\r$\n"
  FileClose $2
  StrCmp $R2 "error" TarExtractElectron
  IntCmp $R2 0 TarExtractVerify TarExtractElectron TarExtractElectron

  TarExtractElectron:
  ; -- Attempt 2: bundled Electron Node runtime --
  ; Wrapped in a 10-minute watchdog: if security software freezes the child
  ; before it can run, the installer must fail visibly instead of hanging
  ; forever (a killed installer leaves a half-installed app behind).
  StrCpy $R3 "electron"
  DetailPrint "[Installer] Launching bundled extractor"
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-start extractor=electron tar=$INSTDIR\resources\win-resources.tar dest=$INSTDIR\resources$\r$\n"
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r7'

  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "$$p = Start-Process -FilePath \"$INSTDIR\${APP_EXECUTABLE_FILENAME}\" -ArgumentList \"`\"$INSTDIR\resources\unpack-cfmind.cjs`\" `\"$INSTDIR\resources\win-resources.tar`\" `\"$INSTDIR\resources`\" `\"$APPDATA\LobsterAI\install-timing.log`\"\" -NoNewWindow -PassThru; if ($$p.WaitForExit(600000)) { $$p.WaitForExit(); if ($$p.ExitCode -eq $$null) { exit 125 }; exit $$p.ExitCode } else { Stop-Process -Id $$p.Id -Force -ErrorAction SilentlyContinue; exit 124 }"'
  Pop $0
  StrCpy $R2 $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-exit extractor=electron exit=$R2 elapsed_ms=$5$\r$\n"
  FileClose $2

  ; "error" = nsExec couldn't start powershell (check before IntCmp, which
  ; converts non-numeric strings to 0 and would misidentify "error" as success)
  StrCmp $R2 "error" TarExtractProcessFailed
  StrCmp $R2 "124" TarExtractTimeout
  ; IntCmp tolerates trailing whitespace/CR that StrCmp would reject
  IntCmp $R2 0 TarExtractVerify TarExtractNonZero TarExtractNonZero

  TarExtractVerify:
  ; Success requires the OpenClaw runtime entry to actually exist -- an exit
  ; code alone must never trigger deletion of the only recovery source.
  IfFileExists "$INSTDIR\resources\cfmind\gateway-bundle.mjs" TarExtractSucceeded
  IfFileExists "$INSTDIR\resources\cfmind\openclaw.mjs" TarExtractSucceeded
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 reason=entry-missing-after-extract$\r$\n"
  FileClose $2
  ; A bogus system-tar success still gets a shot at the bundled extractor.
  ;
  ; /SD IDOK on this and the failure boxes below: NSIS shows MessageBox even
  ; in /S installs unless a silent default is declared, and the in-app silent
  ; update must never block on an orphan dialog. First-launch recovery retries
  ; the extraction either way.
  StrCmp $R3 "system-tar" TarExtractElectron
  MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction finished but the AI runtime files are still missing. LobsterAI will retry the extraction automatically on first launch. If the app still reports missing runtime files, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
  Goto TarExtractFailed

  TarExtractProcessFailed:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 elapsed_ms=$5 reason=process-start-failed$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction failed: could not start the extractor process (exit=$R2). This is usually caused by antivirus software. LobsterAI will retry the extraction automatically on first launch; if that fails too, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    Goto TarExtractFailed

  TarExtractTimeout:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 elapsed_ms=$5 reason=timeout$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction timed out after 10 minutes -- the extractor process appears to be blocked, usually by antivirus software. LobsterAI will retry the extraction automatically on first launch; if that fails too, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    Goto TarExtractFailed

  TarExtractNonZero:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 elapsed_ms=$5 reason=nonzero-exit$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction failed (exit code $R2). LobsterAI will retry the extraction automatically on first launch; if that fails too, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    Goto TarExtractFailed

  TarExtractSucceeded:
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-complete extractor=$R3 exit=$R2$\r$\n"
  FileClose $2
  ; Completion marker, read by the app for install-integrity diagnostics.
  FileOpen $2 "$INSTDIR\resources\.win-resources-extracted" w
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 source=installer extractor=$R3$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Bundled resources extraction complete"
  ; Only a verified success may delete these: the preserved archive is what
  ; lets the app finish an interrupted extraction at first launch.
  Delete "$INSTDIR\resources\win-resources.tar"
  Delete "$INSTDIR\resources\unpack-cfmind.cjs"
  Goto TarExtractDone

  TarExtractFailed:
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-failed-archive-preserved extractor=$R3 exit=$R2$\r$\n"
  FileClose $2
  TarExtractDone:

  ; -- Restore user-created skills from AppData backup --
  ; The backup was created in customCheckAppRunning before extraction began.
  ; Restore any skills not already present in the new install, then clean up
  ; the backup.
  IfFileExists "$APPDATA\LobsterAI\skills-backup\*.*" 0 SkipSkillRestore
    DetailPrint "[Installer] Restoring user-created skills"
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=skill-restore-start$\r$\n"
    FileClose $2
    System::Call 'kernel32::GetTickCount()i .r7'

    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$ErrorActionPreference = \"Stop\";\
      $$backup    = \"$APPDATA\LobsterAI\skills-backup\";\
      $$newSkills = \"$INSTDIR\resources\SKILLs\";\
      try {\
        New-Item -ItemType Directory -Path $$newSkills -Force | Out-Null;\
        $$restored = 0;\
        Get-ChildItem -Path $$backup -Directory -ErrorAction Stop | ForEach-Object {\
          $$target = Join-Path $$newSkills $$_.Name;\
          if (-not (Test-Path $$target)) {\
            Copy-Item -Path $$_.FullName -Destination $$target -Recurse -Force -ErrorAction Stop;\
            $$restored++\
          }\
        };\
        Remove-Item -Path $$backup -Recurse -Force -ErrorAction Stop;\
        Write-Output (\"restored:\" + $$restored);\
        exit 0\
      } catch {\
        Write-Error $$_.Exception.Message;\
        exit 1\
      }"'
    Pop $0
    Pop $1
    StrCpy $R2 $0
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=skill-restore-complete exit=$R2 elapsed_ms=$5$\r$\n"
    FileWrite $2 "$8 phase=skill-restore-output text=$1$\r$\n"
    FileClose $2

    StrCmp $R2 "0" SkillRestoreValidated
      FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
      FileSeek $2 0 END
      !insertmacro GetTimestamp $8
      FileWrite $2 "$8 phase=skill-restore-failed action=appdata-backup-preserved rename_status=$lobsterOldInstallRenameStatus$\r$\n"
      FileClose $2

      ; On the directory-swap path, restoring the previous application also
      ; restores its original in-place skills. The AppData copy remains as an
      ; additional recovery source because the PowerShell transaction deletes
      ; it only after every skill copy succeeds.
      StrCmp $lobsterOldInstallRenameStatus "success" 0 SkillRestoreFailurePreserved
      System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
      !insertmacro customRollbackOldInstall "skill-restore-failed"
      StrCmp $lobsterOldInstallRollbackStatus "success" SkillRestoreRollbackSucceeded
        MessageBox MB_OK|MB_ICONEXCLAMATION "The LobsterAI update could not restore user skills, and automatic rollback did not complete. No recovery copy was deleted. Previous files: $lobsterOldInstallBackupPath. Partial update: $lobsterOldInstallFailedPath. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
        Goto SkillRestoreAbort
      SkillRestoreRollbackSucceeded:
        MessageBox MB_OK|MB_ICONEXCLAMATION "The LobsterAI update could not restore user skills, so the previous version was restored. Please retry the update. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
      SkillRestoreAbort:
      ${If} ${Silent}
        Banner::destroy
      ${EndIf}
      SetErrorLevel 2
      Quit

    SkillRestoreFailurePreserved:
      ; The stock-uninstaller fallback has no intact directory to roll back.
      ; Continue with the usable new app but retain the AppData backup for a
      ; later retry/manual recovery; cleanup below is fast-path-commit-only.
    SkillRestoreValidated:
  SkipSkillRestore:

  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'

  ; The unpack script is deleted in TarExtractSucceeded above; after a failed
  ; extraction it is intentionally kept alongside win-resources.tar.

  ; -- Rebalance Defender exclusions now that extraction is done --
  ; Unconditionally remove the install-scope whole-directory entry (also the
  ; leftover of an interrupted install -- the entry path is always $INSTDIR,
  ; so this step self-heals it) and the SKILLs entry older installers added.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { $$targets = @(); $$targets += \"$INSTDIR\"; $$targets += \"$INSTDIR\resources\SKILLs\"; Remove-MpPreference -ExclusionPath $$targets -ErrorAction SilentlyContinue; Write-Output \"removed\" } catch { Write-Output (\"failed: \" + $$_.Exception.Message) }"'
  Pop $0
  Pop $1
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=defender-exclusion-trim-complete exit=$0 output=$1$\r$\n"
  FileClose $2

  ; Re-add the permanent entries; skipped entirely when the
  ; /NoDefenderExclusion opt-out is present -- the removals above are not.
  ;
  ; Besides the three runtime trees, this PRE-PROVISIONS the two biggest
  ; single files of the NEXT upgrade: win-resources.tar and app.asar. Field
  ; finding (EICAR-verified on a machine where install-time exclusions never
  ; worked): Defender applies newly added exclusions asynchronously, minutes
  ; later -- entries added mid-install protect nothing, while entries that
  ; have been sitting since the previous install are fully honored. Risk:
  ; the tar path points at a file that only exists during an install, and
  ; app.asar is the same trust class as the already-excluded
  ; app.asar.unpacked. SKILLs stays scannable (user-writable,
  ; agent-executed).
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "/NoDefenderExclusion" $R8
  IfErrors 0 DefenderPermanentAddSkipped
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { $$targets = @(); $$targets += \"$INSTDIR\resources\cfmind\"; $$targets += \"$INSTDIR\resources\python-win\"; $$targets += \"$INSTDIR\resources\app.asar.unpacked\"; $$targets += \"$INSTDIR\resources\app.asar\"; $$targets += \"$INSTDIR\resources\win-resources.tar\"; Add-MpPreference -ExclusionPath $$targets -ErrorAction Stop; Write-Output \"added\" } catch { Write-Output (\"skipped: \" + $$_.Exception.Message) }"'
  Pop $0
  Pop $1
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=defender-exclusion-permanent-complete exit=$0 output=$1$\r$\n"
  FileClose $2
  DefenderPermanentAddSkipped:

  ; Commit the directory swap only after the new application is either fully
  ; runnable or has both artifacts required by its first-launch resource
  ; recovery. Any failed validation restores the complete previous tree before
  ; exiting, and therefore never deletes the recovery source.
  StrCmp $lobsterOldInstallRenameStatus "success" 0 OldInstallCommitDone
  StrCpy $lobsterNewInstallValidationStatus "failed"
  StrCpy $lobsterNewInstallValidationReason "app-executable-missing"
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 OldInstallCommitFailed
  StrCpy $lobsterNewInstallValidationReason "uninstaller-missing"
  IfFileExists "$INSTDIR\${UNINSTALL_FILENAME}" 0 OldInstallCommitFailed
  StrCpy $lobsterNewInstallValidationReason "app-asar-missing"
  IfFileExists "$INSTDIR\resources\app.asar" 0 OldInstallCommitFailed

  ; A verified runtime entry is ideal. If tar extraction failed, retaining the
  ; archive plus recovery script is an explicitly supported recoverable state.
  IfFileExists "$INSTDIR\resources\cfmind\gateway-bundle.mjs" OldInstallCommitValidated
  IfFileExists "$INSTDIR\resources\cfmind\openclaw.mjs" OldInstallCommitValidated
  StrCpy $lobsterNewInstallValidationReason "runtime-and-recovery-artifacts-missing"
  IfFileExists "$INSTDIR\resources\win-resources.tar" 0 OldInstallCommitFailed
  IfFileExists "$INSTDIR\resources\unpack-cfmind.cjs" 0 OldInstallCommitFailed

  OldInstallCommitValidated:
    StrCpy $lobsterNewInstallValidationStatus "success"
    StrCpy $lobsterNewInstallValidationReason "new-install-usable-or-recoverable"
    StrCpy $lobsterOldInstallRenameStatus "committed"
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=old-install-commit-complete status=$lobsterNewInstallValidationStatus reason=$lobsterNewInstallValidationReason backup_path=$lobsterOldInstallBackupPath$\r$\n"
    FileClose $2
    Goto OldInstallCommitDone

  OldInstallCommitFailed:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=old-install-commit-failed status=$lobsterNewInstallValidationStatus reason=$lobsterNewInstallValidationReason backup_path=$lobsterOldInstallBackupPath$\r$\n"
    FileClose $2
    !insertmacro customRollbackOldInstall "new-install-validation-failed"
    StrCmp $lobsterOldInstallRollbackStatus "success" OldInstallCommitRollbackSucceeded
      MessageBox MB_OK|MB_ICONEXCLAMATION "The LobsterAI update could not be validated, and automatic rollback did not complete. No recovery copy was deleted. Previous files: $lobsterOldInstallBackupPath. Partial update: $lobsterOldInstallFailedPath. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
      Goto OldInstallCommitAbort
    OldInstallCommitRollbackSucceeded:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The LobsterAI update could not be validated, so the previous version was restored. Please retry the update. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    OldInstallCommitAbort:
    SetErrorLevel 2
    Quit

  OldInstallCommitDone:

  ; A successful rename keeps the old tree intact during extraction. Only a
  ; validated commit may schedule deletion, and only for this run's exact
  ; backup path. Older interrupted backups remain untouched for recovery.
  ; Pass the path through the environment to avoid shell interpretation of a
  ; user-selected install directory. Exec is asynchronous, so this phase is
  ; "scheduled", not complete.
  ${If} $lobsterOldInstallRenameStatus == "committed"
    StrCpy $0 "success"
    System::Call 'Kernel32::SetEnvironmentVariable(t "LOBSTERAI_OLD_CLEANUP_PATH", t "$lobsterOldInstallBackupPath")i'
    ClearErrors
    Exec 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "Remove-Item -LiteralPath $$env:LOBSTERAI_OLD_CLEANUP_PATH -Recurse -Force -ErrorAction SilentlyContinue"'
    IfErrors 0 +2
      StrCpy $0 "launch-failed"
    System::Call 'Kernel32::SetEnvironmentVariable(t "LOBSTERAI_OLD_CLEANUP_PATH", t "")i'
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=old-install-cleanup-scheduled dispatch=$0 backup_path=$lobsterOldInstallBackupPath target=exact-current-backup cleanup_mode=async-exec-after-commit$\r$\n"
    FileClose $2
  ${EndIf}

  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=install-complete$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Installation complete"

  ${If} ${Silent}
    Banner::destroy
  ${EndIf}
!macroend

; customUnInit intentionally not defined: the uninstaller stops app processes
; through customCheckAppRunning above, which the template invokes after the
; user confirms the uninstall (assisted mode) or immediately for silent /S
; uninstalls. Merely opening the uninstaller no longer kills the running app.

!macro customUnInstall
  ; -- Remove Windows Defender Exclusion on uninstall --
  ; Clean up every exclusion any installer version may have added: the
  ; current permanent set, the SKILLs entry from older versions, the
  ; single-file entries from the path-list era, and the install-scope
  ; whole-directory entry in case an install was interrupted before its
  ; rebalance step ran.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { $$targets = @(); $$targets += \"$INSTDIR\"; $$targets += \"$INSTDIR\resources\cfmind\"; $$targets += \"$INSTDIR\resources\python-win\"; $$targets += \"$INSTDIR\resources\SKILLs\"; $$targets += \"$INSTDIR\resources\app.asar.unpacked\"; $$targets += \"$INSTDIR\resources\win-resources.tar\"; $$targets += \"$INSTDIR\resources\app.asar\"; Remove-MpPreference -ExclusionPath $$targets -ErrorAction SilentlyContinue } catch {}"'
  Pop $0
  Pop $1
!macroend
