$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# Explicit $LASTEXITCODE checks after every native call. PowerShell 5.1 has no
# '&&', and an unchecked native exit code is exactly a check-13 defect: the
# script would report success while the command underneath it failed.

npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed'; exit 1 }

npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Error 'typecheck failed'; exit 1 }

npm test
if ($LASTEXITCODE -ne 0) { Write-Error 'tests failed'; exit 1 }

exit 0
