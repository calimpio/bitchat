# Implementation Plan: E2EE and Encrypted Persistence

## Objective
Implement End-to-End Encryption (E2EE) for messages in transit using ECDH + AES-GCM, and encrypted persistence for the local database (IndexedDB) encrypting only the message content.

## Key Files & Context
- `src/sdk/models/types.ts`: Update types for Credentials, Contacts, and Network Packets.
- `src/sdk/services/crypto.ts` (New): Centralize Web Crypto API logic.
- `src/sdk/services/auth.ts`: Handle key pair generation and PBKDF2 derivation during registration/login.
- `src/sdk/services/db.ts`: Implement on-the-fly encryption/decryption of the `msg` field.
- `src/sdk/services/peer.ts`: Implement public key exchange during the handshake and E2EE message encryption/decryption.

## Implementation Steps

### 1. Cryptography Service (`src/sdk/services/crypto.ts`)
- Implement PBKDF2 to derive an AES-GCM key from the `masterPassword` and a `salt`.
- Implement ECDH key pair generation (P-384).
- Implement AES-GCM encryption/decryption wrappers (returning base64 strings and `iv`).
- Implement ECDH shared secret derivation.

### 2. Update Types (`src/sdk/models/types.ts`)
- `Credentials`: Add `salt`, `publicKey` (JWK), `encryptedPrivateKey` (base64), and `privateKeyIv`.
- `Contact`: Add `publicKey` (JWK).
- `IPaqueteHandshakeStart` / `IPaqueteHandshakeFinal`: Add `publicKey` field.
- `IPaqueteMsg`: Update to include `iv` for AES-GCM.

### 3. Local Persistence Encryption (`auth.ts` & `db.ts`)
- **Auth**: Upon identity generation, create a salt, derive local AES key, generate ECDH keypair, encrypt the private key, and save. On login, derive the local AES key and keep it in memory (in `Estado`).
- **DB**: Modify `addMessage`, `updateMessageByMsgId`, `getChatMessages`, and `getAllMessages`. Before saving, encrypt the `msg` text using the local AES key. After reading, decrypt it.

### 4. E2EE in Transit (`peer.ts`)
- **Handshake**: Send your `publicKey` in `HANDSHAKE_START` and `HANDSHAKE_FINAL`. Save the contact's `publicKey` in the `Contact` object in localStorage.
- **Sending Messages**: Before sending a `MSG` packet, derive a shared AES-GCM key using your local private key and the contact's public key. Encrypt the plain text message and send the ciphertext + `iv`.
- **Receiving Messages**: Derive the shared key using your local private key and the sender's public key (stored in Contacts). Decrypt the incoming ciphertext, then pass the plaintext to `DB.addMessage` (which will encrypt it again for local storage).

## Verification & Testing
1. **Registration**: Verify IndexedDB stores the encrypted private key and a salt.
2. **Local Storage**: Inspect IndexedDB messages store to ensure `msg` strings are base64 ciphertexts.
3. **P2P Communication**: Setup two nodes, perform the handshake, and verify messages are readable in the UI but encrypted in the network payloads (inspect via console logs).
4. **Synchronization**: Ensure `SYNC_DATA` logic continues to work (it transfers locally encrypted DB blobs, which can be decrypted because both devices share the same master password).
