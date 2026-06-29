import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';

export const appRPCController = {
    async handlePublishBroadcast(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando APP_PUBLISH_BROADCAST de ${ctx.conn.peer}`);
        const { app } = ctx.paquete as any;
        if (app && app.appId) {
            await DB.savePublishedApp(app);
        }
    },

    async handleQueryRequest(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando APP_QUERY_REQUEST de ${ctx.conn.peer}`);
        const apps = await DB.getPublishedApps();
        await ctx.response({ apps }, 'APP_QUERY_RESPONSE');
    },

    async handleQueryResponse(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando APP_QUERY_RESPONSE de ${ctx.conn.peer}`);
        const { apps } = ctx.paquete as any;
        if (apps && Array.isArray(apps)) {
            for (const app of apps) {
                if (app && app.appId) {
                    await DB.savePublishedApp(app);
                }
            }
        }
    }
};
