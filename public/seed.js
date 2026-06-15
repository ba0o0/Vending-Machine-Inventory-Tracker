// seed.js — run once to populate Firestore, then remove the script tag
const db = firebase.firestore();

async function seed() {
  const machineRef = await db.collection('vendingMachines').add({
    name: 'Test 1',
    location: 'Test, Floor 1',
    rows: 6,
    columns: 5,
    lastRestocked: firebase.firestore.Timestamp.now()
  });

  await db.collection('items').add({
    machineId: machineRef.id,
    name: 'Testing item',
    price: 5000.0,
    quantity: 20,
    lowStockThreshold: 10,
    slotLabel: 'F1',
    expirationDate: firebase.firestore.Timestamp.fromDate(new Date('2026-08-01'))
  });

  console.log('Seeded successfully! Machine ID:', machineRef.id);
}

seed();