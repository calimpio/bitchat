const fs = require('fs');
const path = require('path');

const distPath = path.resolve(__dirname, '..', 'dist');
const wwwPath = path.resolve(__dirname, 'www');

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

console.log(`Source: ${distPath}`);
console.log(`Target: ${wwwPath}`);

try {
    if (!fs.existsSync(distPath)) {
        console.error('Error: dist folder not found. Run "npm run build" first.');
        process.exit(1);
    }

    console.log('Cleaning windows/www...');
    if (fs.existsSync(wwwPath)) {
        // Use rmSync with recursive and force for better robustness in modern Node
        fs.rmSync(wwwPath, { recursive: true, force: true });
    }
    fs.mkdirSync(wwwPath, { recursive: true });

    console.log('Copying contents...');
    copyRecursiveSync(distPath, wwwPath);

    console.log('Sync complete!');
} catch (err) {
    console.error('Sync failed:', err.message);
    process.exit(1);
}