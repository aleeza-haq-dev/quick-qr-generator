const SUPABASE_URL = "https://jsqtessrfhijisfswauu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_p4CRocwzm4Mvvfl8igM6sQ_ZYMqWi7N";
/* ==========================================================================
   Quick QR – script.js
   Vanilla JavaScript. Uses the Supabase JS client (auth + database) and the
   node-qrcode browser bundle, both loaded from CDNs in index.html.

   TABLE OF CONTENTS
   1. Configuration  (Supabase URL + public key go here)
   2. Database setup notes (SQL to run once in Supabase)
   3. App code       (state, helpers, auth, QR generator, saved QR codes)
   ========================================================================== */


/* ==========================================================================
   1. CONFIGURATION  ← CONNECT SUPABASE HERE
   --------------------------------------------------------------------------
   In your Supabase dashboard open:  Project Settings → API
     • Project URL           → paste into SUPABASE_URL
     • anon / publishable key → paste into SUPABASE_ANON_KEY

   ONLY use the public "anon" / "publishable" key in the browser.
   NEVER paste a "service_role" or "secret" key here – anyone can read this file.
   Your data stays private because of Row Level Security (see section 2).
   ========================================================================== */
    // the public anon / publishable key

// Name of the database table that stores QR codes.
const QR_TABLE = "qr_codes";

// Where Supabase sends people after they click a link in a verification or
// password-reset email. This exact address must be listed in:
// Supabase → Authentication → URL Configuration → Redirect URLs.
// (Email links need the page to be served over http(s), not opened as a file.)
const AUTH_REDIRECT_URL = window.location.protocol.startsWith("http")
  ? window.location.origin + window.location.pathname
  : undefined;


/* ==========================================================================
   2. DATABASE SETUP NOTES
   --------------------------------------------------------------------------
   Run this once in Supabase → SQL Editor. It creates the "qr_codes" table and
   Row Level Security (RLS) policies so every user can only see, add, and
   delete THEIR OWN rows.

   create table public.qr_codes (
     id          uuid primary key default gen_random_uuid(),
     user_id     uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
     title       text not null,
     content     text not null,
     created_at  timestamptz not null default now()
   );

   alter table public.qr_codes enable row level security;

   create policy "Users can read their own QR codes"
     on public.qr_codes for select to authenticated
     using ((select auth.uid()) = user_id);

   create policy "Users can add their own QR codes"
     on public.qr_codes for insert to authenticated
     with check ((select auth.uid()) = user_id);

   create policy "Users can delete their own QR codes"
     on public.qr_codes for delete to authenticated
     using ((select auth.uid()) = user_id);
   ========================================================================== */


/* ==========================================================================
   3. APP CODE
   Everything below lives inside one function so nothing leaks into the
   global scope.
   ========================================================================== */
