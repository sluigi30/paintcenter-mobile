# Import room photos into assets/testset/ and regenerate the manifest.
#
#   .\import-testset.ps1 -FromPhone              # adb pull today's camera photos
#   .\import-testset.ps1 -FromPhone -Days 3      # ...from the last 3 days
#   .\import-testset.ps1 -From "C:\photos"       # from a local folder
#   .\import-testset.ps1 -ManifestOnly           # just rescan assets/testset/
#
# Downscales to 1280 px on the long edge (JPEG q82) so the whole set is small
# enough to commit -- a committed set is what makes results comparable across
# builds. See TESTSET.md.

param(
    [switch]$FromPhone,
    [string]$From = "",
    [switch]$ManifestOnly,
    [int]$Days = 1,
    [string]$Serial = "",
    [int]$MaxEdge = 1280,
    [int]$Quality = 82
)

$ErrorActionPreference = "Stop"
$root    = $PSScriptRoot
$destDir = Join-Path $root "assets\testset"
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force $destDir | Out-Null }

Add-Type -AssemblyName System.Drawing

function Save-Resized {
    param([string]$SrcPath, [string]$DestPath)

    $img = [System.Drawing.Image]::FromFile($SrcPath)
    try {
        $w = $img.Width; $h = $img.Height
        $scale = [Math]::Min(1.0, $MaxEdge / [Math]::Max($w, $h))
        $nw = [int]([Math]::Round($w * $scale))
        $nh = [int]([Math]::Round($h * $scale))

        $bmp = New-Object System.Drawing.Bitmap $nw, $nh
        try {
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $g.DrawImage($img, 0, 0, $nw, $nh)
            } finally { $g.Dispose() }

            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                     Where-Object { $_.MimeType -eq "image/jpeg" }
            $ps = New-Object System.Drawing.Imaging.EncoderParameters 1
            $ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
            $bmp.Save($DestPath, $codec, $ps)
            $ps.Dispose()
        } finally { $bmp.Dispose() }

        return "$nw" + "x" + "$nh"
    } finally { $img.Dispose() }
}

# ── Gather sources ───────────────────────────────────────────────────────────
$sources = @()

if (-not $ManifestOnly) {
    if ($FromPhone) {
        $adbArgs = @()
        if ($Serial -ne "") { $adbArgs += @("-s", $Serial) }

        $stage = Join-Path $env:TEMP "ncm-testset-pull"
        if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
        New-Item -ItemType Directory -Force $stage | Out-Null

        Write-Host "Listing camera photos from the device..." -ForegroundColor Cyan
        $cutoff = (Get-Date).AddDays(-$Days).ToString("yyyy-MM-dd")
        # -newermt needs a shell on the device; keep it simple and filter locally.
        $listing = & adb @adbArgs shell "ls -1 /sdcard/DCIM/Camera/ 2>/dev/null"
        if (-not $listing) {
            Write-Host "Nothing at /sdcard/DCIM/Camera. Pass -From <folder> instead." -ForegroundColor Red
            exit 1
        }

        $names = $listing -split "`n" | ForEach-Object { $_.Trim() } |
                 Where-Object { $_ -match "\.(jpg|jpeg|png)$" }

        # Xiaomi/Infinix name files IMG_yyyyMMdd_HHmmss.jpg - filter on that.
        $want = @()
        foreach ($n in $names) {
            if ($n -match "(\d{8})") {
                $d = $Matches[1]
                $iso = "$($d.Substring(0,4))-$($d.Substring(4,2))-$($d.Substring(6,2))"
                if ($iso -ge $cutoff) { $want += $n }
            }
        }
        if ($want.Count -eq 0) {
            Write-Host "No photos newer than $cutoff. Try -Days 7." -ForegroundColor Yellow
            exit 1
        }

        Write-Host "Pulling $($want.Count) file(s)..." -ForegroundColor Cyan
        foreach ($n in $want) {
            & adb @adbArgs pull "/sdcard/DCIM/Camera/$n" (Join-Path $stage $n) | Out-Null
        }
        $sources = Get-ChildItem $stage -File | Sort-Object Name
    }
    elseif ($From -ne "") {
        if (-not (Test-Path $From)) { Write-Host "No such folder: $From" -ForegroundColor Red; exit 1 }
        $sources = Get-ChildItem $From -File |
                   Where-Object { $_.Extension -match "^\.(jpg|jpeg|png)$" } |
                   Sort-Object Name
    }
    else {
        Write-Host "Pass -FromPhone, -From <folder>, or -ManifestOnly." -ForegroundColor Yellow
        exit 1
    }
}

