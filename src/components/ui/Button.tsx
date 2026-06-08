import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'success' | 'ghost';
}

export const Button: React.FC<ButtonProps> = ({ children, onClick, variant = 'primary', className = '', ...props }) => {
    const baseClass = `btn btn-${variant} ${className}`;
    return (
        <button className={baseClass} onClick={onClick} {...props}>
            {children}
        </button>
    );
};