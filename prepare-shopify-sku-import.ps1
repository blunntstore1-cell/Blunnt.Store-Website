$sourcePath = 'C:\Users\ragha\Downloads\products_export.csv'
$outputPath = Join-Path $PSScriptRoot 'products_export_with_skus.csv'

$products = Import-Csv -LiteralPath $sourcePath
foreach ($product in $products) {
    if (-not $product.'Variant SKU') {
        $handleSku = ($product.Handle -replace '[^A-Za-z0-9]+', '-').Trim('-').ToUpperInvariant()
        $sizeSku = ($product.'Option1 Value' -replace '[^A-Za-z0-9]+', '-').Trim('-').ToUpperInvariant()
        $product.'Variant SKU' = "BLN-$handleSku-$sizeSku"
    }
}

$duplicateSkus = $products | Group-Object 'Variant SKU' | Where-Object { $_.Count -gt 1 }
if ($duplicateSkus) { throw "Duplicate SKU generated: $($duplicateSkus.Name -join ', ')" }
if ($products | Where-Object { -not $_.'Variant SKU' }) { throw 'One or more variant SKUs are blank.' }

$products | Export-Csv -LiteralPath $outputPath -NoTypeInformation -Encoding utf8
Write-Output "Created $outputPath with $($products.Count) variant rows."
