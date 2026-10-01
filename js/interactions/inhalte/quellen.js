/* ═══════════════════════════════════════════════════════════════════════════
   Gemeinsames Quellenregister aller Inhalts-Stationen

   Eine Quelle, eine Nummer – überall gleich. Die Reihenfolge hier IST die
   Nummerierung ([1] = erstes Element) und folgt dem ersten Auftreten entlang
   der Kachel-Reihenfolge im Portal (inhalte.html). Wer eine Quelle zitiert,
   verweist über den `key`, nie über die Zahl – so bleibt die Nummer an einer
   einzigen Stelle und lässt sich gefahrlos umsortieren.

   `text` = Wortlaut aus dem Literaturverzeichnis der Masterarbeit (unverändert
            übernommen; nur Groß-/Kleinschreibung der Namen normalisiert).
   `url`  = DOI/URL, sofern im Verzeichnis vorhanden – sonst null (nicht
            verlinkt, bis die Angabe ergänzt wird).
   ═══════════════════════════════════════════════════════════════════════════ */

export const QUELLEN = [
    {
        key: 'de-souza-machado-2019',
        text: 'de Souza Machado, A. A., Lau, C. W., Kloas, W., Bergmann, J., Bachelier, J. B., Faltin, E., … & Rillig, M. C. (2019). Microplastics can change soil properties and affect plant performance. Environmental science & technology, 53(10), 6044–6052.',
        url: null
    },
    {
        key: 'hengstmann-tamminga-2022',
        text: 'Hengstmann, E., & Tamminga, M. (2022). Plastik in der Umwelt.',
        url: null
    },
    {
        key: 'statista-2024',
        text: 'Statista (2024). Weltweite und europäische Kunststoffproduktion in den Jahren von 1950 bis 2024.',
        url: 'https://de.statista.com/statistik/daten/studie/167099/umfrage/weltproduktion-von-kunststoff-seit-1950/'
    },
    {
        key: 'rathikannu-2025',
        text: 'Rathikannu, S., Gautam, S., Joshi, S. K. et al. (2025). FTIR based assessment of microplastic contamination in soil water and insect ecosystems reveals environmental and ecological risks. Sci Rep 15, 28615.',
        url: 'https://doi.org/10.1038/s41598-025-14507-w'
    },
    {
        key: 'dewangan-2025',
        text: 'Dewangan, B., Eelager, M. P. & Bhattacharjee, D. (2025). Sustainable export packaging for black pepper: paper-based solutions for a greener future. J Food Sci Technol.',
        url: 'https://doi.org/10.1007/s13197-025-06460-3'
    },
    {
        key: 'hartmann-2019',
        text: 'Hartmann, N. B., Huffer, T., Thompson, R. C., Hassellov, M., Verschoor, A., Daugaard, A. E., … & Wagner, M. (2019). Are we speaking the same language? Recommendations for a definition and categorization framework for plastic debris.',
        url: null
    },
    {
        key: 'firouzsalari-2025',
        text: 'Firouzsalari, N. Z., Sharifi, A., Taghipour, H. et al. (2025). Presence of microplastics in human’s respiratory system: bronchoalveolar and bronchial lavage fluid. J Environ Health Sci Engineer 23, 42.',
        url: 'https://doi.org/10.1007/s40201-025-00961-1'
    },
    {
        key: 'veloso-2025',
        text: 'Veloso, A., Silva, V., Huerta Lwanga, E. et al. (2025). Tracking the source of microplastics in soil — an exploratory case study in peach orchards from east-central Portugal. Environ Monit Assess 197, 645.',
        url: 'https://doi.org/10.1007/s10661-025-14072-9'
    },
    {
        key: 'amer-2025',
        text: 'Amer, N. B., Ministerio, J. R. B., Romarate II, R. A. et al. (2025). Elevational variations in atmospheric microplastics and surface-adsorbed heavy metals in roadside and non-roadside areas in Iligan City, Philippines. Air Qual Atmos Health 18, 3947–3960.',
        url: 'https://doi.org/10.1007/s11869-025-01866-6'
    },
    {
        key: 'weber-bigalke-2025',
        text: 'Weber, C. J., & Bigalke, M. (2025). Forest soils accumulate microplastics through atmospheric deposition. Commun Earth Environ 6, 702.',
        url: 'https://doi.org/10.1038/s43247-025-02712-4'
    },
    {
        key: 'ahmad-2025',
        text: 'Ahmad, Z., Najaf, D., Atif, S. et al. (2025). Assessment of physiological stress on plants grown in soil contaminated with microplastics. Sci Rep 15, 35551.',
        url: 'https://doi.org/10.1038/s41598-025-19610-6'
    },
    {
        key: 'bostrom-2025',
        text: 'Bostrom, A., van den Broek, K. L., Böhm, G. et al. (2025). Scientists’ mental models of microplastics: insights into expert perceptions from an exploratory comparison of research methods. Micropl.&Nanopl. 5, 36.',
        url: 'https://doi.org/10.1186/s43591-025-00141-w'
    },
    {
        key: 'wu-2025',
        text: 'Wu, F., Li, X., Zhang, C. et al. (2025). Spatiotemporal distribution and diversity of microplastics in the sediment of beaches in Xiamen City, China. J. Ocean. Limnol. 43, 396–405.',
        url: 'https://doi.org/10.1007/s00343-024-3277-8'
    },
    {
        key: 'nair-2025',
        text: 'Nair, H. T., Sivaraman, R., Prakash, G. et al. (2025). Microplastic contamination in farmyard manures: implications for sustainable agriculture. Environ Monit Assess 197, 973.',
        url: 'https://doi.org/10.1007/s10661-025-14430-7'
    },
    {
        key: 'samani-2025',
        text: 'Samani, M., Ahlawat, Y. K., Yadav, S. et al. (2025). Micro and nano plastics (MNPs) in agricultural soils: challenges for food security and environmental health. Environ Monit Assess 197, 1369.',
        url: 'https://doi.org/10.1007/s10661-025-14810-z'
    },
    {
        key: 'liu-2025',
        text: 'Liu, S., Chen, B., Wang, K. et al. (2025). Unveiling the impact of biodegradable polylactic acid microplastics on meadow soil health. Environ Geochem Health 47, 45.',
        url: 'https://doi.org/10.1007/s10653-025-02358-3'
    }
];

