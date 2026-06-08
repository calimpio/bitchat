import { DataConnection, Peer } from 'peerjs';
import { Message, Credentials } from '../../models/types.ts';

/**
 * IPeerService manages P2P connectivity, signaling, and E2EE messaging using PeerJS.
 * It handles the cryptographic handshake and real-time synchronization between nodes.
 */
export interface IPeerService {
    /** The active PeerJS node instance. */
    peer: Peer | null;

    /** Map of active secure P2P connections. */
    conexionesP2PDirectas: Record<string, { channelId?: string, status: string, conn?: DataConnection }>;

    /** Track sync sessions per deviceId to prevent loops. */
    syncSessions: Record<string, boolean>;

    /** Cache of derived ECDH shared secrets for active sessions. */
    sharedKeys: Record<string, CryptoKey>;

    /** Interval for background synchronization tasks. */
    syncInterval?: number | null;

    /** Callback triggered when the UI needs to be refreshed (e.g., node online, new request). */
    onRefresh: (() => void) | null;

    /** Callback triggered when a new message is received. */
    onMessage: ((chatId: string) => void) | null;

    /** Map of active connections to personal devices for replication. */
    deviceConns?: Record<string, DataConnection>;

    /** Persistent ID for this terminal. */
    localDeviceId?: string;

    /** Human-readable label for the environment (e.g. "Windows App"). */
    localEnvLabel?: string;

    /** Initializes the P2P node with the given Public ID. */
    inicializarNodo(idPublico: string, useSuffix?: boolean): Promise<void>;

    /** Starts the background synchronization interval. */
    startBackgroundSync(): void;

    /** Probes the network to ensure an identity is not already claimed with different credentials. */
    validarIdentidadEnRed(idPublico: string, idPrivado: string, passwordHash: string): Promise<boolean | Credentials>;

    /** Initiates a connection request or handshake with another BitChat node. */
    conectarAContacto(idPublicoAmigo: string, huellaEsperada?: string): Promise<void>;

    /** Internal helper to derive shared key. */
    _getSharedKey(idAmigo: string): Promise<CryptoKey | null>;

    /** Processes incoming PeerJS data connections and routes packet types. */
    _procesarEntrante(conn: DataConnection): void;

    /** Formally alerts contacts about an identity hijacking attempt. */
    _alertarContactosDeIntentoDeSecuestro(miIdComprometido: string): Promise<void>;

    /** Establishes a secure P2P channel by deriving a unique ID. */
    _establecerCanalSeguro(idAmigo: string, miCuarta: string, suCuarta: string, conn?: DataConnection): Promise<void>;

    /** Sends any locally saved messages that have not yet been sent to the target contact. */
    _enviarPendientes(chatId: string, conn: DataConnection): Promise<void>;

    /** Formally accepts a pending connection request and starts the handshake. */
    aceptarConexion(idPublicoAmigo: string): Promise<void>;

    /** Formally rejects a pending connection request and notifies the sender. */
    rechazarConexion(idPublicoAmigo: string): Promise<void>;

    /** Encrypts (E2EE) and sends a text message to a contact. */
    enviarMensaje(idPublicoAmigo: string, texto: string): Promise<void>;

    /** Discovery: Connects to another personal terminal using the base identity. */
    conectarADispositivoPersonal(targetId: string): Promise<void>;

    /** Actively searches for other personal devices for a period of time. */
    buscarDispositivos(): Promise<void>;

    /** 
     * Initiates a P2P synchronization probe between devices owned by the same user 
     * to transfer contacts and history.
     */
    iniciarSincronizacion(password: string): Promise<boolean>;

    /** Replicates a single message to online authorized personal devices in real-time. */
    _replicateMessage(msg: Message): Promise<void>;

    /** Replicates a single contact to all online personal devices in real-time. */
    _replicateContact(idPublico: string): Promise<void>;

    /** Actively requests a sync for a specific chat from all online personal devices. */
    syncChat(chatId: string): Promise<void>;
}
