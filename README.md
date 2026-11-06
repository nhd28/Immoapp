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
APP_PASSWORD=geheim APP_USERS="Nico,Matthias" npm start
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

Damit du und Matthias dieselben Daten seht, muss die App auf einem Server laufen, z. B. per Docker:

```bash
docker build -t immo-pipeline .
docker run -d -p 3000:3000 -v immo-data:/data \
  -e APP_PASSWORD=geheim -e APP_USERS="Nico,Matthias" -e ANTHROPIC_API_KEY=sk-ant-... \
  immo-pipeline
```

Funktioniert genauso auf Render, Railway, Fly.io o. Ä. – wichtig ist ein **persistentes Volume** für `/data`
und HTTPS davor (machen diese Anbieter automatisch).

## Technik

Express + `node:sqlite` (keine nativen Abhängigkeiten), Multer für Uploads, Frontend ohne Build-Schritt
(`public/`), `@anthropic-ai/sdk` für die KI-Analyse.
