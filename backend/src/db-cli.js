import pg from 'pg';
import { migrate } from './migrations.js';
import { seed } from './seed.js';
const command = process.argv[2];
const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
let client;
try {
  if (!['migrate','seed'].includes(command)) throw new Error('Use migrate or seed');
  if (command === 'seed' && process.env.NODE_ENV === 'production') throw new Error('Synthetic seed is disabled in Production');
  client = await pool.connect();
  if (command === 'migrate') await migrate(client);
  else await seed(client,process.env.SEED_PASSWORD);
  console.log(`${command} completed`);
} catch { console.error(`${command || 'Database command'} failed. Check connectivity, migration state and required local settings; credentials are not logged.`); process.exitCode=1; }
finally { client?.release(); await pool.end(); }
