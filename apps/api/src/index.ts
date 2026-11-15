import { createApp } from './app.js';
import type { Env } from './types.js';

const app = createApp();

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
