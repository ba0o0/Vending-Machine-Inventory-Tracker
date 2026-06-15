function formatDate(val) {
  if (!val) return "N/A";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

  let currentItemView = "list";

function parseCsvLine(line) {
  const out = [];
  let curr = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(curr.trim());
      curr = "";
    } else {
      curr += ch;
    }
  }
  out.push(curr.trim());
  return out;
}

async function createStockNotifications(db, items) {
  const toCreate = [];
  items.forEach(function (item) {
    const old = item.oldQuantity;
    const qty = item.newQuantity;
    const thr = Number(item.lowStockThreshold) || 0;
    if (qty <= 0 && old > 0) {
      toCreate.push({ type: "out_of_stock", item });
    } else if (qty > 0 && thr > 0 && qty < thr && old >= thr) {
      toCreate.push({ type: "low_stock", item });
    }
  });
  if (!toCreate.length) return;
  const batch = db.batch();
  toCreate.forEach(function ({ type, item }) {
    const ref = db.collection("notifications").doc();
    batch.set(ref, {
      itemId: item.id,
      itemName: item.name,
      machineId: item.machineId,
      machineName: item.machineName,
      type,
      quantity: item.newQuantity,
      threshold: item.lowStockThreshold,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
    });
  });
  await batch.commit();
}

function renderNotifications(notifications) {
  const list = document.getElementById("notif-list");
  if (!list) return;
  if (!notifications.length) {
    list.innerHTML = '<div class="notif-empty">No notifications.</div>';
    return;
  }
  const isAdmin = window.vmitAuth && window.vmitAuth.getRole() === "admin";
  list.innerHTML = notifications.map(function (n) {
    var cssClass, title, body;
    if (n.type === "out_of_stock") {
      cssClass = "notif-critical"; title = "Out of Stock";
      body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine") + " — qty: " + n.quantity;
    } else if (n.type === "low_stock") {
      cssClass = "notif-warn"; title = "Low Stock";
      body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine") + " — qty: " + n.quantity;
    } else if (n.type === "price_conflict") {
      cssClass = "notif-warn"; title = "Price Conflict";
      body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine") + " — $" + escapeHtml(String(n.price || "?")) + " shared with another item";
    } else if (n.type === "expired") {
      cssClass = "notif-critical"; title = "Expired Item";
      var expStr = "";
      if (n.expirationDate) {
        var expD = n.expirationDate.toDate ? n.expirationDate.toDate() : new Date(n.expirationDate);
        expStr = " — expired " + expD.toLocaleDateString();
      }
      body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine") + escapeHtml(expStr);
    } else {
      cssClass = "notif-warn"; title = n.type || "Notification";
      body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine");
    }
    var ts = n.createdAt
      ? (n.createdAt.toDate ? n.createdAt.toDate() : new Date(n.createdAt)).toLocaleString()
      : "";
    var dismissBtn = isAdmin
      ? '<button class="notif-dismiss-btn" data-notif-id="' + escapeHtml(n.id) + '" onclick="event.stopPropagation();dismissNotification(this)" title="Mark as read">×</button>'
      : '';
    return '<div class="notif-item ' + cssClass + '">' +
      dismissBtn +
      '<div class="notif-item-title">' + title + "</div>" +
      '<div class="notif-item-body">' + body + "</div>" +
      '<div class="notif-item-time">' + escapeHtml(ts) + "</div>" +
      "</div>";
  }).join("");
}

async function loadNotifications(db, machineId) {
  try {
    // Wait for admin session to be established to avoid race on refresh
    async function waitForAdminAuthSessionLocal() {
      if (window.vmitAuth && window.vmitAuth.getRole() === "admin") {
        const auth = (typeof firebase !== "undefined" && firebase.auth) ? firebase.auth() : null;
        if (auth && auth.currentUser) return true;
      }
      if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") return false;
      if (typeof firebase === "undefined" || !firebase.auth) return false;
      return new Promise((resolve) => {
        let settled = false;
        let unsubscribe = null;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (unsubscribe) unsubscribe();
          resolve(value);
        };
        const timer = setTimeout(() => finish(window.vmitAuth && window.vmitAuth.getRole() === "admin"), 3000);
        unsubscribe = firebase.auth().onAuthStateChanged((user) => {
          if (user && window.vmitAuth && window.vmitAuth.getRole() === "admin") {
            finish(true);
          }
        });
      });
    }

    const isAdmin = await waitForAdminAuthSessionLocal();
    if (!isAdmin) {
      const list = document.getElementById("notif-list");
      if (list) list.innerHTML = '<div class="notif-empty">No notifications.</div>';
      return;
    }
    const snapshot = await db.collection("notifications")
      .where("machineId", "==", machineId)
      .get();
    const notifs = [];
    snapshot.forEach(function (d) {
      notifs.push(Object.assign({ id: d.id }, d.data()));
    });
    notifs.sort(function (a, b) {
      const aT = a.createdAt
        ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime())
        : 0;
      const bT = b.createdAt
        ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime())
        : 0;
      return bT - aT;
    });
    renderNotifications(notifs);
  } catch (err) {
    console.error("Failed to load notifications:", err);
  }
}

async function checkItemNotifications(db, machineId) {
  try {
    const [itemsSnap, existingSnap] = await Promise.all([
      db.collection("items").where("machineId", "==", machineId).get(),
      db.collection("notifications").where("machineId", "==", machineId).get(),
    ]);

    const items = [];
    itemsSnap.forEach(function (d) { items.push(Object.assign({ id: d.id }, d.data())); });

    const existingKeys = new Set();
    existingSnap.forEach(function (d) {
      const data = d.data();
      if (data.type === "price_conflict" || data.type === "expired") {
        existingKeys.add(data.itemId + "_" + data.type);
      }
    });

    const now = new Date();
    const toCreate = [];

    // Price conflicts: items within this machine sharing the same non-TBD price
    const priceGroups = {};
    items.forEach(function (item) {
      if (item.priceTbd || !item.price) return;
      const key = String(item.price);
      if (!priceGroups[key]) priceGroups[key] = [];
      priceGroups[key].push(item);
    });
    Object.keys(priceGroups).forEach(function (key) {
      const group = priceGroups[key];
      if (group.length < 2) return;
      group.forEach(function (item) {
        if (!existingKeys.has(item.id + "_price_conflict")) {
          toCreate.push({ type: "price_conflict", item, extra: { price: item.price } });
        }
      });
    });

    // Expired items
    items.forEach(function (item) {
      if (!item.expirationDate) return;
      const expDate = item.expirationDate.toDate ? item.expirationDate.toDate() : new Date(item.expirationDate);
      if (expDate < now && !existingKeys.has(item.id + "_expired")) {
        toCreate.push({ type: "expired", item, extra: { expirationDate: item.expirationDate } });
      }
    });

    if (!toCreate.length) return;

    const batch = db.batch();
    toCreate.forEach(function (entry) {
      const ref = db.collection("notifications").doc();
      batch.set(ref, Object.assign({
        itemId: entry.item.id,
        itemName: entry.item.name,
        machineId: entry.item.machineId,
        machineName: entry.item.machineName,
        type: entry.type,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      }, entry.extra));
    });
    await batch.commit();
  } catch (err) {
    console.error("checkItemNotifications error:", err);
  }
}

