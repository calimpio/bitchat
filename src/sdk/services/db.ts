import { Message, RequestRecord, Credentials } from '../models/types.ts';
import { Estado } from '../models/state.ts';
import { CryptoService } from './crypto.ts';
import { IDBService } from './interfaces/IDBService.ts';

export const DB: IDBService = {
    db: null,

    init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('bitchat_db', 5);
            req.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('chatId', 'chatId', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('msgId', 'msgId', { unique: true });
                } else {
                    const tx = (e.target as IDBOpenDBRequest).transaction!;
                    const store = tx.objectStore('messages');
                    if (!store.indexNames.contains('msgId')) {
                        store.createIndex('msgId', 'msgId', { unique: true });
                    }
                }
                if (!db.objectStoreNames.contains('credentials')) {
                    db.createObjectStore('credentials', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('requests')) {
                    db.createObjectStore('requests', { keyPath: 'idPublico' });
                }
            };
            req.onsuccess = (e) => {
                this.db = (e.target as IDBOpenDBRequest).result;
                resolve();
            };
            req.onerror = () => reject(req.error);
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
            req.onsuccess = () => resolve(req.result);
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
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    },

    async encryptMsg(msg: string): Promise<{ ciphertext: string, iv: string }> {
        if (!Estado.aesKey) return { ciphertext: msg, iv: '' };
        return await CryptoService.encrypt(Estado.aesKey, msg);
    },

    async decryptMsg(ciphertext: string, iv: string): Promise<string> {
        if (!Estado.aesKey || !iv) return ciphertext;
        try {
            return await CryptoService.decrypt(Estado.aesKey, ciphertext, iv);
        } catch (e) {
            console.error('Failed to decrypt local message', e);
            return '[Decryption Error]';
        }
    },

    async addMessage(msg: Message): Promise<number | undefined> {
        if (Estado.aesKey && !msg.iv) {
            const encrypted = await this.encryptMsg(msg.msg);
            msg.msg = encrypted.ciphertext;
            msg.iv = encrypted.iv;
        }

        return new Promise((resolve) => {
            if (!this.db) return resolve(undefined);
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            if (msg.msgId) {
                const index = store.index('msgId');
                const checkReq = index.get(msg.msgId);
                checkReq.onsuccess = () => {
                    if (checkReq.result) resolve(checkReq.result.id);
                    else {
                        const addReq = store.add(msg);
                        addReq.onsuccess = (e) => resolve((e.target as IDBRequest).result);
                    }
                };
            } else {
                const addReq = store.add(msg);
                addReq.onsuccess = (e) => resolve((e.target as IDBRequest).result);
            }
        });
    },

    async getAllMessages(): Promise<Message[]> {
        const messages: Message[] = await new Promise((resolve) => {
            if (!this.db) return resolve([]);
            const tx = this.db.transaction('messages', 'readonly');
            const store = tx.objectStore('messages');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
        });

        for (const m of messages) {
            if (m.iv) m.msg = await this.decryptMsg(m.msg, m.iv);
        }
        return messages;
    },

    async importMessages(messages: Message[]): Promise<void> {
        if (!this.db) return;
        const tx = this.db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        messages.forEach(m => {
            delete m.id;
            store.put(m);
        });
        return new Promise(r => tx.oncomplete = () => r());
    },

    async updateMessage(id: number, updates: Partial<Message>): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            const getReq = store.get(id);
            getReq.onsuccess = async () => {
                if (!getReq.result) return resolve();
                const data = { ...getReq.result, ...updates };
                store.put(data).onsuccess = () => resolve();
            };
        });
    },

    async updateMessageByMsgId(msgId: string, updates: Partial<Message>): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve();
            const tx = this.db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            const index = store.index('msgId');
            const getReq = index.get(msgId);
            getReq.onsuccess = async () => {
                if (!getReq.result) return resolve();
                const data = { ...getReq.result, ...updates };
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
            req.onsuccess = () => resolve(req.result.sort((a: Message, b: Message) => a.time - b.time));
        });

        for (const m of messages) {
            if (m.iv) m.msg = await this.decryptMsg(m.msg, m.iv);
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
            req.onsuccess = () => resolve(req.result);
        });

        for (const m of messages) {
            if (m.iv) m.msg = await this.decryptMsg(m.msg, m.iv);
        }
        return messages;
    },

    async migratePlainMessages(): Promise<void> {
        if (!this.db || !Estado.aesKey) return;
        console.log("[BitChat Migration] Checking for unencrypted messages...");
        const tx = this.db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const req = store.openCursor();
        
        return new Promise((resolve) => {
            req.onsuccess = async (e) => {
                const cursor = (e.target as IDBRequest).result;
                if (cursor) {
                    const m = cursor.value as Message;
                    if (!m.iv) {
                        console.log(`[BitChat Migration] Encrypting message ${m.msgId}...`);
                        const encrypted = await this.encryptMsg(m.msg);
                        m.msg = encrypted.ciphertext;
                        m.iv = encrypted.iv;
                        cursor.update(m);
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });
    }
};