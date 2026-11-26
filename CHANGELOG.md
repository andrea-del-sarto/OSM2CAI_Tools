# CHANGELOG — OSM2CAI Tools

## 0.14.0 

### Allineamento OSM ↔ OSM2CAI
- **Verifica in due fasi**: prima confronto delle date, poi controllo di **geometria e ordine delle way** soltanto quando il controllo temporale è positivo.
- **SDA 1, 2, 3**: confronto tra l'ultima modifica OSM e `updated_at` OSM2CAI **meno 48 ore** (margine prudenziale per il ritardo d'importazione).
- **SDA 4**: confronto con `validation_date` **senza sottrarre 48 ore**; essendo una data senza ora (`YYYY-MM-DD`), il confronto è effettuato per giorno.
- **SDA 0**: nessun confronto di allineamento.
- La data OSM considera la relazione e gli elementi collegati, inclusi way, nodi e sottorelazioni; in caso di dati incompleti viene evitato un esito positivo non affidabile.
- Il confronto geometrico controlla il numero, la sequenza e le coordinate delle `LineString` rispetto alle way OSM; ammette il verso inverso della singola way e una piccola tolleranza di arrotondamento.
- Risultati: **`aggiornato`** se entrambe le fasi sono positive, **`non aggiornato`** se una fase rileva una differenza, **`—`** se i dati non consentono un confronto attendibile.

### Segnaletica verticale e relazioni condivise
- Analisi dei guidepost e popup dettagliato dei nodi, con colonna **Numero relazioni**.
- Elenco delle **Relazioni condivise** identificato dal tag `ref`, con indicazione del ruolo `guidepost` presente, mancante o differente.
- Selezione delle correzioni da preparare per l'editor iD, con possibilità di intervenire su più relazioni. Questa integrazione multipla rimane sperimentale e richiede verifica sul browser.
- Il riquadro di dettaglio sotto il pulsante di aggiornamento compare solo quando è selezionato un nodo.

### Interfaccia e fotografie
- Popup della segnaletica con dettagli e relazioni a sinistra e fotografia Wikimedia Commons a destra.
- Correzioni di impaginazione, larghezza delle colonne, scorrimento e intestazione della tabella.
- Miniature Wikimedia Commons da **240 px** recuperate tramite MediaWiki API, con visualizzatore ingrandito.
- Restano disponibili barra OSM2CAI, stato SDA e percorribilità, analisi geometrica, collegamenti OSM/WMT/OSM2CAI e strumenti iD già esistenti.
- **Waymarked Trails**: comparsa immediata della barra al riconoscimento dell'ID relazione, senza controllo preliminare `route=hiking` né attesa artificiale di 100 ms.
- Caricamenti OSM e OSM2CAI avviati in parallelo dopo la visualizzazione della barra.
- Ridotti controlli e richieste ridondanti su WMT; invariati il filtro OSM `route=hiking`, l'annullamento di richieste obsolete e la modalità barra compressa.

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
