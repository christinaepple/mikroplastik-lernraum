// ═══════════════════════════════════════════════════════════════════════════
//  Die Stationen des Suchers
//
//  Eine Liste, zwei Leser: das Handy (controller_sucher.js) legt alle Bilder von
//  Anfang an auf den Boden, der Laptop (sucher.js) weiß dadurch, welche Station
//  hinter einem abgelegten Bild steckt. Die Reihenfolge ist der Ablauf: Es liegt
//  zwar alles sichtbar da, aber nur das jeweils nächste ist farbig und
//  aufnehmbar — die übrigen sind schwarzweiß, bis sie an der Reihe sind.
//
//  Der Fundort steht in Polarkoordinaten um die eigene Achse: `deg` ist der
//  Winkel gegenüber der Blickrichtung beim Start — im Uhrzeigersinn, also nach
//  rechts —, `dist` der Abstand in Welteinheiten (~Meter). So liegt jedes Bild
//  im Umkreis der eigenen Füße und wird durch Drehen auf der Stelle gefunden,
//  nicht durch Umherlaufen.
//
//  Eine Station ergänzen heißt: hier einen Eintrag anhängen (Bild, Modulseite,
//  Fundwinkel). Beide Seiten ziehen automatisch mit.
//
//  `stroke` ist optional: die Umrissskizze desselben Bildes. Ist sie gesetzt,
//  blendet das Collage-Bild beim Halten (Station betreten) vom Foto in die
//  Zeichnung über — dieselbe Auswahl-Handschrift wie in den Stationen selbst
//  (siehe eintragspfade). Ohne `stroke` bleibt es beim reinen Kringel.
// ═══════════════════════════════════════════════════════════════════════════

export const STATIONEN = [
    {
        name: 'Produktionsabriss',
        page: '/interactions/inhalte/produktionsabriss.html',
        img: '/img/interactionen/einstieg/1_prod.png',
        stroke: '/img/interactionen/einstieg/1_prod_stroke.png',
        fund: { deg: 25, dist: 0.72 },
    },
    {
        name: 'Polymere zuordnen',
        page: '/interactions/inhalte/bereiche.html',
        img: '/img/interactionen/einstieg/2_poly.png',
        stroke: '/img/interactionen/einstieg/2_poly_stroke.png',
        fund: { deg: -40, dist: 0.84 },
    },
    {
        name: 'Größeneinordnung',
        page: '/interactions/inhalte/groesseneinordnung.html',
        img: '/img/interactionen/einstieg/3_groesse.png',
        stroke: '/img/interactionen/einstieg/3_groesse_stroke.png',
        fund: { deg: 80, dist: 0.96 },
    },
    {
        name: 'Fragmentierung',
        page: '/interactions/inhalte/fragmentierung.html',
        img: '/img/interactionen/einstieg/4_frag.png',
        stroke: '/img/interactionen/einstieg/4_frag_stroke.png',
        fund: { deg: -95, dist: 0.68 },
    },
    {
        name: 'Eintragspfade',
        page: '/interactions/inhalte/eintragspfade.html',
        img: '/img/interactionen/einstieg/5_eintrag1.png',
        stroke: '/img/interactionen/einstieg/5_eintrag1_stroke.png',
        fund: { deg: 135, dist: 0.92 },
    },
    {
        name: 'Eintragspfade 2',
        page: '/interactions/inhalte/eintragspfade-2.html',
        img: '/img/interactionen/einstieg/6_eintrag2.png',
        stroke: '/img/interactionen/einstieg/6_eintrag2_stroke.png',
        fund: { deg: -150, dist: 0.8 },
    },
    {
        name: 'Transportmechanismen',
        page: '/interactions/inhalte/transportmechanismen.html',
        img: '/img/interactionen/einstieg/7_trans.png',
        stroke: '/img/interactionen/einstieg/7_trans_stroke.png',
        fund: { deg: 175, dist: 0.64 },
    },
    {
        name: 'Einflüsse auf Bodenfunktionen',
        page: '/interactions/inhalte/einfluesse-bodenfunktionen.html',
        img: '/img/interactionen/einstieg/8_boden.png',
        stroke: '/img/interactionen/einstieg/8_boden_stroke.png',
        fund: { deg: -75, dist: 1.04 },
    },
];
