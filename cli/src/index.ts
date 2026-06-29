import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CryptoService, arrayBufferToBase64 } from './crypto';
import { webcrypto, createHash } from 'crypto';
import * as readline from 'readline';
import * as http from 'http';
import { EncryptedDatabase } from './database';
import { WebSocketServer, WebSocket } from 'ws';

const program = new Command();

// Helper to resolve database path
function getDatabasePath(options: any): string {
    if (options.file) return path.resolve(options.file);
    // Try current directory
    let p = path.resolve(process.cwd(), 'bitos.db');
    if (fs.existsSync(p)) return p;
    // Try home directory
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    p = path.resolve(homeDir, 'bitos.db');
    if (fs.existsSync(p)) return p;
    // Fallback to current directory
    return path.resolve(process.cwd(), 'bitos.db');
}

// SHA-256 hash helper
function sha256(str: string): string {
    return createHash('sha256').update(str).digest('hex');
}

// Find repository configuration (.bitdrive/config.json)
function findRepoConfig(): { repoId: string, activeBranch: string, remote?: string } | null {
    let curr = process.cwd();
    while (true) {
        const configPath = path.join(curr, '.bitdrive', 'config.json');
        if (fs.existsSync(configPath)) {
            try {
                return JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (e) {
                return null;
            }
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
    }
    return null;
}

// Find repository root path
function findRepoRoot(): string | null {
    let curr = process.cwd();
    while (true) {
        const configPath = path.join(curr, '.bitdrive', 'config.json');
        if (fs.existsSync(configPath)) {
            return curr;
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
    }
    return null;
}

class BitIgnore {
    private patterns: { regex: RegExp, isDirOnly: boolean }[] = [];

    constructor(repoRoot: string) {
        // Default ignores
        this.addPattern('.git');
        this.addPattern('.bitdrive');
        this.addPattern('node_modules');
        this.addPattern('bitos.db');

        const bitignorePath = path.join(repoRoot, '.bitignore');
        if (fs.existsSync(bitignorePath)) {
            const content = fs.readFileSync(bitignorePath, 'utf8');
            const lines = content.split(/\r?\n/);
            for (let line of lines) {
                line = line.trim();
                if (!line || line.startsWith('#')) {
                    continue;
                }
                this.addPattern(line);
            }
        }
    }

    private addPattern(pattern: string) {
        let isDirOnly = false;
        if (pattern.endsWith('/')) {
            isDirOnly = true;
            pattern = pattern.slice(0, -1);
        }

        let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        escaped = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');

        let regexStr: string;
        if (pattern.startsWith('/')) {
            regexStr = '^' + escaped.slice(1);
        } else {
            regexStr = '(^|\\/)' + escaped + '($|\\/)';
        }

        try {
            const regex = new RegExp(regexStr);
            this.patterns.push({ regex, isDirOnly });
        } catch (e) {
            // Ignore malformed patterns
        }
    }

    shouldIgnore(relativePath: string, isDirectory: boolean): boolean {
        const normPath = relativePath.replace(/\\/g, '/').replace(/^\/|\/$/g, '');
        for (const p of this.patterns) {
            if (p.isDirOnly && !isDirectory) {
                continue;
            }
            if (p.regex.test(normPath) || p.regex.test(normPath + (isDirectory ? '/' : ''))) {
                return true;
            }
        }
        return false;
    }
}

// Recursively get all files under a folder, ignoring files matched by .bitignore
function getAllFiles(dirPath: string, repoRoot: string, ignore: BitIgnore, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const relative = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        
        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();
        
        if (ignore.shouldIgnore(relative, isDir)) {
            continue;
        }
        
        if (isDir) {
            getAllFiles(fullPath, repoRoot, ignore, fileList);
        } else {
            fileList.push(relative);
        }
    }
    return fileList;
}

// Helper to start the websocket bridge server
function startBridgeServer(port: number = 18085): Promise<{ wss: WebSocketServer, ws: WebSocket }> {
    return new Promise((resolve, reject) => {
        const wss = new WebSocketServer({ port });
        const timeout = setTimeout(() => {
            wss.close();
            reject(new Error('Tiempo de espera agotado buscando el gateway en el navegador. Por favor abre bitOS.'));
        }, 15000);

        wss.on('connection', (ws) => {
            clearTimeout(timeout);
            resolve({ wss, ws });
        });

        wss.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

// Helper to load db with interactive password request
async function loadDbInteractive(options: any): Promise<{ db: EncryptedDatabase, password: string }> {
    const dbPath = getDatabasePath(options);
    const password = process.env.BITCLI_PASSWORD || await askPassword();
    const db = await EncryptedDatabase.load(dbPath, password);
    return { db, password };
}

program
  .name('bitcli')
  .description('bitOS Command Line Interface')
  .version('1.0.0');

program.command('login')
  .description('Link this CLI to a browser device using a unique key access code')
  .option('-f, --file <path>', 'Path to save the identity database file')
  .action(async (options) => {
    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const port = Math.floor(Math.random() * (65535 - 10000 + 1)) + 10000;
        const dbPath = getDatabasePath(options);
        
        console.log(`\n-------------------------------------------------------------`);
        console.log(`🔑 CÓDIGO DE ACCESO POR LLAVE: BC-${code}-${port}`);
        console.log(`-------------------------------------------------------------`);
        console.log(`1. Ve a bitOS en tu navegador.`);
        console.log(`2. Dirígete a 'bitDevices' -> 'Acceso por Llave'.`);
        console.log(`3. Introduce el código 'BC-${code}-${port}' para vincular este CLI.`);
        console.log(`-------------------------------------------------------------\n`);
        
        const server = http.createServer(async (req, res) => {
            // Set CORS headers so the browser can make the request
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === 'POST' && req.url === '/link') {
                let body = '';
                req.on('data', chunk => {
                    body += chunk.toString();
                });
                
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        if (data.code !== code) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'ERROR', error: 'Código de acceso incorrecto.' }));
                            return;
                        }

                        const { idPublico, idPrivado, publicKey, privateKey } = data;
                        if (!idPublico || !idPrivado || !publicKey || !privateKey) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'ERROR', error: 'Datos de credenciales incompletos.' }));
                            return;
                        }

                        console.log(`\n📥 Datos recibidos del navegador.`);
                        console.log(`Asociando identidad para: ${idPublico}`);

                        // Request password to encrypt local storage
                        const password = await askPassword();
                        
                        console.log(`Generando almacenamiento cifrado local...`);
                        
                        // 1. Salt for master key derivation
                        const saltBuffer = webcrypto.getRandomValues(new Uint8Array(16));
                        const saltBase64 = await arrayBufferToBase64(saltBuffer);
                        
                        // 2. Derive master AES key
                        const masterKey = await CryptoService.deriveMasterKey(password, saltBuffer);
                        
                        // 3. Encrypt Private Key received from browser
                        const { ciphertext: encryptedPriv, iv: privIv } = await CryptoService.encrypt(masterKey, JSON.stringify(privateKey));
                        
                        // 4. Create Auth Witness
                        const { ciphertext: witness, iv: witnessIv } = await CryptoService.encrypt(masterKey, "BITMSG_IDENTITY_OK");
                        
                        const creds = { 
                            idPublico, 
                            idPrivado, 
                            authWitness: witness,
                            authIv: witnessIv,
                            salt: saltBase64,
                            publicKey,
                            encryptedPrivateKey: encryptedPriv,
                            privateKeyIv: privIv,
                            createdAt: Date.now()
                        };
                        
                        console.log(`Guardando en la base de datos cifrada SQLite...`);
                        const db = await EncryptedDatabase.load(dbPath, password);
                        await db.setCredentials(creds);
                        
                        const device = {
                            deviceId: `bitCLI-${code}`,
                            idPublico: idPublico,
                            label: `bitCLI Terminal (${code})`,
                            isOnline: true,
                            lastSeen: Date.now(),
                            peerId: `bc-link-${code}`,
                            publicKey: publicKey,
                            accountCreatedAt: Date.now(),
                            globalSync: false
                        };
                        await db.addDevice(device);
                        
                        await db.save(dbPath, password);
                        db.close();
                        
                        // Send success response to browser
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'SUCCESS' }));
                        
                        console.log(`\n✅ ¡Vinculación completada con éxito!`);
                        console.log(`Datos guardados en la base de datos cifrada: ${dbPath}\n`);
                        
                        // Close the server and exit program
                        server.close();
                        process.exit(0);
                    } catch (err: any) {
                        console.error('Error al procesar la vinculación:', err.message || err);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'ERROR', error: err.message || err }));
                    }
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        
        server.listen(port, '127.0.0.1', () => {
            console.log(`Iniciado servidor local en 127.0.0.1:${port}.`);
            console.log(`Esperando vinculación segura desde el navegador...`);
        });
        
        server.on('error', (err: any) => {
            console.error('Error al iniciar el servidor local de vinculación:', err.message || err);
            process.exit(1);
        });
        
    } catch (error: any) {
        console.error('Error en comando login:', error.message || error);
        process.exit(1);
    }
  });

