import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { DB, PeerService, CryptoService } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

export const SettingsView: React.FC = () => {
    const { me, setPantalla, setActiveApp, setShowSidebar, sessionSecurityMode, sessionTimeoutDuration, setSessionSecurityMode, setSessionTimeoutDuration } = useStore();
    const [blacklist, setBlacklist] = useState<string[]>([]);
    const [myFingerprint, setMyFingerprint] = useState('');
    const [syncPass, setSyncPass] = useState('');

    useEffect(() => {
        DB.getBlacklist().then(setBlacklist);
        if (me?.publicKey) {
            CryptoService.getFingerprint(me.publicKey).then(setMyFingerprint);
        }
    }, [me]);

    const handleUnblock = async (id: string) => {
        await DB.unblock(id);
        DB.getBlacklist().then(setBlacklist);
    };

    const handleSync = async () => {
        if (!syncPass) return alert("Falta contraseña");
        await PeerService.iniciarSincronizacion(syncPass);
    };

    const handleClearData = async () => {
        if (confirm("Se borrarán mensajes y contactos. ¿Continuar?")) {
            if (DB.db) DB.db.close();
            indexedDB.deleteDatabase('bitchat_db');
            const req = indexedDB.deleteDatabase('bitmsg_db');
            req.onsuccess = () => { localStorage.clear(); location.reload(); };
        }
    };

    return (
        <div className="settings-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
            <h2 style={{ color: 'var(--primary)', textAlign: 'center', marginBottom: '10px' }}>bitOS Settings</h2>
            <Card style={{ padding: '20px', flexShrink: '0' }}>
                <h4 style={{ marginBottom: '10px', color: 'var(--accent-blue)' }}>Dispositivo</h4>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', fontSize: '13px' }}>
                    <p>ID Público: {me?.idPublico}</p>
                    <p>Nickname: @{me?.idPrivado}</p>
                    <p style={{ color: 'var(--accent-blue)', marginTop: '5px' }}>Huella: {myFingerprint}</p>
                </div>
            </Card>
            <Card style={{ padding: '20px', flexShrink: '0' }}>
                <h4 style={{ marginBottom: '10px', color: 'var(--primary)' }}>Lista Negra</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '10px' }}>Números bloqueados que no pueden enviarte solicitudes.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {blacklist.length > 0 ? blacklist.map(id => (
                        <div key={id} className="request-card" style={{ padding: '8px', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', display: 'flex' }}>
                            <span style={{ fontSize: '13px' }}>{id}</span>
                            <Button variant="ghost" className="btn-sm" onClick={() => handleUnblock(id)}>Desbloquear</Button>
                        </div>
                    )) : (
                        <p style={{ fontSize: '12px', color: 'var(--text-dim)', fontStyle: 'italic' }}>Ningún número bloqueado</p>
                    )}
                </div>
            </Card>
            <Card style={{ padding: '20px', flexShrink: '0' }}>
                <h4 style={{ marginBottom: '10px', color: 'var(--success)' }}>Diagnóstico de Red</h4>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}>
                    <p style={{ color: 'var(--text-dim)', marginBottom: '5px' }}>Peer ID (Ofuscado):</p>
                    <p style={{ wordBreak: 'break-all' }}>{PeerService.peer?.id || 'Generando...'}</p>
                </div>
            </Card>
            <Card style={{ padding: '20px', flexShrink: '0' }}>
                <h4 style={{ marginBottom: '10px', color: 'var(--accent-blue)' }}>Seguridad de la Sesión</h4>
                <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                    Controla cuándo debe bloquearse automáticamente tu terminal para proteger tu clave criptográfica en memoria.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Modo de Bloqueo:</span>
                        <select 
                            value={sessionSecurityMode} 
                            onChange={(e) => setSessionSecurityMode(e.target.value as any)}
                            style={{ background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="always_active">Mantener sesión siempre activa (Menos seguro)</option>
                            <option value="inactivity_timeout">Bloqueo por inactividad</option>
                            <option value="absolute_timeout">Bloqueo tras tiempo fijo (Absoluto)</option>
                        </select>
                    </div>

                    {sessionSecurityMode !== 'always_active' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Tiempo de Expiración:</span>
                            <select 
                                value={sessionTimeoutDuration} 
                                onChange={(e) => setSessionTimeoutDuration(parseInt(e.target.value, 10))}
                                style={{ background: 'var(--input-bg)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', outline: 'none', cursor: 'pointer' }}
                            >
                                <option value="1">1 Minuto</option>
                                <option value="5">5 Minutos</option>
                                <option value="15">15 Minutos</option>
                                <option value="30">30 Minutos</option>
                                <option value="60">1 Hora (60 Minutos)</option>
                                <option value="120">2 Horas (120 Minutos)</option>
                            </select>
                        </div>
                    )}
                </div>
            </Card>
            <Card style={{ padding: '20px', flexShrink: '0' }}>
                <h4 style={{ marginBottom: '10px', color: 'var(--primary)' }}>Seguridad</h4>
                <Button variant="primary" onClick={handleClearData}>Borrar Datos Locales</Button>
            </Card>
        </div>
    );
};