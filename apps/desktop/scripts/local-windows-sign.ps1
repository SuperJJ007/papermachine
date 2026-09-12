# Local acceptance uses an existing certificate; this script never installs trust or exports keys.
$ErrorActionPreference = 'Stop'
$thumbprint = $env:DSH_LOCAL_SIGN_CERT
$target = $env:DSH_LOCAL_SIGN_PATH
if ($thumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Invalid local signing certificate thumbprint' }
$certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint"
if (!$certificate.HasPrivateKey -or !($certificate.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3')) {
    throw 'Local signing certificate must have a private key and Code Signing usage'
}
$signature = Set-AuthenticodeSignature -LiteralPath $target -Certificate $certificate -HashAlgorithm SHA256
$embedded = [Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($target)
try {
    # Catalog signatures may take precedence in PowerShell's result; check the embedded signer itself.
    if ($embedded.GetCertHashString() -ne $thumbprint) {
        throw "Local Authenticode signing failed: $($signature.Status) $($signature.StatusMessage)"
    }
} finally {
    $embedded.Dispose()
}
Add-Type -Path (Join-Path $PSScriptRoot 'local-windows-signature.cs')
$status = [DshLocalAuthenticode]::Verify($target)
# CERT_E_UNTRUSTEDROOT is expected for local self-signed certificates; other failures are rejected.
if ($status -ne 0 -and $status -ne -2146762487) {
    throw ('Local Authenticode verification failed: 0x{0:X8}' -f $status)
}
