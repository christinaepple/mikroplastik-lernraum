/* Baut das zentrale Quellenverzeichnis aus dem gemeinsamen Register auf.
   Die Reihenfolge und Nummer kommen aus quellen.js – hier wird nur gerendert. */
import { QUELLEN } from '/js/interactions/inhalte/quellen.js';

// Eingebettet im Hilfe-Menü des Suchers (controller_sucher.html) liegt schon
// ein eigenes Schließen-X über dem Rahmen — das X dieser Seite läge optisch
// genau darauf. Nur eigenständig geöffnet (z. B. von inhalte.html) bleibt es
// sichtbar.
function hideCloseBtnIfEmbedded() {
    if (window.self === window.top) return;
    const btn = document.querySelector('.close-btn');
    if (btn) btn.style.display = 'none';
}

function render() {
    const list = document.getElementById('quellenListe');
    if (!list) return;

    QUELLEN.forEach((q, i) => {
        const nr = i + 1;
        const li = document.createElement('li');
        li.className = 'q-item';
        li.id = `quelle-${nr}`;

        const marke = document.createElement('span');
        marke.className = 'q-nr';
        marke.textContent = `[${nr}]`;

        const body = document.createElement('div');
        body.className = 'q-body';

        const text = document.createElement('p');
        text.className = 'q-text';
        text.textContent = q.text;
        body.appendChild(text);

        if (q.url) {
            const a = document.createElement('a');
            a.className = 'q-link';
            a.href = q.url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = q.url.replace(/^https?:\/\//, '');
            body.appendChild(a);
        }

        li.appendChild(marke);
        li.appendChild(body);
        list.appendChild(li);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        render();
        hideCloseBtnIfEmbedded();
    });
} else {
    render();
    hideCloseBtnIfEmbedded();
}
