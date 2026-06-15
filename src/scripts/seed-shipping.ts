import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../config/database';

async function main() {
  const existing = await prisma.shippingRate.count();
  if (existing > 0) {
    console.log(`Shipping rates already seeded (${existing} records). Skipping.`);
    return;
  }

  await prisma.shippingRate.createMany({
    data: [
      { name: 'Standard Shipping', price: 5.00, minDays: 5, maxDays: 7, countryCodes: [], isActive: true },
      { name: 'Express Shipping', price: 12.00, minDays: 2, maxDays: 3, countryCodes: [], isActive: true },
      { name: 'Free Shipping', price: 0.00, minDays: 7, maxDays: 10, countryCodes: [], minOrderValue: 50.00, isActive: true },
    ],
  });
  console.log('Shipping rates seeded successfully.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
