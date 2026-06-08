import { Peer, DataConnection } from 'peerjs';
import { DB } from './db.ts';
import { BitChatAuth, generarCuartaCredencial, generarQuintaId, hashString } from './auth.ts';
import { IPaqueteData, ContactMap, Message } from '../models/types.ts';
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
    localDeviceId: undefined,
    localEnvLabel: undefined,

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

            // Re-trigger discovery and sync immediately upon opening
            DB.cleanInvalidMessages();
            this.buscarDispositivos();
            this.startBackgroundSync();
        });

        this.peer.on('disconnected', () => {
            console.warn('Nodo P2P desconectado. Reconectando...');
            this.peer?.reconnect();
        });

        this.peer.on('error', (err: any) => {
            if (err.type === 'unavailable-id' && !useSuffix) {
                console.log('ID base ocupado, iniciando como terminal secundaria...');
                this.inicializarNodo(idPublico, true);
                return;
            }
            if (err.type === 'peer-unavailable') return;
            if (err.type !== 'peer-unavailable' && err.type !== 'disconnected') {
                console.error('Error en PeerJS:', err);
            }
            if (err.type === 'unavailable-id') {
                this.inicializarNodo(idPublico, true);
            }
        });

        this.peer.on('connection', (conn) => {
            console.log('Nueva conexión entrante de:', conn.peer);
            this._procesarEntrante(conn);
        });
    },

    async validarIdentidadEnRed(idPublico: string, idPrivado: string, passwordHash: string): Promise<boolean> {
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
                conn.on('open', () => {
                    foundExisting = true; clearTimeout(timeout);
                    conn.send({ tipo: 'IDENTITY_PROBE', deIdPublico: idPublico, cuarta: miCuarta, nonce: crypto.randomUUID() });
                });
                conn.on('data', (data: unknown) => {
                    const paquete = data as IPaqueteData;
                    if (paquete.tipo === 'IDENTITY_CONFLICT') { probePeer.destroy(); resolve(false); }
                    if (paquete.tipo === 'IDENTITY_MATCH') { probePeer.destroy(); resolve(true); }
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

            // 1. Sync messages with pending contacts
            const pending = await DB.getPendingMessages();
            const uniqueTargets = [...new Set(pending.map(m => m.chatId))];
            for (const target of uniqueTargets) { this.conectarAContacto(target); }

            // 2. Retry pending contact requests
            for (const target of Array.from(useStore.getState().solicitudesEnviadasPendientes)) { this.conectarAContacto(target); }

            // 3. Discovery: Look for other personal terminals
            this.buscarDispositivos();
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
                publicKey: misCreds.publicKey
            });
        });
        this._procesarEntrante(conn);
    },

    async buscarDispositivos(): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        const hashedId = await hashString(misCreds.idPublico);
        const baseId = `bc-v2-${hashedId.substring(0, 24)}`;
        console.log('Iniciando búsqueda de terminales en la red privada...');
        this.conectarADispositivoPersonal(baseId);
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
            console.log(`Conexión abierta con contacto: ${idPublicoAmigo}`);
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
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const contactos = await BitChatAuth.obtenerContactos();
        if (!misCreds || !contactos[idAmigo]?.publicKey || !useStore.getState().aesKey) return null;
        try {
            const privKeyJWKJson = await CryptoService.decrypt(useStore.getState().aesKey!, misCreds.encryptedPrivateKey!, misCreds.privateKeyIv!);
            const myPrivKey = await crypto.subtle.importKey('jwk', JSON.parse(privKeyJWKJson), { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);
            const sharedKey = await CryptoService.deriveSharedSecret(myPrivKey, await CryptoService.importPublicECDHKey(contactos[idAmigo].publicKey!));
            this.sharedKeys[idAmigo] = sharedKey; return sharedKey;
        } catch (e) { return null; }
    },

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
            const senderId = paquete.tipo === 'CONNECTION_REQ' ? paquete.deIdPublico : conn.peer!.replace('bc-v2-', '').split('-')[0];
            if (await DB.isBlocked(senderId)) { conn.close(); return; }

            if (paquete.tipo === 'IDENTITY_PROBE') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                if (paquete.cuarta === miCuarta) {
                    const remoteDeviceId = paquete.deviceId || conn.peer!.replace('bc-v2-', '').split('-')[0];
                    if (this.deviceConns) this.deviceConns[remoteDeviceId] = conn;
                    await DB.addDevice({ deviceId: remoteDeviceId, idPublico: paquete.deIdPublico, label: paquete.deviceLabel || 'Otra Terminal', isOnline: true, lastSeen: Date.now(), peerId: conn.peer, publicKey: paquete.publicKey });
                    conn.send({ tipo: 'IDENTITY_MATCH', deviceId: this.localDeviceId, deviceLabel: this.localEnvLabel, publicKey: misCreds.publicKey });
                    if (this.onRefresh) this.onRefresh();
                } else { conn.send({ tipo: 'IDENTITY_CONFLICT' }); this._alertarContactosDeIntentoDeSecuestro(misCreds.idPublico); }
            }
            if (paquete.tipo === 'IDENTITY_MATCH') {
                const remoteDeviceId = paquete.deviceId || conn.peer?.replace('bc-v2-', '').split('-')[0];
                if (remoteDeviceId) {
                    if (this.deviceConns) this.deviceConns[remoteDeviceId] = conn;
                    await DB.addDevice({ deviceId: remoteDeviceId, idPublico: conn.peer!.replace('bc-v2-', '').split('-')[0], label: paquete.deviceLabel || 'Otra Terminal', isOnline: true, lastSeen: Date.now(), peerId: conn.peer, publicKey: paquete.publicKey });

                    if (!this.syncSessions[remoteDeviceId]) {
                        this.syncSessions[remoteDeviceId] = true;
                        const misCreds = await BitChatAuth.obtenerMisCredenciales();
                        if (misCreds) {
                            const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                            const allMsgs = await DB.getAllMessages();
                            const lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
                            const repairMsgIds = allMsgs.filter(m => !!m.ciphertext).map(m => m.msgId);
                            console.log(`[DEBUG-SYNC] Solicitando Sincronización Automática a ${remoteDeviceId}...`);
                            conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds });
                        }
                    }
                    if (this.onRefresh) this.onRefresh();
                }
            }
            if (paquete.tipo === 'SECURITY_ALERT') {
                await BitChatAuth.marcarContactoInseguro(paquete.idComprometido);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'CONNECTION_REQ') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (misCreds?.publicKey && paquete.huellaDestino === await CryptoService.getFingerprint(misCreds.publicKey)) 
                    { await this.aceptarConexion(paquete.deIdPublico); return; }
                await DB.addRequest({ idPublico: paquete.deIdPublico, time: Date.now(), publicKey: paquete.publicKey });
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'CONNECTION_REJECTED') 
                { useStore.getState().solicitudesEnviadasPendientes.delete(paquete.deIdPublico); if (this.onRefresh) this.onRefresh(); }
            if (paquete.tipo === 'CONNECTION_ACCEPTED') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                conn.send({ tipo: 'HANDSHAKE_START', miIdPublico: misCreds.idPublico, cuartaCredencial: miCuarta, publicKey: misCreds.publicKey! });
            }
            if (paquete.tipo === 'HANDSHAKE_START') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencial, false, paquete.publicKey);
                this._replicateContact(paquete.miIdPublico);
                conn.send({ tipo: 'HANDSHAKE_FINAL', miIdPublico: misCreds.idPublico, cuartaCredencialAmigo: miCuarta, publicKey: misCreds.publicKey! });
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencial, conn);
            }
            if (paquete.tipo === 'HANDSHAKE_FINAL') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencialAmigo, false, paquete.publicKey);
                this._replicateContact(paquete.miIdPublico);
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencialAmigo, conn);
                this._enviarPendientes(paquete.miIdPublico, conn);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'MSG') {
                const sharedKey = await this._getSharedKey(paquete.miIdPublico!);
                let decryptedText = '[Mensaje Cifrado]', isDecrypted = false;
                if (sharedKey) { try { decryptedText = await CryptoService.decrypt(sharedKey, paquete.txt, paquete.iv); isDecrypted = true; } catch (e) { } }
                const chatMsg: Message = { msgId: paquete.msgId, chatId: paquete.miIdPublico!, de: paquete.miIdPublico!, msg: decryptedText, time: paquete.time, status: 'read', secure: true, iv: isDecrypted ? undefined : paquete.iv, ciphertext: isDecrypted ? undefined : paquete.txt };
                await DB.addMessage(chatMsg);
                conn.send({ tipo: 'MSG_ACK', msgId: paquete.msgId, read: true });
                this._replicateMessage(chatMsg);
                if (this.onMessage) this.onMessage(paquete.miIdPublico!);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'MSG_ACK') 
                { await DB.updateMessageByMsgId(paquete.msgId, { status: paquete.read ? 'read' : 'sent' }); if (this.onRefresh) this.onRefresh(); }
            if (paquete.tipo === 'SYNC_REQUEST') {
                console.log(`[SYNC-DEBUG] Recibido SYNC_REQUEST de dispositivo ${conn.peer}. lastMessageTime: ${paquete.lastMessageTime}, repairIds: ${paquete.repairMsgIds?.length || 0}`);
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) { console.error('[SYNC-DEBUG] No se encontraron credenciales locales.'); return; }
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                if (paquete.cuarta === miCuarta) {
                    const allDevices = await DB.getDevices(), requestingDevice = allDevices.find(d => d.peerId === conn.peer);
                    if (!requestingDevice) { console.warn(`[SYNC-DEBUG] Dispositivo solicitante ${conn.peer} no encontrado en DB.`); conn.close(); return; }
                    
                    const allContactos = await BitChatAuth.obtenerContactos(), filteredContactos: ContactMap = {}, allowedChatIds: string[] = [];
                    for (const id in allContactos) { 
                        if (allContactos[id].syncAllowedDevices?.includes(requestingDevice.deviceId)) { 
                            filteredContactos[id] = allContactos[id]; 
                            allowedChatIds.push(id); 
                        } 
                    }
                    console.log(`[SYNC-DEBUG] ${allowedChatIds.length} chats permitidos para dispositivo ${requestingDevice.deviceId}`);

                    const allMensajes = await DB.getAllMessages();
                    const isRepair = (paquete.repairMsgIds && paquete.repairMsgIds.length > 0);
                    const deltaMensajes = allMensajes.filter(m => {
                        if (!m.msgId) return false;
                        const isAllowed = allowedChatIds.includes(m.chatId);
                        if (!isAllowed) return false;
                        if (isRepair) return true;
                        return m.time > (paquete.lastMessageTime || 0);
                    });
                    
                    console.log(`[SYNC-DEBUG] Filtrados ${deltaMensajes.length} mensajes para enviar.`);

                    for (const m of deltaMensajes) {
                        if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                            const sharedKey = await this._getSharedKey(m.chatId);
                            if (sharedKey) { 
                                try { 
                                    m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv); 
                                    m.ciphertext = undefined; m.iv = undefined; 
                                } catch (e) {
                                    console.warn(`[SYNC-DEBUG] Fallo al descifrar mensaje ${m.msgId} del chat ${m.chatId} antes de enviar.`);
                                } 
                            } else {
                                console.warn(`[SYNC-DEBUG] Sin llave compartida para descifrar mensaje ${m.msgId} del chat ${m.chatId}`);
                            }
                        }
                    }

                    // E2EE para dispositivos: Cifrar payload con la llave pública del dispositivo que solicita
                    const payload = { contactos: filteredContactos, mensajes: deltaMensajes };
                    console.log(`[SYNC-DEBUG] Cifrando payload de sincronización para dispositivo ${requestingDevice.deviceId}...`);
                    const vault = await VaultService.encryptForE2EE('SYNC_PAYLOAD', payload, requestingDevice.publicKey || misCreds.publicKey!);
                    conn.send({ tipo: 'SYNC_DATA', vault });
                } else { 
                    console.warn('[SYNC-DEBUG] Conflicto de cuarta credencial en SYNC_REQUEST.');
                    conn.close(); 
                }
            }
            if (paquete.tipo === 'SYNC_DATA') {
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
                    console.log(`[SYNC-DEBUG] Importando/Actualizando contacto: ${id}`);
                    await BitChatAuth.guardarContacto(id, contactos[id].tokenCuartaCredencial, contactos[id].insecure, contactos[id].publicKey, contactos[id].syncAllowedDevices); 
                    delete this.sharedKeys[id]; 
                }

                const validados = mensajes.filter(m => m.msgId || m.time);
                console.log(`[SYNC-DEBUG] Procesando ${validados.length} mensajes recibidos...`);

                for (const m of validados) {
                    if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                        const sharedKey = await this._getSharedKey(m.chatId);
                        if (sharedKey) { 
                            try { 
                                m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv); 
                                m.ciphertext = undefined; m.iv = undefined; 
                            } catch (e) {
                                console.warn(`[SYNC-DEBUG] No se pudo descifrar el mensaje ${m.msgId} tras importación (llave incompatible).`);
                            } 
                        } else {
                            console.log(`[SYNC-DEBUG] Mensaje ${m.msgId} importado permanece cifrado (esperando llave de chat ${m.chatId}).`);
                        }
                    }
                }
                await DB.importMessages(validados);
                if (this.onRefresh) this.onRefresh();
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
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, password);
        const allMsgs = await DB.getAllMessages(), lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
        const repairMsgIds = allMsgs.filter(m => m.msg === '[Mensaje Cifrado]' && m.iv).map(m => m.msgId);
        return new Promise((resolve) => {
            const probePeer = new Peer(`bc-sync-probe-${crypto.randomUUID().substring(0, 8)}`);
            let foundAny = false;
            probePeer.on('open', () => {
                hashString(misCreds.idPublico).then(hash => {
                    const conn = probePeer.connect(`bc-v2-${hash.substring(0, 24)}`);
                    const timeout = setTimeout(() => { if (!foundAny) { probePeer.destroy(); resolve(false); } }, 8000);
                    conn.on('open', () => { foundAny = true; conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta, lastMessageTime: lastTime, repairMsgIds }); });
                    conn.on('data', async (data: unknown) => {
                        const paquete = data as IPaqueteData;
                        if (paquete.tipo === 'SYNC_DATA') {
                            let contactos: ContactMap = paquete.contactos || {};
                            let mensajes: Message[] = paquete.mensajes || [];

                            if (paquete.vault) {
                                try {
                                    const decrypted = await VaultService.decryptFromE2EE<{ contactos: ContactMap, mensajes: Message[] }>(paquete.vault);
                                    contactos = decrypted.contactos;
                                    mensajes = decrypted.mensajes;
                                } catch (e) {
                                    console.error('[SYNC-PROBE] Error decrypting E2EE payload:', e);
                                    probePeer.destroy();
                                    resolve(false);
                                    return;
                                }
                            }

                            for (const id in contactos) {
                                await BitChatAuth.guardarContacto(id, contactos[id].tokenCuartaCredencial, contactos[id].insecure, contactos[id].publicKey, contactos[id].syncAllowedDevices);
                                delete this.sharedKeys[id];
                            }

                            const validados = mensajes.filter(m => m.msgId || m.time);
                            await DB.importMessages(validados);
                            probePeer.destroy();
                            resolve(true);
                            if (this.onRefresh) this.onRefresh();
                        }
                    });
                });
            });
        });
    },

    async _replicateMessage(msg: Message): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds || !misCreds.publicKey || !this.deviceConns) return;

        const contactos = await BitChatAuth.obtenerContactos();
        const contact = contactos[msg.chatId];
        if (!contact || !contact.syncAllowedDevices || contact.syncAllowedDevices.length === 0) return;

        // Ensure message is decrypted for transmission between personal devices
        const msgCopy = { ...msg };

        // Caso A: Mensaje cifrado para la bóveda local (Vault)
        if (msgCopy.iv && !msgCopy.ciphertext) {
            try {
                const decrypted = await DB.decryptMsg(msgCopy.msg, msgCopy.iv);
                if (decrypted !== '[Decryption Error]') {
                    msgCopy.msg = decrypted;
                    msgCopy.iv = undefined;
                }
            } catch (e) {
                console.warn('[REPLICACIÓN] No se pudo descifrar para replicar:', e);
            }
        }

        // Caso B: Mensaje cifrado para transporte P2P
        if (msgCopy.msg === '[Mensaje Cifrado]' && msgCopy.ciphertext && msgCopy.iv) {
            const sharedKey = await this._getSharedKey(msgCopy.chatId);
            if (sharedKey) { 
                try { 
                    msgCopy.msg = await CryptoService.decrypt(sharedKey, msgCopy.ciphertext, msgCopy.iv); 
                    msgCopy.ciphertext = undefined; 
                    msgCopy.iv = undefined; 
                } catch (e) { } 
            }
        }

        const payload = { mensajes: [msgCopy], contactos: {} };
        const allDevices = await DB.getDevices();

        for (const deviceId in this.deviceConns) {
            if (contact.syncAllowedDevices.includes(deviceId) && deviceId !== this.localDeviceId) {
                const conn = this.deviceConns[deviceId];
                const device = allDevices.find(d => d.deviceId === deviceId);
                if (conn.open && device?.publicKey) {
                    console.log(`[REPLICACIÓN] Enviando mensaje ${msg.msgId} a dispositivo ${deviceId}`);
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

        const payload = { mensajes: [], contactos: { [idPublico]: contact } };
        const allDevices = await DB.getDevices();

        for (const deviceId in this.deviceConns) {
            const conn = this.deviceConns[deviceId];
            const device = allDevices.find(d => d.deviceId === deviceId);
            if (conn.open && deviceId !== this.localDeviceId && device?.publicKey) {
                console.log(`[REPLICACIÓN] Enviando contacto ${idPublico} a dispositivo ${deviceId}`);
                const vault = await VaultService.encryptForE2EE('SYNC_PAYLOAD', payload, device.publicKey);
                conn.send({ tipo: 'SYNC_DATA', vault });
            }
        }
    }
};
