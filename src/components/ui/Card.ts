import { h } from '../../utils/dom.ts';

export function Card(props: any, children: any[]) {
    const className = props.className ? `glass-card ${props.className}` : 'glass-card';
    return h('div', { ...props, className }, children);
}