import { h, DOMChild } from '../utils/dom.ts';
import { Estado, DB, BitChatAuth, PeerService, CryptoService, AppState } from '../sdk/index.ts';
import { Card } from '../components/ui/Card.ts';
import { Button } from '../components/ui/Button.ts';
import { Input } from '../components/ui/Input.ts';
import { Modal } from '../components/ui/Modal.ts';

export async function DashboardPage(renderApp: () => void) {
    if (!Estado.me) return h('div', {}, 'Error: No credentials');

    const misCreds = Estado.me;
    const myFingerprint = misCreds.publicKey ? await CryptoService.getFingerprint(misCreds.publicKey) : '';

    // --- Sub-View: bitChat ---
    async function bitChatView(): Promise<HTMLElement> {
        const requests = await DB.getRequests();
        const allContactos = await BitChatAuth.obtenerContactos();
        const currentContact = Estado.chatConIdPublico;
        const isMobile = window.matchMedia("(max-width: 768px)").matches;

        // Header for BitChat
        const chatHeader = h('div', { style: { marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
                h('button', { className: 'btn-back-mobile', onClick: () => { Estado.mostrarChatMobile = false; renderApp(); } }, '←'),
                h('div', {}, [
                    h('h3', { id: 'chat-header' }, currentContact ? `Canal Seguro: ${currentContact}` : 'Seleccione un nodo operativo'),
                    currentContact && allContactos[currentContact]?.publicKey ? h('p', { style: { fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' } }, [
                        h('span', { style: { marginRight: '5px'} }, 'Huella:'),
                        h('span', { style: { letterSpacing: '2px'} }, await CryptoService.getFingerprint(allContactos[currentContact].publicKey!))
                    ]) : null
                ])
            ]),
            currentContact ? h('button', { className: 'btn btn-ghost', style: { padding: '4px 8px' },
                onClick: () => { Estado.showModalConfig = true; renderApp(); }
            }, '⚙') : null
        ]);

        const contactList = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: '1' } }, [
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
                        c.insecure ? h('p', { style: { fontSize: '10px', color: 'var(--primary)' } }, 'SUPLANTACIÓN DETECTADA') : null
                    ]),
                    h('span', { className: `status-badge ${c.insecure ? 'status-insecure' : (isSecure ? 'status-online' : 'status-offline')}` }, c.insecure ? 'INSECURE' : (isSecure ? 'SECURE' : 'LINK'))
                ]);
            })
        ]);

        const chatArea = h('div', { className: `chat-area ${(Estado.mostrarChatMobile || !isMobile) && currentContact ? 'active' : ''}` }, [
            Card({ style: { flex: '1', padding: '20px' } }, [
                chatHeader,
                h('div', { id: 'chat-flow', style: { flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column' } }),
                h('div', { style: { marginTop: '20px', display: 'flex', gap: '12px' } }, [
                    Input({ id: 'f-msg', style: { flex: '1' }, placeholder: 'Escribir comando...' }),
                    Button({ text: 'Enviar', variant: 'success', onClick: async () => {
                        const el = document.getElementById('f-msg') as HTMLInputElement; 
                        const txt = el.value.trim();
                        if (!txt || !Estado.chatConIdPublico) return;
                        await PeerService.enviarMensaje(Estado.chatConIdPublico, txt);
                        el.value = ''; renderApp();
                    }})
                ])
            ])
        ]);

        // Populate history after render
        setTimeout(async () => {
            if (currentContact) {
                Estado.historiales[currentContact] = await DB.getChatMessages(currentContact);
                const flow = document.getElementById('chat-flow');
                if (flow && Estado.me) {
                    const items = (Estado.historiales[currentContact] || []).map(m => {
                        const isMe = m.de === Estado.me!.idPublico;
                        let checkStr = '✓'; let checkClass = 'check-saved';
                        if (m.status === 'sent') { checkStr = '✓✓'; checkClass = 'check-sent'; }
                        if (m.status === 'read') { checkStr = '✓✓'; checkClass = 'check-read'; }
                        return h('div', { className: `msg-container ${isMe ? 'msg-me' : 'msg-other'}` }, [
                            h('div', { className: 'bubble' }, m.msg),
                            h('div', { className: 'msg-meta' }, [
                                h('span', {}, new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
                                isMe ? h('span', { className: `check ${checkClass}` }, checkStr) : null
                            ])
                        ]);
                    });
                    flow.replaceChildren(...items);
                    flow.scrollTop = flow.scrollHeight;
                }
            }
        }, 0);

        return h('div', { style: { display: 'flex', flex: '1', gap: '24px', overflow: 'hidden'} }, [
            h('div', { className: 'desktop-only', style: { width: '300px', display: 'flex', flexDirection: 'column' } }, [contactList]),
            h('div', { className: 'desktop-only', style: { display: isMobile ? 'none' : 'flex', flex: '1'} }, [chatArea]),
            isMobile ? contactList : null,
            isMobile ? chatArea : null
        ]);
    }

    // --- Sub-View: Settings ---
    async function settingsView(): Promise<HTMLElement> {
        return h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '600px', margin: '0 auto', width: '100%'} }, [
            h('h2', { style: { color: 'var(--primary)'} }, 'Configuración de la Terminal'),
            Card({ style: { padding: '24px'} }, [
                h('h4', { style: { marginBottom: '16px', color: 'var(--accent-blue)'} }, 'Sincronización P2P'),
                h('p', { style: { fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px'} }, 'Transfiere tus contactos y mensajes a otro dispositivo de tu propiedad.'),
                Input({ type: 'password', id: 'sync-pass', placeholder: 'Contraseña Maestra' }),
                h('div', { style: { marginTop: '12px' } }, [
                    Button({ text: '🔄 Iniciar Sincronización', variant: 'ghost', onClick: async () => {
                        const pass = (document.getElementById('sync-pass') as HTMLInputElement).value;
                        if (!pass) return alert("Ingresa tu contraseña.");
                        await PeerService.iniciarSincronizacion(pass);
                    }})
                ])
            ]),
            Card({ style: { padding: '24px'} }, [
                h('h4', { style: { marginBottom: '16px', color: 'var(--primary)'} }, 'Zona de Peligro'),
                h('p', { style: { fontSize: '13px', color: 'var(--text-dim)', marginBottom: '16px'} }, 'Borra permanentemente todos los datos de esta terminal.'),
                Button({ text: '🗑️ Borrar Cuenta y Datos', variant: 'primary', onClick: async () => {
                    if (confirm("¿Estás ABSOLUTAMENTE seguro? Se borrará TODO.")) {
                        if (DB.db) DB.db.close();
                        const req = indexedDB.deleteDatabase('bitchat_db');
                        req.onsuccess = () => { localStorage.clear(); location.reload(); };
                    }
                }})
            ])
        ]);
    }

    // --- Sidebar / Drawer ---
    const sidebar = h('div', { className: `sidebar ${Estado.showMobileMenu ? 'active' : ''}` }, [
        h('div', { className: 'sidebar-header' }, [
            h('h2', { style: { color: 'var(--primary)'} }, 'bitOS'),
            h('button', { className: 'btn btn-ghost', style: { padding: '4px' }, onClick: () => { Estado.showMobileMenu = false; renderApp(); } }, '✕')
        ]),
        h('div', { className: 'sidebar-content' }, [
            h('h4', { className: 'nav-section-title' }, 'Ecosistema'),
            h('div', { className: `nav-item ${Estado.activeApp === 'bitChat' ? 'active' : ''}`, 
                onClick: () => { Estado.activeApp = 'bitChat'; Estado.showMobileMenu = false; renderApp(); } }, '💬 bitChat'),
            h('div', { className: `nav-item ${Estado.activeApp === 'bitDrive' ? 'active' : ''}`, style: { opacity: 0.5, cursor: 'not-allowed'} }, '☁️ bitDrive (Prox)'),
            h('div', { className: `nav-item ${Estado.activeApp === 'bitDevices' ? 'active' : ''}`, style: { opacity: 0.5, cursor: 'not-allowed'} }, '📱 bitDevices (Prox)'),
        ]),
        h('div', { className: 'sidebar-footer' }, [
            h('div', { className: `nav-item ${Estado.activeApp === 'Settings' ? 'active' : ''}`, 
                onClick: () => { Estado.activeApp = 'Settings'; Estado.showMobileMenu = false; renderApp(); } }, '⚙ Configuración'),
            h('div', { className: 'nav-item', style: { color: 'var(--primary)'}, onClick: () => location.reload() }, '🔓 Cerrar Terminal')
        ])
    ]);

    const header = h('div', { className: 'header' }, [
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            h('button', { className: 'btn-menu-mobile', onClick: () => { Estado.showMobileMenu = true; renderApp(); } }, '☰'),
            h('div', { style: { width: '10px', height: '10px', background: 'var(--success)', borderRadius: '50%', boxShadow: '0 0 8px var(--success)' } }),
            h('div', { className: 'mobile-id-info', style: { display: 'none' } }, [
                h('h2', { style: { fontSize: '14px', fontWeight: '700' } }, `@${misCreds.idPrivado}`),
                h('span', { style: { fontSize: '9px', color: 'var(--accent-blue)', letterSpacing: '0.5px'} }, myFingerprint)
            ]),
            h('h2', { className: 'desktop-only', style: { fontSize: '18px', fontWeight: '700' } }, `@${misCreds.idPrivado}`),
            h('div', { className: 'desktop-only', style: { display: 'flex', flexDirection: 'column'} }, [
                h('span', { style: { fontSize: '10px', color: 'var(--text-dim)' } }, `ID: ${misCreds.idPublico}`),
                h('span', { style: { fontSize: '10px', color: 'var(--accent-blue)', letterSpacing: '1px'} }, `Mi Huella: ${myFingerprint}`)
            ])
        ]),
        h('div', { className: 'desktop-only', style: { display: 'flex', gap: '12px' } }, [
            h('span', { style: { color: 'var(--text-dim)', fontSize: '12px', alignSelf: 'center'} }, `App: ${Estado.activeApp}`),
            Button({ text: 'Cerrar Terminal', variant: 'ghost', style: { padding: '6px 12px' }, onClick: () => location.reload() })
        ])
    ]);

    // Modals
    const modalAdd = Modal({
        id: 'modal-add',
        active: Estado.showModalAdd,
        title: 'Enlazar Nuevo Nodo',
        children: [
            Input({ id: 'modal-add-id', placeholder: 'Número de Celular' }),
            h('div', { style: { display: 'flex', gap: '12px', marginTop: '10px' } }, [
                Button({ text: 'Cancelar', variant: 'ghost', style: { flex: '1' }, onClick: () => { Estado.showModalAdd = false; renderApp(); } }),
                Button({ text: 'Enlazar', style: { flex: '1' }, onClick: () => {
                    const input = document.getElementById('modal-add-id') as HTMLInputElement;
                    const id = input.value.trim();
                    if (id) { PeerService.conectarAContacto(id); Estado.showModalAdd = false; renderApp(); }
                }})
            ])
        ]
    });

    const modalConfig = Modal({
        active: Estado.showModalConfig && !!Estado.chatConIdPublico,
        title: 'Configuración del Canal',
        children: [
            h('p', { style: { fontSize: '14px', color: 'var(--text-dim)' } }, '¿Eliminar historial de este chat? Esta acción es irreversible.'),
            h('div', { style: { display: 'flex', gap: '12px', marginTop: '10px' } }, [
                Button({ text: 'Cerrar', variant: 'ghost', style: { flex: '1' }, onClick: () => { Estado.showModalConfig = false; renderApp(); } }),
                Button({ text: 'Eliminar Chat', style: { flex: '1' }, onClick: async () => {
                    if (Estado.chatConIdPublico) {
                        await DB.deleteChat(Estado.chatConIdPublico);
                        await BitChatAuth.eliminarContacto(Estado.chatConIdPublico);
                        Estado.chatConIdPublico = null; Estado.mostrarChatMobile = false; Estado.showModalConfig = false;
                        renderApp();
                    }
                }})
            ])
        ]
    });

    // Content Router
    let content: HTMLElement;
    if (Estado.activeApp === 'bitChat') content = await bitChatView();
    else if (Estado.activeApp === 'Settings') content = await settingsView();
    else content = h('div', { style: { textAlign: 'center', marginTop: '40px'} }, `${Estado.activeApp} próximamente...`);

    return h('div', { className: 'app-container fade-in' }, [
        h('div', { className: `drawer-overlay ${Estado.showMobileMenu ? 'active' : ''}`, onClick: () => { Estado.showMobileMenu = false; renderApp(); } }),
        modalAdd, modalConfig,
        header,
        h('div', { className: 'main-content' }, [
            sidebar,
            h('div', { className: 'app-viewport' }, [content])
        ])
    ]);
}