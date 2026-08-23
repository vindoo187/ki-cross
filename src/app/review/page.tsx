/**
 * Interne technische Pruefansicht der Seed-Daten (KEIN Endnutzer-Feature).
 *
 * Zweck: nach `npm run seed` auf einen Blick pruefen koennen, dass (a) beide
 * synthetischen Test-Mandanten korrekt angelegt wurden und (b) die
 * Datensaetze sauber pro Mandant getrennt sind (keine Vermischung).
 *
 * WARUM HIER `rawPrismaClient` STATT `db` (gescopter Client) VERWENDET WIRD:
 * Diese Seite zeigt bewusst ALLE Mandanten nebeneinander an, um genau die
 * Mandantentrennung visuell zu verifizieren - eine Ansicht "nur fuer den
 * eigenen Mandanten" waere hierfuer nutzlos. Es handelt sich also um einen
 * bewussten, dokumentierten Admin-/Debug-Sonderfall, keinen normalen
 * Anwendungsfall. Fuer JEDEN echten Anwendungsfall (Fragen-Engine,
 * Empfehlungs-Engine, Mitarbeiteroberflaeche, ...) ist ausschliesslich
 * `db` aus `src/server/db/client.ts` zu verwenden.
 *
 * Diese Seite ist ausdruecklich technisches Werkzeug fuer Entwicklung/
 * Abnahme, kein Teil des spaeteren Produkt-MVP.
 *
 * ZUGRIFFSBESCHRAENKUNG: Die Beschraenkung auf Dev/Test ist NICHT nur
 * dokumentarisch, sondern wird technisch durchgesetzt - siehe
 * `src/server/review/review-access.ts`. In jeder anderen Umgebung
 * (insbesondere `production`) liefert diese Route 404.
 */

import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { rawPrismaClient } from "@/server/db/client";
import { isReviewPageEnabled } from "@/server/review/review-access";

// Immer live rendern (nie statisch vorab generieren/cachen): diese Seite
// soll stets den aktuellen Stand der Seed-Daten zeigen, und `next build`
// soll nicht von einer erreichbaren Datenbank abhaengen.
export const dynamic = "force-dynamic";

interface TenantOverviewRow {
  tenantId: string;
  tenantKey: string;
  tenantName: string;
  isSynthetic: boolean;
  counts: {
    companies: number;
    stores: number;
    employees: number;
    users: number;
    products: number;
    consultationSessions: number;
    deals: number;
    dealFinancialSnapshots: number;
    customerReferences: number;
    followUps: number;
    analyticsEvents: number;
    auditLogs: number;
  };
}

async function loadTenantOverview(): Promise<TenantOverviewRow[]> {
  const tenants = await rawPrismaClient.tenant.findMany({
    orderBy: { key: "asc" },
  });

  return Promise.all(
    tenants.map(async (tenant) => {
      const [
        companies,
        stores,
        employees,
        users,
        products,
        consultationSessions,
        deals,
        dealFinancialSnapshots,
        customerReferences,
        followUps,
        analyticsEvents,
        auditLogs,
      ] = await Promise.all([
        rawPrismaClient.company.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.store.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.employee.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.user.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.product.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.consultationSession.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.deal.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.dealFinancialSnapshot.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.customerReference.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.followUp.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.analyticsEvent.count({ where: { tenantId: tenant.id } }),
        rawPrismaClient.auditLog.count({ where: { tenantId: tenant.id } }),
      ]);

      return {
        tenantId: tenant.id,
        tenantKey: tenant.key,
        tenantName: tenant.name,
        isSynthetic: tenant.isSynthetic,
        counts: {
          companies,
          stores,
          employees,
          users,
          products,
          consultationSessions,
          deals,
          dealFinancialSnapshots,
          customerReferences,
          followUps,
          analyticsEvents,
          auditLogs,
        },
      };
    }),
  );
}

const COUNT_LABELS: Record<keyof TenantOverviewRow["counts"], string> = {
  companies: "Firmen",
  stores: "Filialen",
  employees: "Mitarbeiter",
  users: "Benutzer",
  products: "Produkte",
  consultationSessions: "Beratungsgespraeche",
  deals: "Abschluesse",
  dealFinancialSnapshots: "Finanz-Snapshots",
  customerReferences: "Kundenreferenzen (pseudonym)",
  followUps: "Wiedervorlagen",
  analyticsEvents: "Analytics-Events",
  auditLogs: "Audit-Log-Eintraege",
};

export default async function ReviewPage() {
  if (!isReviewPageEnabled(process.env)) {
    notFound();
  }

  let rows: TenantOverviewRow[] = [];
  let errorMessage: string | null = null;

  try {
    rows = await loadTenantOverview();
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Unbekannter Fehler beim Laden der Seed-Daten.";
  }

  return (
    <main style={{ padding: 24, maxWidth: 960 }}>
      <h1>Technische Pruefansicht: Mandanten-Uebersicht</h1>
      <p>
        Zeigt Zeilenzahlen pro Mandant fuer zentrale Tabellen, um die Mandantentrennung der
        Seed-Daten visuell zu verifizieren. Siehe auch <code>scripts/verify_seed_pglite.mjs</code>{" "}
        fuer die automatisierte Variante dieser Pruefung.
      </p>

      {errorMessage && (
        <p style={{ color: "#b00020", border: "1px solid #b00020", padding: 12 }}>
          Konnte Seed-Daten nicht laden: {errorMessage}
          <br />
          Ist die Datenbank erreichbar und wurde <code>npm run seed</code> ausgefuehrt?
        </p>
      )}

      {!errorMessage && rows.length === 0 && (
        <p>
          Keine Mandanten gefunden. Bitte zuerst <code>npm run seed</code> ausfuehren.
        </p>
      )}

      {rows.map((row) => (
        <section key={row.tenantId} style={{ marginBottom: 32 }}>
          <h2>
            {row.tenantName} <small>({row.tenantKey})</small>
          </h2>
          <p>
            Tenant-ID: <code>{row.tenantId}</code> &middot; synthetisch:{" "}
            {row.isSynthetic ? "ja" : "nein"}
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Tabelle</th>
                <th style={cellStyle}>Anzahl Datensaetze</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(COUNT_LABELS) as Array<keyof TenantOverviewRow["counts"]>).map(
                (key) => (
                  <tr key={key}>
                    <td style={cellStyle}>{COUNT_LABELS[key]}</td>
                    <td style={cellStyle}>{row.counts[key]}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}

const cellStyle: CSSProperties = {
  border: "1px solid #ccc",
  padding: "4px 8px",
  textAlign: "left",
};
