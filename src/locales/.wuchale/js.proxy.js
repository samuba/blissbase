
            /** @type {{[loadID: string]: {[locale: string]: () => Promise<import('wuchale/runtime').CatalogModule>}}} */
            const catalogs = {js: {de: () => import('./main.main.de.compiled.js'),en: () => import('./main.main.en.compiled.js')}}
            export const loadCatalog = (/** @type {string} */ loadID, /** @type {string} */ locale) => catalogs[loadID][locale]()
            export const loadIDs = ['js']
        