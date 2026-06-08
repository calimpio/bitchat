import { Peer, DataConnection } from 'peerjs';
import { DB } from './db.ts';
import { BitChatAuth, generarCuartaCredencial, generarQuintaId, hashString } from './auth.ts';
import { IPaqueteData, IPaqueteSyncData, ContactMap, Message, Credentials } from '../models/types.ts';
import { CryptoService } from './crypto.ts';
import { VaultService } from './vault.ts';
import { IPeerService } from './interfaces/IPeerService.ts';
import { useStore } from '../../store/useStore.ts';

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
    // SERVIDOR: Manejo de solicitudes entrantes (lo que otros me piden)
    // =========================================================================
    _server: {
        async handleIdentityProbe(conn: DataConnection, paquete: any) {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;
            const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
            if (paquete.cuarta === miCuarta) {
                const remoteDeviceId = paquete.deviceId || conn.peer!.replace('bc-v2-', '').split('-')[0];
                if (PeerService.deviceConns) PeerService.deviceConns[remoteDeviceId] = conn;
                
                await DB.addDevice({ 
                    deviceId: remoteDeviceId, 
                    idPublico: paquete.deIdPublico, 
                    label: paquete.deviceLabel || 'Otra Terminal', 
                    isOnline: true, 
                    lastSeen: Date.now(), 
                    peerId: conn.peer, 
                    publicKey: paquete.publicKey,
                    accountCreatedAt: paquete.createdAt
                });

                const soyMasAntiguo = !paquete.createdAt || misCreds.createdAt < paquete.createdAt;
                conn.send({ 
                    tipo: 'IDENTITY_MATCH', 
                    deviceId: PeerService.localDeviceId, 
                    deviceLabel: PeerService.localEnvLabel, 
                    publicKey: misCreds.publicKey, 
                    creds: soyMasAntiguo ? misCreds : undefined,
                    createdAt: misCreds.createdAt
                });

                if (!PeerService.syncSessions[remoteDeviceId]) {
                    PeerService.syncSessions[remoteDeviceId] = true;
                    const allMsgs = await DB.getAllMessages();
                    const lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
                    const repairMsgIds = allMsgs.filter(m => !!m.ciphertext).map(m => m.msgId);
                    conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds });
                }
                if (PeerService.onRefresh) PeerService.onRefresh();
            } else { 
                conn.send({ tipo: 'IDENTITY_CONFLICT' }); 
                PeerService._alertarContactosDeIntentoDeSecuestro(misCreds.idPublico); 
            }
        },

        async handleIdentityMatch(conn: DataConnection, paquete: any) {
            const remoteDeviceId = paquete.deviceId || conn.peer?.replace('bc-v2-', '').split('-')[0];
            if (!remoteDeviceId) return;
            
            if (PeerService.deviceConns) PeerService.deviceConns[remoteDeviceId] = conn;
            await DB.addDevice({ 
                deviceId: remoteDeviceId, 
                idPublico: conn.peer!.replace('bc-v2-', '').split('-')[0], 
                label: paquete.deviceLabel || 'Otra Terminal', 
                isOnline: true, 
                lastSeen: Date.now(), 
                peerId: conn.peer, 
                publicKey: paquete.publicKey,
                accountCreatedAt: paquete.createdAt
            });

            if (paquete.creds) {
                const myNewCreds: Credentials = { ...paquete.creds };
                const keyPair = await CryptoService.generateECDHKeyPair();
                myNewCreds.publicKey = await CryptoService.exportKey(keyPair.publicKey);
                const masterKey = useStore.getState().aesKey;
                if (masterKey) {
                    const privKeyJWK = await CryptoService.exportKey(keyPair.privateKey);
                    const { ciphertext, iv } = await CryptoService.encrypt(masterKey, JSON.stringify(privKeyJWK));
                    myNewCreds.encryptedPrivateKey = ciphertext;
                    myNewCreds.privateKeyIv = iv;
                }
                await DB.setCreds(myNewCreds);
                useStore.getState().setMe(myNewCreds);
            }

            if (!PeerService.syncSessions[remoteDeviceId]) {
                PeerService.syncSessions[remoteDeviceId] = true;
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (misCreds) {
                    const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                    const allMsgs = await DB.getAllMessages();
                    const lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
                    const repairMsgIds = allMsgs.filter(m => !!m.ciphertext).map(m => m.msgId);
                    conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds });
                }
            }
            if (PeerService.onRefresh) PeerService.onRefresh();
        },

        async handleSyncRequest(conn: DataConnection, paquete: any) {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;
            const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
            if (paquete.cuarta === miCuarta) {
                const allDevices = await DB.getDevices(), requestingDevice = allDevices.find(d => d.peerId === conn.peer);
                if (!requestingDevice) { conn.close(); return; }
                
                const allContactos = await BitChatAuth.obtenerContactos(), filteredContactos: ContactMap = {}, allowedChatIds: string[] = [];
                for (const id in allContactos) { 
                    if (allContactos[id].syncAllowedDevices?.includes(requestingDevice.deviceId)) { 
                        filteredContactos[id] = allContactos[id]; 
                        allowedChatIds.push(id); 
                    } 
                }

                const allMensajes = await DB.getAllMessages();
                const deltaMensajes = allMensajes.filter(m => {
                    if (!m.msgId) return false;
                    const isAllowed = allowedChatIds.includes(m.chatId);
                    if (!isAllowed) return false;
                    if (paquete.repairMsgIds?.includes(m.msgId)) return true;
                    return m.time > (paquete.lastMessageTime || 0);
                });

                for (const m of deltaMensajes) {
                    if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                        const sharedKey = await PeerService._getSharedKey(m.chatId);
                        if (sharedKey) { 
                            try { m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv); m.ciphertext = undefined; m.iv = undefined; } catch (e) { } 
                        }
                    }
                }

                const payload = { contactos: filteredContactos, mensajes: deltaMensajes };
                const vault = await VaultService.encryptForE2EE('SYNC_PAYLOAD', payload, requestingDevice.publicKey || misCreds.publicKey!);
                
                if (paquete.reqId) await PeerService.respond(conn, paquete.reqId, 'SYNC_DATA', { vault });
                else conn.send({ tipo: 'SYNC_DATA', vault });
            } else { conn.close(); }
        },

        async handleIncomingMessage(conn: DataConnection, paquete: any) {
            const sharedKey = await PeerService._getSharedKey(paquete.miIdPublico!);
            let decryptedText = '[Mensaje Cifrado]', isDecrypted = false;
            if (sharedKey) { try { decryptedText = await CryptoService.decrypt(sharedKey, paquete.txt, paquete.iv); isDecrypted = true; } catch (e) { } }
            const chatMsg: Message = { msgId: paquete.msgId, chatId: paquete.miIdPublico!, de: paquete.miIdPublico!, msg: decryptedText, time: paquete.time, status: 'read', secure: true, iv: isDecrypted ? undefined : paquete.iv, ciphertext: isDecrypted ? undefined : paquete.txt };
            await DB.addMessage(chatMsg);
            conn.send({ tipo: 'MSG_ACK', msgId: paquete.msgId, read: true });
            PeerService._replicateMessage(chatMsg);
            if (PeerService.onMessage) PeerService.onMessage(paquete.miIdPublico!);
            if (PeerService.onRefresh) PeerService.onRefresh();
        },

        async handleSecurityAlert(paquete: any) {
            await BitChatAuth.marcarContactoInseguro(paquete.idComprometido);
            if (PeerService.onRefresh) PeerService.onRefresh();
        },

        async handleConnectionReq(conn: DataConnection, paquete: any) {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (misCreds?.publicKey && paquete.huellaDestino === await CryptoService.getFingerprint(misCreds.publicKey)) 
                { await PeerService.aceptarConexion(paquete.deIdPublico); return; }
            await DB.addRequest({ idPublico: paquete.deIdPublico, time: Date.now(), publicKey: paquete.publicKey });
            if (PeerService.onRefresh) PeerService.onRefresh();
        },

        async handleSyncData(conn: DataConnection, paquete: any) {
            console.log(`[SYNC-DEBUG] Recibido SYNC_DATA de ${conn.peer}`);
            let contactos: ContactMap = paquete.contactos || {};
            let mensajes: Message[] = paquete.mensajes || [];

            if (paquete.vault) {
                try {
                    const decrypted = await VaultService.decryptFromE2EE<{ contactos: ContactMap, mensajes: Message[] }>(paquete.vault);
                    contactos = decrypted.contactos;
                    mensajes = decrypted.mensajes;
                    console.log(`[SYNC-DEBUG] Bóveda E2EE descifrada con éxito: ${Object.keys(contactos).length} contactos, ${mensajes.length} mensajes.`);
                } catch (e) {
                    console.error('[SYNC-DEBUG] ERROR FATAL: No se pudo descifrar la bóveda E2EE de sincronización:', e);
                    return;
                }
            }

            for (const id in contactos) { 
                await BitChatAuth.guardarContacto(id, contactos[id].tokenCuartaCredencial, contactos[id].insecure, contactos[id].publicKey, contactos[id].syncAllowedDevices, contactos[id].sharedSecret); 
                delete PeerService.sharedKeys[id]; 
            }

            const validados = mensajes.filter(m => m.msgId || m.time);
            for (const m of validados) {
                if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                    const sharedKey = await PeerService._getSharedKey(m.chatId);
                    if (sharedKey) { 
                        try { m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv); m.ciphertext = undefined; m.iv = undefined; } catch (e) { } 
                    }
                }
            }
            await DB.importMessages(validados);
            if (PeerService.onRefresh) PeerService.onRefresh();
        }
    },

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

    async _handleServerRequest(conn: DataConnection, paquete: IPaqueteData) {
        const senderId = paquete.tipo === 'CONNECTION_REQ' ? paquete.deIdPublico : conn.peer!.replace('bc-v2-', '').split('-')[0];
        if (await DB.isBlocked(senderId)) { conn.close(); return; }

        switch (paquete.tipo) {
            case 'IDENTITY_PROBE': await this._server!.handleIdentityProbe(conn, paquete); break;
            case 'IDENTITY_MATCH': await this._server!.handleIdentityMatch(conn, paquete); break;
            case 'SYNC_REQUEST': await this._server!.handleSyncRequest(conn, paquete); break;
            case 'MSG': await this._server!.handleIncomingMessage(conn, paquete); break;
            case 'SECURITY_ALERT': await this._server!.handleSecurityAlert(paquete); break;
            case 'CONNECTION_REQ': await this._server!.handleConnectionReq(conn, paquete); break;
            case 'SYNC_DATA': await this._server!.handleSyncData(conn, paquete); break;
            case 'CONNECTION_REJECTED': 
                useStore.getState().solicitudesEnviadasPendientes.delete(paquete.deIdPublico); 
                if (this.onRefresh) this.onRefresh(); 
                break;
            case 'CONNECTION_ACCEPTED':
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (misCreds) {
                    const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                    conn.send({ tipo: 'HANDSHAKE_START', miIdPublico: misCreds.idPublico, cuartaCredencial: miCuarta, publicKey: misCreds.publicKey! });
                }
                break;
            case 'HANDSHAKE_START':
                const credsStart = await BitChatAuth.obtenerMisCredenciales();
                if (credsStart) {
                    const miCuarta = await generarCuartaCredencial(credsStart.idPublico, credsStart.idPrivado, useStore.getState().masterPassword);
                    await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencial, false, paquete.publicKey);
                    this._replicateContact(paquete.miIdPublico);
                    conn.send({ tipo: 'HANDSHAKE_FINAL', miIdPublico: credsStart.idPublico, cuartaCredencialAmigo: miCuarta, publicKey: credsStart.publicKey! });
                    this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencial, conn);
                }
                break;
            case 'HANDSHAKE_FINAL':
                const credsFinal = await BitChatAuth.obtenerMisCredenciales();
                if (credsFinal) {
                    const miCuarta = await generarCuartaCredencial(credsFinal.idPublico, credsFinal.idPrivado, useStore.getState().masterPassword);
                    await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencialAmigo, false, paquete.publicKey);
                    this._replicateContact(paquete.miIdPublico);
                    this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencialAmigo, conn);
                    this._enviarPendientes(paquete.miIdPublico, conn);
                    if (this.onRefresh) this.onRefresh();
                }
                break;
            case 'MSG_ACK':
                await DB.updateMessageByMsgId(paquete.msgId, { status: paquete.read ? 'read' : 'sent' });
                if (this.onRefresh) this.onRefresh();
                break;
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
                await this._handleServerRequest!(conn, paquete);
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
            if (info.conn?.open) { info.conn.send({ tipo: 'MSG', msgId: uniqueId, miIdPublico: misCreds.idPublico, channel: info.channelId, txt: ciphertext, iv, time: Date.now() }); }
            else {
                const hashedId = await hashString(idPublicoAmigo);
                const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`);
                conn.on('open', () => { conn.send({ tipo: 'MSG', msgId: uniqueId, miIdPublico: misCreds.idPublico, channel: info.channelId, txt: ciphertext, iv, time: Date.now() }); this.conexionesP2PDirectas[idPublicoAmigo].conn = conn; });
                this._procesarEntrante(conn);
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
            const sharedKey = await this._getSharedKey(msgCopy.chatId);
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

    async respond(conn: DataConnection, reqId: string, tipo: string, payload: any): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (conn.open) { conn.send({ tipo, reqId, isResponse: true, miIdPublico: misCreds?.idPublico, ...payload }); }
    }
};
