import { createApp } from './app';
import { getConfig } from './config';

const config = getConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});
