param(
    [string]$SshHost = "dripvid",
    [string]$BackupRoot = "C:\pinokio\backups\dripvid\config",
    [int]$Keep = 30,
    [int]$MaxRetries = 3
)

$ErrorActionPreference = "Stop"
$ssh = Join-Path $env:SystemRoot "System32\OpenSSH\ssh.exe"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP "dripvid-config-backup"
if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$spec = @(
    @{ name = "dripvid.env";            path = "/etc/dripvid/dripvid.env";                        sudo = $true  },
    @{ name = "dripvid-jarvis.env";     path = "/etc/dripvid-jarvis.env";                         sudo = $true  },
    @{ name = "nginx-dripvid.conf";     path = "/etc/nginx/sites-enabled/dripvid";                sudo = $false },
    @{ name = "nginx-jellyseerr.conf";  path = "/etc/nginx/sites-enabled/jellyseerr";             sudo = $false },
    @{ name = "dripvid.service";        path = "/etc/systemd/system/dripvid.service";             sudo = $false },
    @{ name = "dripvid-jarvis.service"; path = "/etc/systemd/system/dripvid-jarvis.service";      sudo = $false },
    @{ name = "dripvid-mcp.service";    path = "/etc/systemd/system/dripvid-mcp.service";         sudo = $false },
    @{ name = "hosts";                  path = "/etc/hosts";                                       sudo = $false }
)

$remoteScript = @'
set -e
emit() {
  local name="$1" path="$2" sudo_p="$3"
  echo "@@BEGIN:$name"
  if [ "$sudo_p" = "1" ]; then
    base64 -w0 < <(sudo -n cat "$path") 2>/dev/null
  else
    base64 -w0 < "$path" 2>/dev/null
  fi
  echo ""
  echo "@@END:$name"
}
'@
foreach ($s in $spec) {
    $sPath = $s.path -replace "'", "'\\''"
    $sName = $s.name
    $sSudo = if ($s.sudo) { "1" } else { "0" }
    $remoteScript += "`nemit '$sName' '$sPath' '$sSudo'"
}

$b64Remote = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($remoteScript -replace "`r`n", "`n")))
$shaRemote = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($remoteScript))) -Algorithm SHA256).Hash.Substring(0,12)

$raw = $null
for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
    $raw = (& $ssh -o BatchMode=yes -o ConnectTimeout=25 -o ServerAliveInterval=10 $SshHost "echo $b64Remote | base64 -d | bash -s" 2>$null) -join "`n"
    if ($LASTEXITCODE -eq 0 -and $raw -match '@@BEGIN:dripvid.env') { break }
    Write-Output "attempt $attempt failed (exit=$LASTEXITCODE); retrying..."
    Start-Sleep -Seconds 5
}
if (-not $raw -or $raw -notmatch '@@') { Write-Error "backup stream failed after $MaxRetries attempts"; exit 1 }

$blocks = @{}
$lines = $raw -split "`n"
$cur = $null
foreach ($line in $lines) {
    if ($line -match '^@@BEGIN:(.+)$') { $cur = $Matches[1]; $blocks[$cur] = [System.Collections.Generic.List[string]]::new() }
    elseif ($line -match '^@@END:.+$') { $cur = $null }
    elseif ($null -ne $cur) { $blocks[$cur].Add($line) }
}

$manifest = New-Object System.Collections.ArrayList
foreach ($s in $spec) {
    $name = $s.name
    if (-not $blocks.ContainsKey($name)) {
        $null = $manifest.Add([pscustomobject]@{ name = $name; path = $s.path; ok = $false; bytes = 0 })
        continue
    }
    $b64 = ($blocks[$name] -join "")
    try {
        $bytes = [Convert]::FromBase64String($b64)
        $outPath = Join-Path $tmp $name
        [System.IO.File]::WriteAllBytes($outPath, $bytes)
        $null = $manifest.Add([pscustomobject]@{ name = $name; path = $s.path; ok = $true; bytes = $bytes.Length })
    } catch {
        $null = $manifest.Add([pscustomobject]@{ name = $name; path = $s.path; ok = $false; bytes = 0 })
    }
}

$bad = @($manifest | Where-Object { -not $_.ok })
if ($bad.Count -gt 0) { Write-Error "files missing/failed: $(($bad.name) -join ', ')"; exit 1 }

$dest = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -LiteralPath $tmp -File | Copy-Item -Destination $dest
[System.IO.File]::WriteAllText((Join-Path $dest "manifest.json"), ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $BackupRoot "latest.txt"), $dest + "`n", (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText((Join-Path $dest "backup.info"), "host=$SshHost`nstream_sha=$shaRemote`nfiles=$($manifest.Count)`nat=$(Get-Date -Format o)`n", (New-Object System.Text.UTF8Encoding($false)))

$all = @(Get-ChildItem -LiteralPath $BackupRoot -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' } | Sort-Object Name)
if ($all.Count -gt $Keep) {
    $all | Select-Object -First ($all.Count - $Keep) | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
        Write-Output "pruned: $($_.FullName)"
    }
}

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "backup OK: $($manifest.Count) files -> $dest"