function statusColor(lastRestocked) {
  if (!lastRestocked) return "gray";
  const last = lastRestocked.toDate
    ? lastRestocked.toDate()
    : new Date(lastRestocked);
  const daysSince = (Date.now() - last.getTime()) / 86400000;
  if (daysSince <= 14) return "green";
  if (daysSince <= 30) return "yellow";
  return "red";
}

function statusBucket(machine) {
  const computed = machine && machine.computedStatus ? String(machine.computedStatus).toLowerCase() : "";
  if (computed === "green" || computed === "yellow" || computed === "red") {
    return computed;
  }

  const status = machine && machine.status ? String(machine.status).toLowerCase() : "";
  if (status === "green" || status === "yellow" || status === "red") {
    return status;
  }
  return statusColor(machine ? machine.lastRestocked : null);
}

function statusLabel(status) {
  if (status === "red") return "Out of Stock";
  if (status === "yellow") return "Low Stock";
  return "In Stock";
}

function computeMachineStatusFromItems(items) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) {
    return null;
  }

  const hasOutOfStock = safeItems.some((item) => Number(item.quantity) <= 0);
  if (hasOutOfStock) {
    return "red";
  }

  let lowStockCount = 0;
  let inStockCount = 0;
  safeItems.forEach((item) => {
    const quantity = Number(item.quantity);
    const threshold = Number(item.lowStockThreshold);
    if (Number.isFinite(threshold) && quantity < threshold) {
      lowStockCount += 1;
      return;
    }
    inStockCount += 1;
  });

  return lowStockCount > inStockCount ? "yellow" : "green";
}

function formatDate(val) {
  if (!val) return "N/A";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
}

function renderMachines(machines, emptyMessage) {
  const tbody = document.getElementById("vm-tbody");
  const isAdmin = window.vmitAuth && window.vmitAuth.getRole() === "admin";
  if (!machines || machines.length === 0) {
    tbody.innerHTML =
      `<tr><td colspan="5" class="table-message">${emptyMessage || "No vending machines found."}</td></tr>`;
    return;
  }

  tbody.innerHTML = machines
    .map((m) => {
      const color = statusBucket(m);
      const label = statusLabel(color);
      const restock = formatDate(m.lastRestocked);
      const name = m.name || "—";
      const location = m.location || "—";
      const safeId = escapeHtml(m.id || "");
      const safeName = escapeHtml(name);
      const actionCell = isAdmin
        ? `<td class="td-actions"><button class="btn-edit-item" data-edit-only type="button" data-machine-id="${safeId}" data-machine-name="${safeName}" data-machine-location="${escapeHtml(location)}">Edit</button><button class="machine-delete-btn" type="button" data-machine-id="${safeId}" data-machine-name="${safeName}">Delete</button></td>`
        : '<td class="td-actions"></td>';
      return `
      <tr data-id="${safeId}" tabindex="0" aria-label="Open ${safeName}">
        <td class="td-status"><span class="status-dot ${color}">${label}</span></td>
        <td class="td-name">${safeName}</td>
        <td class="td-location">${escapeHtml(location)}</td>
        <td class="td-restock">Last restocked: ${restock}</td>
        ${actionCell}
      </tr>`;
    })
    .join("");
}

