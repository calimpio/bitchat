import { EncryptedVaultObject } from '../../models/vault.ts';

/**
 * IVaultService provides a high-level API for hybrid encryption of objects.
 * It allows data to be secured either for local storage (Master Key) 
 * or for secure sharing/syncing between devices (E2EE Key Pairs).
 */
export interface IVaultService {
    /** 
     * Encrypts an object using the derived Master AES Key. 
     * Only the current device (unlocked with password) can decrypt it.
     */
    encryptForMe<T = unknown>(label: string, content: T): Promise<EncryptedVaultObject>;

    /** Decrypts an object using the derived Master AES Key. */
    decryptForMe<T = unknown>(vaultObj: EncryptedVaultObject): Promise<T>;

    /** 
     * Encrypts an object targeted at a specific public key.
     * Uses ECDH shared secret derivation.
     */
    encryptForE2EE<T = unknown>(label: string, content: T, targetPublicKeyJWK: JsonWebKey): Promise<EncryptedVaultObject>;

    /** 
     * Decrypts an object that was encrypted using the user's public key.
     * Derives the secret using the local (decrypted) private key.
     */
    decryptFromE2EE<T = unknown>(vaultObj: EncryptedVaultObject): Promise<T>;
}
