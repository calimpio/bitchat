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
    createdAt: number;
    updatedAt?: number;
}

export interface Contact {
    tokenCuartaCredencial: string;
    insecure: boolean;
    publicKey?: JsonWebKey;
    syncAllowedDevices?: string[]; // List of device Public IDs allowed to sync this chat
    sharedSecret?: string; // Base64 of the AES-GCM shared key
    createdAt?: number;
    updatedAt?: number;
}

export interface ContactMap {
    [key: string]: Contact;
}

export interface Message {
    msgId: string;
    chatId: string;
    de: string;
    msg: string;
    time: number;
    updatedAt?: number;
    status: 'saved' | 'sent' | 'read';
    secure: boolean;
    iv?: string; // Initialization vector for AES-GCM
    ciphertext?: string; // Original encrypted payload for retry
}

export interface RequestRecord {
    idPublico: string;
    time: number;
    updatedAt?: number;
    publicKey?: JsonWebKey;
}

export type TipoPaquete = 
    | 'IDENTITY_PROBE' 
    | 'IDENTITY_MATCH' 
    | 'IDENTITY_CONFLICT' 
    | 'SECURITY_ALERT' 
    | 'CONNECTION_REQ' 
    | 'CONNECTION_ACCEPTED' 
    | 'CONNECTION_REJECTED'
    | 'HANDSHAKE_START' 
    | 'HANDSHAKE_FINAL' 
    | 'MSG' 
    | 'MSG_ACK' 
    | 'GET_MESSAGES'
    | 'SYNC_REQUEST' 
    | 'SYNC_DATA'
    | 'DRIVE_LIST_REPOS_REQ'
    | 'DRIVE_LIST_REPOS_RESP'
    | 'DRIVE_CLONE_REQ'
    | 'DRIVE_CLONE_RESP'
    | 'DRIVE_PULL_REQ'
    | 'DRIVE_PULL_RESP'
    | 'DRIVE_PUSH_REQ'
    | 'DRIVE_PUSH_RESP';

export interface IPaqueteBase {
    tipo: TipoPaquete;
    miIdPublico?: string;
    deIdPublico?: string;
    reqId?: string; // UUID for Request/Response tracking
    isResponse?: boolean; // Flag to indicate this packet is a response
}
export interface IPaqueteIdentityProbe extends IPaqueteBase {
    tipo: 'IDENTITY_PROBE';
    deIdPublico: string;
    cuarta: string;
    nonce?: string; // Challenge for Identity Probe V2
    deviceId?: string; // Persistent unique ID for the terminal
    deviceLabel?: string; // Environment info (e.g., "Windows App", "Chrome")
    publicKey?: JsonWebKey;
    createdAt?: number;
}

export interface IPaqueteIdentityMatch extends IPaqueteBase {
    tipo: 'IDENTITY_MATCH';
    deviceId?: string;
    deviceLabel?: string;
    publicKey?: JsonWebKey;
    creds?: Credentials;
    createdAt?: number;
}

export interface IPaqueteSecurityAlert extends IPaqueteBase {
    tipo: 'SECURITY_ALERT';
    idComprometido: string;
}

export interface IPaqueteConnectionReq extends IPaqueteBase {
    tipo: 'CONNECTION_REQ';
    deIdPublico: string;
    publicKey: JsonWebKey;
    huellaDestino?: string; // Proof that the sender knows the receiver's fingerprint
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
    lastMessageTime?: number; // Delta sync: only request messages after this timestamp
    repairMsgIds?: string[]; // IDs of messages that are locally encrypted and need decryption from a peer
}

export interface EncryptedVaultObject {
    label: string; // Plaintext or searchable hash
    content: string; // Base64 ciphertext
    iv: string; // Base64 IV
    method: 'master' | 'e2ee';
    publicKey?: JsonWebKey; // If E2EE was used
    createdAt: number;
    updatedAt: number;
}

export interface IPaqueteSyncData extends IPaqueteBase {
    tipo: 'SYNC_DATA';
    cuarta?: string;
    contactos?: ContactMap;
    mensajes?: Message[];
    vault?: EncryptedVaultObject;
}

