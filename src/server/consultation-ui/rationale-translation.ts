/**
 * Deterministische Uebersetzungstabelle fuer `RecommendationRationale`-Zeilen
 * (AP6, siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 7). `factorKey` setzt
 * sich aus einem Praefix (`eligibility:`/`exclusion:`/`prioritization:`) und
 * einem TENANT-AUTORIERTEN Regel-`key`/`reasonCode` zusammen (siehe
 * `eligibility.ts`, `exclusion.ts`, `prioritization.ts`) -- die konkreten
 * Regel-Schluessel sind also KEINE feste, im Code enumerierbare Menge,
 * sondern Fachdaten, die pro Mandant/RuleSetVersion frei vergeben werden
 * koennen. Diese Funktion ist bewusst NUR eine reine Nachschlagetabelle
 * (`Record<string, (value: string) => string>`) fuer die bereits bekannten
 * Schluessel aus dem synthetischen Demo-Regelsatz (`prisma/seed.ts`) -- KEIN
 * Sprachmodell, KEINE Interpretation von unbekannten Schluesseln. Absichtlich
 * NICHT auf `EligibilityRule.description`/`ExclusionRule.description` u. Ae.
 * gestuetzt: diese Felder sind interne Regel-Dokumentation (koennen z. B.
 * Test-/Synthetik-Hinweise wie "synthetische Platzhalterregel" enthalten),
 * keine fuer Mitarbeiter freigegebene UI-Kopie.
 *
 * Unbekannte `factorKey`-Werte loesen keinen Rateversuch aus, sondern eine
 * generische, sichere Fallback-Anzeige plus ein technisches
 * Monitoring-Ereignis (`console.warn`, siehe `ErrorBoundary.tsx` fuer
 * dasselbe Muster) -- damit neue/unuebersetzte Regel-Schluessel auffallen,
 * bevor sie unbemerkt falsch/unverstaendlich angezeigt werden. Dies ist
 * ausdruecklich KEIN `AnalyticsEvent` (kein passender `AnalyticsEventType`,
 * kein Fachereignis), sondern reines Technik-Monitoring.
 *
 * AP8-Ergaenzung (siehe PHASE_5_IMPLEMENTATION_PLAN.md Abschnitt 9):
 * `OpportunityCard` uebersetzt `RecommendationCrossSellingSignal.reasonCode`
 * bewusst ueber DIESELBE Tabelle/Funktion -- ein zusaetzliches `cross_selling:`-
 * Praefix haelt den Schluesselraum getrennt von `eligibility:`/`exclusion:`/
 * `prioritization:`, ohne eine zweite Uebersetzungsfunktion mit eigenem
 * Fallback-/Logging-Verhalten einzufuehren.
 */

type RationaleTranslator = (factorValue: string) => string;

/**
 * Bekannte `factorKey`-Werte aus dem synthetischen Demo-Regelsatz
 * (`prisma/seed.ts`, Funktion `seedRecommendationRuleSet`/vergleichbar).
 * `eligibility:*`-Werte kommen ausschliesslich als `"matched"`/`"not_matched"`
 * vor (siehe `eligibility.ts::computeEligibilityResult`).
 */
const KNOWN_TRANSLATIONS: Record<string, RationaleTranslator> = {
  "eligibility:mind_18": (value) =>
    value === "matched" ? "Mindestalter erfuellt" : "Mindestalter nicht erfuellt",
  "eligibility:ausreichendes_datenvolumen": (value) =>
    value === "matched"
      ? "Bietet ausreichend Datenvolumen fuer den erkannten Bedarf"
      : "Datenvolumen liegt unter dem erkannten Bedarf",
  "eligibility:roaming_passt_zu_streaming_bedarf": (value) =>
    value === "matched"
      ? "EU-Roaming passt zum erkannten Streaming-Bedarf"
      : "EU-Roaming aktuell nicht relevant fuer den erkannten Bedarf",
  "exclusion:RENEWAL_NO_PREMIUM_TIER": () =>
    "Premium-Tarif wird bei einer Vertragsverlaengerung aktuell nicht angeboten",
  // AP8 (Cross-Selling, siehe Modulkommentar): reasonCode-Werte aus
  // CrossSellingRule.reasonCode (synthetischer Demo-Regelsatz, prisma/seed.ts).
  "cross_selling:STREAMING_ADDON_SUGGESTED": () =>
    "Erkannter Streaming-Bedarf -- ein Streaming-Zusatzpaket koennte passend sein",
  // Fix 4 (ChatGPT-Konsultation 2026-08-06): DSL-Cross-Selling-Szenario.
  "cross_selling:DSL_ADDON_SUGGESTED": () =>
    "Erkanntes Interesse an einem Internetanschluss zuhause -- ein DSL-Angebot koennte passend sein",
};

/**
 * Verhindert wiederholtes Loggen desselben unbekannten `factorKey` innerhalb
 * eines Prozesses (Next.js Server-Prozess laeuft dauerhaft, ohne Drosselung
 * wuerde derselbe unuebersetzte Schluessel bei jedem Seitenaufruf erneut
 * geloggt). Bewusst ein einfaches In-Memory-`Set` -- kein persistentes
 * Monitoring-System vorhanden/gefordert (siehe Modulkommentar).
 */
const loggedUnknownFactorKeys = new Set<string>();

function logUnknownFactorKey(factorKey: string, factorValue: string): void {
  if (loggedUnknownFactorKeys.has(factorKey)) {
    return;
  }
  loggedUnknownFactorKeys.add(factorKey);
  console.warn(
    `[consultation-ui] Unbekannter RecommendationRationale.factorKey ohne Uebersetzung: "${factorKey}" (Beispielwert: "${factorValue}"). Fallback-Anzeige wird verwendet -- src/server/consultation-ui/rationale-translation.ts ggf. ergaenzen.`,
  );
}

/**
 * Uebersetzt eine einzelne `RecommendationRationale`-Zeile (`factorKey` +
 * `factorValue`) in einen fuer Mitarbeiter verstaendlichen deutschen Text.
 * Reine Funktion (keine DB-/Netzwerkzugriffe) -- daher client- UND
 * serverseitig ohne zusaetzlichen Request aufrufbar (siehe Plan Abschnitt 5,
 * Schritt 8: "Begruendung oeffnen ... keine neue Server-Anfrage").
 */
export function translateRationale(factorKey: string, factorValue: string): string {
  const translator = KNOWN_TRANSLATIONS[factorKey];
  if (translator) {
    return translator(factorValue);
  }
  logUnknownFactorKey(factorKey, factorValue);
  return `Zusaetzlicher Faktor: ${factorKey} = ${factorValue}`;
}
