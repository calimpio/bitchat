import { Credentials, ContactMap } from '../../models/types.ts';

/**
 * IBitChatAuth manages user identity, cryptographic key derivation, and contact management.
 * It handles the transition between legacy and modern identities using PBKDF2.
 */
export interface IBitChatAuth {
    /** 
     * Generates a new identity: derives a master key, creates ECDH keypair, 
     * encrypts private key and saves to IndexedDB.
     */
    guardarMisCredenciales(idPublico: string, idPrivado: string, password: string): Promise<void>;

    /** Retrieves the user credentials record from DB. */
    obtenerMisCredenciales(): Promise<Credentials | null>;

    /** 
     * Verifies the Master Password and derives the AES key. 
     * Handles automatic migration for legacy identities (missing salt).
     */
    verificarPassword(inputPassword: string): Promise<boolean>;

    /** Retrieves the contact list from localStorage. */
    obtenerContactos(): ContactMap;

    /** Saves or updates a contact including their E2EE Public Key. */
    guardarContacto(idPublico: string, tokenCuartaCredencial: string, insecure?: boolean, publicKey?: JsonWebKey): void;

    /** Flags a contact as insecure if an identity conflict is detected in the network. */
    marcarContactoInseguro(idPublico: string): void;
}
