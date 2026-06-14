import { defineConfig } from "drizzle-kit";
import { appConfig } from "./server/config";

if (!appConfig.database.url) {
  throw new Error("DATABASE_URL is not configured in config/app.config.json");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: appConfig.database.url,
  },
});
