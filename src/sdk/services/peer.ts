import { Peer, DataConnection } from 'peerjs';
import { DB } from './db.ts';
import { BitChatAuth, generarCuartaCredencial, generarQuintaId, hashString } from './auth.ts';
import { IPaqueteData, IPaqueteSyncData, ContactMap, Message, Credentials } from '../models/types.ts';
import { CryptoService } from './crypto.ts';
import { VaultService } from './vault.ts';
import { IPeerService } from './interfaces/IPeerService.ts';
import { useStore } from '../../store/useStore.ts';
import { RPCRouter } from './server/router.ts';

export const PeerService: IPeerService = {
    peer: null,
    conexionesP2PDirectas: {},
    syncSessions: {},
    sharedKeys: {},
    onRefresh: null,
    onMessage: null,
    deviceConns: {},
    pendingRequests: {},
    localDeviceId: undefined,
    localEnvLabel: undefined,

    // =========================================================================
    // CLIENTE: Lógica de iniciación y API (lo que yo pido)
    // =========================================================================
    async inicializarNodo(idPublico: string, useSuffix: boolean = false): Promise<void> {
        const hashedId = await hashString(idPublico);
        const myAuthId = `bc-v2-${hashedId.substring(0, 24)}`;

        const isWindows = !!(window as any).chrome?.webview;
        const userAgent = navigator.userAgent;
        let envLabel = 'Browser';
        if (isWindows) envLabel = 'Windows App';
        else if (userAgent.includes('Firefox')) envLabel = 'Firefox';
        else if (userAgent.includes('Chrome')) envLabel = 'Chrome';
        else if (userAgent.includes('Safari')) envLabel = 'Safari';

        this.localEnvLabel = envLabel;

        let deviceId = localStorage.getItem('bit_device_id');
        if (!deviceId) {
            deviceId = crypto.randomUUID().substring(0, 8);
            localStorage.setItem('bit_device_id', deviceId);
        }
        this.localDeviceId = deviceId;

        let fullId = myAuthId;
        if (useSuffix) {
            const sessionSuffix = crypto.randomUUID().substring(0, 4);
            fullId = `${myAuthId}-${sessionSuffix}`;
        }

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }

        this.peer = new Peer(fullId, { debug: 0 });

        this.peer.on('open', (id) => {
            console.log('Nodo P2P abierto con ID:', id);
            if (this.onRefresh) this.onRefresh();
            DB.cleanInvalidMessages();
            this.startBackgroundSync();
            this.buscarDispositivos();
        });

        this.peer.on('disconnected', () => {
            console.warn('Nodo P2P desconectado. Reconectando...');
            this.peer?.reconnect();
        });

        this.peer.on('error', (err: any) => {
            if (err.type === 'unavailable-id' && !useSuffix) {
                this.inicializarNodo(idPublico, true);
                return;
            }
            if (err.type === 'peer-unavailable') return;
            if (err.type !== 'peer-unavailable' && err.type !== 'disconnected') {
                console.error('Error en PeerJS:', err);
            }
        });

        this.peer.on('connection', (conn) => {
            console.log('Nueva conexión entrante de:', conn.peer);
            this._procesarEntrante(conn);
        });
    },

    async validarIdentidadEnRed(idPublico: string, idPrivado: string, passwordHash: string): Promise<boolean | Credentials> {
        return new Promise(async (resolve) => {
            const probeId = `bc-probe-${crypto.randomUUID().substring(0, 8)}`;
            const probePeer = new Peer(probeId);
            const miCuarta = await generarCuartaCredencial(idPublico, idPrivado, passwordHash);
            const targetHashedId = await hashString(idPublico);
            const targetAuthId = `bc-v2-${targetHashedId.substring(0, 24)}`;

            let foundExisting = false;

            probePeer.on('open', () => {
                const conn = probePeer.connect(targetAuthId);
                const timeout = setTimeout(() => { if (!foundExisting) { probePeer.destroy(); resolve(true); } }, 5000);
                conn.on('open', async () => {
                    foundExisting = true; clearTimeout(timeout);
                    const localCreds = await BitChatAuth.obtenerMisCredenciales();
                    conn.send({ 
                        tipo: 'IDENTITY_PROBE', 
                        deIdPublico: idPublico, 
                        cuarta: miCuarta, 
                        nonce: crypto.randomUUID(),
                        createdAt: localCreds?.createdAt
                    });
                });
                conn.on('data', (data: unknown) => {
                    const paquete = data as IPaqueteData;
                    if (paquete.tipo === 'IDENTITY_CONFLICT') { probePeer.destroy(); resolve(false); }
                    if (paquete.tipo === 'IDENTITY_MATCH') { probePeer.destroy(); resolve(paquete.creds || true); }
                });
                conn.on('error', () => { probePeer.destroy(); resolve(true); });
            });
        });
    },

    startBackgroundSync(): void {
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = setInterval(async () => {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;
            const pending = await DB.getPendingMessages();
            const uniqueTargets = [...new Set(pending.map(m => m.chatId))];
            for (const target of uniqueTargets) { this.conectarAContacto(target); }
            for (const target of Array.from(useStore.getState().solicitudesEnviadasPendientes)) { this.conectarAContacto(target); }
        }, 60000) as unknown as number;
    },

    async conectarADispositivoPersonal(targetId: string): Promise<void> {
        if (!this.peer || !this.peer.open || !targetId || targetId === this.peer.id) return;
        console.log(`Intentando conectar a dispositivo personal: ${targetId}`);
        const conn = this.peer.connect(targetId, { reliable: true });
        conn.on('open', async () => {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;
            const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
            conn.send({
                tipo: 'IDENTITY_PROBE',
                deIdPublico: misCreds.idPublico,
                cuarta: miCuarta,
                nonce: crypto.randomUUID(),
                deviceId: this.localDeviceId,
                deviceLabel: this.localEnvLabel,
                publicKey: misCreds.publicKey,
                createdAt: misCreds.createdAt
            });
        });
        this._procesarEntrante(conn);
    },

    async buscarDispositivos(): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        console.log('Iniciando búsqueda selectiva de terminales autorizadas...');
        const contactos = await BitChatAuth.obtenerContactos();
        const authorizedDeviceIds = new Set<string>();
        for (const id in contactos) {
            contactos[id].syncAllowedDevices?.forEach(dId => authorizedDeviceIds.add(dId));
        }
        const devices = await DB.getDevices();
        for (const dev of devices) {
            if (authorizedDeviceIds.has(dev.deviceId) && dev.peerId && dev.peerId !== this.peer?.id) {
                this.conectarADispositivoPersonal(dev.peerId);
            }
        }
    },

    async conectarAContacto(idPublicoAmigo: string, huellaEsperada?: string): Promise<void> {
        if (!this.peer || !this.peer.open) return;
        const existing = this.conexionesP2PDirectas[idPublicoAmigo];
        if (existing?.conn?.open) { this._enviarPendientes(idPublicoAmigo, existing.conn); return; }

        const hashedId = await hashString(idPublicoAmigo);
        const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`, { reliable: true });
        const contactos = await BitChatAuth.obtenerContactos();
        if (!contactos[idPublicoAmigo]) {
            useStore.getState().solicitudesEnviadasPendientes.add(idPublicoAmigo);
            this.conexionesP2PDirectas[idPublicoAmigo] = { status: 'PENDING', conn };
        }

        conn.on('open', async () => {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;
            if (contactos[idPublicoAmigo]) {
                if (this.conexionesP2PDirectas[idPublicoAmigo]?.status !== 'SECURE') {
                    const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                    conn.send({ tipo: 'HANDSHAKE_START', miIdPublico: misCreds.idPublico, cuartaCredencial: miCuarta, publicKey: misCreds.publicKey! });
                } else {
                    this.conexionesP2PDirectas[idPublicoAmigo].conn = conn;
                    this._enviarPendientes(idPublicoAmigo, conn);
                }
            } else {
                conn.send({ tipo: 'CONNECTION_REQ', deIdPublico: misCreds.idPublico, publicKey: misCreds.publicKey!, huellaDestino: huellaEsperada });
            }
        });
        this._procesarEntrante(conn);
    },

    async _getSharedKey(idAmigo: string): Promise<CryptoKey | null> {
        if (this.sharedKeys[idAmigo]) return this.sharedKeys[idAmigo];
        const contactos = await BitChatAuth.obtenerContactos();
        const contact = contactos[idAmigo];
        if (!contact) return null;
        if (contact.sharedSecret) {
            try {
                const sharedKey = await CryptoService.importAESKey(contact.sharedSecret);
                this.sharedKeys[idAmigo] = sharedKey;
                return sharedKey;
            } catch (e) { console.error("[CRYPTO] Error importando secreto:", e); }
        }
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds || !contact.publicKey || !useStore.getState().aesKey) return null;
        try {
            const privKeyJWKJson = await CryptoService.decrypt(useStore.getState().aesKey!, misCreds.encryptedPrivateKey!, misCreds.privateKeyIv!);
            const myPrivKey = await crypto.subtle.importKey('jwk', JSON.parse(privKeyJWKJson), { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);
            const sharedKey = await CryptoService.deriveSharedSecret(myPrivKey, await CryptoService.importPublicECDHKey(contact.publicKey!));
            this.sharedKeys[idAmigo] = sharedKey;
            const exportedSecret = await CryptoService.exportAESKey(sharedKey);
            await BitChatAuth.guardarContacto(idAmigo, contact.tokenCuartaCredencial, contact.insecure, contact.publicKey, contact.syncAllowedDevices, exportedSecret);
            return sharedKey;
        } catch (e) { return null; }
    },

    _handleClientResponse(paquete: any) {
        if (paquete.reqId && this.pendingRequests && this.pendingRequests[paquete.reqId]) {
            const { resolve, timeout } = this.pendingRequests[paquete.reqId];
            clearTimeout(timeout);
            delete this.pendingRequests[paquete.reqId];
            resolve(paquete);
        }
    },

    // =========================================================================
    // ENRUTADOR: Clasificación de paquetes entrantes
    // =========================================================================
    _procesarEntrante(conn: DataConnection): void {
        conn.on('close', () => {
            console.log(`Conexión cerrada: ${conn.peer}`);
            for (const id in this.conexionesP2PDirectas) {
                if (this.conexionesP2PDirectas[id].conn === conn) { delete this.conexionesP2PDirectas[id].conn; if (this.onRefresh) this.onRefresh(); break; }
            }
            if (this.deviceConns) {
                for (const deviceId in this.deviceConns) {
                    if (this.deviceConns[deviceId] === conn) { delete this.deviceConns[deviceId]; break; }
                }
            }
        });

        conn.on('data', async (data: unknown) => {
            const paquete = data as IPaqueteData;
            if (paquete.reqId && paquete.isResponse) {
                this._handleClientResponse!(paquete);
            } else {
                // Delegar al Router Modular del Servidor
                await RPCRouter.handle(conn, paquete);
            }
        });
    },

    async _alertarContactosDeIntentoDeSecuestro(miIdComprometido: string): Promise<void> {
        if (!this.peer) return;
        const contactos = await BitChatAuth.obtenerContactos();
        for (const idAmigo in contactos) {
            const hashedId = await hashString(idAmigo);
            const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`);
            conn.on('open', () => { conn.send({ tipo: 'SECURITY_ALERT', idComprometido: miIdComprometido }); setTimeout(() => conn.close(), 5000); });
        }
    },

    async _establecerCanalSeguro(idAmigo: string, miCuarta: string, suCuarta: string, conn?: DataConnection): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        delete this.sharedKeys[idAmigo];
        const quintaId = await generarQuintaId(miCuarta, suCuarta);
        this.conexionesP2PDirectas[idAmigo] = { channelId: `bitchat-safe-${[misCreds.idPublico, idAmigo].sort().join('')}-${quintaId}`, status: 'SECURE', conn: conn || this.conexionesP2PDirectas[idAmigo]?.conn };
        if (this.onRefresh) this.onRefresh();
    },

    async _enviarPendientes(chatId: string, conn: DataConnection): Promise<void> {
        if (!conn.open) return;
        const misCreds = await BitChatAuth.obtenerMisCredenciales(), info = this.conexionesP2PDirectas[chatId], sharedKey = await this._getSharedKey(chatId);
        if (!misCreds || !info || !sharedKey) return;
        const pending = await DB.getPendingMessages();
        for (const m of pending) {
            if (m.chatId === chatId) {
                const { ciphertext, iv } = await CryptoService.encrypt(sharedKey, m.msg);
                conn.send({ tipo: 'MSG', msgId: m.msgId, miIdPublico: misCreds.idPublico, channel: info.channelId, txt: ciphertext, iv, time: m.time });
            }
        }
    },

    async aceptarConexion(idPublicoAmigo: string): Promise<void> {
        if (!this.peer) return;
        const hashedId = await hashString(idPublicoAmigo);
        const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`);
        conn.on('open', () => { conn.send({ tipo: 'CONNECTION_ACCEPTED' }); });
        this._procesarEntrante(conn);
        await DB.deleteRequest(idPublicoAmigo);
        if (this.onRefresh) this.onRefresh();
    },

    async rechazarConexion(idPublicoAmigo: string): Promise<void> {
        if (!this.peer) return;
        const hashedId = await hashString(idPublicoAmigo);
        const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`);
        conn.on('open', async () => {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (misCreds) conn.send({ tipo: 'CONNECTION_REJECTED', deIdPublico: misCreds.idPublico });
            setTimeout(() => conn.close(), 1000);
        });
        await DB.deleteRequest(idPublicoAmigo);
        if (this.onRefresh) this.onRefresh();
    },

    async enviarMensaje(idPublicoAmigo: string, texto: string): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        const sharedKey = await this._getSharedKey(idPublicoAmigo), uniqueId = crypto.randomUUID();
        const chatMsg: Message = { msgId: uniqueId, chatId: idPublicoAmigo, de: misCreds.idPublico, msg: texto, time: Date.now(), status: 'saved', secure: true };
        await DB.addMessage(chatMsg);
        this._replicateMessage(chatMsg);

        const info = this.conexionesP2PDirectas[idPublicoAmigo];
        if (info?.status === 'SECURE' && sharedKey && this.peer) {
            const { ciphertext, iv } = await CryptoService.encrypt(sharedKey, texto);
            try {
                if (info.conn?.open) {
                    await this.request(info.conn, 'MSG', { msgId: uniqueId, miIdPublico: misCreds.idPublico, channel: info.channelId, txt: ciphertext, iv, time: Date.now() });
                } else {
                    const hashedId = await hashString(idPublicoAmigo);
                    const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`);
                    await new Promise((resolve, reject) => {
                        conn.on('open', async () => {
                            try {
                                await this.request(conn, 'MSG', { msgId: uniqueId, miIdPublico: misCreds.idPublico, channel: info.channelId, txt: ciphertext, iv, time: Date.now() });
                                this.conexionesP2PDirectas[idPublicoAmigo].conn = conn;
                                resolve(true);
                            } catch (e) { reject(e); }
                        });
                        conn.on('error', reject);
                        this._procesarEntrante(conn);
                    });
                }
            } catch (e) {
                console.error(`[RPC] Error enviando mensaje a ${idPublicoAmigo}:`, e);
            }
        } else { this.conectarAContacto(idPublicoAmigo); }
    },

    async iniciarSincronizacion(password: string): Promise<boolean> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return false;
        const hashedId = await hashString(misCreds.idPublico);
        const targetAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, password);
        const allMsgs = await DB.getAllMessages();
        const lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
        const repairMsgIds = allMsgs.filter(m => m.msg === '[Mensaje Cifrado]' && m.iv).map(m => m.msgId);
        return new Promise((resolve) => {
            const probePeer = new Peer(`bc-sync-rpc-${crypto.randomUUID().substring(0, 8)}`);
            probePeer.on('open', () => {
                const conn = probePeer.connect(targetAuthId);
                conn.on('open', async () => {
                    try {
                        const response = await this.request<IPaqueteSyncData>(conn, 'SYNC_REQUEST', { cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds });
                        let contactos: ContactMap = response.contactos || {};
                        let mensajes: Message[] = response.mensajes || [];
                        if (response.vault) {
                            const decrypted = await VaultService.decryptFromE2EE<{ contactos: ContactMap, mensajes: Message[] }>(response.vault);
                            contactos = decrypted.contactos; mensajes = decrypted.mensajes;
                        }
                        for (const id in contactos) {
                            await BitChatAuth.guardarContacto(id, contactos[id].tokenCuartaCredencial, contactos[id].insecure, contactos[id].publicKey, contactos[id].syncAllowedDevices, contactos[id].sharedSecret);
                            delete this.sharedKeys[id];
                        }
                        await DB.importMessages(mensajes.filter(m => m.msgId || m.time));
                        probePeer.destroy(); if (this.onRefresh) this.onRefresh(); resolve(true);
                    } catch (e) { probePeer.destroy(); resolve(false); }
                });
                conn.on('error', () => { probePeer.destroy(); resolve(false); });
            });
        });
    },

    async _replicateMessage(msg: Message): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds || !misCreds.publicKey || !this.deviceConns) return;
        const contactos = await BitChatAuth.obtenerContactos();
        const contact = contactos[msg.chatId];
        if (!contact || !contact.syncAllowedDevices || contact.syncAllowedDevices.length === 0) return;
        const msgCopy = { ...msg };
        if (msgCopy.iv && !msgCopy.ciphertext) {
            try { const decrypted = await DB.decryptMsg(msgCopy.msg, msgCopy.iv); if (decrypted !== '[Decryption Error]') { msgCopy.msg = decrypted; msgCopy.iv = undefined; } } catch (e) { }
        }
        if (msgCopy.msg === '[Mensaje Cifrado]' && msgCopy.ciphertext && msgCopy.iv) {
            const sharedKey = await PeerService._getSharedKey(msgCopy.chatId);
            if (sharedKey) { try { msgCopy.msg = await CryptoService.decrypt(sharedKey, msgCopy.ciphertext, msgCopy.iv); msgCopy.ciphertext = undefined; msgCopy.iv = undefined; } catch (e) { } }
        }
        const payload = { mensajes: [msgCopy], contactos: {} };
        const allDevices = await DB.getDevices();
        for (const deviceId in this.deviceConns) {
            if (contact.syncAllowedDevices.includes(deviceId) && deviceId !== this.localDeviceId) {
                const conn = this.deviceConns[deviceId], device = allDevices.find(d => d.deviceId === deviceId);
                if (conn.open && device?.publicKey) {
                    const vault = await VaultService.encryptForE2EE('SYNC_PAYLOAD', payload, device.publicKey);
                    conn.send({ tipo: 'SYNC_DATA', vault });
                }
            }
        }
    },

    async _replicateContact(idPublico: string): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds || !misCreds.publicKey || !this.deviceConns) return;
        const contactos = await BitChatAuth.obtenerContactos();
        const contact = contactos[idPublico];
        if (!contact) return;
        const payload = { mensajes: [], contactos: { [idPublico]: contact } }, allDevices = await DB.getDevices();
        for (const deviceId in this.deviceConns) {
            const conn = this.deviceConns[deviceId], device = allDevices.find(d => d.deviceId === deviceId);
            if (conn.open && deviceId !== this.localDeviceId && device?.publicKey) {
                const vault = await VaultService.encryptForE2EE('SYNC_PAYLOAD', payload, device.publicKey);
                conn.send({ tipo: 'SYNC_DATA', vault });
            }
        }
    },

    async syncChat(chatId: string): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
        const chatMsgs = await DB.getChatMessages(chatId);
        const lastTime = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1].time : 0;
        const repairMsgIds = chatMsgs.filter(m => !!m.ciphertext).map(m => m.msgId);
        if (this.deviceConns) {
            for (const deviceId in this.deviceConns) {
                const conn = this.deviceConns[deviceId];
                if (conn.open && deviceId !== this.localDeviceId) { conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds }); }
            }
        }
        const directConn = this.conexionesP2PDirectas[chatId]?.conn;
        if (directConn?.open) { directConn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds }); }
        else { this.conectarAContacto(chatId); }
    },

    async request<T>(conn: DataConnection, tipo: string, payload: any): Promise<T> {
        const reqId = crypto.randomUUID(), misCreds = await BitChatAuth.obtenerMisCredenciales();
        return new Promise((resolve, reject) => {
            if (!conn.open) return reject(new Error('Conexión cerrada'));
            const timeout = setTimeout(() => {
                if (this.pendingRequests && this.pendingRequests[reqId]) { delete this.pendingRequests[reqId]; reject(new Error(`Timeout esperando respuesta a ${tipo}`)); }
            }, 15000);
            if (this.pendingRequests) { this.pendingRequests[reqId] = { resolve, reject, timeout }; }
            conn.send({ tipo, reqId, miIdPublico: misCreds?.idPublico, ...payload });
        });
    },

    async response(conn: DataConnection, reqId: string, tipo: string, payload: any): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (conn.open) {
            conn.send({
                tipo,
                reqId,
                isResponse: true,
                miIdPublico: misCreds?.idPublico,
                ...payload
            });
        }
    }
};
