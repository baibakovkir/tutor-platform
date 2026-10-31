const { Sequelize, QueryTypes } = require("sequelize");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
(async () => {
  const db = new Sequelize(process.env.DATABASE_URL, { logging: false });
  try {
    const email = process.env.BOOTSTRAP_EMAIL || "kirill@baibakovkir.space";
    const [found] = await db.query("SELECT id FROM users WHERE email=:email", {
      replacements: { email },
      type: QueryTypes.SELECT,
    });
    if (found) {
      console.log("Teacher account already exists; password unchanged.");
      return;
    }
    const password = randomBytes(18).toString("base64url");
    await db.query(
      'INSERT INTO users(email,name,"passwordHash","createdAt","updatedAt") VALUES (:email,:name,:hash,now(),now())',
      {
        replacements: {
          email,
          name: "Кирилл",
          hash: await bcrypt.hash(password, 12),
        },
      },
    );
    await fs.writeFile(
      process.env.ACCESS_FILE || "/home/user/tutor-platform/access.txt",
      `https://tutor.baibakovkir.space\nEmail: ${email}\nPassword: ${password}\n\nСменить пароль: Настройки → Безопасность кабинета.\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Teacher account created; credentials written to the private access file.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
