// ═══════════════════════════════════════════════════════════════════════════
//  Winkel- und Filterhilfen
//  Rechenbausteine, die alle sensorgesteuerten Seiten gemeinsam brauchen.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normiert eine Winkeldifferenz auf den Bereich -180° bis 180°.
 *
 * Die Sensorachsen laufen zyklisch (alpha 0–360, beta -180–180). Ohne diese
 * Normierung springt eine Differenz beim Überlaufen der Bereichsgrenze um
 * 360° und die Auswertung kippt auf die falsche Seite.
 *
 * @param {number} deg
 * @returns {number}
 */
export function wrapDeg180(deg) {
    let d = deg;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

/**
 * Begrenzt einen Wert auf ein Intervall.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Ein Schritt Tiefpassfilter (exponentielle Glättung).
 *
 * @param {number} previous bisheriger geglätteter Wert
 * @param {number} target neuer Rohwert
 * @param {number} weight 1 = ungefiltert, kleiner = ruhiger, aber träger
 * @returns {number}
 */
export function lowPass(previous, target, weight) {
    return previous + (target - previous) * weight;
}

/**
 * Nullpunkt einer Sensorachse.
 *
 * Die Rohwerte der Lagesensoren hängen davon ab, wie das Smartphone gerade
 * gehalten wird. Ausgewertet wird deshalb nie der Rohwert, sondern die
 * Abweichung von einem Nullpunkt, der beim ersten Sensor-Event automatisch
 * gesetzt wird. `reset()` verwirft ihn – der nächste Wert kalibriert neu.
 */
export class Baseline {
    /**
     * @param {object} [options]
     * @param {boolean} [options.wrap=true] Differenz auf +-180° normieren
     * @param {number|null} [options.limit=null] Differenz auf +-limit begrenzen
     * @param {(value: number) => void} [options.onCalibrate] Rückmeldung, sobald
     *        der Nullpunkt gesetzt wurde (etwa zum Anzeigen des Werts)
     */
    constructor({ wrap = true, limit = null, onCalibrate = null } = {}) {
        this.value = null;
        this.wrap = wrap;
        this.limit = limit;
        this.onCalibrate = onCalibrate;
    }

    /** true, sobald ein Nullpunkt gesetzt ist. */
    get isSet() {
        return this.value !== null;
    }

    /** Verwirft den Nullpunkt; der nächste Wert kalibriert neu. */
    reset() {
        this.value = null;
    }

    /**
     * Liefert die normierte Abweichung vom Nullpunkt. Beim ersten Aufruf wird
     * der Nullpunkt auf den übergebenen Wert gesetzt (Ergebnis also 0).
     *
     * @param {number} raw Rohwert des Sensors in Grad
     * @returns {number}
     */
    delta(raw) {
        if (this.value === null) {
            this.value = raw;
            if (this.onCalibrate) this.onCalibrate(raw);
        }

        let d = raw - this.value;
        if (this.wrap) d = wrapDeg180(d);
        if (this.limit !== null) d = clamp(d, -this.limit, this.limit);
        return d;
    }
}

/**
 * Erkennt Sprünge im Sensorstrom und lässt sie verwerfen.
 *
 * Nahe der Senkrechten springt der Rohwert von `gamma` sprunghaft um – der
 * Lagesensor verliert dort eine Achse (Gimbal). Ein solcher Sprung ist keine
 * Neigung, sondern ein Rechenartefakt: Wer das Gerät weit zur Seite neigt,
 * bekommt sonst plötzlich den entgegengesetzten Ausschlag.
 *
 * Die Referenz bleibt beim letzten plausiblen Wert stehen, damit auch ein
 * andauernder Umschlag nicht durchschlägt, sondern die Anzeige stehen bleibt,
 * bis das Gerät wieder in den gültigen Bereich zurückkommt.
 *
 *     const sprung = createJumpFilter();
 *     if (sprung.check(gamma)) return;   // Sprung – dieses Bild überspringen
 *
 * @param {object} [options]
 * @param {number} [options.limit=45] Grad, ab denen eine Änderung zwischen
 *        zwei Messwerten als Sprung gilt statt als Bewegung
 * @returns {{ check: (raw: number) => boolean, reset: () => void }}
 */
export function createJumpFilter({ limit = 45 } = {}) {
    let last = null;

    return {
        /** true, wenn dieser Wert ein Sprung ist und verworfen werden soll. */
        check(raw) {
            if (last !== null && Math.abs(raw - last) > limit) return true;
            last = raw;
            return false;
        },

        /** Verwirft die Referenz – der nächste Wert gilt wieder als plausibel. */
        reset() {
            last = null;
        }
    };
}
