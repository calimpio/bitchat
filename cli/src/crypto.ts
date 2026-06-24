import { webcrypto } from 'crypto';

const subtle = webcrypto.subtle;

export async function arrayBufferToBase64(buffer: BufferSource): Promise<string> {
    const buf = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return buf.toString('base64');
}

export async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
    const buf = Buffer.from(base64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export const CryptoService = {
    async deriveMasterKey(password: string, salt: BufferSource): Promise<webcrypto.CryptoKey> {
        const encoder = new TextEncoder();
        const baseKey = await subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return await subtle.deriveKey(
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

    async generateECDHKeyPair(): Promise<webcrypto.CryptoKeyPair> {
        return await subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-384' },
            true,
            ['deriveKey', 'deriveBits']
        ) as webcrypto.CryptoKeyPair;
    },

    async exportKey(key: webcrypto.CryptoKey): Promise<JsonWebKey> {
        return await subtle.exportKey('jwk', key);
    },

    async importPublicECDHKey(jwk: JsonWebKey): Promise<webcrypto.CryptoKey> {
        return await subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDH', namedCurve: 'P-384' },
            true,
            []
        );
    },

    async deriveSharedSecret(privateKey: webcrypto.CryptoKey, publicKey: webcrypto.CryptoKey): Promise<webcrypto.CryptoKey> {
        return await subtle.deriveKey(
            { name: 'ECDH', public: publicKey },
            privateKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    async encrypt(key: webcrypto.CryptoKey, plaintext: string): Promise<{ ciphertext: string, iv: string }> {
        const iv = webcrypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const encrypted = await subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(plaintext)
        );
        return {
            ciphertext: await arrayBufferToBase64(encrypted),
            iv: await arrayBufferToBase64(iv)
        };
    },

    async decrypt(key: webcrypto.CryptoKey, ciphertextBase64: string, ivBase64: string): Promise<string> {
        const ciphertext = await base64ToArrayBuffer(ciphertextBase64);
        const iv = await base64ToArrayBuffer(ivBase64);
        const decrypted = await subtle.decrypt(
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
        const hashBuffer = await subtle.digest('SHA-256', data);
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
        for (let i = 0; i < 8; i++) {
            const index = hashArray[i];
            fingerprint += emojiList[index] || emojiList[0];
        }
        return fingerprint;
    },

    async exportAESKey(key: webcrypto.CryptoKey): Promise<string> {
        const exported = await subtle.exportKey('raw', key);
        return await arrayBufferToBase64(exported);
    },

    async importAESKey(base64: string): Promise<webcrypto.CryptoKey> {
        const buffer = await base64ToArrayBuffer(base64);
        return await subtle.importKey(
            'raw',
            buffer,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    },

    async encryptBinary(key: webcrypto.CryptoKey, data: ArrayBuffer): Promise<{ ciphertext: string, iv: string }> {
        const iv = webcrypto.getRandomValues(new Uint8Array(12));
        const encrypted = await subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );
        return {
            ciphertext: await arrayBufferToBase64(encrypted),
            iv: await arrayBufferToBase64(iv)
        };
    },

    async decryptBinary(key: webcrypto.CryptoKey, ciphertextBase64: string, ivBase64: string): Promise<ArrayBuffer> {
        const ciphertext = await base64ToArrayBuffer(ciphertextBase64);
        const iv = await base64ToArrayBuffer(ivBase64);
        return await subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
    }
};
