import { BitChatAuth, generarCuartaCredencial } from '../../auth.ts';
import { useStore } from '../../../../store/useStore.ts';
import { RPCContext } from '../models/rpcContext.ts';
import { RPCError } from '../errors/RPCError.ts';

export const authMiddleware = async (ctx: RPCContext): Promise<void> => {
    const misCreds = await BitChatAuth.obtenerMisCredenciales();
    if (!misCreds) {
        throw new RPCError('NO_CREDENTIALS', 'No hay credenciales locales configuradas.', true);
    }
    
    ctx.misCreds = misCreds;
    ctx.miIdPublico = misCreds.idPublico;
    
    // Algunos paquetes requieren validación de cuarta credencial
    const requireCuarta = ['SYNC_REQUEST', 'IDENTITY_PROBE', 'SYNC_DATA'];
    if (requireCuarta.includes(ctx.paquete.tipo)) {
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
        ctx.miCuarta = miCuarta;
        
        const paqueteCualquier = ctx.paquete as any;
        if (paqueteCualquier.cuarta && paqueteCualquier.cuarta !== miCuarta) {
            throw new RPCError('UNAUTHORIZED', 'Cuarta credencial inválida.', true);
        }
    }
};
