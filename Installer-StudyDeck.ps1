# Installe StudyDeck pour l'utilisateur courant et crée les raccourcis.
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$exeSrc = Join-Path $src 'StudyDeck.exe'
if (-not (Test-Path $exeSrc)) { Write-Host "StudyDeck.exe introuvable à côté de ce script." -ForegroundColor Red; Read-Host "Entrée pour fermer"; exit 1 }
$dest = Join-Path $env:LOCALAPPDATA 'StudyDeck'
Write-Host "Copie vers $dest ..."
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest | Out-Null
Get-ChildItem -Path $src -Exclude 'Installer-StudyDeck.ps1' | Copy-Item -Destination $dest -Recurse -Force
$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'StudyDeck.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'StudyDeck.lnk'))) {
  $s = $shell.CreateShortcut($lnk); $s.TargetPath = Join-Path $dest 'StudyDeck.exe'; $s.WorkingDirectory = $dest; $s.Save()
}
Write-Host "StudyDeck est installé. Raccourcis créés sur le Bureau et dans le menu Démarrer." -ForegroundColor Green
Read-Host "Entrée pour fermer"
