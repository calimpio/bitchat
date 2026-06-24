import { CryptoService } from './crypto.ts';
import { useStore } from '../../store/useStore.ts';
import { BitMsgAuth } from './auth.ts';
import { EncryptedVaultObject } from '../models/vault.ts';
import { IVaultService } from './interfaces/IVaultService.ts';

export const VaultService: IVaultService = {
    /**
     * Encrypts an object so it can be decrypted by the Master Password (local)
     */
    async encryptForMe<T = unknown>(label: string, content: T): Promise<EncryptedVaultObject> {
        const { aesKey } = useStore.getState();
        if (!aesKey) throw new Error("Terminal locked: Master key not derived.");
        
        const plainText = JSON.stringify(content);
        const { ciphertext, iv } = await CryptoService.encrypt(aesKey, plainText);
        const now = Date.now();
        
        return {
            label,
            content: ciphertext,
            iv,
            method: 'master',
            createdAt: now,
            updatedAt: now
        };
    },

    /**
     * Decrypts an object using the Master Password (local)
     */
    async decryptForMe<T = unknown>(vaultObj: EncryptedVaultObject): Promise<T> {
        const { aesKey } = useStore.getState();
        if (!aesKey) throw new Error("Terminal locked: Master key not derived.");
        if (vaultObj.method !== 'master') throw new Error("Invalid decryption method for Master Key.");
        
        const decryptedJson = await CryptoService.decrypt(aesKey, vaultObj.content, vaultObj.iv);
        return JSON.parse(decryptedJson);
    },

    /**
     * Encrypts an object using the E2EE Public Key of a specific device/contact.
     * This allows the same owner (or a friend) to decrypt it with their private key.
     */
    async encryptForE2EE<T = unknown>(label: string, content: T, targetPublicKeyJWK: JsonWebKey): Promise<EncryptedVaultObject> {
        const misCreds = await BitMsgAuth.obtenerMisCredenciales();
        const { aesKey } = useStore.getState();
        if (!misCreds || !aesKey) throw new Error("Terminal locked or identity missing.");

        // 1. Decrypt my own private key
        const privKeyJWKJson = await CryptoService.decrypt(aesKey, misCreds.encryptedPrivateKey!, misCreds.privateKeyIv!);
        const myPrivKey = await crypto.subtle.importKey('jwk', JSON.parse(privKeyJWKJson), { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);

        // 2. Import target public key
        const targetPubKey = await CryptoService.importPublicECDHKey(targetPublicKeyJWK);

        // 3. Derive shared secret (ECDH)
        const sharedKey = await CryptoService.deriveSharedSecret(myPrivKey, targetPubKey);

        // 4. Encrypt content
        const plainText = JSON.stringify(content);
        const { ciphertext, iv } = await CryptoService.encrypt(sharedKey, plainText);
        const now = Date.now();

        return {
            label,
            content: ciphertext,
            iv,
            method: 'e2ee',
            publicKey: misCreds.publicKey, // Include sender's public key so receiver can derive the secret
            createdAt: now,
            updatedAt: now
        };
    },

    /**
     * Decrypts an object received via E2EE using my local private key.
     */
    async decryptFromE2EE<T = unknown>(vaultObj: EncryptedVaultObject): Promise<T> {
        const misCreds = await BitMsgAuth.obtenerMisCredenciales();
        const { aesKey } = useStore.getState();
        if (!misCreds || !aesKey || !vaultObj.publicKey) throw new Error("Missing credentials or sender public key.");

        // 1. Decrypt my own private key
        const privKeyJWKJson = await CryptoService.decrypt(aesKey, misCreds.encryptedPrivateKey!, misCreds.privateKeyIv!);
        const myPrivKey = await crypto.subtle.importKey('jwk', JSON.parse(privKeyJWKJson), { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);

        // 2. Import sender's public key
        const senderPubKey = await CryptoService.importPublicECDHKey(vaultObj.publicKey);

        // 3. Derive shared secret (ECDH)
        const sharedKey = await CryptoService.deriveSharedSecret(myPrivKey, senderPubKey);

        // 4. Decrypt content
        const decryptedJson = await CryptoService.decrypt(sharedKey, vaultObj.content, vaultObj.iv);
        return JSON.parse(decryptedJson);
    }
};