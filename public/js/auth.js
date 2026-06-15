/* Shared auth/session helpers for guest and admin access */
(function () {
  const ROLE_KEY = "vmitRole";
  const EMAIL_KEY = "vmitAdminEmail";

  function getRole() {
    return sessionStorage.getItem(ROLE_KEY);
  }

  function getAdminEmail() {
    return sessionStorage.getItem(EMAIL_KEY);
  }

  function setRole(role, email) {
    sessionStorage.setItem(ROLE_KEY, role);
    if (email) {
      sessionStorage.setItem(EMAIL_KEY, email);
    } else {
      sessionStorage.removeItem(EMAIL_KEY);
    }
  }

  function clearRole() {
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
  }

  function ensureAccessOrRedirect() {
    const role = getRole();
    if (role !== "guest" && role !== "admin") {
      window.location.replace("login.html");
      return false;
    }
    return true;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function applyRoleToUi() {
    const role = getRole();
    const isAdmin = role === "admin";
    const roleLabel = isAdmin ? "Admin" : "Guest";

    setText("role-badge", roleLabel);

    const emailEl = document.getElementById("user-email");
    if (emailEl) {
      emailEl.textContent = isAdmin && getAdminEmail() ? getAdminEmail() : "—";
    }

    const permEl = document.getElementById("user-permission");
    if (permEl) {
      permEl.textContent = isAdmin ? "Admin" : "Guest (Read-only)";
      permEl.classList.toggle("is-admin", isAdmin);
    }

    document.querySelectorAll("[data-edit-only]").forEach((el) => {
      if (isAdmin) {
        el.classList.remove("read-only-locked");
        el.disabled = false;
        el.removeAttribute("aria-disabled");
        if (el.dataset.originalTitle) {
          el.title = el.dataset.originalTitle;
        }
      } else {
        el.classList.add("read-only-locked");
        el.disabled = true;
        el.setAttribute("aria-disabled", "true");
        if (!el.dataset.originalTitle) {
          el.dataset.originalTitle = el.title || "";
        }
        el.title = "Guest users cannot edit";
      }
    });
  }

  function attachLogoutButton() {
    const logoutBtn = document.getElementById("logout-btn");
    if (!logoutBtn) {
      return;
    }

    logoutBtn.addEventListener("click", async function () {
      clearRole();
      if (typeof firebase !== "undefined" && firebase.auth) {
        try {
          await firebase.auth().signOut();
        } catch (err) {
          console.warn("Firebase sign-out failed:", err);
        }
      }
      window.location.replace("login.html");
    });
  }

  async function loginAsAdmin(email, password) {
    if (
      typeof firebase === "undefined" ||
      !firebase.auth ||
      typeof firebase.auth !== "function"
    ) {
      throw new Error("Firebase Auth is not available yet. Please try again.");
    }

    const credential = await firebase
      .auth()
      .signInWithEmailAndPassword(email, password);

    const finalEmail = (credential.user && credential.user.email) || email;
    setRole("admin", finalEmail);
    return credential;
  }

  async function continueAsGuest() {
    setRole("guest");
    if (typeof firebase !== "undefined" && firebase.auth) {
      try {
        await firebase.auth().signOut();
      } catch (err) {
        console.warn("Guest mode sign-out warning:", err);
      }
    }
  }

  window.vmitAuth = {
    getRole,
    getAdminEmail,
    setRole,
    clearRole,
    ensureAccessOrRedirect,
    applyRoleToUi,
    attachLogoutButton,
    loginAsAdmin,
    continueAsGuest,
  };
})();