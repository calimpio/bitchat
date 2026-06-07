import { DB } from './db.ts';
import { Estado } from '../models/state.ts';
import { Credentials, ContactMap } from '../models/types.ts';

export async function hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generarCuartaCredencial(idPublico: string, idPrivado: string, passwordHash: string): Promise<string> {
    return await hashString(`${idPublico}:${idPrivado}:${passwordHash}`);
}

export async function generarQuintaId(cuartaA: string, cuartaB: string): Promise<string> {
    const combined = [cuartaA, cuartaB].sort().join('');
    const hash = await hashString(combined);
    return hash.substring(0, 10);
}

export const BitChatAuth = {
    async guardarMisCredenciales(idPublico: string, idPrivado: string, password: string): Promise<void> {
        const passwordHash = await hashString(password);
        const creds = { idPublico, idPrivado, passwordHash };
        await DB.setCreds(creds);
        Estado.me = creds;
    },

    async obtenerMisCredenciales(): Promise<Credentials | null> {
        if (!Estado.me) Estado.me = await DB.getCreds();
        return Estado.me;
    },

    async verificarPassword(inputPassword: string): Promise<boolean> {
        const creds = await this.obtenerMisCredenciales();
        if (!creds) return false;
        const inputHash = await hashString(inputPassword);
        return inputHash === creds.passwordHash;
    },

    obtenerContactos(): ContactMap {
        return JSON.parse(localStorage.getItem('bitchat_auth_contacts') || '{}');
    },

    guardarContacto(idPublico: string, tokenCuartaCredencial: string, insecure: boolean = false): void {
        const contactos = this.obtenerContactos();
        contactos[idPublico] = { tokenCuartaCredencial, insecure };
        localStorage.setItem('bitchat_auth_contacts', JSON.stringify(contactos));
    },

    marcarContactoInseguro(idPublico: string): void {
        const contactos = this.obtenerContactos();
        if (contactos[idPublico]) {
            contactos[idPublico].insecure = true;
            localStorage.setItem('bitchat_auth_contacts', JSON.stringify(contactos));
        }
    }
};