export function h(tag: string, props: any = {}, children: any = []): HTMLElement {
    const el = document.createElement(tag);
    if (typeof props === 'string' || Array.isArray(props) || props instanceof HTMLElement) {
        children = props as any;
        props = {};
    }
    Object.keys(props).forEach(key => {
        if (props[key] === undefined) return;
        if (key === 'style' && typeof props[key] === 'object') {
            Object.assign(el.style, props[key]);
        } else if (key === 'className') {
            el.className = props[key];
        } else if (key.startsWith('on') && typeof props[key] === 'function') {
            el.addEventListener(key.substring(2).toLowerCase(), props[key]);
        } else {
            (el as any)[key] = props[key];
        }
    });
    const childrenArray = Array.isArray(children) ? children : [children];
    childrenArray.forEach(child => {
        if (child === null || child === undefined || child === false) return;
        if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(child.toString()));
        } else if (child instanceof HTMLElement) {
            el.appendChild(child);
        }
    });
    return el;
}