// ═══════════════════════════════════════════════════════════════════════════
//  Verbindungsanzeige
//  Das Badge im Kopfbereich jeder Display-Seite.
// ═══════════════════════════════════════════════════════════════════════════

import { socket } from './socket.js';
import { byId } from './dom.js';

/**
 * Verdrahtet das Status-Badge (#connBadge / #connStatusText) mit dem Socket.
 *
 * "Online" meldet die Anzeige nur, wenn beides zutrifft: die eigene
 * Socket-Verbindung steht UND der Server kennt einen registrierten Controller.
 * Ein laufender Server ohne gekoppeltes Smartphone bleibt also offline.
 *
 * @param {object} [options]
 * @param {() => void} [options.onDisconnect] wird bei Verbindungsverlust
 *        aufgerufen, damit die Seite ihren Interaktionszustand zurücksetzen kann
 * @returns {{ isOnline: () => boolean, hasController: () => boolean }}
 */
export function initConnectionBadge({ onDisconnect = null } = {}) {
    const badge = byId('connBadge');
    const statusText = byId('connStatusText');

    let isSystemOnline = false;
    let isControllerConnected = false;

    function render() {
        // 'ready' ist ein Zwischenzustand, den einige Seiten im Markup nutzen;
        // das Entfernen ist auf allen anderen Seiten ein No-op.
        badge.classList.remove('connected', 'ready');

        if (isSystemOnline && isControllerConnected) {
            badge.classList.add('connected');
            statusText.textContent = 'Online';
        } else {
            statusText.textContent = 'Offline';
        }
    }

    socket.on('connect', () => {
        isSystemOnline = true;
        render();
    });

    socket.on('disconnect', () => {
        isSystemOnline = false;
        isControllerConnected = false;
        render();
        if (onDisconnect) onDisconnect();
    });

    socket.on('controllerStatus', (status) => {
        isControllerConnected = status.connected;
        render();
    });

    render();

    return {
        isOnline: () => isSystemOnline && isControllerConnected,
        // Für Seiten mit Maus-Fallback: der greift nur, wenn kein Smartphone hängt.
        hasController: () => isControllerConnected,
    };
}
