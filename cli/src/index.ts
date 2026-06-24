import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CryptoService, arrayBufferToBase64 } from './crypto';
import { webcrypto } from 'crypto';
import * as readline from 'readline';
import * as http from 'http';

const program = new Command();

program
  .name('bitcli')
  .description('bitOS Command Line Interface')
  .version('1.0.0');

// Helper to resolve identity file path
function getIdentityPath(options: any): string {
    return options.file ? path.resolve(options.file) : path.resolve(process.cwd(), 'identity.json');
}

// Identity command group
const identityCmd = program.command('identity').description('Manage local identities');

identityCmd.command('create')
  .description('Create a new cryptographic identity')
  .argument('<publicId>', 'Public ID (e.g. phone number)')
  .argument('<privateId>', 'Private ID (secret passphrase/seed)')
  .argument('<password>', 'Master Password to encrypt local vault')
  .option('-f, --file <path>', 'Path to save the identity file')
  .action(async (publicId, privateId, password, options) => {
    try {
        const filePath = getIdentityPath(options);
        console.log(`Generating keys for ID: ${publicId}...`);

        // 1. Salt for master key derivation
        const saltBuffer = webcrypto.getRandomValues(new Uint8Array(16));

        const saltBase64 = await arrayBufferToBase64(saltBuffer);
        
        // 2. Derive master AES key
        const masterKey = await CryptoService.deriveMasterKey(password, saltBuffer);
        
        // 3. Generate ECDH keypair
        const keyPair = await CryptoService.generateECDHKeyPair();
        const publicKeyJWK = await CryptoService.exportKey(keyPair.publicKey);
        const privateKeyJWK = await CryptoService.exportKey(keyPair.privateKey);
        
        // 4. Encrypt Private Key
        const { ciphertext: encryptedPriv, iv: privIv } = await CryptoService.encrypt(masterKey, JSON.stringify(privateKeyJWK));
        
        // 5. Create Auth Witness (Proof of knowledge)
        const { ciphertext: witness, iv: witnessIv } = await CryptoService.encrypt(masterKey, "BITMSG_IDENTITY_OK");

        const creds = { 
            idPublico: publicId, 
            idPrivado: privateId, 
            authWitness: witness,
            authIv: witnessIv,
            salt: saltBase64,
            publicKey: publicKeyJWK,
            encryptedPrivateKey: encryptedPriv,
            privateKeyIv: privIv,
            createdAt: Date.now()
        };

        fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), 'utf-8');
        
        const fingerprint = await CryptoService.getFingerprint(publicKeyJWK);
        console.log('\n✅ Identity successfully created!');
        console.log(`Saved to: ${filePath}`);
        console.log(`-----------------------------------`);
        console.log(`Public ID:   ${publicId}`);
        console.log(`Fingerprint: ${fingerprint}`);
        console.log(`-----------------------------------`);
    } catch (error: any) {
        console.error('Error creating identity:', error.message || error);
        process.exit(1);
    }
  });

identityCmd.command('show')
  .description('Show local identity information')
  .argument('<password>', 'Master Password to decrypt private key')
  .option('-f, --file <path>', 'Path to the identity file')
  .action(async (password, options) => {
    try {
        const filePath = getIdentityPath(options);
        if (!fs.existsSync(filePath)) {
            console.error(`Error: Identity file not found at ${filePath}. Run 'bitcli identity create' first.`);
            process.exit(1);
        }

        const creds = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!creds.salt || !creds.authWitness || !creds.authIv) {
            console.error('Error: Identity file format is invalid.');
            process.exit(1);
        }

        // Verify password by decrypting witness
        const saltBuffer = Buffer.from(creds.salt, 'base64');
        const masterKey = await CryptoService.deriveMasterKey(password, saltBuffer);
        
        const decryptedWitness = await CryptoService.decrypt(masterKey, creds.authWitness, creds.authIv);
        if (decryptedWitness !== "BITMSG_IDENTITY_OK") {
            console.error('Error: Decrypt verification failed. Invalid master password.');
            process.exit(1);
        }

        const fingerprint = await CryptoService.getFingerprint(creds.publicKey);
        console.log(`\n🔒 Identity Details (Decrypted)`);
        console.log(`-----------------------------------`);
        console.log(`Public ID:   ${creds.idPublico}`);
        console.log(`Private ID:  ${creds.idPrivado}`);
        console.log(`Fingerprint: ${fingerprint}`);
        console.log(`Created At:  ${new Date(creds.createdAt).toLocaleString()}`);
        console.log(`-----------------------------------`);
    } catch (error: any) {
        console.error('Verification failed. Invalid password or corrupted file.', error.message || error);
        process.exit(1);
    }
  });

identityCmd.command('export')
  .description('Export local identity raw credentials')
  .argument('<password>', 'Master Password')
  .argument('<outputPath>', 'Destination file path')
  .option('-f, --file <path>', 'Path to the identity file')
  .action(async (password, outputPath, options) => {
    try {
        const filePath = getIdentityPath(options);
        if (!fs.existsSync(filePath)) {
            console.error(`Error: Identity file not found.`);
            process.exit(1);
        }

        const creds = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const saltBuffer = Buffer.from(creds.salt, 'base64');
        const masterKey = await CryptoService.deriveMasterKey(password, saltBuffer);
        
        const decryptedWitness = await CryptoService.decrypt(masterKey, creds.authWitness, creds.authIv);
        if (decryptedWitness !== "BITMSG_IDENTITY_OK") {
            console.error('Error: Verification failed. Invalid master password.');
            process.exit(1);
        }

        fs.writeFileSync(path.resolve(outputPath), JSON.stringify(creds, null, 2), 'utf-8');
        console.log(`✅ Identity successfully exported to: ${outputPath}`);
    } catch (error: any) {
        console.error('Export failed:', error.message || error);
        process.exit(1);
    }
  });

program.command('login')
  .description('Link this CLI to a browser device using a unique key access code')
  .option('-f, --file <path>', 'Path to save the identity file')
  .action(async (options) => {
    try {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const port = Math.floor(Math.random() * (65535 - 10000 + 1)) + 10000;
        const filePath = getIdentityPath(options);
        
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
                        
                        fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), 'utf-8');
                        
                        // Send success response to browser
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 'SUCCESS' }));
                        
                        console.log(`\n✅ ¡Vinculación completada con éxito!`);
                        console.log(`Identidad guardada en: ${filePath}\n`);
                        
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

program.parse(process.argv);