program.command('logout')
  .description('Remove the linked local cryptographic identity database file')
  .option('-f, --file <path>', 'Path to the database file to remove')
  .action((options) => {
    try {
        const dbPath = getDatabasePath(options);
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            console.log(`\n✅ Database file successfully removed from: ${dbPath}\n`);
        } else {
            console.log(`\nℹ️ No database file found at: ${dbPath}\n`);
        }
        process.exit(0);
    } catch (error: any) {
        console.error('Error during logout:', error.message || error);
        process.exit(1);
    }
  });

function askPassword(): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const query = 'Introduce la contraseña maestra para cifrar la identidad localmente: ';
        process.stdout.write(query);
        
        (rl as any)._writeToOutput = (stringToWrite: string) => {
            if (stringToWrite === '\r\n' || stringToWrite === '\n') {
                (rl as any).output.write(stringToWrite);
            }
        };
        
        rl.question('', (ans) => {
            rl.close();
            console.log(); // Newline after entering password
            resolve(ans);
        });
    });
}

// =========================================================================
// bitDrive Git-like Commands
// =========================================================================

program.command('init')
  .description('Initialize a new local bitDrive repository')
  .option('-f, --file <path>', 'Database path')
  .action(async (options) => {
    try {
        const dotBitDrive = path.join(process.cwd(), '.bitdrive');
        if (fs.existsSync(dotBitDrive)) {
            console.error('Error: Ya existe un repositorio inicializado en este directorio.');
            process.exit(1);
        }

        const { db, password } = await loadDbInteractive(options);
        const repoId = webcrypto.randomUUID();
        const now = Date.now();

        // 1. Create initial empty tree
        const treeContent = JSON.stringify([]);
        const treeHash = sha256(treeContent);
        
        await db.saveDriveObject({
            hash: treeHash,
            type: 'tree',
            content: treeContent
        });

        // 2. Create initial commit pointing to empty tree
        const creds = await db.getCredentials();
        const autor = creds?.idPublico || 'local-owner';
        
        const commitData = {
            parentCommitId: undefined,
            autor,
            timestamp: now,
            mensaje: 'Initial commit',
            rootTree: treeHash
        };
        const commitId = sha256(JSON.stringify(commitData));
        const initialCommit = {
            commitId,
            ...commitData
        };

        await db.saveDriveObject({
            hash: commitId,
            type: 'commit',
            content: JSON.stringify(initialCommit)
        });

        // 3. Create main branch pointing to initial commit
        const branch = {
            branchId: `${repoId}:main`,
            repoId,
            name: 'main',
            headCommitId: commitId,
            updatedAt: now
        };
        await db.saveBranch(branch);

        // 4. Create repository record
        const repo = {
            repoId,
            name: path.basename(process.cwd()),
            originDeviceId: `bitCLI-${repoId.substring(0, 6)}`,
            createdAt: now,
            updatedAt: now
        };
        await db.saveRepository(repo);
        
        await db.save(getDatabasePath(options), password);
        db.close();

        // 5. Create local directories & config
        fs.mkdirSync(dotBitDrive);
        fs.writeFileSync(path.join(dotBitDrive, 'config.json'), JSON.stringify({
            repoId,
            activeBranch: 'main'
        }, null, 2), 'utf8');

        console.log(`\n✅ Repositorio local de bitDrive inicializado con éxito!`);
        console.log(`ID de Repositorio: ${repoId}`);
        console.log(`Rama inicial: main\n`);
        process.exit(0);
    } catch (e: any) {
        console.error('Error durante init:', e.message || e);
        process.exit(1);
    }
  });

