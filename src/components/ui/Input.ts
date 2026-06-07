import { h } from '../../utils/dom.ts';

interface InputProps {
    id: string;
    placeholder: string;
    type?: string;
    className?: string;
    style?: Partial<CSSStyleDeclaration>;
    value?: string;
}

export function Input({ id, placeholder, type = 'text', className = '', style = {}, value }: InputProps) {
    const inputProps: Record<string, unknown> = {
        id,
        type,
        placeholder,
        className: `terminal-input ${className}`,
        style
    };
    if (value !== undefined) inputProps.value = value;
    
    return h('input', inputProps);
}