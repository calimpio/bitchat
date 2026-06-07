import { h } from '../utils/dom.ts';
import { Estado, DB, BitChatAuth, PeerService } from '../sdk/index.ts';
import { Card } from '../components/ui/Card.ts';
import { Button } from '../components/ui/Button.ts';
import { Input } from '../components/ui/Input.ts';
import { Modal } from '../components/ui/Modal.ts';

export async function DashboardPage(renderApp: () => void) {
    if (!Estado.me) return h('div', {}, 'Error: No credentials');

    const misCreds = Estado.me;

    const modalAdd = Modal({
        id: 'modal-add',
        active: Estado.showModalAdd,
        title: 'Enlazar Nuevo Nodo',
        children: [
            Input({ id: 'modal-add-id', placeholder: 'Número de Celular' }),
            h('div', { style: { display: 'flex', gap: '12px', marginTop: '10px' } }, [
                Button({ text: 'Cancelar', variant: 'ghost', style: { flex: 1 }, onClick: () => { Estado.showModalAdd = false; renderApp(); } }),
                Button({ text: 'Enlazar', style: { flex: 1 }, onClick: () => {
                    const input = document.getElementById('modal-add-id') as HTMLInputElement;
                    const id = input.value.trim();
                    if (id) { 
                        PeerService.conectarAContacto(id); 
                        Estado.showModalAdd = false; 
                        renderApp(); 
                    }
                }})
            ])
        ]
    });

    const header = h('div', { className: 'header' }, [
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            h('div', { style: { width: '10px', height: '10px', background: 'var(--success)', borderRadius: '50%', boxShadow: '0 0 8px var(--success)' } }),
            h('h2', { style: { fontSize: '18px', fontWeight: '700' } }, `@${misCreds.idPrivado}`),
            h('span', { style: { fontSize: '12px', color: 'var(--text-dim)' } }, `[ID: ${misCreds.idPublico}]`)
        ]),
        h('div', { style: { display: 'flex', gap: '12px' } }, [
            Button({ text: '⚙ Configuración', variant: 'ghost', style: { padding: '6px 12px' }, onClick: () => { Estado.showModalConfig = true; renderApp(); } }),
            Button({ text: 'Cerrar Terminal', variant: 'ghost', style: { padding: '6px 12px' }, onClick: () => location.reload() })
        ])
    ]);

    const requests = await DB.getRequests();
    
    const sidebar = h('div', { id: 'sidebar', className: `sidebar ${!Estado.mostrarChatMobile ? 'active' : ''}` }, [
        Button({ text: '+ Añadir Nodo', onClick: () => { Estado.showModalAdd = true; renderApp(); } }),
        requests.length > 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
            h('h4', { style: { fontSize: '12px', color: 'var(--primary)', marginTop: '10px' } }, 'Solicitudes Pendientes'),
            ...requests.map(r => h('div', { className: 'request-card' }, [
                h('p', { style: { fontSize: '14px', fontWeight: '700' } }, r.idPublico),
                h('div', { style: { display: 'flex', gap: '8px' } }, [
                    Button({ text: 'Aceptar', variant: 'success', className: 'btn-sm', onClick: async () => { await PeerService.aceptarConexion(r.idPublico); renderApp(); } }),
                    Button({ text: 'X', variant: 'ghost', className: 'btn-sm', onClick: async () => { await DB.deleteRequest(r.idPublico); renderApp(); } })
                ])
            ]))
        ]) : null,
        h('h4', { style: { fontSize: '12px', color: 'var(--text-dim)', marginTop: '10px' } }, 'Contactos'),
        h('div', { id: 'contact-list', style: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 } }, [
            ...Object.keys(BitChatAuth.obtenerContactos()).map(cel => {
                const isSecure = PeerService.conexionesP2PDirectas[cel]?.status === 'SECURE';
                const c = BitChatAuth.obtenerContactos()[cel];
                return h('div', { 
                    className: `user-card ${Estado.chatConIdPublico === cel ? 'active' : ''}`,
                    onClick: () => { Estado.chatConIdPublico = cel; Estado.mostrarChatMobile = true; renderApp(); }
                }, [
                    h('div', {}, [
                        h('p', { style: { fontWeight: '700', fontSize: '14px', color: c.insecure ? 'var(--primary)' : 'inherit' } }, cel),
                        c.insecure ? h('p', { style: { fontSize: '10px', color: 'var(--primary)' } }, 'SUPLANTACIÓN DETECTADA') : null
                    ]),
                    h('span', { className: `status-badge ${c.insecure ? 'status-insecure' : (isSecure ? 'status-online' : 'status-offline')}` }, c.insecure ? 'INSECURE' : (isSecure ? 'SECURE' : 'LINK'))
                ]);
            })
        ])
    ]);

    const currentContact = Estado.chatConIdPublico;
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    
    const chatArea = h('div', { 
        id: 'chat-area', 
        className: `chat-area ${(Estado.mostrarChatMobile || !isMobile) && currentContact ? 'active' : ''}` 
    }, [
        Card({ style: { flex: 1, padding: '20px' } }, [
            h('div', { style: { marginBottom: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
                    h('button', { className: 'btn-back-mobile', onClick: () => { Estado.mostrarChatMobile = false; renderApp(); } }, '←'),
                    h('h3', { id: 'chat-header' }, currentContact ? `Canal Seguro: ${currentContact}` : 'Seleccione un nodo operativo')
                ]),
                h('button', { className: 'btn btn-ghost', style: { padding: '4px 8px', display: currentContact ? 'block' : 'none' },
                    onClick: () => { Estado.showModalConfig = true; renderApp(); }
                }, '⚙')
            ]),
            h('div', { id: 'chat-flow', style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } }),
            h('div', { style: { marginTop: '20px', display: 'flex', gap: '12px' } }, [
                Input({ id: 'f-msg', style: { flex: 1 }, placeholder: 'Escribir comando de mensaje...' }),
                Button({ text: 'Enviar', variant: 'success', onClick: async () => {
                    const el = document.getElementById('f-msg') as HTMLInputElement; 
                    const txt = el.value.trim();
                    if (!txt || !Estado.chatConIdPublico) return;
                    await PeerService.enviarMensaje(Estado.chatConIdPublico, txt);
                    el.value = ''; 
                    renderApp(); // Re-render to load history
                }})
            ])
        ])
    ]);

    const modalConfig = Modal({
        active: Estado.showModalConfig && !!Estado.chatConIdPublico,
        title: 'Configuración del Canal',
        children: [
            h('p', { style: { fontSize: '14px', color: 'var(--text-dim)' } }, '¿Estás seguro de que deseas eliminar este chat y todo su historial? Esta acción es irreversible.'),
            h('div', { style: { display: 'flex', gap: '12px', marginTop: '10px' } }, [
                Button({ text: 'Cerrar', variant: 'ghost', style: { flex: 1 }, onClick: () => { Estado.showModalConfig = false; renderApp(); } }),
                Button({ text: 'Eliminar Chat', style: { flex: 1 }, onClick: async () => {
                    if (Estado.chatConIdPublico) {
                        await DB.deleteChat(Estado.chatConIdPublico);
                        const contactos = BitChatAuth.obtenerContactos(); 
                        delete contactos[Estado.chatConIdPublico];
                        localStorage.setItem('bitchat_auth_contacts', JSON.stringify(contactos));
                        Estado.chatConIdPublico = null; 
                        Estado.mostrarChatMobile = false; 
                        Estado.showModalConfig = false;
                        renderApp();
                    }
                }})
            ])
        ]
    });

    const modalAccount = Modal({
        active: Estado.showModalConfig && !Estado.chatConIdPublico,
        title: 'Configuración de la Terminal',
        children: [
            h('p', { style: { fontSize: '14px', color: 'var(--text-dim)' } }, '¿Deseas eliminar permanentemente tu cuenta y todos los datos locales? Se borrarán tus credenciales, contactos y todos los mensajes.'),
            h('div', { style: { marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '20px' } }, [
                h('h4', { style: { fontSize: '14px', marginBottom: '10px', color: 'var(--accent-blue)' } }, 'Sincronizar Dispositivos'),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
                    Input({ type: 'password', id: 'sync-pass', placeholder: 'Confirma tu Contraseña Maestra' }),
                    Button({ text: '🔄 Iniciar Sincronización P2P', variant: 'ghost', onClick: async () => {
                        const passInput = document.getElementById('sync-pass') as HTMLInputElement;
                        const pass = passInput.value; 
                        if (!pass) return alert("Ingresa tu contraseña.");
                        const success = await PeerService.iniciarSincronizacion(pass);
                        if (!success) alert("No se encontraron dispositivos o contraseña incorrecta.");
                    }})
                ])
            ]),
            h('div', { style: { display: 'flex', gap: '12px', marginTop: '20px' } }, [
                Button({ text: 'Cerrar', variant: 'ghost', style: { flex: 1 }, onClick: () => { Estado.showModalConfig = false; renderApp(); } }),
                Button({ text: 'Borrar Cuenta', style: { flex: 1 }, onClick: async () => {
                    if (confirm("¿Estás ABSOLUTAMENTE seguro? Se borrará TODO.")) {
                        if (DB.db) DB.db.close();
                        const req = indexedDB.deleteDatabase('bitchat_db');
                        req.onsuccess = () => { localStorage.clear(); location.reload(); };
                    }
                }})
            ])
        ]
    });

    // Populate chat history after render
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

    return h('div', { className: 'app-container fade-in' }, [
        modalAdd, 
        modalConfig, 
        modalAccount, 
        header, 
        h('div', { className: 'main-content' }, [sidebar, chatArea])
    ]);
}