import { Message, RequestRecord, Credentials, Device } from '../models/types.ts';
import { Repository, Branch, DriveObject, PullRequest } from '../models/drive.ts';
import { useStore } from '../../store/useStore.ts';
import { CryptoService } from './crypto.ts';
import { IDBService } from './interfaces/IDBService.ts';
import { EncryptedVaultObject } from '../models/vault.ts';

export const DB: IDBService = {
    db: null,

    init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('bitmsg_db', 14);
            req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
                const db = (e.target as IDBOpenDBRequest).result;
                const tx = (e.target as IDBOpenDBRequest).transaction!;
                
                if (db.objectStoreNames.contains('messages')) {
                    const store = tx.objectStore('messages');
                    if (store.keyPath !== 'msgId') {
                        db.deleteObjectStore('messages');
                    }
                }
                
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'msgId' });
                    store.createIndex('chatId', 'chatId', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                }
                if (!db.objectStoreNames.contains('credentials')) {
                    db.createObjectStore('credentials', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('requests')) {
                    db.createObjectStore('requests', { keyPath: 'idPublico' });
                }
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'idPublico' });
                }
                if (!db.objectStoreNames.contains('blacklist')) {
                    db.createObjectStore('blacklist', { keyPath: 'idPublico' });
                }
                if (db.objectStoreNames.contains('devices')) {
                    db.deleteObjectStore('devices');
                }
                db.createObjectStore('devices', { keyPath: 'deviceId' });

                // bitDrive Object Stores
                if (!db.objectStoreNames.contains('drive_repositories')) {
                    db.createObjectStore('drive_repositories', { keyPath: 'repoId' });
                }
                if (!db.objectStoreNames.contains('drive_branches')) {
                    db.createObjectStore('drive_branches', { keyPath: 'branchId' });
                }
                if (!db.objectStoreNames.contains('drive_objects')) {
                    db.createObjectStore('drive_objects', { keyPath: 'hash' });
                }
                if (!db.objectStoreNames.contains('drive_pull_requests')) {
                    db.createObjectStore('drive_pull_requests', { keyPath: 'prId' });
                }
            };
            req.onsuccess = (e: Event) => {
                this.db = (e.target as IDBOpenDBRequest).result;
                resolve();
            };
            req.onerror = () => reject(req.error);
        });
    },

    async addDevice(device: Device): Promise<void> {
        const now = Date.now();
        if (!device.createdAt) device.createdAt = now;
        if (!device.updatedAt) device.updatedAt = now;
        if (!device.lastSeen) device.lastSeen = now;

        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('devices', 'readwrite');
            const store = tx.objectStore('devices');
            store.put(device).onsuccess = () => resolve();
        });
    },

    async getDevices(): Promise<Device[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('devices', 'readonly');
            const store = tx.objectStore('devices');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as Device[]);
        });
    },

    async deleteDevice(deviceId: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('devices', 'readwrite');
            const store = tx.objectStore('devices');
            store.delete(deviceId).onsuccess = () => resolve();
        });
    },

    async addBlock(idPublico: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('blacklist', 'readwrite');
            const store = tx.objectStore('blacklist');
            store.put({ idPublico, time: Date.now() }).onsuccess = () => resolve();
        });
    },

    async getBlacklist(): Promise<string[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('blacklist', 'readonly');
            const store = tx.objectStore('blacklist');
            const req = store.getAll();
            req.onsuccess = () => resolve((req.result as { idPublico: string }[]).map(item => item.idPublico));
        });
    },

    async unblock(idPublico: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('blacklist', 'readwrite');
            const store = tx.objectStore('blacklist');
            store.delete(idPublico).onsuccess = () => resolve();
        });
    },

    async isBlocked(idPublico: string): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(false);
            const tx = this.db.transaction('blacklist', 'readonly');
            const store = tx.objectStore('blacklist');
            const req = store.get(idPublico);
            req.onsuccess = () => resolve(!!req.result);
        });
    },

    async deleteChat(chatId: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            const index = store.index('chatId');
            const req = index.openCursor(IDBKeyRange.only(chatId));
            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });
    },

    async addRequest(req: RequestRecord): Promise<void> {
        const now = Date.now();
        if (!req.time) req.time = now;
        req.updatedAt = now;

        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('requests', 'readwrite');
            const store = tx.objectStore('requests');
            store.put(req).onsuccess = () => resolve();
        });
    },

    async getRequests(): Promise<RequestRecord[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('requests', 'readonly');
            const store = tx.objectStore('requests');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as RequestRecord[]);
        });
    },

    async deleteRequest(idPublico: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('requests', 'readwrite');
            const store = tx.objectStore('requests');
            store.delete(idPublico).onsuccess = () => resolve();
        });
    },

    async setCreds(creds: Credentials): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('credentials', 'readwrite');
            const store = tx.objectStore('credentials');
            store.put({ id: 'me', ...creds }).onsuccess = () => resolve();
        });
    },

    async getCreds(): Promise<Credentials | null> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const tx = this.db.transaction('credentials', 'readonly');
            const store = tx.objectStore('credentials');
            const req = store.get('me');
            req.onsuccess = () => resolve(req.result as Credentials);
            req.onerror = () => resolve(null);
        });
    },

    async encryptMsg(msg: string): Promise<{ ciphertext: string, iv: string }> {
        const { aesKey } = useStore.getState();
        if (!aesKey) return { ciphertext: msg, iv: '' };
        return await CryptoService.encrypt(aesKey, msg);
    },

    async decryptMsg(ciphertext: string, iv: string): Promise<string> {
        const { aesKey } = useStore.getState();
        if (!aesKey || !iv) return ciphertext;
        try {
            return await CryptoService.decrypt(aesKey, ciphertext, iv);
        } catch (e) {
            console.error('Failed to decrypt local message', e);
            return '[Decryption Error]';
        }
    },

    async addMessage(msg: Message): Promise<string | undefined> {
        const { aesKey } = useStore.getState();

        // VALIDACIÓN: El mensaje debe tener al menos msgId o Fecha
        if (!msg.msgId && !msg.time) {
            console.warn('[DB] Rechazando mensaje sin msgId y sin Fecha');
            return undefined;
        }
        
        // Si el mensaje está legible y tenemos la llave de la bóveda, 
        // lo ciframos para persistencia local bajo el Master Password.
        if (aesKey && msg.msg !== '[Mensaje Cifrado]' && !msg.ciphertext && !msg.iv) {
            const encrypted = await this.encryptMsg(msg.msg);
            msg.msg = encrypted.ciphertext;
            msg.iv = encrypted.iv;
        }

        msg.updatedAt = Date.now();

        return new Promise((resolve) => {
            if (!this.db) return resolve(undefined);
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            if (msg.msgId) {
                const checkReq = store.get(msg.msgId);
                checkReq.onsuccess = () => {
                    if (checkReq.result) {
                        const existing = checkReq.result as Message;
                        // REPARACIÓN: Si el mensaje existente era ilegible y el nuevo viene legible, actualizamos.
                        const existingIsEncrypted = existing.msg === '[Mensaje Cifrado]' || !!existing.ciphertext;
                        const newIsDecrypted = msg.msg !== '[Mensaje Cifrado]' && !msg.ciphertext;

                        if (existingIsEncrypted && newIsDecrypted) {
                            const updated: Message = { ...existing, ...msg, updatedAt: Date.now() };
                            // Limpieza estricta de metadatos de transporte antiguo
                            if (!msg.ciphertext) updated.ciphertext = undefined;
                            store.put(updated).onsuccess = () => resolve(existing.msgId);
                        } else {
                            resolve(existing.msgId);
                        }
                    }
                    else {
                        const addReq = store.add(msg);
                        addReq.onsuccess = () => resolve(msg.msgId);
                    }
                };
            } else {
                // Si no tiene msgId (raro en v2), lo ignoramos o generamos uno
                console.warn('[DB] addMessage: No se puede guardar mensaje sin msgId');
                resolve(undefined);
            }
        });
    },

    async cleanInvalidMessages(): Promise<void> {
        if (!this.db) return;
        const messages = await this.getAllMessages();
        const toDelete = messages.filter(m => !m.msgId && !m.time);
        if (toDelete.length > 0) {
            console.log(`[DB] Limpiando ${toDelete.length} mensajes inválidos...`);
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            for (const m of toDelete) {
                if (m.msgId) store.delete(m.msgId);
            }
        }
    },

    async getAllMessages(): Promise<Message[]> {
        const messages: Message[] = await new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as Message[]);
        });

        for (const m of messages) {
            // Solo desciframos mensajes protegidos por la bóveda local (sin ciphertext de transporte)
            if (m.iv && !m.ciphertext) {
                try {
                    m.msg = await this.decryptMsg(m.msg, m.iv);
                    delete m.iv; 
                } catch (e) {
                    m.msg = '[Mensaje Cifrado]';
                }
            }
        }
        return messages;
    },

    async importMessages(messages: Message[]): Promise<void> {
        if (!this.db) return;
        for (const m of messages) {
            await this.addMessage(m);
        }
    },

    async updateMessageByMsgId(msgId: string, updates: Partial<Message>): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            const getReq = store.get(msgId);
            getReq.onsuccess = async () => {
                if (!getReq.result) return resolve();
                const data = { ...getReq.result as Message, ...updates };
                store.put(data).onsuccess = () => resolve();
            };
        });
    },

    async getChatMessages(chatId: string): Promise<Message[]> {
        const messages: Message[] = await new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const index = store.index('chatId');
            const req = index.getAll(chatId);
            req.onsuccess = () => resolve((req.result as Message[]).sort((a, b) => a.time - b.time));
        });

        for (const m of messages) {
            if (m.iv && !m.ciphertext) {
                try {
                    m.msg = await this.decryptMsg(m.msg, m.iv);
                    delete m.iv;
                } catch (e) {
                    m.msg = '[Mensaje Cifrado]';
                }
            }
        }
        return messages;
    },

    async getPendingMessages(): Promise<Message[]> {
        const messages: Message[] = await new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const index = store.index('status');
            const req = index.getAll('saved');
            req.onsuccess = () => resolve(req.result as Message[]);
        });

        for (const m of messages) {
            if (m.iv && !m.ciphertext) {
                try {
                    m.msg = await this.decryptMsg(m.msg, m.iv);
                    delete m.iv;
                } catch (e) {
                    m.msg = '[Mensaje Cifrado]';
                }
            }
        }
        return messages;
    },

    async saveContact(idPublico: string, data: EncryptedVaultObject): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('contacts', 'readwrite');
            const store = tx.objectStore('contacts');
            store.put({ idPublico, ...data }).onsuccess = () => resolve();
        });
    },

    async getContacts(): Promise<(EncryptedVaultObject & { idPublico: string })[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('contacts', 'readonly');
            const store = tx.objectStore('contacts');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result as (EncryptedVaultObject & { idPublico: string })[]);
        });
    },

    async deleteContact(idPublico: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('contacts', 'readwrite');
            const store = tx.objectStore('contacts');
            store.delete(idPublico).onsuccess = () => resolve();
        });
    },

    async migratePlainMessages(): Promise<void> {
        const { aesKey } = useStore.getState();
        if (!this.db || !aesKey) return;
        const tx = this.db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const req = store.openCursor();
        
        return new Promise((resolve) => {
            req.onsuccess = async (e) => {
                const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    const m = cursor.value as Message;
                    
                    const isPlain = !m.iv;
                    const isP2PTransport = !!m.ciphertext && m.msg !== '[Mensaje Cifrado]';

                    if (isPlain || isP2PTransport) {
                        const encrypted = await this.encryptMsg(m.msg);
                        m.msg = encrypted.ciphertext;
                        m.iv = encrypted.iv;
                        delete m.ciphertext; 
                        cursor.update(m);
                        console.log(`[MIGRACIÓN] Mensaje ${m.msgId} migrado a persistencia unificada.`);
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });
    },

    // =========================================================================
    // bitDrive Database Implementations
    // =========================================================================
    async saveRepository(repo: Repository): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('drive_repositories', 'readwrite');
            const store = tx.objectStore('drive_repositories');
            store.put(repo).onsuccess = () => resolve();
        });
    },

    async getRepository(repoId: string): Promise<Repository | null> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const tx = this.db.transaction('drive_repositories', 'readonly');
            const store = tx.objectStore('drive_repositories');
            const req = store.get(repoId);
            req.onsuccess = () => resolve((req.result as Repository) || null);
            req.onerror = () => resolve(null);
        });
    },

    async getRepositories(): Promise<Repository[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('drive_repositories', 'readonly');
            const store = tx.objectStore('drive_repositories');
            const req = store.getAll();
            req.onsuccess = () => resolve((req.result as Repository[]) || []);
        });
    },

    async deleteRepository(repoId: string): Promise<void> {
        return new Promise(async (resolve) => {
            if (!this.db) return resolve();
            const branches = await this.getBranches(repoId);
            const pullRequests = await this.getPullRequests(repoId);
            const tx = this.db.transaction(['drive_repositories', 'drive_branches', 'drive_pull_requests'], 'readwrite');
            const repoStore = tx.objectStore('drive_repositories');
            const branchStore = tx.objectStore('drive_branches');
            const prStore = tx.objectStore('drive_pull_requests');
            repoStore.delete(repoId);
            for (const b of branches) {
                branchStore.delete(b.branchId);
            }
            for (const pr of pullRequests) {
                prStore.delete(pr.prId);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    },

    async saveBranch(branch: Branch): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('drive_branches', 'readwrite');
            const store = tx.objectStore('drive_branches');
            store.put(branch).onsuccess = () => resolve();
        });
    },

    async getBranch(repoId: string, name: string): Promise<Branch | null> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const tx = this.db.transaction('drive_branches', 'readonly');
            const store = tx.objectStore('drive_branches');
            const req = store.get(`${repoId}:${name}`);
            req.onsuccess = () => resolve((req.result as Branch) || null);
            req.onerror = () => resolve(null);
        });
    },

    async getBranches(repoId: string): Promise<Branch[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('drive_branches', 'readonly');
            const store = tx.objectStore('drive_branches');
            const req = store.getAll();
            req.onsuccess = () => {
                const all = (req.result as Branch[]) || [];
                resolve(all.filter(b => b.repoId === repoId));
            };
        });
    },

    async saveDriveObject(obj: DriveObject): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('drive_objects', 'readwrite');
            const store = tx.objectStore('drive_objects');
            store.put(obj).onsuccess = () => resolve();
        });
    },

    async getDriveObject(hash: string): Promise<DriveObject | null> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const tx = this.db.transaction('drive_objects', 'readonly');
            const store = tx.objectStore('drive_objects');
            const req = store.get(hash);
            req.onsuccess = () => resolve((req.result as DriveObject) || null);
            req.onerror = () => resolve(null);
        });
    },

    async savePullRequest(pr: PullRequest): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('drive_pull_requests', 'readwrite');
            const store = tx.objectStore('drive_pull_requests');
            store.put(pr).onsuccess = () => resolve();
        });
    },

    async getPullRequests(repoId: string): Promise<PullRequest[]> {
        return new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('drive_pull_requests', 'readonly');
            const store = tx.objectStore('drive_pull_requests');
            const req = store.getAll();
            req.onsuccess = () => {
                const all = (req.result as PullRequest[]) || [];
                resolve(all.filter(pr => pr.repoId === repoId));
            };
        });
    },

    async getPullRequest(repoId: string, prId: string): Promise<PullRequest | null> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const tx = this.db.transaction('drive_pull_requests', 'readonly');
            const store = tx.objectStore('drive_pull_requests');
            const req = store.get(prId);
            req.onsuccess = () => {
                const pr = req.result as PullRequest;
                if (pr && pr.repoId === repoId) {
                    resolve(pr);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => resolve(null);
        });
    }
};
