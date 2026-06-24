import { Credentials, ContactMap } from '../../models/types.ts';

/**
 * IBitMsgAuth manages user identity, cryptographic key derivation, and contact management.
 * It handles the transition between legacy and modern identities using PBKDF2.
 */
export interface IBitMsgAuth {
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

    /** Retrieves the contact list from secure storage. */
    obtenerContactos(): Promise<ContactMap>;

    /** Saves or updates a contact including their E2EE Public Key and sync permissions. */
    guardarContacto(idPublico: string, tokenCuartaCredencial: string, insecure?: boolean, publicKey?: JsonWebKey, syncAllowedDevices?: string[], sharedSecret?: string): Promise<void>;

    /** Flags a contact as insecure if an identity conflict is detected in the network. */
    marcarContactoInseguro(idPublico: string): Promise<void>;

    /** Removes a contact and their associated security metadata. */
    eliminarContacto(idPublico: string): Promise<void>;

    /** Migration Protocol: Moves contacts from localStorage to encrypted IndexedDB. */
    migrarContactosSeguros(): Promise<void>;
}
