import React from 'react';
import { useStore } from './store/useStore.ts';
import { AuthPage } from './pages/Auth.tsx';
import { TermsPage } from './pages/Terms.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';

export const App: React.FC = () => {
    const { pantalla } = useStore();

    return (
        <div className="app-viewport">
            {(pantalla === 'AUTH' || pantalla === 'AUTH_LOGIN') && <AuthPage />}
            {pantalla === 'TERMS' && <TermsPage />}
            {pantalla === 'DASHBOARD' && <DashboardPage />}
        </div>
    );
};