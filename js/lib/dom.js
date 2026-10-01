// ═══════════════════════════════════════════════════════════════════════════
//  DOM-Hilfen
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Kurzform für document.getElementById.
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
    return document.getElementById(id);
}

/**
 * Liest mehrere Elemente auf einmal ein: byIds('a', 'b') → { a, b }.
 * @param {...string} ids
 * @returns {Record<string, HTMLElement>}
 */
export function byIds(...ids) {
    const map = {};
    for (const id of ids) map[id] = document.getElementById(id);
    return map;
}
