import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../config/database';
import { syncAll } from '../services/shopify-sync';

async function main() {
  try {
    console.log('Starting initial sync...');
    await syncAll();
    console.log('Initial sync complete!');
  } catch (err) {
    console.error('Sync error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();