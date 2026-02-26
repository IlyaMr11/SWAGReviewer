import { createApp } from "./app.js";
import { loadConfig } from "./platform/config/env.js";

const config = loadConfig();
const app = createApp({
  apiServiceToken: config.apiServiceToken,
  githubWebhookSecret: config.githubWebhookSecret,
  serveFrontend: config.serveFrontend,
  frontendDistPath: config.frontendDistPath,
});

app.listen(config.port, () => {
  console.log(`[backend] listening on :${config.port}`);
  if (config.serveFrontend) {
    console.log(`[backend] single-host UI enabled (${config.frontendDistPath})`);
  }
});
