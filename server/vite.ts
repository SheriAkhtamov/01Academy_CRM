import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { type Server } from "http";
import { nanoid } from "nanoid";
import { appConfig } from "./config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // Keep the development-only config out of the production server bundle.
  // A variable import is intentional: esbuild otherwise hoists Vite and its
  // plugins into dist/index.js, where pruned production dependencies cannot
  // and should not satisfy them.
  const viteConfigModulePath = "../vite.config";
  const [
    { createServer: createViteServer, createLogger },
    { default: viteConfig },
  ] = await Promise.all([
    import("vite"),
    import(viteConfigModulePath),
  ]);
  const viteLogger = createLogger();
  const hmrHost = appConfig.server.host === "0.0.0.0"
    ? "127.0.0.1"
    : appConfig.server.host;
  const configuredHost = new URL(appConfig.server.appUrl).hostname;
  const serverOptions = {
    middlewareMode: true,
    hmr: {
      server,
      protocol: "ws" as const,
      host: hmrHost,
      clientPort: appConfig.server.port,
      path: "/__vite_hmr",
    },
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      configuredHost,
      ...(appConfig.server.host === "0.0.0.0" ? [] : [appConfig.server.host]),
    ],
  };

  server.on('error', (err) => {
    viteLogger.error(`Vite server error: ${err.message}`);
  });

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        // Don't exit on WebSocket errors - they're non-critical
        if (msg.includes('ws error') || msg.includes('WebSocket')) {
          viteLogger.warn(msg, options);
          return;
        }
        viteLogger.error(msg, options);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        req.originalUrl.split('?')[0].startsWith('/miniapp/') ? 'miniapp.html' : 'index.html',
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (req, res) => {
    res.sendFile(path.resolve(distPath, req.originalUrl.split('?')[0].startsWith('/miniapp/') ? 'miniapp.html' : 'index.html'));
  });
}
