export interface EncryptedVaultObject {
    label: string; // Plaintext or searchable hash
    content: string; // Base64 ciphertext
    iv: string; // Base64 IV
    method: 'master' | 'e2ee';
    publicKey?: JsonWebKey; // If E2EE was used
}