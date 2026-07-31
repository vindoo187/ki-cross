export default function HomePage() {
  return (
    <main style={{ padding: 24, maxWidth: 760 }}>
      <h1>KI-Verkaufsassistent - technisches Fundament</h1>
      <p>
        Dies ist ausschliesslich das technische Projektgeruest (Phase 2): Datenmodell, Migrationen,
        Seed-Daten und Sicherheits-/Isolationstests.
      </p>
      <p>
        Es ist <strong>kein</strong> fertiges MVP und enthaelt keine Fragen-Engine, keine
        Empfehlungs-Engine und keine echten Kundendaten.
      </p>
      <p>
        Interne technische Pruefansicht der Seed-Daten: <a href="/review">/review</a>
      </p>
    </main>
  );
}
