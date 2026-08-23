/**
 * Generischer PII-/Kontaktdaten-Scanner fuer JSON-Felder.
 *
 * Hintergrund (siehe docs/PRIVACY_AND_SECURITY.md, docs/ANALYTICS_AND_KPIS.md):
 * `AnalyticsEvent.payload` und `AuditLog.metadata` duerfen NIEMALS direkte
 * Kontaktdaten (Namen, Telefonnummern, E-Mail-Adressen) oder Freitext
 * enthalten - diese Felder sind ausschliesslich fuer strukturierte,
 * aggregationsfaehige Referenzwerte (IDs, Enums, Zahlen, Booleans) gedacht.
 * Personenbezogene Rohdaten leben in `ConsultationSession`/`CustomerAnswer`
 * o.ae., mit eigenem Zugriffsschutz - nicht im Analytics-/Audit-Log.
 *
 * Dieser Scanner ist eine bewusst generische, modellunabhaengige
 * Sicherheitsnetz-Pruefung (Defense in Depth): Er kennt keine konkreten
 * Payload-Formen einzelner `eventType`/`action`-Werte (diese werden von den
 * noch nicht gebauten Fach-Engines definiert - siehe Stop-Anweisung zu
 * Fragen-/Empfehlungs-Engine), sondern lehnt JEDES JSON ab, das
 * - einen Schluessel enthaelt, der typischerweise personenbezogene Kontaktdaten
 *   bezeichnet (z. B. "email", "telefon", "vorname", "adresse", ...), oder
 * - einen String-Wert enthaelt, der wie eine E-Mail-Adresse oder
 *   Telefonnummer aussieht, oder
 * - einen auffaellig langen String-Wert enthaelt (Heuristik fuer Freitext).
 */

/** Auf Normalform (nur a-z0-9, kleingeschrieben) exakt verbotene Schluessel. */
const FORBIDDEN_KEYS = new Set([
  // Namen
  "name",
  "firstname",
  "lastname",
  "fullname",
  "nickname",
  "displayname",
  "customername",
  "kundenname",
  "vorname",
  "nachname",
  "ansprechpartner",
  "contactname",
  "contactperson",
  // E-Mail
  "email",
  "emailaddress",
  "mail",
  "mailaddress",
  // Telefon
  "phone",
  "phonenumber",
  "telefon",
  "telefonnummer",
  "mobile",
  "mobilenumber",
  "fax",
  "faxnumber",
  // Adresse
  "address",
  "adresse",
  "strasse",
  "street",
  "hausnummer",
  "housenumber",
  "plz",
  "postleitzahl",
  "postalcode",
  "zipcode",
  "city",
  "ort",
  "stadt",
  // Zahlungs-/Ausweisdaten
  "iban",
  "bic",
  "kontonummer",
  "accountnumber",
  "creditcard",
  "kreditkarte",
  "birthdate",
  "geburtsdatum",
  "dateofbirth",
  "ssn",
  "sozialversicherungsnummer",
  "personalausweis",
  "passnummer",
  "passportnumber",
  "idnumber",
  // Freitext
  "notes",
  "notiz",
  "notizen",
  "comment",
  "comments",
  "kommentar",
  "freitext",
  "freetext",
  "message",
  "nachricht",
  "description",
  "beschreibung",
  "remark",
  "remarks",
]);

/** Maximale Laenge eines String-Werts, bevor er als vermutlicher Freitext gilt. */
const MAX_STRING_LENGTH = 200;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// Erkennt Telefonnummern-artige Ziffernfolgen (>= 7 Ziffern, optional mit
// Laendervorwahl/Trennzeichen). UUIDs werden vorher separat ausgeschlossen,
// damit z. B. "11111111-1111-1111-1111-111111111111" nicht als Telefonnummer
// fehlinterpretiert wird.
const PHONE_REGEX = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,}\d{2,}/;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function countDigits(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

export class ContactDataDetectedError extends Error {
  constructor(context: string, issues: string[]) {
    super(
      `Kontaktdaten/Freitext in "${context}" abgelehnt - dieses Feld darf ausschliesslich ` +
        `strukturierte, nicht-personenbezogene Werte (IDs, Enums, Zahlen, Booleans) enthalten. ` +
        `Gefundene Probleme:\n- ${issues.join("\n- ")}`,
    );
    this.name = "ContactDataDetectedError";
  }
}

function scanString(value: string, path: string, issues: string[]): void {
  if (UUID_REGEX.test(value)) {
    return; // technische ID, keine Kontaktdaten
  }
  if (EMAIL_REGEX.test(value)) {
    issues.push(`${path}: Wert sieht wie eine E-Mail-Adresse aus`);
    return;
  }
  if (PHONE_REGEX.test(value) && countDigits(value) >= 7) {
    issues.push(`${path}: Wert sieht wie eine Telefonnummer aus`);
    return;
  }
  if (value.length > MAX_STRING_LENGTH) {
    issues.push(
      `${path}: String-Wert ist laenger als ${MAX_STRING_LENGTH} Zeichen (vermutlicher Freitext)`,
    );
  }
}

function scanValue(value: unknown, path: string, issues: string[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    scanString(value, path, issues);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${path}[${index}]`, issues));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
        issues.push(`${childPath}: Schluesselname "${key}" deutet auf Kontaktdaten/Freitext hin`);
        continue;
      }
      scanValue(child, childPath, issues);
    }
  }
}

/**
 * Wirft {@link ContactDataDetectedError}, falls `value` verbotene
 * Kontaktdaten-Schluessel, E-Mail-/Telefonnummer-artige Werte oder
 * auffaellig lange Freitext-Strings enthaelt. `context` dient nur der
 * Fehlermeldung (z. B. Modellname/Feldname).
 */
export function assertNoContactData(value: unknown, context: string): void {
  const issues: string[] = [];
  scanValue(value, "", issues);
  if (issues.length > 0) {
    throw new ContactDataDetectedError(context, issues);
  }
}

/** Wie {@link assertNoContactData}, gibt aber statt zu werfen die Problemliste zurueck (leer = ok). */
export function findContactDataIssues(value: unknown): string[] {
  const issues: string[] = [];
  scanValue(value, "", issues);
  return issues;
}
