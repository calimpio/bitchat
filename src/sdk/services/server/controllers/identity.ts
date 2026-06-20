import { RPCContext } from '../models/rpcContext.ts';
import { DB } from '../../db.ts';
import { PeerService } from '../../peer.ts';
import { CryptoService } from '../../crypto.ts';
import { useStore } from '../../../../store/useStore.ts';
import { validateFields } from '../core/validation.ts';
import { IPaqueteIdentityProbe, IPaqueteIdentityMatch } from '../../../models/types.ts';

export const identityController = {
    async probe(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando IDENTITY_PROBE de ${ctx.conn.peer}`);
        const p = validateFields<IPaqueteIdentityProbe>(ctx.paquete, ['deIdPublico', 'publicKey'], ['deviceId', 'deviceLabel', 'createdAt']);
        
        const remoteDeviceId = p.deviceId || ctx.conn.peer!.replace('bc-v2-', '').split('-')[0];
        if (PeerService.deviceConns) PeerService.deviceConns[remoteDeviceId] = ctx.conn;
        
        const allDevices = await DB.getDevices();
        const existingDevice = allDevices.find(d => d.deviceId === remoteDeviceId);
        const globalSync = existingDevice ? existingDevice.globalSync : false;
        
        await DB.addDevice({ 
            deviceId: remoteDeviceId, 
            idPublico: p.deIdPublico, 
            label: p.deviceLabel || 'Otra Terminal', 
            isOnline: true, 
            lastSeen: Date.now(), 
            peerId: ctx.conn.peer, 
            publicKey: p.publicKey,
            accountCreatedAt: p.createdAt,
            globalSync
        });

        const soyMasAntiguo = !p.createdAt || ctx.misCreds!.createdAt < p.createdAt;
        await ctx.response({ 
            deviceId: PeerService.localDeviceId, 
            deviceLabel: PeerService.localEnvLabel, 
            publicKey: ctx.misCreds!.publicKey, 
            creds: soyMasAntiguo ? ctx.misCreds : undefined,
            createdAt: ctx.misCreds!.createdAt
        });

        if (!PeerService.syncSessions[remoteDeviceId]) {
            PeerService.syncSessions[remoteDeviceId] = true;
            console.log(`[RPC-SERVER] Solicitando Sync Bidireccional a: ${remoteDeviceId}`);
            const allMsgs = await DB.getAllMessages();
            const lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
            const repairMsgIds = allMsgs.filter(m => !!m.ciphertext).map(m => m.msgId);
            ctx.conn.send({ tipo: 'SYNC_REQUEST', cuarta: ctx.miCuarta, lastMessageTime: lastTime, repairMsgIds });
        }
    },

    async match(ctx: RPCContext) {
        console.log(`[RPC-SERVER] Procesando IDENTITY_MATCH de ${ctx.conn.peer}`);
        const p = validateFields<IPaqueteIdentityMatch>(ctx.paquete, ['publicKey'], ['deviceId', 'deviceLabel', 'creds', 'createdAt']);
        const remoteDeviceId = p.deviceId || ctx.conn.peer?.replace('bc-v2-', '').split('-')[0];
        if (!remoteDeviceId) return;
        
        if (PeerService.deviceConns) PeerService.deviceConns[remoteDeviceId] = ctx.conn;

        const allDevices = await DB.getDevices();
        const existingDevice = allDevices.find(d => d.deviceId === remoteDeviceId);
        const globalSync = existingDevice ? existingDevice.globalSync : false;

        await DB.addDevice({ 
            deviceId: remoteDeviceId, 
            idPublico: ctx.conn.peer!.replace('bc-v2-', '').split('-')[0], 
            label: p.deviceLabel || 'Otra Terminal', 
            isOnline: true, 
            lastSeen: Date.now(), 
            peerId: ctx.conn.peer, 
            publicKey: p.publicKey,
            accountCreatedAt: p.createdAt,
            globalSync
        });

        if (p.creds) {
            console.log(`[RPC-SERVER] Sincronizando credenciales de terminal maestra.`);
            const myNewCreds = { ...p.creds };
            // Generar llaves locales para mantener aislamiento
            const keyPair = await CryptoService.generateECDHKeyPair();
            myNewCreds.publicKey = await CryptoService.exportKey(keyPair.publicKey);
            
            const masterKey = useStore.getState().aesKey;
            if (masterKey) {
                const privKeyJWK = await CryptoService.exportKey(keyPair.privateKey);
                const { ciphertext, iv } = await CryptoService.encrypt(masterKey, JSON.stringify(privKeyJWK));
                myNewCreds.encryptedPrivateKey = ciphertext;
                myNewCreds.privateKeyIv = iv;
            }
            await DB.setCreds(myNewCreds);
            useStore.getState().setMe(myNewCreds);
        }

        if (!PeerService.syncSessions[remoteDeviceId]) {
            PeerService.syncSessions[remoteDeviceId] = true;
            const allMsgs = await DB.getAllMessages();
            const lastTime = allMsgs.length > 0 ? Math.max(...allMsgs.map(m => m.time)) : 0;
            const repairMsgIds = allMsgs.filter(m => !!m.ciphertext).map(m => m.msgId);
            ctx.conn.send({ tipo: 'SYNC_REQUEST', cuarta: ctx.miCuarta, lastMessageTime: lastTime, repairMsgIds });
        }
        
        await ctx.response({ success: true });
    }
};
