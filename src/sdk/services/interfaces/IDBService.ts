import { Message, RequestRecord, Credentials, Device } from '../../models/types.ts';
import { EncryptedVaultObject } from '../../models/vault.ts';

/**
 * IDBService handles local persistence using IndexedDB.
 * It manages messages, identity credentials, and connection requests.
 * All messages are automatically encrypted before being stored and decrypted after reading.
 */
export interface IDBService {
    db: IDBDatabase | null;

    /** Initializes the IndexedDB database and object stores. */
    init(): Promise<void>;

    /** Deletes all messages and metadata associated with a specific chatId. */
    deleteChat(chatId: string): Promise<void>;

    /** Persists a connection request from a potential contact. */
    addRequest(req: RequestRecord): Promise<void>;

    /** Retrieves all pending connection requests. */
    getRequests(): Promise<RequestRecord[]>;

    /** Removes a specific connection request. */
    deleteRequest(idPublico: string): Promise<void>;

    /** Saves the user's encrypted credentials to the local database. */
    setCreds(creds: Credentials): Promise<void>;

    /** Retrieves the user's credentials (salt, encrypted private key, etc.). */
    getCreds(): Promise<Credentials | null>;

    /** Encrypts a message using the derived Master AES Key. */
    encryptMsg(msg: string): Promise<{ ciphertext: string, iv: string }>;

    /** Decrypts a message using the derived Master AES Key. */
    decryptMsg(ciphertext: string, iv: string): Promise<string>;

    /** 
     * Encrypts and adds a message to the database. 
     * If msgId exists, it updates the existing record instead of creating a duplicate.
     */
    addMessage(msg: Message): Promise<string | undefined>;

    /** Retrieves and decrypts all messages from the database. */
    getAllMessages(): Promise<Message[]>;

    /** Bulk imports messages (used during device synchronization). */
    importMessages(messages: Message[]): Promise<void>;

    /** Updates properties of a message by its unique cryptographic msgId. */
    updateMessageByMsgId(msgId: string, updates: Partial<Message>): Promise<void>;

    /** Retrieves and decrypts all messages belonging to a specific conversation. */
    getChatMessages(chatId: string): Promise<Message[]>;

    /** Retrieves all messages that have been saved locally but not yet acknowledged as sent. */
    getPendingMessages(): Promise<Message[]>;

    /** Saves a contact record (usually as a vault-encrypted object). */
    saveContact(idPublico: string, data: EncryptedVaultObject): Promise<void>;

    /** Retrieves all saved contacts. */
    getContacts(): Promise<(EncryptedVaultObject & { idPublico: string })[]>;

    /** Removes a contact from the database. */
    deleteContact(idPublico: string): Promise<void>;

    /** Adds a Public ID to the blacklist to ignore future requests. */
    addBlock(idPublico: string): Promise<void>;

    /** Retrieves the list of all blocked Public IDs. */
    getBlacklist(): Promise<string[]>;

    /** Removes an ID from the blacklist. */
    unblock(idPublico: string): Promise<void>;

    /** Checks if a specific ID is in the blacklist. */
    isBlocked(idPublico: string): Promise<boolean>;

    /** 
     * Migration Protocol: Iterates through the database and encrypts any plain-text messages 
     * from legacy versions using the Master Password.
     */
    migratePlainMessages(): Promise<void>;

    /** Adds or updates a known personal device. */
    addDevice(device: Device): Promise<void>;

    /** Retrieves all known personal devices. */
    getDevices(): Promise<Device[]>;

    /** Deletes a device from the known devices list. */
    deleteDevice(deviceId: string): Promise<void>;

    /** Removes messages that lack both msgId and timestamp. */
    cleanInvalidMessages(): Promise<void>;
}
