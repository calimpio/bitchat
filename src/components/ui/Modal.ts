import { h } from '../../utils/dom.ts';
import { Card } from './Card.ts';

interface ModalProps {
    id?: string;
    active: boolean;
    title: string;
    children: any[];
}

export function Modal({ id, active, title, children }: ModalProps) {
    return h('div', { id, className: `modal-overlay ${active ? 'active' : ''}` }, [
        Card({ className: 'modal-content', style: { padding: '30px' } }, [
            h('h3', { style: { marginBottom: '20px', color: 'var(--accent-blue)' } }, title),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, children)
        ])
    ]);
}