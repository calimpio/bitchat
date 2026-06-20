import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { PeerService, DB } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Device } from '../../sdk/models/types.ts';

export const DevicesView: React.FC = () => {
    const { me, devices, setDevices } = useStore();
    const [isSearching, setIsSearching] = useState(false);
    const [searchTimeLeft, setSearchTimeLeft] = useState(0);

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
                <Button 
                    variant={isSearching ? 'ghost' : 'success'} 
                    disabled={isSearching} 
                    onClick={handleSearch}
                    style={{ minWidth: '160px' }}
                >
                    {isSearching ? `Buscando... (${searchTimeLeft}s)` : '🔍 Buscar Dispositivos'}
                </Button>
            </div>
            
            <p style={{ color: 'var(--text-dim)', fontSize: '14px', textAlign: 'center' }}>
                Gestiona tus terminales vinculadas y su estado en la red.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
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
                            No tienes otros dispositivos vinculados. Usa la opción de Sincronización en Configuración para añadir una nueva terminal.
                        </p>
                        <Button variant="ghost" onClick={() => useStore.setState({ activeApp: 'Settings' })}>Ir a Sincronización</Button>
                    </div>
                </Card>
            )}
        </div>
    );
};