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

program.command('logout')
  .description('Remove the linked local cryptographic identity file')
  .option('-f, --file <path>', 'Path to the identity file to remove')
  .action((options) => {
    try {
        const filePath = getIdentityPath(options);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`\n✅ Identity file successfully removed from: ${filePath}\n`);
        } else {
            console.log(`\nℹ️ No identity file found at: ${filePath}\n`);
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

program.parse(process.argv);

