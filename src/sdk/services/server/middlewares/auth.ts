import { BitMsgAuth, generarCuartaCredencial } from '../../auth.ts';
import { useStore } from '../../../../store/useStore.ts';
import { RPCContext } from '../models/rpcContext.ts';
import { RPCError } from '../errors/RPCError.ts';
import { validateFields } from '../core/validation.ts';
import { IPaqueteIdentityProbe, IPaqueteSyncRequest, IPaqueteSyncData } from '../../../models/types.ts';

export const authMiddleware = async (ctx: RPCContext): Promise<void> => {
    const misCreds = await BitMsgAuth.obtenerMisCredenciales();
    if (!misCreds) {
        throw new RPCError('NO_CREDENTIALS', 'No hay credenciales locales configuradas.', true);
    }
    
    ctx.misCreds = misCreds;
    ctx.miIdPublico = misCreds.idPublico;
    
    // Algunos paquetes requieren validación de cuarta credencial
    if (ctx.paquete.tipo === 'SYNC_REQUEST' || ctx.paquete.tipo === 'IDENTITY_PROBE' || ctx.paquete.tipo === 'SYNC_DATA') {
        const miCuarta = await generarCuartaCredencial(misCreds.idPublico, misCreds.idPrivado, useStore.getState().masterPassword);
        ctx.miCuarta = miCuarta;

        // Validamos que el paquete traiga la cuarta credencial (es opcional en SYNC_DATA según el tipo pero aquí la validamos si existe)
        const p = validateFields<IPaqueteIdentityProbe | IPaqueteSyncRequest | IPaqueteSyncData>(
            ctx.paquete, 
            ctx.paquete.tipo === 'SYNC_DATA' ? [] : ['cuarta'], 
            ctx.paquete.tipo === 'SYNC_DATA' ? ['cuarta'] : []
        );
        
        if (p.cuarta && p.cuarta !== miCuarta) {
            throw new RPCError('UNAUTHORIZED', 'Cuarta credencial inválida.', true);
        }
    }
};
