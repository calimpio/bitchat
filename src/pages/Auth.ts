import { h } from '../utils/dom.ts';
import { Estado, BitChatAuth, PeerService, DB } from '../sdk/index.ts';
import { Card } from '../components/ui/Card.ts';
import { Input } from '../components/ui/Input.ts';

export function AuthPage(renderApp: () => void) {
    const isLogin = (Estado.pantalla === 'AUTH_LOGIN');
    
    return h('div', { style: { display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center' } }, [
        Card({ className: 'fade-in', style: { width: '400px', padding: '40px' } }, [
            h('div', { style: { textAlign: 'center', marginBottom: '32px' } }, [
                h('h1', { style: { color: 'var(--primary)', fontSize: '28px', marginBottom: '8px'} }, 'BitChat'),
                h('p', { style: { color: 'var(--text-dim)', fontSize: '13px'} }, isLogin ? 'Terminal de Soberanía Criptográfica' : 'Genera tu Identidad Autónoma')
            ]),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px'} }, [
                !isLogin ? Input({ id: 'reg-pub', placeholder: 'Número de Celular' }) : h('div', { style: { background: 'var(--input-bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)'} }, [
                    h('p', { style: { fontSize: '12px', color: 'var(--text-dim)'} }, 'Terminal Vinculada:'),
                    h('p', { style: { fontSize: '14px', fontWeight: '700', color: 'var(--accent-blue)'} }, Estado.me ? Estado.me.idPublico : '')
                ]),
                !isLogin ? Input({ id: 'reg-priv', placeholder: 'Nickname @...' }) : null,
                Input({ type: 'password', id: 'login-pass', placeholder: 'Contraseña Maestra' }),
                Estado.error ? h('p', { style: { color: 'var(--primary)', fontSize: '12px', textAlign: 'center'} }, Estado.error) : null,
                
                h('button', {
                    className: isLogin ? 'btn btn-success' : 'btn btn-primary',
                    id: 'btn-auth-action',
                    onClick: async () => {
                        const passInput = document.getElementById('login-pass') as HTMLInputElement;
                        const pass = passInput.value;
                        if(!isLogin) {
                            const pubInput = document.getElementById('reg-pub') as HTMLInputElement;
                            const privInput = document.getElementById('reg-priv') as HTMLInputElement;
                            const pub = pubInput.value;
                            const priv = privInput.value;
                            if(!pub || !priv || !pass) return alert("Faltan datos");
                            
                            const btn = document.getElementById('btn-auth-action') as HTMLButtonElement;
                            btn.disabled = true; 
                            btn.textContent = 'Validando Identidad...';
                            
                            const isValid = await PeerService.validarIdentidadEnRed(pub, priv, pass);
                            if (!isValid) {
                                Estado.error = "ID ya reclamado con otras credenciales. Usa otro número.";
                                btn.disabled = false; 
                                btn.textContent = 'Generar Identidad';
                                renderApp(); 
                                return;
                            }
                            await BitChatAuth.guardarMisCredenciales(pub, priv, pass);
                            Estado.pantalla = 'AUTH_LOGIN'; 
                            renderApp();
                        } else {
                            if(!(await BitChatAuth.verificarPassword(pass))) { 
                                Estado.error = 'Fallo de derivación'; 
                                renderApp(); 
                                return; 
                            }
                            Estado.masterPassword = pass;
                            
                            // 🚀 Run Migration Protocols
                            await BitChatAuth.migrarContactosSeguros();
                            await DB.migratePlainMessages();

                            if (Estado.me) {
                                await PeerService.inicializarNodo(Estado.me.idPublico);
                            }
                            PeerService.onRefresh = () => { renderApp(); };
                            PeerService.onMessage = (chatId) => { 
                                if(Estado.chatConIdPublico === chatId) {
                                    // Trigger a re-render or partial load
                                    renderApp(); // Simpler for now
                                } else {
                                    renderApp(); 
                                }
                            };
                            Estado.pantalla = 'DASHBOARD'; 
                            renderApp();
                        }
                    }
                }, [isLogin ? 'Desbloquear Terminal' : 'Generar Identidad']),
                h('p', { 
                    style: { textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer', marginTop: '10px' },
                    onClick: () => {
                        Estado.lastPantalla = Estado.pantalla;
                        Estado.pantalla = 'TERMS';
                        renderApp();
                    }
                }, 'Al usar BitChat, aceptas los Términos y Condiciones')
            ])
        ])
    ]);
}