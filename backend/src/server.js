import app, { logger, seedDatabase } from "./app.js";
import { config } from "./config.js";
import { initializeDatabase, pool } from "./db.js";
import { initializeStorage } from "./storage.js";

async function start() {
  await initializeDatabase();
  await initializeStorage();
  await seedDatabase();

  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info({ port: config.port }, "Backend del laboratorio ONLYOFFICE listo");
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, "Cerrando backend del laboratorio");
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  logger.fatal({ err: error }, "No fue posible iniciar el backend del laboratorio");
  process.exit(1);
});
