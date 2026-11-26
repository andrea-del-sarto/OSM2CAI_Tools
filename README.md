# OSM2CAI Tools

**OSM2CAI Tools** è uno *userscript* per **Violentmonkey** e **Tampermonkey**, nato come strumento personale per rendere più agevole l'attività di mappatura e manutenzione dei **percorsi escursionistici su OpenStreetMap (OSM)**, con particolare attenzione alla **Rete Escursionistica Italiana (REI)** e ai percorsi CAI.

L'obiettivo è ridurre le operazioni ripetitive e **contribuire alla qualità, alla coerenza e alla consistenza dei dati OSM**, facilitando l'individuazione di anomalie geometriche, informazioni mancanti e incongruenze nelle relazioni dei percorsi.

![Barra principale di OSM2CAI Tools](screenshot/OSM2CAI_tools-barra%20principale.png)

*Barra principale di OSM2CAI Tools su OpenStreetMap.*

Il progetto è cresciuto a partire dalla necessità di passare frequentemente tra **OpenStreetMap**, **Waymarked Trails** e **OSM2CAI** per confrontare informazioni, analizzare le relazioni e controllare la segnaletica verticale. Oggi riunisce diverse verifiche in un'interfaccia dedicata, senza sostituire gli strumenti di mappatura esistenti.

> **Accesso a OSM2CAI:** la piattaforma OSM2CAI è riservata ai soci del Club Alpino Italiano (CAI). Alcune funzioni richiedono l'accesso al servizio.

> **Ambito:** gli strumenti di analisi delle relazioni possono essere utili anche per percorsi non italiani; i dati specifici OSM2CAI dipendono invece dal servizio CAI.

## Funzionalità

- **Collegamenti e consultazione:** passaggio rapido tra OpenStreetMap, Waymarked Trails e OSM2CAI, con visualizzazione di SDA, stato di percorribilità e data di validazione.
- **Allineamento OSM–OSM2CAI:** verifica in due fasi. Prima viene confrontata l'ultima modifica OSM, considerando anche gli elementi della relazione, con `updated_at` meno **48 ore** per SDA 1–3 oppure con `validation_date` per SDA 4; se il confronto temporale è positivo, vengono controllate anche **geometria e ordine delle way**. Quando i dati non consentono una verifica affidabile, viene mostrato uno stato neutro.
- **Dettaglio dell'allineamento per SDA 4:** se il percorso risulta «non aggiornato» per modifiche OSM successive a `validation_date`, passando il mouse su **Allineamento** compare l'elenco degli elementi modificati, con tipo, ID, data, utente e collegamento a OpenStreetMap.
- **Analisi geometria:** verifica della continuità del percorso, biforcazioni, anelli, relazioni annidate e anomalie, con indicatori sulla mappa.
- **Riordino dei membri in iD:** proposta di riordino dei membri `way` quando la geometria lo consente.
- **Analisi segnaletica verticale:** controllo dei nodi `guidepost`, dei tag OSM e dei ruoli nelle relazioni, anche quando un nodo è condiviso tra più percorsi, con pin numerati e filtri interattivi.
- **Supporto alle correzioni in iD:** preparazione delle integrazioni dei tag mancanti e dei ruoli `guidepost` nelle relazioni interessate.
- **Fotografie Wikimedia Commons:** visualizzazione delle miniature associate alla segnaletica verticale, ingrandibili a schermo intero.
- **Integrazione Waymarked Trails:** analisi delle relazioni e apertura del profilo altimetrico.

**Importante:** OSM2CAI Tools **non salva automaticamente modifiche su OpenStreetMap**. Tutte le modifiche proposte vengono preparate nell'**editor iD** e devono essere **controllate dal mappatore prima del salvataggio manuale**, indipendentemente dalla funzione utilizzata.

Per legenda, dettagli dei campi, popup e limiti noti, consulta la **[guida alle funzionalità](FUNZIONALIT%C3%80.md)**. Per la cronologia degli aggiornamenti, consulta il **[changelog](CHANGELOG.md)**.

## Requisiti

- Browser moderno con supporto a JavaScript ES6+.
- Gestore di userscript: [Violentmonkey](https://violentmonkey.github.io/) (open source) oppure [Tampermonkey](https://www.tampermonkey.net/).
- Connessione ai servizi OSM e OSM2CAI per le funzioni che richiedono API.

La piattaforma OSM2CAI è **riservata ai soci CAI**; per accedervi sono necessarie le credenziali [MyCAI](https://soci.cai.it/). L'utilizzo delle pagine OSM e dei rispettivi dati pubblici è distinto dall'accesso alla piattaforma CAI.

## Installazione

1. Installa Violentmonkey o Tampermonkey nel browser.
2. Installa lo script [`OSM2CAI_Tools.user.js`](https://github.com/andrea-del-sarto/OSM2CAI_Tools/raw/refs/heads/main/OSM2CAI_Tools.user.js).
3. Apri una relazione di percorso escursionistico su OpenStreetMap o Waymarked Trails.

## Esempi di utilizzo

### OpenStreetMap

https://www.openstreetmap.org/relation/136334

### Waymarked Trails

https://hiking.waymarkedtrails.org/#route?id=136334


## Documentazione utile

- [Documentazione OSM2CAI](https://catastorei.gitbook.io/documentazione-osm2cai)
- [Linee guida OSM/CAI](https://wiki.openstreetmap.org/wiki/IT:CAI)
- [Attività organizzate del Club Alpino Italiano su OSM](https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Club_Alpino_Italiano/2022)
- [Copyright e licenza dei dati OSM](https://www.openstreetmap.org/copyright)
- [INFOMONT CAI](https://infomont.cai.it/)

## Licenza

Il codice di **OSM2CAI Tools** è distribuito secondo la **GNU General Public License, versione 3 (GPL-3.0-only)**. Consulta il file [LICENSE](LICENSE) per il testo integrale. Chi ridistribuisce versioni modificate deve rispettare le condizioni della GPL v3, comprese le disposizioni relative alla disponibilità del codice sorgente.

I dati OpenStreetMap sono distribuiti con licenza [ODbL](https://opendatacommons.org/licenses/odbl/).
