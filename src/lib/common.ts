export function debounce(func: (...args: unknown[]) => void, wait: number) {
    let timeout: NodeJS.Timeout;
    return function executedFunction(...args: unknown[]) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
