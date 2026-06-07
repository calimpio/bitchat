import { h } from '../../utils/dom.ts';

interface ButtonProps {
    text: string;
    onClick: () => void;
    variant?: 'primary' | 'success' | 'ghost';
    className?: string;
    style?: any;
    id?: string;
    disabled?: boolean;
}

export function Button({ text, onClick, variant = 'primary', className = '', style = {}, id, disabled }: ButtonProps) {
    const baseClass = `btn btn-${variant} ${className}`;
    return h('button', {
        id,
        className: baseClass,
        onClick,
        style,
        disabled
    }, [text]);
}