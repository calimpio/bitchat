import { DB } from './db.ts';
import { Estado } from '../models/state.ts';
import { Credentials, ContactMap } from '../models/types.ts';
import { CryptoService, arrayBufferToBase64, base64ToArrayBuffer } from './crypto.ts';
import { IBitChatAuth } from './interfaces/IAuthService.ts';

export async function hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generarCuartaCredencial(idPublico: string, idPrivado: string, passwordHash: string): Promise<string> {
    return await hashString(`${idPublico}:${idPrivado}:${passwordHash}`);
}

export async function generarQuintaId(cuartaA: string, cuartaB: string): Promise<string> {
    const combined = [cuartaA, cuartaB].sort().join('');
    const hash = await hashString(combined);
    return hash.substring(0, 10);
}

export const BitChatAuth: IBitChatAuth = {
    async guardarMisCredenciales(idPublico: string, idPrivado: string, password: string): Promise<void> {
        const passwordHash = await hashString(password);
        
        // 1. Salt for master key derivation
        const saltBuffer = crypto.getRandomValues(new Uint8Array(16));
        const saltBase64 = await arrayBufferToBase64(saltBuffer);
        
        // 2. Derive master AES key
        const masterKey = await CryptoService.deriveMasterKey(password, saltBuffer);
        
        // 3. Generate ECDH keypair
        const keyPair = await CryptoService.generateECDHKeyPair();
        const publicKeyJWK = await CryptoService.exportKey(keyPair.publicKey);
        const privateKeyJWK = await CryptoService.exportKey(keyPair.privateKey);
        
        // 4. Encrypt Private Key
        const { ciphertext: encryptedPriv, iv: privIv } = await CryptoService.encrypt(masterKey, JSON.stringify(privateKeyJWK));
        
        const creds: Credentials = { 
            idPublico, 
            idPrivado, 
            passwordHash,
            salt: saltBase64,
            publicKey: publicKeyJWK,
            encryptedPrivateKey: encryptedPriv,
            privateKeyIv: privIv
        };
        
        await DB.setCreds(creds);
        Estado.me = creds;
        Estado.aesKey = masterKey;
    },

    async obtenerMisCredenciales(): Promise<Credentials | null> {
        if (!Estado.me) Estado.me = await DB.getCreds();
        return Estado.me;
    },

    async verificarPassword(inputPassword: string): Promise<boolean> {
        const creds = await this.obtenerMisCredenciales();
        if (!creds) return false;
        const inputHash = await hashString(inputPassword);
        if (inputHash !== creds.passwordHash) return false;
        
        // Migration: If legacy account (no salt), upgrade it
        if (!creds.salt) {
            console.log("[BitChat Migration] Legacy account detected, upgrading...");
            await this.guardarMisCredenciales(creds.idPublico, creds.idPrivado, inputPassword);
        } else {
            // Derive and store AES key in state
            const saltBuffer = await base64ToArrayBuffer(creds.salt);
            Estado.aesKey = await CryptoService.deriveMasterKey(inputPassword, saltBuffer);
        }
        
        return true;
    },

    obtenerContactos(): ContactMap {
        return JSON.parse(localStorage.getItem('bitchat_auth_contacts') || '{}');
    },

    guardarContacto(idPublico: string, tokenCuartaCredencial: string, insecure: boolean = false, publicKey?: JsonWebKey): void {
        const contactos = this.obtenerContactos();
        contactos[idPublico] = { tokenCuartaCredencial, insecure, publicKey };
        localStorage.setItem('bitchat_auth_contacts', JSON.stringify(contactos));
    },

    marcarContactoInseguro(idPublico: string): void {
        const contactos = this.obtenerContactos();
        if (contactos[idPublico]) {
            contactos[idPublico].insecure = true;
            localStorage.setItem('bitchat_auth_contacts', JSON.stringify(contactos));
        }
    }
};