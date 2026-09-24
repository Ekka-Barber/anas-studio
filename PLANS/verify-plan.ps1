$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$required = @('README.md', 'DECISIONS.md', 'ARCHITECTURE.md', 'DATA-AND-SECURITY.md', 'WORK-PACKAGES.md', 'COVERAGE.md', 'VERIFICATION.md', 'DESIGN-AUDIT.md', 'research-final.md', 'SOURCE-NOTES.md', 'KICKOFF.md', 'EXECUTION-STATUS.md', 'ISSUES.md')
foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "Missing plan: $name" }
}
$work = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'WORK-PACKAGES.md'))
$packages = @([regex]::Matches($work, '(?m)^## (P\d{2}):') | ForEach-Object { $_.Groups[1].Value })
$expectedPackages = @(0..12 | ForEach-Object { 'P{0:D2}' -f $_ })
if (Compare-Object $expectedPackages $packages) { throw 'Package headings must be exactly P00-P12.' }
$coverage = [IO.File]::ReadAllLines((Join-Path $PSScriptRoot 'COVERAGE.md'))
$rows = @($coverage | Where-Object { $_ -match '^\| C\d{2} \|' })
if ($rows.Count -ne 40) { throw 'Expected 40 coverage rows.' }
$ids = @()
foreach ($row in $rows) {
    $id = [regex]::Match($row, '^\| (C\d{2}) \|').Groups[1].Value
    $ids += $id
    $owners = [regex]::Matches($row, '\*\*(P\d{2})\*\*')
    if ($owners.Count -ne 1) { throw "Expected exactly one owner: $id" }
    $owner = $owners[0].Groups[1].Value
    if ($owner -eq 'P12' -or $owner -notin $packages) { throw "Invalid contractual owner: $id $owner" }
    $section = [regex]::Match($work, "(?ms)^## ${owner}:.*?(?=^## P\d{2}:|\z)").Value
    $ownerLine = [regex]::Match($section, '(?m)^Depends[^\r\n]*').Value
    if ($ownerLine -notmatch "\b$id\b") { throw "Package ownership disagrees: $id $owner" }
}
$expectedIds = @(1..40 | ForEach-Object { 'C{0:D2}' -f $_ })
if (Compare-Object $expectedIds $ids) { throw 'Coverage IDs must be exactly C01-C40.' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence/source-manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($entry in $manifest) {
    if ($entry.path -match '(^|[/\\])_archive([/\\]|$)') { throw 'Archive access is forbidden.' }
    $source = Join-Path $repo $entry.path
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing frozen source: $($entry.path)" }
    if ((Get-Item -LiteralPath $source).Length -ne $entry.bytes) { throw "Changed bytes: $($entry.path)" }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Changed hash: $($entry.path)" }
}
foreach ($name in $required) {
    $body = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $name))
    foreach ($link in [regex]::Matches($body, '\]\(([^)]+)\)')) {
        $target = $link.Groups[1].Value.Trim('<', '>').Split('#')[0]
        if (-not $target -or $target -match '^[a-zA-Z]+:' -or $target.StartsWith('/')) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $target))) { throw "Broken local link in ${name}: $target" }
    }
}
& git -C $repo diff --check
if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed.' }
[ordered]@{
    checked_at_utc = [DateTime]::UtcNow.ToString('o')
    result = 'pass'
    required_documents = $required.Count
    packages = $packages.Count
    coverage_rows = $rows.Count
    unique_owner_per_row = $true
    package_owner_agreement = $true
    bonus_has_no_contract_owner = $true
    frozen_files_verified = $manifest.Count
    local_links = 'pass'
    diff_whitespace = 'pass'
    application_runtime_tested = $false
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'evidence/planning-checks.json') -Encoding utf8
"PASS: $($required.Count) documents; $($packages.Count) packages; $($rows.Count) unique scope owners; $($manifest.Count) frozen hashes."
