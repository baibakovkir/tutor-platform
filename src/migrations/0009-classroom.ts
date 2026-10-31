import type { MigrationFn } from "umzug";
import type { QueryInterface } from "sequelize";
export const up: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.sequelize.transaction(async (transaction) => {
    await qi.sequelize.query(
      `
CREATE TABLE classroom_profiles (
 student_id INTEGER PRIMARY KEY REFERENCES students(id),
 subject TEXT NOT NULL DEFAULT 'Индивидуальные занятия',
 meeting_url TEXT NOT NULL DEFAULT '', rate INTEGER NOT NULL DEFAULT 1500 CHECK(rate >= 0),
 access_hash TEXT UNIQUE, notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE classroom_lessons (
 session_id INTEGER PRIMARY KEY REFERENCES bill_sessions(id) ON DELETE CASCADE,
 title TEXT NOT NULL, meeting_url TEXT NOT NULL DEFAULT '',
 cancelled BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE classroom_exercises (
 id SERIAL PRIMARY KEY, owner_id INTEGER REFERENCES users(id),
 title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('choice','short','text')),
 prompt TEXT NOT NULL, options JSONB NOT NULL DEFAULT '[]',
 answer TEXT NOT NULL DEFAULT '', explanation TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE classroom_homework (
 id SERIAL PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id),
 session_id INTEGER REFERENCES bill_sessions(id), owner_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', due_date DATE NOT NULL,
 exercise_id INTEGER REFERENCES classroom_exercises(id),
 status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','submitted','reviewed')),
 submission TEXT NOT NULL DEFAULT '', feedback TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX classroom_homework_student ON classroom_homework(student_id);
CREATE TABLE classroom_attempts (
 id SERIAL PRIMARY KEY, homework_id INTEGER NOT NULL REFERENCES classroom_homework(id),
 response TEXT NOT NULL, correct BOOLEAN, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE classroom_files (
 id UUID PRIMARY KEY, homework_id INTEGER NOT NULL REFERENCES classroom_homework(id),
 student_upload BOOLEAN NOT NULL DEFAULT false,
 name TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO classroom_exercises(title,kind,prompt,options,answer,explanation) VALUES
('Английский · Present Simple','choice','She ___ to school every day.','["go", "goes", "going", "gone"]','1','В третьем лице единственного числа к глаголу добавляется -s.'),
('Математика · Линейное уравнение','short','Решите уравнение: 3x + 7 = 22. Введите значение x.','[]','5','3x = 22 − 7 = 15, следовательно x = 5.'),
('SQL · Первый запрос','text','Напишите запрос, который выбирает все строки из таблицы students. Объясните, что означает SELECT *.','[]','','Ответ проверит преподаватель. Для выполнения SQL используйте тренажёр в разделе материалов.'),
('Английский · Неправильные глаголы','short','Запишите форму Past Simple глагола go.','[]','went','Go → went → gone.'),
('Математика · Порядок действий','choice','Чему равно 8 + 4 × 3?','["36", "20", "24", "15"]','1','Сначала умножение: 4 × 3 = 12. Затем сложение: 8 + 12 = 20.'),
('Развёрнутый ответ · Объясни своими словами','text','Объясните изученную тему своими словами и приведите собственный пример.','[]','','Ответ проверит преподаватель.');
`,
      { transaction },
    );
  });
};
export const down: MigrationFn<QueryInterface> = async ({ context: qi }) => {
  await qi.sequelize.query(
    "DROP TABLE classroom_files, classroom_attempts, classroom_homework, classroom_exercises, classroom_lessons, classroom_profiles",
  );
};
