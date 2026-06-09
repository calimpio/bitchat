import { DataConnection } from 'peerjs';
import { IPaqueteData, Credentials } from '../../../models/types.ts';

export interface RPCContext {
    conn: DataConnection;
    paquete: IPaqueteData;
    reqId?: string;
    miIdPublico?: string;
    misCreds?: Credentials;
    miCuarta?: string;
    response: (payload: any, customType?: string) => Promise<void>;
}
