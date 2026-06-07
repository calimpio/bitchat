const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');
const wwwPath = path.join(__dirname, 'www');

function deleteFolderRecursive(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const curPath = path.join(directoryPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(directoryPath);
    }
}

function copyFolderRecursive(source, target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }

    const files = fs.readdirSync(source);
    files.forEach((file) => {
        const curSource = path.join(source, file);
        const curTarget = path.join(target, file);

        if (fs.lstatSync(curSource).isDirectory()) {
            copyFolderRecursive(curSource, curTarget);
        } else {
            fs.copyFileSync(curSource, curTarget);
        }
    });
}

console.log('Cleaning windows/www...');
if (fs.existsSync(wwwPath)) {
    deleteFolderRecursive(wwwPath);
}
fs.mkdirSync(wwwPath, { recursive: true });

console.log('Copying dist to windows/www...');
if (fs.existsSync(distPath)) {
    copyFolderRecursive(distPath, wwwPath);
    console.log('Sync complete!');
} else {
    console.error('Error: dist folder not found. Run "npm run build" first.');
}