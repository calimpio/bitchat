export interface Credentials {
    idPublico: string;
    idPrivado: string;
    passwordHash: string;
}

export interface Contact {
    tokenCuartaCredencial: string;
    insecure: boolean;
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
}

export interface RequestRecord {
    idPublico: string;
    time: number;
}