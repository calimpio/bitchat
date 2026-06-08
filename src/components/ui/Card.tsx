import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className, ...props }) => {
    const combinedClassName = className ? `glass-card ${className}` : 'glass-card';
    return (
        <div {...props} className={combinedClassName}>
            {children}
        </div>
    );
};