async function extractPdfLines(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("PDF parser is unavailable. Refresh and try again.");
  }

  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = textContent.items
      .map((item) => ({
        text: (item.str || "").trim(),
        x: item.transform[4],
        y: item.transform[5],
      }))
      .filter((item) => item.text);

    const grouped = [];
    items.forEach((item) => {
      const existing = grouped.find((g) => Math.abs(g.y - item.y) < 2);
      if (existing) existing.items.push(item);
      else grouped.push({ y: item.y, items: [item] });
    });

    grouped
      .sort((a, b) => b.y - a.y)
      .forEach((group) => {
        const line = group.items
          .sort((a, b) => a.x - b.x)
          .map((it) => it.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (line) lines.push(line);
      });
  }

  return lines;
}

function statusClassForQty(qty, low) {
  if (qty <= 0) return "red";
  if (low != null && qty < low) return "yellow";
  return "green";
}

function getOverallMachineStatus(items) {
  const safeItems = Array.isArray(items) ? items : [];
  
  // Check for out of stock items (highest priority)
  for (let item of safeItems) {
    if (Number(item.quantity) <= 0) {
      return "red";
    }
  }
  
  // Check for low stock items (medium priority)
  for (let item of safeItems) {
    const quantity = Number(item.quantity);
    const threshold = Number(item.lowStockThreshold);
    if (quantity > 0 && Number.isFinite(threshold) && quantity < threshold) {
      return "yellow";
    }
  }
  
  // All items are good
  return "green";
}

function renderMachineStats(items) {
  const statsEl = document.getElementById("machine-stats");
  if (!statsEl) return;

  const safeItems = Array.isArray(items) ? items : [];
  const totalItems = safeItems.length;
  const outOfStock = safeItems.filter((item) => Number(item.quantity) <= 0).length;
  const lowStock = safeItems.filter((item) => {
    const quantity = Number(item.quantity);
    const threshold = Number(item.lowStockThreshold);
    return quantity > 0 && Number.isFinite(threshold) && quantity < threshold;
  }).length;

  statsEl.innerHTML = `
    <span class="machine-stat total">${totalItems} total items</span>
    <span class="machine-stat out">${outOfStock} out of stock</span>
    <span class="machine-stat low">${lowStock} low stock</span>
  `;
}

