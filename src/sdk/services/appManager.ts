import { DB } from './db.ts';
import { PeerService } from './peer.ts';
import { BitMsgAuth } from './auth.ts';

export interface PublishedApp {
    appId: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    developerId: string;
    repoId: string;
    releaseBranch: string;
    updatedAt: number;
}

export interface InstalledApp {
    appId: string;
    installedAt: number;
    lastRunAt?: number;
    autoUpdate: boolean;
}

export async function getRepoFilesMap(repoId: string, branchName: string = 'main'): Promise<Map<string, string>> {
    const fileMap = new Map<string, string>();
    const branch = await DB.getBranch(repoId, branchName);
    if (!branch) return fileMap;

    const commitObj = await DB.getDriveObject(branch.headCommitId);
    if (!commitObj || commitObj.type !== 'commit') return fileMap;

    const commit = JSON.parse(commitObj.content);
    const rootTreeHash = commit.rootTree;

    const traverse = async (treeHash: string, currentPath: string) => {
        const treeObj = await DB.getDriveObject(treeHash);
        if (!treeObj || treeObj.type !== 'tree') return;
        const entries = JSON.parse(treeObj.content);
        for (const entry of entries) {
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            if (entry.type === 'blob') {
                fileMap.set(entryPath, entry.hash);
            } else if (entry.type === 'tree') {
                await traverse(entry.hash, entryPath);
            }
        }
    };

    await traverse(rootTreeHash, '');
    return fileMap;
}

