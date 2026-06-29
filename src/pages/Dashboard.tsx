import React, { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { Header } from '../components/layout/Header.tsx';
import { Sidebar } from '../components/layout/Sidebar.tsx';
import { ChatView } from '../components/views/ChatView.tsx';
import { SettingsView } from '../components/views/SettingsView.tsx';
import { DevicesView } from '../components/views/DevicesView.tsx';
import { ChatSettingsView } from '../components/views/ChatSettingsView.tsx';
import { DriveView } from '../components/views/DriveView.tsx';
import { AppStoreView } from '../components/views/AppStoreView.tsx';
import { AppConsoleView } from '../components/views/AppConsoleView.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { Input } from '../components/ui/Input.tsx';
import { Button } from '../components/ui/Button.tsx';
import { PeerService, DB, BitMsgAuth } from '../sdk/index.ts';

export const DashboardPage: React.FC = () => {
    const { activeApp, showSidebar, setShowSidebar, showModalAdd, showModalConfig, chatConIdPublico, setChatConIdPublico, setMostrarChatMobile } = useStore();
    const [addId, setAddId] = useState('');

    React.useEffect(() => {
        const handleActivity = () => {
            useStore.getState().resetLockTimer();
        };

        window.addEventListener('mousemove', handleActivity);
        window.addEventListener('keydown', handleActivity);
        window.addEventListener('mousedown', handleActivity);
        window.addEventListener('touchstart', handleActivity);
        window.addEventListener('scroll', handleActivity);

        handleActivity();

        return () => {
            window.removeEventListener('mousemove', handleActivity);
            window.removeEventListener('keydown', handleActivity);
            window.removeEventListener('mousedown', handleActivity);
            window.removeEventListener('touchstart', handleActivity);
            window.removeEventListener('scroll', handleActivity);
        };
    }, []);
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
            await BitMsgAuth.eliminarContacto(chatConIdPublico);
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
                title="Configuración de Chat" 
                onClose={() => useStore.setState({ showModalConfig: false })}
            >
                {/* Content will be injected or handled via ChatView's logic if we pass props, 
                    but for now let's keep it simple and just provide the Delete option here, 
                    and we will add the Sync Permissions soon. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '10px' }}>Zona de Peligro</p>
                        <Button variant="primary" style={{ width: '100%' }} onClick={handleDeleteChat}>Eliminar Historial Local</Button>
                    </div>
                </div>
            </Modal>

            <Header />
            <div className="main-content">
                <Sidebar />
                <div className="app-viewport">
                    {activeApp === 'bitMsg' && <ChatView />}
                    {activeApp === 'Settings' && <SettingsView />}
                    {activeApp === 'bitDevices' && <DevicesView />}
                    {activeApp === 'ChatSettings' && <ChatSettingsView />}
                    {activeApp === 'bitDrive' && <DriveView />}
                    {activeApp === 'bitApp' && <AppStoreView />}
                    {activeApp === 'bitAppConsole' && <AppConsoleView />}
                    {activeApp !== 'bitMsg' && activeApp !== 'Settings' && activeApp !== 'bitDevices' && activeApp !== 'ChatSettings' && activeApp !== 'bitDrive' && activeApp !== 'bitApp' && activeApp !== 'bitAppConsole' && (
                        <div style={{ textAlign: 'center', marginTop: '50px', color: 'var(--text-dim)' }}>Próximamente...</div>
                    )}
                </div>
            </div>
        </div>
    );
};