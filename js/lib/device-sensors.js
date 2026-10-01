// ═══════════════════════════════════════════════════════════════════════════
//  Gerätesensoren (Controller-Seite, läuft auf dem Smartphone)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fragt die Sensorfreigabe an.
 *
 * iOS ab Version 13 gibt die Bewegungssensoren nur nach einer ausdrücklichen
 * Freigabe frei, und der Aufruf muss aus einer Nutzergeste heraus erfolgen –
 * diese Funktion also immer direkt im Click-Handler aufrufen. Android und
 * Desktop brauchen keine Freigabe.
 *
 * Zusätzlich verlangt iOS einen sicheren Kontext: ohne HTTPS schlägt der
 * Aufruf fehl, was hier als eigener Grund gemeldet wird.
 *
 * `prompted` sagt, ob überhaupt ein Dialog nötig war – nur dafür da, dem
 * Nutzer die passende Rückmeldung anzuzeigen.
 *
 * @returns {Promise<{granted: boolean, reason: 'ok'|'unsupported'|'denied'|'insecure-context'|'error', prompted: boolean, error?: Error}>}
 */
export async function requestSensorPermission() {
    if (!('DeviceOrientationEvent' in window)) {
        return { granted: false, reason: 'unsupported', prompted: false };
    }

    // Android / älteres iOS: keine Freigabe nötig
    if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
        return { granted: true, reason: 'ok', prompted: false };
    }

    try {
        const orientation = await DeviceOrientationEvent.requestPermission();

        // Die Schüttel-Erkennung hängt an DeviceMotion und wird getrennt freigegeben.
        let motion = 'granted';
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            motion = await DeviceMotionEvent.requestPermission();
        }

        if (orientation === 'granted' && motion === 'granted') {
            return { granted: true, reason: 'ok', prompted: true };
        }
        return { granted: false, reason: 'denied', prompted: true };
    } catch (error) {
        return {
            granted: false,
            reason: location.protocol !== 'https:' ? 'insecure-context' : 'error',
            prompted: true,
            error,
        };
    }
}

/**
 * Abonniert die Lagewerte des Geräts.
 *
 * @param {(values: {alpha: number|null, beta: number|null, gamma: number|null}) => void} handler
 * @returns {() => void} Abmeldefunktion
 */
export function onOrientation(handler) {
    const listener = (event) => {
        handler({
            alpha: event.alpha, // Kompass-Richtung (0–360)
            beta: event.beta,   // Kippen vor/zurück (-180 bis 180)
            gamma: event.gamma, // Neigen links/rechts (-90 bis 90)
        });
    };

    window.addEventListener('deviceorientation', listener);
    return () => window.removeEventListener('deviceorientation', listener);
}

/**
 * Erkennt Schütteln aus der Beschleunigung des Geräts.
 *
 * `accelerationIncludingGravity` enthält immer die Erdbeschleunigung. Deren
 * Betrag wird abgezogen, sodass ein ruhig gehaltenes Gerät bei etwa 0 liegt,
 * unabhängig davon, wie es gerade gehalten wird.
 *
 * @param {(shake: {intensity: number, force: number}) => void} handler
 * @param {object} [options]
 * @param {number} [options.threshold=8] Auslöseschwelle in m/s²
 * @param {number} [options.cooldownMs=100] Sperrzeit zwischen zwei Ereignissen
 * @param {number} [options.maxForce=15] Kraft, ab der die Intensität 1 erreicht
 * @returns {() => void} Abmeldefunktion
 */
export function onShake(handler, { threshold = 8, cooldownMs = 100, maxForce = 15 } = {}) {
    const GRAVITY = 9.81;
    let lastShakeTime = 0;

    const listener = (event) => {
        const acc = event.accelerationIncludingGravity;
        if (!acc) return;

        const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
        const force = Math.abs(magnitude - GRAVITY);
        const now = Date.now();

        if (force > threshold && now - lastShakeTime > cooldownMs) {
            lastShakeTime = now;
            handler({ intensity: Math.min(force / maxForce, 1), force });
        }
    };

    window.addEventListener('devicemotion', listener);
    return () => window.removeEventListener('devicemotion', listener);
}
