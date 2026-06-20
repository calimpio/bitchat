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
    
    // New Session Security Actions
    setSessionSecurityMode: (mode: 'always_active' | 'absolute_timeout' | 'inactivity_timeout') => void;
    setSessionTimeoutDuration: (duration: number) => void;
    startAbsoluteLockTimer: () => void;
    clearAbsoluteLockTimer: () => void;
}

interface AppStoreState extends AppState {
    sessionExpiresAt: number | null;
    sessionSecurityMode: 'always_active' | 'absolute_timeout' | 'inactivity_timeout';
    sessionTimeoutDuration: number; // in minutes
}

let lockTimer: number | null = null;
let absoluteLockTimer: number | null = null;

const savedMode = (localStorage.getItem('bit_session_security_mode') as any) || 'inactivity_timeout';
const savedDuration = parseInt(localStorage.getItem('bit_session_timeout_duration') || '5', 10);

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
    sessionSecurityMode: savedMode,
    sessionTimeoutDuration: savedDuration,

    setPantalla: (pantalla) => {
        set({ pantalla });
        get().resetLockTimer();
    },
    setError: (error) => set({ error }),
    setMe: (me) => set({ me }),
    setMasterPassword: (pass) => set({ masterPassword: pass }),
    setAesKey: (aesKey) => {
        set({ aesKey });
        if (aesKey) {
            get().resetLockTimer();
            get().startAbsoluteLockTimer();
        } else {
            set({ sessionExpiresAt: null });
            get().clearAbsoluteLockTimer();
        }
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
        if (absoluteLockTimer) {
            clearTimeout(absoluteLockTimer);
            absoluteLockTimer = null;
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

        if (get().sessionSecurityMode !== 'inactivity_timeout') {
            return;
        }

        const timeoutMs = get().sessionTimeoutDuration * 60 * 1000;
        const expiresAt = Date.now() + timeoutMs;
        set({ sessionExpiresAt: expiresAt });

        lockTimer = window.setTimeout(() => {
            get().lockTerminal();
        }, timeoutMs);
    },

    startAbsoluteLockTimer: () => {
        if (absoluteLockTimer) clearTimeout(absoluteLockTimer);

        if (get().pantalla === 'AUTH' || get().pantalla === 'AUTH_LOGIN' || !get().aesKey) {
            return;
        }

        if (get().sessionSecurityMode !== 'absolute_timeout') {
            return;
        }

        const timeoutMs = get().sessionTimeoutDuration * 60 * 1000;
        const expiresAt = Date.now() + timeoutMs;
        set({ sessionExpiresAt: expiresAt });

        absoluteLockTimer = window.setTimeout(() => {
            get().lockTerminal();
        }, timeoutMs);
    },

    clearAbsoluteLockTimer: () => {
        if (absoluteLockTimer) {
            clearTimeout(absoluteLockTimer);
            absoluteLockTimer = null;
        }
    },

    setSessionSecurityMode: (mode) => {
        localStorage.setItem('bit_session_security_mode', mode);
        set({ sessionSecurityMode: mode });
        
        if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
        if (absoluteLockTimer) { clearTimeout(absoluteLockTimer); absoluteLockTimer = null; }
        set({ sessionExpiresAt: null });

        if (mode === 'inactivity_timeout') {
            get().resetLockTimer();
        } else if (mode === 'absolute_timeout') {
            get().startAbsoluteLockTimer();
        }
    },

    setSessionTimeoutDuration: (duration) => {
        localStorage.setItem('bit_session_timeout_duration', duration.toString());
        set({ sessionTimeoutDuration: duration });
        
        if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
        if (absoluteLockTimer) { clearTimeout(absoluteLockTimer); absoluteLockTimer = null; }
        set({ sessionExpiresAt: null });

        if (get().sessionSecurityMode === 'inactivity_timeout') {
            get().resetLockTimer();
        } else if (get().sessionSecurityMode === 'absolute_timeout') {
            get().startAbsoluteLockTimer();
        }
    }
}));