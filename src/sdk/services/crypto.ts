export async function arrayBufferToBase64(buffer: BufferSource): Promise<string> {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export const CryptoService = {
    async deriveMasterKey(password: string, salt: BufferSource): Promise<CryptoKey> {
        const encoder = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    async generateECDHKeyPair(): Promise<CryptoKeyPair> {
        return await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-384' },
            true,
            ['deriveKey', 'deriveBits']
        );
    },

    async exportKey(key: CryptoKey): Promise<JsonWebKey> {
        return await crypto.subtle.exportKey('jwk', key);
    },

    async importPublicECDHKey(jwk: JsonWebKey): Promise<CryptoKey> {
        return await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDH', namedCurve: 'P-384' },
            true,
            []
        );
    },

    async deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
        return await crypto.subtle.deriveKey(
            { name: 'ECDH', public: publicKey },
            privateKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    async encrypt(key: CryptoKey, plaintext: string): Promise<{ ciphertext: string, iv: string }> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(plaintext)
        );
        return {
            ciphertext: await arrayBufferToBase64(encrypted),
            iv: await arrayBufferToBase64(iv)
        };
    },

    async decrypt(key: CryptoKey, ciphertextBase64: string, ivBase64: string): Promise<string> {
        const ciphertext = await base64ToArrayBuffer(ciphertextBase64);
        const iv = await base64ToArrayBuffer(ivBase64);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    },

    async getFingerprint(jwk: JsonWebKey): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(jwk));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);
        
        const emojiList = [
            '🛡️', '🛰️', '💎', '🔑', '🧊', '🔥', '⚡', '🌌', '🌿', '🍀', '🍎', '🍄', '🌍', '🌙', '⭐', '☀️',
            '🛸', '🚁', '🚀', '⛵', '🏔️', '🌋', '🏝️', '🗿', '🎭', '🎨', '🧶', '🧵', '🧬', '🔬', '🔭', '📡',
            '🪐', '🌠', '🌈', '🌪️', '🌊', '🌋', '🌵', '🌴', '🌳', '🌲', '🍁', '🍂', '🍃', '🎋', '🍄', '🐚',
            '🦀', '🦞', '🦐', '🦑', '🐙', '🦈', '🐬', '🐳', '🐋', '🐟', '🐠', '🐡', '🐢', '🐍', '🦎', '🦖',
            '🦕', '🐊', '🐅', '🐆', '🦓', '🐘', '🦏', '🦛', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎',
            '🐖', '🐏', '🐑', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🕊️', '🦅', '🦆', '🦢', '🦉', '🦩',
            '🦚', '🦜', '🐸', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🎍', '🎋',
            '🍃', '🍂', '🍁', '🍄', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛',
            '🌜', '🌚', '🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌙', '🌎', '🌍', '🌏', '🪐', '💫',
            '⭐️', '🌟', '✨', '⚡️', '☄️', '💥', '🔥', '🌪', '🌈', '☀️', '🌤', '⛅️', '🌥', '☁️', '🌦', '🌧',
            '⛈', '🌩', '🌨', '❄️', '☃️', '⛄️', '🌬', '💨', '💧', '💦', '☔️', '☂️', '🌊', '🌫', '🧗', '🚵',
            '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗', '🎫', '🎟', '🎭', '🎨', '🎬', '🎤', '🎧',
            '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🎻', '🎲', '🎯', '🎳', '🎮', '🎰', '🧩', '🚗', '🚕', '🚙',
            '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🚲', '🛴', '🛵', '🏍', '🚡', '🚠',
            '🚠', '🚁', '🚀', '🛸', '🛰', '🛶', '⛵️', '🚤', '🛥', '🛳', '⛴', '🚢', '⚓️', '🚧', '⛽️', '🏮',
            '🏢', '🏰', '🗼', '⛩', '🕋', '🏛', '🕍', '⛪️', '🕌', '🛕', '🕍', '🗽', '🗿', '💎', '🔮', '🧿'
        ];
        
        let fingerprint = '';
        // Use 8 emojis for higher entropy (each emoji maps to 1 byte index)
        for (let i = 0; i < 8; i++) {
            const index = hashArray[i]; // hashArray[i] is 0-255, matching our list length
            fingerprint += emojiList[index] || emojiList[0];
        }
        return fingerprint;
    },

    async exportAESKey(key: CryptoKey): Promise<string> {
        const exported = await crypto.subtle.exportKey('raw', key);
        return await arrayBufferToBase64(exported);
    },

    async importAESKey(base64: string): Promise<CryptoKey> {
        const buffer = await base64ToArrayBuffer(base64);
        return await crypto.subtle.importKey(
            'raw',
            buffer,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }
};