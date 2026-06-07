export type DOMChild = string | number | HTMLElement | null | undefined | false;

export function h(
    tag: string, 
    props: Record<string, unknown> | DOMChild | DOMChild[] = {}, 
    children: DOMChild | DOMChild[] = []
): HTMLElement {
    const el = document.createElement(tag);
    
    let finalProps: Record<string, unknown> = {};
    let finalChildren: DOMChild[] = [];

    if (
        typeof props === 'string' || 
        typeof props === 'number' || 
        props instanceof HTMLElement || 
        Array.isArray(props) ||
        props === null ||
        props === undefined ||
        props === false
    ) {
        finalChildren = Array.isArray(props) ? props : [props as DOMChild];
        finalProps = {};
    } else {
        finalProps = props as Record<string, unknown>;
        finalChildren = Array.isArray(children) ? children : [children];
    }

    Object.keys(finalProps).forEach(key => {
        const value = finalProps[key];
        if (value === undefined) return;
        
        if (key === 'style' && typeof value === 'object' && value !== null) {
            Object.assign(el.style, value);
        } else if (key === 'className') {
            el.className = value as string;
        } else if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.substring(2).toLowerCase(), value as EventListener);
        } else {
            (el as any)[key] = value; // Still using 'any' here as a bridge to DOM properties
        }
    });

    finalChildren.forEach(child => {
        if (child === null || child === undefined || child === false) return;
        if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(child.toString()));
        } else if (child instanceof HTMLElement) {
            el.appendChild(child);
        }
    });
    
    return el;
}