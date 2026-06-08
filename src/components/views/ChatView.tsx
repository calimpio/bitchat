import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore.ts';
import { DB, BitChatAuth, PeerService, CryptoService } from '../../sdk/index.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Message, RequestRecord, ContactMap, Device } from '../../sdk/models/types.ts';
import { Modal } from '../ui/Modal.tsx';

export const ChatView: React.FC = () => {
    const { me, chatConIdPublico, setChatConIdPublico, mostrarChatMobile, setMostrarChatMobile, showModalConfig } = useStore();
    const [requests, setRequests] = useState<RequestRecord[]>([]);
    const [allContactos, setAllContactos] = useState<ContactMap>({});
    const [messages, setMessages] = useState<Message[]>([]);
    const [myDevices, setMyDevices] = useState<Device[]>([]);
    const [msgInput, setMsgInput] = useState('');
    const [currentFingerprint, setCurrentFingerprint] = useState('');
    const chatFlowRef = useRef<HTMLDivElement>(null);

    const refreshData = async () => {
        const reqs = await DB.getRequests();
        const contacts = await BitChatAuth.obtenerContactos();
        const devices = await DB.getDevices();
        setRequests(reqs);
        setAllContactos(contacts);
        setMyDevices(devices);
        
        if (chatConIdPublico) {
            const msgs = await DB.getChatMessages(chatConIdPublico);
            setMessages(msgs);
            if (contacts[chatConIdPublico]?.publicKey) {
                const fp = await CryptoService.getFingerprint(contacts[chatConIdPublico].publicKey!);
                setCurrentFingerprint(fp);
            }
        }
    };

    useEffect(() => {
        refreshData();
        PeerService.onRefresh = refreshData;
        PeerService.onMessage = (chatId) => {
            if (chatConIdPublico === chatId) refreshData();
            else refreshData();
        };
        
        return () => {
            PeerService.onRefresh = null;
            PeerService.onMessage = null;
        };
    }, [chatConIdPublico]);

    useEffect(() => {
        if (chatFlowRef.current) {
            chatFlowRef.current.scrollTop = chatFlowRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = async () => {
        if (!msgInput.trim() || !chatConIdPublico) return;
        await PeerService.enviarMensaje(chatConIdPublico, msgInput.trim());
        setMsgInput('');
        refreshData();
    };

    const toggleSyncPermission = async (deviceId: string) => {
        if (!chatConIdPublico) return;
        const contact = allContactos[chatConIdPublico];
        if (!contact) return;

        const currentAllowed = contact.syncAllowedDevices || [];
        const newAllowed = currentAllowed.includes(deviceId)
            ? currentAllowed.filter(id => id !== deviceId)
            : [...currentAllowed, deviceId];

        await BitChatAuth.guardarContacto(
            chatConIdPublico, 
            contact.tokenCuartaCredencial, 
            contact.insecure, 
            contact.publicKey, 
            newAllowed
        );
        PeerService._replicateContact(chatConIdPublico);
        refreshData();
    };

    const handleDeleteChat = async () => {
        if (chatConIdPublico) {
            if (confirm("¿Eliminar este historial localmente?")) {
                await DB.deleteChat(chatConIdPublico);
                await BitChatAuth.eliminarContacto(chatConIdPublico);
                setChatConIdPublico(null);
                setMostrarChatMobile(false);
                useStore.setState({ showModalConfig: false });
            }
        }
    };

    const contactList = (
        <div className="contact-list-pane" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
                <Button style={{ flex: '1' }} onClick={() => useStore.setState({ showModalAdd: true })}>+ Añadir Nodo</Button>
                <Button variant="ghost" style={{ padding: '0 12px' }} onClick={() => useStore.setState({ activeApp: 'ChatSettings' })}>⚙</Button>
            </div>
            {requests.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <h4 className="nav-section-title">Solicitudes</h4>
                    {requests.map(r => (
                        <div key={r.idPublico} className="request-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <p style={{ fontSize: '14px', fontWeight: '700' }}>{r.idPublico}</p>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <Button variant="success" className="btn-sm" onClick={() => PeerService.aceptarConexion(r.idPublico)}>Aceptar</Button>
                                <Button variant="primary" className="btn-sm" onClick={async () => {
                                    if (confirm(`¿Bloquear permanentemente a ${r.idPublico}?`)) {
                                        await DB.addBlock(r.idPublico);
                                        await DB.deleteRequest(r.idPublico);
                                        refreshData();
                                    }
                                }}>Bloquear</Button>
                                <Button variant="ghost" className="btn-sm" onClick={() => PeerService.rechazarConexion(r.idPublico)}>X</Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <h4 className="nav-section-title">Contactos</h4>
            {Object.keys(allContactos).map(cel => {
                const isSecure = PeerService.conexionesP2PDirectas[cel]?.status === 'SECURE';
                const c = allContactos[cel];
                return (
                    <div 
                        key={cel}
                        className={`user-card ${chatConIdPublico === cel ? 'active' : ''}`}
                        onClick={() => { setChatConIdPublico(cel); setMostrarChatMobile(true); }}
                    >
                        <div>
                            <p style={{ fontWeight: '700', fontSize: '14px', color: c.insecure ? 'var(--primary)' : 'inherit' }}>{cel}</p>
                            {c.insecure && <p style={{ fontSize: '10px', color: 'var(--primary)' }}>SUPLANTACIÓN</p>}
                        </div>
                        <span className={`status-badge ${c.insecure ? 'status-insecure' : (isSecure ? 'status-online' : 'status-offline')}`}>
                            {c.insecure ? '!' : (isSecure ? 'SECURE' : 'LINK')}
                        </span>
                    </div>
                );
            })}
        </div>
    );

    const chatArea = (
        <div className={`chat-area-pane ${mostrarChatMobile ? 'active' : ''}`} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Card style={{ flex: '1', padding: '15px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button className="btn-back-mobile" onClick={() => { setChatConIdPublico(null); setMostrarChatMobile(false); }}>←</button>
                        <div>
                            <h3 style={{ fontSize: '16px' }}>{chatConIdPublico || 'Selecciona un chat'}</h3>
                            {chatConIdPublico && currentFingerprint && (
                                <p style={{ fontSize: '9px', color: 'var(--accent-blue)', letterSpacing: '1px' }}>{currentFingerprint}</p>
                            )}
                        </div>
                    </div>
                    {chatConIdPublico && (
                        <button className="btn btn-ghost" style={{ padding: '5px' }} onClick={() => useStore.setState({ showModalConfig: true })}>⚙</button>
                    )}
                </div>
                <div ref={chatFlowRef} id="chat-flow" style={{ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {messages.map(m => {
                        const isMe = m.de === me?.idPublico;
                        return (
                            <div key={m.msgId} className={`msg-container ${isMe ? 'msg-me' : 'msg-other'}`}>
                                <div className="bubble">{m.msg}</div>
                                <div style={{ fontSize: '9px', color: 'var(--text-dim)', alignSelf: isMe ? 'flex-end' : 'flex-start', marginTop: '2px' }}>
                                    {new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {isMe && (m.status === 'read' ? ' ✓✓' : ' ✓')}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                    <Input 
                        style={{ flex: '1' }} 
                        placeholder="Mensaje..." 
                        value={msgInput}
                        onChange={(e) => setMsgInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    />
                    <Button variant="success" onClick={handleSendMessage}>{'>'}</Button>
                </div>
            </Card>
        </div>
    );

    return (
        <div className="bit-chat-container" style={{ display: 'flex', flex: '1', width: '100%', height: '100%', overflow: 'hidden' }}>
            <Modal 
                active={showModalConfig && !!chatConIdPublico} 
                title={`Config: ${chatConIdPublico}`}
                onClose={() => useStore.setState({ showModalConfig: false })}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <h4 style={{ color: 'var(--accent-blue)', marginBottom: '10px', fontSize: '14px' }}>Sincronización en Red Privada</h4>
                        <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '15px' }}>
                            Selecciona qué dispositivos de tu propiedad tienen permiso para replicar este chat.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {myDevices.map(dev => {
                                const isAllowed = allContactos[chatConIdPublico!]?.syncAllowedDevices?.includes(dev.deviceId);
                                return (
                                    <div key={dev.deviceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{dev.label}</span>
                                            <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{dev.deviceId}</span>
                                        </div>
                                        <div 
                                            onClick={() => toggleSyncPermission(dev.deviceId)}
                                            style={{ 
                                                width: '40px', 
                                                height: '20px', 
                                                background: isAllowed ? 'var(--success)' : '#444', 
                                                borderRadius: '20px', 
                                                position: 'relative', 
                                                cursor: 'pointer',
                                                transition: 'background 0.3s'
                                            }}
                                        >
                                            <div style={{ 
                                                width: '16px', 
                                                height: '16px', 
                                                background: '#fff', 
                                                borderRadius: '50%', 
                                                position: 'absolute', 
                                                top: '2px', 
                                                left: isAllowed ? '22px' : '2px',
                                                transition: 'left 0.3s'
                                            }} />
                                        </div>
                                    </div>
                                );
                            })}
                            {myDevices.length === 0 && <p style={{ fontSize: '11px', color: 'var(--text-dim)', fontStyle: 'italic' }}>No se han detectado otros dispositivos vinculados.</p>}
                        </div>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
                        <Button variant="primary" style={{ width: '100%' }} onClick={handleDeleteChat}>Eliminar de este dispositivo</Button>
                    </div>
                </div>
            </Modal>
            {!chatConIdPublico ? contactList : chatArea}
        </div>
    );
};