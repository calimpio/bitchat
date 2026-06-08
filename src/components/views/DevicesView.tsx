import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { PeerService } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Device } from '../../sdk/models/types.ts';

export const DevicesView: React.FC = () => {
    const { me, devices, setDevices } = useStore();

    useEffect(() => {
        // Poll for online status of peer connections
        const updateOnlineStatus = () => {
            if (!me) return;
            
            // In BitChat, "devices" are essentially other nodes with the same public ID
            // or nodes that we consider part of our personal "mesh".
            // For now, let's treat the current node and known connections as potential devices.
            
            const currentDevices: Device[] = [
                {
                    idPublico: me.idPublico,
                    label: 'Este Dispositivo',
                    isOnline: PeerService.peer?.open || false,
                    lastSeen: Date.now(),
                    publicKey: me.publicKey
                }
            ];

            // If we have active connections that match our own public ID (multi-device sync)
            // they would appear here.
            
            setDevices(currentDevices);
        };

        const interval = setInterval(updateOnlineStatus, 5000);
        updateOnlineStatus();

        return () => clearInterval(interval);
    }, [me, setDevices]);

    return (
        <div className="devices-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
            <h2 style={{ color: 'var(--primary)', textAlign: 'center', marginBottom: '10px' }}>bitDevices</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '14px', textAlign: 'center' }}>
                Gestiona tus terminales vinculadas y su estado en la red.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '10px' }}>
                {devices.map((device) => (
                    <Card key={device.idPublico} style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ color: 'var(--accent-blue)', marginBottom: '5px' }}>{device.label}</h4>
                                <p style={{ fontSize: '12px', color: 'var(--text-dim)' }}>ID: {device.idPublico}</p>
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
                                {device.label !== 'Este Dispositivo' && (
                                    <Button variant="ghost" className="btn-sm" style={{ color: 'var(--primary)' }}>Desvincular</Button>
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