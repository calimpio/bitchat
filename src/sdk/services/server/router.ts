import { DataConnection } from 'peerjs';
import { IPaqueteData } from '../../models/types.ts';
import { RPCContext } from './models/rpcContext.ts';
import { RPCError } from './errors/RPCError.ts';
import { authMiddleware } from './middlewares/auth.ts';
import { identityController } from './controllers/identity.ts';
import { syncController } from './controllers/sync.ts';
import { chatController } from './controllers/chat.ts';
import { handshakeController } from './controllers/handshake.ts';
import { DB } from '../db.ts';
import { PeerService } from '../peer.ts';

const responseTypeMap: Record<string, string> = {
    'IDENTITY_PROBE': 'IDENTITY_MATCH',
    'SYNC_REQUEST': 'SYNC_DATA',
    'MSG': 'MSG_ACK',
    'CONNECTION_REQ': 'CONNECTION_ACCEPTED',
    'HANDSHAKE_START': 'HANDSHAKE_FINAL'
};

export const RPCRouter = {
    async handle(conn: DataConnection, paquete: IPaqueteData) {
        const ctx: RPCContext = { 
            conn, 
            paquete, 
            reqId: paquete.reqId,
            response: async (payload: any, customType?: string) => {
                const type = customType || responseTypeMap[paquete.tipo];
                if (!type) {
                    console.warn(`[RPC-ROUTER] No se encontró tipo de respuesta por defecto para ${paquete.tipo}`);
                    return;
                }
                if (paquete.reqId) {
                    await PeerService.response(conn, paquete.reqId, type as any, payload);
                } else {
                    conn.send({ tipo: type, ...payload });
                }
            }
        };
        
        try {
            // 1. Pre-validación (Middleware)
            const senderId = paquete.tipo === 'CONNECTION_REQ' ? (paquete as any).deIdPublico : conn.peer!.replace('bc-v2-', '').split('-')[0];
            if (await DB.isBlocked(senderId)) {
                console.warn(`[RPC-ROUTER] Conexión bloqueada de senderId: ${senderId}`);
                conn.close();
                return;
            }

            // 2. Autenticación y Contexto
            await authMiddleware(ctx);

            // 3. Enrutamiento a Controladores
            switch (paquete.tipo) {
                case 'IDENTITY_PROBE': await identityController.probe(ctx); break;
                case 'IDENTITY_MATCH': await identityController.match(ctx); break;
                case 'SYNC_REQUEST': await syncController.handleRequest(ctx); break;
                case 'SYNC_DATA': await syncController.handleData(ctx); break;
                case 'GET_MESSAGES': await chatController.handleGetMessages(ctx); break;
                case 'MSG': await chatController.handleIncomingMessage(ctx); break;
                case 'MSG_ACK': await chatController.handleMsgAck(ctx); break;
                case 'SECURITY_ALERT': await handshakeController.handleSecurityAlert(ctx); break;
                case 'CONNECTION_REQ': await handshakeController.handleConnectionReq(ctx); break;
                case 'CONNECTION_ACCEPTED': await handshakeController.handleConnectionAccepted(ctx); break;
                case 'CONNECTION_REJECTED': await handshakeController.handleConnectionRejected(ctx); break;
                case 'HANDSHAKE_START': await handshakeController.handleHandshakeStart(ctx); break;
                case 'HANDSHAKE_FINAL': await handshakeController.handleHandshakeFinal(ctx); break;
            }

            if (PeerService.onRefresh) PeerService.onRefresh();

        } catch (error) {
            this.handleError(ctx, error);
        }
    },

    handleError(ctx: RPCContext, error: any) {
        if (error instanceof RPCError) {
            console.error(`[RPC-ERROR] ${error.code}: ${error.message}`);
            if (ctx.reqId) {
                PeerService.response(ctx.conn, ctx.reqId, 'ERROR', { code: error.code, message: error.message });
            }
            if (error.closeConnection) ctx.conn.close();
        } else {
            console.error('[RPC-FATAL] Error no controlado:', error);
        }
    }
};
