import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore.ts';
import { PeerService, CryptoService } from '../../sdk/index.ts';
import { Button } from '../ui/Button.tsx';

export const Header: React.FC = () => {
    const { me, activeApp, setActiveApp, showSidebar, setShowSidebar, setPantalla, setMasterPassword, setAesKey, setChatConIdPublico, sessionExpiresAt } = useStore();
    const [isPeerOpen, setIsPeerOpen] = useState(PeerService.peer?.open || false);
    const [fingerprint, setFingerprint] = useState('');
    const [timeLeft, setTimeLeft] = useState<string>('');

    useEffect(() => {
        if (me?.publicKey) {
            CryptoService.getFingerprint(me.publicKey).then(setFingerprint);
        }

        const checkPeer = setInterval(() => {
            setIsPeerOpen(PeerService.peer?.open || false);
        }, 1000);

        return () => clearInterval(checkPeer);
    }, [me]);

    useEffect(() => {
        const updateTimer = () => {
            if (!sessionExpiresAt) {
                setTimeLeft('');
                return;
            }
            const diff = sessionExpiresAt - Date.now();
            if (diff <= 0) {
                setTimeLeft('00:00');
                return;
            }
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            setTimeLeft(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
        };

        const timer = setInterval(updateTimer, 1000);
        updateTimer();
        return () => clearInterval(timer);
    }, [sessionExpiresAt]);

    const logout = () => {
        if (PeerService.peer) PeerService.peer.destroy();
        setPantalla('AUTH_LOGIN');
        setActiveApp('bitMsg');
        setMasterPassword('');
        setAesKey(null as any);
        setChatConIdPublico(null);
    };

    return (
        <div className="header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button className="btn-menu-mobile" onClick={() => setShowSidebar(!showSidebar)}>☰</button>
                <div 
                    style={{ 
                        width: '10px', 
                        height: '10px', 
                        borderRadius: '50%', 
                        background: isPeerOpen ? 'var(--success)' : '#666', 
                        boxShadow: isPeerOpen ? '0 0 8px var(--success)' : 'none' 
                    }}
                    title={isPeerOpen ? 'Nodo Online' : 'Nodo Desconectado'}
                />
                <div className="mobile-id-info" style={{ display: 'none' }}>
                    <h2 style={{ fontSize: '14px' }}>@{me?.idPrivado}</h2>
                    <span style={{ fontSize: '8px', color: 'var(--accent-blue)' }}>{fingerprint}</span>
                </div>
                <h2 className="desktop-only" style={{ fontSize: '16px' }}>@{me?.idPrivado}</h2>
                <span className="desktop-only" style={{ fontSize: '10px', color: 'var(--text-dim)' }}>| ID: {me?.idPublico}</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {timeLeft && (
                    <div style={{ 
                        fontSize: '11px', 
                        fontFamily: 'Fira Code, monospace', 
                        color: 'var(--text-dim)', 
                        background: 'rgba(255,255,255,0.05)', 
                        padding: '4px 8px', 
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <span style={{ opacity: 0.6 }}>SESSION:</span>
                        <span style={{ color: parseInt(timeLeft.split(':')[0]) < 1 ? 'var(--error)' : 'var(--accent-blue)' }}>{timeLeft}</span>
                    </div>
                )}
                <div className="desktop-only" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>App: {activeApp}</span>
                    <Button variant="ghost" style={{ padding: '6px 12px' }} onClick={logout}>🔓 Salir</Button>
                </div>
            </div>
        </div>
    );
};