program.command('add <files...>')
  .description('Add files to staging state')
  .option('-f, --file <path>', 'Database path')
  .action(async (filesArgs, options) => {
    try {
        const config = findRepoConfig();
        const root = findRepoRoot();
        if (!config || !root) {
            console.error('Error: No se encontró un repositorio de bitDrive (directorio .bitdrive).');
            process.exit(1);
        }

        const { db, password } = await loadDbInteractive(options);
        const repoId = config.repoId;
        
        const ignore = new BitIgnore(root);
        const filesToAdd: string[] = [];
        for (const fileArg of filesArgs) {
            const resolvedPath = path.resolve(process.cwd(), fileArg);
            if (!fs.existsSync(resolvedPath)) {
                console.warn(`Advertencia: El archivo o carpeta no existe: ${fileArg}`);
                continue;
            }
            const stat = fs.statSync(resolvedPath);
            const isDir = stat.isDirectory();
            const relative = path.relative(root, resolvedPath).replace(/\\/g, '/');

            if (ignore.shouldIgnore(relative, isDir)) {
                continue;
            }

            if (isDir) {
                getAllFiles(resolvedPath, root, ignore, filesToAdd);
            } else {
                filesToAdd.push(relative);
            }
        }

        if (filesToAdd.length === 0) {
            console.log('No hay archivos válidos para añadir.');
            db.close();
            process.exit(0);
        }

        for (const file of filesToAdd) {
            const fullPath = path.join(root, file);
            const content = fs.readFileSync(fullPath, 'utf8');
            const fileHash = sha256(content);
            await db.saveIndexEntry(repoId, file, fileHash, content);
            console.log(`+ staged: ${file}`);
        }

        await db.save(getDatabasePath(options), password);
        db.close();
        console.log(`\n✅ ${filesToAdd.length} archivo(s) añadidos al estado de preparación.`);
        process.exit(0);
    } catch (e: any) {
        console.error('Error al añadir archivos:', e.message || e);
        process.exit(1);
    }
  });

