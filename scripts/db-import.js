// db-import.js — M3 restore tool: applies a logical SQL backup (from
// /api/admin/db/export or scripts/db-backup) to the target database.
// Usage:
//   node scripts/db-import.js ./backup.sql   (uses DATABASE_URL)
'use strict';
const fs = require('fs');
const db = require('../server/lib/db');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/db-import.js <backup.sql>'); process.exit(1); }
  if (!db.configured()) { console.error('DATABASE_URL is not set.'); process.exit(1); }
  const sql = fs.readFileSync(file, 'utf8');
  const p = await db.ready();
  if (!p) { console.error('[db-import] could not connect:', db.statusInfo().error); process.exit(1); }
  // ensure schema exists before importing data
  await db.migrate();
  await db.importSql(sql);
  console.log('[db-import] backup applied successfully');
  process.exit(0);
})().catch(e => { console.error('[db-import] failed:', e.message); process.exit(1); });
