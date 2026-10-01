// ═══════════════════════════════════════════════════════════════════════════
//  Schüttel-Auswertung (Display-Seite)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Erkennt "langes Schütteln": mehrere Schüttel-Events innerhalb eines
 * Zeitfensters.
 *
 * Ein einzelnes `shake`-Event entsteht schon bei einer kurzen Bewegung. Für
 * Aktionen mit Folgen (Zurücksetzen, Weiterschalten) braucht es eine
 * eindeutige Absicht, also mehrere Ereignisse in kurzer Folge.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs=2000] Zeitfenster in ms
 * @param {number} [options.count=4] Anzahl benötigter Ereignisse im Fenster
 * @returns {{ register: () => boolean, reset: () => void }}
 */
export function createLongShake({ windowMs = 2000, count = 4 } = {}) {
    let timestamps = [];

    return {
        /**
         * Verbucht ein Schüttel-Event.
         * @returns {boolean} true, sobald das Fenster voll ist (dann wird es geleert)
         */
        register() {
            const now = Date.now();
            timestamps.push(now);
            timestamps = timestamps.filter((t) => now - t <= windowMs);

            if (timestamps.length >= count) {
                timestamps = [];
                return true;
            }
            return false;
        },

        /**
         * Wie weit das Fenster gefüllt ist, 0 bis 1.
         *
         * Für Anzeigen gedacht: Langes Schütteln ist sonst eine Geste ohne
         * Rückmeldung, bei der niemand weiß, wie lange noch.
         */
        share() {
            const now = Date.now();
            timestamps = timestamps.filter((t) => now - t <= windowMs);

            return Math.min(1, timestamps.length / count);
        },

        /** Verwirft alle verbuchten Ereignisse. */
        reset() {
            timestamps = [];
        },
    };
}