program.command('commit')
  .description('Commit changes to the local repository')
  .requiredOption('-m, --message <message>', 'Commit message')
  .option('-f, --file <path>', 'Database path')
  .action(async (options) => {
    try {
        const config = findRepoConfig();
        if (!config) {
            console.error('Error: No se encontró un repositorio de bitDrive.');
            process.exit(1);
        }

        const { db, password } = await loadDbInteractive(options);
        const repoId = config.repoId;
        const branchName = config.activeBranch;

        const stagedFiles = await db.getIndexEntries(repoId);
        if (stagedFiles.length === 0) {
            console.log('Nothing to commit (staging index is empty). Use "add" first.');
            db.close();
            process.exit(0);
        }

        const branch = await db.getBranch(repoId, branchName);
        if (!branch) {
            console.error(`Error: La rama activa ${branchName} no existe en la base de datos.`);
            db.close();
            process.exit(1);
        }

        // Build directory tree hierarchy
        interface TempDir {
            files: Record<string, string>; // filename -> blobHash
            dirs: Record<string, TempDir>; // dirname -> TempDir
        }
        const rootDir: TempDir = { files: {}, dirs: {} };
        for (const file of stagedFiles) {
            const parts = file.filePath.replace(/^\/+|\/+$/g, '').split('/');
            let current = rootDir;
            
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current.dirs[part]) {
                    current.dirs[part] = { files: {}, dirs: {} };
                }
                current = current.dirs[part];
            }
            
            const filename = parts[parts.length - 1];
            const blobHash = file.hash;
            
            await db.saveDriveObject({
                hash: blobHash,
                type: 'blob',
                content: file.content
            });
            
            current.files[filename] = blobHash;
        }

        const writeTreeObjects = async (dir: TempDir): Promise<string> => {
            const entries: any[] = [];
            
            for (const filename in dir.files) {
                entries.push({
                    name: filename,
                    type: 'blob',
                    hash: dir.files[filename]
                });
            }
            
            for (const dirname in dir.dirs) {
                const subTreeHash = await writeTreeObjects(dir.dirs[dirname]);
                entries.push({
                    name: dirname,
                    type: 'tree',
                    hash: subTreeHash
                });
            }
            
            entries.sort((a, b) => a.name.localeCompare(b.name));
            const content = JSON.stringify(entries);
            const hash = sha256(content);
            
            await db.saveDriveObject({
                hash,
                type: 'tree',
                content
            });
            
            return hash;
        };

        const rootTreeHash = await writeTreeObjects(rootDir);
        const creds = await db.getCredentials();
        const autor = creds?.idPublico || 'local-owner';
        const now = Date.now();

        // Create the commit metadata object
        const commitData = {
            parentCommitId: branch.headCommitId,
            autor,
            timestamp: now,
            mensaje: options.message,
            rootTree: rootTreeHash
        };
        const commitId = sha256(JSON.stringify(commitData));
        const commit = {
            commitId,
            ...commitData
        };

        await db.saveDriveObject({
            hash: commitId,
            type: 'commit',
            content: JSON.stringify(commit)
        });

        // Move branch HEAD pointer
        branch.headCommitId = commitId;
        branch.updatedAt = now;
        await db.saveBranch(branch);

        // Update repository updatedAt
        const repo = await db.getRepository(repoId);
        if (repo) {
            repo.updatedAt = now;
            await db.saveRepository(repo);
        }

        await db.save(getDatabasePath(options), password);
        db.close();

        console.log(`\n[${branchName} ${commitId.substring(0, 7)}] ${options.message}`);
        console.log(`Commit completado con éxito!`);
        process.exit(0);
    } catch (e: any) {
        console.error('Error al realizar commit:', e.message || e);
        process.exit(1);
    }
  });

