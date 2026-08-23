# Rollen- und Berechtigungsmodell

## Prinzip

Rollenbasierte Zugriffskontrolle (RBAC), Berechtigungen immer im Kontext eines Scopes (Mandant/Unternehmen/Region/Filiale). Eine Rolle allein sagt nichts – erst Rolle + Scope ergibt eine Berechtigung ("Filialleitung von Filiale 3", nicht "Filialleitung" ohne Bezug).

## Rollen (Ausgangsvorschlag, konfigurierbar)

| Rolle                    | Typischer Scope           | Kernrechte                                                                                                                                                            |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verkaufsmitarbeiter      | eigene Filiale            | Sessions starten/führen/abschließen, eigene Sessions einsehen                                                                                                         |
| Filialleitung            | eigene Filiale            | zusätzlich: alle Sessions/Ergebnisse der Filiale einsehen, keine unternehmensweite Sicht                                                                              |
| Regionalleitung          | Region (mehrere Filialen) | Ergebnisse aller Filialen der Region einsehen (**Annahme:** falls Regionsebene überhaupt genutzt wird)                                                                |
| Geschäftsführung         | Unternehmen/Mandant       | volles Dashboard, alle Filialen/Mitarbeiter, KPI-Konfiguration (Ziele)                                                                                                |
| Fachadministrator        | Unternehmen/Mandant       | Fragen, Regeln, Kampagnen, Produktimport, Ziele – **kein** automatischer Zugriff auf personenbezogene Rohdaten einzelner Sessions, sofern nicht zusätzlich zugewiesen |
| Systemadministrator      | Mandant (technisch)       | Benutzer-/Filialverwaltung, Rollenvergabe, technische Konfiguration                                                                                                   |
| (später) Mandanten-Owner | Mandant                   | bei Fremdverkauf an Telekom/O2/Freenet/Handelspartner: administriert eigenen Mandanten unabhängig von anderen Mandanten                                               |

**Wichtige Trennung:** Fachliche Konfiguration (Fragen/Regeln/Kampagnen) und Zugriff auf personenbezogene/Kundendaten sind **getrennte Rechte**, nicht automatisch gekoppelt – ein Admin, der Fragen konfiguriert, sieht dadurch nicht automatisch einzelne Kundenantworten.

## Berechtigungsmatrix (Auszug, nicht abschließend)

| Aktion                             | Mitarbeiter | Filialleitung | Geschäftsführung    | Fachadmin                          | Systemadmin |
| ---------------------------------- | ----------- | ------------- | ------------------- | ---------------------------------- | ----------- |
| Session starten/führen             | ✓           | ✓             | –                   | –                                  | –           |
| eigene Sessions einsehen           | ✓           | ✓             | ✓                   | –                                  | –           |
| alle Sessions der Filiale einsehen | –           | ✓             | ✓                   | –                                  | –           |
| unternehmensweites KPI-Dashboard   | –           | –             | ✓                   | teilweise (KPIs ja, Rohdaten nein) | –           |
| Fragen/Regeln konfigurieren        | –           | –             | ✓ (freigeben)       | ✓ (bearbeiten)                     | –           |
| Ziele/Kampagnen festlegen          | –           | –             | ✓                   | ✓ (Vorschlag/Umsetzung)            | –           |
| Produkte/Tarife importieren        | –           | –             | –                   | ✓                                  | –           |
| Mitarbeiter/Filialen verwalten     | –           | –             | ✓ (Übersicht)       | –                                  | ✓           |
| Rollen vergeben                    | –           | –             | –                   | –                                  | ✓           |
| Audit-Log einsehen                 | –           | –             | ✓ (eigener Mandant) | ✓ (Konfigurationsänderungen)       | ✓           |
| Rollback von Konfiguration         | –           | –             | –                   | ✓ (mit Freigabe)                   | ✓           |

**Annahme:** Genaue Freigabeprozesse (z. B. muss Geschäftsführung Regeländerungen des Fachadmins bestätigen?) sind offen – siehe [OPEN_DECISIONS.md](OPEN_DECISIONS.md).

## Technische Umsetzung

- Jede API-Anfrage trägt Nutzer-, Rollen- und Scope-Information (z. B. via signierter Session/Token).
- Datenbankabfragen sind grundsätzlich scope-gefiltert (kein "Vergiss den WHERE-Filter"-Risiko) – serverseitig erzwungen, nicht nur UI-seitig verborgen.
- Rollenprüfung erfolgt serverseitig vor jeder schreibenden und lesenden Operation auf sensiblen Daten; UI-Ausblendung ist zusätzlich, aber kein Ersatz für die Serverprüfung.
- Rollenzuweisung selbst ist auditiert (`AuditLog`, siehe [DATA_MODEL.md](DATA_MODEL.md)).

## Mandantentrennung

Über alle Rollen hinweg gilt: kein Zugriff über Mandantengrenzen hinweg, unabhängig von der Rolle. Ein "Systemadministrator" agiert scope-gebunden auf genau einen Mandanten; ein globaler Anbieter-Betreiber-Zugriff (falls das System später an mehrere Mandanten verkauft wird) ist eine eigene, separat zu definierende Betreiberrolle außerhalb der mandantenspezifischen Rollen – **offene Entscheidung**, ob und wie diese Betreiberrolle in Phase 1 überhaupt vorgesehen wird.

## Implementierungsstatus (Phase 7)

Die obige Tabelle ist der ursprüngliche, konzeptionelle Rollen-/Rechtekatalog
aus Phase 1. **Tatsächlich durchgesetzt** ist bislang ausschließlich der
Management-Analytics-Ausschnitt (Sichtbarkeit von Provision/Deckungsbeitrag
in der Management-Sicht) — siehe [MANAGEMENT_ANALYTICS.md](MANAGEMENT_ANALYTICS.md)
für das vollständige Modell. Kernpunkte:

- Autorisierung baut ausschließlich auf dem bereits im Schema vorhandenen
  `RoleAssignment`-System (Scope-Typen TENANT/COMPANY/STORE) auf — **kein**
  einfaches `isManagement`-Flag.
- Vier Seed-Rollen sind tatsächlich verdrahtet: `sales_employee` (kein
  Management-Analytics-Zugriff), `store_admin` (STORE-Scope),
  `company_management` (COMPANY-Scope), `executive_management`
  (TENANT-Scope) — siehe `src/server/authz/seed-role-permissions.ts`.
- Autorisierung erfolgt serverseitig vor jeder Aggregation
  (`resolveAuthorizedStoreFilter()`), nicht nur durch UI-Ausblendung — wie
  in Abschnitt "Technische Umsetzung" oben bereits konzeptionell gefordert.
- `managementScope` wird einmalig beim Login aus den `RoleAssignment`-Daten
  abgeleitet und im signierten Session-Token transportiert, nicht bei
  jedem Request neu aus der DB gelesen (Session-Staleness bei
  Rollenentzug ist eine bewusst akzeptierte, dokumentierte Eigenschaft).

Die übrigen in der Tabelle oben skizzierten Rollen (Filialleitung,
Regionalleitung, Fachadministrator, Systemadministrator, Mandanten-Owner)
und die volle Berechtigungsmatrix bleiben weiterhin **konzeptionell**
(Phase-1-Ausgangsvorschlag) und sind nicht Teil des implementierten
Schemas — nur die drei Management-Analytics-Permission-Keys
(`analytics.view_store`/`_company`/`_tenant`) existieren tatsächlich im
Permission-Katalog.
