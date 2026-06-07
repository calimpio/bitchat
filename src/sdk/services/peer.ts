import { Peer, DataConnection } from 'peerjs';
import { DB } from './db.ts';
import { BitChatAuth, generarCuartaCredencial, generarQuintaId, hashString } from './auth.ts';
import { Estado } from '../models/state.ts';
import { IPaqueteData } from '../models/types.ts';
import { CryptoService } from './crypto.ts';
import { IPeerService } from './interfaces/IPeerService.ts';

export const PeerService: IPeerService = {
    peer: null,
    conexionesP2PDirectas: {},
    sharedKeys: {}, // Cache for session shared secrets
    onRefresh: null,
    onMessage: null,

    async inicializarNodo(idPublico: string): Promise<void> {
        const hashedId = await hashString(idPublico);
        const myAuthId = `bc-v2-${hashedId.substring(0, 24)}`;

        if (this.peer) this.peer.destroy();
        this.peer = new Peer(myAuthId);

        this.peer.on('open', (id) => {
            if (this.onRefresh) this.onRefresh();
            this.startBackgroundSync();
        });

        this.peer.on('error', (err: { type: string }) => {
            if (err.type === 'unavailable-id') {
                const suffix = Math.random().toString(36).substring(7);
                this.inicializarNodo(`${idPublico}-${suffix}`);
            }
        });

        this.peer.on('connection', (conn) => {
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
                    conn.send({ tipo: 'IDENTITY_PROBE', deIdPublico: idPublico, cuarta: miCuarta });
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
            const pending = await DB.getPendingMessages();
            const uniqueTargets = [...new Set(pending.map(m => m.chatId))];
            for (const target of uniqueTargets) { this.conectarAContacto(target); }
            for (const target of Array.from(Estado.solicitudesEnviadasPendientes)) { this.conectarAContacto(target); }
        }, 15000) as unknown as number;
    },

    async conectarAContacto(idPublicoAmigo: string, huellaEsperada?: string): Promise<void> {
        if (!this.peer || !this.peer.open) {
            alert("Error: El nodo local no está listo (Peer no abierto).");
            return;
        }
        const hashedId = await hashString(idPublicoAmigo);
        const targetAuthId = `bc-v2-${hashedId.substring(0, 24)}`;
        
        const conn = this.peer.connect(targetAuthId);
        
        const contactos = await BitChatAuth.obtenerContactos();
        if (!contactos[idPublicoAmigo]) { Estado.solicitudesEnviadasPendientes.add(idPublicoAmigo); }

        conn.on('open', async () => {
            const misCreds = await BitChatAuth.obtenerMisCredenciales();
            if (!misCreds) return;

            if (contactos[idPublicoAmigo]) {
                if (!this.conexionesP2PDirectas[idPublicoAmigo] || this.conexionesP2PDirectas[idPublicoAmigo].status !== 'SECURE') {
                    const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                    conn.send({ 
                        tipo: 'HANDSHAKE_START', 
                        miIdPublico: misCreds.idPublico, 
                        cuartaCredencial: miCuarta,
                        publicKey: misCreds.publicKey!
                    });
                } else { 
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
            alert(`Error de conexión con ${idPublicoAmigo}: ${JSON.stringify(err)}`);
        });
        this._procesarEntrante(conn);
    },

    async _getSharedKey(idAmigo: string): Promise<CryptoKey | null> {
        if (this.sharedKeys[idAmigo]) return this.sharedKeys[idAmigo];
        
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const contactos = await BitChatAuth.obtenerContactos();
        if (!misCreds || !contactos[idAmigo] || !contactos[idAmigo].publicKey) return null;
        
        try {
            if (!Estado.aesKey || !misCreds.encryptedPrivateKey || !misCreds.privateKeyIv) return null;
            const privKeyJWKJson = await CryptoService.decrypt(Estado.aesKey, misCreds.encryptedPrivateKey, misCreds.privateKeyIv);
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
        conn.on('data', async (data: unknown) => {
            const paquete = data as IPaqueteData;

            // SECURITY: Blacklist check
            const senderId = paquete.tipo === 'CONNECTION_REQ' ? paquete.deIdPublico : conn.peer!.replace('bc-v2-', '').split('-')[0];
            if (await DB.isBlocked(senderId)) {
                return;
            }

            if (paquete.tipo === 'IDENTITY_PROBE') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                if (paquete.cuarta === miCuarta) { conn.send({ tipo: 'IDENTITY_MATCH' }); }
                else {
                    conn.send({ tipo: 'IDENTITY_CONFLICT' });
                    this._alertarContactosDeIntentoDeSecuestro(misCreds.idPublico);
                }
            }
            if (paquete.tipo === 'SECURITY_ALERT') {
                await BitChatAuth.marcarContactoInseguro(paquete.idComprometido);
                if (this.onRefresh) this.onRefresh();
                alert(`¡ALERTA DE SEGURIDAD!`);
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
                alert(`Nueva solicitud de conexión de: ${paquete.deIdPublico}`);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'CONNECTION_REJECTED') {
                alert(`Tu solicitud de conexión a ${paquete.deIdPublico} ha sido rechazada.`);
                Estado.solicitudesEnviadasPendientes.delete(paquete.deIdPublico);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'CONNECTION_ACCEPTED') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
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
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencial, false, paquete.publicKey);
                conn.send({ 
                    tipo: 'HANDSHAKE_FINAL', 
                    miIdPublico: misCreds.idPublico, 
                    cuartaCredencialAmigo: miCuarta,
                    publicKey: misCreds.publicKey!
                });
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencial);
            }
            if (paquete.tipo === 'HANDSHAKE_FINAL') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                await BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencialAmigo, false, paquete.publicKey);
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencialAmigo);
                this._enviarPendientes(paquete.miIdPublico, conn);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'MSG') {
                const sharedKey = await this._getSharedKey(paquete.miIdPublico!);
                let decryptedText = '[Mensaje Cifrado]';
                if (sharedKey) {
                    try {
                        decryptedText = await CryptoService.decrypt(sharedKey, paquete.txt, paquete.iv);
                    } catch (e) {}
                }

                const chatMsg = {
                    msgId: paquete.msgId, chatId: paquete.miIdPublico!, de: paquete.miIdPublico!,
                    msg: decryptedText, time: paquete.time, status: 'read' as const, secure: true
                };
                await DB.addMessage(chatMsg);
                conn.send({ tipo: 'MSG_ACK', msgId: paquete.msgId, read: true });
                if (this.onMessage) this.onMessage(paquete.miIdPublico!);
            }
            if (paquete.tipo === 'MSG_ACK') {
                await DB.updateMessageByMsgId(paquete.msgId, { status: paquete.read ? 'read' : 'sent' });
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'SYNC_REQUEST') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                if (paquete.cuarta === miCuarta) {
                    const contactos = await BitChatAuth.obtenerContactos();
                    const mensajes = await DB.getAllMessages();
                    conn.send({ tipo: 'SYNC_DATA', contactos, mensajes });
                }
            }
            if (paquete.tipo === 'SYNC_DATA') {
                for (const idPublico in paquete.contactos) {
                    const c = paquete.contactos[idPublico];
                    await BitChatAuth.guardarContacto(idPublico, c.tokenCuartaCredencial, c.insecure, c.publicKey);
                }
                await DB.importMessages(paquete.mensajes);
                alert("Sincronización completada con éxito.");
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
                setTimeout(() => conn.close(), 2000);
            });
        }
    },

    async _establecerCanalSeguro(idAmigo: string, miCuarta: string, suCuarta: string): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        const quintaId = await generarQuintaId(miCuarta, suCuarta);
        const finalChannelId = `bitchat-safe-${[misCreds.idPublico, idAmigo].sort().join('')}-${quintaId}`;
        this.conexionesP2PDirectas[idAmigo] = { channelId: finalChannelId, status: 'SECURE' };
        if (this.onRefresh) this.onRefresh();
    },

    async _enviarPendientes(chatId: string, conn: DataConnection): Promise<void> {
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
                setTimeout(() => conn.close(), 1000);
            });
        }
    },

    async iniciarSincronizacion(password: string): Promise<boolean> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return false;
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, password);

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
                        conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta });
                    });

                    conn.on('data', async (data: unknown) => {
                        const paquete = data as IPaqueteData;
                        if (paquete.tipo === 'SYNC_DATA') {
                            for (const idPublico in paquete.contactos) {
                                const c = paquete.contactos[idPublico];
                                await BitChatAuth.guardarContacto(idPublico, c.tokenCuartaCredencial, c.insecure, c.publicKey);
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