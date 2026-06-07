import { Message, Credentials } from './types.ts';

export interface AppState {
    pantalla: 'AUTH' | 'AUTH_LOGIN' | 'DASHBOARD' | 'TERMS';
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
    aesKey?: CryptoKey; // Shared key for local DB encryption
}

export const Estado: AppState = {
    pantalla: 'AUTH', 
    error: '',
    chatConIdPublico: null,
    historiales: {},
    masterPassword: '',
    showModalAdd: false,
    showModalConfig: false,
    lastPantalla: null,
    me: null,
    solicitudesEnviadasPendientes: new Set(),
    mostrarChatMobile: false 
};