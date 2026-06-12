# Mappa Interattiva della Rete Bicipolitana del Comune di Pesaro

Questo repository ospita il progetto di pubblicazione web della **Rete Bicipolitana del Comune di Pesaro**, sviluppato come applicazione GIS interattiva. Il lavoro è stato realizzato partendo dalla strutturazione di dati vettoriali georeferenziati in ambiente **QGIS** e successivamente ottimizzato ed esportato in formato web (HTML5/CSS3/JavaScript) sfruttando la libreria open-source **Leaflet** tramite il plugin `qgis2web`.

L'obiettivo principale è offrire uno strumento cartografico digitale, responsivo e facilmente consultabile sia da desktop che da dispositivi mobile, utile per l'orientamento e l'analisi della mobilità sostenibile sul territorio pesarese.

---

## 🗺️ Cosa si può visualizzare e fare nella mappa

L'applicazione web integra diverse funzionalità interattive e livelli informativi:

1. **Visualizzazione delle Linee Ciclabili:**
   - La rete della Bicipolitana è interamente digitalizzata e suddivisa in base alle direttrici ufficiali (Linee da 1 a 12, Linea A e Linea B). Ogni percorso mantiene la codifica cromatica e la numerazione originale per una corrispondenza immediata con la segnaletica verticale sul campo.

2. **Servizi alla Ciclabilità (Punti di Interesse):**
   - Mappatura puntuale delle infrastrutture di supporto ai ciclisti, tra cui **Parcheggi bici**, stazioni di **Noleggio**, **Ciclofficine** e **Fontanelle** pubbliche per il rifornimento idrico.

3. **Punti di Svago e Ostacoli:**
   - Localizzazione delle principali aree verdi e parchi urbani attraversati dalla rete, insieme alla segnalazione di eventuali punti di attenzione o ostacoli lungo i tracciati.

4. **Strumenti Interattivi Avanzati:**
   - **Legenda Dinamica:** Un pannello laterale (Expanded) permette di accendere o spegnere selettivamente i singoli layer per personalizzare la vista.
   - **Interrogazione dei Dati (Popup):** Cliccando su qualsiasi elemento (linea o punto) si apre una finestra informativa pulita che mostra gli attributi dell'oggetto (es. tipo di pavimentazione, capienza dei parcheggi), nascondendo automaticamente i campi vuoti o i metadati tecnici di sistema.
   - **Evidenziazione (Highlight on Hover):** Gli elementi geometrici si illuminano al passaggio del cursore per facilitare la selezione e migliorare l'esperienza d'uso.
   - **Strumento di Misura (Measure Tool):** Un righello integrato consente di misurare in tempo reale le distanze metriche direttamente sulla mappa.
   - **Geolocalizzazione GPS (Geolocate User):** Un pulsante dedicato permette all'utente di attivare la localizzazione GPS del proprio dispositivo per visualizzare la propria posizione in tempo reale rispetto alle piste ciclabili.

5. **Cartografia di Base (Basemap):**
   - Il progetto utilizza come sfondo la mappa neutra *Positron (CartoDB)* basata su dati OpenStreetMap, scelta appositamente per garantire l'elevata leggibilità dei vettori sovrapposti senza appesantire il carico visivo.

---

## 🚀 Link al Progetto Live

La mappa interattiva è pubblicata ed è raggiungibile pubblicamente al seguente indirizzo:

🔗 **[https://andrymarchio13.github.io/Qgis-Bicipolitana-Pesaro/](https://andrymarchio13.github.io/Qgis-Bicipolitana-Pesaro/)**
