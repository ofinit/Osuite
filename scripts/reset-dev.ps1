# Stops dev services and wipes both dev databases + the stored licence (fresh install).
foreach ($port in 47800, 47900) {
  $p = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
  if ($p) { Stop-Process -Id $p -Force -Confirm:$false }
}
$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { 'C:\Program Files\PostgreSQL\17\bin' }
& (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p 54329 -U osuite -d postgres -q `
  -c "drop database if exists osuite with (force)" -c "create database osuite" `
  -c "drop database if exists osuite_admin with (force)" -c "create database osuite_admin"
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $PSScriptRoot '..\.data\license.token')
"dev environment reset"
