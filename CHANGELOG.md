## 0.13.0

### Aggiunto

- **Analisi segnaletica verticale:** verifica dei nodi relativi ai cartelli escursionistici presenti nelle relazioni OSM, controllando tag e ruoli dei membri.
- **Aggiornamento in iD:** aggiunta massiva dei tag mancanti e dei ruoli vuoti ai nodi interessati, con verifica e salvataggio manuale delle modifiche.
- **Fotografie Wikimedia Commons:** miniature delle foto dei cartelli, con visualizzazione a schermo intero.
- **Filtri interattivi:** nella tabella di riepilogo dell'analisi della segnaletica verticale, possibilità di filtrare i nodi: tutti, solo conformi o da verificare.
- **Indicatori sulla mappa:** pin numerati e selezione dei singoli cartelli.

### Migliorato

- **Interfaccia:** barra e popup più compatti, con supporto ai temi chiaro e scuro.
- **Stati della segnaletica verticale:** indicatori verde, arancione, rosso e grigio su OSM e WMT.
- **Analisi geometria:** nuova denominazione e interazione semplificata.
- **Waymarked Trails:** apertura automatica e persistente del profilo altimetrico.
- **iD:** accesso diretto senza conferme intermedie.
- **Navigazione e caricamento:** gestione migliorata dei dati e degli aggiornamenti.

### Corretto

- **Analisi geometrica:** migliorati il rilevamento delle discontinuità, dei segmenti sovrapposti e l'ordinamento delle way.
- **Allineamento OSM2CAI:** controlli più affidabili sui dati incompleti e sulle date.
- **Mappa:** corretti indicatori, inquadratura e comportamento dello zoom.
- **Popup e indicatori:** risolte anomalie di visualizzazione su OSM e WMT.
- **Navigazione:** corretta la gestione dei caricamenti interrotti e del ritorno alle relazioni precedenti.

## 0.12.12

### Aggiunto

- **Pin viola per way ripetute**
- **Pin viola per segmenti sovrapposti**

## 0.12.11

### Corretto

- **Zoom alla geometria su OSM e Waymarked Trails:** quando si apre l'analisi della relazione, l'inquadratura viene richiesta anche se non sono presenti anomalie o marcatori sulla mappa. In precedenza era collegata alla condizione `issues.length > 0`.

## 0.12.10

### Corretto

- **Biforcazioni su nodi intermedi:** il controllo delle diramazioni considera i segmenti tra tutti i nodi consecutivi delle way, non solo gli estremi.
- **Marcatori sulla mappa:** le biforcazioni rilevate su nodi intermedi possono essere segnalate sul nodo OSM condiviso.

### Migliorato

- **Analisi delle componenti scollegate e degli anelli:** utilizza un grafo costruito dai segmenti delle way.
- **Rami distinti:** i segmenti coincidenti o percorsi nei due versi non vengono contati più volte; gli incroci senza nodo OSM comune non sono considerati collegamenti.
- **Indicatori della mappa:** non vengono generati indicatori parziali quando mancano geometrie o sono presenti cicli nelle sottorelazioni.

## 0.12.9  — Versioni precedenti

Le versioni precedenti della serie 0.12.x hanno introdotto e consolidato le principali funzionalità di OSM2CAI Tools.

Per una panoramica completa delle funzionalità disponibili e del loro funzionamento, consultare [FUNZIONALITÀ.md](https://github.com/andrea-del-sarto/OSM2CAI_Tools/blob/main/FUNZIONALIT%C3%80.md).