program.command('status')
  .description('Show working directory status')
  .option('-f, --file <path>', 'Database path')
  .action(async (options) => {
    try {
        const config = findRepoConfig();
        const root = findRepoRoot();
        if (!config || !root) {
            console.error('Error: No se encontró un repositorio de bitDrive.');
            process.exit(1);
        }

        const { db } = await loadDbInteractive(options);
        const repoId = config.repoId;
        const branchName = config.activeBranch;

        const indexFiles = await db.getIndexEntries(repoId);
        const indexMap = new Map<string, any>();
        for (const file of indexFiles) {
            indexMap.set(file.filePath, file);
        }

        const branch = await db.getBranch(repoId, branchName);
        const headFilesMap = new Map<string, string>();
        if (branch) {
            const commitObj = await db.getDriveObject(branch.headCommitId);
            if (commitObj && commitObj.type === 'commit') {
                const commit = JSON.parse(commitObj.content);
                const traverseTree = async (treeHash: string, currentPath: string): Promise<void> => {
                    const treeObj = await db.getDriveObject(treeHash);
                    if (!treeObj || treeObj.type !== 'tree') return;
                    const entries = JSON.parse(treeObj.content);
                    for (const entry of entries) {
                        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                        if (entry.type === 'blob') {
                            headFilesMap.set(entryPath, entry.hash);
                        } else if (entry.type === 'tree') {
                            await traverseTree(entry.hash, entryPath);
                        }
                    }
                };
                await traverseTree(commit.rootTree, '');
            }
        }

        const ignore = new BitIgnore(root);
        const diskFilesList: string[] = [];
        getAllFiles(root, root, ignore, diskFilesList);

        const stagedChanges: string[] = [];
        const unstagedChanges: string[] = [];
        const untrackedFiles: string[] = [];

        for (const file of diskFilesList) {
            const fullPath = path.join(root, file);
            const content = fs.readFileSync(fullPath, 'utf8');
            const currentHash = sha256(content);

            const indexEntry = indexMap.get(file);
            const headHash = headFilesMap.get(file);

            if (!indexEntry) {
                if (headHash) {
                    unstagedChanges.push(`deleted:    ${file}`);
                } else {
                    untrackedFiles.push(file);
                }
            } else {
                if (indexEntry.hash !== currentHash) {
                    unstagedChanges.push(`modified:   ${file}`);
                }
                
                if (indexEntry.hash !== headHash) {
                    if (!headHash) {
                        stagedChanges.push(`new file:   ${file}`);
                    } else {
                        stagedChanges.push(`modified:   ${file}`);
                    }
                }
            }
        }

        const diskFilesSet = new Set(diskFilesList);
        for (const [filePath] of indexMap) {
            if (!diskFilesSet.has(filePath)) {
                unstagedChanges.push(`deleted:    ${filePath}`);
            }
        }

        db.close();

        console.log(`En la rama ${branchName}`);
        
        if (stagedChanges.length > 0) {
            console.log('\nCambios listos para el commit (Staged):');
            for (const change of stagedChanges) {
                console.log(`\t\x1b[32m${change}\x1b[0m`);
            }
        }

        if (unstagedChanges.length > 0) {
            console.log('\nCambios no preparados para el commit:');
            for (const change of unstagedChanges) {
                console.log(`\t\x1b[31m${change}\x1b[0m`);
            }
        }

        if (untrackedFiles.length > 0) {
            console.log('\nArchivos sin seguimiento (Untracked):');
            for (const file of untrackedFiles) {
                console.log(`\t\x1b[31m${file}\x1b[0m`);
            }
        }

        if (stagedChanges.length === 0 && unstagedChanges.length === 0 && untrackedFiles.length === 0) {
            console.log('nada para hacer commit, el árbol de trabajo está limpio');
        }
        
        console.log();
        process.exit(0);
    } catch (e: any) {
        console.error('Error en status:', e.message || e);
        process.exit(1);
    }
  });

