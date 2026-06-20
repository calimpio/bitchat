import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';
import { BitChatAuth } from '../../auth.ts';
import { PeerService } from '../../peer.ts';
import { VaultService } from '../../vault.ts';
import { CryptoService } from '../../crypto.ts';
import { ContactMap, Message, IPaqueteSyncRequest, IPaqueteSyncData } from '../../../models/types.ts';
import { validateFields } from '../core/validation.ts';

export const syncController = {
    async handleRequest(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando SYNC_REQUEST de ${ctx.conn.peer}`);
        const p = validateFields<IPaqueteSyncRequest>(ctx.paquete, [], ['lastMessageTime', 'repairMsgIds']);
        
        const allDevices = await DB.getDevices();
        const requestingDevice = allDevices.find(d => d.peerId === ctx.conn.peer);
        if (!requestingDevice) return; // O lanzar RPCError
        
        const allContactos = await BitChatAuth.obtenerContactos();
        const filteredContactos: ContactMap = {};
        const allowedChatIds: string[] = [];
        
        for (const id in allContactos) { 
            if (requestingDevice.globalSync || allContactos[id].syncAllowedDevices?.includes(requestingDevice.deviceId)) { 
                filteredContactos[id] = allContactos[id]; 
                allowedChatIds.push(id); 
            } 
        }

        const allMensajes = await DB.getAllMessages();
        const deltaMensajes = allMensajes.filter(m => {
            if (!m.msgId) return false;
            const isAllowed = allowedChatIds.includes(m.chatId);
            if (!isAllowed) return false;
            if (p.repairMsgIds?.includes(m.msgId)) return true;
            return m.time > (p.lastMessageTime || 0);
        });

        for (const m of deltaMensajes) {
            if (m.msg === '[Mensaje Cifrado]' && m.ciphertext && m.iv) {
                const sharedKey = await PeerService._getSharedKey(m.chatId);
                if (sharedKey) { 
                    try { 
                        m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv); 
                        m.ciphertext = undefined; 
                        m.iv = undefined; 
                    } catch (e) { } 
                }
            }
        }

        const payload = { contactos: filteredContactos, mensajes: deltaMensajes };
        const vault = await VaultService.encryptForE2EE('SYNC_PAYLOAD', payload, requestingDevice.publicKey || ctx.misCreds!.publicKey!);
        
        await ctx.response({ vault });
    },

    async handleData(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando SYNC_DATA (Importación) de ${ctx.conn.peer}`);
        const p = validateFields<IPaqueteSyncData>(ctx.paquete, [], ['contactos', 'mensajes', 'vault']);
        let contactos: ContactMap = p.contactos || {};
        let mensajes: Message[] = p.mensajes || [];

        if (p.vault) {
            const decrypted = await VaultService.decryptFromE2EE<{ contactos: ContactMap, mensajes: Message[] }>(p.vault);
            contactos = decrypted.contactos;
            mensajes = decrypted.mensajes;
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
                    try { 
                        m.msg = await CryptoService.decrypt(sharedKey, m.ciphertext, m.iv); 
                        m.ciphertext = undefined; 
                        m.iv = undefined; 
                    } catch (e) { } 
                }
            }
        }
        await DB.importMessages(validados);
    }
};
