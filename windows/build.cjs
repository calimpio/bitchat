const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const version = '1.0.0';
const zipName = `BitChat_v1.0.0.zip`;
const windowsDir = __dirname;
const publishDir = path.join(windowsDir, 'publish_64');
const zipPath = path.join(windowsDir, zipName);
const manifestPath = path.join(windowsDir, 'manifests', 'c', 'Calimpio', 'BitChat', version, 'Calimpio.BitChat.installer.yaml');

function run(cmd, cwd = windowsDir) {
    console.log(`Executing: ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd });
}

try {
    // 1. Compile
    console.log('--- Compiling Windows Project ---');
    run(`dotnet publish BitChat.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publish_64`);

    // 2. Create ZIP using PowerShell
    console.log('--- Creating ZIP Package ---');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    // Use PowerShell to zip the publish directory content
    run(`powershell -Command "Compress-Archive -Path '${publishDir}\\*' -DestinationPath '${zipPath}' -Force"`);

    // 3. Calculate SHA256
    console.log('--- Calculating SHA256 ---');
    const fileBuffer = fs.readFileSync(zipPath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const sha256 = hashSum.digest('hex');
    console.log(`SHA256: ${sha256}`);

    // 4. Update Manifest
    console.log('--- Updating Winget Manifest ---');
    if (fs.existsSync(manifestPath)) {
        let content = fs.readFileSync(manifestPath, 'utf8');
        const oldHashMatch = content.match(/InstallerSha256:\s+([a-fA-F0-9]{64})/);
        if (oldHashMatch) {
            content = content.replace(oldHashMatch[1], sha256);
            fs.writeFileSync(manifestPath, content);
            console.log('Manifest updated successfully.');
        } else {
            console.error('Could not find InstallerSha256 in manifest.');
        }
    } else {
        console.error(`Manifest not found at: ${manifestPath}`);
    }

    console.log('--- Build and Release Process Complete ---');
    console.log(`Result: ${zipPath}`);

} catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
}
