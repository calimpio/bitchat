import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';
import { PeerService } from '../../peer.ts';
import { CryptoService } from '../../crypto.ts';
import { Message, IPaqueteMsg, IPaqueteMsgAck, IPaqueteGetMessages } from '../../../models/types.ts';
import { validateFields } from '../core/validation.ts';
import { BitChatAuth } from '../../auth.ts';
import { RPCError } from '../errors/RPCError.ts';

export const chatController = {
    async handleIncomingMessage(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Recibido MSG de ${ctx.conn.peer}`);
        const p = validateFields<IPaqueteMsg>(ctx.paquete, ['miIdPublico', 'txt', 'iv', 'msgId', 'time']);
        const sharedKey = await PeerService._getSharedKey(p.miIdPublico);
        
        let decryptedText = '[Mensaje Cifrado]';
        let isDecrypted = false;
        
        if (sharedKey) { 
            try { 
                decryptedText = await CryptoService.decrypt(sharedKey, p.txt, p.iv); 
                isDecrypted = true; 
            } catch (e) { } 
        }
        
        const chatMsg: Message = { 
            msgId: p.msgId, 
            chatId: p.miIdPublico, 
            de: p.miIdPublico, 
            msg: decryptedText, 
            time: p.time, 
            status: 'read', 
            secure: true, 
            iv: isDecrypted ? undefined : p.iv, 
            ciphertext: isDecrypted ? undefined : p.txt 
        };
        
        await DB.addMessage(chatMsg);
        
        await ctx.response({ msgId: p.msgId, read: true });

        PeerService._replicateMessage(chatMsg);
        if (PeerService.onMessage) PeerService.onMessage(p.miIdPublico);
    },

    async handleMsgAck(ctx: RPCContext) {
        const p = validateFields<IPaqueteMsgAck>(ctx.paquete, ['msgId', 'read']);
        await DB.updateMessageByMsgId(p.msgId, { status: p.read ? 'read' : 'sent' });
        await ctx.response({ acknowledged: true });
    },

    async handleGetMessages(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando GET_MESSAGES de ${ctx.conn.peer}`);
        const p = validateFields<IPaqueteGetMessages>(ctx.paquete, ['chatId'], ['lastTime']);
        
        // 1. Identificar el dispositivo solicitante
        const allDevices = await DB.getDevices();
        const requestingDevice = allDevices.find(d => d.peerId === ctx.conn.peer);
        if (!requestingDevice) {
            throw new RPCError('UNAUTHORIZED_DEVICE', 'El dispositivo no está registrado.', true);
        }

        // 2. Verificar permisos de sincronización para este chat específico
        const contactos = await BitChatAuth.obtenerContactos();
        const contacto = contactos[p.chatId];
        
        const canSync = contacto?.syncAllowedDevices?.includes(requestingDevice.deviceId);
        if (!canSync) {
            throw new RPCError('FORBIDDEN', 'No tienes permisos para sincronizar este chat.', false);
        }

        // 3. Obtener y filtrar mensajes
        const allMsgs = await DB.getChatMessages(p.chatId);
        const deltaMsgs = allMsgs.filter(m => m.time > (p.lastTime || 0));

        // 4. Responder con los mensajes (el router usará SYNC_DATA por defecto si no se especifica, pero aquí enviamos payload directo)
        await ctx.response({ mensajes: deltaMsgs }, 'SYNC_DATA');
    }
};
