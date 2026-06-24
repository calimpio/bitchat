import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { CryptoService } from './crypto';
import { webcrypto } from 'crypto';

export class EncryptedDatabase {
    private db: any = null;
    private salt: string | null = null;

    static async init(): Promise<any> {
        return await initSqlJs();
    }

    constructor(dbInstance: any, salt: string | null = null) {
        this.db = dbInstance;
        this.salt = salt;
    }

    static async load(dbPath: string, password: string): Promise<EncryptedDatabase> {
        const SQL = await EncryptedDatabase.init();
        if (!fs.existsSync(dbPath)) {
            // First time: Create new database
            const db = new SQL.Database();
            const edb = new EncryptedDatabase(db);
            await edb.migrate();
            return edb;
        }

        const fileContent = fs.readFileSync(dbPath, 'utf-8');
        let parsed;
        try {
            parsed = JSON.parse(fileContent);
        } catch (e) {
            throw new Error('Invalid database file format');
        }

        const { salt, iv, ciphertext } = parsed;
        if (!salt || !iv || !ciphertext) {
            throw new Error('Database file is corrupted or not encrypted');
        }

        // Derive key from password and salt
        const saltBuffer = Buffer.from(salt, 'base64');
        const key = await CryptoService.deriveMasterKey(password, saltBuffer);

        // Decrypt the binary database
        let decryptedArrayBuffer: ArrayBuffer;
        try {
            decryptedArrayBuffer = await CryptoService.decryptBinary(key, ciphertext, iv);
        } catch (e) {
            throw new Error('Contraseña maestra incorrecta o archivo dañado.');
        }

        const db = new SQL.Database(new Uint8Array(decryptedArrayBuffer));
        const edb = new EncryptedDatabase(db, salt);
        await edb.migrate();
        return edb;
    }

    async save(dbPath: string, password: string): Promise<void> {
        const binaryDb = this.db.export(); // returns Uint8Array
        
        let saltBuffer: Uint8Array;
        if (this.salt) {
            saltBuffer = new Uint8Array(Buffer.from(this.salt, 'base64'));
        } else {
            saltBuffer = webcrypto.getRandomValues(new Uint8Array(16));
            this.salt = Buffer.from(saltBuffer).toString('base64');
        }

        const key = await CryptoService.deriveMasterKey(password, saltBuffer as any);
        const { ciphertext, iv } = await CryptoService.encryptBinary(key, binaryDb.buffer as any);

        const payload = {
            salt: this.salt,
            iv,
            ciphertext
        };

        fs.writeFileSync(dbPath, JSON.stringify(payload, null, 2), 'utf-8');
    }

    async migrate(): Promise<void> {
        // Create tables if they do not exist
        this.db.run(`
            CREATE TABLE IF NOT EXISTS credentials (
                id TEXT PRIMARY KEY,
                idPublico TEXT,
                idPrivado TEXT,
                authWitness TEXT,
                authIv TEXT,
                salt TEXT,
                publicKey TEXT,
                encryptedPrivateKey TEXT,
                privateKeyIv TEXT,
                createdAt INTEGER
            );
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS devices (
                deviceId TEXT PRIMARY KEY,
                idPublico TEXT,
                label TEXT,
                isOnline INTEGER,
                lastSeen INTEGER,
                peerId TEXT,
                publicKey TEXT,
                accountCreatedAt INTEGER,
                globalSync INTEGER
            );
        `);
    }

    // Helper methods for CLI usage
    async getCredentials(): Promise<any | null> {
        const stmt = this.db.prepare("SELECT * FROM credentials WHERE id = 'me'");
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return {
                idPublico: row.idPublico,
                idPrivado: row.idPrivado,
                authWitness: row.authWitness,
                authIv: row.authIv,
                salt: row.salt,
                publicKey: JSON.parse(row.publicKey as string),
                encryptedPrivateKey: row.encryptedPrivateKey,
                privateKeyIv: row.privateKeyIv,
                createdAt: row.createdAt
            };
        }
        stmt.free();
        return null;
    }

    async setCredentials(creds: any): Promise<void> {
        this.db.run(
            `INSERT OR REPLACE INTO credentials (
                id, idPublico, idPrivado, authWitness, authIv, salt, publicKey, encryptedPrivateKey, privateKeyIv, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                'me',
                creds.idPublico,
                creds.idPrivado,
                creds.authWitness,
                creds.authIv,
                creds.salt,
                JSON.stringify(creds.publicKey),
                creds.encryptedPrivateKey,
                creds.privateKeyIv,
                creds.createdAt
            ]
        );
    }

    async addDevice(device: any): Promise<void> {
        this.db.run(
            `INSERT OR REPLACE INTO devices (
                deviceId, idPublico, label, isOnline, lastSeen, peerId, publicKey, accountCreatedAt, globalSync
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                device.deviceId,
                device.idPublico,
                device.label,
                device.isOnline ? 1 : 0,
                device.lastSeen,
                device.peerId,
                JSON.stringify(device.publicKey),
                device.accountCreatedAt,
                device.globalSync ? 1 : 0
            ]
        );
    }

    async deleteCredentials(): Promise<void> {
        this.db.run("DELETE FROM credentials WHERE id = 'me'");
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
