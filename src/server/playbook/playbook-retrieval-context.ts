/**
 * Phase 14 AP4 -- DB-Ladefunktion fuer die Retrieval-Selektionsfunktion
 * (`playbook-retrieval.ts`, bewusst DB-frei, siehe dortigen
 * Modulkommentar). Diese Datei uebernimmt GENAU die Scope-/Zeitraum-/
 * Tenant-Aufloesung, analog `loadActiveCampaignContext()`
 * (`recommendation/service.ts`, Phase 13 AP4/AP7) -- KEIN neues
 * paralleles Scope-/Visibility-Muster, sondern Wiederverwendung des
 * etablierten Musters fuer eine neue Entitaet (identisches Prinzip wie
 * dort dokumentiert).
 *
 * WICHTIG (Architekturgrenze, siehe `playbook-retrieval.ts`): diese Datei
 * wird NICHT von `evaluate()` (`recommendation/service.ts`) aufgerufen
 * und importiert nichts aus `recommendation/*` -- vollstaendig
 * eigenstaendiges Modul, analog wie `playbook-admin.ts` bereits
 * eigenstaendig ist. Nutzt den tenant-gescopten `db`-Client
 * (`src/server/tenant/scoped-client.ts`) -- Tenant-Isolation ist damit
 * strukturell erzwungen (kein manueller `tenantId`-Filter noetig, siehe
 * `playbook-admin.ts`-Praezedenzfall).
 *
 * SCOPE-SEMANTIK (identisch zu `loadActiveCampaignContext()`): TENANT-
 * Scope gilt fuer JEDE Session/Anfrage dieses Mandanten, STORE-Scope NUR
 * fuer die exakt passende Filiale (`storeId`). Mehrere `Playbook`s koennen
 * gleichzeitig je eine ACTIVE-Version haben (jedes `Playbook` ist
 * unabhaengig versioniert/gescoped, siehe AP1) -- alle passenden werden
 * hier aggregiert.
 *
 * ZEITRAUM-SEMANTIK: identisches "JETZT"-Prinzip wie
 * `loadActiveRuleSetVersion()`/`loadActiveCampaignContext()`
 * (`validFrom <= atTime` UND (`validTo` ist `null` ODER `validTo >
 * atTime`)) -- Draft-Versionen (`status != "ACTIVE"`) und bereits
 * expirierte/noch nicht gueltige Versionen liefern strukturell KEINE
 * Kandidaten.
 *
 * CONTENT-MINIMIERUNG (Trust-Boundary-Fortsetzung aus
 * `playbook-retrieval.ts`): `content` wird zwar aus der DB gelesen (hier
 * unvermeidbar, um `contentLength` zu bilden), aber NICHT im
 * zurueckgegebenen `PlaybookRetrievalCandidateSection` exponiert -- nur
 * dessen Zeichenlaenge. Ein spaeteres, separates AP laedt bei Bedarf den
 * tatsaechlichen Content fuer die von `selectPlaybookSections()`
 * ausgewaehlten IDs.
 */

import type { ScopedPrismaClient } from "../tenant/scoped-client";
import type { PlaybookRetrievalCandidateSection } from "./playbook-retrieval";

type QueryClient = ScopedPrismaClient;

/**
 * Laedt alle `PlaybookSection`-Kandidaten aus AKTIVEN `PlaybookVersion`s,
 * deren Scope zu `storeId` passt (TENANT-Scope immer, STORE-Scope nur bei
 * exakter Uebereinstimmung) und deren Gueltigkeitszeitraum `atTime`
 * einschliesst. Laeuft innerhalb des aktuellen Tenant-Kontexts
 * (`runWithTenantContext()`, siehe Aufrufer/Tests) -- der tenant-gescopte
 * `db`-Client erzwingt die Mandantengrenze strukturell.
 *
 * Bewusst OHNE `active`-Filter auf DB-Ebene: `PlaybookSection.active`
 * wird von der reinen Selektionsfunktion (`selectPlaybookSections()`)
 * ausgewertet, nicht hier -- diese Funktion liefert alle strukturell
 * erreichbaren Kandidaten (aktive UND inaktive Sections der jeweils
 * aktiven Version), damit `selectPlaybookSections()` die vollstaendige,
 * fachliche Filterentscheidung trifft (keine doppelte, potenziell
 * inkonsistente Filterlogik an zwei Stellen).
 */
export async function loadActivePlaybookSectionCandidates(
  client: QueryClient,
  storeId: string,
  atTime: Date,
): Promise<PlaybookRetrievalCandidateSection[]> {
  const versions = await client.playbookVersion.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: atTime },
      AND: [
        { OR: [{ validTo: null }, { validTo: { gt: atTime } }] },
        { OR: [{ scopeType: "TENANT" }, { scopeType: "STORE", scopeId: storeId }] },
      ],
    },
    include: { sections: true },
  });

  const candidates: PlaybookRetrievalCandidateSection[] = [];
  for (const version of versions) {
    for (const section of version.sections) {
      candidates.push({
        id: section.id,
        sectionType: section.sectionType,
        relatedTopics: section.relatedTopics,
        relatedProductKeys: section.relatedProductKeys,
        relatedSituations: section.relatedSituations,
        priority: section.priority,
        active: section.active,
        contentLength: section.content.length,
      });
    }
  }
  return candidates;
}
