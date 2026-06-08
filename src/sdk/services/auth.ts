import { DB } from './db.ts';
import { useStore } from '../../store/useStore.ts';
import { Credentials, ContactMap, Contact } from '../models/types.ts';
import { CryptoService, arrayBufferToBase64, base64ToArrayBuffer } from './crypto.ts';
import { IBitChatAuth } from './interfaces/IAuthService.ts';
import { VaultService } from './vault.ts';

export function normalizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export async function hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(normalizeId(str));
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
        
        // 5. Create Auth Witness (Proof of knowledge)
        const { ciphertext: witness, iv: witnessIv } = await CryptoService.encrypt(masterKey, "BITCHAT_IDENTITY_OK");

        const creds: Credentials = { 
            idPublico, 
            idPrivado, 
            authWitness: witness,
            authIv: witnessIv,
            salt: saltBase64,
            publicKey: publicKeyJWK,
            encryptedPrivateKey: encryptedPriv,
            privateKeyIv: privIv
        };
        
        await DB.setCreds(creds);
        useStore.getState().setMe(creds);
        useStore.getState().setAesKey(masterKey);
    },

    async obtenerMisCredenciales(): Promise<Credentials | null> {
        if (!useStore.getState().me) useStore.getState().setMe(await DB.getCreds());
        return useStore.getState().me;
    },

    async verificarPassword(inputPassword: string): Promise<boolean> {
        const creds = await this.obtenerMisCredenciales();
        if (!creds) return false;

        // --- Migration Phase A: Legacy SHA-256 Check ---
        if (creds.passwordHash && !creds.authWitness) {
            const inputHash = await hashString(inputPassword);
            if (inputHash !== creds.passwordHash) return false;
            
            await this.guardarMisCredenciales(creds.idPublico, creds.idPrivado, inputPassword);
            return true;
        }

        // --- Secure Phase: Witness Decryption ---
        if (!creds.salt || !creds.authWitness || !creds.authIv) return false;

        try {
            const saltBuffer = await base64ToArrayBuffer(creds.salt);
            const masterKey = await CryptoService.deriveMasterKey(inputPassword, saltBuffer);
            
            const decryptedWitness = await CryptoService.decrypt(masterKey, creds.authWitness, creds.authIv);
            if (decryptedWitness === "BITCHAT_IDENTITY_OK") {
                useStore.getState().setAesKey(masterKey);
                return true;
            }
        } catch (e) {
            console.error('Derivation/Auth failure', e);
        }
        
        return false;
    },

    async obtenerContactos(): Promise<ContactMap> {
        const encryptedList = await DB.getContacts();
        const map: ContactMap = {};
        for (const item of encryptedList) {
            try {
                const idPublico = (item as any).idPublico;
                const decryptedContact = await VaultService.decryptForMe<Contact>(item);
                map[idPublico] = decryptedContact;
            } catch (e) {
                console.error("Failed to decrypt contact", e);
            }
        }
        return map;
    },

    async guardarContacto(idPublico: string, tokenCuartaCredencial: string, insecure: boolean = false, publicKey?: JsonWebKey): Promise<void> {
        const contactData: Contact = { tokenCuartaCredencial, insecure, publicKey };
        const encrypted = await VaultService.encryptForMe(idPublico, contactData);
        await DB.saveContact(idPublico, encrypted);
    },

    async marcarContactoInseguro(idPublico: string): Promise<void> {
        const contactos = await this.obtenerContactos();
        if (contactos[idPublico]) {
            contactos[idPublico].insecure = true;
            await this.guardarContacto(idPublico, contactos[idPublico].tokenCuartaCredencial, true, contactos[idPublico].publicKey);
        }
    },

    async eliminarContacto(idPublico: string): Promise<void> {
        await DB.deleteContact(idPublico);
    },

    async migrarContactosSeguros(): Promise<void> {
        const legacyJSON = localStorage.getItem('bitchat_auth_contacts');
        if (!legacyJSON) return;

        try {
            const legacyMap: ContactMap = JSON.parse(legacyJSON);
            for (const idPublico in legacyMap) {
                const c = legacyMap[idPublico];
                await this.guardarContacto(idPublico, c.tokenCuartaCredencial, c.insecure, c.publicKey);
            }
            localStorage.removeItem('bitchat_auth_contacts');
        } catch (e) {
            console.error("Migration failure", e);
        }
    }
};