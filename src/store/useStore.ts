import { create } from 'zustand';
import { AppState, Message } from '../sdk/models/types.ts';

interface AppStore extends AppStoreState {
    setPantalla: (pantalla: AppState['pantalla']) => void;
    setError: (error: string) => void;
    setMe: (me: AppState['me']) => void;
    setMasterPassword: (pass: string) => void;
    setAesKey: (key: CryptoKey | null) => void;
    setChatConIdPublico: (id: string | null) => void;
    setActiveApp: (app: AppState['activeApp']) => void;
    setShowSidebar: (show: boolean) => void;
    setMostrarChatMobile: (show: boolean) => void;
    setHistoriales: (historiales: Record<string, Message[]>) => void;
    setDevices: (devices: AppState['devices']) => void;
    lockTerminal: () => void;
    resetLockTimer: () => void;
}

interface AppStoreState extends AppState {
    sessionExpiresAt: number | null;
}

let lockTimer: number | null = null;
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutos de inactividad

export const useStore = create<AppStore>((set, get) => ({
    pantalla: 'AUTH',
    activeApp: 'bitChat',
    error: '',
    chatConIdPublico: null,
    historiales: {},
    masterPassword: '',
    showModalAdd: false,
    showModalConfig: false,
    lastPantalla: null,
    me: null,
    solicitudesEnviadasPendientes: new Set(),
    mostrarChatMobile: false,
    showSidebar: true,
    aesKey: null,
    devices: [],
    sessionExpiresAt: null,

    setPantalla: (pantalla) => {
        set({ pantalla });
        get().resetLockTimer();
    },
    setError: (error) => set({ error }),
    setMe: (me) => set({ me }),
    setMasterPassword: (pass) => set({ masterPassword: pass }),
    setAesKey: (aesKey) => {
        set({ aesKey });
        if (aesKey) get().resetLockTimer();
        else set({ sessionExpiresAt: null });
    },
    setChatConIdPublico: (chatConIdPublico) => {
        set({ chatConIdPublico });
        get().resetLockTimer();
    },
    setActiveApp: (activeApp) => {
        set({ activeApp });
        get().resetLockTimer();
    },
    setShowSidebar: (showSidebar) => set({ showSidebar }),
    setMostrarChatMobile: (mostrarChatMobile) => set({ mostrarChatMobile }),
    setHistoriales: (historiales) => set({ historiales }),
    setDevices: (devices) => set({ devices }),

    lockTerminal: () => {
        console.log('[SECURITY] Sesión expirada. Bloqueando terminal (Purga de RAM).');
        if (lockTimer) {
            clearTimeout(lockTimer);
            lockTimer = null;
        }
        set({ 
            aesKey: null, 
            masterPassword: '', 
            pantalla: 'AUTH_LOGIN',
            historiales: {},
            chatConIdPublico: null,
            sessionExpiresAt: null
        });
    },

    resetLockTimer: () => {
        if (lockTimer) clearTimeout(lockTimer);

        if (get().pantalla === 'AUTH' || get().pantalla === 'AUTH_LOGIN' || !get().aesKey) {
            set({ sessionExpiresAt: null });
            return;
        }

        const expiresAt = Date.now() + LOCK_TIMEOUT;
        set({ sessionExpiresAt: expiresAt });

        lockTimer = window.setTimeout(() => {
            get().lockTerminal();
        }, LOCK_TIMEOUT);
    }
}));