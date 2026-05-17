const dotenv = require("dotenv");
dotenv.config();

const { closePool } = require("../db/postgres");
const { seedKnowledgeBase } = require("../services/aiKnowledgeBaseService");

async function main() {
  const reset = process.argv.includes("--reset");
  const result = await seedKnowledgeBase({ reset });
  console.log(
    `Seed complete: ${result.medicinesSeeded} medicines, ${result.diseasesSeeded} diseases.`
  );
}

main()
  .catch((error) => {
    console.error("ai_seed_failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
