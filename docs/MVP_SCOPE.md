# MVP, Pilot und Plattformversion

## Abgrenzungslogik

Die drei Stufen unterscheiden sich nicht nach "mehr Features", sondern danach, **welches Risiko** sie zuerst adressieren: MVP validiert die Kernlogik (Fragen→Regeln→Empfehlung) mit echten Mitarbeitern in einer Filiale; Pilot validiert Betrieb über alle fünf Filialen inkl. Dashboard; Plattformversion validiert Mandantenfähigkeit für externen Verkauf.

## MVP (interne Validierung, eine Filiale)

**Ziel:** Beweisen, dass geführter, dynamischer Fragenfluss + regelbasierte Empfehlung im echten Gespräch funktioniert und akzeptiert wird.

**Enthalten:**

- Fragen-Engine mit konfigurierbarem Fragebogen (Version 1, initial durch Entwicklungsteam gepflegt, noch keine Admin-UI nötig)
- Regelbasierte Eignungsprüfung für die wichtigsten Produktkategorien (**Annahme:** Start mit Mobilfunk-Neuvertrag/-Verlängerung + Zubehör, DSL/Glasfaser und Family folgen in Pilot – zu bestätigen, siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md))
- Manuelle Pflege von Produkt-/Tarif-/Provisionsdaten (Admin-Skript oder einfache Eingabemaske, kein voller Admin-Bereich)
- Mitarbeiter-UI: Gesprächsführung, Fortschrittsanzeige, Empfehlung mit Begründung, Zusammenfassung
- Rollen: Mitarbeiter + ein technischer Admin (kein volles RBAC über mehrere Rollen)
- Basis-Analytics-Events werden bereits geschrieben (Grundlage für spätere KPIs), aber **kein** Dashboard
- Grundlegende DSGVO-Basis: Datensparsamkeit, keine Klarnamen-Pflicht, TLS, serverseitige Validierung

**Bewusst ausgeschlossen:** Dashboard, Kampagnenverwaltung, Mandantenfähigkeit über einen Mandanten hinaus, KI-Komfortfunktionen (können, müssen aber nicht enthalten sein).

**Abnahmekriterien:**

1. Ein Mitarbeiter kann ein vollständiges Beratungsgespräch (Neuvertrag und Verlängerung) ohne Entwicklerunterstützung durchführen.
2. Mindestens 3 unterschiedliche Kundensituationen (z. B. Einzelperson/SIM-only, Familie mit Kindern, bestehender Vertrag mit Rufnummernmitnahme) führen zu spürbar unterschiedlichen Fragenpfaden (Beweis: kein starres Formular).
3. Jede angezeigte Empfehlung lässt sich per Klick auf ihre Regel-Begründung zurückführen.
4. Keine Empfehlung enthält einen Preis/eine Eigenschaft, die nicht in den gepflegten Stammdaten steht (Stichprobenprüfung).
5. Alle Kernereignisse (siehe [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md)) werden korrekt geschrieben (technischer Test, kein Dashboard nötig).

## Pilot (alle fünf Filialen)

**Ziel:** Beweisen, dass das System im Mehrfilialbetrieb funktioniert, Ergebnisse messbar sind und die Geschäftsführung damit steuern kann.

**Zusätzlich zum MVP:**

- Vollständiges Rollen-/Berechtigungsmodell (Mitarbeiter, Filialleitung, Geschäftsführung, Fachadmin) – siehe [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md)
- Geschäftsführer-Dashboard mit den in [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md) definierten KPIs
- Admin-Oberfläche für Fragen/Regeln/Ziele/Kampagnen (ohne Code-Änderung)
- Vollständige Produktabdeckung: Mobilfunk, DSL/Glasfaser, Family/Partnerkarten, Streaming/Zusatzoptionen, Zubehör
- Zeitversionierung von Tarifen/Provisionen produktiv genutzt (nicht nur konzeptionell)
- Audit-Log und Rollback für Konfigurationsänderungen
- Baseline-Erhebung für Zeitersparnis-/Umsatzvergleich (siehe [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md), offene Methodenentscheidung)
- Optionale KI-Komfortfunktionen (Zusammenfassung, Formulierung, Folgefragen-Ranking)

**Abnahmekriterien:**

1. Alle fünf Filialen nutzen das System produktiv über einen definierten Beobachtungszeitraum (**Annahme:** 4–6 Wochen).
2. Geschäftsführung kann ohne Entwicklerhilfe die KPIs aus [ANALYTICS_AND_KPIS.md](ANALYTICS_AND_KPIS.md) je Filiale/Mitarbeiter/Zeitraum abrufen.
3. Ein Fachadmin kann eine neue Frage samt Folgefrage-Regel anlegen und veröffentlichen, ohne dass ein Entwickler beteiligt ist.
4. Eine Provisionsänderung wird als neue Version angelegt; historische KPI-Werte vor der Änderung bleiben unverändert (Stichprobentest).
5. Rollback einer fehlerhaften Regeländerung funktioniert nachweislich (Test im Vorfeld des Produktivbetriebs).

## Plattformversion (mandantenfähig, extern verkaufbar)

**Ziel:** Das System an weitere Mandanten (z. B. andere Handelsgruppen, potenziell Provider selbst) lizenzierbar machen.

**Zusätzlich zum Pilot:**

- Mandanten-Onboarding-Prozess (neuer Mandant, eigene Produkte/Fragebögen/Ziele, ohne Beeinflussung bestehender Mandanten)
- Strengere Datenisolation prüfen/umsetzen (siehe offene Architekturfrage in [ARCHITECTURE.md](ARCHITECTURE.md))
- Mandantenübergreifendes Betreiber-Rollenmodell (Support/Wartung ohne Zugriff auf Kundendaten einzelner Mandanten)
- Abrechnungs-/Lizenzmodell (**vollständig offen**, kein Vorschlag in dieser Phase, da rein kaufmännische Entscheidung)
- Mehrsprachigkeit/Mandanten-spezifisches Branding (**Annahme:** nötig für Fremdverkauf, nicht für internen Betrieb)

Diese Stufe wird hier nur strukturell vorbereitet (Datenmodell, Rollenkonzept), nicht im Detail geplant – sie ist kein Bestandteil der aktuellen Entwicklungsphase.

## Nicht in irgendeiner Phase enthalten (ohne explizite Neuentscheidung)

- automatisierte Anbindung an Provider-Portale
- automatisierte Vertragsabschlüsse ohne Mitarbeiterfreigabe
- KI-generierte Tarif-/Preisentscheidungen
