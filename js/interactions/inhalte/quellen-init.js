/* Hängt die Zitatmarken einer Station ein: Nummer aus dem Register schreiben
   und Popover verdrahten. Eine Zeile pro Station im HTML genügt. */
import { mountCitations } from '/js/interactions/inhalte/quellen.js';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountCitations());
} else {
    mountCitations();
}
