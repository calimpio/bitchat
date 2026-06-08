import { Peer, DataConnection } from 'peerjs';
import { DB } from './db.ts';
import { BitChatAuth, generarCuartaCredencial, generarQuintaId, hashString } from './auth.ts';
import { AppState, IPaqueteData, ContactMap } from '../models/types.ts';
import { CryptoService } from './crypto.ts';
import { IPeerService } from './interfaces/IPeerService.ts';
import { useStore } from '../../store/useStore.ts';

export const PeerService: IPeerService = {
    peer: null,
    conexionesP2PDirectas: {},
    sharedKeys: {}, // Cache for session shared secrets
    onRefresh: null,
    onMessage: null,

    async inicializarNodo(idPublico: string, useSuffix: boolean = false): Promise<void> {
        const hashedId = await hashString(idPublico);
        const myAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
        
        // Detect Environment
        const isWindows = !!(window as any).chrome?.webview;
        const userAgent = navigator.userAgent;
        let envLabel = 'Browser';
        if (isWindows) envLabel = 'Windows App';
        else if (userAgent.includes('Firefox')) envLabel = 'Firefox';
        else if (userAgent.includes('Chrome')) envLabel = 'Chrome';
        else if (userAgent.includes('Safari')) envLabel = 'Safari';
        
        (this as any)._localEnvLabel = envLabel;

        // Persistent Device ID
        let deviceId = localStorage.getItem('bit_device_id');
        if (!deviceId) {
            deviceId = crypto.randomUUID().substring(0, 8);
            localStorage.setItem('bit_device_id', deviceId);
        }
        (this as any)._localDeviceId = deviceId;

        // Dynamic ID logic: Try to be primary, else use suffix
        let fullId = myAuthId;
        if (useSuffix) {
            const sessionSuffix = crypto.randomUUID().substring(0, 4);
            fullId = `${myAuthId}-${sessionSuffix}`;
        }

        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        
        this.peer = new Peer(fullId, {
            debug: 1 // Only errors
        });

        this.peer.on('open', (id) => {
            console.log('Nodo P2P abierto con ID:', id);
            if (this.onRefresh) this.onRefresh();
            this.startBackgroundSync();
        });

        this.peer.on('disconnected', () => {
            console.warn('Nodo P2P desconectado del servidor de señalización. Reintentando...');
            this.peer?.reconnect();
        });

        this.peer.on('error', (err: any) => {
            if (err.type === 'unavailable-id' && !useSuffix) {
                console.log('ID base ocupado, iniciando como terminal secundaria...');
                this.inicializarNodo(idPublico, true);
                return;
            }
            
            // Silence "peer-unavailable" errors for background discovery
            if (err.type === 'peer-unavailable') {
                return; 
            }

            console.error('Error en PeerJS:', err);
            if (err.type === 'unavailable-id') {
                this.inicializarNodo(idPublico, true); // Retry with new random suffix
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
                const timeout = setTimeout(() => { 
                    if (!foundExisting) { 
                        probePeer.destroy(); resolve(true); 
                    } 
                }, 5000);

                conn.on('open', () => {
                    foundExisting = true; clearTimeout(timeout);
                    conn.send({ tipo: 'IDENTITY_PROBE', deIdPublico: idPublico, cuarta: miCuarta, nonce: crypto.randomUUID() });
                });
                conn.on('data', (data: unknown) => {
                    const paquete = data as IPaqueteData;
                    if (paquete.tipo === 'IDENTITY_CONFLICT') { probePeer.destroy(); resolve(false); }
                    if (paquete.tipo === 'IDENTITY_MATCH') { probePeer.destroy(); resolve(true); }
                });
                conn.on('error', (err) => { 
                    probePeer.destroy(); resolve(true); 
                });
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

            // 3. Discovery: Look for other personal terminals (Identity Mesh)
            const hashedId = await hashString(misCreds.idPublico);
            const baseId = `bc-v2-${hashedId.substring(0, 24)}`;
            
            // In a real sovereign mesh, we'd use a DHT or local discovery, 
            // but for PeerJS we probe known patterns or rely on the server signaling.
            // For now, we try to connect to the "base" ID (the first terminal usually claims it)
            this.conectarADispositivoPersonal(baseId);
            
        }, 30000) as unknown as number;
    },

    async conectarADispositivoPersonal(targetId: string): Promise<void> {
        if (!this.peer || !this.peer.open || !targetId) return;
        if (targetId === this.peer.id) return; 

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
                deviceId: (this as any)._localDeviceId,
                deviceLabel: (this as any)._localEnvLabel
            });
        });
        this._procesarEntrante(conn);
    },

    async buscarDispositivos(): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        const hashedId = await hashString(misCreds.idPublico);
        const baseId = `bc-v2-${hashedId.substring(0, 24)}`;
        
        console.log('Iniciando búsqueda activa de dispositivos...');
        // In this architecture, we attempt to connect to the "base" ID.
        // If there are multiple devices, they would ideally have a way to 
        // announce themselves or we would scan common suffix patterns.
        this.conectarADispositivoPersonal(baseId);
    },

    async conectarAContacto(idPublicoAmigo: string, huellaEsperada?: string): Promise<void> {
        if (!this.peer || !this.peer.open) {
            console.error("Error: El nodo local no está listo (Peer no abierto).");
            return;
        }

        // Reutilizar conexión si ya existe y está abierta
        const existing = this.conexionesP2PDirectas[idPublicoAmigo];
        if (existing && existing.conn && existing.conn.open) {
            this._enviarPendientes(idPublicoAmigo, existing.conn);
            return;
        }

        const hashedId = await hashString(idPublicoAmigo);
        const targetAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
        
        console.log(`Intentando conectar a ${idPublicoAmigo} (${targetAuthId})...`);
        const conn = this.peer.connect(targetAuthId, {
            reliable: true
        });
        
        const contactos = await BitChatAuth.obtenerContactos();
        if (!contactos[idPublicoAmigo]) { 
            useStore.getState().solicitudesEnviadasPendientes.add(idPublicoAmigo); 
            // Register as PENDING in our local map to track it
            this.conexionesP2PDirectas[idPublicoAmigo] = { status: 'PENDING', conn };
        }

        conn.on('open', async () => {
            console.log(`Conexión abierta con ${idPublicoAmigo}`);
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;

            if (contactos[idPublicoAmigo]) {
                if (!this.conexionesP2PDirectas[idPublicoAmigo] || this.conexionesP2PDirectas[idPublicoAmigo].status !== 'SECURE') {
                    const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                    conn.send({ 
                        tipo: 'HANDSHAKE_START', 
                        miIdPublico: misCreds.idPublico, 
                        cuartaCredencial: miCuarta,
                        publicKey: misCreds.publicKey!
                    });
                } else { 
                    // Actualizar la conexión en el mapa
                    this.conexionesP2PDirectas[idPublicoAmigo].conn = conn;
                    this._enviarPendientes(idPublicoAmigo, conn); 
                }
            } else { 
                conn.send({ 
                    tipo: 'CONNECTION_REQ', 
                    deIdPublico: misCreds.idPublico,
                    publicKey: misCreds.publicKey!,
                    huellaDestino: huellaEsperada
                }); 
                alert(`Solicitud enviada a ${idPublicoAmigo}. Esperando respuesta...`);
            }
        });

        conn.on('error', (err) => {
            console.error(`Error de conexión con ${idPublicoAmigo}:`, err);
        });

        this._procesarEntrante(conn);
    },

    async _getSharedKey(idAmigo: string): Promise<CryptoKey | null> {
        if (this.sharedKeys[idAmigo]) return this.sharedKeys[idAmigo];
        
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const contactos = await BitChatAuth.obtenerContactos();
        if (!misCreds || !contactos[idAmigo] || !contactos[idAmigo].publicKey) return null;
        
        try {
            const { aesKey } = useStore.getState();
            if (!aesKey || !misCreds.encryptedPrivateKey || !misCreds.privateKeyIv) return null;
            const privKeyJWKJson = await CryptoService.decrypt(aesKey, misCreds.encryptedPrivateKey, misCreds.privateKeyIv);
            const privKeyJWK = JSON.parse(privKeyJWKJson);
            const myPrivKey = await crypto.subtle.importKey('jwk', privKeyJWK, { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);
            const friendPubKey = await CryptoService.importPublicECDHKey(contactos[idAmigo].publicKey!);
            const sharedKey = await CryptoService.deriveSharedSecret(myPrivKey, friendPubKey);
            this.sharedKeys[idAmigo] = sharedKey;
            return sharedKey;
        } catch (e) {
            console.error('Failed to derive shared key', e);
            return null;
        }
    },

    _procesarEntrante(conn: DataConnection): void {
        conn.on('close', () => {
            console.log(`Conexión cerrada con ${conn.peer}`);
            for (const id in this.conexionesP2PDirectas) {
                if (this.conexionesP2PDirectas[id].conn === conn) {
                    delete this.conexionesP2PDirectas[id].conn;
                    if (this.onRefresh) this.onRefresh();
                    break;
                }
            }
        });

        conn.on('data', async (data: unknown) => {
            const paquete = data as IPaqueteData;
            console.log(`Recibido paquete [${paquete.tipo}] de ${conn.peer}`);

            // SECURITY: Blacklist check
            const senderId = paquete.tipo === 'CONNECTION_REQ' ? paquete.deIdPublico : conn.peer!.replace('bc-v2-', '').split('-')[0];
            // Note: split('-')[0] handles cases where a suffix was added to the peer ID
            if (await DB.isBlocked(senderId)) {
                console.warn(`Bloqueado intento de comunicación de ID bloqueado: ${senderId}`);
                conn.close();
                return;
            }

            if (paquete.tipo === 'IDENTITY_PROBE') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                
                if (paquete.cuarta === miCuarta) { 
                    const remoteDeviceId = paquete.deviceId || conn.peer!.replace('bc-v2-', '').split('-')[0];
                    await DB.addDevice({
                        deviceId: remoteDeviceId,
                        idPublico: paquete.deIdPublico,
                        label: paquete.deviceLabel || 'Otra Terminal',
                        isOnline: true,
                        lastSeen: Date.now(),
                        peerId: conn.peer
                    });
                    conn.send({ 
                        tipo: 'IDENTITY_MATCH', 
                        deviceId: (this as any)._localDeviceId,
                        deviceLabel: (this as any)._localEnvLabel 
                    }); 
                    if (this.onRefresh) this.onRefresh();
                }
                else {
                    conn.send({ tipo: 'IDENTITY_CONFLICT' });
                    this._alertarContactosDeIntentoDeSecuestro(misCreds.idPublico);
                }
            }
            if (paquete.tipo === 'IDENTITY_MATCH') {
                console.log('Sincronización de Identidad Exitosa con dispositivo remoto.');
                const remoteDeviceId = paquete.deviceId || conn.peer?.replace('bc-v2-', '').split('-')[0];
                const ownerIdPublico = conn.peer?.replace('bc-v2-', '').split('-')[0]; // Fallback to hash if no deviceId
                if (remoteDeviceId) {
                    await DB.addDevice({
                        deviceId: remoteDeviceId,
                        idPublico: ownerIdPublico || 'unknown',
                        label: paquete.deviceLabel || 'Otra Terminal',
                        isOnline: true,
                        lastSeen: Date.now(),
                        peerId: conn.peer
                    });
                    if (this.onRefresh) this.onRefresh();
                }
            }
            if (paquete.tipo === 'SECURITY_ALERT') {
                await BitChatAuth.marcarContactoInseguro(paquete.idComprometido);
                if (this.onRefresh) this.onRefresh();
                alert(`¡ALERTA DE SEGURIDAD! El nodo ${paquete.idComprometido} podría estar comprometido.`);
            }
            if (paquete.tipo === 'CONNECTION_REQ') {
                // FAST-LINK logic
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (misCreds && misCreds.publicKey && paquete.huellaDestino) {
                    const miHuella = await CryptoService.getFingerprint(misCreds.publicKey);
                    if (paquete.huellaDestino === miHuella) {
                        await this.aceptarConexion(paquete.deIdPublico);
                        return;
                    }
                }

                await DB.addRequest({ 
                    idPublico: paquete.deIdPublico, 
                    time: Date.now(),
                    publicKey: paquete.publicKey
                });
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'CONNECTION_REJECTED') {
                console.log(`Solicitud rechazada por ${paquete.deIdPublico}`);
                useStore.getState().solicitudesEnviadasPendientes.delete(paquete.deIdPublico);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'CONNECTION_ACCEPTED') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                conn.send({ 
                    tipo: 'HANDSHAKE_START', 
                    miIdPublico: misCreds.idPublico, 
                    cuartaCredencial: miCuarta,
                    publicKey: misCreds.publicKey!
                });
            }
            if (paquete.tipo === 'HANDSHAKE_START') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencial, false, paquete.publicKey);
                conn.send({ 
                    tipo: 'HANDSHAKE_FINAL', 
                    miIdPublico: misCreds.idPublico, 
                    cuartaCredencialAmigo: miCuarta,
                    publicKey: misCreds.publicKey!
                });
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencial, conn);
            }
            if (paquete.tipo === 'HANDSHAKE_FINAL') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
                await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencialAmigo, false, paquete.publicKey);
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencialAmigo, conn);
                this._enviarPendientes(paquete.miIdPublico, conn);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'MSG') {
                const sharedKey = await this._getSharedKey(paquete.miIdPublico!);
                let decryptedText = '[Mensaje Cifrado]';
                if (sharedKey) {
                    try {
                        decryptedText = await CryptoService.decrypt(sharedKey, paquete.txt, paquete.iv);
                    } catch (e) {
                        console.error('Error descifrando mensaje:', e);
                    }
                }

                const chatMsg: any = {
                    msgId: paquete.msgId, chatId: paquete.miIdPublico!, de: paquete.miIdPublico!,
                    msg: decryptedText, time: paquete.time, status: 'read' as const, secure: true,
                    iv: paquete.iv,
                    ciphertext: paquete.txt // Store original for later retry
                };
                await DB.addMessage(chatMsg);
                conn.send({ tipo: 'MSG_ACK', msgId: paquete.msgId, read: true });
                if (this.onMessage) this.onMessage(paquete.miIdPublico!);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'MSG_ACK') {
                await DB.updateMessageByMsgId(paquete.msgId, { status: paquete.read ? 'read' : 'sent' });
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'SYNC_REQUEST') {
                console.log(`[DEBUG-SYNC] Recibida SYNC_REQUEST de ${conn.peer}`);
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) {
                    console.error('[DEBUG-SYNC] Error: No hay credenciales locales para procesar la sincronización.');
                    return;
                }
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);

                if (paquete.cuarta === miCuarta) {
                    console.log('[DEBUG-SYNC] Password (cuarta) validado correctamente.');

                    const allDevices = await DB.getDevices();
                    const requestingDevice = allDevices.find(d => d.peerId === conn.peer);

                    if (!requestingDevice) {
                        console.warn(`[DEBUG-SYNC] Denegado: El Peer ID ${conn.peer} no está vinculado como bitDevice.`);
                        conn.close();
                        return;
                    }

                    const lastKnownTime = paquete.lastMessageTime || 0;
                    console.log(`[DEBUG-SYNC] Sync Delta: Mensajes > ${new Date(lastKnownTime).toLocaleString()}`);
                    if (paquete.repairMsgIds && paquete.repairMsgIds.length > 0) {
                        console.log(`[DEBUG-SYNC] Solicitud de reparación para ${paquete.repairMsgIds.length} mensajes.`);
                    }

                    const allContactos = await BitChatAuth.obtenerContactos();
                    const filteredContactos: ContactMap = {};
                    const allowedChatIds: string[] = [];

                    for (const id in allContactos) {
                        const c = allContactos[id];
                        const isAllowed = c.syncAllowedDevices?.includes(requestingDevice.deviceId);
                        if (isAllowed) {
                            filteredContactos[id] = c;
                            allowedChatIds.push(id);
                        }
                    }

                    const allMensajes = await DB.getAllMessages();
                    
                    // Filter: (New messages) OR (Requested for repair)
                    const deltaMensajes = allMensajes.filter(m => 
                        (m.time > lastKnownTime) || 
                        (paquete.repairMsgIds && paquete.repairMsgIds.includes(m.msgId))
                    );

                    // [REPAIR] Try to decrypt encrypted messages before sending
                    for (const m of deltaMensajes) {
                        if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                            const sharedKey = await this._getSharedKey(m.chatId);
                            if (sharedKey) {
                                try {
                                    m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv);
                                    console.log(`[DEBUG-SYNC] Reparado mensaje ${m.msgId} antes de enviar.`);
                                } catch (e) {}
                            }
                        }
                    }

                    const filteredMensajes = deltaMensajes.filter(m => allowedChatIds.includes(m.chatId));

                    console.log(`[DEBUG-SYNC] Enviando ${Object.keys(filteredContactos).length} contactos y ${filteredMensajes.length} mensajes (Delta/Repair).`);
                    conn.send({ tipo: 'SYNC_DATA', contactos: filteredContactos, mensajes: filteredMensajes });
                } else {
                    console.warn('[DEBUG-SYNC] Intento de sincronización fallido: Password incorrecto.');
                    conn.close();
                }
            }
            if (paquete.tipo === 'SYNC_DATA') {
                console.log(`[DEBUG-SYNC] Recibido paquete SYNC_DATA con ${Object.keys(paquete.contactos).length} contactos y ${paquete.mensajes.length} mensajes.`);
                for (const idPublico in paquete.contactos) {
                    const c = paquete.contactos[idPublico];
                    console.log(`[DEBUG-SYNC] Importando contacto: ${idPublico}`);
                    await BitChatAuth.guardarContacto(idPublico, c.tokenCuartaCredencial, c.insecure, c.publicKey, c.syncAllowedDevices);
                    delete this.sharedKeys[idPublico];
                }

                // [REPAIR] Try to decrypt imported messages if we now have the keys
                for (const m of paquete.mensajes) {
                    if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                        const sharedKey = await this._getSharedKey(m.chatId);
                        if (sharedKey) {
                            try {
                                m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv);
                                console.log(`[DEBUG-SYNC] Reparado mensaje ${m.msgId} tras importar.`);
                            } catch (e) {
                                // Keep encrypted
                            }
                        }
                    }
                }

                console.log(`[DEBUG-SYNC] Importando ${paquete.mensajes.length} mensajes a IndexedDB...`);
                await DB.importMessages(paquete.mensajes);
                console.log("[DEBUG-SYNC] Sincronización completada con éxito.");
                if (this.onRefresh) this.onRefresh();
            }
        });
    },

    async _alertarContactosDeIntentoDeSecuestro(miIdComprometido: string): Promise<void> {
        if (!this.peer) return;
        const contactos = await BitChatAuth.obtenerContactos();
        for (const idAmigo in contactos) {
            const hashedId = await hashString(idAmigo);
            const targetAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
            const conn = this.peer.connect(targetAuthId);
            conn.on('open', () => {
                conn.send({ tipo: 'SECURITY_ALERT', idComprometido: miIdComprometido });
                setTimeout(() => conn.close(), 5000);
            });
        }
    },

    async _establecerCanalSeguro(idAmigo: string, miCuarta: string, suCuarta: string, conn?: DataConnection): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        
        // Invalidate cached shared key as the public key might have changed
        delete this.sharedKeys[idAmigo];

        const quintaId = await generarQuintaId(miCuarta, suCuarta);
        const finalChannelId = `bitchat-safe-${[misCreds.idPublico, idAmigo].sort().join('')}-${quintaId}`;
        this.conexionesP2PDirectas[idAmigo] = { 
            channelId: finalChannelId, 
            status: 'SECURE',
            conn: conn || this.conexionesP2PDirectas[idAmigo]?.conn
        };
        if (this.onRefresh) this.onRefresh();
    },

    async _enviarPendientes(chatId: string, conn: DataConnection): Promise<void> {
        if (!conn.open) return;
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        const info = this.conexionesP2PDirectas[chatId];
        if (!info) return;
        const sharedKey = await this._getSharedKey(chatId);
        if (!sharedKey) return;

        const pending = await DB.getPendingMessages();
        for (const m of pending) {
            if (m.chatId === chatId) {
                const { ciphertext, iv } = await CryptoService.encrypt(sharedKey, m.msg);
                conn.send({ 
                    tipo: 'MSG', 
                    msgId: m.msgId, 
                    miIdPublico: misCreds.idPublico, 
                    channel: info.channelId, 
                    txt: ciphertext, 
                    iv, 
                    time: m.time 
                });
            }
        }
    },

    async aceptarConexion(idPublicoAmigo: string): Promise<void> {
        if (!this.peer) return;
        const hashedId = await hashString(idPublicoAmigo);
        const targetAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
        const conn = this.peer.connect(targetAuthId);
        conn.on('open', () => { conn.send({ tipo: 'CONNECTION_ACCEPTED' }); });
        this._procesarEntrante(conn);
        await DB.deleteRequest(idPublicoAmigo);
        if (this.onRefresh) this.onRefresh();
    },

    async rechazarConexion(idPublicoAmigo: string): Promise<void> {
        if (!this.peer) return;
        const hashedId = await hashString(idPublicoAmigo);
        const targetAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
        const conn = this.peer.connect(targetAuthId);
        
        conn.on('open', async () => {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (misCreds) {
                conn.send({ 
                    tipo: 'CONNECTION_REJECTED', 
                    deIdPublico: misCreds.idPublico 
                });
            }
            setTimeout(() => conn.close(), 1000);
        });

        await DB.deleteRequest(idPublicoAmigo);
        if (this.onRefresh) this.onRefresh();
    },

    async enviarMensaje(idPublicoAmigo: string, texto: string): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        
        const sharedKey = await this._getSharedKey(idPublicoAmigo);
        const uniqueId = crypto.randomUUID();
        
        await DB.addMessage({ 
            msgId: uniqueId, 
            chatId: idPublicoAmigo, 
            de: misCreds.idPublico, 
            msg: texto, 
            time: Date.now(), 
            status: 'saved', 
            secure: true 
        });

        const info = this.conexionesP2PDirectas[idPublicoAmigo];
        if (info && info.status === 'SECURE' && sharedKey && this.peer) {
            const { ciphertext, iv } = await CryptoService.encrypt(sharedKey, texto);
            
            // Reutilizar conexión si está abierta
            if (info.conn && info.conn.open) {
                info.conn.send({ 
                    tipo: 'MSG', 
                    msgId: uniqueId, 
                    miIdPublico: misCreds.idPublico, 
                    channel: info.channelId, 
                    txt: ciphertext, 
                    iv, 
                    time: Date.now() 
                });
            } else {
                const hashedId = await hashString(idPublicoAmigo);
                const conn = this.peer.connect(`bc-v2-${hashedId.substring(0, 24)}`);
                conn.on('open', () => {
                    conn.send({ 
                        tipo: 'MSG', 
                        msgId: uniqueId, 
                        miIdPublico: misCreds.idPublico, 
                        channel: info.channelId, 
                        txt: ciphertext, 
                        iv, 
                        time: Date.now() 
                    });
                    // NO CERRAR AUTOMÁTICAMENTE
                    this.conexionesP2PDirectas[idPublicoAmigo].conn = conn;
                });
                this._procesarEntrante(conn);
            }
        } else {
            // Intentar conectar si no hay canal seguro
            this.conectarAContacto(idPublicoAmigo);
        }
    },

    async iniciarSincronizacion(password: string): Promise<boolean> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return false;
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, password);

        // Get state for delta sync and repair
        const allLocalMsgs = await DB.getAllMessages();
        const lastLocalTime = allLocalMsgs.length > 0 ? Math.max(...allLocalMsgs.map(m => m.time)) : 0;
        
        // Identify messages that need repair (still encrypted locally)
        const repairMsgIds = allLocalMsgs
            .filter(m => m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv)
            .map(m => m.msgId);

        if (repairMsgIds.length > 0) {
            console.log(`[DEBUG-SYNC] Solicitando reparación de ${repairMsgIds.length} mensajes cifrados.`);
        }

        return new Promise((resolve) => {
            const probeId = `bc-sync-probe-${crypto.randomUUID().substring(0, 8)}`;
            const probePeer = new Peer(probeId);
            let foundAny = false;

            probePeer.on('open', () => {
                const targetHashedId = hashString(misCreds.idPublico);
                targetHashedId.then(hash => {
                    const targetId = `bc-v2-${hash.substring(0, 24)}`;
                    const conn = probePeer.connect(targetId);

                    const timeout = setTimeout(() => {
                        if (!foundAny) { probePeer.destroy(); resolve(false); }
                    }, 8000);

                    conn.on('open', () => {
                        foundAny = true;
                        conn.send({ 
                            tipo: 'SYNC_REQUEST', 
                            cuarta: miCuarta, 
                            lastMessageTime: lastLocalTime,
                            repairMsgIds: repairMsgIds 
                        });
                    });

                    conn.on('data', async (data: unknown) => {
                        const paquete = data as IPaqueteData;
                        if (paquete.tipo === 'SYNC_DATA') {
                            console.log(`SYNC: Recibidos ${Object.keys(paquete.contactos).length} contactos y ${paquete.mensajes.length} mensajes.`);
                            for (const idPublico in paquete.contactos) {
                                const c = paquete.contactos[idPublico];
                                await BitChatAuth.guardarContacto(idPublico, c.tokenCuartaCredencial, c.insecure, c.publicKey);
                                delete this.sharedKeys[idPublico];
                            }
                            await DB.importMessages(paquete.mensajes);
                            probePeer.destroy(); resolve(true);
                            alert("Sincronización P2P exitosa.");
                            if (this.onRefresh) this.onRefresh();
                        }
                    });
                });
            });
        });
    }
};