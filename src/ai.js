// Optionale KI-Auswertung von Exposés mit Claude.
// Aktiv, sobald ANTHROPIC_API_KEY gesetzt ist.
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, logActivity } from './db.js';

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_PDF_BYTES = 25 * 1024 * 1024; // Request-Limit der API liegt bei 32 MB (base64 bläht auf)

const num = { type: ['number', 'null'] };
const str = { type: ['string', 'null'] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['extracted', 'assessment'],
  properties: {
    extracted: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'address', 'city', 'type', 'price', 'living_area', 'plot_area', 'rooms', 'units',
        'year_built', 'rent_yearly', 'hausgeld', 'energy_class', 'contact'],
      properties: {
        title: str, address: str, city: str,
        type: { type: ['string', 'null'], enum: ['Eigentumswohnung', 'Einfamilienhaus', 'Mehrfamilienhaus', 'Wohn- und Geschäftshaus', 'Gewerbe', 'Grundstück', 'Sonstiges', null] },
        price: num, living_area: num, plot_area: num, rooms: num, units: { type: ['integer', 'null'] },
        year_built: { type: ['integer', 'null'] }, rent_yearly: num, hausgeld: num, energy_class: str, contact: str,
      },
    },
    assessment: {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'summary', 'pros', 'cons', 'risks', 'questions', 'missing_documents'],
      properties: {
        score: { type: 'integer', description: 'Gesamteinschätzung 1 (schlecht) bis 10 (hervorragend)' },
        summary: { type: 'string' },
        pros: { type: 'array', items: { type: 'string' } },
        cons: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        questions: { type: 'array', items: { type: 'string' } },
        missing_documents: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

const SYSTEM = `Du bist ein erfahrener Immobilien-Investmentanalyst in Deutschland und prüfst Exposés für zwei private Käufer.
Lies die beigefügten Exposé-Dokumente vollständig.
1) Extrahiere die Eckdaten. Zahlen ohne Einheit/Tausenderpunkte (Kaufpreis in EUR, Flächen in m², rent_yearly = aktuelle Jahresnettokaltmiete in EUR, hausgeld = monatliches Hausgeld in EUR). Unbekanntes = null, nichts erfinden.
2) Bewerte die Immobilie nüchtern als Kapitalanlage bzw. Eigennutzung: Lage, Zustand, Preis pro m², Mietrendite/Faktor, Instandhaltungsstau, rechtliche Besonderheiten (Erbpacht, Denkmalschutz, Nießbrauch, Mietpreisbindung usw.).
Schreibe alle Texte auf Deutsch, knapp und konkret. "questions" sind Fragen an den Makler/Verkäufer, "missing_documents" fehlende Unterlagen für die Prüfung.`;

export async function analyzeProperty(propertyId, user) {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) throw new Error('Immobilie nicht gefunden');
  const pdfs = db.prepare("SELECT * FROM files WHERE property_id = ? AND kind = 'expose' AND mime = 'application/pdf' ORDER BY id").all(propertyId);
  if (!pdfs.length) throw new Error('Kein Exposé-PDF vorhanden');

  const content = [];
  let total = 0;
  for (const f of pdfs) {
    const buf = fs.readFileSync(path.join(UPLOAD_DIR, f.stored_name));
    if (total + buf.length > MAX_PDF_BYTES) break;
    total += buf.length;
    content.push({ type: 'document', title: f.original_name || undefined, source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
  }
  if (!content.length) throw new Error('Exposé-PDF ist zu groß für die Analyse (max. 25 MB)');

  const known = Object.fromEntries(
    ['title', 'address', 'city', 'type', 'price', 'living_area', 'rent_yearly', 'notes'].map((k) => [k, property[k]]).filter(([, v]) => v != null && v !== ''),
  );
  content.push({ type: 'text', text: `Bereits erfasste Angaben (können unvollständig sein): ${JSON.stringify(known)}\nBitte analysiere das Exposé.` });

  db.prepare("UPDATE properties SET ai_status = 'running', ai_error = NULL WHERE id = ?").run(propertyId);

  try {
    const client = new Anthropic();
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('Die KI hat die Analyse abgelehnt.');
    if (msg.stop_reason === 'max_tokens') throw new Error('Antwort der KI wurde abgeschnitten.');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const result = JSON.parse(text);

    // Leere Felder automatisch mit extrahierten Werten füllen – vorhandene Eingaben bleiben unangetastet.
    const fill = {};
    for (const [k, v] of Object.entries(result.extracted)) {
      if (v == null || v === '') continue;
      if (k === 'title' && property.title && !/^Neues Exposé/.test(property.title)) continue;
      if (k !== 'title' && property[k] != null && property[k] !== '') continue;
      fill[k] = v;
    }
    const cols = Object.keys(fill);
    db.prepare(
      `UPDATE properties SET ai_status = 'done', ai_analysis = ?, ai_at = datetime('now')${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`,
    ).run(JSON.stringify(result), ...cols.map((c) => fill[c]), propertyId);
    logActivity(propertyId, user, 'ai', `KI-Analyse abgeschlossen (Score ${result.assessment.score}/10)`);
    return result;
  } catch (err) {
    let message = err.message;
    if (err instanceof Anthropic.AuthenticationError) message = 'API-Key ungültig';
    else if (err instanceof Anthropic.RateLimitError) message = 'Rate-Limit erreicht – bitte später erneut versuchen';
    else if (err instanceof Anthropic.APIError) message = `API-Fehler: ${err.message}`;
    db.prepare("UPDATE properties SET ai_status = 'error', ai_error = ? WHERE id = ?").run(message, propertyId);
    throw new Error(message);
  }
}
