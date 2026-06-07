export interface Credentials {
    idPublico: string;
    idPrivado: string;
    passwordHash?: string; // Legacy (optional for migration)
    authWitness?: string; // Base64 encrypted witness
    authIv?: string; // Base64 IV for witness
    salt?: string; // base64 (optional for migration)
    publicKey?: JsonWebKey;
    encryptedPrivateKey?: string; // base64
    privateKeyIv?: string; // base64
}

export interface Contact {
    tokenCuartaCredencial: string;
    insecure: boolean;
    publicKey?: JsonWebKey;
}

export interface ContactMap {
    [key: string]: Contact;
}

export interface Message {
    id?: number;
    msgId: string;
    chatId: string;
    de: string;
    msg: string;
    time: number;
    status: 'saved' | 'sent' | 'read';
    secure: boolean;
    iv?: string; // Initialization vector for AES-GCM
}

export interface RequestRecord {
    idPublico: string;
    time: number;
    publicKey?: JsonWebKey;
}

export type TipoPaquete = 
    | 'IDENTITY_PROBE' 
    | 'IDENTITY_MATCH' 
    | 'IDENTITY_CONFLICT' 
    | 'SECURITY_ALERT' 
    | 'CONNECTION_REQ' 
    | 'CONNECTION_ACCEPTED' 
    | 'HANDSHAKE_START' 
    | 'HANDSHAKE_FINAL' 
    | 'MSG' 
    | 'MSG_ACK' 
    | 'SYNC_REQUEST' 
    | 'SYNC_DATA';

export interface IPaqueteBase {
    tipo: TipoPaquete;
    miIdPublico?: string;
    deIdPublico?: string;
}

export interface IPaqueteIdentityProbe extends IPaqueteBase {
    tipo: 'IDENTITY_PROBE';
    deIdPublico: string;
    cuarta: string;
}

export interface IPaqueteSecurityAlert extends IPaqueteBase {
    tipo: 'SECURITY_ALERT';
    idComprometido: string;
}

export interface IPaqueteConnectionReq extends IPaqueteBase {
    tipo: 'CONNECTION_REQ';
    deIdPublico: string;
    publicKey: JsonWebKey;
}

export interface IPaqueteHandshakeStart extends IPaqueteBase {
    tipo: 'HANDSHAKE_START';
    miIdPublico: string;
    cuartaCredencial: string;
    publicKey: JsonWebKey;
}

export interface IPaqueteHandshakeFinal extends IPaqueteBase {
    tipo: 'HANDSHAKE_FINAL';
    miIdPublico: string;
    cuartaCredencialAmigo: string;
    publicKey: JsonWebKey;
}

export interface IPaqueteMsg extends IPaqueteBase {
    tipo: 'MSG';
    msgId: string;
    miIdPublico: string;
    txt: string;
    time: number;
    channel?: string;
    iv: string; // For E2EE decryption
}

export interface IPaqueteMsgAck extends IPaqueteBase {
    tipo: 'MSG_ACK';
    msgId: string;
    read: boolean;
}

export interface IPaqueteSyncRequest extends IPaqueteBase {
    tipo: 'SYNC_REQUEST';
    cuarta: string;
}

export interface IPaqueteSyncData extends IPaqueteBase {
    tipo: 'SYNC_DATA';
    contactos: ContactMap;
    mensajes: Message[];
}

export interface IPaqueteIdentityMatch extends IPaqueteBase {
    tipo: 'IDENTITY_MATCH';
}

export interface IPaqueteIdentityConflict extends IPaqueteBase {
    tipo: 'IDENTITY_CONFLICT';
}

export interface IPaqueteConnectionAccepted extends IPaqueteBase {
    tipo: 'CONNECTION_ACCEPTED';
}

export type IPaqueteData = 
    | IPaqueteIdentityProbe 
    | IPaqueteIdentityMatch
    | IPaqueteIdentityConflict
    | IPaqueteSecurityAlert 
    | IPaqueteConnectionReq 
    | IPaqueteConnectionAccepted
    | IPaqueteHandshakeStart 
    | IPaqueteHandshakeFinal 
    | IPaqueteMsg 
    | IPaqueteMsgAck 
    | IPaqueteSyncRequest 
    | IPaqueteSyncData;