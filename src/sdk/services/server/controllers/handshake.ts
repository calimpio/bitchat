import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';
import { BitChatAuth, generarCuartaCredencial } from '../../auth.ts';
import { PeerService } from '../../peer.ts';
import { CryptoService } from '../../crypto.ts';
import { useStore } from '../../../../store/useStore.ts';

export const handshakeController = {
    async handleSecurityAlert(ctx: RPCContext) {
        const p = ctx.paquete as any;
        await BitChatAuth.marcarContactoInseguro(p.idComprometido);
    },

    async handleConnectionReq(ctx: RPCContext) {
        const p = ctx.paquete as any;
        if (ctx.misCreds?.publicKey && p.huellaDestino === await CryptoService.getFingerprint(ctx.misCreds.publicKey)) { 
            await PeerService.aceptarConexion(p.deIdPublico); 
            await ctx.response({ accepted: true });
            return; 
        }
        await DB.addRequest({ idPublico: p.deIdPublico, time: Date.now(), publicKey: p.publicKey });
        await ctx.response({ received: true });
    },

    async handleConnectionAccepted(ctx: RPCContext) {
        const miCuarta = await generarCuartaCredencial(ctx.misCreds!.idPublico, ctx.misCreds!.idPrivado, useStore.getState().masterPassword);
        await ctx.response({ miIdPublico: ctx.misCreds!.idPublico, cuartaCredencial: miCuarta, publicKey: ctx.misCreds!.publicKey! });
    },

    async handleHandshakeStart(ctx: RPCContext) {
        const p = ctx.paquete as any;
        const miCuarta = await generarCuartaCredencial(ctx.misCreds!.idPublico, ctx.misCreds!.idPrivado, useStore.getState().masterPassword);
        await BitChatAuth.guardarContacto(p.miIdPublico, p.cuartaCredencial, false, p.publicKey);
        PeerService._replicateContact(p.miIdPublico);
        await ctx.response({ miIdPublico: ctx.misCreds!.idPublico, cuartaCredencialAmigo: miCuarta, publicKey: ctx.misCreds!.publicKey! });
        PeerService._establecerCanalSeguro(p.miIdPublico, miCuarta, p.cuartaCredencial, ctx.conn);
    },

    async handleHandshakeFinal(ctx: RPCContext) {
        const p = ctx.paquete as any;
        const miCuarta = await generarCuartaCredencial(ctx.misCreds!.idPublico, ctx.misCreds!.idPrivado, useStore.getState().masterPassword);
        await BitChatAuth.guardarContacto(p.miIdPublico, p.cuartaCredencialAmigo, false, p.publicKey);
        PeerService._replicateContact(p.miIdPublico);
        PeerService._establecerCanalSeguro(p.miIdPublico, miCuarta, p.cuartaCredencialAmigo, ctx.conn);
        PeerService._enviarPendientes(p.miIdPublico, ctx.conn);
        await ctx.response({ secure: true });
    },

    async handleConnectionRejected(ctx: RPCContext) {
        const p = ctx.paquete as any;
        useStore.getState().solicitudesEnviadasPendientes.delete(p.deIdPublico);
        await ctx.response({ acknowledged: true });
    }
};
