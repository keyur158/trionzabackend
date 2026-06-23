import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../config/database';

// Idempotent update for an already-seeded live database.
// - Removes "Standard Shipping"
// - Express Shipping -> price 45.00, 5-7 days
// - Free Shipping    -> 7-9 days, no minimum order value
async function main() {
  const removed = await prisma.shippingRate.deleteMany({
    where: { name: 'Standard Shipping' },
  });
  console.log(`Removed Standard Shipping (${removed.count} record(s)).`);

  const express = await prisma.shippingRate.updateMany({
    where: { name: 'Express Shipping' },
    data: { price: 45.00, minDays: 5, maxDays: 7 },
  });
  console.log(`Updated Express Shipping (${express.count} record(s)).`);

  const free = await prisma.shippingRate.updateMany({
    where: { name: 'Free Shipping' },
    data: { minDays: 7, maxDays: 9, minOrderValue: null },
  });
  console.log(`Updated Free Shipping (${free.count} record(s)).`);

  const rates = await prisma.shippingRate.findMany({ orderBy: { id: 'asc' } });
  console.log('Current shipping rates:', JSON.stringify(rates, null, 2));
  console.log('Shipping rates updated successfully.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());