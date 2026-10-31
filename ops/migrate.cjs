const { Sequelize, QueryTypes } = require("sequelize");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const db = new Sequelize(process.env.DATABASE_URL, {
    logging: false,
    pool: { max: 2 },
  });
  try {
    // Umzug-compatible ledger; original migration names stay unchanged.
    await db.query(
      'CREATE TABLE IF NOT EXISTS "SequelizeMeta" (name VARCHAR(255) PRIMARY KEY)',
    );
    const done = new Set(
      (
        await db.query('SELECT name FROM "SequelizeMeta"', {
          type: QueryTypes.SELECT,
        })
      ).map((r) => r.name),
    );
    for (const file of (await fs.readdir(path.join(__dirname, "migrations")))
      .filter((f) => f.endsWith(".cjs"))
      .sort()) {
      const name = file.replace(".cjs", ".ts");
      if (done.has(name)) continue;
      const migration = require(path.join(__dirname, "migrations", file));
      await migration.up({ context: db.getQueryInterface() });
      await db.query('INSERT INTO "SequelizeMeta"(name) VALUES (:name)', {
        replacements: { name },
      });
      console.log("Applied " + name);
    }
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
