import React from 'react';
import { useStore } from '../store/useStore.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';

export const TermsPage: React.FC = () => {
    const { lastPantalla, setPantalla } = useStore();

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: '20px' }}>
            <Card className="fade-in" style={{ width: '600px', maxHeight: '90vh', padding: '40px', overflowY: 'auto' }}>
                <h1 style={{ color: 'var(--primary)', fontSize: '24px', marginBottom: '20px' }}>Términos y Condiciones</h1>
                <div style={{ color: 'var(--text-main)', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' }}>
                    <p style={{ marginBottom: '15px' }}>bitOS es una terminal soberana y privada. Al utilizar esta aplicación, aceptas los siguientes términos:</p>
                    <h2 style={{ fontSize: '18px', color: 'var(--accent-blue)', marginBottom: '10px' }}>Licencia MIT</h2>
                    <pre style={{ background: 'var(--input-bg)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px', marginBottom: '15px' }}>
{`Copyright (c) 2026 Calimpio

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
SOFTWARE.`}
                    </pre>
                    <h2 style={{ fontSize: '18px', color: 'var(--accent-blue)', marginBottom: '10px' }}>Uso de la Aplicación</h2>
                    <p style={{ marginBottom: '10px' }}>bitOS es una herramienta de comunicación punto a punto (P2P). No almacenamos tus datos en servidores centrales. Eres el único responsable de la seguridad de tus credenciales y de la gestión de tus datos locales.</p>
                    <h2 style={{ fontSize: '18px', color: 'var(--accent-blue)', marginBottom: '10px' }}>Privacidad</h2>
                    <p style={{ marginBottom: '10px' }}>Tus mensajes y contactos residen exclusivamente en tu dispositivo. bitOS utiliza WebRTC para establecer conexiones directas entre pares.</p>
                </div>
                <Button 
                    variant="ghost" 
                    onClick={() => setPantalla((lastPantalla as any) || 'AUTH')}
                >
                    Volver
                </Button>
            </Card>
        </div>
    );
};