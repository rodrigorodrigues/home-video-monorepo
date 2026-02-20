import { config } from "./src/common/AppServerConstant";
import { createApp } from "./src/composition/app";
import { startServer } from "./src/composition/startup";
import { createSessionMiddleware } from "./src/auth/redisSessionStore.js";

// Initialize app asynchronously to support Redis session setup
(async () => {
  try {
    console.log("[SERVER] Initializing application...");

    // Initialize session middleware first
    const sessionMiddleware = await createSessionMiddleware();
    console.log("[SERVER] Session middleware initialized");

    // Create app with session middleware
    const app = createApp({ appConfig: config, env: process.env, sessionMiddleware });
    console.log("[SERVER] Application initialized successfully");

    startServer({ app, appConfig: config, env: process.env });
  } catch (error) {
    console.error("[SERVER] Failed to initialize application:", error);
    process.exit(1);
  }
})();
