import { h } from '../utils/dom.ts';
import { Estado, AppState } from '../sdk/index.ts';
import { Card } from '../components/ui/Card.ts';
import { Button } from '../components/ui/Button.ts';

export function TermsPage(renderApp: () => void) {
    return h('div', { style: { display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '20px' } }, [
        Card({ className: 'fade-in', style: { width: '600px', maxHeight: '90vh', padding: '40px', overflowY: 'auto' } }, [
            h('h1', { style: { color: 'var(--primary)', fontSize: '24px', marginBottom: '20px' } }, 'Términos y Condiciones'),
            h('div', { style: { color: 'var(--text-main)', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' } }, [
                h('p', { style: { marginBottom: '15px' } }, 'BitChat es una terminal de mensajería soberana y privada. Al utilizar esta aplicación, aceptas los siguientes términos:'),
                h('h2', { style: { fontSize: '18px', color: 'var(--accent-blue)', marginBottom: '10px' } }, 'Licencia MIT'),
                h('pre', { style: { background: 'var(--input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px', marginBottom: '15px' } }, `Copyright (c) 2026 Calimpio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`),
                h('h2', { style: { fontSize: '18px', color: 'var(--accent-blue)', marginBottom: '10px' } }, 'Uso de la Aplicación'),
                h('p', { style: { marginBottom: '10px' } }, 'BitChat es una herramienta de comunicación punto a punto (P2P). No almacenamos tus datos en servidores centrales. Eres el único responsable de la seguridad de tus credenciales y de la gestión de tus datos locales.'),
                h('h2', { style: { fontSize: '18px', color: 'var(--accent-blue)', marginBottom: '10px' } }, 'Privacidad'),
                h('p', { style: { marginBottom: '10px' } }, 'Tus mensajes y contactos residen exclusivamente en tu dispositivo. BitChat utiliza WebRTC para establecer conexiones directas entre pares.')
            ]),
            Button({ 
                text: 'Volver', 
                variant: 'ghost', 
                onClick: () => { 
                    Estado.pantalla = (Estado.lastPantalla as AppState['pantalla']) || 'AUTH';
                    renderApp(); 
                } 
            })
        ])
    ]);
}