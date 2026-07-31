import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

test('migrations never drop application tables', () => {
  const destructiveMigrations = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .filter((file) => /\bDROP\s+TABLE\b/i.test(fs.readFileSync(path.join(migrationsDir, file), 'utf8')));

  assert.deepEqual(destructiveMigrations, []);
});