export interface IPaqueteIdentityConflict extends IPaqueteBase {
    tipo: 'IDENTITY_CONFLICT';
}

export interface IPaqueteConnectionAccepted extends IPaqueteBase {
    tipo: 'CONNECTION_ACCEPTED';
}

export interface IPaqueteConnectionRejected extends IPaqueteBase {
    tipo: 'CONNECTION_REJECTED';
    deIdPublico: string;
}

export interface IPaqueteGetMessages extends IPaqueteBase {
    tipo: 'GET_MESSAGES';
    chatId: string;
    lastTime?: number;
}

export interface IPaqueteDriveListReposReq extends IPaqueteBase {
    tipo: 'DRIVE_LIST_REPOS_REQ';
}

export interface IPaqueteDriveListReposResp extends IPaqueteBase {
    tipo: 'DRIVE_LIST_REPOS_RESP';
    repos: any[];
}

export interface IPaqueteDriveCloneReq extends IPaqueteBase {
    tipo: 'DRIVE_CLONE_REQ';
    repoId: string;
}

export interface IPaqueteDriveCloneResp extends IPaqueteBase {
    tipo: 'DRIVE_CLONE_RESP';
    repo: any;
    branches: any[];
    objects: any[];
    pullRequests?: any[];
}

export interface IPaqueteDrivePullReq extends IPaqueteBase {
    tipo: 'DRIVE_PULL_REQ';
    repoId: string;
}

export interface IPaqueteDrivePullResp extends IPaqueteBase {
    tipo: 'DRIVE_PULL_RESP';
    branches: any[];
    objects: any[];
    pullRequests?: any[];
}

export interface IPaqueteDrivePushReq extends IPaqueteBase {
    tipo: 'DRIVE_PUSH_REQ';
    repoId: string;
    branches: any[];
    objects: any[];
    pullRequests?: any[];
}

export interface IPaqueteDrivePushResp extends IPaqueteBase {
    tipo: 'DRIVE_PUSH_RESP';
    success: boolean;
}

export type IPaqueteData = 
    | IPaqueteIdentityProbe 
    | IPaqueteIdentityMatch
    | IPaqueteIdentityConflict
    | IPaqueteSecurityAlert 
    | IPaqueteConnectionReq 
    | IPaqueteConnectionAccepted
    | IPaqueteConnectionRejected
    | IPaqueteHandshakeStart 
    | IPaqueteHandshakeFinal 
    | IPaqueteMsg 
    | IPaqueteMsgAck 
    | IPaqueteGetMessages
    | IPaqueteSyncRequest 
    | IPaqueteSyncData
    | IPaqueteDriveListReposReq
    | IPaqueteDriveListReposResp
    | IPaqueteDriveCloneReq
    | IPaqueteDriveCloneResp
    | IPaqueteDrivePullReq
    | IPaqueteDrivePullResp
    | IPaqueteDrivePushReq
    | IPaqueteDrivePushResp;

export interface Device {
    deviceId: string; // Key in database
    idPublico: string; // Owner's ID
    label: string;
    isOnline: boolean;
    lastSeen: number; // Acts as updatedAt
    publicKey?: JsonWebKey;
    peerId?: string; // Current session signaling ID
    accountCreatedAt?: number; // Original creation time of the identity
    createdAt?: number; // When this specific terminal was first seen
    updatedAt?: number;
    globalSync?: boolean; // True if this device is globally authorized to synchronize all chats
}

export interface AppState {
    pantalla: 'AUTH' | 'AUTH_LOGIN' | 'DASHBOARD' | 'TERMS';
    activeApp: 'bitMsg' | 'bitDrive' | 'bitDevices' | 'Settings' | 'ChatSettings';
    error: string;
    chatConIdPublico: string | null;
    historiales: Record<string, Message[]>;
    masterPassword: string;
    showModalAdd: boolean;
    showModalConfig: boolean;
    lastPantalla: string | null;
    me: Credentials | null;
    solicitudesEnviadasPendientes: Set<string>;
    mostrarChatMobile: boolean;
    showSidebar: boolean;
    aesKey?: CryptoKey | null; // Shared key for local DB encryption
    devices: Device[];
}
