; Inno Setup — installeur Windows du moteur AudioSplit.
; Compile : ISCC.exe installer.iss  (attend ..\dist\AudioSplitEngine\ produit par PyInstaller)
; - installe sans droits admin (dans %LOCALAPPDATA%)
; - enregistre le schéma audiosplit:// pointant vers le moteur

#define AppName "AudioSplit Engine"
#define AppVersion "0.1.0"
#define ExeName "AudioSplitEngine.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\AudioSplitEngine
DefaultGroupName=AudioSplit
PrivilegesRequired=lowest
OutputBaseFilename=AudioSplit-Engine-Windows
Compression=lzma2
SolidCompression=yes
DisableProgramGroupPage=yes
UninstallDisplayName={#AppName}

[Files]
Source: "..\dist\AudioSplitEngine\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Registry]
; Schéma d'URL custom (HKCU, pas besoin d'admin).
Root: HKCU; Subkey: "Software\Classes\audiosplit"; ValueType: string; ValueName: ""; ValueData: "URL:AudioSplit Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\audiosplit"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\audiosplit\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeName}"" ""%1"""

[Run]
; Démarre le moteur une fois l'install finie (silencieux).
Filename: "{app}\{#ExeName}"; Description: "Démarrer le moteur"; Flags: nowait postinstall skipifsilent
