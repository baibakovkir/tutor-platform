import type { MigrationFn } from "umzug";
import type { QueryInterface } from "sequelize";
export const up: MigrationFn<QueryInterface> = async ({ context: q }) => {
  await q.sequelize.transaction(async (transaction) => {
    await q.sequelize.query(
      `
CREATE TABLE game_sets(id UUID PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE game_rooms(id UUID PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),student_id INTEGER NOT NULL REFERENCES students(id),state JSONB NOT NULL,version INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX game_rooms_owner ON game_rooms(owner_id,updated_at DESC);
CREATE INDEX game_rooms_student ON game_rooms(student_id,updated_at DESC);
`,
      { transaction },
    );
  });
};
export const down: MigrationFn<QueryInterface> = async ({ context: q }) => {
  await q.sequelize.query("DROP TABLE game_rooms,game_sets");
};
