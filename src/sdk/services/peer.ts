import { Peer, DataConnection } from 'peerjs';
import { DB } from './db.ts';
import { BitChatAuth, generarCuartaCredencial, generarQuintaId } from './auth.ts';
import { Estado } from '../models/state.ts';
import { IPaqueteData } from '../models/types.ts';
import { CryptoService } from './crypto.ts';

const Debug = { log(msg: string) { console.log(`[BitChat Debug] [${new Date().toLocaleTimeString()}] ${msg}`); } };

export const PeerService = {
    peer: null as Peer | null,
    conexionesP2PDirectas: {} as Record<string, { channelId: string, status: string }>,
    sharedKeys: {} as Record<string, CryptoKey>, // Cache for session shared secrets
    syncInterval: null as number | null,
    onRefresh: null as (() => void) | null,
    onMessage: null as ((chatId: string) => void) | null,

    async inicializarNodo(idPublico: string): Promise<void> {
        let myAuthId = `bitchat-auth-${idPublico}`;
        if (this.peer) this.peer.destroy();
        this.peer = new Peer(myAuthId);

        this.peer.on('open', (id) => {
            Debug.log(`Nodo Online: ${id}`);
            if (this.onRefresh) this.onRefresh();
            this.startBackgroundSync();
        });

        this.peer.on('error', (err: any) => {
            if (err.type === 'unavailable-id') {
                const suffix = Math.random().toString(36).substring(7);
                this.inicializarNodo(`${idPublico}-${suffix}`);
            }
            Debug.log(`Error: ${err.type}`);
        });

        this.peer.on('connection', (conn) => this._procesarEntrante(conn));
    },

    async validarIdentidadEnRed(idPublico: string, idPrivado: string, passwordHash: string): Promise<boolean> {
        return new Promise(async (resolve) => {
            const probeId = `bitchat-probe-${Date.now()}`;
            const probePeer = new Peer(probeId);
            const miCuarta = await generarCuartaCredencial(idPublico, idPrivado, passwordHash);
            let foundExisting = false;

            probePeer.on('open', () => {
                const conn = probePeer.connect(`bitchat-auth-${idPublico}`);
                const timeout = setTimeout(() => { if (!foundExisting) { probePeer.destroy(); resolve(true); } }, 5000);

                conn.on('open', () => {
                    foundExisting = true; clearTimeout(timeout);
                    conn.send({ tipo: 'IDENTITY_PROBE', deIdPublico: idPublico, cuarta: miCuarta });
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
            const pending = await DB.getPendingMessages();
            const uniqueTargets = [...new Set(pending.map(m => m.chatId))];
            for (const target of uniqueTargets) { this.conectarAContacto(target); }
            for (const target of Array.from(Estado.solicitudesEnviadasPendientes)) { this.conectarAContacto(target); }
        }, 15000) as unknown as number;
    },

    async conectarAContacto(idPublicoAmigo: string): Promise<void> {
        if (!this.peer) return;
        const targetAuthId = `bitchat-auth-${idPublicoAmigo}`;
        const conn = this.peer.connect(targetAuthId);
        const contactos = BitChatAuth.obtenerContactos();
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
                        publicKey: misCreds.publicKey
                    });
                } else { this._enviarPendientes(idPublicoAmigo, conn); }
            } else { conn.send({ tipo: 'CONNECTION_REQ', deIdPublico: misCreds.idPublico }); }
        });
        conn.on('data', () => { Estado.solicitudesEnviadasPendientes.delete(idPublicoAmigo); });
        this._procesarEntrante(conn);
    },

    async _getSharedKey(idAmigo: string): Promise<CryptoKey | null> {
        if (this.sharedKeys[idAmigo]) return this.sharedKeys[idAmigo];
        
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        const contactos = BitChatAuth.obtenerContactos();
        if (!misCreds || !contactos[idAmigo] || !contactos[idAmigo].publicKey) return null;
        
        try {
            // 1. Get my private key (decrypt it first)
            if (!Estado.aesKey || !misCreds.encryptedPrivateKey || !misCreds.privateKeyIv) return null;
            const privKeyJWKJson = await CryptoService.decrypt(Estado.aesKey, misCreds.encryptedPrivateKey, misCreds.privateKeyIv);
            const privKeyJWK = JSON.parse(privKeyJWKJson);
            const myPrivKey = await crypto.subtle.importKey('jwk', privKeyJWK, { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey']);
            
            // 2. Import friend's public key
            const friendPubKey = await CryptoService.importPublicECDHKey(contactos[idAmigo].publicKey!);
            
            // 3. Derive shared secret
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
            Debug.log(`Recibido: ${paquete.tipo} de ${paquete.miIdPublico || paquete.deIdPublico || 'unknown'}`);
            
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
                BitChatAuth.marcarContactoInseguro(paquete.idComprometido);
                if (this.onRefresh) this.onRefresh();
                alert(`¡ALERTA DE SEGURIDAD! El contacto ${paquete.idComprometido} ha reportado un intento de suplantación de identidad.`);
            }
            if (paquete.tipo === 'CONNECTION_REQ') {
                await DB.addRequest({ idPublico: paquete.deIdPublico, time: Date.now() });
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
                    publicKey: misCreds.publicKey
                });
            }
            if (paquete.tipo === 'HANDSHAKE_START') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencial, false, paquete.publicKey);
                conn.send({ 
                    tipo: 'HANDSHAKE_FINAL', 
                    miIdPublico: misCreds.idPublico, 
                    cuartaCredencialAmigo: miCuarta,
                    publicKey: misCreds.publicKey
                });
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencial);
            }
            if (paquete.tipo === 'HANDSHAKE_FINAL') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                BitChatAuth.guardarContacto(paquete.miIdPublico, paquete.cuartaCredencialAmigo, false, paquete.publicKey);
                this._establecerCanalSeguro(paquete.miIdPublico, miCuarta, paquete.cuartaCredencialAmigo);
                this._enviarPendientes(paquete.miIdPublico, conn);
                if (this.onRefresh) this.onRefresh();
            }
            if (paquete.tipo === 'MSG') {
                const sharedKey = await this._getSharedKey(paquete.miIdPublico);
                let decryptedText = '[Encrypted Message]';
                if (sharedKey) {
                    try {
                        decryptedText = await CryptoService.decrypt(sharedKey, paquete.txt, paquete.iv);
                    } catch (e) { Debug.log('Failed to decrypt E2EE message'); }
                }

                const chatMsg = {
                    msgId: paquete.msgId, chatId: paquete.miIdPublico, de: paquete.miIdPublico,
                    msg: decryptedText, time: paquete.time, status: 'read' as const, secure: !!paquete.channel
                };
                await DB.addMessage(chatMsg);
                conn.send({ tipo: 'MSG_ACK', msgId: paquete.msgId, read: true });
                if (this.onMessage) this.onMessage(paquete.miIdPublico);
            }
            if (paquete.tipo === 'MSG_ACK') {
                await DB.updateMessageByMsgId(paquete.msgId, { status: paquete.read ? 'read' : 'sent' });
                const senderId = conn.peer.replace('bitchat-auth-', '').split('-')[0];
                if (this.onMessage) this.onMessage(senderId);
            }
            if (paquete.tipo === 'SYNC_REQUEST') {
                const misCreds = await BitChatAuth.obtenerMisCredenciales();
                if (!misCreds) return;
                const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, Estado.masterPassword);
                if (paquete.cuarta === miCuarta) {
                    const contactos = BitChatAuth.obtenerContactos();
                    const mensajes = await DB.getAllMessages();
                    conn.send({ tipo: 'SYNC_DATA', contactos, mensajes });
                }
            }
            if (paquete.tipo === 'SYNC_DATA') {
                const locales = BitChatAuth.obtenerContactos();
                const nuevos = { ...locales, ...paquete.contactos };
                localStorage.setItem('bitchat_auth_contacts', JSON.stringify(nuevos));
                await DB.importMessages(paquete.mensajes);
                alert("Sincronización completada con éxito.");
                location.reload();
            }
        });
    },

    async _alertarContactosDeIntentoDeSecuestro(miIdComprometido: string): Promise<void> {
        if (!this.peer) return;
        const contactos = BitChatAuth.obtenerContactos();
        for (const idAmigo in contactos) {
            const targetAuthId = `bitchat-auth-${idAmigo}`;
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
        const targetAuthId = `bitchat-auth-${idPublicoAmigo}`;
        const conn = this.peer.connect(targetAuthId);
        conn.on('open', () => { conn.send({ tipo: 'CONNECTION_ACCEPTED' }); });
        this._procesarEntrante(conn);
        await DB.deleteRequest(idPublicoAmigo);
        if (this.onRefresh) this.onRefresh();
    },

    async enviarMensaje(idPublicoAmigo: string, texto: string): Promise<void> {
        const misCreds = await BitChatAuth.obtenerMisCredenciales();
        if (!misCreds) return;
        
        const sharedKey = await this._getSharedKey(idPublicoAmigo);
        const uniqueId = crypto.randomUUID();
        
        // Save locally (DB.addMessage will encrypt with master key)
        const msgData = { 
            msgId: uniqueId, 
            chatId: idPublicoAmigo, 
            de: misCreds.idPublico, 
            msg: texto, 
            time: Date.now(), 
            status: 'saved' as const, 
            secure: true 
        };
        await DB.addMessage(msgData);

        const info = this.conexionesP2PDirectas[idPublicoAmigo];
        if (info && info.status === 'SECURE' && sharedKey && this.peer) {
            const { ciphertext, iv } = await CryptoService.encrypt(sharedKey, texto);
            const conn = this.peer.connect(`bitchat-auth-${idPublicoAmigo}`);
            conn.on('open', () => {
                conn.send({ 
                    tipo: 'MSG', 
                    msgId: uniqueId, 
                    miIdPublico: misCreds.idPublico, 
                    channel: info.channelId, 
                    txt: ciphertext, 
                    iv, 
                    time: msgData.time 
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
            const probeId = `bitchat-sync-probe-${Date.now()}`;
            const probePeer = new Peer(probeId);
            let foundAny = false;

            probePeer.on('open', () => {
                const targetId = `bitchat-auth-${misCreds.idPublico}`;
                const conn = probePeer.connect(targetId);

                const timeout = setTimeout(() => {
                    if (!foundAny) { probePeer.destroy(); resolve(false); }
                }, 8000);

                conn.on('open', () => {
                    foundAny = true;
                    conn.send({ tipo: 'SYNC_REQUEST', cuarta: miCuarta });
                });

                conn.on('data', async (paquete: any) => {
                    if (paquete.tipo === 'SYNC_DATA') {
                        const locales = BitChatAuth.obtenerContactos();
                        const nuevos = { ...locales, ...paquete.contactos };
                        localStorage.setItem('bitchat_auth_contacts', JSON.stringify(nuevos));
                        await DB.importMessages(paquete.mensajes);
                        probePeer.destroy(); resolve(true);
                        alert("Sincronización P2P exitosa.");
                        location.reload();
                    }
                });
            });
        });
    }
};