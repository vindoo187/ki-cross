import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "fs";

const db = new PGlite({ extensions: { btree_gist } });
const sql = readFileSync("prisma/migrations/20260731000000_init/migration.sql", "utf-8");

const version = await db.query("SELECT version()");
console.log("Postgres:", version.rows[0].version);

try {
  await db.exec(sql);
  console.log("MIGRATION OK: all statements executed without error.");
} catch (err) {
  console.error("MIGRATION FAILED:", err.message);
  process.exit(1);
}

const tables = await db.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name;
`);
console.log(`Tables created: ${tables.rows.length}`);

const fks = await db.query(`
  SELECT count(*)::int AS n FROM information_schema.table_constraints
  WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public';
`);
console.log(`Foreign keys created: ${fks.rows[0].n}`);

await db.close();
