import type { MigrationFn } from "umzug";
import type { QueryInterface } from "sequelize";
import { QueryTypes } from "sequelize";
import { randomUUID } from "node:crypto";
import { legacySet } from "../lib/games/legacy";
export const up: MigrationFn<QueryInterface> = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    await q.sequelize.query(
      `ALTER TABLE game_sets ADD COLUMN legacy_exercise_id INTEGER UNIQUE REFERENCES classroom_exercises(id);ALTER TABLE learning_attempts ALTER COLUMN correct DROP NOT NULL;`,
      { transaction },
    );
    const exercises = await q.sequelize.query<{
      id: number;
      owner_id: number | null;
      title: string;
      kind: string;
      prompt: string;
      options: string[];
      answer: string;
      explanation: string;
    }>("SELECT * FROM classroom_exercises", {
      type: QueryTypes.SELECT,
      transaction,
    });
    for (const e of exercises) {
      const id = randomUUID();
      await q.sequelize.query(
        "INSERT INTO game_sets(id,owner_id,title,payload,source_key,legacy_exercise_id) VALUES(:id,:owner,:title,CAST(:payload AS jsonb),:key,:legacy)",
        {
          replacements: {
            id,
            owner: e.owner_id,
            title: e.title,
            payload: JSON.stringify(legacySet(e, id)),
            key: e.owner_id === null ? "legacy-" + e.id : null,
            legacy: e.id,
          },
          transaction,
        },
      );
    }
  });
};
export const down: MigrationFn<QueryInterface> = async () => {
  throw new Error("Restore a verified backup to undo the library migration.");
};
