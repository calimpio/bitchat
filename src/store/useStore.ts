import { create } from 'zustand';
import { AppState, Message } from '../sdk/models/types.ts';

interface AppStore extends AppState {
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
}

export const useStore = create<AppStore>((set) => ({
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

    setPantalla: (pantalla) => set({ pantalla }),
    setError: (error) => set({ error }),
    setMe: (me) => set({ me }),
    setMasterPassword: (pass) => set({ masterPassword: pass }),
    setAesKey: (aesKey) => set({ aesKey }),
    setChatConIdPublico: (chatConIdPublico) => set({ chatConIdPublico }),
    setActiveApp: (activeApp) => set({ activeApp }),
    setShowSidebar: (showSidebar) => set({ showSidebar }),
    setMostrarChatMobile: (mostrarChatMobile) => set({ mostrarChatMobile }),
    setHistoriales: (historiales) => set({ historiales }),
    setDevices: (devices) => set({ devices }),
}));