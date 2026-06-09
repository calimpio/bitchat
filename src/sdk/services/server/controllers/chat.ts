import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';
import { PeerService } from '../../peer.ts';
import { CryptoService } from '../../crypto.ts';
import { Message } from '../../../models/types.ts';

export const chatController = {
    async handleIncomingMessage(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Recibido MSG de ${ctx.conn.peer}`);
        const p = ctx.paquete as any;
        const sharedKey = await PeerService._getSharedKey(p.miIdPublico!);
        
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
            chatId: p.miIdPublico!, 
            de: p.miIdPublico!, 
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
        if (PeerService.onMessage) PeerService.onMessage(p.miIdPublico!);
    },

    async handleMsgAck(ctx: RPCContext) {
        const p = ctx.paquete as any;
        await DB.updateMessageByMsgId(p.msgId, { status: p.read ? 'read' : 'sent' });
    }
};
