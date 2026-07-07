import { buildApp } from './app.js';
import { config } from './config.js';

// Entry point: build the app graph and bind the port. All wiring lives in
// app.ts so tests can exercise the same graph via inject() without listening.
const app = await buildApp();

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