program.command('checkout <branchName>')
  .description('Switch branches or create a new one')
  .option('-b', 'Create and checkout a new branch')
  .option('-f, --file <path>', 'Database path')
  .action(async (branchName, options) => {
    try {
        const config = findRepoConfig();
        const root = findRepoRoot();
        if (!config || !root) {
            console.error('Error: No se encontró un repositorio de bitDrive.');
            process.exit(1);
        }

        const { db, password } = await loadDbInteractive(options);
        const repoId = config.repoId;
        const currentBranchName = config.activeBranch;

        let branch = await db.getBranch(repoId, branchName);

        if (options.b) {
            if (branch) {
                console.error(`Error: La rama ${branchName} ya existe.`);
                db.close();
                process.exit(1);
            }

            const currentBranch = await db.getBranch(repoId, currentBranchName);
            if (!currentBranch) {
                console.error(`Error: Rama activa actual ${currentBranchName} no encontrada.`);
                db.close();
                process.exit(1);
            }

            branch = {
                branchId: `${repoId}:${branchName}`,
                repoId,
                name: branchName,
                headCommitId: currentBranch.headCommitId,
                updatedAt: Date.now()
            };
            await db.saveBranch(branch);
            console.log(`Rama ${branchName} creada apuntando a ${currentBranch.headCommitId.substring(0, 7)}`);
        } else {
            if (!branch) {
                console.error(`Error: La rama ${branchName} no existe. Usa -b para crearla.`);
                db.close();
                process.exit(1);
            }
        }

        const commitId = branch.headCommitId;
        const commitObj = await db.getDriveObject(commitId);
        if (!commitObj || commitObj.type !== 'commit') {
            console.error(`Error: Commit HEAD ${commitId} no encontrado.`);
            db.close();
            process.exit(1);
        }
        const commit = JSON.parse(commitObj.content);

        const files: { path: string, content: string }[] = [];
        const traverseTree = async (treeHash: string, currentPath: string): Promise<void> => {
            const treeObj = await db.getDriveObject(treeHash);
            if (!treeObj || treeObj.type !== 'tree') return;
            const entries = JSON.parse(treeObj.content);
            for (const entry of entries) {
                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                if (entry.type === 'blob') {
                    const blobObj = await db.getDriveObject(entry.hash);
                    if (blobObj) {
                        files.push({
                            path: entryPath,
                            content: blobObj.content
                        });
                    }
                } else if (entry.type === 'tree') {
                    await traverseTree(entry.hash, entryPath);
                }
            }
        };

        await traverseTree(commit.rootTree, '');

        const oldIndexFiles = await db.getIndexEntries(repoId);
        for (const file of oldIndexFiles) {
            const fullPath = path.join(root, file.filePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
                let parent = path.dirname(fullPath);
                while (parent !== root) {
                    if (fs.readdirSync(parent).length === 0) {
                        fs.rmdirSync(parent);
                        parent = path.dirname(parent);
                    } else {
                        break;
                    }
                }
            }
        }

        await db.clearIndex(repoId);
        for (const file of files) {
            const fullPath = path.join(root, file.path);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf8');
            const fileHash = sha256(file.content);
            await db.saveIndexEntry(repoId, file.path, fileHash, file.content);
        }

        fs.writeFileSync(path.join(root, '.bitdrive', 'config.json'), JSON.stringify({
            repoId,
            activeBranch: branchName
        }, null, 2), 'utf8');

        await db.save(getDatabasePath(options), password);
        db.close();

        console.log(`Cambiado a rama '${branchName}'`);
        process.exit(0);
    } catch (e: any) {
        console.error('Error en checkout:', e.message || e);
        process.exit(1);
    }
  });

program.command('clone <target>')
  .description('Clone a repository. Format: clone <repo_id>:<device_id>')
  .option('-f, --file <path>', 'Database path')
  .action(async (target, options) => {
    try {
        const match = target.trim().match(/^([a-f0-9\-]+):([a-zA-Z0-9\-]+)$/);
        if (!match) {
            console.error('Error: El formato de clonación debe ser <repo_id>:<device_id>');
            process.exit(1);
        }
        const repoId = match[1];
        const deviceId = match[2];

        const { db, password } = await loadDbInteractive(options);

        console.log('Esperando conexión con el navegador en el puerto 18085...');
        const { wss, ws } = await startBridgeServer(18085);
        console.log('Conectado con el navegador. Solicitando descarga del repositorio...');

        ws.send(JSON.stringify({
            type: 'CLONE',
            repoId,
            targetDeviceId: deviceId
        }));

        const responsePromise = new Promise<any>((resolve, reject) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'CLONE_RESP' && msg.repoId === repoId) {
                        resolve(msg);
                    }
                } catch(e) {
                    reject(e);
                }
            });
            ws.on('close', () => reject(new Error('Conexión cerrada por el navegador')));
        });

        const res = await responsePromise;
        wss.close();

        if (!res.success) {
            console.error(`Error al clonar: ${res.error || 'Desconocido'}`);
            db.close();
            process.exit(1);
        }

        const { repo, branches, objects, pullRequests } = res;
        await db.saveRepository(repo);
        for (const b of branches) await db.saveBranch(b);
        for (const obj of objects) await db.saveDriveObject(obj);
        if (pullRequests) {
            for (const pr of pullRequests) await db.savePullRequest(pr);
        }

        const dotBitDrive = path.join(process.cwd(), '.bitdrive');
        if (fs.existsSync(dotBitDrive)) {
            console.error('Error: Ya existe un repositorio en este directorio (.bitdrive).');
            db.close();
            process.exit(1);
        }

        fs.mkdirSync(dotBitDrive);
        fs.writeFileSync(path.join(dotBitDrive, 'config.json'), JSON.stringify({
            repoId,
            activeBranch: 'main',
            remote: target
        }, null, 2), 'utf8');

        const mainBranch = branches.find((b: any) => b.name === 'main') || branches[0];
        if (!mainBranch) {
            console.error('Error: No se encontró ninguna rama en el repositorio clonado.');
            db.close();
            process.exit(1);
        }

        const headCommitId = mainBranch.headCommitId;
        const commitObj = objects.find((o: any) => o.hash === headCommitId);
        if (!commitObj) {
            console.error('Error: Objeto de commit inicial no encontrado.');
            db.close();
            process.exit(1);
        }
        const commit = JSON.parse(commitObj.content);

        const files: { path: string, content: string }[] = [];
        const traverseTree = async (treeHash: string, currentPath: string): Promise<void> => {
            const treeObj = objects.find((o: any) => o.hash === treeHash);
            if (!treeObj) return;
            const entries = JSON.parse(treeObj.content);
            for (const entry of entries) {
                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                if (entry.type === 'blob') {
                    const blobObj = objects.find((o: any) => o.hash === entry.hash);
                    if (blobObj) {
                        files.push({
                            path: entryPath,
                            content: blobObj.content
                        });
                    }
                } else if (entry.type === 'tree') {
                    await traverseTree(entry.hash, entryPath);
                }
            }
        };

        await traverseTree(commit.rootTree, '');

        await db.clearIndex(repoId);
        for (const file of files) {
            const fullPath = path.join(process.cwd(), file.path);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf8');
            const fileHash = sha256(file.content);
            await db.saveIndexEntry(repoId, file.path, fileHash, file.content);
        }

        await db.save(getDatabasePath(options), password);
        db.close();

        console.log(`\n✅ Clonado exitoso! Repositorio ${repo.name} descargado.`);
        console.log(`ID de Repositorio: ${repoId}`);
        console.log(`Rama activa: ${mainBranch.name}\n`);
        process.exit(0);
    } catch (e: any) {
        console.error('Error durante clonación:', e.message || e);
        process.exit(1);
    }
  });

