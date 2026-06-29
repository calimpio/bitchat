import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { AppManager, DB, PublishedApp } from '../../sdk/index.ts';
import { Repository } from '../../sdk/models/drive.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

export const AppConsoleView: React.FC = () => {
    const { me } = useStore();
    const [devName, setDevName] = useState('');
    const [isRegistered, setIsRegistered] = useState(false);
    const [repositories, setRepositories] = useState<Repository[]>([]);
    const [myApps, setMyApps] = useState<PublishedApp[]>([]);
    
    // Create / Edit modal state
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedRepoId, setSelectedRepoId] = useState('');
    const [releaseBranch, setReleaseBranch] = useState('main');
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    useEffect(() => {
        loadDeveloperProfile();
        loadRepositories();
    }, []);

    const loadDeveloperProfile = async () => {
        const savedDevName = localStorage.getItem('bit_developer_name');
        if (savedDevName) {
            setDevName(savedDevName);
            setIsRegistered(true);
            await loadMyApps(savedDevName);
        }
    };

    const loadRepositories = async () => {
        const repos = await DB.getRepositories();
        setRepositories(repos);
        if (repos.length > 0) {
            setSelectedRepoId(repos[0].repoId);
        }
    };

    const loadMyApps = async (developerName: string) => {
        if (!me) return;
        const allApps = await DB.getPublishedApps();
        // Filter apps published by this developer
        const filtered = allApps.filter(app => app.developerId === me.idPublico);
        setMyApps(filtered);
    };

    const handleRegister = () => {
        if (!devName.trim()) return;
        localStorage.setItem('bit_developer_name', devName.trim());
        setIsRegistered(true);
        loadMyApps(devName.trim());
    };

    const handlePublishApp = async () => {
        if (!selectedRepoId) {
            setErrorMsg('Por favor selecciona un repositorio.');
            return;
        }

        try {
            setErrorMsg('');
            setSuccessMsg('');
            const app = await AppManager.publicarApp(selectedRepoId, releaseBranch);
            setSuccessMsg(`¡Aplicación "${app.name}" publicada con éxito! Versión: ${app.version}`);
            setShowCreateModal(false);
            if (devName) {
                await loadMyApps(devName);
            }
        } catch (e: any) {
            setErrorMsg(e.message || 'Error al publicar la aplicación.');
        }
    };

    const handleUnpublish = async (appId: string) => {
        if (confirm('¿Estás seguro de que deseas retirar esta aplicación del catálogo local?')) {
            await DB.deletePublishedApp(appId);
            if (devName) {
                await loadMyApps(devName);
            }
        }
    };

    if (!isRegistered) {
        return (
            <div className="view-content" style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
                <Card style={{ padding: '30px', textAlign: 'center' }}>
                    <h2 style={{ color: 'var(--primary)', marginBottom: '10px' }}>Consola de Desarrolladores bitApp</h2>
                    <p style={{ color: 'var(--text-dim)', marginBottom: '20px', fontSize: '14px' }}>
                        Regístrate como desarrollador para comenzar a crear y distribuir tus aplicaciones descentralizadas en la red de bitOS.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'stretch' }}>
                        <Input 
                            placeholder="Nombre del Desarrollador / Organización" 
                            value={devName} 
                            onChange={(e) => setDevName(e.target.value)} 
                        />
                        <Button onClick={handleRegister} disabled={!devName.trim()}>
                            Crear Perfil de Desarrollador
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="view-content" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ color: 'var(--primary)', margin: 0 }}>Consola de Desarrollador</h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: '13px', margin: 0 }}>Desarrollador: <strong>{devName}</strong></p>
                </div>
                <Button onClick={() => { setErrorMsg(''); setSuccessMsg(''); setShowCreateModal(true); }}>
                    ➕ Distribuir Aplicación
                </Button>
            </div>

            {successMsg && (
                <div style={{ padding: '10px 15px', backgroundColor: 'rgba(46, 204, 113, 0.2)', border: '1px solid #2ecc71', borderRadius: '6px', color: '#2ecc71', fontSize: '14px' }}>
                    {successMsg}
                </div>
            )}

            <Card style={{ padding: '20px' }}>
                <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Mis Aplicaciones Publicadas</h3>
                {myApps.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)', fontSize: '14px' }}>
                        No has publicado ninguna aplicación todavía. ¡Vincula un repositorio de bitDrive para empezar!
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {myApps.map((app) => (
                            <div 
                                key={app.appId} 
                                style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center', 
                                    padding: '12px 15px', 
                                    border: '1px solid var(--border)', 
                                    borderRadius: '8px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.02)'
                                }}
                            >
                                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                    <span style={{ fontSize: '32px' }}>{app.icon}</span>
                                    <div>
                                        <h4 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{app.name}</h4>
                                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-dim)' }}>
                                            Versión: <strong>{app.version}</strong> | Rama: <code>{app.releaseBranch}</code>
                                        </p>
                                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-dim)' }}>
                                            ID Repo: <code>{app.repoId}</code>
                                        </p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <Button 
                                        variant="ghost" 
                                        style={{ color: '#e74c3c' }} 
                                        onClick={() => handleUnpublish(app.appId)}
                                    >
                                        Retirar
                                    </Button>
                                    <Button 
                                        onClick={async () => {
                                            try {
                                                setErrorMsg('');
                                                setSuccessMsg('');
                                                const updated = await AppManager.publicarApp(app.repoId, app.releaseBranch);
                                                setSuccessMsg(`¡Aplicación "${updated.name}" actualizada con éxito a la versión: ${updated.version}!`);
                                                if (devName) {
                                                    await loadMyApps(devName);
                                                }
                                            } catch (err: any) {
                                                alert(err.message || 'Error al actualizar.');
                                            }
                                        }}
                                    >
                                        🔄 Actualizar Cambios
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Modal 
                active={showCreateModal} 
                title="Distribuir Nueva Aplicación" 
                onClose={() => setShowCreateModal(false)}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {errorMsg && (
                        <div style={{ padding: '10px', backgroundColor: 'rgba(231, 76, 60, 0.2)', border: '1px solid #e74c3c', borderRadius: '4px', color: '#e74c3c', fontSize: '13px' }}>
                            {errorMsg}
                        </div>
                    )}
                    <div>
                        <label style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '5px', display: 'block' }}>
                            Repositorio de bitDrive Vinculado:
                        </label>
                        {repositories.length === 0 ? (
                            <div style={{ fontSize: '13px', color: '#e74c3c' }}>
                                No tienes repositorios de bitDrive locales. Inicializa uno primero desde bitDrive o bitcli.
                            </div>
                        ) : (
                            <select 
                                value={selectedRepoId} 
                                onChange={(e) => setSelectedRepoId(e.target.value)}
                                style={{ 
                                    width: '100%', 
                                    padding: '10px', 
                                    backgroundColor: 'var(--bg-card)', 
                                    color: 'var(--text)', 
                                    border: '1px solid var(--border)', 
                                    borderRadius: '6px',
                                    outline: 'none'
                                }}
                            >
                                {repositories.map((repo) => (
                                    <option key={repo.repoId} value={repo.repoId}>{repo.name} ({repo.repoId.substring(0, 8)})</option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div>
                        <label style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '5px', display: 'block' }}>
                            Rama de Release:
                        </label>
                        <Input 
                            value={releaseBranch} 
                            onChange={(e) => setReleaseBranch(e.target.value)} 
                            placeholder="Ej: main"
                        />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)', backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                        ℹ️ <strong>Requerimiento:</strong> Asegúrate de que el repositorio seleccionado contenga un archivo <code>.bitapp</code> en la raíz de la rama de release especificada que declare la metadata y el listado de archivos.
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <Button variant="ghost" style={{ flex: 1 }} onClick={() => setShowCreateModal(false)}>Cancelar</Button>
                        <Button style={{ flex: 1 }} onClick={handlePublishApp} disabled={repositories.length === 0}>
                            Publicar App
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
