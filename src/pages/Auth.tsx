import React, { useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { BitChatAuth, PeerService, DB } from '../sdk/index.ts';
import { Card } from '../components/ui/Card.tsx';
import { Input } from '../components/ui/Input.tsx';

export const AuthPage: React.FC = () => {
    const { pantalla, setPantalla, error, setError, me, setMe, setMasterPassword } = useStore();
    const isLogin = pantalla === 'AUTH_LOGIN';
    
    const [pub, setPub] = useState('');
    const [priv, setPriv] = useState('');
    const [pass, setPass] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAuthAction = async () => {
        if (!isLogin) {
            if (!pub || !priv || !pass) return alert("Faltan datos");
            setIsLoading(true);
            
            const isValid = await PeerService.validarIdentidadEnRed(pub, priv, pass);
            if (!isValid) {
                setError("ID ya reclamado con otras credenciales. Usa otro número.");
                setIsLoading(false);
                return;
            }
            await BitChatAuth.guardarMisCredenciales(pub, priv, pass);
            const creds = await BitChatAuth.obtenerMisCredenciales();
            setMe(creds);
            setPantalla('AUTH_LOGIN');
            setIsLoading(false);
        } else {
            if (!(await BitChatAuth.verificarPassword(pass))) {
                setError('Fallo de derivación');
                return;
            }
            setMasterPassword(pass);
            
            await BitChatAuth.migrarContactosSeguros();
            await DB.migratePlainMessages();

            if (me) {
                await PeerService.inicializarNodo(me.idPublico);
            }
            
            // Note: PeerService handlers should probably be managed in a global effect
            PeerService.onRefresh = () => { /* useStore handles this now */ };
            
            setPantalla('DASHBOARD');
        }
    };

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center' }}>
            <Card className="fade-in" style={{ width: '400px', padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <h1 style={{ color: 'var(--primary)', fontSize: '28px', marginBottom: '8px' }}>BitChat</h1>
                    <p style={{ color: 'var(--text-dim)', fontSize: '13px' }}>
                        {isLogin ? 'Terminal de Soberanía Criptográfica' : 'Genera tu Identidad Autónoma'}
                    </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {!isLogin ? (
                        <Input 
                            placeholder="Número de Celular" 
                            value={pub} 
                            onChange={(e) => setPub(e.target.value)} 
                        />
                    ) : (
                        <div style={{ background: 'var(--input-bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <p style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Terminal Vinculada:</p>
                            <p style={{ fontSize: '14px', fontWeight: '700', color: 'var(--accent-blue)' }}>{me?.idPublico}</p>
                        </div>
                    )}
                    {!isLogin && (
                        <Input 
                            placeholder="Nickname @..." 
                            value={priv} 
                            onChange={(e) => setPriv(e.target.value)} 
                        />
                    )}
                    <Input 
                        type="password" 
                        placeholder="Contraseña Maestra" 
                        value={pass} 
                        onChange={(e) => setPass(e.target.value)} 
                    />
                    {error && <p style={{ color: 'var(--primary)', fontSize: '12px', textAlign: 'center' }}>{error}</p>}
                    
                    <button 
                        className={isLogin ? 'btn btn-success' : 'btn btn-primary'}
                        disabled={isLoading}
                        onClick={handleAuthAction}
                    >
                        {isLoading ? 'Validando...' : (isLogin ? 'Desbloquear Terminal' : 'Generar Identidad')}
                    </button>
                    <p 
                        style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer', marginTop: '10px' }}
                        onClick={() => setPantalla('TERMS')}
                    >
                        Al usar BitChat, aceptas los Términos y Condiciones
                    </p>
                </div>
            </Card>
        </div>
    );
};