program.command('pull')
  .description('Download latest changes from remote origin')
  .option('-f, --file <path>', 'Database path')
  .action(async (options) => {
    try {
        const config = findRepoConfig();
        const root = findRepoRoot();
        if (!config || !root) {
            console.error('Error: No se encontró un repositorio de bitDrive.');
            process.exit(1);
        }

        const { db, password } = await loadDbInteractive(options);
        const repoId = config.repoId;
        const branchName = config.activeBranch;

        const configContent = JSON.parse(fs.readFileSync(path.join(root, '.bitdrive', 'config.json'), 'utf8'));
        const remote = configContent.remote;
        let targetDeviceId = '';
        if (remote) {
            const match = remote.match(/^([a-f0-9\-]+):([a-zA-Z0-9\-]+)$/);
            if (match) {
                targetDeviceId = match[2];
            }
        }

        console.log('Esperando conexión con el navegador en el puerto 18085...');
        const { wss, ws } = await startBridgeServer(18085);
        console.log('Conectado con el navegador. Descargando cambios...');

        ws.send(JSON.stringify({
            type: 'PULL',
            repoId,
            targetDeviceId
        }));

        const responsePromise = new Promise<any>((resolve, reject) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'PULL_RESP' && msg.repoId === repoId) {
                        resolve(msg);
                    }
                } catch(e) {
                    reject(e);
                }
            });
            ws.on('close', () => reject(new Error('Conexión cerrada por el navegador')));
        });

        const res = await responsePromise;
        wss.close();

        if (!res.success) {
            console.error(`Error al descargar cambios: ${res.error || 'Desconocido'}`);
            db.close();
            process.exit(1);
        }

        const { branches, objects, pullRequests } = res;
        for (const b of branches) await db.saveBranch(b);
        for (const obj of objects) await db.saveDriveObject(obj);
        if (pullRequests) {
            for (const pr of pullRequests) await db.savePullRequest(pr);
        }

        const activeBranch = branches.find((b: any) => b.name === branchName);
        if (!activeBranch) {
            console.error(`Error: Rama activa ${branchName} no encontrada en los datos descargados.`);
            db.close();
            process.exit(1);
        }

        const headCommitId = activeBranch.headCommitId;
        const commitObj = await db.getDriveObject(headCommitId);
        if (!commitObj || commitObj.type !== 'commit') {
            console.error(`Error: Objeto de commit HEAD ${headCommitId} no encontrado.`);
            db.close();
            process.exit(1);
        }
        const commit = JSON.parse(commitObj.content);

        const files: { path: string, content: string }[] = [];
        const traverseTree = async (treeHash: string, currentPath: string): Promise<void> => {
            const treeObj = await db.getDriveObject(treeHash);
            if (!treeObj || treeObj.type !== 'tree') return;
            const entries = JSON.parse(treeObj.content);
            for (const entry of entries) {
                const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                if (entry.type === 'blob') {
                    const blobObj = await db.getDriveObject(entry.hash);
                    if (blobObj) {
                        files.push({
                            path: entryPath,
                            content: blobObj.content
                        });
                    }
                } else if (entry.type === 'tree') {
                    await traverseTree(entry.hash, entryPath);
                }
            }
        };

        await traverseTree(commit.rootTree, '');

        const oldIndexFiles = await db.getIndexEntries(repoId);
        for (const file of oldIndexFiles) {
            const fullPath = path.join(root, file.filePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
                let parent = path.dirname(fullPath);
                while (parent !== root) {
                    if (fs.readdirSync(parent).length === 0) {
                        fs.rmdirSync(parent);
                        parent = path.dirname(parent);
                    } else {
                        break;
                    }
                }
            }
        }

        await db.clearIndex(repoId);
        for (const file of files) {
            const fullPath = path.join(root, file.path);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf8');
            const fileHash = sha256(file.content);
            await db.saveIndexEntry(repoId, file.path, fileHash, file.content);
        }

        await db.save(getDatabasePath(options), password);
        db.close();

        console.log(`\n✅ Cambios descargados y aplicados con éxito en la rama ${branchName}!`);
        console.log(`HEAD actual: ${headCommitId.substring(0, 7)}`);
        process.exit(0);
    } catch (e: any) {
        console.error('Error en pull:', e.message || e);
        process.exit(1);
    }
  });

