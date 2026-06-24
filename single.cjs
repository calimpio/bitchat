const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, 'dist');
const htmlPath = path.join(distPath, 'index.html');
const outputPath = path.join(__dirname, 'bitos.html');

if (!fs.existsSync(htmlPath)) {
    console.error('Error: dist/index.html not found. Run "npm run build" first.');
    process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf8');

// Inline CSS
const cssRegex = /<link rel="stylesheet"[^>]*href="([^"]*)"[^>]*>/g;
html = html.replace(cssRegex, (match, src) => {
    const cssFileName = path.basename(src);
    const cssPath = path.join(distPath, 'assets', cssFileName);
    if (fs.existsSync(cssPath)) {
        const cssContent = fs.readFileSync(cssPath, 'utf8');
        console.log(`Inlining CSS: ${cssFileName}`);
        return `<style>${cssContent}</style>`;
    }
    return match;
});

// Inline JS
const jsRegex = /<script[^>]*src="([^"]*)"[^>]*><\/script>/g;
html = html.replace(jsRegex, (match, src) => {
    const jsFileName = path.basename(src);
    const jsPath = path.join(distPath, 'assets', jsFileName);
    if (fs.existsSync(jsPath)) {
        const jsContent = fs.readFileSync(jsPath, 'utf8');
        console.log(`Inlining JS: ${jsFileName}`);
        return `<script type="module">${jsContent}</script>`;
    }
    return match;
});

// Remove modulepreload links
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

fs.writeFileSync(outputPath, html);
console.log(`Standalone HTML created: ${outputPath}`);
