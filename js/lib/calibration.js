// ═══════════════════════════════════════════════════════════════════════════
//  Kalibrierung vorweg
//  Ein Overlay, das vor der eigentlichen Station steht: Erst wird die Mitte
//  aus einer ruhigen Haltung gesetzt, dann geht es los.
//
//  Der Grund ist ein wiederkehrendes Ärgernis: Der Nullpunkt entstand bisher
//  beiläufig beim ersten Sensorwert. Wer eine Station in Bewegung betrat,
//  bekam dadurch eine schiefe Mitte und musste nachkalibrieren. Hier wird der
//  Nullpunkt erst gesetzt, wenn das Gerät nachweislich still liegt.
//
//  Zwei Zustände, beide am Punkt der Eintragspfade abgelesen:
//    • ohne Controller wabert er und bittet um die Verbindung
//    • mit Controller zieht sich ein Ring in ihn hinein; er ist die Anzeige,
//      wie lange noch stillzuhalten ist
//
//  Stationen, die keinen Nullpunkt brauchen – etwa solche, die nur die
//  Änderung eines Winkels auswerten –, können mit `waitForStillness: false`
//  allein die erste Hälfte nutzen: Dann ist es nur noch die Aufforderung, das
//  Smartphone zu verbinden, und sie geht weg, sobald eines da ist.
//
//  Markup und Stil bringt das Modul selbst mit – einzubinden ist es damit in
//  zwei Zeilen, ohne Eingriff in das HTML einer Station:
//
//      const gate = initCalibration({ onCalibrate: calibrateEverywhere });
//      ...
//      socket.on('sensorData', (data) => {
//          if (gate.isActive()) return;   // während der Kalibrierung nichts tun
//          ...
//      });
// ═══════════════════════════════════════════════════════════════════════════

import { socket } from './socket.js';

const STYLE_ID = 'calibration-style';

// Der Stil wird einmal je Seite eingehängt, nicht je Aufruf.
function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.calib {
    position: absolute;
    inset: 0;
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--calib-bg, #ffffff);
    transition: opacity 0.6s ease;
}

/* Solange nicht feststeht, ob ein Gerät hängt, ist das Overlay zwar da, aber
   unsichtbar: Der Server meldet den Controller-Status erst kurz nach dem
   Verbinden, und bis dahin stünde sonst „bitte verbinden“ auf dem Schirm –
   auch wenn längst ein Smartphone gekoppelt ist. Ohne Übergang, damit in
   diesem Moment nichts aufblendet; das Erscheinen später blendet dann weich
   auf. */
.calib.is-pending {
    opacity: 0;
    pointer-events: none;
    transition: none;
}

.calib.is-gone {
    opacity: 0;
    pointer-events: none;
}

/* Auf derselben Mitte wie der Punkt, waagerecht wie senkrecht, und in einer
   Zeile quer über ihn hinweg. */
.calib-text {
    position: absolute;
    left: 50%;
    top: 12%;
    transform: translate(-50%, -50%);
    z-index: 2;
    margin: 0;
    white-space: nowrap;
    font-family: inherit;
    /* TEST: an den Einführungsspiel-Hint (.instruction / .lehre-instruction)
       angeglichen – Größe, Gewicht, Farbe, Kleinschreibung und Position Y.
       Zum Zurücknehmen: top: 50%, font-size 18px, font-weight 600,
       color var(--calib-text-color, #0f172a), ohne text-transform. */
    font-size: 1rem;
    font-weight: 400;
    text-transform: lowercase;
    color: var(--calib-text-color, var(--instruction-color));
}

.calib-mark {
    position: relative;
    width: var(--calib-dot);
    height: var(--calib-dot);
    display: flex;
    align-items: center;
    justify-content: center;
}

/* \`fill\` statt \`contain\`: Das Punktbild ist nicht exakt quadratisch.
   Eingepasst bliebe es schmaler als sein Rahmen, und die Scheibe, in die der
   Ring am Ende übergeht, schaute seitlich unter ihm hervor. */
.calib-mark img {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    object-fit: fill;
}

/* \`box-sizing\` muss hier eigens stehen: Der übliche Reset setzt \`*\`, und der
   Universalselektor erfasst keine Pseudo-Elemente. Ohne das rechnet der Ring im
   content-box-Modus und ist um seine Randbreite auf jeder Seite zu groß. */
.calib-mark::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    box-sizing: border-box;
    width: var(--calib-spread);
    height: var(--calib-spread);
    border: 7px solid transparent;
    border-radius: 50%;
    /* Zentriert über \`translate\`, das sich auf die eigene Größe bezieht und
       deshalb in jeder Phase mittig bleibt – \`margin: auto\` versagt, sobald
       die Welle über ihren Container hinauswächst. */
    transform: translate(-50%, -50%);
}

