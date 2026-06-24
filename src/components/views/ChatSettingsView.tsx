import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { DB, BitMsgAuth, PeerService } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Device, ContactMap } from '../../sdk/models/types.ts';

export const ChatSettingsView: React.FC = () => {
    const { me } = useStore();
    const [devices, setDevices] = useState<Device[]>([]);
    const [allContactos, setAllContactos] = useState<ContactMap>({});

    const refreshData = async () => {
        const storedDevices = await DB.getDevices();
        const contacts = await BitMsgAuth.obtenerContactos();
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
        const contactIds = Object.keys(allContactos);
        const allowedCount = contactIds.filter(id => allContactos[id].syncAllowedDevices?.includes(deviceId)).length;
        const dev = devices.find(d => d.deviceId === deviceId);
        const isFullyAllowed = dev?.globalSync === true || (contactIds.length > 0 && allowedCount === contactIds.length);

        if (!isFullyAllowed) {
            const confirmAction = window.confirm(`¿Estás seguro de autorizar a este dispositivo (${deviceId}) para sincronizar TODOS tus chats? Esto le dará acceso completo a tu historial actual y futuro.`);
            if (!confirmAction) return;
        }

        // Toggle permission for ALL contacts for this device
        const localDeviceId = localStorage.getItem('bit_device_id');
        if (deviceId === localDeviceId) return;

        if (dev) {
            dev.globalSync = !isFullyAllowed;
            await DB.addDevice(dev);
        }

        for (const id of contactIds) {
            const contact = allContactos[id];
            const currentAllowed = contact.syncAllowedDevices || [];
            
            if (isFullyAllowed) {
                // Revocar todo
                const newAllowed = currentAllowed.filter(d => d !== deviceId);
                await BitMsgAuth.guardarContacto(id, contact.tokenCuartaCredencial, contact.insecure, contact.publicKey, newAllowed, contact.sharedSecret);
                PeerService._replicateContact(id);
            } else {
                // Autorizar todo
                if (!currentAllowed.includes(deviceId)) {
                    const newAllowed = [...currentAllowed, deviceId];
                    await BitMsgAuth.guardarContacto(id, contact.tokenCuartaCredencial, contact.insecure, contact.publicKey, newAllowed, contact.sharedSecret);
                    PeerService._replicateContact(id);
                }
            }
        }
        
        refreshData();
    };

    return (
        <div className="chat-settings-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <Button variant="ghost" onClick={() => useStore.setState({ activeApp: 'bitMsg' })}>←</Button>
                <h2 style={{ color: 'var(--primary)', margin: 0 }}>Configuración de bitMsg</h2>
            </div>

            <Card style={{ padding: '20px' }}>
                <h3 style={{ color: 'var(--accent-blue)', fontSize: '16px', marginBottom: '10px' }}>Sincronización Global de Dispositivos</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '20px' }}>
                    Autoriza qué terminales tienen permiso para replicar automáticamente todas tus conversaciones.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {devices.map(dev => {
                        const contactIds = Object.keys(allContactos);
                        const allowedCount = contactIds.filter(id => allContactos[id].syncAllowedDevices?.includes(dev.deviceId)).length;
                        const isFullyAllowed = dev.globalSync === true || (contactIds.length > 0 && allowedCount === contactIds.length);
                        const isPartiallyAllowed = !isFullyAllowed && allowedCount > 0;

                        return (
                            <div key={dev.deviceId} style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <p style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>{dev.label}</p>
                                        <p style={{ fontSize: '11px', color: 'var(--text-dim)' }}>ID: {dev.deviceId}</p>
                                        <p style={{ fontSize: '11px', color: isFullyAllowed ? 'var(--success)' : (isPartiallyAllowed ? 'var(--accent-blue)' : 'var(--text-dim)'), marginTop: '8px' }}>
                                            {isFullyAllowed ? 'Sincronización Total Activa' : (isPartiallyAllowed ? `Autorizado en ${allowedCount} de ${contactIds.length} chats` : 'Acceso Denegado')}
                                        </p>
                                    </div>
                                    <div 
                                        onClick={() => toggleGlobalSyncPermission(dev.deviceId)}
                                        style={{ 
                                            width: '50px', 
                                            height: '26px', 
                                            background: isFullyAllowed ? 'var(--success)' : '#444', 
                                            borderRadius: '26px', 
                                            position: 'relative', 
                                            cursor: 'pointer',
                                            transition: 'background 0.3s',
                                            border: '1px solid rgba(255,255,255,0.1)'
                                        }}
                                    >
                                        <div style={{ 
                                            width: '20px', 
                                            height: '20px', 
                                            background: '#fff', 
                                            borderRadius: '50%', 
                                            position: 'absolute', 
                                            top: '2px', 
                                            left: isFullyAllowed ? '26px' : '2px',
                                            transition: 'left 0.3s',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                        }} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {devices.length === 0 && (
                        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '13px' }}>
                            No hay otros dispositivos vinculados.
                        </p>
                    )}
                </div>
            </Card>

            <Card style={{ padding: '20px', border: '1px solid var(--primary)', background: 'rgba(255, 69, 58, 0.05)' }}>
                <h3 style={{ color: 'var(--primary)', fontSize: '16px', marginBottom: '10px' }}>Privacidad y Datos</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                    Borrar el historial local de bitMsg no afectará a tus otros dispositivos sincronizados.
                </p>
                <Button variant="primary" style={{ width: '100%' }} onClick={async () => {
                    if (confirm("¿Seguro que quieres borrar TODOS los mensajes de esta terminal? Esta acción no se puede deshacer.")) {
                        const contactIds = Object.keys(allContactos);
                        for (const id of contactIds) {
                            await DB.deleteChat(id);
                        }
                        alert("Historial local eliminado.");
                        useStore.setState({ activeApp: 'bitMsg' });
                    }
                }}>Borrar todo el historial local</Button>
            </Card>
        </div>
    );
};