function openMachine(id) {
  window.location.href = `machine.html?id=${encodeURIComponent(id)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.dismissNotification = async function (btn) {
  const notifId = btn.getAttribute("data-notif-id");
  if (!notifId) return;
  const item = btn.closest(".notif-item");
  const list = document.getElementById("notif-list");
  if (item) item.remove();
  if (list && !list.querySelector(".notif-item")) {
    list.innerHTML = '<div class="notif-empty">No notifications.</div>';
  }
  try {
    // Ensure admin session is established before attempting delete
    const isAdmin = typeof waitForAdminAuthSession === "function"
      ? await waitForAdminAuthSession()
      : (window.vmitAuth && window.vmitAuth.getRole() === "admin");
    if (!isAdmin) {
      console.warn("Only admins may dismiss notifications.");
      return;
    }
    await firebase.firestore().collection("notifications").doc(notifId).delete();
  } catch (err) {
    console.error("Failed to dismiss notification:", err);
  }
};

function normalizePrice(raw) {
  const text = String(raw || "").trim();
  if (!text || /^tbd$/i.test(text)) {
    return { value: 0, display: "TBD", isTbd: true };
  }
  const cleaned = text.replace(/\$/g, "").trim();
  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return { value: amount, display: `$${amount.toFixed(2)}`, isTbd: false };
}

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

function parseCsvRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );

  const rowIndex     = header.findIndex((h) => h === "row" || h === "slot" || h === "slotlabel");
  const productIndex = header.findIndex((h) => h === "product" || h === "item" || h === "name");
  const priceIndex   = header.findIndex((h) => h === "vendingprice" || h === "price");
  const inferred     = rowIndex === -1 || productIndex === -1 || priceIndex === -1;

  const parsed = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols        = parseCsvLine(lines[i]);
    const rowText     = inferred ? cols[0] : cols[rowIndex];
    const productText = inferred ? cols[1] : cols[productIndex];
    const priceText   = inferred ? cols[2] : cols[priceIndex];

    const slot            = String(rowText || "").toUpperCase().trim();
    const name            = String(productText || "").trim();
    const normalizedPrice = normalizePrice(priceText);
    if (!slot || !name || !normalizedPrice) continue;

    parsed.push({
      slotLabel:    slot,
      name,
      price:        normalizedPrice.value,
      priceDisplay: normalizedPrice.display,
      priceTbd:     normalizedPrice.isTbd,
    });
  }
  return parsed;
}

function parseTableRowsFromText(lines) {
  const parsed = [];
  const rowRegex = /^([A-Z]\d)\s+(.+?)\s+(\$?\d+(?:\.\d{1,2})|TBD)$/i;

  lines.forEach((raw) => {
    const line  = raw.replace(/\s+/g, " ").trim();
    const match = line.match(rowRegex);
    if (!match) return;

    const slot            = match[1].toUpperCase();
    const name            = match[2].trim();
    const normalizedPrice = normalizePrice(match[3]);
    if (!normalizedPrice) return;

    parsed.push({
      slotLabel:    slot,
      name,
      price:        normalizedPrice.value,
      priceDisplay: normalizedPrice.display,
      priceTbd:     normalizedPrice.isTbd,
    });
  });
  return parsed;
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
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines  = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page        = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items       = textContent.items
      .map((item) => ({ text: (item.str || "").trim(), x: item.transform[4], y: item.transform[5] }))
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

async function parseItemsFile(file) {
  const name = (file && file.name ? file.name : "").toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    return parseCsvRows(text);
  }
  if (name.endsWith(".pdf")) {
    const lines = await extractPdfLines(file);
    return parseTableRowsFromText(lines);
  }
  throw new Error("Only CSV and PDF files are supported.");
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

  const statusBar       = document.getElementById("status-bar");
  const addMachineBtn   = document.getElementById("add-machine-btn");
  const machineModal    = document.getElementById("machine-modal");
  const modalCloseBtn   = document.getElementById("modal-close-btn");
  const parseFileBtn    = document.getElementById("parse-file-btn");
  const createEmptyMachineBtn = document.getElementById("create-empty-machine-btn");
  const createMachineBtn = document.getElementById("create-machine-btn");
  const parseStatus     = document.getElementById("parse-status");
  const previewWrap     = document.getElementById("preview-wrap");
  const previewTbody    = document.getElementById("preview-tbody");
  const fileInput       = document.getElementById("item-file-input");
  const nameInput       = document.getElementById("machine-name-input");
  const locationInput   = document.getElementById("machine-location-input");
  const restockInput    = document.getElementById("machine-restock-input");
  const machineSearchInput = document.getElementById("machine-search");
  const machineFilterSelect = document.getElementById("machine-filter");
  const machineResultsCount = document.getElementById("machine-results-count");

  let activeDb    = null;
  let parsedItems = [];
  let allMachines = [];

  function applyMachineFilters() {
    const query = String(machineSearchInput.value || "").trim().toLowerCase();
    const selectedStatus = machineFilterSelect.value || "all";

    const filteredMachines = allMachines.filter((machine) => {
      const name = String(machine.name || "").toLowerCase();
      const location = String(machine.location || "").toLowerCase();
      const matchesSearch = !query || name.includes(query) || location.includes(query);
      const matchesStatus = selectedStatus === "all" || statusBucket(machine) === selectedStatus;
      return matchesSearch && matchesStatus;
    });

    const emptyMessage = allMachines.length
      ? "No machines match your search or filter."
      : "No vending machines found.";
    renderMachines(filteredMachines, emptyMessage);

    machineResultsCount.textContent = `${filteredMachines.length} of ${allMachines.length} machine${allMachines.length === 1 ? "" : "s"} shown`;
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

  function setParseStatus(message, isError) {
    parseStatus.textContent = message;
    parseStatus.classList.toggle("error", Boolean(isError));
  }

  function showModal() {
    machineModal.classList.remove("hidden");
    setParseStatus("Upload a CSV/PDF to preview machine items, or create an empty machine.", false);
    previewWrap.classList.add("hidden");
    previewTbody.innerHTML = "";
    createMachineBtn.disabled = true;
    parsedItems = [];
    const today = new Date().toISOString().slice(0, 10);
    if (!restockInput.value) restockInput.value = today;
  }

  function closeModal() {
    machineModal.classList.add("hidden");
  }

  async function deleteMachineAndItems(machineId, machineName) {
    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      statusBar.textContent = "Only admins can delete machines.";
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      statusBar.textContent = "Admin auth session is missing or expired. Please logout and login again as admin.";
      return;
    }
    if (!activeDb) {
      statusBar.textContent = "Firebase is not ready yet. Try again in a moment.";
      return;
    }

    const displayName = machineName || "this machine";
    const confirmed = window.confirm(
      `Delete ${displayName} and all linked items? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      statusBar.textContent = `Deleting ${displayName}...`;

      const itemsSnapshot = await activeDb
        .collection("items")
        .where("machineId", "==", machineId)
        .get();

      const itemDocs = itemsSnapshot.docs;
      const chunkSize = 450;
      for (let i = 0; i < itemDocs.length; i += chunkSize) {
        const batch = activeDb.batch();
        const chunk = itemDocs.slice(i, i + chunkSize);
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      await activeDb.collection("vendingMachines").doc(machineId).delete();
      statusBar.textContent = `Deleted ${displayName} and ${itemDocs.length} linked item${itemDocs.length !== 1 ? "s" : ""}.`;
      await reloadMachines(activeDb, STATIC_MACHINES);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        statusBar.textContent = "Firebase denied delete access. Verify Firestore Rules allow authenticated admin deletes for vendingMachines and items.";
        return;
      }
      statusBar.textContent = err.message || "Failed to delete machine.";
    }
  }

  function renderPreview(items) {
    if (!items.length) {
      previewWrap.classList.add("hidden");
      previewTbody.innerHTML = "";
      return;
    }
    previewTbody.innerHTML = items
      .map((item) => `
        <tr>
          <td>${escapeHtml(item.slotLabel)}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.priceDisplay)}</td>
        </tr>`)
      .join("");
    previewWrap.classList.remove("hidden");
  }

  async function reloadMachines(db, fallbackMachines) {
    try {
      const snapshot = await db.collection("vendingMachines").orderBy("name").get();
      const machines = [];
      snapshot.forEach((doc) => machines.push({ id: doc.id, ...doc.data() }));

      let itemsByMachineId = new Map();
      try {
        const itemSnapshot = await db.collection("items").get();
        itemsByMachineId = new Map();
        itemSnapshot.forEach((doc) => {
          const data = doc.data() || {};
          const machineId = String(data.machineId || "").trim();
          if (!machineId) return;
          if (!itemsByMachineId.has(machineId)) {
            itemsByMachineId.set(machineId, []);
          }
          itemsByMachineId.get(machineId).push(data);
        });
      } catch (itemErr) {
        console.warn("Unable to load items for machine status calculation:", itemErr);
      }

      const sourceMachines = machines.length ? machines : fallbackMachines;
      allMachines = sourceMachines.map((machine) => ({
        ...machine,
        computedStatus: computeMachineStatusFromItems(itemsByMachineId.get(String(machine.id || ""))),
      }));

      applyMachineFilters();
      const src   = machines.length ? "" : " (static preview)";
      const count = machines.length || fallbackMachines.length;
      statusBar.textContent = `${count} machine${count !== 1 ? "s" : ""} loaded${src} · ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      console.error("Firestore error:", err);
      allMachines = fallbackMachines;
      applyMachineFilters();
      statusBar.textContent = `Firestore unavailable — showing static preview · ${new Date().toLocaleTimeString()}`;
    }
  }

  const STATIC_MACHINES = [
    { id: "vm1", name: "Vending Machine 1", location: "Library 2nd", lastRestocked: "2027-02-15", status: "green" },
    { id: "vm2", name: "Vending Machine 2", location: "Library 1st", lastRestocked: "2027-01-09", status: "orange" },
  ];

  const tryLoad = () => {
    if (typeof firebase === "undefined" || !firebase.app) {
      allMachines = STATIC_MACHINES;
      applyMachineFilters();
      statusBar.textContent = `${STATIC_MACHINES.length} machines loaded (static preview) · ${new Date().toLocaleTimeString()}`;
      return;
    }
    try {
      const db = firebase.firestore();
      activeDb = db;
      reloadMachines(db, STATIC_MACHINES);
      loadNotifications(db).catch(console.error);
    } catch (e) {
      console.error(e);
      allMachines = STATIC_MACHINES;
      applyMachineFilters();
      statusBar.textContent = `Firebase not initialized — showing static preview · ${new Date().toLocaleTimeString()}`;
    }
  };

  parseFileBtn.addEventListener("click", async function () {
    const file = fileInput.files && fileInput.files[0];
    if (!file) { setParseStatus("Choose a CSV or PDF file first.", true); return; }

    try {
      parseFileBtn.disabled    = true;
      createMachineBtn.disabled = true;
      setParseStatus("Parsing file...", false);

      const parsed = await parseItemsFile(file);
      if (!parsed.length) {
        parsedItems = [];
        renderPreview([]);
        setParseStatus("No table rows were found. Check the file format and retry.", true);
        return;
      }
      parsedItems = parsed;
      renderPreview(parsedItems);
      createMachineBtn.disabled = false;
      setParseStatus(`Parsed ${parsedItems.length} item rows. Review preview, then create machine.`, false);
    } catch (err) {
      parsedItems = [];
      renderPreview([]);
      setParseStatus(err.message || "Failed to parse file.", true);
    } finally {
      parseFileBtn.disabled = false;
    }
  });

  createEmptyMachineBtn.addEventListener("click", async function () {
    const machineName = nameInput.value.trim();
    const machineLocation = locationInput.value.trim();
    if (!machineName || !machineLocation) {
      setParseStatus("Machine name and location are required.", true);
      return;
    }

    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setParseStatus("Only admins can create machines. Logout and sign in as admin.", true);
      return;
    }
    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setParseStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }
    if (!activeDb) {
      setParseStatus("Firebase is not ready yet. Try again in a moment.", true);
      return;
    }

    const restockDate = restockInput.value
      ? new Date(`${restockInput.value}T00:00:00`)
      : new Date();

    try {
      createEmptyMachineBtn.disabled = true;
      createMachineBtn.disabled = true;
      parseFileBtn.disabled = true;
      setParseStatus("Creating empty machine in Firebase...", false);

      const machineDoc = {
        name: machineName,
        location: machineLocation,
        lastRestocked: firebase.firestore.Timestamp.fromDate(restockDate),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      await activeDb.collection("vendingMachines").add(machineDoc);

      setParseStatus(`Created empty machine ${machineName}.`, false);
      closeModal();
      await reloadMachines(activeDb, STATIC_MACHINES);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        setParseStatus("Firebase denied write access. Verify Firestore Rules allow authenticated admin writes to vendingMachines.", true);
        return;
      }
      setParseStatus(err.message || "Failed to create empty machine in Firebase.", true);
    } finally {
      createEmptyMachineBtn.disabled = false;
      parseFileBtn.disabled = false;
      createMachineBtn.disabled = false;
    }
  });

  createMachineBtn.addEventListener("click", async function () {
    const machineName     = nameInput.value.trim();
    const machineLocation = locationInput.value.trim();
    if (!machineName || !machineLocation) { setParseStatus("Machine name and location are required.", true); return; }

    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setParseStatus("Only admins can create machines. Logout and sign in as admin.", true);
      return;
    }
    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setParseStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }
    if (!parsedItems.length)              { setParseStatus("Parse a file before creating the machine.", true); return; }
    if (!activeDb)                        { setParseStatus("Firebase is not ready yet. Try again in a moment.", true); return; }

    const restockDate = restockInput.value
      ? new Date(`${restockInput.value}T00:00:00`)
      : new Date();

    try {
      createEmptyMachineBtn.disabled = true;
      createMachineBtn.disabled = true;
      parseFileBtn.disabled     = true;
      setParseStatus("Creating machine and uploading items to Firebase...", false);

      const machineDoc = {
        name:          machineName,
        location:      machineLocation,
        lastRestocked: firebase.firestore.Timestamp.fromDate(restockDate),
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
      };

      const machineRef = await activeDb.collection("vendingMachines").add(machineDoc);
      const batch      = activeDb.batch();

      parsedItems.forEach((item) => {
        const itemRef = activeDb.collection("items").doc();
        batch.set(itemRef, {
          machineId:         machineRef.id,
          machineName:       machineName,
          slotLabel:         item.slotLabel,
          name:              item.name,
          price:             item.price,
          priceTbd:          item.priceTbd,
          quantity:          0,
          lowStockThreshold: 5,
          createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
      setParseStatus(`Created ${machineName} with ${parsedItems.length} items.`, false);
      closeModal();
      await reloadMachines(activeDb, STATIC_MACHINES);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        setParseStatus("Firebase denied write access. Verify Firestore Rules allow authenticated admin writes to vendingMachines and items.", true);
        return;
      }
      setParseStatus(err.message || "Failed to create machine in Firebase.", true);
    } finally {
      createEmptyMachineBtn.disabled = false;
      parseFileBtn.disabled     = false;
      createMachineBtn.disabled = false;
    }
  });

  addMachineBtn.addEventListener("click", showModal);
  modalCloseBtn.addEventListener("click", closeModal);
  machineModal.addEventListener("click", function (e) {
    if (e.target === machineModal) closeModal();
  });

  const vmTbody = document.getElementById("vm-tbody");
  vmTbody.addEventListener("click", async function (e) {
    const deleteBtn = e.target.closest(".machine-delete-btn");
    if (deleteBtn) {
      e.stopPropagation();
      const machineId = deleteBtn.getAttribute("data-machine-id") || "";
      const machineName = deleteBtn.getAttribute("data-machine-name") || "this machine";
      if (!machineId) {
        statusBar.textContent = "Unable to determine machine id for delete.";
        return;
      }

      deleteBtn.disabled = true;
      try {
        await deleteMachineAndItems(machineId, machineName);
      } finally {
        deleteBtn.disabled = false;
      }
      return;
    }

    const editBtn = e.target.closest(".btn-edit-item");
    if (editBtn) {
      e.stopPropagation();
      const machineId = editBtn.getAttribute("data-machine-id") || "";
      const machineName = editBtn.getAttribute("data-machine-name") || "";
      const machineLocation = editBtn.getAttribute("data-machine-location") || "";
      if (!machineId) {
        statusBar.textContent = "Unable to determine machine id for edit.";
        return;
      }
      openEditMachineModal(machineId, machineName, machineLocation);
      return;
    }

    const row = e.target.closest("tr[data-id]");
    if (!row) {
      return;
    }

    const id = row.getAttribute("data-id");
    if (id) {
      openMachine(id);
    }
  });

  vmTbody.addEventListener("keydown", function (e) {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const id = row.getAttribute("data-id");
    if (id) {
      openMachine(id);
    }
  });

  machineSearchInput.addEventListener("input", applyMachineFilters);
  machineFilterSelect.addEventListener("change", applyMachineFilters);

  // ── Transaction upload modal ──
  const txnModal        = document.getElementById("txn-modal");
  const txnModalCloseBtn = document.getElementById("txn-modal-close-btn");
  const txnMachineSelect = document.getElementById("txn-machine-select");
  const txnFileInput    = document.getElementById("txn-file-input");
  const txnParseBtn     = document.getElementById("txn-parse-btn");
  const txnApplyBtn     = document.getElementById("txn-apply-btn");
  const txnStatus       = document.getElementById("txn-status");
  const txnPreviewWrap  = document.getElementById("txn-preview-wrap");
  const txnPreviewTbody = document.getElementById("txn-preview-tbody");
  const uploadTxnBtn    = document.getElementById("upload-txn-btn");

  let parsedTxns = [];

  function setTxnStatus(msg, isError) {
    txnStatus.textContent = msg;
    txnStatus.classList.toggle("error", Boolean(isError));
  }

  function refreshTxnApplyButtonState() {
    txnApplyBtn.disabled = !(parsedTxns.length && txnMachineSelect.value);
  }

  async function populateTxnMachineOptions() {
    let machines = [];

    if (activeDb) {
      try {
        const snapshot = await activeDb.collection("vendingMachines").orderBy("name").get();
        snapshot.forEach((doc) => machines.push({ id: doc.id, ...doc.data() }));
      } catch (err) {
        console.error("Failed to load machine options:", err);
      }
    }

    if (!machines.length) {
      machines = STATIC_MACHINES.slice();
    }

    const previousValue = txnMachineSelect.value;
    txnMachineSelect.innerHTML = '<option value="">Select a vending machine</option>';
    machines.forEach((machine) => {
      const option = document.createElement("option");
      option.value = machine.id;
      option.textContent = machine.name || machine.location || machine.id;
      txnMachineSelect.appendChild(option);
    });

    if (previousValue && machines.some((m) => m.id === previousValue)) {
      txnMachineSelect.value = previousValue;
    } else {
      txnMachineSelect.value = "";
    }
  }

  async function openTxnModal() {
    txnModal.classList.remove("hidden");
    setTxnStatus("Upload a CSV/PDF to preview transaction updates.", false);
    txnPreviewWrap.classList.add("hidden");
    txnPreviewTbody.innerHTML = "";
    parsedTxns = [];
    txnFileInput.value = "";
    await populateTxnMachineOptions();
    refreshTxnApplyButtonState();
  }

  function closeTxnModal() {
    txnModal.classList.add("hidden");
  }

  function parseTxnCsv(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    const header      = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const dateCol     = header.findIndex(h => h === "transactiondate" || h === "date" || h === "trandate");
    const locationCol = header.findIndex(h => h === "location" || h === "machinelocation" || h === "machine");
    const amountCol   = header.findIndex(h => h === "tranamt" || h === "amount" || h === "transactionamount" || h === "amt");

    if (dateCol === -1 || locationCol === -1 || amountCol === -1) {
      throw new Error("CSV must include date, location, and transaction amount columns.");
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
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
    if (!file) { setTxnStatus("Choose a CSV or PDF file first.", true); return; }

    try {
      txnParseBtn.disabled = true;
      setTxnStatus("Parsing file…", false);
      const rows = await parseTxnFile(file);
      if (!rows.length) {
        parsedTxns = [];
        txnPreviewWrap.classList.add("hidden");
        refreshTxnApplyButtonState();
        setTxnStatus("No valid rows found. Verify the report includes date, location, and transaction amount.", true);
        return;
      }

      // Load selected machine items to determine mappings
      let buckets = new Map();
      const selectedMachineId = String(txnMachineSelect.value || "").trim();
      if (selectedMachineId) {
        try {
          const itemSnapshot = await activeDb
            .collection("items")
            .where("machineId", "==", selectedMachineId)
            .get();

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
        } catch (err) {
          console.error("Failed to load machine items for mapping preview:", err);
        }
      }

      parsedTxns = rows;
      txnPreviewTbody.innerHTML = rows.map(r => {
        let mappedTo = "Select a machine";
        if (selectedMachineId) {
          const priceCents = Math.round(r.amount * 100);
          const candidates = buckets.get(priceCents) || [];
          const matchedItem = candidates.length > 0 ? candidates[0] : null;
          mappedTo = matchedItem ? `${escapeHtml(matchedItem.name)} (${escapeHtml(matchedItem.slotLabel)})` : "No matching item";
        }
        return `<tr><td>${escapeHtml(r.transactionDate)}</td><td>$${r.amount.toFixed(2)}</td><td>${mappedTo}</td></tr>`;
      }).join("");
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

  txnMachineSelect.addEventListener("change", async function () {
    refreshTxnApplyButtonState();
    
    // Re-render preview if transactions are already parsed
    if (parsedTxns.length > 0) {
      let buckets = new Map();
      const selectedMachineId = String(txnMachineSelect.value || "").trim();
      if (selectedMachineId) {
        try {
          const itemSnapshot = await activeDb
            .collection("items")
            .where("machineId", "==", selectedMachineId)
            .get();

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
        } catch (err) {
          console.error("Failed to load machine items for mapping preview:", err);
        }
      }

      txnPreviewTbody.innerHTML = parsedTxns.map(r => {
        let mappedTo = "Select a machine";
        if (selectedMachineId) {
          const priceCents = Math.round(r.amount * 100);
          const candidates = buckets.get(priceCents) || [];
          const matchedItem = candidates.length > 0 ? candidates[0] : null;
          mappedTo = matchedItem ? `${escapeHtml(matchedItem.name)} (${escapeHtml(matchedItem.slotLabel)})` : "No matching item";
        }
        return `<tr><td>${escapeHtml(r.transactionDate)}</td><td>$${r.amount.toFixed(2)}</td><td>${mappedTo}</td></tr>`;
      }).join("");
    }
  });

  txnApplyBtn.addEventListener("click", async function () {
    if (!parsedTxns.length) { setTxnStatus("Parse a file first.", true); return; }
    if (!activeDb)          { setTxnStatus("Firebase is not ready. Try again in a moment.", true); return; }
    const selectedMachineId = String(txnMachineSelect.value || "").trim();
    if (!selectedMachineId) {
      setTxnStatus("Select a vending machine to update.", true);
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
      setTxnStatus("Applying transactions…", false);
      const selectedMachineLabel =
        txnMachineSelect.options[txnMachineSelect.selectedIndex] &&
        txnMachineSelect.options[txnMachineSelect.selectedIndex].textContent
          ? txnMachineSelect.options[txnMachineSelect.selectedIndex].textContent
          : "selected machine";

      const machineItemCache = new Map();
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

      async function getMachineItemBuckets(machineId) {
        if (machineItemCache.has(machineId)) {
          return machineItemCache.get(machineId);
        }

        const itemSnapshot = await activeDb
          .collection("items")
          .where("machineId", "==", machineId)
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
            machineId: String(data.machineId || machineId),
            machineName: String(data.machineName || selectedMachineLabel),
            lowStockThreshold: typeof data.lowStockThreshold === "number" ? data.lowStockThreshold : 5,
          });
        });

        buckets.forEach((arr) => {
          arr.sort((a, b) => a.slotLabel.localeCompare(b.slotLabel));
        });

        machineItemCache.set(machineId, buckets);
        return buckets;
      }

      const selectedMachineBuckets = await getMachineItemBuckets(selectedMachineId);
      const txnPriceSet = new Set(
        parsedTxns.map((txn) => Math.round(Number(txn.amount || 0) * 100)),
      );
      const overlappingPriceCount = Array.from(txnPriceSet).filter((priceCents) =>
        selectedMachineBuckets.has(priceCents),
      ).length;

      if (overlappingPriceCount === 0) {
        setTxnStatus(
          `No item prices in ${selectedMachineLabel} match any parsed transaction amounts.`,
          true,
        );
        return;
      }

      // Find prices that don't match any items in the machine
      const unmatchedPrices = Array.from(txnPriceSet).filter((priceCents) => !selectedMachineBuckets.has(priceCents));
      if (unmatchedPrices.length > 0) {
        const unmatchedPricesFormatted = unmatchedPrices
          .map((cents) => `$${(cents / 100).toFixed(2)}`)
          .sort();
        const priceMessage = unmatchedPricesFormatted.join(", ");
        const confirmApply = window.confirm(
          `Warning: The following price${unmatchedPrices.length !== 1 ? "s" : ""} from the transaction file do not match any items in ${selectedMachineLabel}:\n\n${priceMessage}\n\nDo you want to continue applying the matching transactions?`,
        );
        if (!confirmApply) {
          setTxnStatus("Transaction application cancelled.", false);
          return;
        }
      }

      for (const txn of parsedTxns) {
        const priceCents = Math.round(txn.amount * 100);
        const candidates = selectedMachineBuckets.get(priceCents) || [];
        const targetItem = candidates.find((item) => item.quantity > 0);
        if (!targetItem) {
          txnAuditRows.push({
            transactionDate: txn.transactionDate || null,
            amount: txn.amount || null,
            itemId: null,
            machineId: selectedMachineId,
            machineName: selectedMachineLabel,
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
          machineId: targetItem.machineId || selectedMachineId,
          machineName: targetItem.machineName || selectedMachineLabel,
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

      const notifItems = Array.from(updatedItemRefs.values()).map((u) => ({
        id: u.id,
        name: u.name,
        machineId: u.machineId,
        machineName: u.machineName,
        oldQuantity: u.originalQuantity,
        newQuantity: u.quantity,
        lowStockThreshold: u.lowStockThreshold,
      }));
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
              machineId: t.machineId || selectedMachineId,
              machineName: t.machineName || selectedMachineLabel,
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
        `Applied ${matched} transaction${matched !== 1 ? "s" : ""} to ${selectedMachineLabel}. Unmatched price: ${unmatchedPrice}.`,
        false,
      );
      closeTxnModal();
      await reloadMachines(activeDb, STATIC_MACHINES);
      await checkItemNotifications(activeDb, selectedMachineId);
      loadNotifications(activeDb).catch(console.error);
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

  // ── Edit Machine Modal ──
  const editMachineModal = document.getElementById("edit-machine-modal");
  const editMachineModalCloseBtn = document.getElementById("edit-machine-modal-close-btn");
  const editMachineNameInput = document.getElementById("edit-machine-name-input");
  const editMachineLocationInput = document.getElementById("edit-machine-location-input");
  const editMachineSaveBtn = document.getElementById("edit-machine-save-btn");
  const editMachineStatus = document.getElementById("edit-machine-status");

  let editingMachineId = null;

  function setEditMachineStatus(message, isError) {
    editMachineStatus.textContent = message;
    editMachineStatus.classList.toggle("error", Boolean(isError));
  }

  function openEditMachineModal(machineId, machineName, machineLocation) {
    editingMachineId = machineId;
    editMachineNameInput.value = machineName;
    editMachineLocationInput.value = machineLocation;
    setEditMachineStatus("Update machine details below.", false);
    editMachineModal.classList.remove("hidden");
  }

  function closeEditMachineModal() {
    editMachineModal.classList.add("hidden");
    editingMachineId = null;
    editMachineNameInput.value = "";
    editMachineLocationInput.value = "";
  }

  editMachineModalCloseBtn.addEventListener("click", closeEditMachineModal);
  editMachineModal.addEventListener("click", function (e) {
    if (e.target === editMachineModal) closeEditMachineModal();
  });

  editMachineSaveBtn.addEventListener("click", async function () {
    if (!editingMachineId) {
      setEditMachineStatus("No machine selected for editing.", true);
      return;
    }

    const machineName = editMachineNameInput.value.trim();
    const machineLocation = editMachineLocationInput.value.trim();

    if (!machineName || !machineLocation) {
      setEditMachineStatus("Machine name and location are required.", true);
      return;
    }

    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      setEditMachineStatus("Only admins can edit machines.", true);
      return;
    }

    const hasAdminSession = await waitForAdminAuthSession();
    if (!hasAdminSession) {
      setEditMachineStatus("Admin auth session is missing or expired. Please logout and login again as admin.", true);
      return;
    }

    if (!activeDb) {
      setEditMachineStatus("Firebase is not ready yet. Try again in a moment.", true);
      return;
    }

    try {
      editMachineSaveBtn.disabled = true;
      setEditMachineStatus("Saving changes...", false);

      await activeDb.collection("vendingMachines").doc(editingMachineId).update({
        name: machineName,
        location: machineLocation,
      });

      setEditMachineStatus("Machine updated successfully.", false);
      closeEditMachineModal();
      await reloadMachines(activeDb, STATIC_MACHINES);
    } catch (err) {
      console.error(err);
      if (err && err.code === "permission-denied") {
        setEditMachineStatus("Firebase denied write access. Verify Firestore Rules allow authenticated admin writes to vendingMachines.", true);
        return;
      }
      setEditMachineStatus(err.message || "Failed to update machine.", true);
    } finally {
      editMachineSaveBtn.disabled = false;
    }
  });

  tryLoad();

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
  // Hide or show notifications UI after admin session is established
  if (typeof waitForAdminAuthSession === "function") {
    waitForAdminAuthSession().then((isAdmin) => {
      if (!isAdmin) {
        if (notifBtn) notifBtn.style.display = "none";
        if (notifPanel) notifPanel.style.display = "none";
      } else {
        if (notifBtn) notifBtn.style.display = "inline-block";
        if (notifPanel) notifPanel.style.display = "";
        // if an admin, ensure notifications are loaded
        try { if (activeDb) loadNotifications(activeDb).catch(console.error); } catch (e) {}
      }
    });
  } else {
    if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
      if (notifBtn) notifBtn.style.display = "none";
      if (notifPanel) notifPanel.style.display = "none";
    }
  }

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

  function renderNotifications(notifications) {
    const list = document.getElementById("notif-list");
    if (!list) return;
    if (!notifications.length) {
      list.innerHTML = '<div class="notif-empty">No notifications.</div>';
      return;
    }
    const isAdmin = window.vmitAuth && window.vmitAuth.getRole() === "admin";
    list.innerHTML = notifications.map((n) => {
      let cssClass, title, body;
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
        let expStr = "";
        if (n.expirationDate) {
          const expD = n.expirationDate.toDate ? n.expirationDate.toDate() : new Date(n.expirationDate);
          expStr = " — expired " + expD.toLocaleDateString();
        }
        body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine") + escapeHtml(expStr);
      } else {
        cssClass = "notif-warn"; title = n.type || "Notification";
        body = escapeHtml(n.itemName || "Item") + " in " + escapeHtml(n.machineName || "machine");
      }
      const ts = n.createdAt
        ? (n.createdAt.toDate ? n.createdAt.toDate() : new Date(n.createdAt)).toLocaleString()
        : "";
      const dismissBtn = isAdmin
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

  async function createStockNotifications(db, items) {
    const toCreate = [];
    items.forEach((item) => {
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
    toCreate.forEach(({ type, item }) => {
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

  async function loadNotifications(db) {
    try {
      // Ensure admin auth session is established before loading notifications
      if (typeof waitForAdminAuthSession === "function") {
        const isAdmin = await waitForAdminAuthSession();
        if (!isAdmin) {
          const list = document.getElementById("notif-list");
          if (list) list.innerHTML = '<div class="notif-empty">No notifications.</div>';
          return;
        }
      } else if (window.vmitAuth && window.vmitAuth.getRole() !== "admin") {
        const list = document.getElementById("notif-list");
        if (list) list.innerHTML = '<div class="notif-empty">No notifications.</div>';
        return;
      }
      const snapshot = await db.collection("notifications").limit(30).get();
      const notifs = [];
      snapshot.forEach((d) => notifs.push(Object.assign({ id: d.id }, d.data())));
      notifs.sort((a, b) => {
        const aT = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
        const bT = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
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
      itemsSnap.forEach((d) => items.push(Object.assign({ id: d.id }, d.data())));

      const existingKeys = new Set();
      existingSnap.forEach((d) => {
        const data = d.data();
        if (data.type === "price_conflict" || data.type === "expired") {
          existingKeys.add(data.itemId + "_" + data.type);
        }
      });

      const now = new Date();
      const toCreate = [];

      const priceGroups = {};
      items.forEach((item) => {
        if (item.priceTbd || !item.price) return;
        const key = String(item.price);
        if (!priceGroups[key]) priceGroups[key] = [];
        priceGroups[key].push(item);
      });
      Object.keys(priceGroups).forEach((key) => {
        const group = priceGroups[key];
        if (group.length < 2) return;
        group.forEach((item) => {
          if (!existingKeys.has(item.id + "_price_conflict")) {
            toCreate.push({ type: "price_conflict", item, extra: { price: item.price } });
          }
        });
      });

      items.forEach((item) => {
        if (!item.expirationDate) return;
        const expDate = item.expirationDate.toDate ? item.expirationDate.toDate() : new Date(item.expirationDate);
        if (expDate < now && !existingKeys.has(item.id + "_expired")) {
          toCreate.push({ type: "expired", item, extra: { expirationDate: item.expirationDate } });
        }
      });

      if (!toCreate.length) return;

      const batch = db.batch();
      toCreate.forEach((entry) => {
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
});
