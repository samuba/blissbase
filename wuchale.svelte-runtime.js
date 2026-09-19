// @ts-check
import { getFuncNameNested } from 'wuchale/adapter-utils'

/** Same as @wuchale/svelte defaults, but `.svelte.ts` is treated like `.svelte.js`. */
export const svelteTsModuleRuntime = {
    initReactive: (path, file, { module }) => {
        const [funcName] = getFuncNameNested(path);
        const inTopLevel = funcName == null;
        return isSvelteScriptModule(file) || module ? inTopLevel : inTopLevel ? true : null;
    },
    useReactive: (path, file, { module }) => {
        const [funcName] = getFuncNameNested(path);
        return isSvelteScriptModule(file) || module ? funcName == null : true;
    },
};

function isSvelteScriptModule(file) {
    return file.endsWith(`.svelte.js`) || file.endsWith(`.svelte.ts`);
}
