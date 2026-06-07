import './style.css';
import { DB, BitChatAuth, Estado } from './sdk/index.ts';
import { AuthPage } from './pages/Auth.ts';
import { DashboardPage } from './pages/Dashboard.ts';

async function render() {
    const root = document.getElementById('root');
    if (!root) return;

    if (Estado.pantalla === 'AUTH' || Estado.pantalla === 'AUTH_LOGIN') {
        const authContent = AuthPage(render);
        root.replaceChildren(authContent);
    } else if (Estado.pantalla === 'DASHBOARD') {
        const dashContent = await DashboardPage(render);
        root.replaceChildren(dashContent);
    }
}

DB.init().then(async () => {
    const creds = await BitChatAuth.obtenerMisCredenciales();
    if (creds) {
        Estado.pantalla = 'AUTH_LOGIN';
    }
    render();
}).catch(err => {
    console.error("Failed to init DB", err);
});