/* Ohne Controller wabert der Punkt: die Welle läuft nach außen und verblasst,
   immer wieder. */
.calib-mark.is-waiting::before {
    animation: calib-wabern 1500ms linear infinite;
}

@keyframes calib-wabern {
    from {
        width: calc(var(--calib-dot) * 1.16);
        height: calc(var(--calib-dot) * 1.16);
        border-width: calc(var(--calib-dot) * 0.24);
        border-color: rgba(var(--calib-accent-rgb), 0.6);
    }

    to {
        width: var(--calib-spread);
        height: var(--calib-spread);
        border-width: calc(var(--calib-dot) * 0.064);
        border-color: rgba(var(--calib-accent-rgb), 0);
    }
}

/* Mit Controller zieht sich der Ring von der größten Ausbreitung in den Punkt
   hinein. Die Dauer setzt das Skript (--calib-hold), damit Anzeige und
   verlangte Ruhezeit nicht auseinanderlaufen können. */
.calib-mark.is-holding::before {
    animation: calib-einzug var(--calib-hold) linear forwards;
}

@keyframes calib-einzug {
    from {
        width: var(--calib-spread);
        height: var(--calib-spread);
        border-width: 7px;
        border-color: rgba(var(--calib-accent-rgb), 0.45);
    }

    /* Am Ende genau die Größe des Punktes, und mit einem Strich von der halben
       Breite eine volle Scheibe: Sie deckt sich damit exakt mit ihm – die
       Ausbreitung wird zum Punkt selbst. */
    to {
        width: var(--calib-dot);
        height: var(--calib-dot);
        border-width: calc(var(--calib-dot) / 2);
        border-color: rgba(var(--calib-accent-rgb), 1);
    }
}
`;

    document.head.appendChild(style);
}

/**
 * Stellt die Kalibrierung vor eine Station.
 *
 * @param {object} options
 * @param {() => void} options.onCalibrate setzt den Nullpunkt – in der Regel
 *        das `calibrateEverywhere` der Station, damit Anzeige und Handy
 *        zugleich kalibrieren
 * @param {() => void} [options.onDone] läuft, sobald das Overlay abgeblendet
 *        ist und die Station übernehmen kann
 * @param {Element} [options.parent=document.body] worin das Overlay liegt. Eine
 *        positionierte Bühne mitzugeben lohnt sich: Dann bleibt die Kopfzeile
 *        mit „Zurück" erreichbar, während kalibriert wird.
 * @param {number} [options.holdMs=2200] wie lange still zu halten ist. Bewusst
 *        länger als das Setzen selbst braucht – wer dem Ring zusieht, hält das
 *        Gerät auch wirklich einen Moment ruhig.
 * @param {number} [options.motion=2.5] Grad, ab denen eine Lageänderung als
 *        Bewegung zählt. Der Sensorstrom läuft auch beim ruhig gehaltenen Gerät
 *        weiter; das Rauschen liegt darunter.
 * @param {string} [options.dot='110px'] Durchmesser des Punktes
 * @param {string} [options.spread='360px'] größte Ausbreitung des Rings
 * @param {string} [options.accentRgb='252, 101, 91'] Akzentfarbe als
 *        RGB-Tripel, damit sich daraus die durchscheinenden Stufen bilden lassen
 * @param {string} [options.image] Pfad des Punktbildes
 * @param {string} [options.textOffline]
 * @param {string} [options.textOnline]
 * @returns {{ isActive: () => boolean, skip: () => void }}
 */
export function initCalibration({
    onCalibrate = null,
    onDone = null,
    waitForStillness = true,
    parent = document.body,
    holdMs = 2200,
    motion = 2.5,
    dot = '110px',
    spread = '360px',
    accentRgb = '252, 101, 91',
    image = '/img/interactionen/eintragspfade/punkt.png',
    textOffline = 'bitte verbinden',
    textOnline = 'ruhig halten zum kalibrieren',
} = {}) {
    ensureStyle();

    // Dauer des Ausblendens – muss zum Übergang in der Stilregel oben passen.
    const FADE_MS = 600;

    const root = document.createElement('div');
    root.className = 'calib is-pending';
    root.style.setProperty('--calib-dot', dot);
    root.style.setProperty('--calib-spread', spread);
    root.style.setProperty('--calib-hold', holdMs + 'ms');
    root.style.setProperty('--calib-accent-rgb', accentRgb);

    // Der Text steht anfangs auf „verbinden": Beim Laden ist die Verbindung
    // noch nicht gemeldet, so blitzt der falsche Zustand nicht auf.
    const text = document.createElement('p');
    text.className = 'calib-text';
    text.textContent = textOffline;

    const mark = document.createElement('div');
    mark.className = 'calib-mark is-waiting';

    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    mark.appendChild(img);

    root.append(text, mark);
    parent.appendChild(root);

    // Wie lange höchstens auf den Controller-Status gewartet wird. Kommt er
    // nicht – etwa weil der Server nicht läuft –, ist die Lage ohnehin
    // „offline", und das Overlay gehört auf den Schirm.
    const REVEAL_MS = 700;

    let isActive = true;
    let isDone = false;
    let isRevealed = false;
    let stillSince = 0;
    let last = null;      // letzte Rohwerte, gegen die die Ruhe geprüft wird

    // Der eigene Blick auf den Verbindungszustand, nach derselben Regel wie die
    // Anzeige in der Kopfzeile: online ist nur, wer verbunden ist UND ein
    // Smartphone gekoppelt hat.
    let isSystemOnline = false;
    let hasController = false;

    // Ab hier ist der Zustand bekannt und das Overlay darf sich zeigen.
    function reveal() {
        if (isRevealed || isDone) return;
        isRevealed = true;
        root.classList.remove('is-pending');
    }

    function updatePhase() {
        if (isDone) return;

        if (isSystemOnline && hasController) {
            // Ohne Stillhalte-Phase ist das Verbinden schon das Ziel: Es gibt
            // keinen Nullpunkt zu setzen, also auch nichts abzuwarten.
            if (!waitForStillness) {
                finish();
                return;
            }

            text.textContent = textOnline;
            mark.classList.remove('is-waiting');
            return;
        }

        // Ohne Controller gibt es nichts zu kalibrieren; ein angefangener
        // Einzug wird verworfen und beginnt nach dem Verbinden von vorn.
        text.textContent = textOffline;
        mark.classList.remove('is-holding');
        mark.classList.add('is-waiting');
        stillSince = 0;
        last = null;
    }

    /**
     * Lässt den Ring von vorn einziehen. Die Klasse wird dafür erst abgenommen
     * und nach einem erzwungenen Umbruch wieder gesetzt – sonst liefe die
     * Animation beim erneuten Setzen weiter, statt neu zu beginnen.
     */
    function restartRing() {
        mark.classList.remove('is-waiting', 'is-holding');
        void mark.offsetWidth;
        mark.classList.add('is-holding');
    }

    /** Jede Lageänderung über der Schwelle stellt die Uhr zurück. */
    function watchStillness(gamma, beta) {
        if (isDone) return;

        const bewegt = last
            && (Math.abs(gamma - last.gamma) > motion
                || Math.abs(beta - last.beta) > motion);

        last = { gamma, beta };

        if (bewegt || !stillSince) {
            stillSince = Date.now();
            restartRing();
            return;
        }

        if (Date.now() - stillSince >= holdMs) finish();
    }

    function finish() {
        if (isDone) return;
        isDone = true;

        if (onCalibrate) onCalibrate();

        // War es nie zu sehen, gibt es auch nichts abzublenden – sonst
        // flackerte am Anfang genau das auf, was hier vermieden werden soll.
        if (!isRevealed) {
            isActive = false;
            root.remove();
            if (onDone) onDone();
            return;
        }

        root.classList.add('is-gone');

        // Erst wenn es abgeblendet ist, nimmt die Station die Neigung entgegen.
        setTimeout(() => {
            isActive = false;
            root.remove();
            if (onDone) onDone();
        }, FADE_MS);
    }

    socket.on('sensorData', (data) => {
        if (!isActive || isDone || !waitForStillness) return;

        const gamma = data.gamma !== null ? data.gamma : 0;
        const beta = data.beta !== null ? data.beta : 0;
        watchStillness(gamma, beta);
    });

    socket.on('connect', () => {
        isSystemOnline = true;
        updatePhase();
    });

    socket.on('disconnect', () => {
        isSystemOnline = false;
        hasController = false;
        updatePhase();
    });

    socket.on('controllerStatus', (status) => {
        hasController = status.connected;
        updatePhase();
        // Nach `updatePhase`: Ist damit schon Schluss, bleibt es unsichtbar.
        reveal();
    });

    setTimeout(reveal, REVEAL_MS);

    // Ohne gekoppeltes Smartphone kommen keine Sensorwerte – ein Klick führt
    // dann daran vorbei. Eine Hilfe fürs Einrichten, die im Betrieb nicht
    // greift, weil dort ja ein Controller hängt.
    root.addEventListener('click', () => {
        if (hasController) return;
        finish();
    });

    return {
        /** true, solange die Station ihre Eingaben zurückhalten soll. */
        isActive: () => isActive,
        /** Bricht die Kalibrierung ab, etwa für einen eigenen Umweg. */
        skip: finish,
    };
}