# ── Resize into assets/testset/ ──────────────────────────────────────────────
if (-not $ManifestOnly) {
    Write-Host "`nResizing $($sources.Count) image(s) to max ${MaxEdge}px..." -ForegroundColor Cyan
    $i = 0
    foreach ($s in $sources) {
        $i++
        $name = "{0:D2}.jpg" -f $i
        $dest = Join-Path $destDir $name
        if (Test-Path $dest) { Remove-Item -Force $dest }
        $dims = Save-Resized -SrcPath $s.FullName -DestPath $dest
        $kb = [int]((Get-Item $dest).Length / 1KB)
        Write-Host ("  {0,-28} -> {1,-12} {2,6} {3} KB" -f $s.Name, $name, $dims, $kb)
    }
    Write-Host "`nNow RENAME them to match the shot list in TESTSET.md" -ForegroundColor Yellow
    Write-Host "(e.g. 01-smooth-white.jpg), then run: .\import-testset.ps1 -ManifestOnly" -ForegroundColor Yellow
}

# ── Manifest ─────────────────────────────────────────────────────────────────
# `require` needs literal paths, so the list has to be generated rather than
# globbed at runtime.
$files = Get-ChildItem $destDir -File |
         Where-Object { $_.Extension -match "^\.(jpg|jpeg|png)$" } |
         Sort-Object Name

if ($files.Count -eq 0) {
    Write-Host "`nassets/testset/ is empty - nothing to write." -ForegroundColor Yellow
    exit 0
}

# Preserve any notes already written into the existing manifest.
$notes = @{}
$manifestPath = Join-Path $destDir "manifest.js"
if (Test-Path $manifestPath) {
    foreach ($line in Get-Content $manifestPath) {
        if ($line -match "file:\s*'([^']+)'.*note:\s*'([^']*)'") {
            $notes[$Matches[1]] = $Matches[2]
        }
    }
}

$sb = New-Object System.Text.StringBuilder
# Single-quoted on purpose: in a double-quoted PowerShell string a backtick is the
# escape character, so a literal `note` turned into a newline and emitted a line
# of bare text that broke the generated JS.
[void]$sb.AppendLine('// GENERATED by import-testset.ps1 - re-run it after adding or renaming images.')
[void]$sb.AppendLine('// The note field is hand-written and preserved across regeneration: say what')
[void]$sb.AppendLine('// the image is meant to break, so a failure explains itself later. See TESTSET.md.')
[void]$sb.AppendLine("export const TEST_IMAGES = [")
foreach ($f in $files) {
    $note = ""
    if ($notes.ContainsKey($f.Name)) { $note = $notes[$f.Name] }
    [void]$sb.AppendLine("  { file: '$($f.Name)', note: '$note', src: require('./$($f.Name)') },")
}
[void]$sb.AppendLine("];")

[System.IO.File]::WriteAllText($manifestPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))

$totalKb = [int](($files | Measure-Object -Property Length -Sum).Sum / 1KB)
Write-Host "`nWrote manifest.js with $($files.Count) image(s), $totalKb KB total." -ForegroundColor Green
Write-Host "Open the preview screen's Test Bench to run them." -ForegroundColor Green
