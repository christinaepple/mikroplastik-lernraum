// ═══════════════════════════════════════════════════════════════════════════
//  Abschluss einer Interaktion
//  Ein Modul meldet damit, dass seine Aufgabe erfüllt ist.
// ═══════════════════════════════════════════════════════════════════════════

import { clamp } from './angles.js';

/**
 * Meldet den Abschluss an die einbettende Seite.
 *
 * Gemeldet wird nur, wenn das Modul in einer anderen Seite läuft – im
 * Scrollytelling also, das daraufhin den Übergang zum nächsten Kapitel
 * freigibt. Einzeln geöffnet passiert nichts, die Module bleiben dadurch
 * unverändert für sich lauffähig.
 *
 * Der Weg über `postMessage` statt über den Socket ist Absicht: die Meldung
 * geht genau an die Seite, die dieses Modul eingebettet hat. Über den Server
 * verteilt, käme sie bei allen verbundenen Clients an, und die einbettende
 * Seite könnte nicht unterscheiden, welches Modul gemeint ist.
 *
 * @param {object} [detail]
 * @param {string} [detail.label] kurze Rückmeldung, was erreicht wurde
 */
export function reportCompletion({ label = '' } = {}) {
    if (window.parent === window) return;

    window.parent.postMessage({
        type: 'interaction:complete',
        page: location.pathname,
        label,
    }, location.origin);
}

/** Meldet einen sichtbaren Zwischenstand an die einbettende Seite. */
export function reportProgress({ state = '' } = {}) {
    if (window.parent === window) return;

    window.parent.postMessage({
        type: 'interaction:progress',
        page: location.pathname,
        state,
    }, location.origin);
}

/**
 * Nimmt die Abschlussmeldungen eingebetteter Module entgegen.
 *
 * Angenommen wird nur, was aus dem eigenen Origin kommt. Welcher Rahmen
 * gemeint ist, entscheidet die einbettende Seite anhand von `source` – nur
 * sie weiß, welches Modul sie gerade zeigt.
 *
 * @param {(detail: {label: string, page: string}, source: Window) => void} handler
 */
export function onCompletion(handler) {
    window.addEventListener('message', (event) => {
        if (event.origin !== location.origin) return;
        if (!event.data || event.data.type !== 'interaction:complete') return;

        handler(event.data, event.source);
    });
}

/** Nimmt sichtbare Zwischenstände eines eingebetteten Moduls entgegen. */
export function onProgress(handler) {
    window.addEventListener('message', (event) => {
        if (event.origin !== location.origin) return;
        if (!event.data || event.data.type !== 'interaction:progress') return;

        handler(event.data, event.source);
    });
}

/**
 * Abschlusskriterium für Module ohne Endzustand.
 *
 * Erkunden hat kein natürliches Ende: Lupe und Vergrößerungsglas sind fertig,
 * wenn genug gesehen wurde. Die Fläche wird dafür in ein grobes Raster
 * geteilt, und jede besuchte Zelle zählt. Das misst tatsächliches Erkunden –
 * anders als eine Zeitschaltung, die auch bei liegengelassenem Gerät abläuft.
 *
 * @param {object} [options]
 * @param {number} [options.columns=6] Spalten des Rasters
 * @param {number} [options.rows=4] Zeilen des Rasters
 * @param {number} [options.required=0.6] nötiger Anteil besuchter Zellen
 * @returns {{ mark: (xPct: number, yPct: number) => boolean, share: () => number }}
 */
export function createCoverage({ columns = 6, rows = 4, required = 0.6 } = {}) {
    const visited = new Set();
    const total = columns * rows;
    let isReached = false;

    return {
        /**
         * Verbucht eine Position (jeweils 0 bis 100).
         * @returns {boolean} true genau bei dem Aufruf, der das Ziel erreicht
         */
        mark(xPct, yPct) {
            if (isReached) return false;

            const col = clamp(Math.floor((xPct / 100) * columns), 0, columns - 1);
            const row = clamp(Math.floor((yPct / 100) * rows), 0, rows - 1);
            visited.add(row * columns + col);

            if (visited.size / total < required) return false;

            isReached = true;
            return true;
        },

        /** Anteil der bereits besuchten Zellen, 0 bis 1. */
        share: () => visited.size / total,
    };
}
