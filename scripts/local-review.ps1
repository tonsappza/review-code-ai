param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path ".env")) {
    throw "Missing .env file"
}

$ghToken = gh auth token 2>$null
if ($ghToken) {
    $env:GITHUB_TOKEN = $ghToken
}
elseif ((-not $env:GITHUB_TOKEN) -or ($env:GITHUB_TOKEN -eq "ghp_your_token_here")) {
    throw "Run gh auth login or set GITHUB_TOKEN in .env"
}

Get-Content ".env" | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if ([Environment]::GetEnvironmentVariable($name, "Process")) { return }
    Set-Item -Path ("Env:" + $name) -Value $value
}

if ((-not $env:GITHUB_REPOSITORY) -and $env:TARGET_REPOSITORY) {
    $env:GITHUB_REPOSITORY = $env:TARGET_REPOSITORY
}

if (-not $env:GITHUB_REPOSITORY) {
    throw "Set TARGET_REPOSITORY=owner/repo in .env"
}
if (-not $env:PR_NUMBER) {
    throw "Set PR_NUMBER in .env"
}

$parts = $env:GITHUB_REPOSITORY -split "/"
if ($parts.Length -ne 2) {
    throw ("Invalid repository: " + $env:GITHUB_REPOSITORY)
}

if ((-not $env:REVIEW_CWD) -or ($env:REVIEW_CWD -eq "")) {
    $targetDir = Join-Path $Root ".review-target"
    $prJson = gh pr view $env:PR_NUMBER --repo $env:GITHUB_REPOSITORY --json headRefName,headRepository,headRepositoryOwner
    if ($LASTEXITCODE -ne 0) {
        throw "gh pr view failed"
    }

    $pr = $prJson | ConvertFrom-Json
    $headOwner = $pr.headRepositoryOwner.login
    if (-not $headOwner) { $headOwner = $parts[0] }
    $headRepo = $pr.headRepository.name
    if (-not $headRepo) { $headRepo = $parts[1] }
    $headRef = $pr.headRefName
    $cloneUrl = "https://github.com/" + $headOwner + "/" + $headRepo + ".git"

    Write-Host ("Checkout " + $cloneUrl + " branch " + $headRef)
    if (Test-Path $targetDir) {
        Remove-Item -Recurse -Force $targetDir
    }
    git clone --depth 1 --branch $headRef $cloneUrl $targetDir
    $env:REVIEW_CWD = $targetDir
}

if (-not $env:REPORTS_DIR) {
    $env:REPORTS_DIR = "reports"
}

Write-Host ("Reviewing " + $env:GITHUB_REPOSITORY + " PR #" + $env:PR_NUMBER)
$targetForCleanup = $env:REVIEW_CWD
$managedTarget = Join-Path $Root ".review-target"
try {
    npm run review
} finally {
    $keep = $env:KEEP_REVIEW_TARGET
    if ($keep -eq "1" -or $keep -eq "true" -or $keep -eq "yes") {
        Write-Host "Keeping clone (KEEP_REVIEW_TARGET)"
    } elseif ($targetForCleanup -and (Test-Path $targetForCleanup)) {
        $resolved = (Resolve-Path $targetForCleanup).Path
        $managedResolved = (Resolve-Path $managedTarget -ErrorAction SilentlyContinue)
        if ($managedResolved -and $resolved -eq $managedResolved.Path) {
            Remove-Item -Recurse -Force $targetForCleanup -ErrorAction SilentlyContinue
            Write-Host "Removed clone $targetForCleanup"
        }
    }
}
