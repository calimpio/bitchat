import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { PeerService, DB, CryptoService } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Device } from '../../sdk/models/types.ts';

export const DevicesView: React.FC = () => {
    const { me, devices, setDevices } = useStore();
    const [isSearching, setIsSearching] = useState(false);
    const [searchTimeLeft, setSearchTimeLeft] = useState(0);

    const [activeTab, setActiveTab] = useState<'list' | 'keyAccess'>('list');
    const [accessCode, setAccessCode] = useState('');
    const [isLinking, setIsLinking] = useState(false);
    const [linkStatus, setLinkStatus] = useState('');


    const refreshDevices = async () => {
        const storedDevices = await DB.getDevices();
        const localDeviceId = localStorage.getItem('bit_device_id') || 'local';
        
        const currentDevices: Device[] = [
            {
                deviceId: localDeviceId,
                idPublico: me?.idPublico || '...',
                label: 'Este Dispositivo (Principal)',
                isOnline: PeerService.peer?.open || false,
                lastSeen: Date.now(),
                publicKey: me?.publicKey,
                accountCreatedAt: me?.createdAt
            },
            ...storedDevices.map((d: any) => {
                const connDirecta = Object.values(PeerService.conexionesP2PDirectas).find(c => c.conn?.peer === d.peerId && c.conn?.open);
                if (connDirecta && connDirecta.conn && PeerService.deviceConns && !PeerService.deviceConns[d.deviceId]) {
                    PeerService.deviceConns[d.deviceId] = connDirecta.conn;
                }
                const connPersonal = PeerService.deviceConns && PeerService.deviceConns[d.deviceId];
                const isOnline = !!(connDirecta || (connPersonal && connPersonal.open));
                return {
                    ...d,
                    isOnline
                };
            })
        ];

        setDevices(currentDevices);
    };

    useEffect(() => {
        refreshDevices();
        const interval = setInterval(refreshDevices, 10000);
        PeerService.onRefresh = refreshDevices;
        return () => {
            clearInterval(interval);
            PeerService.onRefresh = null;
        };
    }, [me, setDevices]);

    useEffect(() => {
        let timer: number;
        let searchInterval: number;

        if (isSearching && searchTimeLeft > 0) {
            timer = setInterval(() => {
                setSearchTimeLeft(prev => prev - 1);
            }, 1000) as unknown as number;

            // Trigger active search every 10 seconds during the minute
            searchInterval = setInterval(() => {
                PeerService.buscarDispositivos(true);
            }, 10000) as unknown as number;
        } else if (searchTimeLeft === 0) {
            setIsSearching(false);
        }

        return () => {
            clearInterval(timer);
            clearInterval(searchInterval);
        };
    }, [isSearching, searchTimeLeft]);

    const handleSearch = () => {
        setIsSearching(true);
        setSearchTimeLeft(60);
        PeerService.buscarDispositivos(true);
    };

    const handleLinkDevice = async () => {
                if (!accessCode) return alert("Por favor introduce el código de acceso");
        
        const cleanInput = accessCode.trim().toUpperCase();
        const match = cleanInput.match(/^(?:BC-)?(\d{6})(?:-(\d{5}))?$/);
        if (!match) {
            return alert("Formato de código inválido. Debe ser de tipo BC-XXXXXX o BC-XXXXXX-PPPPP.");
        }
        
        const cleanCode = match[1];
        const port = match[2] ? parseInt(match[2], 10) : 18085;
        
        if (!me || !me.encryptedPrivateKey || !me.privateKeyIv) {
            return alert("No se pudo obtener las credenciales locales de este dispositivo.");
        }
        
        const aesKey = useStore.getState().aesKey;
        if (!aesKey) {
            return alert("La clave de sesión maestra no está en memoria. Vuelve a iniciar sesión.");
        }
        
        setIsLinking(true);
        setLinkStatus('Descifrando credenciales para vinculación segura...');
        
        try {
            const privateKeyStr = await CryptoService.decrypt(aesKey, me.encryptedPrivateKey, me.privateKeyIv);
            const privateKey = JSON.parse(privateKeyStr);
            
            setLinkStatus('Transmitiendo credenciales de forma segura al CLI local...');
            
            const response = await fetch(`http://127.0.0.1:${port}/link`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code: cleanCode,
                    idPublico: me.idPublico,
                    idPrivado: me.idPrivado,
                    publicKey: me.publicKey,
                    privateKey: privateKey
                })
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: 'Error de red o conexión rechazada.' }));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }
            
            const data = await response.json();
            if (data.status === 'SUCCESS') {
                console.log("[LINK] Vinculación exitosa por HTTP. Registrando dispositivo...");
                setLinkStatus('¡Terminal vinculada con éxito! Registrando dispositivo...');
                
                const newCliDevice: Device = {
                    deviceId: `bitCLI-${cleanCode}`,
                    idPublico: me.idPublico,
                    label: `bitCLI Terminal (${cleanCode})`,
                    isOnline: true,
                    lastSeen: Date.now(),
                    publicKey: me.publicKey,
                    accountCreatedAt: me.createdAt,
                    peerId: `bc-link-${cleanCode}`
                };
                await DB.addDevice(newCliDevice);
                
                setLinkStatus('¡Vinculación completada con éxito!');
                setIsLinking(false);
                setAccessCode('');
                alert('¡Vinculación de bitCLI exitosa!');
                setActiveTab('list');
                refreshDevices();
            } else {
                throw new Error(data.error || 'Respuesta de estado incorrecto del CLI.');
            }
            
        } catch (error: any) {
            console.error("[LINK] Excepción capturada en handleLinkDevice (HTTP):", error);
            setIsLinking(false);
            setLinkStatus(`Error: ${error.message || 'No se pudo conectar con el CLI local. Asegúrate de ejecutar `bitcli login` en tu terminal.'}`);
        }
    };

    const handleDeleteDevice = async (deviceId: string) => {
        if (confirm(`¿Desvincular dispositivo ${deviceId}? Dejará de recibir sincronizaciones.`)) {
            await DB.deleteDevice(deviceId);
            refreshDevices();
        }
    };

    return (
        <div className="devices-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ color: 'var(--primary)', margin: 0 }}>bitDevices</h2>
                {activeTab === 'list' && (
                    <Button 
                        variant={isSearching ? 'ghost' : 'success'} 
                        disabled={isSearching} 
                        onClick={handleSearch}
                        style={{ minWidth: '160px' }}
                    >
                        {isSearching ? `Buscando... (${searchTimeLeft}s)` : '🔍 Buscar Dispositivos'}
                    </Button>
                )}
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '10px' }}>
                <span 
                    style={{ 
                        cursor: 'pointer', 
                        fontWeight: 'bold', 
                        fontSize: '14px',
                        color: activeTab === 'list' ? 'var(--primary)' : 'var(--text-dim)',
                        borderBottom: activeTab === 'list' ? '2px solid var(--primary)' : 'none',
                        paddingBottom: '9px',
                        transition: 'all 0.3s'
                    }} 
                    onClick={() => setActiveTab('list')}
                >
                    Dispositivos Vinculados
                </span>
                <span 
                    style={{ 
                        cursor: 'pointer', 
                        fontWeight: 'bold', 
                        fontSize: '14px',
                        color: activeTab === 'keyAccess' ? 'var(--primary)' : 'var(--text-dim)',
                        borderBottom: activeTab === 'keyAccess' ? '2px solid var(--primary)' : 'none',
                        paddingBottom: '9px',
                        transition: 'all 0.3s'
                    }} 
                    onClick={() => setActiveTab('keyAccess')}
                >
                    🔑 Acceso por Llave
                </span>
            </div>
            
            {activeTab === 'list' ? (
                <>
                    <p style={{ color: 'var(--text-dim)', fontSize: '14px', textAlign: 'center', margin: '0 0 10px 0' }}>
                        Gestiona tus terminales vinculadas y su estado en la red.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {devices.map((device) => (
                            <Card key={device.deviceId} style={{ padding: '20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h4 style={{ color: 'var(--accent-blue)', marginBottom: '5px' }}>{device.label}</h4>
                                        <p style={{ fontSize: '12px', color: 'var(--text-dim)' }}>ID Dispositivo: {device.deviceId}</p>
                                        {device.accountCreatedAt && (
                                            <p style={{ fontSize: '11px', color: 'var(--accent-blue)', marginTop: '4px' }}>
                                                Cuenta creada el: {new Date(device.accountCreatedAt).toLocaleString()}
                                            </p>
                                        )}
                                        <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                                            Visto por última vez: {new Date(device.lastSeen).toLocaleString()}
                                        </p>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                            <div 
                                                style={{ 
                                                    width: '8px', 
                                                    height: '8px', 
                                                    borderRadius: '50%', 
                                                    background: device.isOnline ? 'var(--success)' : '#666',
                                                    boxShadow: device.isOnline ? '0 0 8px var(--success)' : 'none'
                                                }} 
                                            />
                                            <span style={{ fontSize: '12px', fontWeight: 'bold', color: device.isOnline ? 'var(--success)' : 'var(--text-dim)' }}>
                                                {device.isOnline ? 'ACTIVO' : 'DESCONECTADO'}
                                            </span>
                                        </div>
                                        {device.label !== 'Este Dispositivo (Principal)' && (
                                            <Button variant="ghost" className="btn-sm" style={{ color: 'var(--primary)' }} onClick={() => handleDeleteDevice(device.deviceId)}>Desvincular</Button>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>

                    {devices.length === 1 && (
                        <Card style={{ padding: '20px', borderStyle: 'dashed', background: 'transparent' }}>
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                                    No tienes otros dispositivos vinculados. Usa la opción "Acceso por Llave" para enlazar una nueva terminal CLI de forma segura.
                                </p>
                            </div>
                        </Card>
                    )}
                </>
            ) : (
                <Card style={{ padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <h4 style={{ color: 'var(--accent-blue)', marginBottom: '10px' }}>🔑 Vincular Dispositivo por Llave</h4>
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: '1.5' }}>
                            Este flujo te permite transferir tus claves criptográficas de forma segura a una terminal local (como <strong>bitCLI</strong>) mediante un canal P2P de un solo uso sin necesidad de revelar o copiar manualmente tu clave privada.
                        </p>
                    </div>

                    <div style={{ background: 'rgba(0, 150, 255, 0.1)', borderLeft: '3px solid var(--accent-blue)', padding: '12px 15px', borderRadius: '4px', fontSize: '12px', color: 'var(--text-main)' }}>
                        <strong>Instrucciones:</strong> Ejecuta <code>bitcli login</code> en tu terminal para obtener un código de vinculación. Ingrésalo a continuación.
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: 'bold' }}>Código de Acceso (ej: BC-123456-54321):</label>
                        <input 
                            type="text"
                            placeholder="BC-XXXXXX-PPPPP"
                            value={accessCode}
                            onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                            disabled={isLinking}
                            style={{
                                background: 'var(--input-bg)',
                                color: 'var(--text-main)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '12px 15px',
                                fontSize: '16px',
                                fontFamily: 'monospace',
                                letterSpacing: '2px',
                                outline: 'none',
                                textAlign: 'center',
                                width: '100%',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    <Button 
                        variant="primary" 
                        onClick={handleLinkDevice} 
                        disabled={isLinking || !accessCode}
                        style={{ width: '100%', padding: '12px', fontSize: '14px' }}
                    >
                        {isLinking ? '🔄 Vinculando dispositivo...' : '🚀 Vincular Terminal'}
                    </Button>

                    {linkStatus && (
                        <p style={{ fontSize: '13px', color: 'var(--primary)', textAlign: 'center', margin: '5px 0 0 0', fontWeight: '500' }}>
                            {linkStatus}
                        </p>
                    )}
                </Card>
            )}
        </div>
    );
};