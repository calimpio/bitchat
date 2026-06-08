import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input: React.FC<InputProps> = ({ className, ...props }) => {
    const combinedClassName = className ? `terminal-input ${className}` : 'terminal-input';
    return (
        <input {...props} className={combinedClassName} />
    );
};