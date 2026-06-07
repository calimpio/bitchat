import { h, DOMChild } from '../../utils/dom.ts';

export function Card(props: Record<string, unknown>, children: DOMChild[]) {
    const className = props.className ? `glass-card ${props.className as string}` : 'glass-card';
    return h('div', { ...props, className }, children);
}