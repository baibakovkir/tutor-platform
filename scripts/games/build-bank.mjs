import { readFile, writeFile } from "node:fs/promises";
const vocabulary = JSON.parse(
  await readFile("content/games/vocabulary.json", "utf8"),
);
const bank = [];
for (const [file, course, prefix] of [
  ["essential", "Essential Grammar in Use · 4th edition", "essential"],
  ["gogetter", "GoGetter 3 · Student’s Book + Workbook", "gogetter"],
]) {
  const lines = (await readFile("content/games/" + file + ".txt", "utf8"))
    .trim()
    .split("\n");
  for (const line of lines) {
    const [number, title, rule, raw] = line.split("|");
    const unit = Number(number);
    if (!raw) throw Error("Invalid unit " + line);
    const templates = raw.split(";;");
    if (templates.length !== 4)
      throw Error("Expected four contexts in " + unit);
    const items = [];
    const id = `${prefix}-${unit}`;
    for (let variant = 0; variant < 2; variant++)
      for (let n = 0; n < templates.length; n++) {
        const source = templates[n]
          .replaceAll("{N}", variant ? "Maya" : "Nora")
          .replaceAll("{M}", variant ? "Owen" : "Leo")
          .replaceAll("{D}", variant ? "Friday" : "Monday")
          .replaceAll("{P}", variant ? "Bath" : "York");
        const match = source.match(/\[([^\]]+)\]/);
        if (!match) throw Error("Missing answer in " + source);
        const choices = match[1].split("~");
        if (choices.length !== 3 || new Set(choices).size !== 3)
          throw Error("Invalid options " + source);
        const sentence = source.replace(match[0], choices[0]);
        const prompt = source.replace(match[0], "___");
        const k = variant * 4 + n;
        items.push({
          id: `${id}-q${k}`,
          type: "choice",
          prompt,
          answer: choices[0],
          options: choices,
          explanation: rule + " Правильный вариант: " + sentence,
          hint: rule,
        });
        items.push({
          id: `${id}-s${k}`,
          type: "sentence",
          prompt: "Соберите предложение. " + rule,
          answer: sentence,
          explanation: rule,
          hint: rule,
        });
        if (file === "essential" && k < 6)
          items.push({
            id: `${id}-p${k}`,
            type: "pair",
            prompt,
            answer: sentence,
            explanation: rule,
            hint: "Найдите завершённое предложение для этого пропуска.",
          });
      }
    if (file === "gogetter")
      for (const [n, [prompt, answer]] of vocabulary[unit].entries())
        items.push({
          id: `${id}-p${n}`,
          type: "pair",
          prompt,
          answer,
          explanation: `${prompt} — ${answer}`,
          hint: "Соедините выражение с переводом.",
        });
    if (
      new Set(items.filter((i) => i.type === "sentence").map((i) => i.answer))
        .size !== 8
    )
      throw Error("Repeated contexts " + id);
    bank.push({
      id,
      title: `${unit}. ${title}`,
      course,
      unit,
      topic: title,
      sourcePage:
        file === "essential"
          ? unit * 2 + 10
          : [4, 10, 22, 34, 46, 58, 70, 82, 94][unit],
      items,
    });
  }
}
if (bank.length !== 124) throw Error("Incomplete curriculum: " + bank.length);
const serialized = JSON.stringify(bank, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile("content/games/bank.json", "utf8")) !== serialized)
    throw Error("Bank is stale. Run npm run games:build");
} else await writeFile("content/games/bank.json", serialized);
console.log(
  `${bank.length} sections, ${bank.reduce((n, s) => n + s.items.length, 0)} activities`,
);
