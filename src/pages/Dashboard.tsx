import React, { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { Header } from '../components/layout/Header.tsx';
import { Sidebar } from '../components/layout/Sidebar.tsx';
import { ChatView } from '../components/views/ChatView.tsx';
import { SettingsView } from '../components/views/SettingsView.tsx';
import { DevicesView } from '../components/views/DevicesView.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Button } from '../components/ui/Button.tsx';
import { PeerService, DB, BitChatAuth } from '../sdk/index.ts';

export const DashboardPage: React.FC = () => {
    const { activeApp, showSidebar, setShowSidebar, showModalAdd, showModalConfig, chatConIdPublico, setChatConIdPublico, setMostrarChatMobile } = useStore();
    const [addId, setAddId] = useState('');
    const [addFingerprint, setAddFingerprint] = useState('');

    const handleAddNode = () => {
        if (addId) {
            PeerService.conectarAContacto(addId, addFingerprint || undefined);
            useStore.setState({ showModalAdd: false });
            setAddId('');
            setAddFingerprint('');
        }
    };

    const handleDeleteChat = async () => {
        if (chatConIdPublico) {
            await DB.deleteChat(chatConIdPublico);
            await BitChatAuth.eliminarContacto(chatConIdPublico);
            setChatConIdPublico(null);
            setMostrarChatMobile(false);
            useStore.setState({ showModalConfig: false });
        }
    };

    return (
        <div className={`app-container fade-in ${showSidebar ? 'sidebar-open' : ''}`}>
            <div 
                className={`drawer-overlay ${showSidebar ? 'active' : ''}`} 
                onClick={() => setShowSidebar(false)} 
            />
            
            <Modal 
                active={showModalAdd} 
                title="Enlazar Nodo" 
                onClose={() => useStore.setState({ showModalAdd: false })}
            >
                <Input 
                    placeholder="ID (Número)" 
                    value={addId} 
                    onChange={(e) => setAddId(e.target.value)} 
                />
                <Input 
                    placeholder="Huella (Opcional)" 
                    style={{ marginTop: '10px' }} 
                    value={addFingerprint}
                    onChange={(e) => setAddFingerprint(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <Button variant="ghost" style={{ flex: '1' }} onClick={() => useStore.setState({ showModalAdd: false })}>Cancelar</Button>
                    <Button style={{ flex: '1' }} onClick={handleAddNode}>Enlazar</Button>
                </div>
            </Modal>

            <Modal 
                active={showModalConfig && !!chatConIdPublico} 
                title="Chat Config" 
                onClose={() => useStore.setState({ showModalConfig: false })}
            >
                <p style={{ fontSize: '13px', color: 'var(--text-dim)' }}>¿Eliminar este historial?</p>
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <Button variant="ghost" style={{ flex: '1' }} onClick={() => useStore.setState({ showModalConfig: false })}>Cancelar</Button>
                    <Button style={{ flex: '1' }} onClick={handleDeleteChat}>Eliminar</Button>
                </div>
            </Modal>

            <Header />
            <div className="main-content">
                <Sidebar />
                <div className="app-viewport">
                    {activeApp === 'bitChat' && <ChatView />}
                    {activeApp === 'Settings' && <SettingsView />}
                    {activeApp === 'bitDevices' && <DevicesView />}
                    {activeApp !== 'bitChat' && activeApp !== 'Settings' && activeApp !== 'bitDevices' && (
                        <div style={{ textAlign: 'center', marginTop: '50px', color: 'var(--text-dim)' }}>Próximamente...</div>
                    )}
                </div>
            </div>
        </div>
    );
};