export const AppManager = {
    // 1. Publish or update an application
    async publicarApp(repoId: string, releaseBranch: string = 'main'): Promise<PublishedApp> {
        const fileMap = await getRepoFilesMap(repoId, releaseBranch);
        const bitappHash = fileMap.get('.bitapp');
        if (!bitappHash) {
            throw new Error('No se encontró el archivo .bitapp en la raíz de la rama de release.');
        }

        const bitappObj = await DB.getDriveObject(bitappHash);
        if (!bitappObj) {
            throw new Error('Error al cargar el archivo .bitapp del repositorio.');
        }

        const manifest = JSON.parse(bitappObj.content);
        if (!manifest.appId || !manifest.name) {
            throw new Error('El archivo .bitapp es inválido (debe contener appId y name).');
        }

        const misCreds = await BitMsgAuth.obtenerMisCredenciales();
        if (!misCreds) {
            throw new Error('No se encontraron credenciales locales de identidad.');
        }

        const app: PublishedApp = {
            appId: manifest.appId,
            name: manifest.name,
            description: manifest.description || '',
            icon: manifest.icon || '📱',
            version: manifest.version || '1.0.0',
            developerId: misCreds.idPublico,
            repoId,
            releaseBranch,
            updatedAt: Date.now()
        };

        // Save to local registry
        await DB.savePublishedApp(app);

        // Broadcast to all connected peers
        if (PeerService.peer) {
            const connections = Object.values(PeerService.deviceConns || {});
            for (const conn of connections) {
                if (conn.open) {
                    conn.send({
                        tipo: 'APP_PUBLISH_BROADCAST',
                        app
                    });
                }
            }
        }

        return app;
    },

    // 2. Query apps registry from peers
    async buscarAppsEnRed(): Promise<void> {
        if (!PeerService.peer) return;
        const connections = Object.values(PeerService.deviceConns || {});
        for (const conn of connections) {
            if (conn.open) {
                conn.send({
                    tipo: 'APP_QUERY_REQUEST'
                });
            }
        }
    },

    // 3. Compile and Inline application source for execution in iframe
    async prepararAppSource(repoId: string, releaseBranch: string = 'main'): Promise<{ html: string, appId: string }> {
        const fileMap = await getRepoFilesMap(repoId, releaseBranch);
        const bitappHash = fileMap.get('.bitapp');
        if (!bitappHash) {
            throw new Error('Archivo .bitapp no encontrado.');
        }

        const bitappObj = await DB.getDriveObject(bitappHash);
        if (!bitappObj) {
            throw new Error('Error al leer el archivo .bitapp.');
        }

        const manifest = JSON.parse(bitappObj.content);
        const appId = manifest.appId;
        const allowedFiles = new Set<string>(manifest.files || []);

        const indexHash = fileMap.get('index.html');
        if (!indexHash) {
            throw new Error('index.html no encontrado en el repositorio de la aplicación.');
        }

        const indexObj = await DB.getDriveObject(indexHash);
        if (!indexObj) {
            throw new Error('Error al cargar index.html.');
        }

        let html = indexObj.content;

        // Inline Stylesheets
        const cssRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = cssRegex.exec(html)) !== null) {
            const cssPath = match[1];
            if (allowedFiles.has(cssPath) && fileMap.has(cssPath)) {
                const cssObj = await DB.getDriveObject(fileMap.get(cssPath)!);
                if (cssObj) {
                    const tag = `<style>${cssObj.content}</style>`;
                    html = html.replace(match[0], tag);
                }
            }
        }

        // Inline Scripts
        const scriptRegex = /<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
        while ((match = scriptRegex.exec(html)) !== null) {
            const scriptPath = match[1];
            if (allowedFiles.has(scriptPath) && fileMap.has(scriptPath)) {
                const scriptObj = await DB.getDriveObject(fileMap.get(scriptPath)!);
                if (scriptObj) {
                    const tag = `<script>${scriptObj.content}</script>`;
                    html = html.replace(match[0], tag);
                }
            }
        }

        // Inline Images as Data URLs
        const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
        while ((match = imgRegex.exec(html)) !== null) {
            const imgPath = match[1];
            if (allowedFiles.has(imgPath) && fileMap.has(imgPath)) {
                const imgObj = await DB.getDriveObject(fileMap.get(imgPath)!);
                if (imgObj) {
                    const mime = getMimeType(imgPath);
                    // Check if content is already base64 or plaintext
                    const isBase64 = /^[a-zA-Z0-9+/=]+$/.test(imgObj.content.substring(0, 100).replace(/\s/g, ''));
                    const base64Content = isBase64 ? imgObj.content : btoa(imgObj.content);
                    const tag = match[0].replace(imgPath, `data:${mime};base64,${base64Content}`);
                    html = html.replace(match[0], tag);
                }
            }
        }

        // Inject the postMessage micro-SDK at the beginning of head or html
        const sdkScript = `
        <script>
            window.bitDb = {
                _pending: new Map(),
                init(appId) {
                    this.appId = appId;
                    window.addEventListener('message', (e) => {
                        const { type, reqId, result, error } = e.data;
                        if (type === 'BITDB_RESP' && this._pending.has(reqId)) {
                            const { resolve, reject } = this._pending.get(reqId);
                            this._pending.delete(reqId);
                            if (error) reject(new Error(error));
                            else resolve(result);
                        }
                    });
                },
                send(action, key, value) {
                    return new Promise((resolve, reject) => {
                        const reqId = crypto.randomUUID();
                        this._pending.set(reqId, { resolve, reject });
                        window.parent.postMessage({
                            type: 'BITDB_REQ',
                            appId: this.appId,
                            reqId,
                            action,
                            key,
                            value
                        }, '*');
                    });
                },
                get(key) { return this.send('GET', key); },
                put(key, val) { return this.send('PUT', key, val); },
                delete(key) { return this.send('DELETE', key); }
            };
            window.bitDb.init("${appId}");
        </script>
        `;

        if (html.includes('<head>')) {
            html = html.replace('<head>', `<head>${sdkScript}`);
        } else {
            html = sdkScript + html;
        }

        return { html, appId };
    },

    // 4. Start listening to postMessage events from the Sandboxed apps
    iniciarAppMessageBroker() {
        window.addEventListener('message', async (event) => {
            const request = event.data;
            if (!request || request.type !== 'BITDB_REQ') return;

            const { appId, reqId, action, key, value } = request;
            if (!appId || !reqId) return;

            // Optional Security: verify origin is opaco / unique
            // Because sandboxed iframe has unique origin, event.origin will be "null", which is expected.

            try {
                let result;
                switch (action) {
                    case 'PUT':
                        await DB.saveAppStorageEntry(appId, key, value);
                        result = { success: true };
                        break;
                    case 'GET':
                        result = await DB.getAppStorageEntry(appId, key);
                        break;
                    case 'DELETE':
                        await DB.deleteAppStorageEntry(appId, key);
                        result = { success: true };
                        break;
                    default:
                        throw new Error(`Acción ${action} no soportada.`);
                }

                // Send response back to the iframe
                if (event.source) {
                    (event.source as WindowProxy).postMessage({
                        type: 'BITDB_RESP',
                        reqId,
                        result
                    }, '*');
                }
            } catch (err: any) {
                if (event.source) {
                    (event.source as WindowProxy).postMessage({
                        type: 'BITDB_RESP',
                        reqId,
                        error: err.message || err
                    }, '*');
                }
            }
        });
    }
};

function getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'svg': return 'image/svg+xml';
        case 'json': return 'application/json';
        default: return 'application/octet-stream';
    }
}