(() => {
  "use strict";

  /* ------------------------------------------------------------------------
     Settings you may want to change
     ------------------------------------------------------------------------ */
  const MIN_PASSWORD_LENGTH = 8;       // client-side minimum for new passwords
  const MAX_CONTENT_LENGTH = 1000;     // must match maxlength on #qr-content
  const MAX_TITLE_LENGTH = 80;         // must match maxlength on #qr-title
  const MIN_COLOR_CONTRAST = 3;        // below this, a QR code is unlikely to scan
  const SAVED_THUMB_SIZE = 144;        // pixel size of thumbnails in "My QR codes"
  const SAVED_DOWNLOAD_SIZE = 512;     // pixel size of PNGs downloaded from the list
  const MESSAGE_AUTO_HIDE_MS = 6000;   // how long success messages stay visible

  const CONFIG_ERROR_MESSAGE =
    "Supabase is not connected yet. Add your project URL and public key at the top of script.js.";

  /* ------------------------------------------------------------------------
     App state: the only "global" data, kept in one place
     ------------------------------------------------------------------------ */
  const state = {
    supabase: null,            // Supabase client (stays null until configured)
    user: null,                // signed-in Supabase user, or null
    currentView: "home",       // "home" or "dashboard"
    authMode: "login",         // "login" | "signup" | "forgot" | "update-password"
    isRecoveryFlow: false,     // true while the user is choosing a new password
    pendingRedirect: null,     // info read from the URL after clicking an email link
    lastFocusedElement: null,  // where to return focus when the modal closes
    currentQr: null,           // { title, content } of the QR shown in the preview
    savedQrCodes: [],          // the signed-in user's saved QR codes
    savedCount: 0,             // number of saved QR codes
    savedLoadFailed: false,    // true if the last fetch failed
    messageTimers: new Map()   // auto-hide timers for messages
  };

  /* ------------------------------------------------------------------------
     DOM references: every element script.js touches, by its id in index.html
     ------------------------------------------------------------------------ */
  const ELEMENT_IDS = {
    // Header
    logoLink: "logo-link",
    loginBtn: "login-btn",
    signupBtn: "signup-btn",
    logoutBtn: "logout-btn",
    globalMessage: "global-message",

    // Views and home page
    homeView: "home-view",
    dashboardView: "dashboard-view",
    heroGuestActions: "hero-guest-actions",
    heroUserActions: "hero-user-actions",
    heroSignupBtn: "hero-signup-btn",
    heroLoginBtn: "hero-login-btn",
    heroDashboardBtn: "hero-dashboard-btn",

    // Dashboard summary
    userEmail: "user-email",
    savedCount: "saved-count",

    // QR generator
    qrForm: "qr-form",
    qrTitle: "qr-title",
    qrContent: "qr-content",
    qrSize: "qr-size",
    qrFgColor: "qr-fg-color",
    qrFgValue: "qr-fg-value",
    qrBgColor: "qr-bg-color",
    qrBgValue: "qr-bg-value",
    qrSaveToggle: "qr-save-toggle",
    generateBtn: "generate-btn",
    clearBtn: "clear-btn",
    generatorMessage: "generator-message",
    qrPreview: "qr-preview",
    qrEmptyState: "qr-empty-state",
    qrCanvas: "qr-canvas",
    downloadBtn: "download-btn",
    copyBtn: "copy-btn",

    // My QR codes
    savedMessage: "saved-message",
    savedLoading: "saved-loading",
    savedEmptyState: "saved-empty-state",
    savedList: "saved-list",
    savedTemplate: "saved-item-template",

    // Authentication modal
    authModal: "auth-modal",
    authBackdrop: "auth-backdrop",
    authPanel: "auth-panel",
    authCloseBtn: "auth-close-btn",
    authTitle: "auth-title",
    authSubtitle: "auth-subtitle",
    authMessage: "auth-message",

    loginForm: "login-form",
    loginEmail: "login-email",
    loginPassword: "login-password",
    loginSubmitBtn: "login-submit-btn",
    forgotPasswordBtn: "forgot-password-btn",
    showSignupBtn: "show-signup-btn",

    signupForm: "signup-form",
    signupEmail: "signup-email",
    signupPassword: "signup-password",
    signupConfirmPassword: "signup-confirm-password",
    signupSubmitBtn: "signup-submit-btn",
    showLoginBtn: "show-login-btn",

    forgotForm: "forgot-form",
    forgotEmail: "forgot-email",
    forgotSubmitBtn: "forgot-submit-btn",
    backToLoginBtn: "back-to-login-btn",

    updatePasswordForm: "update-password-form",
    newPassword: "new-password",
    newConfirmPassword: "new-confirm-password",
    updatePasswordSubmitBtn: "update-password-submit-btn",

    // Footer
    footerYear: "footer-year"
  };

  const els = {};

  // The four panels inside the authentication modal
  const AUTH_PANELS = {
    login: {
      form: "loginForm",
      firstField: "loginEmail",
      title: "Log in",
      subtitle: "Welcome back. Enter your details to continue."
    },
    signup: {
      form: "signupForm",
      firstField: "signupEmail",
      title: "Create your account",
      subtitle: "Save, manage, and download all your QR codes."
    },
    forgot: {
      form: "forgotForm",
      firstField: "forgotEmail",
      title: "Reset your password",
      subtitle: "Enter your email and we will send you a link to choose a new password."
    },
    "update-password": {
      form: "updatePasswordForm",
      firstField: "newPassword",
      title: "Choose a new password",
      subtitle: "Enter a new password for your account."
    }
  };


  /* ==========================================================================
     SMALL HELPERS (all safe to call even if an element is missing)
     ========================================================================== */

  /** Finds every element listed in ELEMENT_IDS and warns about missing ones. */
  function cacheElements() {
    const missing = [];

    Object.entries(ELEMENT_IDS).forEach(([key, id]) => {
      els[key] = document.getElementById(id);
      if (!els[key]) missing.push(id);
    });

    els.navLinks = Array.from(document.querySelectorAll(".nav-link"));

    if (missing.length > 0) {
      console.warn("Quick QR: these ids were not found in index.html:", missing.join(", "));
    }
  }

  function show(el) {
    if (el) el.classList.remove("hidden");
  }

  function hide(el) {
    if (el) el.classList.add("hidden");
  }

  function toggle(el, isVisible) {
    if (isVisible) show(el);
    else hide(el);
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function readValue(el) {
    return el ? el.value : "";
  }

  /** Adds an event listener only if the element exists. */
  function on(el, eventName, handler) {
    if (el) el.addEventListener(eventName, handler);
  }

  /**
   * Shows a message in one of the message areas.
   * type: "error" | "success" | "info"  (CSS colors them via data-type)
   */
  function showMessage(el, text, type = "info", { autoHide = false } = {}) {
    if (!el) return;

    window.clearTimeout(state.messageTimers.get(el));

    el.textContent = text;
    el.dataset.type = type;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    show(el);

    if (autoHide) {
      const timer = window.setTimeout(() => clearMessage(el), MESSAGE_AUTO_HIDE_MS);
      state.messageTimers.set(el, timer);
    }
  }

  function clearMessage(el) {
    if (!el) return;

    window.clearTimeout(state.messageTimers.get(el));
    el.textContent = "";
    delete el.dataset.type;
    hide(el);
  }

  /** Disables a button and swaps its label while an action is running. */
  function setButtonBusy(button, isBusy, busyText) {
    if (!button) return;

    if (isBusy) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
      button.disabled = false;
    }
  }

  /** Marks an input as invalid (red border) and moves focus to it. */
  function markInvalid(input) {
    if (!input) return;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }

  function clearInvalidFields(container) {
    if (!container) return;
    container.querySelectorAll("[aria-invalid]").forEach((field) => {
      field.removeAttribute("aria-invalid");
    });
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isNetworkError(error) {
    const message = error && error.message ? error.message.toLowerCase() : "";
    return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("network request failed");
  }

  /** Turns a Supabase auth error into a short, friendly sentence. */
  function friendlyAuthError(error) {
    const message = error && error.message ? error.message : "Something went wrong. Please try again.";
    const lower = message.toLowerCase();

    if (isNetworkError(error)) {
      return "Could not reach the server. Check your internet connection and try again.";
    }
    if (lower.includes("invalid login credentials")) {
      return "Incorrect email or password. Check your details and try again.";
    }
    if (lower.includes("email not confirmed")) {
      return "Your email is not verified yet. Open the verification link we sent you, then log in.";
    }
    if (lower.includes("already registered")) {
      return "An account with this email already exists. Try logging in instead.";
    }
    if (lower.includes("rate limit") || (error && error.status === 429)) {
      return "Too many attempts. Please wait a few minutes and try again.";
    }
    return message;
  }

  /** Turns a Supabase database error into a short, friendly sentence. */
  function friendlyDbError(error) {
    const message = error && error.message ? error.message : "Something went wrong. Please try again.";
    const lower = message.toLowerCase();

    if (isNetworkError(error)) {
      return "Could not reach the server. Check your internet connection and try again.";
    }
    if (
      (error && (error.code === "PGRST205" || error.code === "42P01")) ||
      lower.includes("could not find the table")
    ) {
      return 'The "qr_codes" table was not found. Create it in Supabase first (see the setup notes at the top of script.js).';
    }
    if (lower.includes("row-level security")) {
      return "Supabase blocked this action. Check the Row Level Security policies for the qr_codes table.";
    }
    return message;
  }

  /** Returns true if Supabase is ready; otherwise shows a message and returns false. */
  function requireSupabase(messageEl) {
    if (state.supabase) return true;
    showMessage(messageEl, CONFIG_ERROR_MESSAGE, "error");
    return false;
  }


  /* ==========================================================================
     VIEWS (Home / Dashboard)
     The dashboard is only ever displayed when state.user exists.
     NOTE: hiding it in the browser is just for the interface. Your real
     protection is Row Level Security in Supabase, which enforces access on
     the server.
     ========================================================================== */

  function setView(viewName) {
    if (viewName === "dashboard" && !state.user) {
      openAuthModal("login", { message: "Log in to open your dashboard.", type: "info" });
      return;
    }

    state.currentView = viewName === "dashboard" ? "dashboard" : "home";
    renderView();
    window.scrollTo(0, 0);
  }

  function renderView() {
    const showDashboard = state.currentView === "dashboard" && Boolean(state.user);

    toggle(els.dashboardView, showDashboard);
    toggle(els.homeView, !showDashboard);

    const activeView = showDashboard ? "dashboard" : "home";
    els.navLinks.forEach((link) => {
      if (link.dataset.view === activeView) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  /** Updates every part of the page that depends on being logged in or out. */
  function renderAuthState() {
    const isLoggedIn = Boolean(state.user);

    toggle(els.loginBtn, !isLoggedIn);
    toggle(els.signupBtn, !isLoggedIn);
    toggle(els.logoutBtn, isLoggedIn);

    toggle(els.heroGuestActions, !isLoggedIn);
    toggle(els.heroUserActions, isLoggedIn);

    setText(els.userEmail, isLoggedIn ? state.user.email : "");

    if (!isLoggedIn) state.currentView = "home";
    renderView();
  }


  /* ==========================================================================
     AUTHENTICATION MODAL
     ========================================================================== */

  function isAuthModalOpen() {
    return Boolean(els.authModal) && !els.authModal.classList.contains("hidden");
  }

  /** Opens the modal on a panel: "login", "signup", "forgot" or "update-password". */
  function openAuthModal(mode = "login", { message, type } = {}) {
    if (!els.authModal) return;

    if (!isAuthModalOpen()) state.lastFocusedElement = document.activeElement;

    show(els.authModal);
    document.body.classList.add("modal-open");
    setAuthMode(mode);

    if (message) {
      showMessage(els.authMessage, message, type || "info");
    } else if (!state.supabase) {
      showMessage(els.authMessage, CONFIG_ERROR_MESSAGE, "error");
    }
  }

  function closeAuthModal() {
    if (!isAuthModalOpen()) return;

    hide(els.authModal);
    document.body.classList.remove("modal-open");

    // Clear typed passwords and any leftover messages
    [els.loginForm, els.signupForm, els.forgotForm, els.updatePasswordForm].forEach((form) => {
      if (form) form.reset();
    });
    clearMessage(els.authMessage);
    clearInvalidFields(els.authModal);
    state.isRecoveryFlow = false;

    // Return focus to whatever opened the modal
    if (state.lastFocusedElement && document.contains(state.lastFocusedElement)) {
      state.lastFocusedElement.focus();
    }
    state.lastFocusedElement = null;
  }

  /** Switches which form is visible inside the modal. */
  function setAuthMode(mode, { keepMessage = false } = {}) {
    state.authMode = AUTH_PANELS[mode] ? mode : "login";
    const panel = AUTH_PANELS[state.authMode];

    Object.entries(AUTH_PANELS).forEach(([name, config]) => {
      toggle(els[config.form], name === state.authMode);
    });

    setText(els.authTitle, panel.title);
    setText(els.authSubtitle, panel.subtitle);

    if (!keepMessage) clearMessage(els.authMessage);
    clearInvalidFields(els.authModal);

    if (isAuthModalOpen() && els[panel.firstField]) els[panel.firstField].focus();
  }

  /** Keeps Tab / Shift+Tab inside the open modal. */
  function trapFocusInModal(event) {
    if (event.key !== "Tab" || !els.authPanel) return;

    const focusable = Array.from(
      els.authPanel.querySelectorAll("button:not([disabled]), input:not([disabled]), a[href]")
    ).filter((element) => !element.closest(".hidden"));

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleDocumentKeydown(event) {
    if (event.key === "Escape" && isAuthModalOpen()) closeAuthModal();
    if (isAuthModalOpen()) trapFocusInModal(event);
  }


  /* ==========================================================================
     SUPABASE: setup and authentication
     ========================================================================== */

  /** Very small safety check: refuses to run with a secret / service-role key. */
  function looksLikeSecretKey(key) {
    if (key.startsWith("sb_secret_")) return true;

    try {
      const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(window.atob(payload)).role === "service_role";
    } catch (error) {
      return false; // not a JWT, so it is not the old-style service-role key
    }
  }

  /** Creates the Supabase client, if the configuration at the top is filled in. */
  function initSupabase() {
    const isConfigured =
      SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      !SUPABASE_URL.startsWith("YOUR_") &&
      !SUPABASE_ANON_KEY.startsWith("YOUR_");

    if (!isConfigured) {
      showMessage(els.globalMessage, CONFIG_ERROR_MESSAGE, "error");
      return;
    }

    if (looksLikeSecretKey(SUPABASE_ANON_KEY)) {
      showMessage(
        els.globalMessage,
        "That looks like a secret (service-role) key. Never use it in the browser. Use the public anon / publishable key instead.",
        "error"
      );
      return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showMessage(
        els.globalMessage,
        "The Supabase library could not be loaded. Check your internet connection and reload the page.",
        "error"
      );
      return;
    }

    // The client keeps the login session in the browser (never the password).
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  /**
   * Reads what Supabase put in the address after someone clicked an email link
   * (verification, password reset) or when that link failed.
   * Must run BEFORE the Supabase client starts, because the client removes
   * these values from the address bar once it has used them.
   */
  function readAuthRedirect() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    const read = (key) => hashParams.get(key) || queryParams.get(key);

    return {
      type: read("type"),
      error: read("error"),
      errorDescription: read("error_description")
    };
  }

  /** Removes leftover auth values (tokens, errors) from the address bar. */
  function cleanAuthParamsFromUrl() {
    const hasAuthParams = /access_token|refresh_token|error_description|error_code|type=/.test(
      window.location.hash + window.location.search
    );

    if (hasAuthParams && window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  /**
   * Called every time Supabase reports a change: SIGNED_IN, SIGNED_OUT,
   * INITIAL_SESSION, TOKEN_REFRESHED, PASSWORD_RECOVERY ...
   */
  function handleAuthStateChange(event, session) {
    const previousUserId = state.user ? state.user.id : null;
    state.user = session && session.user ? session.user : null;
    const userChanged = (state.user ? state.user.id : null) !== previousUserId;

    if (event === "PASSWORD_RECOVERY") state.isRecoveryFlow = true;

    // Supabase advises not to call its methods from inside this callback,
    // so the real work is deferred to the next tick.
    window.setTimeout(() => {
      renderAuthState();

      if (event === "PASSWORD_RECOVERY") openAuthModal("update-password");

      if (userChanged) {
        if (state.user) onUserSignedIn();
        else onUserSignedOut(event);
      }
    }, 0);
  }

  async function onUserSignedIn() {
    // Close the log in / sign up dialog (but not the "new password" one)
    if (!state.isRecoveryFlow) closeAuthModal();

    setView("dashboard");

    if (state.pendingRedirect && state.pendingRedirect.type === "signup") {
      showMessage(els.globalMessage, "Your email is verified. Welcome to Quick QR!", "success", { autoHide: true });
    }
    state.pendingRedirect = null;

    await loadSavedQrCodes();
  }

  function onUserSignedOut(event) {
    state.savedQrCodes = [];
    state.savedCount = 0;
    state.savedLoadFailed = false;
    renderSavedList();
    clearMessage(els.savedMessage);
    resetGenerator();
    closeAuthModal();
    setView("home");

    if (event === "SIGNED_OUT") {
      showMessage(els.globalMessage, "You have been logged out.", "success", { autoHide: true });
    }
  }

  /** Shows email-link problems (expired link, etc.) that Supabase put in the URL. */
  function showRedirectProblem(redirect) {
    if (!redirect || (!redirect.error && !redirect.errorDescription)) return;

    const detail = redirect.errorDescription || "The link is invalid or has expired.";
    showMessage(els.globalMessage, `${detail} Please try again or request a new link.`, "error");
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    clearMessage(els.authMessage);
    clearInvalidFields(els.loginForm);

    if (!requireSupabase(els.authMessage)) return;

    const email = readValue(els.loginEmail).trim();
    const password = readValue(els.loginPassword);

    if (!isValidEmail(email)) {
      showMessage(els.authMessage, "Enter a valid email address.", "error");
      markInvalid(els.loginEmail);
      return;
    }
    if (!password) {
      showMessage(els.authMessage, "Enter your password.", "error");
      markInvalid(els.loginPassword);
      return;
    }

    setButtonBusy(els.loginSubmitBtn, true, "Logging in…");

    try {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Success: the auth listener (SIGNED_IN) closes the modal and opens the dashboard.
    } catch (error) {
      showMessage(els.authMessage, friendlyAuthError(error), "error");
    } finally {
      setButtonBusy(els.loginSubmitBtn, false);
    }
  }

  async function handleSignupSubmit(event) {
    event.preventDefault();
    clearMessage(els.authMessage);
    clearInvalidFields(els.signupForm);

    if (!requireSupabase(els.authMessage)) return;

    const email = readValue(els.signupEmail).trim();
    const password = readValue(els.signupPassword);
    const confirmPassword = readValue(els.signupConfirmPassword);

    if (!isValidEmail(email)) {
      showMessage(els.authMessage, "Enter a valid email address.", "error");
      markInvalid(els.signupEmail);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      showMessage(els.authMessage, `Your password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, "error");
      markInvalid(els.signupPassword);
      return;
    }
    if (password !== confirmPassword) {
      showMessage(els.authMessage, "The passwords do not match. Please retype them.", "error");
      markInvalid(els.signupConfirmPassword);
      return;
    }

    setButtonBusy(els.signupSubmitBtn, true, "Creating account…");

    try {
      const { data, error } = await state.supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: AUTH_REDIRECT_URL }
      });
      if (error) throw error;

      // Email confirmation is turned off in Supabase: the user is already
      // signed in, and the auth listener will open the dashboard.
      if (data.session) return;

      // With confirmation on, Supabase hides "already registered" by returning
      // a user with no identities. Tell the person what to do.
      const alreadyRegistered =
        data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

      if (alreadyRegistered) {
        showMessage(
          els.authMessage,
          "An account with this email may already exist. Try logging in, or reset your password.",
          "error"
        );
        return;
      }

      // Normal case: ask them to verify their email, then log in.
      if (els.signupForm) els.signupForm.reset();
      setAuthMode("login");
      if (els.loginEmail) els.loginEmail.value = email;
      showMessage(
        els.authMessage,
        `We sent a verification link to ${email}. Open it to activate your account, then log in here.`,
        "success"
      );
    } catch (error) {
      showMessage(els.authMessage, friendlyAuthError(error), "error");
    } finally {
      setButtonBusy(els.signupSubmitBtn, false);
    }
  }

  async function handleForgotSubmit(event) {
    event.preventDefault();
    clearMessage(els.authMessage);
    clearInvalidFields(els.forgotForm);

    if (!requireSupabase(els.authMessage)) return;

    const email = readValue(els.forgotEmail).trim();

    if (!isValidEmail(email)) {
      showMessage(els.authMessage, "Enter the email address you signed up with.", "error");
      markInvalid(els.forgotEmail);
      return;
    }

    setButtonBusy(els.forgotSubmitBtn, true, "Sending…");

    try {
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: AUTH_REDIRECT_URL
      });
      if (error) throw error;

      // Same wording whether or not the account exists, so emails cannot be probed.
      showMessage(
        els.authMessage,
        `If an account exists for ${email}, a password reset link is on its way. Check your inbox.`,
        "success"
      );
    } catch (error) {
      showMessage(els.authMessage, friendlyAuthError(error), "error");
    } finally {
      setButtonBusy(els.forgotSubmitBtn, false);
    }
  }

  /** Runs after the user opens the reset link from their email and picks a new password. */
  async function handleUpdatePasswordSubmit(event) {
    event.preventDefault();
    clearMessage(els.authMessage);
    clearInvalidFields(els.updatePasswordForm);

    if (!requireSupabase(els.authMessage)) return;

    const password = readValue(els.newPassword);
    const confirmPassword = readValue(els.newConfirmPassword);

    if (password.length < MIN_PASSWORD_LENGTH) {
      showMessage(els.authMessage, `Your password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, "error");
      markInvalid(els.newPassword);
      return;
    }
    if (password !== confirmPassword) {
      showMessage(els.authMessage, "The passwords do not match. Please retype them.", "error");
      markInvalid(els.newConfirmPassword);
      return;
    }

    setButtonBusy(els.updatePasswordSubmitBtn, true, "Saving…");

    try {
      const { error } = await state.supabase.auth.updateUser({ password });
      if (error) throw error;

      state.isRecoveryFlow = false;
      closeAuthModal();
      showMessage(els.globalMessage, "Your password has been updated.", "success", { autoHide: true });
    } catch (error) {
      showMessage(els.authMessage, friendlyAuthError(error), "error");
    } finally {
      setButtonBusy(els.updatePasswordSubmitBtn, false);
    }
  }

  async function handleLogout() {
    if (!requireSupabase(els.globalMessage)) return;

    setButtonBusy(els.logoutBtn, true, "Logging out…");

    try {
      // scope "local" signs out this browser only (not the user's other devices)
      const { error } = await state.supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      // Success: the auth listener (SIGNED_OUT) updates the page.
    } catch (error) {
      showMessage(els.globalMessage, friendlyAuthError(error), "error");
    } finally {
      setButtonBusy(els.logoutBtn, false);
    }
  }


  /* ==========================================================================
     QR GENERATOR
     ========================================================================== */

  function isQrLibraryReady() {
    return Boolean(window.QRCode && typeof window.QRCode.toCanvas === "function");
  }

  /** Draws a QR code onto a <canvas>. */
  async function drawQr(canvas, text, { size, dark, light, margin = 2 }) {
    await window.QRCode.toCanvas(canvas, text, {
      width: size,
      margin,
      errorCorrectionLevel: "M",
      color: { dark, light }
    });

    // The library adds fixed pixel sizes to the canvas as an inline style.
    // Remove it so style.css can make the preview shrink on small screens.
    canvas.removeAttribute("style");
  }

  function friendlyQrError(error) {
    const message = error && error.message ? error.message.toLowerCase() : "";

    if (message.includes("too big") || message.includes("overflow")) {
      return "That content is too long to fit in a QR code. Try shortening it.";
    }
    return "Sorry, the QR code could not be created. Please try again.";
  }

  /** Builds the default title from the content when the title field is empty. */
  function makeTitle(title, content) {
    const chosen = title.trim() || content.trim();
    return chosen.length > MAX_TITLE_LENGTH ? `${chosen.slice(0, MAX_TITLE_LENGTH - 1)}…` : chosen;
  }

  // ---- Color contrast (a QR code with similar colors will not scan) ----
  function getRelativeLuminance(hex) {
    const value = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4]
      .map((start) => parseInt(value.slice(start, start + 2), 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)));

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function getContrastRatio(colorA, colorB) {
    const a = getRelativeLuminance(colorA);
    const b = getRelativeLuminance(colorB);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /** Reads the generator form into one tidy object. */
  function readGeneratorInputs() {
    return {
      title: readValue(els.qrTitle).trim(),
      content: readValue(els.qrContent).trim(),
      size: parseInt(readValue(els.qrSize), 10) || 256,
      dark: readValue(els.qrFgColor) || "#000000",
      light: readValue(els.qrBgColor) || "#ffffff",
      shouldSave: els.qrSaveToggle ? els.qrSaveToggle.checked : false
    };
  }

  /** Checks the inputs. Returns an error string (and highlights the field), or "" if all is well. */
  function validateGeneratorInputs(inputs) {
    if (!inputs.content) {
      markInvalid(els.qrContent);
      return "Enter a link or some text to turn into a QR code.";
    }
    if (inputs.content.length > MAX_CONTENT_LENGTH) {
      markInvalid(els.qrContent);
      return `That is too long. Please keep it under ${MAX_CONTENT_LENGTH} characters.`;
    }
    if (getContrastRatio(inputs.dark, inputs.light) < MIN_COLOR_CONTRAST) {
      markInvalid(els.qrFgColor);
      return "The foreground and background colors are too similar. Choose colors with more contrast so the code scans reliably.";
    }
    return "";
  }

  async function handleGenerate(event) {
    event.preventDefault();
    clearMessage(els.generatorMessage);
    clearInvalidFields(els.qrForm);

    const inputs = readGeneratorInputs();
    const problem = validateGeneratorInputs(inputs);

    if (problem) {
      showMessage(els.generatorMessage, problem, "error");
      return;
    }

    if (!isQrLibraryReady() || !els.qrCanvas) {
      showMessage(
        els.generatorMessage,
        "The QR code library could not be loaded. Check your internet connection and reload the page.",
        "error"
      );
      return;
    }

    setButtonBusy(els.generateBtn, true, "Generating…");

    try {
      await drawQr(els.qrCanvas, inputs.content, {
        size: inputs.size,
        dark: inputs.dark,
        light: inputs.light
      });
    } catch (error) {
      console.error("QR generation failed:", error);
      showMessage(els.generatorMessage, friendlyQrError(error), "error");
      setButtonBusy(els.generateBtn, false);
      return;
    }

    const title = makeTitle(inputs.title, inputs.content);
    state.currentQr = { title, content: inputs.content };
    showQrPreview(title);
    setButtonBusy(els.generateBtn, false);

    // Save it to the user's account (if the box is ticked)
    if (inputs.shouldSave) {
      await saveQrCode(title, inputs.content);
    } else {
      showMessage(els.generatorMessage, "QR code ready. It was not saved to your account.", "info", { autoHide: true });
    }
  }

  function showQrPreview(title) {
    if (els.qrCanvas) els.qrCanvas.setAttribute("aria-label", `QR code for ${title}`);

    show(els.qrCanvas);
    hide(els.qrEmptyState);
    if (els.qrPreview) els.qrPreview.classList.add("has-qr");
    if (els.downloadBtn) els.downloadBtn.disabled = false;
    if (els.copyBtn) els.copyBtn.disabled = false;
  }

  function hideQrPreview() {
    state.currentQr = null;

    if (els.qrCanvas) {
      const context = els.qrCanvas.getContext ? els.qrCanvas.getContext("2d") : null;
      if (context) context.clearRect(0, 0, els.qrCanvas.width, els.qrCanvas.height);
    }

    hide(els.qrCanvas);
    show(els.qrEmptyState);
    if (els.qrPreview) els.qrPreview.classList.remove("has-qr");
    if (els.downloadBtn) els.downloadBtn.disabled = true;
    if (els.copyBtn) els.copyBtn.disabled = true;
  }

  /** Puts the whole generator back to its starting state. */
  function resetGenerator() {
    if (els.qrForm) els.qrForm.reset(); // restores size, colors, and the save checkbox
    syncColorValues();
    hideQrPreview();
    clearMessage(els.generatorMessage);
    clearInvalidFields(els.qrForm);
  }

  function handleClear() {
    resetGenerator();
    if (els.qrContent) els.qrContent.focus();
  }

  /** Keeps the little hex codes next to the color pickers up to date. */
  function syncColorValues() {
    setText(els.qrFgValue, readValue(els.qrFgColor) || "#000000");
    setText(els.qrBgValue, readValue(els.qrBgColor) || "#ffffff");
  }

  /** Turns text into a safe file name, e.g. "My Site!" → "my-site". */
  function slugify(text) {
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

    return slug || "qr-code";
  }

  function triggerDownload(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleDownload() {
    if (!state.currentQr || !els.qrCanvas) {
      showMessage(els.generatorMessage, "Generate a QR code first, then download it.", "error");
      return;
    }

    try {
      triggerDownload(els.qrCanvas.toDataURL("image/png"), `${slugify(state.currentQr.title)}-qr.png`);
    } catch (error) {
      console.error("Download failed:", error);
      showMessage(els.generatorMessage, "Sorry, the download could not be started. Please try again.", "error");
    }
  }

  /** Fallback for browsers or pages where the Clipboard API is unavailable. */
  function copyWithFallback(text) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.className = "visually-hidden";
    document.body.appendChild(helper);
    helper.select();

    const wasCopied = document.execCommand("copy");
    helper.remove();

    if (!wasCopied) throw new Error("Copy command was rejected");
  }

  async function handleCopy() {
    if (!state.currentQr) {
      showMessage(els.generatorMessage, "Generate a QR code first, then copy its content.", "error");
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(state.currentQr.content);
      } else {
        copyWithFallback(state.currentQr.content);
      }
      showMessage(els.generatorMessage, "Copied to your clipboard.", "success", { autoHide: true });
    } catch (error) {
      console.error("Copy failed:", error);
      showMessage(els.generatorMessage, "Could not copy automatically. Select the text and copy it manually.", "error");
    }
  }


  /* ==========================================================================
     SAVED QR CODES (Supabase database)
     Every query below filters by the signed-in user's id. Row Level Security
     on the server enforces the same rule, so nobody can read another
     person's rows even if this code were changed.
     ========================================================================== */

  /** Inserts a new row for the current user, then refreshes the list. */
  async function saveQrCode(title, content) {
    if (!state.supabase || !state.user) {
      showMessage(els.generatorMessage, "Log in to save QR codes to your account.", "error");
      return;
    }

    try {
      const { error } = await state.supabase.from(QR_TABLE).insert({
        user_id: state.user.id,
        title,
        content
      });
      if (error) throw error;

      await loadSavedQrCodes();
      showMessage(els.generatorMessage, "QR code generated and saved to My QR codes.", "success", { autoHide: true });
    } catch (error) {
      console.error("Saving failed:", error);
      showMessage(
        els.generatorMessage,
        `Your QR code is ready, but it could not be saved. ${friendlyDbError(error)}`,
        "error"
      );
    }
  }

  /** Fetches ONLY the signed-in user's QR codes, newest first. */
  async function loadSavedQrCodes() {
    if (!state.supabase || !state.user) return;

    const userId = state.user.id;

    state.savedLoadFailed = false;
    hide(els.savedEmptyState);
    show(els.savedLoading);

    try {
      const { data, error, count } = await state.supabase
        .from(QR_TABLE)
        .select("id, title, content, created_at", { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // If the user logged out or changed while loading, ignore this result.
      if (!state.user || state.user.id !== userId) return;

      state.savedQrCodes = data || [];
      state.savedCount = typeof count === "number" ? count : state.savedQrCodes.length;
    } catch (error) {
      console.error("Loading saved QR codes failed:", error);
      state.savedLoadFailed = true;
      showMessage(els.savedMessage, `Could not load your QR codes. ${friendlyDbError(error)}`, "error");
    } finally {
      hide(els.savedLoading);
    }

    renderSavedList();
  }

  function updateSavedCount() {
    setText(els.savedCount, String(state.savedCount));
  }

  function formatDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  /** Rebuilds the "My QR codes" list and the counter from state. */
  function renderSavedList() {
    updateSavedCount();
    if (!els.savedList) return;

    els.savedList.replaceChildren();

    const isEmpty = state.savedQrCodes.length === 0;
    toggle(els.savedEmptyState, isEmpty && !state.savedLoadFailed);

    const fragment = document.createDocumentFragment();
    state.savedQrCodes.forEach((item) => {
      const row = createSavedItem(item);
      if (row) fragment.appendChild(row);
    });
    els.savedList.appendChild(fragment);
  }

  /** Builds one row from the <template> in index.html. */
  function createSavedItem(item) {
    if (!els.savedTemplate) return null;

    const fragment = els.savedTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".saved-item");
    if (!row) return null;

    row.dataset.id = item.id;

    // textContent (not innerHTML) keeps user-provided text from running as HTML
    const titleEl = row.querySelector(".saved-title");
    const contentEl = row.querySelector(".saved-content");
    const timeEl = row.querySelector(".saved-time");
    const canvas = row.querySelector(".saved-thumb-canvas");

    setText(titleEl, item.title || item.content);
    setText(contentEl, item.content);
    if (contentEl) contentEl.title = item.content; // full text on hover

    if (timeEl) {
      timeEl.textContent = formatDate(item.created_at);
      timeEl.dateTime = item.created_at;
    }

    if (canvas) {
      canvas.setAttribute("aria-label", `QR code for ${item.title || item.content}`);
      drawQr(canvas, item.content, {
        size: SAVED_THUMB_SIZE,
        dark: "#000000",
        light: "#ffffff",
        margin: 1
      }).catch(() => hide(canvas)); // skip the thumbnail if it cannot be drawn
    }

    on(row.querySelector(".saved-download-btn"), "click", () => downloadSavedQr(item));
    on(row.querySelector(".saved-delete-btn"), "click", (event) => deleteSavedQr(item, event.currentTarget));

    return row;
  }

  /**
   * Downloads a saved QR code as a PNG.
   * Only the title and content are stored in the database, so the file is
   * re-created here with the default black-on-white colors.
   */
  async function downloadSavedQr(item) {
    if (!isQrLibraryReady()) {
      showMessage(els.savedMessage, "The QR code library could not be loaded. Reload the page and try again.", "error");
      return;
    }

    try {
      const url = await window.QRCode.toDataURL(item.content, {
        width: SAVED_DOWNLOAD_SIZE,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#ffffff" }
      });
      triggerDownload(url, `${slugify(item.title || "qr-code")}-qr.png`);
    } catch (error) {
      console.error("Saved QR download failed:", error);
      showMessage(els.savedMessage, "Sorry, that QR code could not be downloaded.", "error");
    }
  }

  /** Deletes one of the signed-in user's own QR codes, then refreshes the list. */
  async function deleteSavedQr(item, button) {
    if (!state.supabase || !state.user) return;

    const label = item.title || "this QR code";
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;

    clearMessage(els.savedMessage);
    setButtonBusy(button, true, "Deleting…");

    try {
      const { data, error } = await state.supabase
        .from(QR_TABLE)
        .delete()
        .eq("id", item.id)
        .eq("user_id", state.user.id) // only ever the current user's own row
        .select("id");
      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("That QR code was not found, or you do not have permission to delete it.");
      }

      await loadSavedQrCodes();
      showMessage(els.savedMessage, "QR code deleted.", "success", { autoHide: true });
    } catch (error) {
      console.error("Delete failed:", error);
      showMessage(els.savedMessage, `Could not delete the QR code. ${friendlyDbError(error)}`, "error");
    } finally {
      setButtonBusy(button, false);
    }
  }


  /* ==========================================================================
     EVENT LISTENERS
     ========================================================================== */
  function bindEvents() {
    // Header and home page
    on(els.loginBtn, "click", () => openAuthModal("login"));
    on(els.signupBtn, "click", () => openAuthModal("signup"));
    on(els.logoutBtn, "click", handleLogout);
    on(els.heroLoginBtn, "click", () => openAuthModal("login"));
    on(els.heroSignupBtn, "click", () => openAuthModal("signup"));
    on(els.heroDashboardBtn, "click", () => setView("dashboard"));

    on(els.logoLink, "click", (event) => {
      event.preventDefault();
      setView("home");
    });

    els.navLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        setView(link.dataset.view);
      });
    });

    // Authentication modal
    on(els.authCloseBtn, "click", closeAuthModal);
    on(els.authBackdrop, "click", closeAuthModal);
    document.addEventListener("keydown", handleDocumentKeydown);

    // Remove the red "invalid" border as soon as the person edits the field
    on(els.authModal, "input", (event) => {
      if (event.target && event.target.removeAttribute) event.target.removeAttribute("aria-invalid");
    });
    on(els.qrForm, "input", (event) => {
      if (event.target && event.target.removeAttribute) event.target.removeAttribute("aria-invalid");
    });

    on(els.showSignupBtn, "click", () => setAuthMode("signup"));
    on(els.showLoginBtn, "click", () => setAuthMode("login"));
    on(els.backToLoginBtn, "click", () => setAuthMode("login"));
    on(els.forgotPasswordBtn, "click", () => {
      const typedEmail = readValue(els.loginEmail).trim(); // carry the email over
      setAuthMode("forgot");
      if (els.forgotEmail && typedEmail) els.forgotEmail.value = typedEmail;
    });

    on(els.loginForm, "submit", handleLoginSubmit);
    on(els.signupForm, "submit", handleSignupSubmit);
    on(els.forgotForm, "submit", handleForgotSubmit);
    on(els.updatePasswordForm, "submit", handleUpdatePasswordSubmit);

    // QR generator
    on(els.qrForm, "submit", handleGenerate);
    on(els.clearBtn, "click", handleClear);
    on(els.downloadBtn, "click", handleDownload);
    on(els.copyBtn, "click", handleCopy);
    on(els.qrFgColor, "input", syncColorValues);
    on(els.qrBgColor, "input", syncColorValues);
  }


  /* ==========================================================================
     START-UP
     ========================================================================== */
  async function init() {
    cacheElements();
    bindEvents();
    syncColorValues();
    renderAuthState();
    renderSavedList();
    setText(els.footerYear, String(new Date().getFullYear()));

    // Read email-link info first; the Supabase client clears it from the URL.
    state.pendingRedirect = readAuthRedirect();

    initSupabase();
    if (!state.supabase) return;

    // Subscribe BEFORE asking for the session so no event is missed
    // (for example PASSWORD_RECOVERY after clicking a reset link).
    state.supabase.auth.onAuthStateChange(handleAuthStateChange);

    // Detect the session that is already stored in this browser, if any.
    try {
      const { data, error } = await state.supabase.auth.getSession();
      if (error) throw error;

      handleAuthStateChange("INITIAL_SESSION", data.session);

      // Safety net: if we came from a reset link, make sure the "new password" form opens.
      if (data.session && state.pendingRedirect && state.pendingRedirect.type === "recovery") {
        state.isRecoveryFlow = true;
        openAuthModal("update-password");
      }
    } catch (error) {
      console.error("Could not read the session:", error);
      showMessage(els.globalMessage, friendlyAuthError(error), "error");
    }

    showRedirectProblem(state.pendingRedirect);
    cleanAuthParamsFromUrl();
  }

  document.addEventListener("DOMContentLoaded", init);
})();