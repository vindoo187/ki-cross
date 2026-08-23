# Phase 12 AP5b — Provider-Evaluierung/Entscheidung

**Status:** Reines Evaluierungs-/Entscheidungsdokument. Kein Code, keine
API-Schlüssel, keine Vertragsunterzeichnung, keine Aktivierung. Baut auf
[PHASE_12_AP5_DISCOVERY.md](PHASE_12_AP5_DISCOVERY.md) auf (dort wurde der
Kriterienrahmen definiert, hier werden konkrete Anbieter dagegen geprüft).
Die finale Anbieterwahl bleibt eine Geschäfts-/Vertragsentscheidung von
ChatGPT (Projektleiter) und Nutzer — dieses Dokument liefert die
Entscheidungsgrundlage, trifft aber selbst keine Festlegung.

Recherchestand: 2026-08-23, ausschließlich öffentlich zugängliche
Anbieterdokumentation/-statusseiten (Websuche), keine echten Testaufrufe,
keine API-Schlüssel angelegt.

## 0. Geprüfte Kandidaten

Auswahl von drei Kandidaten, die strukturierten JSON-Output unterstützen und
für den europäischen Geschäftskontext realistisch in Frage kommen:

1. **Anthropic Claude API** (aktuelles Flaggschiff-Set inkl. Claude Sonnet 5)
2. **OpenAI API** (aktuelles Flaggschiff GPT-5.6 „Sol")
3. **Mistral AI — La Plateforme** (aktuelles Flaggschiff Large 3)

Google Gemini wurde nicht vertieft (kein expliziter Auftrag, Fokus auf drei
Kandidaten gemäß AP5b-Scope), könnte bei Bedarf nachträglich ergänzt werden.

## 1. Kriterientabelle

| Kriterium                                                  | Anthropic Claude API                                                                                                                                                                               | OpenAI API (GPT-5.6 Sol)                                                                                                                                                                                    | Mistral La Plateforme (Large 3)                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured JSON Output**                                 | Ja, unterstützt (Tool-Use/JSON-Modus)                                                                                                                                                              | Ja, `response_format`/JSON-Schema-Modus                                                                                                                                                                     | Ja, `response_format: json_object`, garantiert valides JSON                                                                                                                                                                                              |
| **Kein Training auf API-Daten**                            | Ja, standardmäßig kein Training auf API-Inputs/Outputs                                                                                                                                             | Ja, standardmäßig kein Training auf API-Inputs/Outputs                                                                                                                                                      | Ja, bei bezahlten Plänen (inkl. Scale) standardmäßig ausgeschlossen, kein Opt-out nötig                                                                                                                                                                  |
| **AVV/DPA verfügbar**                                      | Ja, Art.-28-DPA inkl. SCCs vorhanden                                                                                                                                                               | Ja, DPA vorhanden (aktualisiert 01.01.2026, mit Anonymisierungs-Klausel)                                                                                                                                    | Ja, DPA verfügbar über La Plateforme/Enterprise (GDPR-Baseline)                                                                                                                                                                                          |
| **Datenverarbeitung/-speicherung**                         | Standard: automatische Löschung der Inputs/Outputs innerhalb 30 Tagen; „Covered Models" abweichend (30 Tage Pflichtretention); Zero Data Retention (ZDR) nach Freigabe möglich                     | Standard: bis zu 30 Tage Abuse-Monitoring-Logs; ZDR nur nach Enterprise-Freigabe (nicht automatisch)                                                                                                        | **Standard: 30 Tage rollierende Aufbewahrung von Input/Output** (Abuse-Monitoring); ZDR nur auf Scale-Plan und nach Einzelantrag/-prüfung durch Mistral verfügbar, gilt zudem NICHT für zustandsbehaftete Produkte (Agents, Batch, Conversations, Files) |
| **Echte EU-Datenresidenz (direkte API, ohne Umweg)**       | **Nein** — reguläre Claude-API läuft über US-Infrastruktur; EU-Verarbeitung nur indirekt über AWS Bedrock (eu-central-1) oder Google Vertex AI erreichbar                                          | **Ja** — dedizierter Endpunkt `eu.api.openai.com` mit echter EU-Datenresidenz (ca. 10 % Preisaufschlag für berechtigte Modelle)                                                                             | **Ja** — Mistral ist ein französisches/EU-Unternehmen, La Plateforme bietet nativ EU-gehostete Endpunkte                                                                                                                                                 |
| **Drittlandregelung (falls kein EU-Hosting genutzt wird)** | SCCs vorhanden (Voraussetzung für Nutzung der Standard-US-API)                                                                                                                                     | SCCs vorhanden; bei Nutzung des EU-Endpunkts ggf. nicht relevant                                                                                                                                            | Bei EU-Hosting i. d. R. kein Drittlandtransfer nötig                                                                                                                                                                                                     |
| **Niedrige Latenz**                                        | Keine belastbaren eigenen Messwerte vorhanden (keine echten Testaufrufe durchgeführt); grundsätzlich als Flaggschiff-Modell mit vergleichbarer Größenordnung wie GPT-5.6/Mistral Large einzuordnen | Prompt-Caching (bis zu 90 % Rabatt) und Batch-Modus (50 % Rabatt) verfügbar, deuten auf ausgereifte Latenz-/Kostenoptimierung hin; keine eigenen Messwerte                                                  | Kleinere Modellvarianten (Small 3.1, Nemo) mit voraussichtlich niedrigerer Latenz als Flaggschiff-Modelle verfügbar, falls Geschwindigkeit wichtiger als Qualität ist; keine eigenen Messwerte                                                           |
| **Qualität bei deutscher Sprache**                         | Keine dedizierten deutschsprachigen Benchmarks gefunden                                                                                                                                            | Kein dediziertes Deutsch-Benchmark gefunden; auf allgemeinem Mehrsprachigkeits-/Übersetzungs-Benchmark im Mittelfeld (zusammen mit Claude Sonnet und Mistral Large, alle deutlich hinter dem Spitzenreiter) | Als europäischer Anbieter oft mit Fokus auf europäische Sprachen beworben, aber ebenfalls kein belastbares dediziertes Deutsch-Benchmark gefunden; im selben Mehrsprachigkeits-Benchmark gleichauf mit Claude Sonnet                                     |
| **Kalkulierbare Kosten (Stand 08/2026, pro Mio. Token)**   | Kein Flaggschiff-Preis für diese Auswertung recherchiert (Sonnet 5 als Vergleichsmaßstab: 2 $/10 $ Einführungspreis)                                                                               | GPT-5.6 Sol: ca. 4–5 $ Input / 20–30 $ Output (Kurzkontext), bis 10 $/45 $ bei Langkontext; 90 % Cache-Rabatt, 50 % Batch-Rabatt                                                                            | Deutlich günstiger gestaffelt: Large 3 2 $/6 $, Medium 3 1 $/3 $, Small 3.1 0,20 $/0,60 $, Nemo 0,02 $/0,04 $                                                                                                                                            |
| **API-Zuverlässigkeit (öffentliche Statusdaten)**          | api.anthropic.com: 99,59 % Uptime über 90 Tage (Statusseiten-Tracking), 166 gemeldete Vorfälle seit Januar 2026, u. a. ein größerer „529 Overloaded"-Vorfall am 29.07.2026                         | Offizielles SLA: 99,9 % nur für Scale-Tier (Pay-as-you-go explizit ausgeschlossen); gemessene 30-Tage-Uptime ca. 99,95 %, aber auch 93 gemeldete Vorfälle 2026 laut Drittanbieter-Tracking                  | Kein SLA im Pay-as-you-go-Modus, nur vertraglich im Enterprise-Rahmen; öffentliche Statusseite vorhanden, Drittanbieter-Tracking zeigt sehr viele (überwiegend kurze) Vorfälle über das letzte Jahr                                                      |

## 2. Einordnung je Kandidat

### Anthropic Claude API

Stärkster Formfaktor bezüglich DPA/SCC-Reife und Nicht-Training-Garantie,
aber **kein echtes direktes EU-Hosting** — dafür wäre der Umweg über AWS
Bedrock oder Google Vertex AI nötig, was die Architektur (ein zusätzlicher
Cloud-Vermittler) komplexer macht als ein direkter API-Endpunkt. Passt nur
bedingt zur in [PRIVACY_AND_SECURITY.md](PRIVACY_AND_SECURITY.md) formulierten
Pflichtanforderung „Datenverarbeitung muss innerhalb der EU (oder mit
gleichwertigem Schutzniveau) möglich sein" — SCCs würden das gleichwertige
Schutzniveau abdecken, echte EU-Residenz aber nicht ohne Umweg.

### OpenAI API (GPT-5.6 Sol)

Einziger Kandidat mit **direktem, dediziertem EU-Endpunkt ohne
Cloud-Umweg**, bei moderatem Preisaufschlag (ca. 10 %). ZDR ist aber nicht
automatisch, sondern erfordert eine separate Enterprise-Freigabe durch
OpenAI — das müsste vor Produktivbetrieb aktiv beantragt und bestätigt
werden. Kosten pro Mio. Token liegen im oberen Bereich der drei Kandidaten.

### Mistral La Plateforme (Large 3)

Als EU-Unternehmen strukturell am nächsten an den Datenschutzanforderungen
des Projekts, mit Abstand günstigste Kostenstruktur und einer nach unten
gestaffelten Modellfamilie (Small/Nemo) für den Fall, dass ein kleineres/
günstigeres Modell für die reine Strukturextraktion ausreicht. **Wichtiger
Befund, der explizit gegen die in AP5-Discovery formulierte Präferenz
„möglichst transiente, nicht persistierte Verarbeitung" abzuwägen ist:**
Mistral speichert Input/Output standardmäßig **30 Tage rollierend**, bevor
gelöscht wird — eine echte Zero-Data-Retention-Option existiert zwar, ist
aber nicht automatisch, sondern erfordert einen begründeten Einzelantrag und
gilt zudem nicht für alle Produktarten. Dieser Punkt ist im Vergleich zu
Anthropic/OpenAI (dort ist ZDR ebenfalls nicht automatisch, aber der
Ausgangszustand — 30 Tage reines Abuse-Monitoring ohne Modelltraining — ist
vergleichbar) kein Alleinstellungsmerkmal gegen Mistral, sollte aber bei der
finalen Entscheidung nicht übersehen werden.

## 3. Zusammenfassende Beobachtung (keine Empfehlung)

Kein Kandidat erfüllt alle neun Kriterien ohne Einschränkung „out of the
box":

- Anthropic: stärkste Vertragslage, aber kein direktes EU-Hosting.
- OpenAI: einziger direkter EU-Endpunkt, aber höchste Kosten und ZDR nur auf
  Antrag.
- Mistral: günstigste Kosten und EU-nativ, aber 30-Tage-Standardretention
  ohne automatisches ZDR.

Zur deutschen Sprachqualität und zur Latenz liegen **keine belastbaren,
dedizierten Messwerte** vor — beide Kriterien aus ChatGPTs Vorgabe konnten
nur indirekt (allgemeine Mehrsprachigkeits-Benchmarks bzw. technische
Ausstattungsmerkmale wie Prompt-Caching) eingeordnet werden. Eine
verlässliche Aussage dazu wäre nur durch eigene Testaufrufe mit
synthetischen deutschen Freitext-Beispielen möglich — das wäre bereits ein
technischer Schritt (API-Zugang, wenn auch ohne Produktivnutzung) und liegt
damit außerhalb des für AP5b vereinbarten Rahmens („kein Code, keine
API-Schlüssel").

## 4. Offene Fragen an ChatGPT

1. Ist echtes direktes EU-Hosting (OpenAI, Mistral) eine Pflichtanforderung,
   oder genügt SCC-basierte Drittlandübermittlung mit gleichwertigem
   Schutzniveau (Anthropic direkt, oder Anthropic via EU-Cloud-Umweg)?
2. Wie ist die 30-Tage-Standardretention bei Mistral im Verhältnis zur in
   AP5-Discovery formulierten Transienz-Präferenz zu bewerten — akzeptabel,
   wenn vertraglich ein späterer ZDR-Antrag vorgesehen wird, oder
   Ausschlusskriterium schon für den Start?
3. Soll die fehlende belastbare Datenlage zu deutscher Sprachqualität und
   Latenz vor einer Entscheidung noch durch einen begrenzten,
   ChatGPT-genehmigten Testzugang (eigener, separat zu genehmigender
   Schritt, kein Teil von AP5b) geschlossen werden, oder reicht die
   bisherige Einordnung für eine vorläufige Anbieterwahl?
4. Falls eine vorläufige Präferenz gewünscht ist: Soll diese als
   „vorläufig, vorbehaltlich AVV-Unterzeichnung und Kostenfreigabe"
   festgehalten werden, oder bleibt die Anbieterfrage bis zum tatsächlichen
   Implementierungs-GO (AP6) vollständig offen?

## 5. Was dieses Dokument ausdrücklich nicht enthält

- Keine Vertragsunterzeichnung, kein AVV-Abschluss mit einem der Kandidaten.
- Keine API-Schlüssel-Erstellung, keine echten Testaufrufe.
- Keine finale, bindende Anbieterentscheidung — das bleibt ChatGPT/Nutzer
  vorbehalten.
- Keine Kostenfreigabe/Budgetentscheidung.
- Keine Änderung an bestehendem Code (`MockExtractionProvider` bleibt
  unverändert einziger aktiver Provider).
