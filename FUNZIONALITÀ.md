# Funzionalità di OSM2CAI Tools

Per i requisiti e l'installazione, consulta [README.md](README.md).

# Indice

- [1 - Barra informativa OSM2CAI](#1---barra-informativa-osm2cai)
  - [1.1 - Legenda](#11---legenda)
  - [1.2 - Stato di percorribilità](#12---stato-di-percorribilità)
  - [1.3 - Data di validazione](#13---data-di-validazione)
  - [1.4 - Allineamento con OpenStreetMap](#14---allineamento-con-openstreetmap)
    - [1.4.1 - Dettaglio delle modifiche OSM (SDA 4)](#141---dettaglio-delle-modifiche-osm-sda-4)
- [2 - Analisi delle relazioni escursionistiche](#2---analisi-delle-relazioni-escursionistiche)
  - [2.1 - Profilo altimetrico su Waymarked Trails](#21---profilo-altimetrico-su-waymarked-trails)
  - [2.2 - Cosa viene controllato](#22---cosa-viene-controllato)
  - [2.3 - Visualizzazione sulla mappa](#23---visualizzazione-sulla-mappa)
  - [2.4 - Proposta di riordino](#24---proposta-di-riordino)
  - [2.5 - Riordino dei membri nell'iD editor](#25---riordino-dei-membri-nellid-editor)
- [3 - Analisi segnaletica verticale](#3---analisi-segnaletica-verticale)
  - [3.1 - Verifiche e indicatore di stato](#31---verifiche-e-indicatore-di-stato)
  - [3.2 - Tabella e mappa](#32---tabella-e-mappa)
  - [3.4 - Correzione massiva nell'iD editor](#34---correzione-massiva-nellid-editor)
- [4 - Limiti e avvertenze](#4---limiti-e-avvertenze)

---

## 1 - Barra informativa OSM2CAI

Aprendo una relazione escursionistica su [OpenStreetMap](https://www.openstreetmap.org/) o [Waymarked Trails](https://hiking.waymarkedtrails.org/), OSM2CAI Tools mostra una barra con le informazioni disponibili attraverso il servizio OSM2CAI e con gli strumenti di analisi della relazione.

Il pulsante **`?`** apre un riepilogo dei controlli. Le spiegazioni complete sono riportate qui sotto.

| Campo | Funzione |
| :--- | :--- |
| **OSM2CAI API** | Indica se il servizio OSM2CAI risponde correttamente. |
| **SDA** | Mostra il codice dello stato di accatastamento del percorso nel database CAI: **0, 1, 2, 3 o 4**. |
| **Percorribilità** | Mostra lo stato del percorso, quando disponibile. Passando il puntatore sul campo si aprono i dettagli. |
| **Data validazione** | Riporta l'ultima data di validazione OSM2CAI. Il colore indica quanto tempo è trascorso. |
| **Allineamento** | Confronta le date delle modifiche OSM con la data di riferimento OSM2CAI. |
| **Analisi geometria** | Verifica la continuità delle way, segnala problemi e, nei casi non ambigui, può proporre un riordino. |
| **Analisi segnaletica verticale** | Controlla i guidepost della relazione e consente di preparare nell’iD editor di OpenStreetMap le correzioni dei tag mancanti e dei ruoli vuoti. |

### 1.1 - Legenda

- 🟢 **Positivo** — Stato positivo o controllo superato.
- 🔴 **Problema** — Problema o condizione da verificare.
- 🟠 **Stato intermedio** — Situazione intermedia o che richiede attenzione.
- ⚪ **Sconosciuto** — Informazione assente o non verificabile.

**Nota:** i colori vanno interpretati in base al campo. Per esempio, il colore della *Data validazione* ne indica l'**età**, non la correttezza complessiva del percorso.

### 1.2 - Stato di percorribilità

Se il dato è disponibile, il campo può indicare che il percorso è **percorribile**, **non percorribile**, **parzialmente percorribile** oppure che lo stato è **sconosciuto**.

Passando il puntatore sopra lo stato si apre un popup con le informazioni disponibili:

| Campo                   | Dato OSM2CAI utilizzata | Contenuto                                                                                                        |
| :---------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Stato di percorribilità | `issues_status`         | Stati possibili:<br>- `percorribile`<br>- `parzialmente percorribile`<br>- `non percorribile`<br>- `sconosciuto` |
| **Descrizione**         | `issues_description`    | Eventuali informazioni sulla percorribilità.                                                                     |
| **Data aggiornamento**  | `issues_last_update`    | Data dell'ultimo aggiornamento delle informazioni.                                                               |

Se una delle informazioni non è presente nei dati OSM2CAI, lo script non può fornirne il contenuto.

### 1.3 - Data di validazione

Il colore della data indica il tempo trascorso dall'ultima validazione OSM2CAI, calcolato in mesi.

| Colore | Tempo trascorso |
| :--- | :--- |
| 🟢 **Verde** | Fino a **12 mesi**, inclusi. |
| 🟠 **Arancione** | Oltre **12** e fino a **24 mesi**, inclusi. |
| 🔴 **Rosso** | Oltre **24 mesi**. |
| ⚪ **Grigio** | Data assente, vuota, non valida o futura. |

Una validazione recente non garantisce, da sola, che tutti i dati OSM siano corretti o aggiornati.

### 1.4 - Allineamento con OpenStreetMap

Il controllo confronta la modifica più recente degli elementi della relazione OSM (**relazioni, way e nodi**) con una data di riferimento OSM2CAI, diversa in base allo stato SDA.

| Stato di accatastamento                            | Dato OSM2CAI utilizzata | Stati possibili                           |
| :------------------------------------------------- | :---------------------- | :---------------------------------------- |
| **4**                                              | `validation_date`       | 🟢 **aggiornato**<br>🔴 **da verificare** |
| **1, 2, 3**                                        | `updated_at`            | 🟢 **aggiornato**<br>🔴 **da aggiornare** |
| **0**, oppure dati temporali mancanti o non validi | Non disponibile         | ⚪ **non verificabile**                    |

- **Aggiornato:** non risultano modifiche OSM successive alla data OSM2CAI utilizzata dal controllo.
- **Da verificare / da aggiornare:** risultano modifiche successive, da esaminare. Questo **non significa automaticamente** che ci siano errori.
- **Non verificabile:** mancano le condizioni o le informazioni necessarie per effettuare il confronto.

#### 1.4.1 - Dettaglio delle modifiche OSM (SDA 4)

Con **SDA 4** e stato **da verificare**, passando il puntatore sul campo *Allineamento* si apre l'elenco degli elementi modificati dopo la validazione.

L'elenco:

- raggruppa gli elementi per tipo: **relation**, **way**, **node**;
- ordina gli elementi di ciascun tipo dal più recente al meno recente;
- mostra **tipo e ID**, **data della modifica** e **utente OSM**;
- permette di aprire l'elemento su OpenStreetMap selezionando tipo e ID;
- visualizza al massimo **80 elementi**, segnalando il totale quando superiore.

> **Importante:** l'allineamento si basa sulle **date di modifica**. Non confronta in modo puntuale i tag né ricostruisce e confronta due geometrie storiche OSM/OSM2CAI.

---

## 2 - Analisi delle relazioni escursionistiche

L’analisi topologica prende in considerazione tutti i segmenti consecutivi delle way, inclusi i nodi intermedi, e non soltanto le estremità. Le modifiche riguardano rilevamento delle biforcazioni, componenti scollegate, anelli e indicatori sulla mappa.

Il pulsante **Analisi geometria** esamina la struttura delle way appartenenti alla relazione e aiuta a individuare situazioni da controllare. 

### 2.1 - Profilo altimetrico su Waymarked Trails

Su **Waymarked Trails (WMT)**, aprendo **Analisi geometria**, lo script apre anche la sezione **Profilo altimetrico** nella sidebar del percorso, quando necessario. Il profilo rimane aperto se si chiude e si riapre il popup di analisi **sullo stesso percorso**: la riapertura del popup non deve attivare nuovamente la sezione come interruttore e quindi richiuderla. Se viene selezionato un percorso diverso, lo script verifica nuovamente la sezione relativa. Questa integrazione riguarda soltanto WMT, non OpenStreetMap.

### 2.2 - Cosa viene controllato

- **Continuità e ordine delle way:** la connettività topologica considera i nodi condivisi lungo tutta la geometria; la verifica dell’ordine dei membri e l’eventuale riordino automatico restano basati sulle estremità delle way.
- **Discontinuità e componenti scollegate:** individua parti del percorso che non risultano connesse tra loro nel grafo dei segmenti consecutivi.
- **Geometria e sequenza:** il numero di componenti scollegate è distinto dai passaggi non continui nell'ordine attuale delle way. Questi ultimi possono dipendere anche da membri fuori ordine e non corrispondono necessariamente al numero di distacchi geometrici.
- **Biforcazioni:** riconosce anche gli innesti sui nodi intermedi, contando almeno tre rami geometrici distinti per nodo; i segmenti duplicati o invertiti non aumentano il numero di rami.
- **Way ripetute:** segnala la presenza della stessa way più volte nella relazione.
- **Tipologia del percorso:** distingue, quando possibile, una sequenza collegata senza biforcazioni, un anello e una struttura ambigua, sfruttando il grafo geometrico completo.
- **Relazioni annidate:** tenta di analizzare anche le relazioni contenute in altre relazioni, recuperando le geometrie mancanti quando possibile.

### 2.3 - Visualizzazione sulla mappa

L'analisi può mostrare:

- **Frecce blu**, che indicano il verso di percorrenza;
- **pin temporanei**, che evidenziano problemi o punti da verificare: biforcazioni sul nodo OSM condiviso, e pin viola per way ripetute o segmenti condivisi da way distinte;
- su OpenStreetMap, un **tracciato viola temporaneo** per rappresentare la geometria delle relazioni annidate.

Quando vengono rilevati problemi, lo script tenta di **inquadrare automaticamente il percorso** e mostra subito gli indicatori, senza richiedere un secondo clic. Gli indicatori possono essere nascosti tramite **Nascondi indicatori**.

Per componenti lineari scollegate, i pin rossi evidenziano le coppie di estremità più vicine necessarie a collegare idealmente i tratti, senza segnare anche tutti gli estremi normali del percorso. La vicinanza è soltanto un indizio: non prova dove passi il tratto mancante e non autorizza a unire i nodi. Con componenti ramificate o chiuse resta la segnalazione generale delle estremità o di punti rappresentativi.

Nel pannello dei risultati è possibile consultare i punti problematici e, quando previsti, aprire su OSM i nodi interessati. Gli indicatori sono puramente visivi: **non vengono salvati su OpenStreetMap**.

### 2.4 - Proposta di riordino

Quando la geometria è sufficientemente chiara, lo script può proporre una sequenza di way coerente con la continuità del percorso e, se disponibile, consentire di **copiarla**.

L’ordinamento automatico continua a basarsi sulle estremità delle way e **non viene proposto** in presenza di diramazioni, quando la struttura è annidata o complessa, presenta ruoli particolari oppure la geometria è ambigua. In questi casi è necessaria una verifica manuale.

---

### 2.5 - Riordino dei membri nell'iD editor

Se l'analisi individua un ordinamento non ambiguo, è possibile scegliere la sequenza proposta o quella inversa e trasferirla nell'**iD editor** di OpenStreetMap.

Il procedimento prevede alcune salvaguardie:

1. Il riordino interviene sulle posizioni dei membri di tipo **`way`**, mantenendo i ruoli e i membri di altri tipi.
2. Prima dell'applicazione vengono controllati la **versione** e l'insieme dei membri della relazione.
3. La modifica rimane **non salvata** nella sessione dell’iD editor, può essere annullata e deve essere verificata e salvata **manualmente**.

**OSM2CAI Tools non salva automaticamente modifiche sui server OpenStreetMap.**

---

## 3 - Analisi segnaletica verticale

Il pulsante **Analisi segnaletica verticale**, accanto ad **Analisi geometria**, apre un popup compatto dedicato ai **nodi membri diretti** con **entrambi** i tag `tourism=information` e `information=guidepost`, **indipendentemente dal ruolo** assegnato nella relazione.

### 3.1 - Verifiche e indicatore di stato

Per ogni nodo presente nella relazione controlla:

- tag `tourism=information`;
- tag `information=guidepost`;
- tag `hiking=yes`;
- ruolo `guidepost` del nodo nella relazione.

Segnala inoltre membri duplicati e dati non disponibili o non verificabili. La selezione iniziale **non** include membri in base al solo ruolo `guidepost`: i nodi privi di uno dei due tag di riconoscimento non vengono censiti nell'analisi e non possono essere corretti automaticamente sulla base del solo ruolo.

L'**indicatore sul pulsante «Analisi segnaletica verticale»** usa gli stessi criteri su OSM e WMT:

| Colore | Significato |
| :--- | :--- |
| 🟢 **Verde** | Tutti i guidepost rilevati sono conformi: tag e ruolo corretti. |
| 🟠 **Arancione** | Manca `hiking=yes` oppure manca il ruolo `guidepost`. |
| 🔴 **Rosso** | Valore errato, ruolo non conforme o membro duplicato. |
| ⚪ **Grigio** | Nessun guidepost rilevato o dati necessari non disponibili. |

Se coesistono anomalie diverse, la priorità è **rosso → arancione → verde**.  La stessa distinzione verde, arancione e rosso viene utilizzata per i **pin numerati** sulla mappa; il grigio riguarda lo stato del pulsante, non un guidepost presente.

### 3.2 - Tabella e mappa

Il riepilogo contiene tre contatori cliccabili, **Totale**, **Conformi** e **Da verificare**: la selezione mostra rispettivamente tutti i nodi, solo quelli conformi oppure solo quelli che richiedono verifica (inclusi gli elementi non verificabili). Quando un filtro non ha risultati, viene mostrato un messaggio al posto della tabella. 

La tabella ha un’**intestazione raggruppata su due livelli**: **ID nodo**, **Tag** (quattro sottocolonne: `tourism`, `information`, `hiking` e **wikimedia / commons**, quest’ultima su due righe) e **Ruolo membro** (su due righe). **ID nodo** e **Ruolo membro** sono centrati orizzontalmente e verticalmente; spunte, avvisi e trattini sono centrati nelle rispettive celle. La presenza del tag `wikimedia_commons` è informativa: **la sua assenza non costituisce un errore**.

- L'intestazione resta fissa durante lo scorrimento; la tabella visualizza fino a cinque righe prima dello scorrimento verticale, con adattamento agli schermi piccoli.
- Gli ID dei nodi sono collegamenti cliccabili che aprono `https://www.openstreetmap.org/node/ID` in una nuova scheda.
- All'apertura **nessun nodo è selezionato**. Selezionando una riga viene evidenziato il nodo corrispondente sulla mappa; un clic all'interno del popup ma fuori dalla tabella elimina la selezione e l'evidenziazione.
- Se il nodo selezionato contiene `wikimedia_commons` riferito a un **file** di Commons, sotto il pulsante di aggiornamento nell’iD editor compare una **miniatura**; cliccandola si apre la foto **a schermo intero** (chiusura con `Esc` o clic sullo sfondo/X). Durante la richiesta compare **«Caricamento...»**. Se il tag manca non compare nulla; una categoria Commons non viene interpretata come un file fotografico.
- I pin numerati della segnaletica appaiono automaticamente sulla mappa: **verdi** per i conformi, **arancioni** per tag o ruolo mancanti e **rossi** per errori certi o duplicati. Lo script tenta di inquadrare i guidepost su OSM e utilizza la gestione della vista prevista su WMT.
- L'analisi segnaletica è separata da quella topologica: passando da una all'altra, o chiudendo il popup, vengono rimossi i pin della precedente analisi.

### 3.4 - Correzione massiva nell'iD editor

Il pulsante **Aggiorna in iD editor (N nodi)**, sotto la tabella e sopra l’eventuale miniatura Wikimedia, apre senza popup intermedi di conferma una nuova scheda dell’iD editor di OpenStreetMap e tenta di preparare **in una sola sessione di modifica** le correzioni per tutti i nodi problematici correggibili. Può aggiungere i tag attesi quando sono assenti (`tourism=information`, `information=guidepost`, `hiking=yes`) e assegnare il ruolo `guidepost` ai membri che hanno il ruolo vuoto.

**Non sovrascrive automaticamente tag con valori diversi da quelli attesi** e non corregge in automatico i casi ambigui, come membri duplicati. Il trasferimento all’iD editor richiede che la relazione e i nodi necessari siano disponibili e corrispondano alla versione analizzata. Lo script tenta di caricare gli oggetti mancanti, ma l'integrazione può non riuscire: in tal caso non deve applicare correzioni parziali. Le modifiche eventualmente preparate restano **non salvate**, da verificare ed eventualmente salvare manualmente nell'editor.

Il controllo riguarda i guidepost censiti come membri della relazione: **non certifica la completezza della segnaletica sul terreno** e non attribuisce automaticamente alla relazione principale i membri delle sottorelazioni.

---

## 4 - Limiti e avvertenze

- **Analisi topologica:** un incrocio geometrico senza un nodo OSM condiviso non costituisce un collegamento. Anche un grafo connesso non garantisce la correttezza di tag, ruoli o geometria.
- **Strutture complesse:** geometrie non disponibili, grandi *superroute* e relazioni molto annidate possono impedire l’analisi completa; in tali casi i risultati possono essere **incompleti** e richiedono una verifica manuale.
- **Integrazione con l’iD editor:** dipende anche da componenti interni dell'editor, che potrebbero cambiare con i suoi aggiornamenti. L'apertura della scheda non garantisce, da sola, che le correzioni siano state applicate.
- **Dati OSM2CAI:** le informazioni mostrate dipendono dalla disponibilità e dal contenuto delle risposte del servizio.
- **Modifiche ai dati OSM:** OSM2CAI Tools non salva automaticamente modifiche sui server OpenStreetMap. Qualsiasi modifica preparata nell’iD editor richiede la verifica e il salvataggio manuale.