program.command('push [remoteName] [remoteTarget]')
  .description('Push changes to remote device. Format: push origin <repo_id>:<device_id> or push')
  .option('-f, --file <path>', 'Database path')
  .action(async (remoteName, remoteTarget, options) => {
    try {
        const config = findRepoConfig();
        const root = findRepoRoot();
        if (!config || !root) {
            console.error('Error: No se encontró un repositorio de bitDrive.');
            process.exit(1);
        }

        const { db, password } = await loadDbInteractive(options);
        const repoId = config.repoId;

        let targetDeviceId = '';
        const configPath = path.join(root, '.bitdrive', 'config.json');
        const configContent = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (remoteName && remoteTarget) {
            if (remoteName !== 'origin') {
                console.error('Error: El único nombre de remoto soportado es "origin"');
                db.close();
                process.exit(1);
            }
            const match = remoteTarget.trim().match(/^([a-f0-9\-]+):([a-zA-Z0-9\-]+)$/);
            if (!match) {
                console.error('Error: El destino remoto debe tener formato <repo_id>:<device_id>');
                db.close();
                process.exit(1);
            }
            targetDeviceId = match[2];

            configContent.remote = remoteTarget;
            fs.writeFileSync(configPath, JSON.stringify(configContent, null, 2), 'utf8');
            console.log(`Configurado origen remoto por defecto: ${remoteTarget}`);
        } else {
            const savedRemote = configContent.remote;
            if (savedRemote) {
                const match = savedRemote.match(/^([a-f0-9\-]+):([a-zA-Z0-9\-]+)$/);
                if (match) {
                    targetDeviceId = match[2];
                }
            }
        }

        const branches = await db.getBranches(repoId);
        const pullRequests = await db.getPullRequests(repoId);
        const objects: any[] = [];
        const visited = new Set<string>();

        const addObj = async (hash: string) => {
            if (visited.has(hash)) return;
            visited.add(hash);
            const obj = await db.getDriveObject(hash);
            if (obj) {
                objects.push(obj);
                if (obj.type === 'commit') {
                    const commit = JSON.parse(obj.content);
                    if (commit.rootTree) await addObj(commit.rootTree);
                } else if (obj.type === 'tree') {
                    const entries = JSON.parse(obj.content);
                    for (const entry of entries) {
                        await addObj(entry.hash);
                    }
                }
            }
        };

        for (const b of branches) {
            let curr = b.headCommitId;
            while (curr) {
                await addObj(curr);
                const commitObj = await db.getDriveObject(curr);
                if (commitObj && commitObj.type === 'commit') {
                    const commit = JSON.parse(commitObj.content);
                    curr = commit.parentCommitId || '';
                } else {
                    break;
                }
            }
        }

        console.log('Esperando conexión con el navegador en el puerto 18085...');
        const { wss, ws } = await startBridgeServer(18085);
        console.log('Conectado con el navegador. Subiendo cambios...');

        ws.send(JSON.stringify({
            type: 'PUSH',
            repoId,
            targetDeviceId,
            branches,
            objects,
            pullRequests
        }));

        const responsePromise = new Promise<any>((resolve, reject) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'PUSH_RESP' && msg.repoId === repoId) {
                        resolve(msg);
                    }
                } catch(e) {
                    reject(e);
                }
            });
            ws.on('close', () => reject(new Error('Conexión cerrada por el navegador')));
        });

        const res = await responsePromise;
        wss.close();

        db.close();

        if (!res.success) {
            console.error(`Error al subir cambios: ${res.error || 'Desconocido'}`);
            process.exit(1);
        }

        console.log('\n✅ Cambios subidos con éxito!');
        process.exit(0);
    } catch (e: any) {
        console.error('Error en push:', e.message || e);
        process.exit(1);
    }
  });

program.parse(process.argv);

