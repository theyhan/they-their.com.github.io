/**
 * Seeds `metric_definitions` from the code registry.
 *
 * ADR-0003 decision 1 requires a single definition site. That claim is only true if the table is
 * derived from the code rather than maintained beside it, which is what this script enforces: it
 * upserts every registry entry and reports any row in the table that the registry no longer knows
 * about, so drift is visible instead of silent.
 */

import { PrismaClient } from '@prisma/client';
import { assertRegistryIntegrity, REGISTRY_VERSION, toSeedRows } from '../src/lib/metrics/registry.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Fail before touching the database if the registry is internally inconsistent.
  assertRegistryIntegrity();

  const rows = toSeedRows();
  for (const row of rows) {
    await prisma.metricDefinition.upsert({
      where: {
        metricKey_registryVersion: {
          metricKey: row.metricKey as string,
          registryVersion: REGISTRY_VERSION,
        },
      },
      create: row as never,
      update: row as never,
    });
  }
  console.log(`Seeded ${rows.length} metric definitions at registry version ${REGISTRY_VERSION}.`);

  // Definitions from earlier registry versions are retained, not deleted: reports generated under
  // them must keep resolving their formulas (FR-013).
  const orphans = await prisma.metricDefinition.findMany({
    where: { registryVersion: { not: REGISTRY_VERSION } },
    select: { metricKey: true, registryVersion: true },
  });
  if (orphans.length > 0) {
    console.log(`${orphans.length} definition(s) from earlier registry versions retained for historical reports.`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
