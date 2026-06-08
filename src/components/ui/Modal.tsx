import React from 'react';
import { Card } from './Card.tsx';

interface ModalProps {
    active: boolean;
    title: string;
    onClose?: () => void;
    children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ active, title, children, onClose }) => {
    if (!active) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <Card style={{ padding: '24px', width: '90%', maxWidth: '400px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0 }}>{title}</h3>
                        <button className="btn btn-ghost" style={{ padding: '4px' }} onClick={onClose}>✕</button>
                    </div>
                    {children}
                </Card>
            </div>
        </div>
    );
};