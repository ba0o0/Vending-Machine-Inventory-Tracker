function getDbOrThrow() {
  if (typeof firebase === "undefined" || !firebase.firestore) {
    throw new Error("Firebase Firestore is not initialized.");
  }
  return firebase.firestore();
}

async function logRestockEvent(
  machineId,
  slotId,
  productId,
  productName,
  previousQuantity,
  newQuantity,
  userId,
  notes = ""
) {
  try {
    const prevQty = Number(previousQuantity);
    const nextQty = Number(newQuantity);

    if (!machineId) throw new Error("machineId is required.");
    if (!slotId) throw new Error("slotId is required.");
    if (!productId) throw new Error("productId is required.");
    if (!productName) throw new Error("productName is required.");
    if (!userId) throw new Error("userId is required.");
    if (!Number.isFinite(prevQty) || !Number.isFinite(nextQty)) {
      throw new Error("previousQuantity and newQuantity must be numbers.");
    }
    if (nextQty <= prevQty) {
      throw new Error("newQuantity must be greater than previousQuantity for a restock event.");
    }

    const db = getDbOrThrow();
    const batch = db.batch();
    const productRef = db.collection("items").doc(productId);
    const eventRef = db.collection("vendingMachines").doc(machineId).collection("restockEvents").doc();

    batch.update(productRef, { quantity: nextQty });
    batch.set(eventRef, {
      productId,
      productName,
      slotId,
      previousQuantity: prevQty,
      newQuantity: nextQty,
      quantityAdded: nextQty - prevQty,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userId,
      notes: String(notes || ""),
    });

    await batch.commit();
    return {
      ok: true,
      eventId: eventRef.id,
    };
  } catch (error) {
    const detail = error && error.message ? error.message : "Unknown Firestore error.";
    throw new Error(`Failed to log restock event for machine ${machineId} and product ${productId}: ${detail}`);
  }
}

window.vmitRestock = {
  logRestockEvent,
};
