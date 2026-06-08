import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { DB, BitChatAuth, PeerService } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Device, ContactMap } from '../../sdk/models/types.ts';

export const ChatSettingsView: React.FC = () => {
    const { me } = useStore();
    const [devices, setDevices] = useState<Device[]>([]);
    const [allContactos, setAllContactos] = useState<ContactMap>({});

    const refreshData = async () => {
        const storedDevices = await DB.getDevices();
        const contacts = await BitChatAuth.obtenerContactos();
        setDevices(storedDevices);
        setAllContactos(contacts);
    };

    useEffect(() => {
        refreshData();
        PeerService.onRefresh = refreshData;
        return () => {
            PeerService.onRefresh = null;
        };
    }, []);

    const toggleGlobalSyncPermission = async (deviceId: string) => {
        // Toggle permission for ALL contacts for this device
        const contactIds = Object.keys(allContactos);
        const localDeviceId = localStorage.getItem('bit_device_id');
        
        if (deviceId === localDeviceId) return;

        let anyAdded = false;
        let anyRemoved = false;

        for (const id of contactIds) {
            const contact = allContactos[id];
            const currentAllowed = contact.syncAllowedDevices || [];
            
            if (currentAllowed.includes(deviceId)) {
                anyRemoved = true;
                const newAllowed = currentAllowed.filter(d => d !== deviceId);
                await BitChatAuth.guardarContacto(id, contact.tokenCuartaCredencial, contact.insecure, contact.publicKey, newAllowed);
                PeerService._replicateContact(id);
            } else {
                anyAdded = true;
                const newAllowed = [...currentAllowed, deviceId];
                await BitChatAuth.guardarContacto(id, contact.tokenCuartaCredencial, contact.insecure, contact.publicKey, newAllowed);
                PeerService._replicateContact(id);
            }
        }
        
        refreshData();
        alert(anyAdded ? `Acceso concedido a todos los chats para ${deviceId}` : `Acceso revocado a todos los chats para ${deviceId}`);
    };

    return (
        <div className="chat-settings-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <Button variant="ghost" onClick={() => useStore.setState({ activeApp: 'bitChat' })}>←</Button>
                <h2 style={{ color: 'var(--primary)', margin: 0 }}>Configuración de bitChat</h2>
            </div>

            <Card style={{ padding: '20px' }}>
                <h3 style={{ color: 'var(--accent-blue)', fontSize: '16px', marginBottom: '10px' }}>Sincronización de Dispositivos</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '20px' }}>
                    Gestiona qué terminales tienen permiso para sincronizar tus conversaciones de bitChat de forma global.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {devices.map(dev => {
                        // Check if ALL contacts allow this device (for simplicity in this view)
                        const contactIds = Object.keys(allContactos);
                        const allowedCount = contactIds.filter(id => allContactos[id].syncAllowedDevices?.includes(dev.deviceId)).length;
                        const isFullyAllowed = contactIds.length > 0 && allowedCount === contactIds.length;
                        const isPartiallyAllowed = allowedCount > 0 && allowedCount < contactIds.length;

                        return (
                            <div key={dev.deviceId} style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <p style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{dev.label}</p>
                                        <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>ID: {dev.deviceId}</p>
                                        <p style={{ fontSize: '11px', color: isFullyAllowed ? 'var(--success)' : (isPartiallyAllowed ? 'var(--accent-blue)' : 'var(--text-dim)'), marginTop: '8px' }}>
                                            {isFullyAllowed ? 'Sincronización Total Activa' : (isPartiallyAllowed ? `Sincronizando ${allowedCount} de ${contactIds.length} chats` : 'Sincronización Desactivada')}
                                        </p>
                                    </div>
                                    <Button 
                                        variant={isFullyAllowed ? 'success' : 'ghost'} 
                                        className="btn-sm"
                                        onClick={() => toggleGlobalSyncPermission(dev.deviceId)}
                                    >
                                        {isFullyAllowed ? 'Revocar Todo' : 'Autorizar Todo'}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                    {devices.length === 0 && (
                        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '13px' }}>
                            No hay otros dispositivos vinculados a esta identidad.
                        </p>
                    )}
                </div>
            </Card>

            <Card style={{ padding: '20px', border: '1px solid var(--primary)', background: 'rgba(255, 69, 58, 0.05)' }}>
                <h3 style={{ color: 'var(--primary)', fontSize: '16px', marginBottom: '10px' }}>Privacidad y Datos</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                    Borrar el historial local de bitChat no afectará a tus otros dispositivos sincronizados.
                </p>
                <Button variant="primary" style={{ width: '100%' }} onClick={async () => {
                    if (confirm("¿Seguro que quieres borrar TODOS los mensajes de esta terminal? Esta acción no se puede deshacer.")) {
                        const contactIds = Object.keys(allContactos);
                        for (const id of contactIds) {
                            await DB.deleteChat(id);
                        }
                        alert("Historial local eliminado.");
                        useStore.setState({ activeApp: 'bitChat' });
                    }
                }}>Borrar todo el historial local</Button>
            </Card>
        </div>
    );
};
