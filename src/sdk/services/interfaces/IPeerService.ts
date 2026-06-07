import { DataConnection, Peer } from 'peerjs';

/**
 * IPeerService manages P2P connectivity, signaling, and E2EE messaging using PeerJS.
 * It handles the cryptographic handshake and real-time synchronization between nodes.
 */
export interface IPeerService {
    /** The active PeerJS node instance. */
    peer: Peer | null;

    /** Map of active secure P2P connections. */
    conexionesP2PDirectas: Record<string, { channelId: string, status: string }>;

    /** Cache of derived ECDH shared secrets for active sessions. */
    sharedKeys: Record<string, CryptoKey>;

    /** Interval for background synchronization tasks. */
    syncInterval?: number | null;

    /** Callback triggered when the UI needs to be refreshed (e.g., node online, new request). */
    onRefresh: (() => void) | null;

    /** Callback triggered when a new message is received. */
    onMessage: ((chatId: string) => void) | null;

    /** Initializes the P2P node with the given Public ID. */
    inicializarNodo(idPublico: string): Promise<void>;

    /** Starts the background synchronization interval. */
    startBackgroundSync(): void;

    /** Probes the network to ensure an identity is not already claimed with different credentials. */
    validarIdentidadEnRed(idPublico: string, idPrivado: string, passwordHash: string): Promise<boolean>;

    /** Initiates a connection request or handshake with another BitChat node. */
    conectarAContacto(idPublicoAmigo: string): Promise<void>;

    /** Internal helper to derive shared key. */
    _getSharedKey(idAmigo: string): Promise<CryptoKey | null>;

    /** Processes incoming PeerJS data connections and routes packet types. */
    _procesarEntrante(conn: DataConnection): void;

    /** Formally alerts contacts about an identity hijacking attempt. */
    _alertarContactosDeIntentoDeSecuestro(miIdComprometido: string): Promise<void>;

    /** Establishes a secure P2P channel by deriving a unique ID. */
    _establecerCanalSeguro(idAmigo: string, miCuarta: string, suCuarta: string): Promise<void>;

    /** Sends any locally saved messages that have not yet been sent to the target contact. */
    _enviarPendientes(chatId: string, conn: DataConnection): Promise<void>;

    /** Formally accepts a pending connection request and starts the handshake. */
    aceptarConexion(idPublicoAmigo: string): Promise<void>;

    /** Encrypts (E2EE) and sends a text message to a contact. */
    enviarMensaje(idPublicoAmigo: string, texto: string): Promise<void>;

    /** 
     * Initiates a P2P synchronization probe between devices owned by the same user 
     * to transfer contacts and history.
     */
    iniciarSincronizacion(password: string): Promise<boolean>;
}
