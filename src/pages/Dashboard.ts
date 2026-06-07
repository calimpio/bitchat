import { h, DOMChild } from '../utils/dom.ts';
import { Estado, DB, BitChatAuth, PeerService, CryptoService } from '../sdk/index.ts';
import { Card } from '../components/ui/Card.ts';
import { Button } from '../components/ui/Button.ts';
import { Input } from '../components/ui/Input.ts';
import { Modal } from '../components/ui/Modal.ts';

export async function DashboardPage(renderApp: () => void) {
    if (!Estado.me) return h('div', {}, 'Error: No credentials');

    const misCreds = Estado.me;
    const myFingerprint = misCreds.publicKey ? await CryptoService.getFingerprint(misCreds.publicKey) : '';

    // --- SUB-APP: bitChat ---
    async function bitChatView(): Promise<HTMLElement> {
        const requests = await DB.getRequests();
        const allContactos = await BitChatAuth.obtenerContactos();
        const currentContact = Estado.chatConIdPublico;

        const contactList = h('div', { className: 'contact-list-pane', style: { width: '300px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', borderRight: '1px solid var(--border)', paddingRight: '10px' } }, [
            Button({ text: '+ Añadir Nodo', onClick: () => { Estado.showModalAdd = true; renderApp(); } }),
            requests.length > 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
                h('h4', { className: 'nav-section-title' }, 'Solicitudes'),
                ...await Promise.all(requests.map(async r => {
                    const reqFingerprint = r.publicKey ? await CryptoService.getFingerprint(r.publicKey) : '';
                    return h('div', { className: 'request-card' }, [
                        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                            h('p', { style: { fontSize: '14px', fontWeight: '700' } }, r.idPublico),
                            reqFingerprint ? h('span', { style: { fontSize: '12px' } }, reqFingerprint) : null
                        ]),
                        h('div', { style: { display: 'flex', gap: '8px' } }, [
                            Button({ text: 'Aceptar', variant: 'success', className: 'btn-sm', onClick: async () => { await PeerService.aceptarConexion(r.idPublico); renderApp(); } }),
                            Button({ text: 'X', variant: 'ghost', className: 'btn-sm', onClick: async () => { await DB.deleteRequest(r.idPublico); renderApp(); } })
                        ])
                    ]);
                }))
            ]) : null,
            h('h4', { className: 'nav-section-title' }, 'Contactos'),
            ...Object.keys(allContactos).map(cel => {
                const isSecure = PeerService.conexionesP2PDirectas[cel]?.status === 'SECURE';
                const c = allContactos[cel];
                return h('div', { 
                    className: `user-card ${currentContact === cel ? 'active' : ''}`,
                    onClick: () => { Estado.chatConIdPublico = cel; Estado.mostrarChatMobile = true; renderApp(); }
                }, [
                    h('div', {}, [
                        h('p', { style: { fontWeight: '700', fontSize: '14px', color: c.insecure ? 'var(--primary)' : 'inherit' } }, cel),
                        c.insecure ? h('p', { style: { fontSize: '10px', color: 'var(--primary)' } }, 'SUPLANTACIÓN') : null
                    ]),
                    h('span', { className: `status-badge ${c.insecure ? 'status-insecure' : (isSecure ? 'status-online' : 'status-offline')}` }, c.insecure ? '!' : (isSecure ? 'SECURE' : 'LINK'))
                ]);
            })
        ]);

        const chatArea = h('div', { className: `chat-area-pane ${Estado.mostrarChatMobile ? 'active' : ''}`, style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '10px', marginLeft: '10px' } }, [
            Card({ style: { flex: '1', padding: '15px' } }, [
                h('div', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
                        h('button', { className: 'btn-back-mobile', onClick: () => { Estado.mostrarChatMobile = false; renderApp(); } }, '←'),
                        h('div', {}, [
                            h('h3', { style: { fontSize: '16px'} }, currentContact || 'Selecciona un chat'),
                            currentContact && allContactos[currentContact]?.publicKey ? h('p', { style: { fontSize: '9px', color: 'var(--accent-blue)', letterSpacing: '1px'} }, 
                                await CryptoService.getFingerprint(allContactos[currentContact].publicKey!)
                            ) : null
                        ])
                    ]),
                    currentContact ? h('button', { className: 'btn btn-ghost', style: { padding: '5px' }, onClick: () => { Estado.showModalConfig = true; renderApp(); } }, '⚙') : null
                ]),
                h('div', { id: 'chat-flow', style: { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column' } }),
                h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } }, [
                    Input({ id: 'f-msg', style: { flex: '1' }, placeholder: 'Mensaje...' }),
                    Button({ text: '>', variant: 'success', onClick: async () => {
                        const el = document.getElementById('f-msg') as HTMLInputElement; 
                        const txt = el.value.trim();
                        if (!txt || !Estado.chatConIdPublico) return;
                        await PeerService.enviarMensaje(Estado.chatConIdPublico, txt);
                        el.value = ''; renderApp();
                    }})
                ])
            ])
        ]);

        // History injection
        setTimeout(async () => {
            if (currentContact) {
                Estado.historiales[currentContact] = await DB.getChatMessages(currentContact);
                const flow = document.getElementById('chat-flow');
                if (flow && Estado.me) {
                    const items = (Estado.historiales[currentContact] || []).map(m => {
                        const isMe = m.de === Estado.me!.idPublico;
                        return h('div', { className: `msg-container ${isMe ? 'msg-me' : 'msg-other'}` }, [
                            h('div', { className: 'bubble' }, m.msg),
                            h('div', { style: { fontSize: '9px', color: 'var(--text-dim)', alignSelf: isMe ? 'flex-end' : 'flex-start', marginTop: '2px'} }, 
                                new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (isMe ? (m.status === 'read' ? ' ✓✓' : ' ✓') : '')
                            )
                        ]);
                    });
                    flow.replaceChildren(...items);
                    flow.scrollTop = flow.scrollHeight;
                }
            }
        }, 0);

        return h('div', { className: 'bit-chat-container', style: { display: 'flex', flex: '1', width: '100%', height: '100%', overflow: 'hidden'} }, [
            contactList, chatArea
        ]);
    }

    // --- SUB-APP: Settings ---
    function settingsView(): HTMLElement {
        return h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '500px', margin: '0 auto', width: '100%', overflowY: 'auto'} }, [
            h('h2', { style: { color: 'var(--primary)', textAlign: 'center'} }, 'bitOS Settings'),
            Card({ style: { padding: '20px'} }, [
                h('h4', { style: { marginBottom: '10px', color: 'var(--accent-blue)'} }, 'Dispositivo'),
                h('div', { style: { background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', fontSize: '13px'} }, [
                    h('p', {}, `ID Público: ${misCreds.idPublico}`),
                    h('p', {}, `Nickname: @${misCreds.idPrivado}`),
                    h('p', { style: { color: 'var(--accent-blue)', marginTop: '5px'} }, `Huella: ${myFingerprint}`)
                ])
            ]),
            Card({ style: { padding: '20px'} }, [
                h('h4', { style: { marginBottom: '10px', color: 'var(--secondary)'} }, 'Sincronización'),
                h('p', { style: { fontSize: '12px', color: 'var(--text-dim)', marginBottom: '10px'} }, 'Vincular con otro de mis dispositivos'),
                Input({ type: 'password', id: 'sync-pass', placeholder: 'Contraseña Maestra' }),
                h('div', { style: { marginTop: '10px'} }, [
                    Button({ text: 'Iniciar Sync', variant: 'ghost', onClick: async () => {
                        const pass = (document.getElementById('sync-pass') as HTMLInputElement).value;
                        if (!pass) return alert("Falta contraseña");
                        await PeerService.iniciarSincronizacion(pass);
                    }})
                ])
            ]),
            Card({ style: { padding: '20px'} }, [
                h('h4', { style: { marginBottom: '10px', color: 'var(--primary)'} }, 'Seguridad'),
                Button({ text: 'Borrar Datos Locales', variant: 'primary', onClick: async () => {
                    if (confirm("Se borrarán mensajes y contactos. ¿Continuar?")) {
                        if (DB.db) DB.db.close();
                        const req = indexedDB.deleteDatabase('bitchat_db');
                        req.onsuccess = () => { localStorage.clear(); location.reload(); };
                    }
                }})
            ])
        ]);
    }

    // --- MAIN LAYOUT ---
    const sidebar = h('div', { className: `sidebar ${Estado.showSidebar ? 'active' : ''}` }, [
        h('div', { className: 'sidebar-header' }, [
            h('h2', { style: { color: 'var(--primary)', fontSize: '20px'} }, 'bitOS'),
            h('button', { className: 'btn btn-ghost', style: { padding: '4px' }, onClick: () => { Estado.showSidebar = false; renderApp(); } }, '✕')
        ]),
        h('div', { className: 'sidebar-content' }, [
            h('div', { className: `nav-item ${Estado.activeApp === 'bitChat' ? 'active' : ''}`, 
                onClick: () => { Estado.activeApp = 'bitChat'; renderApp(); } }, '💬 bitChat'),
            h('div', { className: 'nav-item', style: { opacity: 0.4 } }, '📂 bitDrive (Prox)'),
            h('div', { className: 'nav-item', style: { opacity: 0.4 } }, '📱 bitDevices (Prox)'),
        ]),
        h('div', { className: 'sidebar-footer' }, [
            h('div', { className: `nav-item ${Estado.activeApp === 'Settings' ? 'active' : ''}`, 
                onClick: () => { Estado.activeApp = 'Settings'; renderApp(); } }, '⚙ Configuración'),
            h('div', { className: 'nav-item', style: { color: 'var(--primary)'}, onClick: () => location.reload() }, '🔓 Cerrar Terminal')
        ])
    ]);

    const header = h('div', { className: 'header' }, [
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
            h('button', { className: 'btn-menu-mobile', onClick: () => { Estado.showSidebar = !Estado.showSidebar; renderApp(); } }, '☰'),
            h('div', { style: { width: '10px', height: '10px', background: 'var(--success)', borderRadius: '50%'} }),
            h('div', { className: 'mobile-id-info', style: { display: 'none' } }, [
                h('h2', { style: { fontSize: '14px'} }, `@${misCreds.idPrivado}`),
                h('span', { style: { fontSize: '8px', color: 'var(--accent-blue)'} }, myFingerprint)
            ]),
            h('h2', { className: 'desktop-only', style: { fontSize: '16px'} }, `@${misCreds.idPrivado}`),
            h('span', { className: 'desktop-only', style: { fontSize: '10px', color: 'var(--text-dim)'} }, `| ID: ${misCreds.idPublico}`)
        ]),
        h('div', { className: 'desktop-only', style: { fontSize: '12px', color: 'var(--text-dim)'} }, `App: ${Estado.activeApp}`)
    ]);

    // Modals
    const modalAdd = Modal({
        active: Estado.showModalAdd, title: 'Enlazar Nodo',
        children: [
            Input({ id: 'modal-add-id', placeholder: 'ID (Número)' }),
            h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px'} }, [
                Button({ text: 'Cancelar', variant: 'ghost', style: { flex: '1' }, onClick: () => { Estado.showModalAdd = false; renderApp(); } }),
                Button({ text: 'Enlazar', style: { flex: '1' }, onClick: () => {
                    const id = (document.getElementById('modal-add-id') as HTMLInputElement).value.trim();
                    if (id) { PeerService.conectarAContacto(id); Estado.showModalAdd = false; renderApp(); }
                }})
            ])
        ]
    });

    const modalConfig = Modal({
        active: Estado.showModalConfig && !!Estado.chatConIdPublico, title: 'Chat Config',
        children: [
            h('p', { style: { fontSize: '13px', color: 'var(--text-dim)'} }, '¿Eliminar este historial?'),
            h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px'} }, [
                Button({ text: 'Cancelar', variant: 'ghost', style: { flex: '1' }, onClick: () => { Estado.showModalConfig = false; renderApp(); } }),
                Button({ text: 'Eliminar', style: { flex: '1' }, onClick: async () => {
                    if (Estado.chatConIdPublico) {
                        await DB.deleteChat(Estado.chatConIdPublico);
                        await BitChatAuth.eliminarContacto(Estado.chatConIdPublico);
                        Estado.chatConIdPublico = null; Estado.mostrarChatMobile = false; Estado.showModalConfig = false; renderApp();
                    }
                }})
            ])
        ]
    });

    let activeContent: HTMLElement;
    if (Estado.activeApp === 'bitChat') activeContent = await bitChatView();
    else if (Estado.activeApp === 'Settings') activeContent = settingsView();
    else activeContent = h('div', { style: { textAlign: 'center', marginTop: '50px', color: 'var(--text-dim)'} }, 'Próximamente...');

    return h('div', { className: `app-container fade-in ${Estado.showSidebar ? 'sidebar-open' : ''}` }, [
        h('div', { className: `drawer-overlay ${Estado.showSidebar ? 'active' : ''}`, onClick: () => { Estado.showSidebar = false; renderApp(); } }),
        modalAdd, modalConfig,
        header,
        h('div', { className: 'main-content' }, [
            sidebar,
            h('div', { className: 'app-viewport' }, [activeContent])
        ])
    ]);
}