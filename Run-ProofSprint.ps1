param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CommandArgs)
$ErrorActionPreference = 'Stop'
$localRuntime = Join-Path $PSScriptRoot '..\.runtime\node-v24.22.2-win-x64'
$runtimeNode = Join-Path $localRuntime 'node.exe'
if (-not (Test-Path -LiteralPath $runtimeNode)) {
    $runtimeNode = (Get-Command node -ErrorAction Stop).Source
    $major = [int]((& $runtimeNode --version).TrimStart('v').Split('.')[0])
    if ($major -ne 24) { throw 'ProofSprint needs Node 24. Install Node 24 or restore the documented local runtime.' }
    $localRuntime = Split-Path -Parent $runtimeNode
}
$previousPath = $env:PATH
$previousRolldownThreads = $env:ROLLDOWN_WORKER_THREADS
$previousRayonThreads = $env:RAYON_NUM_THREADS
Push-Location -LiteralPath $PSScriptRoot
try {
    $env:PATH = $localRuntime + [IO.Path]::PathSeparator + $env:PATH
    if (-not $CommandArgs -or $CommandArgs.Count -eq 0) { $CommandArgs = @('demo', 'unique') }
    if ($CommandArgs[0] -eq 'test') {
        $tests = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'test') -Filter '*.test.mjs' -File | ForEach-Object FullName)
        & $runtimeNode --test --test-concurrency=1 @tests
    } elseif ($CommandArgs[0] -eq 'workbench') {
        $extraArgs = @($CommandArgs | Select-Object -Skip 1)
        & $runtimeNode (Join-Path $PSScriptRoot 'src\workbench.mjs') @extraArgs
    } elseif ($CommandArgs[0] -eq 'agent-build' -or $CommandArgs[0] -eq 'agent-info' -or $CommandArgs[0] -eq 'typecheck') {
        if ($CommandArgs[0] -eq 'agent-build') {
            if (-not $env:ROLLDOWN_WORKER_THREADS) { $env:ROLLDOWN_WORKER_THREADS = '1' }
            if (-not $env:RAYON_NUM_THREADS) { $env:RAYON_NUM_THREADS = '1' }
        }
        $scriptName = @{ 'agent-build' = 'agent:build'; 'agent-info' = 'agent:info'; 'typecheck' = 'typecheck' }[$CommandArgs[0]]
        if ($CommandArgs[0] -eq 'agent-build') {
            & $runtimeNode (Join-Path $PSScriptRoot 'node_modules\eve\bin\eve.js') build --skip-sandbox-prewarm
        } else {
            & (Join-Path $localRuntime 'npm.cmd') run $scriptName
        }
    } else {
        & $runtimeNode (Join-Path $PSScriptRoot 'src\cli.mjs') @CommandArgs
    }
    if ($LASTEXITCODE -ne 0) { throw "ProofSprint exited with code $LASTEXITCODE" }
} finally {
    $env:PATH = $previousPath
    $env:ROLLDOWN_WORKER_THREADS = $previousRolldownThreads
    $env:RAYON_NUM_THREADS = $previousRayonThreads
    Pop-Location
}
