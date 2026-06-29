import React from 'react';
import { useStore } from '../../store/useStore.ts';
import { PeerService } from '../../sdk/index.ts';

export const Sidebar: React.FC = () => {
    const { activeApp, setActiveApp, showSidebar, setShowSidebar, setPantalla, setMasterPassword, setAesKey, setChatConIdPublico, devName } = useStore();

    const logout = () => {
        if (PeerService.peer) PeerService.peer.destroy();
        setPantalla('AUTH_LOGIN');
        setActiveApp('bitMsg');
        setMasterPassword('');
        setAesKey(null as any);
        setChatConIdPublico(null);
    };

    return (
        <div className={`sidebar ${showSidebar ? 'active' : ''}`}>
            <div className="sidebar-header">
                <h2 style={{ color: 'var(--primary)', fontSize: '20px' }}>bitOS</h2>
                <button className="btn btn-ghost" style={{ padding: '4px' }} onClick={() => setShowSidebar(false)}>✕</button>
            </div>
            <div className="sidebar-content">
                <div 
                    className={`nav-item ${activeApp === 'bitMsg' ? 'active' : ''}`} 
                    onClick={() => setActiveApp('bitMsg')}
                >
                    💬 bitMsg
                </div>
                <div 
                    className={`nav-item ${activeApp === 'bitDevices' ? 'active' : ''}`} 
                    onClick={() => setActiveApp('bitDevices')}
                >
                    📱 bitDevices
                </div>
                <div 
                    className={`nav-item ${activeApp === 'bitDrive' ? 'active' : ''}`} 
                    onClick={() => setActiveApp('bitDrive')}
                >
                    📂 bitDrive
                </div>
                <div 
                    className={`nav-item ${activeApp === 'bitApp' ? 'active' : ''}`} 
                    onClick={() => setActiveApp('bitApp')}
                >
                    🏪 bitApp Store
                </div>
                {devName && (
                    <div 
                        className={`nav-item ${activeApp === 'bitAppConsole' ? 'active' : ''}`} 
                        onClick={() => setActiveApp('bitAppConsole')}
                    >
                        🚀 bitApp Console
                    </div>
                )}
            </div>
            <div className="sidebar-footer">
                <div 
                    className={`nav-item ${activeApp === 'Settings' ? 'active' : ''}`} 
                    onClick={() => { setActiveApp('Settings'); setShowSidebar(false); }}
                >
                    ⚙ Configuración
                </div>
                <div className="nav-item" style={{ color: 'var(--primary)' }} onClick={logout}>
                    🔓 Cerrar Terminal
                </div>
            </div>
        </div>
    );
};