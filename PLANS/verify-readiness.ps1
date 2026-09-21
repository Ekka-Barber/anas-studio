$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$evidencePath = Join-Path $PSScriptRoot 'evidence/preflight-checks.json'
$checks = [Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Pass, [string]$Detail) {
    $checks.Add([pscustomobject]@{ name = $Name; pass = $Pass; detail = $Detail })
}

Push-Location $repo
try {
    $required = @('AGENTS.md', 'CLAUDE.md', '.env.example', '.claude/settings.json',
        '.mcp.json', '.claude/agents/opus-worker.md', '.claude/agents/opus-worker-lite.md',
        '.claude/agents/auditor.md', 'PLANS/PREFLIGHT.md', 'PLANS/SKILLS.md',
        'PLANS/README.md', 'PLANS/FIRST-GLM-PROMPT.md', 'PLANS/verify-plan.ps1', 'graft/INDEX.md')
    $missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
    Add-Check 'required_files' ($missing.Count -eq 0) ($missing -join ', ')
    if (Test-Path -LiteralPath 'CLAUDE.md') {
        $lines = @(Get-Content -LiteralPath 'CLAUDE.md')
        Add-Check 'claude_entry_length' ($lines.Count -le 60) "$($lines.Count) lines; maximum 60"
    }
    foreach ($file in @('.claude/settings.json', '.mcp.json')) {
        try {
            $body = [IO.File]::ReadAllText((Join-Path $repo $file))
            $null = $body | ConvertFrom-Json
            # Credential-valued JSON fields must be empty or an environment reference.
            $literal = $body -match '"[^"\r\n]*(?:api[_-]?key|secret|password|auth[_-]?token)[^"\r\n]*"\s*:\s*"(?!\$\{)[^"\r\n]+"'
            Add-Check "json_and_no_literal_credentials:$file" (-not $literal) 'JSON syntax and credential-field check; no values reported'
        } catch { Add-Check "json_and_no_literal_credentials:$file" $false 'Missing or invalid JSON; contents withheld' }
    }
    if (Test-Path -LiteralPath '.env.example') {
        $values = @(Get-Content -LiteralPath '.env.example' | Where-Object { $_ -match '^[A-Z][A-Z0-9_]*=\s*\S' })
        Add-Check 'blank_env_template' ($values.Count -eq 0) 'Only blank assignments and comments are permitted'
    }
    $tracked = @(& git ls-files)
    $gitOk = $LASTEXITCODE -eq 0
    $trackedEnv = @($tracked | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '(^|/)\.env\.example$' })
    Add-Check 'env_not_tracked' ($gitOk -and $trackedEnv.Count -eq 0) 'Checks paths only; never opens .env'
    $null = & git check-ignore -q .env
    Add-Check 'env_ignored' ($LASTEXITCODE -eq 0) 'Local .env must remain ignored'

    $pattern = '(cfat_[A-Za-z0-9_-]{16,}|sbp_[A-Za-z0-9]{16,}|re_A[A-Za-z0-9_]{15,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})'
    # Git prints filenames only. Forbidden inputs and actual env files are excluded.
    try {
        $hits = @(& git grep -I -l -E -e $pattern -- . ':(exclude)_archive/**' ':(exclude)deploy/design/**' ':(exclude)BOOK_ASSETS/**' ':(exclude).env' ':(exclude).env.*' ':(exclude)**/.env' ':(exclude)**/.env.*' 2>$null)
        $scanExit = $LASTEXITCODE
    } catch { $hits = @(); $scanExit = 2 }
    if ((Test-Path -LiteralPath '.env.example') -and [IO.File]::ReadAllText((Join-Path $repo '.env.example')) -match $pattern) {
        $hits += '.env.example'; $scanExit = 0
    }
    Add-Check 'tracked_secret_patterns' ($scanExit -eq 1) $(if ($scanExit -eq 0) { 'Candidate files: ' + ($hits -join ', ') } elseif ($scanExit -eq 1) { 'No known-format candidates in permitted tracked text; not exhaustive' } else { 'Git scan failed' })
    $samples = @(('cfat_' + ('A' * 24)), ('sbp_' + ('B' * 24)), ('re_A' + ('C' * 24)), ('sk-' + ('D' * 24)), ('AKIA' + ('E' * 16)))
    $caught = @($samples | Where-Object { $_ -match $pattern })
    Add-Check 'secret_detector_self_check' ($caught.Count -eq 5 -and 'PAYLOAD_SECRET=' -notmatch $pattern) 'Synthetic positive samples and blank-template negative sample; no values emitted'

    foreach ($command in @('graft', 'codegraph')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            Add-Check "$command`_freshness" $false 'Tool unavailable; no automatic install'
            continue
        }
        try {
            $output = if ($command -eq 'graft') { & graft check 2>&1 } else { & codegraph status 2>&1 }
            $toolExit = $LASTEXITCODE
        } catch { $output = @(); $toolExit = 1 }
        $fresh = $toolExit -eq 0 -and ($command -ne 'codegraph' -or ($output -join "`n") -match 'Index is up to date')
        Add-Check "$command`_freshness" $fresh "Exit $toolExit; code graphs do not index every planning document"
    }
    # Windows PowerShell's legacy verifier emits CRLF/BOM JSON. Keep evidence
    # compatible with the repository's existing git diff --check requirement.
    $planEvidence = Join-Path $PSScriptRoot 'evidence/planning-checks.json'
    foreach ($path in @($planEvidence, $evidencePath)) {
        if (Test-Path -LiteralPath $path) {
            [IO.File]::WriteAllText($path, [IO.File]::ReadAllText($path).Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
        }
    }
    try {
        $planOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-plan.ps1') 2>&1
        $planExit = $LASTEXITCODE
    } catch { $planExit = 1 }
    if (Test-Path -LiteralPath $planEvidence) {
        [IO.File]::WriteAllText($planEvidence, [IO.File]::ReadAllText($planEvidence).Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
    }
    Add-Check 'verify_plan' ($planExit -eq 0) "Exit $planExit; requires all 360 frozen hashes, scope ownership, links, and PLANS-only dirty paths"
    if ($planExit -ne 0) { Write-Host 'Plan verification failed. Run PLANS/verify-plan.ps1 directly for its finding.' }

    $previous = if (Test-Path -LiteralPath $evidencePath) { Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json } else { $null }
    $failed = @($checks | Where-Object { -not $_.pass })
    $result = [ordered]@{
        checked_at_utc = [DateTime]::UtcNow.ToString('o')
        preparation_only = $true
        recovery = $previous.recovery
        baseline_issue = $previous.baseline_issue
        tooling_refresh = $previous.tooling_refresh
        result = $(if ($failed.Count) { 'fail' } else { 'pass' })
        checked_commit = (& git rev-parse HEAD)
        checks = @($checks.ToArray())
        scan_exclusions = @('_archive/', 'deploy/design/', 'BOOK_ASSETS/', 'actual .env files')
        env_contents_read = $false
        runtime_tested = $false
        launch_ready = $false
    }
    [IO.File]::WriteAllText($evidencePath, ($result | ConvertTo-Json -Depth 8).Replace("`r`n", "`n") + "`n", [Text.UTF8Encoding]::new($false))
    $checks | Format-Table name, pass, detail -AutoSize
    if ($failed.Count) { throw "Readiness failed: $($failed.name -join ', ')" }
    Write-Host 'PASS: preparation structure and plan checks. Runtime and external gates remain unaccepted.'
} finally { Pop-Location }
