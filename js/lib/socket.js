// ═══════════════════════════════════════════════════════════════════════════
//  Socket-Verbindung
//  Eine gemeinsame Socket.IO-Verbindung pro Seite.
// ═══════════════════════════════════════════════════════════════════════════
//
// Die Socket.IO-Client-Bibliothek wird vom Server als klassisches Skript unter
// /socket.io/socket.io.js ausgeliefert und stellt `io` global bereit. Jede
// Seite lädt dieses Skript vor ihrem Modul; klassische Skripte laufen immer
// vor Modulen, `io` ist hier also bereits vorhanden.

if (typeof io !== 'function') {
    throw new Error(
        'Socket.IO-Client fehlt. Die Seite muss <script src="/socket.io/socket.io.js"></script> ' +
        'vor ihrem Modul einbinden.'
    );
}

/** Die Socket-Verbindung dieser Seite. */
export const socket = io();

/**
 * Meldet diese Seite beim Server als Controller an – auch nach einem
 * Reconnect, da der Server die Registrierung pro Verbindung führt.
 * Nur die Controller-Seiten (Smartphone) rufen das auf.
 */
export function registerAsController() {
    if (socket.connected) socket.emit('registerController');
    socket.on('connect', () => socket.emit('registerController'));
}

/**
 * Verknüpft die Kalibrierung dieser Seite mit den anderen Geräten.
 *
 * Der Nullpunkt beschreibt dieselbe Haltung des Smartphones, egal ob er auf
 * dem Gerät selbst oder auf der Anzeige gesetzt wird. Kalibriert eine Seite,
 * ziehen die anderen deshalb mit: `calibrate` läuft auch dann, wenn ein
 * anderes Gerät kalibriert hat.
 *
 * Zurück kommt die Funktion für die eigene Bedienung (Button, Leertaste): Sie
 * kalibriert lokal und sagt es den anderen weiter. Rein interne Kalibrierungen
 * – der erste Sensorwert, das Zurücksetzen nach dem Schütteln – rufen weiter
 * `calibrate` direkt auf und bleiben damit lokal.
 *
 * @param {() => void} calibrate Kalibrierung dieser Seite
 * @returns {() => void} kalibriert hier und auf den anderen Geräten
 */
export function shareCalibration(calibrate) {
    socket.on('calibrate', calibrate);

    return function calibrateEverywhere() {
        calibrate();
        socket.emit('calibrate');
    };
}

/**
 * Erzeugt einen auf einen Frame gedrosselten Sender.
 *
 * Sensoren feuern schneller als der Bildschirm zeichnet. Gesendet wird daher
 * höchstens einmal pro Frame und immer nur der jüngste Wert; `volatile`
 * verwirft Pakete bei Rückstau, statt eine Warteschlange aufzubauen.
 *
 * @param {string} event Name des Socket-Events
 * @returns {(payload: any) => void}
 */
export function createFrameSender(event) {
    let latest = null;
    let scheduled = false;

    return function send(payload) {
        latest = payload;
        if (scheduled) return;

        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            if (latest !== null) socket.volatile.emit(event, latest);
        });
    };
}
