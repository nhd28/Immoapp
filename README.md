# Immo-Pipeline 🏠

Gemeinsame Web-App für zwei (oder mehr) Käufer, um Immobilien-Exposés zu sammeln, zu bewerten und
durch den Kaufprozess zu begleiten.

## Funktionen

- **Exposés hochladen** – PDF(s), Bilder und weitere Dokumente per Drag & Drop. Jedes neue Objekt landet im **Eingang**.
- **Pipeline (Kanban)** von Eingang bis Kauf:
  `Eingang → In Prüfung → Besichtigung → Angebot abgegeben → Finanzierung → Notartermin → Gekauft` (+ `Abgelehnt`).
  Status per Drag & Drop, Dropdown oder Klick auf den Schritt ändern – jede Änderung landet im Verlauf.
- **Bewertung pro Person** – 1–5 Sterne für Lage, Zustand, Preis/Leistung, Rendite, Potenzial, dazu
  „Kaufen / Vielleicht / Nein“ und ein Kommentar. Die Übersicht zeigt den Durchschnitt und wer wie entschieden hat.
- **Bilder** – Galerie mit Titelbild, Vollbild-Ansicht (Pfeiltasten), Upload und Löschen.
- **Kennzahlen automatisch** – Preis/m², Bruttomietrendite, Kaufpreisfaktor, Nebenkosten (~10,5 %), Gesamtinvest, grobe Nettorendite.
- **KI-Analyse (optional)** – mit gesetztem `ANTHROPIC_API_KEY` liest Claude das Exposé-PDF, füllt leere Eckdaten
  automatisch aus und liefert Score (1–10), Stärken, Schwächen, Risiken, Fragen an den Makler und fehlende Unterlagen.
- **Verlauf & Kommentare**, Listenansicht mit Sortierung, Suche, mobil nutzbar.

## Starten

Voraussetzung: Node.js ≥ 22.13

```bash
npm install
APP_PASSWORD=geheim APP_USERS="DeinName,Matthias" npm start
# → http://localhost:3000
```

Alle Daten (SQLite-Datenbank + Uploads) liegen in `./data` (über `DATA_DIR` änderbar) – diesen Ordner sichern.

### Konfiguration

| Variable | Bedeutung |
|---|---|
| `APP_USERS` | Namen für den Login-Bildschirm, kommagetrennt (Standard `Ich,Matthias`) |
| `APP_PASSWORD` | Gemeinsames Passwort. **Ohne Passwort kann jeder mit dem Link zugreifen.** |
| `ANTHROPIC_API_KEY` | Aktiviert die KI-Analyse der Exposés |
| `CLAUDE_MODEL` | Optional, Standard `claude-opus-5-5` |
| `PORT`, `DATA_DIR` | Port und Datenverzeichnis |

## Gemeinsam nutzen (Hosting)

### Render (empfohlen, ca. 7–8 $/Monat)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/nhd28/Immoapp)

1. Konto auf [render.com](https://render.com) anlegen und GitHub verbinden.
2. Auf den Button oben klicken (oder *New → Blueprint* und dieses Repository wählen). Render liest `render.yaml`.
3. Beim Anlegen werden abgefragt:
   - `APP_PASSWORD` – euer gemeinsames Passwort (Pflicht, lang und zufällig wählen),
   - `ANTHROPIC_API_KEY` – optional für die KI-Analyse.
4. Nach dem Deploy unter *Environment* `APP_USERS` auf eure Namen setzen, z. B. `DeinName,Matthias`.
5. Die Adresse (`https://immo-pipeline-xxxx.onrender.com`) an Matthias schicken und in GitHub als
   Variable `IMMO_SERVER_URL` für die native App eintragen (siehe `mobile/README.md`).

Kosten (Stand Ende 2025, bitte auf render.com/pricing prüfen): *Starter*-Instanz (7 $/Monat) + Festplatte (5 GB, ca. 0,25 $/GB/Monat). Der kostenlose Plan reicht
nicht, weil er keine dauerhafte Festplatte hat – Exposés und Bewertungen würden bei jedem Neustart verloren gehen.
Render erstellt täglich Snapshots der Festplatte. Server-Standort: Frankfurt.

Eigene Domain (z. B. `immo.deinname.de`): Render → Service → *Settings → Custom Domains*.

### Docker (eigener Server)

```bash
docker build -t immo-pipeline .
docker run -d -p 3000:3000 -v immo-data:/data \
  -e APP_PASSWORD=geheim -e APP_USERS="DeinName,Matthias" -e ANTHROPIC_API_KEY=sk-ant-... \
  immo-pipeline
```

Wichtig ist ein **persistentes Volume** für `/data` und HTTPS davor.

## Native App (iOS & Android)

Unter [`mobile/`](mobile/README.md) liegt eine native App-Hülle (Capacitor). Android-APKs baut GitHub Actions
automatisch, iOS-Builds gehen per Workflow direkt zu TestFlight – Anleitung in [`mobile/README.md`](mobile/README.md).
Zusätzlich lässt sich die Web-App auf iPhone/Android über „Zum Home-Bildschirm“ wie eine App installieren.

## Technik

Express + `node:sqlite` (keine nativen Abhängigkeiten), Multer für Uploads, Frontend ohne Build-Schritt
(`public/`), `@anthropic-ai/sdk` für die KI-Analyse.
