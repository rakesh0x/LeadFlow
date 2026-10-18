import fs from "node:fs";
import path from "node:path";

const file = process.env.LEADFLOW_DB_PATH ?? path.join(process.cwd(), "data", "leadflow.db");
for (const suffix of ["", "-wal", "-shm"]) {
  const target = `${file}${suffix}`;
  if (fs.existsSync(target)) fs.unlinkSync(target);
}
console.log(`cleared ${file}`);