function renderItems(items, emptyMessage) {
  const container = document.getElementById("items-container");
  const selectedView = currentItemView === "grid" ? "grid" : "list";
  if (!items || items.length === 0) {
    container.innerHTML =
      `<div class="table-message">${emptyMessage || "This machine is empty."}</div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = `items-grid ${selectedView === "grid" ? "grid-view" : "list-view"}`;

  items.forEach((it) => {
    const color = statusClassForQty(it.quantity, it.lowStockThreshold);
    const card = document.createElement("div");
    card.className = `item-card item-status ${color}`;
    card.innerHTML = `
      <div class="item-info">
        <div class="item-name">${it.name || "—"}</div>
        <div class="item-detail-grid" aria-label="Item details">
          <span class="item-detail-label">Slot</span>
          <span class="item-detail-value mono">${it.slotLabel || "—"}</span>
          <span class="item-detail-label">Price</span>
          <span class="item-detail-value"><span class="price">$${(it.price || 0).toFixed(2)}</span></span>
          <span class="item-detail-label">Expires</span>
          <span class="item-detail-value">${it.expirationDate ? formatDate(it.expirationDate) : "N/A"}</span>
        </div>
        <div class="item-detail-note">Qty = units available. Low stock = reorder threshold.</div>
      </div>
      <div class="item-side">
        <div class="qty">Qty: ${typeof it.quantity === "number" ? it.quantity : "—"}</div>
        <div class="item-meta">Low stock: ${it.lowStockThreshold != null ? it.lowStockThreshold : "—"}</div>
        <div class="item-actions">
          <button class="btn-edit-item" data-edit-only data-item-id="${it.id || ""}" data-item='${JSON.stringify(it)}'>Edit</button>
          <button class="btn-delete-item" data-edit-only data-item-id="${it.id || ""}" data-item-name="${(it.name || "Item").replace(/\"/g, "&quot;")}">Delete</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  container.innerHTML = "";
  container.appendChild(grid);
}

function renderMachineInfo(machine) {
  document.getElementById("machine-title").textContent =
    machine.name || "Vending Machine";
  document.getElementById("machine-meta").textContent =
    machine.location || "";
  document.getElementById("machine-restock").textContent =
    machine.lastRestocked ? formatDate(machine.lastRestocked) : "N/A";
}

function parsePositiveInteger(value) {
  if (value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return NaN;
  }
  return parsed;
}

async function refreshMachineInfo(db, machineId) {
  const doc = await db.collection("vendingMachines").doc(machineId).get();
  if (doc.exists) {
    renderMachineInfo({ id: doc.id, ...doc.data() });
  }
}

async function touchMachineRestocked(db, machineId) {
  await db.collection("vendingMachines").doc(machineId).update({
    lastRestocked: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await refreshMachineInfo(db, machineId);
}

function getAuthenticatedUserId() {
  if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
    return firebase.auth().currentUser.uid;
  }

  if (window.vmitAuth && typeof window.vmitAuth.getAdminEmail === "function") {
    const email = window.vmitAuth.getAdminEmail();
    if (email) {
      return email;
    }
  }

  return "unknown-user";
}

async function logRestockEventAtomic(machineId, slotId, productId, productName, previousQuantity, newQuantity, userId, notes) {
  if (!window.vmitRestock || typeof window.vmitRestock.logRestockEvent !== "function") {
    throw new Error("Restock logging module is unavailable. Refresh the page and try again.");
  }

  return window.vmitRestock.logRestockEvent(
    machineId,
    slotId,
    productId,
    productName,
    previousQuantity,
    newQuantity,
    userId,
    notes
  );
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function navigateToMachineAnalytics() {
  const machineId = getQueryParam("id");
  if (machineId) {
    window.location.href = `analytics.html?machineId=${encodeURIComponent(machineId)}`;
  } else {
    window.location.href = "analytics.html";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  // Hide notifications UI by default; only reveal after admin session confirmed
  try {
    const _notifBtn = document.getElementById("notif-btn");
    const _notifPanel = document.getElementById("notif-panel");
    if (_notifBtn) _notifBtn.style.display = "none";
    if (_notifPanel) _notifPanel.style.display = "none";
  } catch (e) {}

  if (!window.vmitAuth || !window.vmitAuth.ensureAccessOrRedirect()) {
    return;
  }
  window.vmitAuth.applyRoleToUi();
  window.vmitAuth.attachLogoutButton();

  const statusBar = document.getElementById("status-bar");
  const itemSearchInput = document.getElementById("item-search");
  const itemFilterSelect = document.getElementById("item-filter");
  const itemViewSelect = document.getElementById("item-view");
  const itemResultsCount = document.getElementById("item-results-count");
  const id = getQueryParam("id");
  let activeDb = null;
  let allItems = [];
  currentItemView = "list";

  if (itemViewSelect) {
    itemViewSelect.value = "list";
  }

  function applyItemFilters() {
    const query = String(itemSearchInput.value || "").trim().toLowerCase();
    const selectedStatus = itemFilterSelect.value || "all";

    const filteredItems = allItems.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      const slot = String(item.slotLabel || "").toLowerCase();
      const state = statusClassForQty(Number(item.quantity) || 0, Number(item.lowStockThreshold));
      const matchesSearch = !query || name.includes(query) || slot.includes(query);
      const matchesState = selectedStatus === "all" || state === selectedStatus;
      return matchesSearch && matchesState;
    });

    const emptyMessage = allItems.length
      ? "No items match your search or filter."
      : "This machine is empty.";
    renderItems(filteredItems, emptyMessage);
    renderMachineStats(allItems);
    itemResultsCount.textContent = `${filteredItems.length} of ${allItems.length} item${allItems.length === 1 ? "" : "s"} shown`;

    // Update status bar styling based on overall machine status
    const overallStatus = getOverallMachineStatus(allItems);
    if (statusBar) {
      statusBar.className = ""; // Clear existing classes
      statusBar.classList.add(overallStatus);
    }

    if (window.vmitAuth) {
      window.vmitAuth.applyRoleToUi();
    }
  }

  if (!id) {
    document.getElementById("items-container").innerHTML =
      '<div class="table-message">No machine id provided. Return to the list.</div>';
    return;
  }

  const STATIC_MACHINE = {
    id: "vm1",
    name: "Vending Machine 1",
    location: "Library 2nd",
    lastRestocked: "2027-02-15",
  };
  async function loadItems(db) {
    const snapshot = await db
      .collection("items")
      .where("machineId", "==", id)
      .orderBy("slotLabel")
      .get();

    const items = [];
    snapshot.forEach((d) => items.push({ id: d.id, ...d.data() }));
    allItems = items;
    applyItemFilters();
    
    // Determine overall status and update status bar
    const overallStatus = getOverallMachineStatus(items);
    if (statusBar) {
      statusBar.className = ""; // Clear existing classes
      statusBar.classList.add(overallStatus);
      statusBar.textContent = `${items.length} item${items.length !== 1 ? "s" : ""} loaded`;
    }
    return items;
  }

  const tryLoad = () => {
    if (typeof firebase === "undefined" || !firebase.app) {
      renderMachineInfo(STATIC_MACHINE);
      allItems = [];
      applyItemFilters();
      statusBar.textContent = "Firebase unavailable — machine items could not be loaded";
      statusBar.className = "red";
      return;
    }

    try {
      const db = firebase.firestore();
      activeDb = db;
      db.collection("vendingMachines")
        .doc(id)
        .get()
        .then((doc) => {
          if (doc.exists) renderMachineInfo({ id: doc.id, ...doc.data() });
          else renderMachineInfo(STATIC_MACHINE);
        })
        .catch(() => renderMachineInfo(STATIC_MACHINE));

      loadItems(db)
        .catch((err) => {
          console.error(err);
          allItems = [];
          applyItemFilters();
          statusBar.textContent = "Error loading items";
          statusBar.className = "red";
        });
      checkItemNotifications(db, id)
        .then(function () { return loadNotifications(db, id); })
        .catch(console.error);
    } catch (e) {
      console.error(e);
      renderMachineInfo(STATIC_MACHINE);
      allItems = [];
      applyItemFilters();
      statusBar.textContent = "Firebase not initialized — items could not be loaded";
      statusBar.className = "red";
    }
  };

  tryLoad();

  // Expose dismissNotification for machine view (admins only)
  window.dismissNotification = async function (btn) {
    const notifId = btn && btn.getAttribute ? btn.getAttribute("data-notif-id") : null;
    if (!notifId) return;
    const item = btn.closest && btn.closest(".notif-item");
    const list = document.getElementById("notif-list");
    if (item) item.remove();
    if (list && !list.querySelector(".notif-item")) {
      list.innerHTML = '<div class="notif-empty">No notifications.</div>';
    }
    try {
      // wait briefly for admin role to be known
      const start = Date.now();
      let isAdmin = window.vmitAuth && window.vmitAuth.getRole() === "admin";
      while (!isAdmin && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 150));
        isAdmin = window.vmitAuth && window.vmitAuth.getRole() === "admin";
      }
      if (!isAdmin) {
        console.warn("Only admins may dismiss notifications.");
        return;
      }
      if (!activeDb) {
        console.warn("No firestore instance available to delete notification.");
        return;
      }
      await activeDb.collection("notifications").doc(notifId).delete();
    } catch (err) {
      console.error("Failed to dismiss notification:", err);
    }
  };

  // Reveal notification UI for admins after role is known
  (async function revealNotifForAdmin() {
    const notifBtn = document.getElementById("notif-btn");
    const notifPanel = document.getElementById("notif-panel");
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (window.vmitAuth && window.vmitAuth.getRole() === "admin") {
        if (notifBtn) notifBtn.style.display = "inline-block";
        if (notifPanel) notifPanel.style.display = "";
        if (activeDb) loadNotifications(activeDb, id).catch(console.error);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (notifBtn) notifBtn.style.display = "none";
    if (notifPanel) notifPanel.style.display = "none";
  })();

  itemSearchInput.addEventListener("input", applyItemFilters);
  itemFilterSelect.addEventListener("change", applyItemFilters);
  if (itemViewSelect) {
    itemViewSelect.addEventListener("change", function () {
      currentItemView = itemViewSelect.value === "grid" ? "grid" : "list";
      applyItemFilters();
    });
  }

  // ── Edit Item modal ──
  const editItemModal       = document.getElementById("edit-item-modal");
  const editItemModalClose  = document.getElementById("edit-item-modal-close");
  const editItemSaveBtn     = document.getElementById("edit-item-save-btn");
  const editItemStatus      = document.getElementById("edit-item-status");
  const editItemInputs = [
    document.getElementById("edit-slot-input"),
    document.getElementById("edit-name-input"),
    document.getElementById("edit-price-input"),
    document.getElementById("edit-qty-input"),
    document.getElementById("edit-low-stock-input"),
  ];
  let currentEditingItemId = null;

  function openEditItemModal(item) {
    currentEditingItemId = item.id || null;
    document.getElementById("edit-slot-input").value      = item.slotLabel || "";
    document.getElementById("edit-name-input").value      = item.name || "";
    document.getElementById("edit-price-input").value     = item.price != null ? item.price : "";
    document.getElementById("edit-qty-input").value       = item.quantity != null ? item.quantity : "";
    document.getElementById("edit-low-stock-input").value = item.lowStockThreshold != null ? item.lowStockThreshold : "";
    const expiry = item.expirationDate
      ? (item.expirationDate.toDate
          ? item.expirationDate.toDate().toISOString().slice(0, 10)
          : String(item.expirationDate).slice(0, 10))
      : "";
    document.getElementById("edit-expiry-input").value = expiry;
    editItemStatus.textContent = "";
    editItemStatus.classList.remove("error");
    editItemSaveBtn.disabled = false;
    editItemModal.classList.remove("hidden");
    document.getElementById("edit-name-input").focus();
  }

  function closeEditItemModal() {
    editItemModal.classList.add("hidden");
    currentEditingItemId = null;
  }

  function setEditItemStatus(message, isError) {
    editItemStatus.textContent = message;
    editItemStatus.classList.toggle("error", Boolean(isError));
  }

  function validateEditItemData(fields) {
    const errors = [];

    if (!fields.slot) errors.push("Slot label is required.");
    if (!fields.name) errors.push("Item name is required.");
    if (!fields.priceText) {
      errors.push("Price is required.");
    } else {
      const priceValue = Number(fields.priceText);
      if (!Number.isFinite(priceValue)) {
        errors.push("Price must be a valid number (example: 1.50).");
      } else if (priceValue < 0) {
        errors.push("Price cannot be negative.");
      }
    }

    if (!fields.qtyText) {
      errors.push("Quantity is required.");
    } else {
      const qtyValue = Number(fields.qtyText);
      if (!Number.isFinite(qtyValue)) {
        errors.push("Quantity must be a number.");
      } else if (!Number.isInteger(qtyValue)) {
        errors.push("Quantity must be a whole number.");
      } else if (qtyValue < 0) {
        errors.push("Quantity cannot be negative.");
      }
    }

    if (!fields.lowStockText) {
      errors.push("Low stock threshold is required.");
    } else {
      const lowStockValue = Number(fields.lowStockText);
      if (!Number.isFinite(lowStockValue)) {
        errors.push("Low stock threshold must be a number.");
      } else if (!Number.isInteger(lowStockValue)) {
        errors.push("Low stock threshold must be a whole number.");
      } else if (lowStockValue < 0) {
        errors.push("Low stock threshold cannot be negative.");
      }
    }

    let expirationDate = null;
    if (fields.expiryText) {
      const parsedDate = new Date(`${fields.expiryText}T00:00:00`);
      if (Number.isNaN(parsedDate.getTime())) {
        errors.push("Expiration date is invalid.");
      } else {
        expirationDate = firebase.firestore.Timestamp.fromDate(parsedDate);
      }
    }

    return {
      errors,
      values: {
        price: Number(fields.priceText),
        quantity: Number(fields.qtyText),
        lowStockThreshold: Number(fields.lowStockText),
        expirationDate,
      },
    };
  }

  document.getElementById("items-container").addEventListener("click", async function (e) {
    const editBtn = e.target.closest(".btn-edit-item");
    if (editBtn) {
      if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") return;
      try {
        const item = JSON.parse(editBtn.getAttribute("data-item"));
        openEditItemModal(item);
      } catch (_) {}
      return;
    }

    const deleteBtn = e.target.closest(".btn-delete-item");
    if (!deleteBtn) return;
    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") return;

    const itemId = deleteBtn.getAttribute("data-item-id");
    const itemName = deleteBtn.getAttribute("data-item-name") || "item";
    if (!itemId || !activeDb) {
      statusBar.textContent = "Unable to delete item right now. Please try again.";
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      statusBar.textContent = "Admin auth session is missing or expired. Please login again.";
      return;
    }

    const confirmed = window.confirm(`Delete ${itemName} from this machine? This cannot be undone.`);
    if (!confirmed) return;

    try {
      deleteBtn.disabled = true;
      statusBar.textContent = `Deleting ${itemName}...`;
      await activeDb.collection("items").doc(itemId).delete();
      await loadItems(activeDb);
      statusBar.textContent = `${itemName} deleted.`;
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        statusBar.textContent = "Firebase denied delete access. Verify Firestore Rules for admin writes.";
      } else {
        statusBar.textContent = err.message || "Failed to delete item.";
      }
    } finally {
      deleteBtn.disabled = false;
    }
  });

  function clearEditItemStatus() {
    if (!editItemStatus.classList.contains("error")) {
      editItemStatus.textContent = "";
    }
  }

  editItemInputs.forEach(el => el.addEventListener("input", clearEditItemStatus));
  document.getElementById("edit-expiry-input").addEventListener("input", clearEditItemStatus);

  editItemModalClose.addEventListener("click", closeEditItemModal);
  editItemModal.addEventListener("click", function (e) {
    if (e.target === editItemModal) closeEditItemModal();
  });

  editItemSaveBtn.addEventListener("click", async function () {
    const slot = document.getElementById("edit-slot-input").value.trim().toUpperCase();
    const name = document.getElementById("edit-name-input").value.trim();
    const priceText = document.getElementById("edit-price-input").value.trim();
    const qtyText = document.getElementById("edit-qty-input").value.trim();
    const lowStockText = document.getElementById("edit-low-stock-input").value.trim();
    const expiryText = document.getElementById("edit-expiry-input").value;

    const validation = validateEditItemData({
      slot,
      name,
      priceText,
      qtyText,
      lowStockText,
      expiryText,
    });

    if (validation.errors.length) {
      setEditItemStatus(`Unable to save item: ${validation.errors.join(" ")}`, true);
      return;
    }

    const { price, quantity, lowStockThreshold, expirationDate } = validation.values;

    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setEditItemStatus("Only admins can edit items.", true);
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setEditItemStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }

    if (!activeDb || !currentEditingItemId) {
      setEditItemStatus("Unable to save item right now. Please try again.", true);
      return;
    }

    try {
      editItemSaveBtn.disabled = true;
      setEditItemStatus("Saving changes...", false);

      const oldItem = allItems.find(function (i) { return i.id === currentEditingItemId; });
      const oldQuantity = oldItem ? Number(oldItem.quantity) : null;
      const restockUpdated = oldQuantity !== null && quantity > oldQuantity;
      const itemRef = activeDb.collection("items").doc(currentEditingItemId);
      const baseItemUpdate = {
        slotLabel: slot,
        name,
        price,
        lowStockThreshold,
        expirationDate,
      };

      if (restockUpdated) {
        await itemRef.update(baseItemUpdate);
        await logRestockEventAtomic(
          id,
          slot,
          currentEditingItemId,
          name,
          oldQuantity,
          quantity,
          getAuthenticatedUserId(),
          ""
        );
      } else {
        await itemRef.update({
          ...baseItemUpdate,
          quantity,
        });
      }

      setEditItemStatus(`${name} updated successfully.`, false);
      if (oldQuantity !== null) {
        const machineName = document.getElementById("machine-title").textContent || "";
        createStockNotifications(activeDb, [{
          id: currentEditingItemId,
          name,
          machineId: id,
          machineName,
          oldQuantity,
          newQuantity: quantity,
          lowStockThreshold,
        }]).catch(console.error);
      }
      if (restockUpdated) {
        await touchMachineRestocked(activeDb, id);
      }
      closeEditItemModal();
      await loadItems(activeDb);
      await checkItemNotifications(activeDb, id);
      loadNotifications(activeDb, id).catch(console.error);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        setEditItemStatus("Firebase denied write access. Verify Firestore Rules allow authenticated admin writes to items.", true);
        return;
      }
      setEditItemStatus(err.message || "Failed to save item.", true);
    } finally {
      editItemSaveBtn.disabled = false;
    }
  });

  // ── Add Item modal ──
  const addItemModal  = document.getElementById("add-item-modal");
  const addItemBtn    = document.getElementById("add-item-btn");
  const addItemClose  = document.getElementById("add-item-modal-close");
  const addItemSubmit = document.getElementById("add-item-submit-btn");
  const addItemStatus = document.getElementById("add-item-status");
  const itemInputs = [
    document.getElementById("item-slot-input"),
    document.getElementById("item-name-input"),
    document.getElementById("item-price-input"),
    document.getElementById("item-qty-input"),
    document.getElementById("item-low-stock-input"),
  ];

  function openAddItemModal() {
    addItemModal.classList.remove("hidden");
    setAddItemStatus("Fill out the form and click Add Item.", false);
    addItemSubmit.disabled = false;
    itemInputs.forEach(el => { el.value = ""; });
    document.getElementById("item-expiry-input").value = "";
  }

  function closeAddItemModal() {
    addItemModal.classList.add("hidden");
  }

  function setAddItemStatus(message, isError) {
    addItemStatus.textContent = message;
    addItemStatus.classList.toggle("error", Boolean(isError));
  }

  function isAuthenticatedAdmin() {
    const role = window.vmitAuth ? window.vmitAuth.getRole() : null;
    const user = typeof firebase !== "undefined" && firebase.auth
      ? firebase.auth().currentUser
      : null;
    return role === "admin" && !!user;
  }

  async function waitForAdminAuthSession() {
    if (isAuthenticatedAdmin()) {
      return true;
    }

    if (!window.vmitAuth || window.vmitAuth.getRole() !== "admin") {
      return false;
    }

    if (typeof firebase === "undefined" || !firebase.auth) {
      return false;
    }

    const auth = firebase.auth();
    if (auth.currentUser) {
      return true;
    }

    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (unsubscribe) unsubscribe();
        resolve(value);
      };

      // Auth restore can briefly report null before the admin user is hydrated.
      const timer = setTimeout(() => finish(isAuthenticatedAdmin()), 3000);
      unsubscribe = auth.onAuthStateChanged((user) => {
        if (user && window.vmitAuth.getRole() === "admin") {
          finish(true);
        }
      });
    });
  }

  function clearAddItemStatus() {
    if (!addItemStatus.classList.contains("error")) {
      addItemStatus.textContent = "";
    }
  }

  // ── Bulk quantity modal ──
  const bulkQtyModal = document.getElementById("bulk-qty-modal");
  const bulkQtyModalClose = document.getElementById("bulk-qty-modal-close");
  const bulkQtyBtn = document.getElementById("bulk-qty-btn");
  const bulkQtyList = document.getElementById("bulk-qty-list");
  const bulkQtySaveBtn = document.getElementById("bulk-qty-save-btn");
  const bulkQtyStatus = document.getElementById("bulk-qty-status");
  const bulkQtyModeInput = document.getElementById("bulk-qty-mode-input");
  const bulkQtySharedWrap = document.getElementById("bulk-qty-shared");
  const bulkQtySharedInput = document.getElementById("bulk-qty-shared-input");
  let bulkQtyRows = [];

  function setBulkQtyStatus(message, isError) {
    bulkQtyStatus.textContent = message;
    bulkQtyStatus.classList.toggle("error", Boolean(isError));
  }

  function clearBulkQtyStatus() {
    if (!bulkQtyStatus.classList.contains("error")) {
      bulkQtyStatus.textContent = "";
    }
  }

  function closeBulkQtyModal() {
    bulkQtyModal.classList.add("hidden");
    bulkQtyRows = [];
  }

  function getBulkQtyMode() {
    return bulkQtyModeInput.value === "shared" ? "shared" : "individual";
  }

  function updateBulkQtyModeUi() {
    const mode = getBulkQtyMode();
    bulkQtySharedWrap.classList.toggle("visible", mode === "shared");
    bulkQtyList.classList.toggle("hidden", mode === "shared");
    if (mode === "shared") {
      bulkQtySharedInput.focus();
    } else if (bulkQtyRows.length) {
      bulkQtyRows[0].input.focus();
    }
  }

  function renderBulkQtyList(items) {
    bulkQtyRows = [];
    bulkQtyList.innerHTML = "";

    if (!items || !items.length) {
      bulkQtyList.innerHTML = '<div class="bulk-qty-empty">This machine has no items to restock yet.</div>';
      bulkQtySaveBtn.disabled = true;
      return;
    }

    bulkQtySaveBtn.disabled = false;

    items.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "bulk-qty-row";

      const label = document.createElement("div");
      label.className = "bulk-qty-label";

      const name = document.createElement("div");
      name.className = "bulk-qty-name";
      name.textContent = `${item.slotLabel || "—"} · ${item.name || "Item"}`;

      const meta = document.createElement("div");
      meta.className = "bulk-qty-meta";
      meta.textContent = `Price $${Number(item.price || 0).toFixed(2)} · Low stock ${item.lowStockThreshold != null ? item.lowStockThreshold : "—"}`;

      label.appendChild(name);
      label.appendChild(meta);

      const input = document.createElement("input");
      input.className = "modal-input bulk-qty-input";
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = item.quantity != null ? item.quantity : "";
      input.setAttribute("aria-label", `Quantity for ${item.name || "item"}`);

      const current = document.createElement("div");
      current.className = "bulk-qty-current";
      current.textContent = `Current ${item.quantity != null ? item.quantity : "—"}`;

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(current);
      bulkQtyList.appendChild(row);

      bulkQtyRows.push({ itemId: item.id, input: input });
    });
  }

  function openBulkQtyModal() {
    bulkQtyModeInput.value = "individual";
    bulkQtySharedInput.value = "";
    renderBulkQtyList(allItems);
    setBulkQtyStatus(allItems.length ? "Adjust quantities and save the restock update." : "This machine has no items to update.", false);
    bulkQtyModal.classList.remove("hidden");
    updateBulkQtyModeUi();
  }

  bulkQtyList.addEventListener("input", clearBulkQtyStatus);
  bulkQtyModeInput.addEventListener("change", updateBulkQtyModeUi);
  bulkQtySharedInput.addEventListener("input", clearBulkQtyStatus);

  function validateAddItemData(fields) {
    const errors = [];

    if (!fields.slot) errors.push("Slot label is required.");
    if (!fields.name) errors.push("Item name is required.");
    if (!fields.priceText) {
      errors.push("Price is required.");
    } else {
      const priceValue = Number(fields.priceText);
      if (!Number.isFinite(priceValue)) {
        errors.push("Price must be a valid number (example: 1.50).");
      } else if (priceValue < 0) {
        errors.push("Price cannot be negative.");
      }
    }

    if (!fields.qtyText) {
      errors.push("Initial quantity is required.");
    } else {
      const qtyValue = Number(fields.qtyText);
      if (!Number.isFinite(qtyValue)) {
        errors.push("Initial quantity must be a number.");
      } else if (!Number.isInteger(qtyValue)) {
        errors.push("Initial quantity must be a whole number.");
      } else if (qtyValue < 0) {
        errors.push("Initial quantity cannot be negative.");
      }
    }

    if (!fields.lowStockText) {
      errors.push("Low stock threshold is required.");
    } else {
      const lowStockValue = Number(fields.lowStockText);
      if (!Number.isFinite(lowStockValue)) {
        errors.push("Low stock threshold must be a number.");
      } else if (!Number.isInteger(lowStockValue)) {
        errors.push("Low stock threshold must be a whole number.");
      } else if (lowStockValue < 0) {
        errors.push("Low stock threshold cannot be negative.");
      }
    }

    let expirationDate = null;
    if (fields.expiryText) {
      const parsedDate = new Date(`${fields.expiryText}T00:00:00`);
      if (Number.isNaN(parsedDate.getTime())) {
        errors.push("Expiration date is invalid.");
      } else {
        expirationDate = firebase.firestore.Timestamp.fromDate(parsedDate);
      }
    }

    return {
      errors,
      values: {
        price: Number(fields.priceText),
        quantity: Number(fields.qtyText),
        lowStockThreshold: Number(fields.lowStockText),
        expirationDate,
      },
    };
  }

  itemInputs.forEach(el => el.addEventListener("input", clearAddItemStatus));
  document.getElementById("item-expiry-input").addEventListener("input", clearAddItemStatus);

  addItemBtn.addEventListener("click", openAddItemModal);
  addItemClose.addEventListener("click", closeAddItemModal);
  addItemModal.addEventListener("click", function (e) {
    if (e.target === addItemModal) closeAddItemModal();
  });

  bulkQtyBtn.addEventListener("click", openBulkQtyModal);
  bulkQtyModalClose.addEventListener("click", closeBulkQtyModal);
  bulkQtyModal.addEventListener("click", function (e) {
    if (e.target === bulkQtyModal) closeBulkQtyModal();
  });

  bulkQtySaveBtn.addEventListener("click", async function () {
    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setBulkQtyStatus("Only admins can edit item quantities.", true);
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setBulkQtyStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }

    if (!activeDb) {
      setBulkQtyStatus("Firebase is not ready yet. Try again in a moment.", true);
      return;
    }

    if (!bulkQtyRows.length) {
      setBulkQtyStatus("There are no quantities to update.", true);
      return;
    }

    const updates = [];
    const notifications = [];
    const mode = getBulkQtyMode();
    let anyRestockIncrease = false;

    if (mode === "shared") {
      const sharedQuantity = parsePositiveInteger(bulkQtySharedInput.value.trim());
      if (sharedQuantity === null) {
        setBulkQtyStatus("Enter a shared quantity for all items.", true);
        return;
      }
      if (!Number.isFinite(sharedQuantity)) {
        setBulkQtyStatus("Shared quantity must be a whole number.", true);
        return;
      }

      for (const row of bulkQtyRows) {
        const item = allItems.find(function (entry) { return entry.id === row.itemId; });
        if (!item) {
          setBulkQtyStatus("One or more items could not be found. Refresh and try again.", true);
          return;
        }

        const oldQuantity = Number(item.quantity) || 0;
        if (sharedQuantity !== oldQuantity) {
          if (sharedQuantity > oldQuantity) {
            anyRestockIncrease = true;
          }
          updates.push({
            id: item.id,
            ref: activeDb.collection("items").doc(item.id),
            name: item.name,
            slotLabel: item.slotLabel,
            oldQuantity,
            quantity: sharedQuantity,
          });
          notifications.push({
            id: item.id,
            name: item.name,
            machineId: id,
            machineName: document.getElementById("machine-title").textContent || "",
            oldQuantity,
            newQuantity: sharedQuantity,
            lowStockThreshold: item.lowStockThreshold,
          });
        }
      }
    } else {
      for (const row of bulkQtyRows) {
        const item = allItems.find(function (entry) { return entry.id === row.itemId; });
        if (!item) {
          setBulkQtyStatus("One or more items could not be found. Refresh and try again.", true);
          return;
        }

        const parsedQuantity = parsePositiveInteger(row.input.value.trim());
        if (parsedQuantity === null) {
          setBulkQtyStatus(`Quantity is required for ${item.name || item.slotLabel || "an item"}.`, true);
          return;
        }
        if (!Number.isFinite(parsedQuantity)) {
          setBulkQtyStatus(`Quantity must be a whole number for ${item.name || item.slotLabel || "an item"}.`, true);
          return;
        }

        const oldQuantity = Number(item.quantity) || 0;
        if (parsedQuantity !== oldQuantity) {
          if (parsedQuantity > oldQuantity) {
            anyRestockIncrease = true;
          }
          updates.push({
            id: item.id,
            ref: activeDb.collection("items").doc(item.id),
            name: item.name,
            slotLabel: item.slotLabel,
            oldQuantity,
            quantity: parsedQuantity,
          });
          notifications.push({
            id: item.id,
            name: item.name,
            machineId: id,
            machineName: document.getElementById("machine-title").textContent || "",
            oldQuantity,
            newQuantity: parsedQuantity,
            lowStockThreshold: item.lowStockThreshold,
          });
        }
      }
    }

    if (!updates.length) {
      setBulkQtyStatus("No quantity changes were made.", false);
      return;
    }

    try {
      bulkQtySaveBtn.disabled = true;
      setBulkQtyStatus("Saving quantity changes...", false);

      const nonRestockUpdates = updates.filter(function (update) {
        return update.quantity <= update.oldQuantity;
      });
      const restockUpdates = updates.filter(function (update) {
        return update.quantity > update.oldQuantity;
      });

      const chunkSize = 450;
      for (let i = 0; i < nonRestockUpdates.length; i += chunkSize) {
        const batch = activeDb.batch();
        nonRestockUpdates.slice(i, i + chunkSize).forEach(function (update) {
          batch.update(update.ref, { quantity: update.quantity });
        });
        await batch.commit();
      }

      for (const update of restockUpdates) {
        await logRestockEventAtomic(
          id,
          String(update.slotLabel || ""),
          update.id,
          String(update.name || "Item"),
          Number(update.oldQuantity),
          Number(update.quantity),
          getAuthenticatedUserId(),
          ""
        );
      }

      await createStockNotifications(activeDb, notifications);
      if (anyRestockIncrease) {
        await touchMachineRestocked(activeDb, id);
      }

      setBulkQtyStatus(`Updated ${updates.length} item${updates.length !== 1 ? "s" : ""} successfully.`, false);
      closeBulkQtyModal();
      await loadItems(activeDb);
      await checkItemNotifications(activeDb, id);
      loadNotifications(activeDb, id).catch(console.error);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        setBulkQtyStatus("Firebase denied write access. Verify Firestore Rules allow authenticated admin writes to items.", true);
        return;
      }
      setBulkQtyStatus(err.message || "Failed to save quantity changes.", true);
    } finally {
      bulkQtySaveBtn.disabled = false;
    }
  });

  addItemSubmit.addEventListener("click", async function () {
    const slot = document.getElementById("item-slot-input").value.trim().toUpperCase();
    const name = document.getElementById("item-name-input").value.trim();
    const priceText = document.getElementById("item-price-input").value.trim();
    const qtyText = document.getElementById("item-qty-input").value.trim();
    const lowStockText = document.getElementById("item-low-stock-input").value.trim();
    const expiryText = document.getElementById("item-expiry-input").value;

    const validation = validateAddItemData({
      slot,
      name,
      priceText,
      qtyText,
      lowStockText,
      expiryText,
    });
    if (validation.errors.length) {
      setAddItemStatus(`Unable to add item: ${validation.errors.join(" ")}`, true);
      return;
    }

    const { price, quantity, lowStockThreshold, expirationDate } = validation.values;

    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setAddItemStatus("Only admins can add items.", true);
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setAddItemStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }

    if (!activeDb) {
      setAddItemStatus("Firebase is not ready yet. Try again in a moment.", true);
      return;
    }

    try {
      addItemSubmit.disabled = true;
      setAddItemStatus("Adding item to Firebase...", false);

      const existing = await activeDb
        .collection("items")
        .where("machineId", "==", id)
        .where("slotLabel", "==", slot)
        .limit(1)
        .get();

      if (!existing.empty) {
        setAddItemStatus(`Slot ${slot} already exists for this machine.`, true);
        return;
      }

      const machineName = document.getElementById("machine-title").textContent || "Vending Machine";

      await activeDb.collection("items").add({
        machineId: id,
        machineName,
        slotLabel: slot,
        name,
        price,
        priceTbd: false,
        quantity,
        lowStockThreshold,
        expirationDate,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      setAddItemStatus(`Added ${name} in slot ${slot}.`, false);
      closeAddItemModal();
      await loadItems(activeDb);
      await checkItemNotifications(activeDb, id);
      loadNotifications(activeDb, id).catch(console.error);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        setAddItemStatus("Firebase denied write access. Verify Firestore Rules allow authenticated admin writes to items.", true);
        return;
      }
      setAddItemStatus(err.message || "Failed to add item.", true);
    } finally {
      addItemSubmit.disabled = false;
    }
  });

  // ── Transaction upload modal ──
  const txnModal = document.getElementById("txn-modal");
  const txnModalCloseBtn = document.getElementById("txn-modal-close-btn");
  const txnMachineInput = document.getElementById("txn-machine-input");
  const txnFileInput = document.getElementById("txn-file-input");
  const txnParseBtn = document.getElementById("txn-parse-btn");
  const txnApplyBtn = document.getElementById("txn-apply-btn");
  const txnStatus = document.getElementById("txn-status");
  const txnPreviewWrap = document.getElementById("txn-preview-wrap");
  const txnPreviewTbody = document.getElementById("txn-preview-tbody");
  const uploadTxnBtn = document.getElementById("upload-txn-btn");

  let parsedTxns = [];

  function setTxnStatus(msg, isError) {
    txnStatus.textContent = msg;
    txnStatus.classList.toggle("error", Boolean(isError));
  }

  function refreshTxnApplyButtonState() {
    txnApplyBtn.disabled = !parsedTxns.length;
  }

  function openTxnModal() {
    txnModal.classList.remove("hidden");
    setTxnStatus("Upload a CSV/PDF to preview transaction updates.", false);
    txnPreviewWrap.classList.add("hidden");
    txnPreviewTbody.innerHTML = "";
    parsedTxns = [];
    txnFileInput.value = "";
    txnMachineInput.value = document.getElementById("machine-title").textContent || id;
    refreshTxnApplyButtonState();
  }

  function closeTxnModal() {
    txnModal.classList.add("hidden");
  }

  function parseTxnCsv(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    const header = parseCsvLine(lines[0]).map((h) =>
      h.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    const dateCol = header.findIndex((h) => h === "transactiondate" || h === "date" || h === "trandate");
    const locationCol = header.findIndex((h) => h === "location" || h === "machinelocation" || h === "machine");
    const amountCol = header.findIndex((h) => h === "tranamt" || h === "amount" || h === "transactionamount" || h === "amt");

    if (dateCol === -1 || locationCol === -1 || amountCol === -1) {
      throw new Error("CSV must include date, location, and transaction amount columns.");
    }

    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const cols = parseCsvLine(lines[i]);
      const transactionDate = String(cols[dateCol] || "").trim();
      const location = String(cols[locationCol] || "").trim();
      const amountText = String(cols[amountCol] || "").replace(/[$,]/g, "").trim();
      const amount = Number.parseFloat(amountText);
      if (!transactionDate || !location || !Number.isFinite(amount) || amount <= 0) continue;
      rows.push({ transactionDate, location, amount });
    }
    return rows;
  }

  function parseTxnPdfLines(lines) {
    const rows = [];

    lines.forEach((raw) => {
      const line = String(raw || "").replace(/\s+/g, " ").trim();
      if (!line) return;

      const dateTimeMatch = line.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)\s+(.+)$/i);
      if (!dateTimeMatch) return;

      const transactionDate = dateTimeMatch[1];
      const trailing = dateTimeMatch[3];
      const amountMatch = trailing.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
      if (!amountMatch) return;

      const amount = Number.parseFloat(amountMatch[1]);
      if (!Number.isFinite(amount) || amount <= 0) return;

      const locationMatch = trailing.match(/^(\d+)\s+([A-Za-z_][A-Za-z0-9_\-]*)/);
      let location = "";
      if (locationMatch) {
        location = `${locationMatch[1]} ${locationMatch[2]}`;
      } else {
        const tokenMatch = trailing.match(/^([A-Za-z_][A-Za-z0-9_\-]*)/);
        if (tokenMatch) location = tokenMatch[1];
      }

      if (!location) return;
      rows.push({ transactionDate, location, amount });
    });

    return rows;
  }

  async function parseTxnFile(file) {
    const lowerName = (file && file.name ? file.name : "").toLowerCase();
    if (lowerName.endsWith(".csv")) {
      return parseTxnCsv(await file.text());
    }
    if (lowerName.endsWith(".pdf")) {
      const lines = await extractPdfLines(file);
      return parseTxnPdfLines(lines);
    }
    throw new Error("Only CSV and PDF files are supported.");
  }

  txnParseBtn.addEventListener("click", async function () {
    const file = txnFileInput.files && txnFileInput.files[0];
    if (!file) {
      setTxnStatus("Choose a CSV or PDF file first.", true);
      return;
    }

    try {
      txnParseBtn.disabled = true;
      setTxnStatus("Parsing file...", false);
      const rows = await parseTxnFile(file);
      if (!rows.length) {
        parsedTxns = [];
        txnPreviewWrap.classList.add("hidden");
        refreshTxnApplyButtonState();
        setTxnStatus("No valid rows found. Verify the report includes date, location, and transaction amount.", true);
        return;
      }

      // Load machine items to determine mappings
      const itemSnapshot = await activeDb
        .collection("items")
        .where("machineId", "==", id)
        .get();

      const buckets = new Map();
      itemSnapshot.forEach((doc) => {
        const data = doc.data();
        const cents = Math.round(Number(data.price || 0) * 100);
        if (!buckets.has(cents)) buckets.set(cents, []);
        buckets.get(cents).push({
          slotLabel: String(data.slotLabel || ""),
          name: String(data.name || ""),
        });
      });

      buckets.forEach((arr) => {
        arr.sort((a, b) => a.slotLabel.localeCompare(b.slotLabel));
      });

      parsedTxns = rows;
      txnPreviewTbody.innerHTML = rows
        .map((r) => {
          const priceCents = Math.round(r.amount * 100);
          const candidates = buckets.get(priceCents) || [];
          const matchedItem = candidates.length > 0 ? candidates[0] : null;
          const mappedTo = matchedItem ? `${escapeHtml(matchedItem.name)} (${escapeHtml(matchedItem.slotLabel)})` : "No matching item";
          return `<tr><td>${escapeHtml(r.transactionDate)}</td><td>$${r.amount.toFixed(2)}</td><td>${mappedTo}</td></tr>`;
        })
        .join("");
      txnPreviewWrap.classList.remove("hidden");
      refreshTxnApplyButtonState();
      setTxnStatus(`Parsed ${rows.length} transaction row${rows.length !== 1 ? "s" : ""}. Review and apply.`, false);
    } catch (err) {
      parsedTxns = [];
      txnPreviewWrap.classList.add("hidden");
      refreshTxnApplyButtonState();
      setTxnStatus(err.message || "Failed to parse file.", true);
    } finally {
      txnParseBtn.disabled = false;
    }
  });

  txnApplyBtn.addEventListener("click", async function () {
    if (!parsedTxns.length) {
      setTxnStatus("Parse a file first.", true);
      return;
    }
    if (!activeDb) {
      setTxnStatus("Firebase is not ready. Try again in a moment.", true);
      return;
    }
    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setTxnStatus("Only admins can apply transactions.", true);
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setTxnStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }

    try {
      txnApplyBtn.disabled = true;
      txnParseBtn.disabled = true;
      setTxnStatus("Applying transactions...", false);

      const itemSnapshot = await activeDb
        .collection("items")
        .where("machineId", "==", id)
        .get();

      const buckets = new Map();
      itemSnapshot.forEach((doc) => {
        const data = doc.data();
        const cents = Math.round(Number(data.price || 0) * 100);
        if (!buckets.has(cents)) buckets.set(cents, []);
        const qty = typeof data.quantity === "number" ? data.quantity : 0;
        buckets.get(cents).push({
          id: doc.id,
          ref: doc.ref,
          quantity: qty,
          originalQuantity: qty,
          slotLabel: String(data.slotLabel || ""),
          name: String(data.name || ""),
          machineId: String(data.machineId || id),
          machineName: String(data.machineName || ""),
          lowStockThreshold: typeof data.lowStockThreshold === "number" ? data.lowStockThreshold : 5,
        });
      });

      buckets.forEach((arr) => {
        arr.sort((a, b) => a.slotLabel.localeCompare(b.slotLabel));
      });

      const txnPriceSet = new Set(parsedTxns.map((txn) => Math.round(Number(txn.amount || 0) * 100)));
      const overlappingPriceCount = Array.from(txnPriceSet).filter((priceCents) => buckets.has(priceCents)).length;
      const machineLabel = document.getElementById("machine-title").textContent || "current machine";

      if (overlappingPriceCount === 0) {
        setTxnStatus(`No item prices in ${machineLabel} match any parsed transaction amounts.`, true);
        return;
      }

      // Find prices that don't match any items in the machine
      const unmatchedPrices = Array.from(txnPriceSet).filter((priceCents) => !buckets.has(priceCents));
      if (unmatchedPrices.length > 0) {
        const unmatchedPricesFormatted = unmatchedPrices
          .map((cents) => `$${(cents / 100).toFixed(2)}`)
          .sort();
        const priceMessage = unmatchedPricesFormatted.join(", ");
        const confirmApply = window.confirm(
          `Warning: The following price${unmatchedPrices.length !== 1 ? "s" : ""} from the transaction file do not match any items in ${machineLabel}:\n\n${priceMessage}\n\nDo you want to continue applying the matching transactions?`,
        );
        if (!confirmApply) {
          setTxnStatus("Transaction application cancelled.", false);
          return;
        }
      }

      const updatedItemRefs = new Map();
      const txnAuditRows = [];
      let matched = 0;
      let unmatchedPrice = 0;

      function parseTransactionDate(value) {
        const raw = String(value || "").trim();
        if (!raw) return new Date();
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) return parsed;
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          const month = Number(m[1]) - 1;
          const day = Number(m[2]);
          const year = Number(m[3]);
          const dt = new Date(year, month, day);
          if (!Number.isNaN(dt.getTime())) return dt;
        }
        return new Date();
      }

      for (const txn of parsedTxns) {
        const priceCents = Math.round(txn.amount * 100);
        const candidates = buckets.get(priceCents) || [];
        const targetItem = candidates.find((item) => item.quantity > 0);
        if (!targetItem) {
          txnAuditRows.push({
            transactionDate: txn.transactionDate || null,
            amount: txn.amount || null,
            itemId: null,
            machineId: id,
            machineName: machineLabel,
            appliedToInventory: false,
          });
          unmatchedPrice += 1;
          continue;
        }

        targetItem.quantity = Math.max(0, targetItem.quantity - 1);
        matched += 1;
        updatedItemRefs.set(targetItem.id, {
          id: targetItem.id,
          ref: targetItem.ref,
          quantity: targetItem.quantity,
          originalQuantity: targetItem.originalQuantity,
          name: targetItem.name,
          machineId: targetItem.machineId,
          machineName: targetItem.machineName,
          lowStockThreshold: targetItem.lowStockThreshold,
        });
        txnAuditRows.push({
          transactionDate: txn.transactionDate || null,
          amount: txn.amount || null,
          itemId: targetItem.id,
          machineId: targetItem.machineId || id,
          machineName: targetItem.machineName || machineLabel,
          appliedToInventory: true,
          oldQuantity: targetItem.originalQuantity,
          newQuantity: targetItem.quantity,
        });
      }

      const updates = Array.from(updatedItemRefs.values());
      const chunkSize = 450;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const batch = activeDb.batch();
        updates.slice(i, i + chunkSize).forEach((update) => {
          batch.update(update.ref, { quantity: update.quantity });
        });
        await batch.commit();
      }

      const notifItems = Array.from(updatedItemRefs.values()).map(function (u) {
        return {
          id: u.id,
          name: u.name,
          machineId: u.machineId,
          machineName: u.machineName,
          oldQuantity: u.originalQuantity,
          newQuantity: u.quantity,
          lowStockThreshold: u.lowStockThreshold,
        };
      });
      await createStockNotifications(activeDb, notifItems);

      // Persist every CSV row that was part of this apply action for analytics/history.
      if (txnAuditRows.length) {
        const chunkSize = 450;
        for (let i = 0; i < txnAuditRows.length; i += chunkSize) {
          const batch = activeDb.batch();
          txnAuditRows.slice(i, i + chunkSize).forEach((t) => {
            const dt = parseTransactionDate(t.transactionDate);
            const docRef = activeDb.collection("transactions").doc();
            const txnData = {
              date: dt,
              dateIso: dt.toISOString(),
              amount: Number(t.amount) || 0,
              itemId: t.itemId || null,
              machineId: t.machineId || id,
              machineName: t.machineName || machineLabel,
              appliedToInventory: Boolean(t.appliedToInventory),
              source: "csv-upload",
              createdAt: new Date(),
            };
            // Include quantity change data if this transaction affected inventory
            if (t.appliedToInventory && t.oldQuantity !== undefined && t.newQuantity !== undefined) {
              txnData.oldQuantity = Number(t.oldQuantity);
              txnData.newQuantity = Number(t.newQuantity);
            }
            batch.set(docRef, txnData);
          });
          await batch.commit();
        }
      }

      setTxnStatus(
        `Applied ${matched} transaction${matched !== 1 ? "s" : ""} to ${machineLabel}. Unmatched price: ${unmatchedPrice}.`,
        false,
      );
      closeTxnModal();
      await loadItems(activeDb);
      await checkItemNotifications(activeDb, id);
      loadNotifications(activeDb, id).catch(console.error);
    } catch (err) {
      console.error(err);
      setTxnStatus(err.message || "Failed to apply transactions.", true);
    } finally {
      txnParseBtn.disabled = false;
      txnApplyBtn.disabled = false;
    }
  });

  uploadTxnBtn.addEventListener("click", openTxnModal);
  txnModalCloseBtn.addEventListener("click", closeTxnModal);
  txnModal.addEventListener("click", function (e) {
    if (e.target === txnModal) closeTxnModal();
  });

  // ── User menu panel ──
  const userMenuBtn = document.getElementById("user-menu-btn");
  const userPanel   = document.getElementById("user-panel");

  userMenuBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    userPanel.classList.toggle("hidden");
    notifPanel.classList.add("hidden");
  });

  document.addEventListener("click", function (e) {
    if (!userPanel.contains(e.target) && e.target !== userMenuBtn) {
      userPanel.classList.add("hidden");
    }
  });

  // ── Notifications panel ──
  const notifBtn   = document.getElementById("notif-btn");
  const notifPanel = document.getElementById("notif-panel");

  notifBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    notifPanel.classList.toggle("hidden");
    userPanel.classList.add("hidden");
  });

  document.addEventListener("click", function (e) {
    if (!notifPanel.contains(e.target) && e.target !== notifBtn) {
      notifPanel.classList.add("hidden");
    }
  });

});