/* key → { nr, …quelle } für schnellen Zugriff; nr = Position im Register */
const byKey = new Map(QUELLEN.map((q, i) => [q.key, { nr: i + 1, ...q }]));

export function getQuelle(key) {
    return byKey.get(key) || null;
}

/* ── Popover ─────────────────────────────────────────────────────────────────
   Ein einziges Overlay, das an die angetippte Marke gesetzt wird. */
let popover = null;
let activeMarker = null;

function ensurePopover() {
    if (popover) return popover;
    popover = document.createElement('div');
    popover.className = 'quelle-popover';
    popover.setAttribute('role', 'dialog');
    popover.hidden = true;
    document.body.appendChild(popover);

    // Ein Klick daneben oder Escape schließt.
    document.addEventListener('click', (e) => {
        if (popover.hidden) return;
        if (e.target.closest('.quelle-popover') || e.target.closest('.quelle')) return;
        closePopover();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePopover();
    });
    window.addEventListener('resize', closePopover);
    return popover;
}

function closePopover() {
    if (!popover || popover.hidden) return;
    popover.hidden = true;
    if (activeMarker) activeMarker.setAttribute('aria-expanded', 'false');
    activeMarker = null;
}

function openPopover(marker, q, loc) {
    ensurePopover();
    // Ohne hinterlegten Link erscheint gar nichts – kein Hinweis.
    const linkPart = q.url
        ? `<a class="quelle-popover-link" href="${q.url}" target="_blank" rel="noopener">Quelle öffnen ↗</a>`
        : '';
    popover.innerHTML =
        `<div class="quelle-popover-nr">Quelle [${q.nr}]${loc ? `, ${loc}` : ''}</div>` +
        `<div class="quelle-popover-text">${q.text}</div>` +
        linkPart;
    popover.hidden = false;

    // Unter der Marke ausrichten, im Sichtfeld gehalten.
    const r = marker.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const margin = 8;
    let left = r.left;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (left < margin) left = margin;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - margin) top = r.top - ph - 6;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;

    activeMarker = marker;
    marker.setAttribute('aria-expanded', 'true');
}

/* ── Einhängen ───────────────────────────────────────────────────────────────
   Findet alle `.quelle[data-ref]`, schreibt die Nummer aus dem Register und
   macht die Marke antippbar. Wird pro Seite einmal aufgerufen. */
export function mountCitations(root = document) {
    const markers = root.querySelectorAll('.quelle[data-ref]');
    markers.forEach((marker) => {
        const q = getQuelle(marker.dataset.ref);
        const loc = marker.dataset.loc || '';
        if (!q) {
            marker.classList.add('quelle-unbekannt');
            marker.textContent = '[?]';
            return;
        }
        // Inline nur die Nummer; die Seitenzahl (data-loc) bleibt fürs Popover.
        marker.textContent = `[${q.nr}]`;
        marker.setAttribute('role', 'button');
        marker.setAttribute('tabindex', '0');
        marker.setAttribute('aria-expanded', 'false');
        marker.setAttribute('aria-label', `Quelle ${q.nr} anzeigen`);

        const toggle = () => {
            if (activeMarker === marker && popover && !popover.hidden) closePopover();
            else openPopover(marker, q, loc);
        };
        marker.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        marker.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
    });
}
