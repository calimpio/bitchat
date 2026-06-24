import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './App.tsx';
import { DB, BitMsgAuth } from './sdk/index.ts';
import { useStore } from './store/useStore.ts';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = createRoot(rootElement);

// Security: Reset lock timer on any user activity
document.addEventListener('mousedown', () => useStore.getState().resetLockTimer());
document.addEventListener('keydown', () => useStore.getState().resetLockTimer());

// Security: Auto-lock terminal after inactivity or background (using the store timer)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        useStore.getState().resetLockTimer();
    } else {
        // Al ocultarse, nos aseguramos que el timer esté corriendo
        useStore.getState().resetLockTimer();
    }
});

DB.init().then(async () => {
    const creds = await BitMsgAuth.obtenerMisCredenciales();
    if (creds) {
        useStore.getState().setPantalla('AUTH_LOGIN');
        useStore.getState().setMe(creds);
    }
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}).catch(err => {
    console.error("Failed to init DB", err);
});