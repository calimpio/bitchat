import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './App.tsx';
import { DB, BitChatAuth } from './sdk/index.ts';
import { useStore } from './store/useStore.ts';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = createRoot(rootElement);

DB.init().then(async () => {
    const creds = await BitChatAuth.obtenerMisCredenciales();
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