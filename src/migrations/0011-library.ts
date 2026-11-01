import type { MigrationFn } from "umzug";
import type { QueryInterface } from "sequelize";
import { createHash } from "node:crypto";
import bank from "../../content/games/bank.json";
function uuid(key: string) {
  const h = createHash("sha256")
    .update("tutor-library:" + key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const up: MigrationFn<QueryInterface> = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    await q.sequelize.query(
      `ALTER TABLE game_sets ALTER COLUMN owner_id DROP NOT NULL;
 ALTER TABLE game_sets ADD COLUMN source_key TEXT UNIQUE;
 ALTER TABLE game_sets ADD COLUMN base_set_id UUID REFERENCES game_sets(id);
 CREATE UNIQUE INDEX game_sets_owned_override ON game_sets(owner_id,base_set_id) WHERE base_set_id IS NOT NULL;
 ALTER TABLE classroom_homework ADD COLUMN learning_set_id UUID REFERENCES game_sets(id);
 ALTER TABLE classroom_homework ADD COLUMN learning_snapshot JSONB;
 CREATE TABLE learning_attempts(id UUID PRIMARY KEY,homework_id INTEGER NOT NULL REFERENCES classroom_homework(id),item_id TEXT NOT NULL,response TEXT NOT NULL,correct BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX learning_attempts_homework ON learning_attempts(homework_id,created_at);`,
      { transaction },
    );
    for (const set of bank) {
      const id = uuid(set.id);
      await q.sequelize.query(
        "INSERT INTO game_sets(id,owner_id,title,payload,source_key) VALUES(:id,NULL,:title,CAST(:payload AS jsonb),:key)",
        {
          replacements: {
            id,
            title: set.title,
            payload: JSON.stringify({ ...set, id }),
            key: set.id,
          },
          transaction,
        },
      );
    }
  });
};
export const down: MigrationFn<QueryInterface> = async () => {
  throw new Error(
    "The library contains assigned work. Restore a verified backup instead of dropping it.",
  );
};
