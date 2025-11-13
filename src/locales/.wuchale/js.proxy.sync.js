
            import * as _w_c_js_0_ from './main.main.de.compiled.js'
import * as _w_c_js_1_ from './main.main.en.compiled.js'
            /** @type {{[loadID: string]: {[locale: string]: import('wuchale/runtime').CatalogModule}}} */
            const catalogs = {js: {de: _w_c_js_0_,en: _w_c_js_1_}}
            export const loadCatalog = (/** @type {string} */ loadID, /** @type {string} */ locale) => catalogs[loadID][locale]
            export const loadIDs = ['js']
        