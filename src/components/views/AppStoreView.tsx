import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { AppManager, DB, PeerService, PublishedApp } from '../../sdk/index.ts';
import { Repository, Branch, DriveObject } from '../../sdk/models/drive.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

interface LocalInstalledApp {
    appId: string;
    installedAt: number;
    lastRunAt?: number;
    autoUpdate: boolean;
}

export const AppStoreView: React.FC = () => {
    const { devices } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [apps, setApps] = useState<PublishedApp[]>([]);
    const [installedApps, setInstalledApps] = useState<LocalInstalledApp[]>([]);
    const [activeTab, setActiveTab] = useState<'store' | 'myapps'>('store');
    
    // Running app state
    const [runningApp, setRunningApp] = useState<PublishedApp | null>(null);
    const [runningHtml, setRunningHtml] = useState<string>('');
    const [isRunning, setIsRunning] = useState(false);
    
    // Details Modal
    const [selectedApp, setSelectedApp] = useState<PublishedApp | null>(null);
    const [isInstalling, setIsInstalling] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');

    useEffect(() => {
        loadApps();
        // Automatically look up apps from peers on launch
        AppManager.buscarAppsEnRed();
        
        // Listen to database refreshes from network broadcasts
        const interval = setInterval(loadApps, 3000);
        return () => clearInterval(interval);
    }, []);

    const loadApps = async () => {
        const published = await DB.getPublishedApps();
        const installed = await DB.getInstalledApps();
        setApps(published);
        setInstalledApps(installed);
    };

    const getConnForDeveloper = (devId: string) => {
        // 1. Try personal devices
        for (const d of devices) {
            if (d.idPublico === devId) {
                const conn = PeerService.deviceConns ? PeerService.deviceConns[d.deviceId] : undefined;
                if (conn && conn.open) return conn;
            }
        }
        // 2. Try direct P2P connections to contacts
        const direct = PeerService.conexionesP2PDirectas[devId];
        if (direct && direct.conn && direct.conn.open) {
            return direct.conn;
        }
        // 3. Fallback: try any active connection whose peer contains the devId
        const fallback = Object.values(PeerService.conexionesP2PDirectas)
            .map(c => c.conn)
            .find(c => c && c.open && c.peer.includes(devId.substring(0, 8)));
        if (fallback) return fallback;

        return null;
    };

    const handleInstallApp = async (app: PublishedApp) => {
        setIsInstalling(true);
        setStatusMsg('Conectando con el desarrollador...');

        // Check if repository already exists locally (e.g., self-developed)
        const localRepo = await DB.getRepository(app.repoId);
        if (localRepo) {
            setStatusMsg('Repositorio local encontrado. Instalando...');
            await DB.saveInstalledApp({
                appId: app.appId,
                installedAt: Date.now(),
                autoUpdate: true
            });
            await loadApps();
            setIsInstalling(false);
            setStatusMsg('');
            return;
        }

        const conn = getConnForDeveloper(app.developerId);
        if (!conn || !conn.open) {
            setIsInstalling(false);
            setStatusMsg('');
            alert('No se pudo establecer una conexión P2P activa con el desarrollador para descargar la aplicación. Asegúrate de estar conectado con él.');
            return;
        }

        try {
            setStatusMsg('Clonando repositorio de la aplicación...');
            const data = await PeerService.request<{
                repo: Repository;
                branches: Branch[];
                objects: DriveObject[];
            }>(conn, 'DRIVE_CLONE_REQ', { repoId: app.repoId });

            if (!data || !data.repo) {
                throw new Error('Respuesta de clonación inválida.');
            }

            setStatusMsg('Guardando objetos en IndexedDB...');
            for (const obj of data.objects) {
                await DB.saveDriveObject(obj);
            }
            for (const b of data.branches) {
                await DB.saveBranch(b);
            }
            await DB.saveRepository(data.repo);

            await DB.saveInstalledApp({
                appId: app.appId,
                installedAt: Date.now(),
                autoUpdate: true
            });

            await loadApps();
            setStatusMsg('');
            setIsInstalling(false);
            setSelectedApp(null);
        } catch (e: any) {
            alert(e.message || 'Error al clonar e instalar.');
            setIsInstalling(false);
            setStatusMsg('');
        }
    };

    const handleUpdateApp = async (app: PublishedApp) => {
        setIsInstalling(true);
        setStatusMsg('Conectando con el desarrollador...');
        const conn = getConnForDeveloper(app.developerId);
        if (!conn || !conn.open) {
            setIsInstalling(false);
            setStatusMsg('');
            alert('No se pudo conectar con el desarrollador para descargar la actualización.');
            return;
        }

        try {
            setStatusMsg('Descargando cambios delta...');
            const data = await PeerService.request<{
                branches: Branch[];
                objects: DriveObject[];
            }>(conn, 'DRIVE_PULL_REQ', { repoId: app.repoId });

            if (data && Array.isArray(data.objects)) {
                setStatusMsg('Aplicando actualizaciones...');
                for (const obj of data.objects) {
                    await DB.saveDriveObject(obj);
                }
                for (const b of data.branches) {
                    await DB.saveBranch(b);
                }
            }

            // Update app details in catalog
            await DB.savePublishedApp(app);
            await loadApps();
            setIsInstalling(false);
            setStatusMsg('');
            alert(`¡La aplicación ${app.name} se ha actualizado a la versión ${app.version}!`);
        } catch (e: any) {
            alert(e.message || 'Error al actualizar.');
            setIsInstalling(false);
            setStatusMsg('');
        }
    };

    const handleUninstallApp = async (app: PublishedApp) => {
        if (confirm(`¿Estás seguro de que deseas desinstalar ${app.name}? Esto eliminará los archivos pero conservará tu base de datos aislada.`)) {
            await DB.deleteInstalledApp(app.appId);
            await loadApps();
            setSelectedApp(null);
        }
    };

    const handleRunApp = async (app: PublishedApp) => {
        try {
            const { html } = await AppManager.prepararAppSource(app.repoId, app.releaseBranch || 'main');
            setRunningHtml(html);
            setRunningApp(app);
            setIsRunning(true);
            setSelectedApp(null);
            
            // Update last run timestamp
            const inst = installedApps.find(ia => ia.appId === app.appId);
            if (inst) {
                await DB.saveInstalledApp({
                    ...inst,
                    lastRunAt: Date.now()
                });
                loadApps();
            }
        } catch (e: any) {
            alert(e.message || 'Error al compilar y ejecutar la aplicación.');
        }
    };

    const filteredApps = apps.filter(app => 
        app.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        app.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getAppStatus = (appId: string) => {
        const inst = installedApps.find(ia => ia.appId === appId);
        if (inst) {
            return 'installed';
        }
        return 'not_installed';
    };

    if (isRunning && runningApp) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', backgroundColor: 'var(--bg)' }}>
                <div 
                    style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '10px 20px', 
                        borderBottom: '1px solid var(--border)',
                        backgroundColor: 'var(--bg-card)'
                    }}
                >
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <span style={{ fontSize: '24px' }}>{runningApp.icon}</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '15px' }}>{runningApp.name}</h3>
                            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Versión {runningApp.version} • Sandbox Seguro</span>
                        </div>
                    </div>
                    <Button variant="ghost" style={{ color: '#e74c3c' }} onClick={() => { setIsRunning(false); setRunningApp(null); setRunningHtml(''); }}>
                        ✕ Cerrar Aplicación
                    </Button>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                    <iframe 
                        srcDoc={runningHtml} 
                        sandbox="allow-scripts" 
                        style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#ffffff' }}
                        title={runningApp.name}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="view-content" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ color: 'var(--primary)', margin: 0 }}>Tienda de Aplicaciones bitApp</h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: '13px', margin: 0 }}>Descubre y ejecuta aplicaciones descentralizadas en tu terminal</p>
                </div>
                <div style={{ display: 'flex', gap: '5px', backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '8px' }}>
                    <button 
                        onClick={() => setActiveTab('store')}
                        style={{ 
                            padding: '6px 12px', 
                            borderRadius: '6px', 
                            border: 'none', 
                            cursor: 'pointer', 
                            fontSize: '13px',
                            color: activeTab === 'store' ? '#fff' : 'var(--text-dim)',
                            backgroundColor: activeTab === 'store' ? 'var(--primary)' : 'transparent',
                            transition: 'all 0.2s'
                        }}
                    >
                        🏪 Catálogo
                    </button>
                    <button 
                        onClick={() => setActiveTab('myapps')}
                        style={{ 
                            padding: '6px 12px', 
                            borderRadius: '6px', 
                            border: 'none', 
                            cursor: 'pointer', 
                            fontSize: '13px',
                            color: activeTab === 'myapps' ? '#fff' : 'var(--text-dim)',
                            backgroundColor: activeTab === 'myapps' ? 'var(--primary)' : 'transparent',
                            transition: 'all 0.2s'
                        }}
                    >
                        ⚡ Mis Aplicaciones
                    </button>
                </div>
            </div>

            {activeTab === 'store' ? (
                <>
                    <Input 
                        placeholder="Buscar aplicaciones..." 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                    />
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
                        {filteredApps.length === 0 ? (
                            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '50px', color: 'var(--text-dim)' }}>
                                No se encontraron aplicaciones en tu catálogo local.
                            </div>
                        ) : (
                            filteredApps.map((app) => {
                                const status = getAppStatus(app.appId);
                                return (
                                    <Card 
                                        key={app.appId} 
                                        onClick={() => setSelectedApp(app)}
                                        style={{ 
                                            padding: '15px', 
                                            cursor: 'pointer', 
                                            transition: 'transform 0.2s', 
                                            display: 'flex', 
                                            gap: '15px', 
                                            alignItems: 'center'
                                        }}
                                    >
                                        <span style={{ fontSize: '40px' }}>{app.icon}</span>
                                        <div style={{ flex: 1, overflow: 'hidden' }}>
                                            <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{app.name}</h4>
                                            <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--text-dim)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                {app.description || 'Sin descripción disponible.'}
                                            </p>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>v{app.version}</span>
                                                {status === 'installed' ? (
                                                    <span style={{ fontSize: '11px', color: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>Instalada</span>
                                                ) : (
                                                    <span style={{ fontSize: '11px', color: 'var(--primary)', backgroundColor: 'rgba(54, 162, 235, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>Disponible</span>
                                                )}
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })
                        )}
                    </div>
                </>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
                    {installedApps.length === 0 ? (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '50px', color: 'var(--text-dim)' }}>
                            No tienes ninguna aplicación instalada todavía. ¡Ve al catálogo para instalar algunas!
                        </div>
                    ) : (
                        installedApps.map((ia) => {
                            const app = apps.find(a => a.appId === ia.appId);
                            if (!app) return null;
                            return (
                                <Card 
                                    key={ia.appId}
                                    style={{ 
                                        padding: '20px', 
                                        display: 'flex', 
                                        flexDirection: 'column', 
                                        alignItems: 'center', 
                                        textAlign: 'center', 
                                        gap: '12px' 
                                    }}
                                >
                                    <span style={{ fontSize: '50px' }}>{app.icon}</span>
                                    <div>
                                        <h4 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{app.name}</h4>
                                        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>v{app.version}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', width: '100%', marginTop: '10px' }}>
                                        <Button variant="ghost" style={{ flex: 1, color: '#e74c3c' }} onClick={() => handleUninstallApp(app)}>
                                            Borrar
                                        </Button>
                                        <Button style={{ flex: 2 }} onClick={() => handleRunApp(app)}>
                                            ▶️ Abrir App
                                        </Button>
                                    </div>
                                </Card>
                            );
                        })
                    )}
                </div>
            )}

            <Modal 
                active={!!selectedApp} 
                title={selectedApp ? `${selectedApp.icon} ${selectedApp.name}` : ''} 
                onClose={() => setSelectedApp(null)}
            >
                {selectedApp && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {statusMsg && (
                            <div style={{ padding: '10px', backgroundColor: 'rgba(52, 152, 219, 0.2)', border: '1px solid #3498db', borderRadius: '4px', color: '#3498db', fontSize: '13px', textAlign: 'center' }}>
                                🌀 {statusMsg}
                            </div>
                        )}
                        <div>
                            <p style={{ margin: '0 0 5px 0', color: 'var(--text-dim)', fontSize: '12px' }}>Descripción:</p>
                            <p style={{ margin: 0, fontSize: '14px' }}>{selectedApp.description || 'Sin descripción.'}</p>
                        </div>
                        <div style={{ display: 'flex', gap: '20px' }}>
                            <div>
                                <p style={{ margin: '0 0 2px 0', color: 'var(--text-dim)', fontSize: '12px' }}>Versión:</p>
                                <strong style={{ fontSize: '13px' }}>{selectedApp.version}</strong>
                            </div>
                            <div>
                                <p style={{ margin: '0 0 2px 0', color: 'var(--text-dim)', fontSize: '12px' }}>Desarrollador:</p>
                                <strong style={{ fontSize: '13px' }}>{selectedApp.developerId.substring(0, 12)}...</strong>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                            <Button variant="ghost" style={{ flex: 1 }} onClick={() => setSelectedApp(null)} disabled={isInstalling}>
                                Cerrar
                            </Button>
                            {getAppStatus(selectedApp.appId) === 'installed' ? (
                                <div style={{ display: 'flex', gap: '10px', flex: 2 }}>
                                    <Button variant="ghost" style={{ flex: 1 }} onClick={() => handleUninstallApp(selectedApp)} disabled={isInstalling}>
                                        Desinstalar
                                    </Button>
                                    <Button style={{ flex: 1 }} onClick={() => handleRunApp(selectedApp)} disabled={isInstalling}>
                                        ▶️ Lanzar
                                    </Button>
                                </div>
                            ) : (
                                <Button style={{ flex: 2 }} onClick={() => handleInstallApp(selectedApp)} disabled={isInstalling}>
                                    📥 Descargar e Instalar
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};
