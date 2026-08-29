/* ==========================================================================
   MovieMatic 98 - movie night picker
   Vanilla JS, no dependencies. Base data lives in movies.json / snacks.json;
   anything the user adds lives in localStorage and is merged on top.
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE = {
    watched: "moviematic98:watched:v1",
    movies: "moviematic98:customMovies:v1",
    snacks: "moviematic98:customSnacks:v1",
    hidden: "moviematic98:hidden:v1",
    settings: "moviematic98:settings:v1"
  };

  /* Slot machine timing. The winner is decided before any of this runs. */
  var SPIN_START_DELAY = 55;   // ms between title flips at full speed
  var SPIN_HOLD_MS = 1200;     // hold full speed this long before slowing
  var SPIN_FACTOR = 1.28;      // delay multiplier once slowing begins
  var SPIN_MAX_DELAY = 340;    // once the delay passes this, land on the winner

  var SNACK_SPIN_MS = 620;     // snacks get a shorter, cheaper shuffle
  var SNACK_TICK = 60;

  var RATINGS = ["G", "PG", "PG-13", "R", "NR"];
  var RUNTIME_MAX = 200;       // slider ceiling; at the ceiling the filter is off

  var THEMES = ["teal", "amber", "y2k", "midnight"];

  var baseMovies = [];
  var baseSnacks = [];
  var customMovies = [];
  var customSnacks = [];
  var movies = [];             // baseMovies + customMovies, the live list
  var snacks = [];

  var watched = Object.create(null);
  var hidden = Object.create(null);   // baseline titles removed from this browser
  var vetoed = Object.create(null);   // session only; a veto is for tonight
  var selectedIndex = -1;
  var spinning = false;
  var spinTimer = null;
  var lastFocused = null;
  var openMenu = null;

  var settings = {
    theme: "teal",
    scanlines: true,
    sound: false,
    ratings: RATINGS.slice(),
    maxRuntime: RUNTIME_MAX
  };

  var el = {};
  ["listbox", "crt", "crt-kicker", "crt-title", "crt-meta", "crt-hook", "crt-second",
   "crt-live", "scanlines", "snack-text", "snack-bar", "skip-watched", "filter-hint",
   "btn-pick", "btn-double", "btn-snack", "btn-watched", "btn-veto", "btn-reset",
   "status-titles", "status-watched", "status-pool", "menu-bar", "modal-layer",
   "window", "tb-min", "tb-max", "tb-close", "shutdown", "bsod", "import-file",
   "pantry-list", "rating-checks", "f-maxrun", "maxrun-out"].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  /* ---------- helpers ---------------------------------------------------- */

  function keyOf(movie) {
    return movie.title + " (" + movie.year + ")";
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function randomOf(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function text(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  /* ---------- persistence ------------------------------------------------- */

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      /* Corrupt or unavailable storage just means we start fresh. */
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* Private mode / full quota: the app still works for this session. */
    }
  }

  function loadWatched() {
    var store = Object.create(null);
    var parsed = readJSON(STORAGE.watched, []);
    if (Array.isArray(parsed)) {
      parsed.forEach(function (k) {
        if (typeof k === "string") store[k] = true;
      });
    }
    return store;
  }

  function saveWatched() {
    writeJSON(STORAGE.watched, Object.keys(watched));
  }

  function loadHidden() {
    var store = Object.create(null);
    var parsed = readJSON(STORAGE.hidden, []);
    if (Array.isArray(parsed)) {
      parsed.forEach(function (k) {
        if (typeof k === "string") store[k] = true;
      });
    }
    return store;
  }

  function saveHidden() { writeJSON(STORAGE.hidden, Object.keys(hidden)); }

  function saveCustomMovies() { writeJSON(STORAGE.movies, customMovies); }
  function saveCustomSnacks() { writeJSON(STORAGE.snacks, customSnacks); }
  function saveSettings() { writeJSON(STORAGE.settings, settings); }

  function loadSettings() {
    var saved = readJSON(STORAGE.settings, null);
    if (!saved || typeof saved !== "object") return;
    if (THEMES.indexOf(saved.theme) >= 0) settings.theme = saved.theme;
    if (typeof saved.scanlines === "boolean") settings.scanlines = saved.scanlines;
    if (typeof saved.sound === "boolean") settings.sound = saved.sound;
    if (Array.isArray(saved.ratings) && saved.ratings.length) {
      settings.ratings = saved.ratings.filter(function (r) {
        return RATINGS.indexOf(r) >= 0;
      });
      if (!settings.ratings.length) settings.ratings = RATINGS.slice();
    }
    if (typeof saved.maxRuntime === "number" && saved.maxRuntime > 0) {
      settings.maxRuntime = saved.maxRuntime;
    }
  }

  /* ---------- sound ------------------------------------------------------- */
  /* Square waves through WebAudio so the whole app stays asset-free. */

  var audioCtx = null;

  function tone(freq, ms, volume) {
    if (!settings.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();

      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = volume == null ? 0.04 : volume;
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      var now = audioCtx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
      osc.start(now);
      osc.stop(now + ms / 1000);
    } catch (err) {
      /* Autoplay policy or no audio device: silence is an acceptable outcome. */
    }
  }

  function sfxTick()  { tone(880, 25, 0.02); }
  function sfxDing()  { tone(988, 90); window.setTimeout(function () { tone(1319, 160); }, 90); }
  function sfxError() { tone(220, 180, 0.05); }
  function sfxBoot()  { tone(523, 120); window.setTimeout(function () { tone(784, 220); }, 130); }

  /* ---------- settings application ---------------------------------------- */

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    syncMenuChecks();
  }

  function applyScanlines() {
    el.scanlines.hidden = !settings.scanlines;
    syncMenuChecks();
  }

  function syncMenuChecks() {
    var radios = document.querySelectorAll('[data-action="theme"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].setAttribute("aria-checked", radios[i].dataset.theme === settings.theme ? "true" : "false");
    }
    var scan = document.querySelector('[data-action="toggle-scanlines"]');
    var snd = document.querySelector('[data-action="toggle-sound"]');
    if (scan) scan.setAttribute("aria-checked", settings.scanlines ? "true" : "false");
    if (snd) snd.setAttribute("aria-checked", settings.sound ? "true" : "false");
  }

  function filtersAreActive() {
    return settings.maxRuntime < RUNTIME_MAX || settings.ratings.length < RATINGS.length;
  }

  function renderFilterHint() {
    if (!filtersAreActive()) {
      el["filter-hint"].hidden = true;
      el["filter-hint"].textContent = "";
      return;
    }
    var parts = [];
    if (settings.ratings.length < RATINGS.length) parts.push(settings.ratings.join(", "));
    if (settings.maxRuntime < RUNTIME_MAX) parts.push("under " + settings.maxRuntime + " min");
    el["filter-hint"].textContent = "Filtered: " + parts.join(" · ");
    el["filter-hint"].hidden = false;
  }

  /* ---------- CRT rendering ------------------------------------------------ */

  function showIdle() {
    el.crt.classList.remove("is-error");
    el["crt-kicker"].textContent = "SELECTION";
    el["crt-title"].textContent = "READY";
    if (!prefersReducedMotion()) {
      var caret = text("span", "caret", "_");
      el["crt-title"].appendChild(caret);
    } else {
      el["crt-title"].textContent = "READY_";
    }
    el["crt-meta"].textContent = "";
    el["crt-hook"].textContent = "";
    hideSecond();
  }

  function hideSecond() {
    el["crt-second"].hidden = true;
    el["crt-second"].textContent = "";
  }

  function metaLine(movie) {
    return movie.year + "  •  " + movie.rating + "  •  " + movie.runtime + " MIN";
  }

  function showMovie(movie, kicker, announce) {
    el.crt.classList.remove("is-error");
    el["crt-kicker"].textContent = kicker || "SELECTION";
    el["crt-title"].textContent = movie.title;
    el["crt-meta"].textContent = metaLine(movie);
    el["crt-hook"].textContent = movie.hook || "";
    hideSecond();
    if (announce) {
      el["crt-live"].textContent = movie.title + ", " + movie.year + ", rated " + movie.rating +
        ", " + movie.runtime + " minutes. " + (movie.hook || "");
    }
  }

  function showDouble(first, second) {
    el.crt.classList.remove("is-error");
    el["crt-kicker"].textContent = "DOUBLE FEATURE";
    el["crt-title"].textContent = first.title;
    el["crt-meta"].textContent = metaLine(first);
    el["crt-hook"].textContent = first.hook || "";
    el["crt-second"].hidden = false;
    el["crt-second"].textContent = "THEN: " + second.title + " (" + second.year + ", " +
      second.runtime + " MIN)";
    var total = first.runtime + second.runtime;
    el["crt-live"].textContent = "Double feature: " + first.title + " then " + second.title +
      ". Total runtime " + total + " minutes.";
  }

  function showError(message, detail) {
    el.crt.classList.add("is-error");
    el["crt-kicker"].textContent = "ERROR";
    el["crt-title"].textContent = message;
    el["crt-meta"].textContent = "";
    el["crt-hook"].textContent = detail || "";
    hideSecond();
    el["crt-live"].textContent = message;
  }

  /* ---------- list rendering ------------------------------------------------ */

  function rebuildMovies() {
    /* Hiding never edits movies.json; it just filters the baseline per browser. */
    movies = baseMovies.filter(function (m) {
      return !hidden[keyOf(m)];
    }).concat(customMovies);
  }

  function hiddenTitles() {
    return baseMovies.filter(function (m) {
      return !!hidden[keyOf(m)];
    });
  }

  function renderList() {
    el.listbox.textContent = "";

    if (!movies.length) {
      el.listbox.appendChild(text("p", "listbox-loading",
        "Every title is removed. Put some back with File › Restore Hidden Titles."));
      return;
    }

    movies.forEach(function (movie, index) {
      var row = text("div", "row");
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "0");
      row.dataset.index = String(index);

      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "row-check";
      check.checked = !!watched[keyOf(movie)];
      check.setAttribute("aria-label", "Watched: " + movie.title);

      var title = text("span", "row-title", movie.title);
      if (movie.custom) title.appendChild(text("span", "row-badge", "★"));

      var year = text("span", "row-year", movie.year);

      row.appendChild(check);
      row.appendChild(title);
      row.appendChild(year);

      var del = text("button", "row-del", "×");
      del.type = "button";
      del.title = movie.custom
        ? "Delete this custom title"
        : "Remove this title (restorable under File)";
      del.setAttribute("aria-label", "Remove " + movie.title);
      del.addEventListener("click", function (event) {
        event.stopPropagation();
        removeMovie(movie);
      });
      row.appendChild(del);

      el.listbox.appendChild(row);

      check.addEventListener("click", function (event) {
        event.stopPropagation(); /* toggling watched should not move the selection */
      });

      check.addEventListener("change", function () {
        setWatched(index, check.checked);
      });

      row.addEventListener("click", function () {
        select(index);
      });

      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          select(index);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          var next = index + (event.key === "ArrowDown" ? 1 : -1);
          var target = el.listbox.querySelector('.row[data-index="' + next + '"]');
          if (target) target.focus();
        }
      });
    });

    syncRows();
  }

  function syncRows() {
    var rows = el.listbox.querySelectorAll(".row");
    for (var i = 0; i < rows.length; i++) {
      var movie = movies[i];
      var isWatched = !!watched[keyOf(movie)];
      var isVetoed = !!vetoed[keyOf(movie)];
      var isSelected = i === selectedIndex;

      rows[i].classList.toggle("is-watched", isWatched);
      rows[i].classList.toggle("is-vetoed", isVetoed);
      rows[i].classList.toggle("is-selected", isSelected);
      rows[i].setAttribute("aria-selected", isSelected ? "true" : "false");

      var box = rows[i].querySelector(".row-check");
      if (box.checked !== isWatched) box.checked = isWatched;
    }
  }

  function updateStatus() {
    var count = 0;
    movies.forEach(function (m) {
      if (watched[keyOf(m)]) count++;
    });
    var hiddenCount = hiddenTitles().length;
    el["status-titles"].textContent = plural(movies.length, "title") +
      (hiddenCount ? " (" + hiddenCount + " hidden)" : "");
    el["status-watched"].textContent = count + " watched";
    el["status-pool"].textContent = buildPool().length + " in pool";
    renderFilterHint();
  }

  /* ---------- state changes -------------------------------------------------- */

  function select(index) {
    if (spinning) return;
    selectedIndex = index;
    syncRows();
    showMovie(movies[index], "SELECTION", true);
    updateControls();
  }

  function setWatched(index, value) {
    var key = keyOf(movies[index]);
    if (value) {
      watched[key] = true;
    } else {
      delete watched[key];
    }
    saveWatched();
    syncRows();
    updateStatus();
  }

  function updateControls() {
    var hasMovies = movies.length > 0;
    el["btn-pick"].disabled = spinning || !hasMovies;
    el["btn-double"].disabled = spinning || movies.length < 2;
    el["btn-snack"].disabled = spinning || !snacks.length;
    el["btn-watched"].disabled = spinning || selectedIndex < 0;
    el["btn-veto"].disabled = spinning || selectedIndex < 0;
    el["btn-reset"].disabled = spinning || !hasMovies;
    el["skip-watched"].disabled = spinning || !hasMovies;
  }

  /* ---------- custom entries -------------------------------------------------- */

  function addCustomMovie(movie) {
    customMovies.push(movie);
    saveCustomMovies();
    rebuildMovies();
    renderList();
    updateStatus();
    updateControls();
  }

  function afterRemoval(movie, announcement) {
    selectedIndex = -1;
    rebuildMovies();
    renderList();
    updateStatus();
    showIdle();
    updateControls();
    el["crt-live"].textContent = announcement;
  }

  /* Custom titles are deleted outright; baseline titles are only hidden, so
     File > Restore Hidden Titles can always put them back. */
  function removeMovie(movie) {
    if (movie.custom) {
      confirmDialog(
        "Delete " + movie.title + "?",
        "This title was added by hand, so deleting it is permanent — it is not in movies.json to restore from.\n\n" +
        "Export your collection first if you want a copy.",
        function () { deleteCustomMovie(movie); }
      );
      return;
    }
    hideMovie(movie);
  }

  function deleteCustomMovie(movie) {
    var key = keyOf(movie);
    customMovies = customMovies.filter(function (m) {
      return keyOf(m) !== key;
    });
    saveCustomMovies();
    delete watched[key];
    delete vetoed[key];
    saveWatched();
    afterRemoval(movie, movie.title + " deleted.");
  }

  function hideMovie(movie) {
    hidden[keyOf(movie)] = true;
    saveHidden();
    afterRemoval(movie, movie.title + " removed. Restore it under File.");
  }

  function restoreMovie(movie) {
    delete hidden[keyOf(movie)];
    saveHidden();
    selectedIndex = -1;
    rebuildMovies();
    renderList();
    updateStatus();
    updateControls();
    el["crt-live"].textContent = movie.title + " restored.";
  }

  function restoreAll() {
    hidden = Object.create(null);
    saveHidden();
    selectedIndex = -1;
    rebuildMovies();
    renderList();
    updateStatus();
    updateControls();
    el["crt-live"].textContent = "All hidden titles restored.";
  }

  function rebuildSnacks() {
    snacks = baseSnacks.concat(customSnacks);
  }

  /* ---------- picking --------------------------------------------------------- */

  function passesFilters(movie) {
    if (settings.ratings.indexOf(movie.rating) < 0) return false;
    if (settings.maxRuntime < RUNTIME_MAX && movie.runtime > settings.maxRuntime) return false;
    return true;
  }

  function buildPool() {
    var pool = movies.filter(function (m) {
      return !vetoed[keyOf(m)] && passesFilters(m);
    });

    if (!el["skip-watched"].checked) return pool;

    var unwatched = pool.filter(function (m) {
      return !watched[keyOf(m)];
    });
    /* Never dead-end on "watched" alone: fall back to the filtered list. */
    return unwatched.length ? unwatched : pool;
  }

  function emptyPoolNotice() {
    sfxError();
    showError("NO MATCHES", "Every title is vetoed or filtered out. Loosen the filters under View.");
    message("No Titles Available",
      "Nothing in the collection matches your current filters and vetoes.\n\n" +
      "Try widening the ratings or the runtime limit under View › Filters, or add a title under File › Add Title.");
  }

  function land(winner) {
    spinning = false;
    spinTimer = null;
    selectedIndex = movies.indexOf(winner);
    syncRows();
    showMovie(winner, "TONIGHT'S PICK", true);
    sfxDing();
    updateControls();
    updateStatus();

    var row = el.listbox.querySelector('.row[data-index="' + selectedIndex + '"]');
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function pick() {
    if (spinning || !movies.length) return;

    var pool = buildPool();
    if (!pool.length) {
      emptyPoolNotice();
      return;
    }

    /* The winner is decided here, up front. The animation is only decoration. */
    var winner = randomOf(pool);

    if (prefersReducedMotion()) {
      land(winner);
      return;
    }

    spinning = true;
    selectedIndex = -1;
    syncRows();
    updateControls();

    var delay = SPIN_START_DELAY;
    var elapsed = 0;

    function step() {
      showMovie(randomOf(movies), "SPINNING…", false);
      sfxTick();
      spinTimer = window.setTimeout(function () {
        elapsed += delay;
        if (elapsed >= SPIN_HOLD_MS) delay *= SPIN_FACTOR;
        if (delay > SPIN_MAX_DELAY) {
          land(winner);
        } else {
          step();
        }
      }, delay);
    }

    step();
  }

  function doubleFeature() {
    if (spinning) return;

    var pool = buildPool();
    if (pool.length < 2) {
      sfxError();
      message("Not Enough Titles",
        "A double feature needs at least two eligible titles, and the pool currently holds " +
        pool.length + ".\n\nLoosen the filters or add another movie.");
      return;
    }

    var first = randomOf(pool);
    var rest = pool.filter(function (m) { return keyOf(m) !== keyOf(first); });
    var second = randomOf(rest);

    selectedIndex = movies.indexOf(first);
    syncRows();
    showDouble(first, second);
    sfxDing();
    updateControls();

    var total = first.runtime + second.runtime;
    var hours = Math.floor(total / 60);
    var mins = total % 60;
    el["status-pool"].textContent = hours + "h " + mins + "m total";
  }

  function rollSnack() {
    if (!snacks.length) return;

    var winner = randomOf(snacks);

    function landSnack() {
      var label = winner.name;
      if (winner.prep) label += "  —  " + winner.prep;
      if (winner.note) label += "  —  " + winner.note;
      el["snack-text"].textContent = label;
      el["snack-bar"].classList.remove("is-spinning");
      el["crt-live"].textContent = "Snack: " + winner.name + ". " + (winner.note || "");
      sfxDing();
    }

    if (prefersReducedMotion()) {
      landSnack();
      return;
    }

    el["snack-bar"].classList.add("is-spinning");
    var ticks = Math.round(SNACK_SPIN_MS / SNACK_TICK);
    var i = 0;
    var timer = window.setInterval(function () {
      i++;
      if (i >= ticks) {
        window.clearInterval(timer);
        landSnack();
        return;
      }
      el["snack-text"].textContent = randomOf(snacks).name;
      sfxTick();
    }, SNACK_TICK);
  }

  function vetoSelected() {
    if (spinning || selectedIndex < 0) return;
    var movie = movies[selectedIndex];
    var key = keyOf(movie);

    if (vetoed[key]) {
      delete vetoed[key];
      el["crt-live"].textContent = movie.title + " un-vetoed.";
    } else {
      vetoed[key] = true;
      el["crt-live"].textContent = movie.title + " vetoed for tonight.";
      sfxError();
    }
    syncRows();
    updateStatus();
  }

  function reset() {
    if (spinning) return;
    confirmDialog(
      "Reset Everything?",
      "This clears every watched mark and every veto for this session.\n\nCustom titles, snacks, and removed titles are all kept.",
      function () {
        watched = Object.create(null);
        vetoed = Object.create(null);
        saveWatched();
        selectedIndex = -1;
        syncRows();
        updateStatus();
        showIdle();
        el["snack-text"].textContent = "Nothing rolled yet.";
        el["crt-live"].textContent = "Watched list and vetoes cleared.";
        updateControls();
      }
    );
  }

  /* ---------- menu bar --------------------------------------------------------- */

  function closeMenu() {
    if (!openMenu) return;
    var button = document.getElementById("menu-" + openMenu);
    var dropdown = document.getElementById("dropdown-" + openMenu);
    if (button) button.setAttribute("aria-expanded", "false");
    if (button) button.classList.remove("is-open");
    if (dropdown) dropdown.hidden = true;
    openMenu = null;
  }

  function showMenu(name) {
    if (openMenu === name) {
      closeMenu();
      return;
    }
    closeMenu();
    var button = document.getElementById("menu-" + name);
    var dropdown = document.getElementById("dropdown-" + name);
    if (!button || !dropdown) return;
    button.setAttribute("aria-expanded", "true");
    button.classList.add("is-open");
    dropdown.hidden = false;
    openMenu = name;
  }

  el["menu-bar"].addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-menu]");
    if (trigger) {
      event.stopPropagation();
      showMenu(trigger.dataset.menu);
    }
  });

  el["menu-bar"].addEventListener("mouseover", function (event) {
    /* Classic behavior: with one menu open, hovering another switches to it. */
    if (!openMenu) return;
    var trigger = event.target.closest("[data-menu]");
    if (trigger && trigger.dataset.menu !== openMenu) showMenu(trigger.dataset.menu);
  });

  document.addEventListener("click", function (event) {
    if (openMenu && !event.target.closest(".menu")) closeMenu();
  });

  /* ---------- dialog plumbing ---------------------------------------------------- */

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      /* getClientRects beats offsetParent here: the layer is position:fixed. */
      function (node) { return !node.disabled && node.getClientRects().length > 0; }
    );
  }

  function openDialog(dialog) {
    lastFocused = document.activeElement;
    closeMenu();
    el["modal-layer"].hidden = false;

    var all = el["modal-layer"].querySelectorAll(".dialog");
    for (var i = 0; i < all.length; i++) all[i].hidden = true;

    dialog.hidden = false;
    var targets = focusables(dialog);
    if (targets.length) targets[0].focus();
  }

  function closeDialog() {
    var all = el["modal-layer"].querySelectorAll(".dialog");
    for (var i = 0; i < all.length; i++) {
      all[i].hidden = true;
      if (all[i].dataset.transient === "true") all[i].remove();
    }
    el["modal-layer"].hidden = true;
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    lastFocused = null;
  }

  el["modal-layer"].addEventListener("click", function (event) {
    if (event.target.closest("[data-close]")) {
      closeDialog();
      return;
    }
    var action = event.target.closest("[data-action]");
    if (action) runAction(action.dataset.action, action);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || el["modal-layer"].hidden) return;
    var dialog = el["modal-layer"].querySelector(".dialog:not([hidden])");
    if (!dialog) return;
    var targets = focusables(dialog);
    if (!targets.length) return;
    var first = targets[0];
    var last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  /* Build a throwaway Win98 message box. Returns the dialog element. */
  function buildDialog(title, bodyNodes, buttons) {
    var dialog = text("div", "dialog");
    dialog.dataset.transient = "true";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", title);

    var bar = text("div", "dialog-title");
    bar.appendChild(text("span", null, title));
    var x = text("button", "tb-btn tb-close dialog-x");
    x.type = "button";
    x.setAttribute("data-close", "");
    x.setAttribute("aria-label", "Close");
    bar.appendChild(x);
    dialog.appendChild(bar);

    var body = text("div", "dialog-body");
    bodyNodes.forEach(function (node) { body.appendChild(node); });

    var row = text("div", "dialog-buttons");
    buttons.forEach(function (spec) {
      var btn = text("button", "btn" + (spec.primary ? " btn-primary" : ""), spec.label);
      btn.type = "button";
      btn.addEventListener("click", function () {
        closeDialog();
        if (spec.onClick) spec.onClick();
      });
      row.appendChild(btn);
    });
    body.appendChild(row);

    dialog.appendChild(body);
    el["modal-layer"].appendChild(dialog);
    return dialog;
  }

  function paragraphs(body) {
    return String(body).split("\n").map(function (line) {
      return text("p", "dialog-text", line);
    });
  }

  function message(title, body) {
    openDialog(buildDialog(title, paragraphs(body), [{ label: "OK", primary: true }]));
  }

  function confirmDialog(title, body, onConfirm) {
    openDialog(buildDialog(title, paragraphs(body), [
      { label: "OK", primary: true, onClick: onConfirm },
      { label: "Cancel" }
    ]));
  }

  /* ---------- Add Title ------------------------------------------------------------ */

  var dlgAddTitle = document.getElementById("dlg-add-title");
  var formAddTitle = document.getElementById("form-add-title");
  var addTitleError = document.getElementById("add-title-error");

  function openAddTitle() {
    formAddTitle.reset();
    addTitleError.hidden = true;
    document.getElementById("f-rating").value = "PG-13";
    openDialog(dlgAddTitle);
  }

  formAddTitle.addEventListener("submit", function (event) {
    event.preventDefault();

    var movie = {
      title: document.getElementById("f-title").value.trim(),
      year: parseInt(document.getElementById("f-year").value, 10),
      rating: document.getElementById("f-rating").value,
      runtime: parseInt(document.getElementById("f-runtime").value, 10),
      hook: document.getElementById("f-hook").value.trim(),
      custom: true
    };

    if (!movie.title || !isFinite(movie.year) || !isFinite(movie.runtime)) {
      addTitleError.textContent = "Title, year, and runtime are all required.";
      addTitleError.hidden = false;
      sfxError();
      return;
    }

    var key = keyOf(movie);
    var clash = movies.some(function (m) { return keyOf(m) === key; });
    if (clash) {
      addTitleError.textContent = "That title and year is already in the collection.";
      addTitleError.hidden = false;
      sfxError();
      return;
    }

    if (!movie.hook) movie.hook = "No description. Living dangerously.";

    addCustomMovie(movie);
    closeDialog();
    sfxDing();
    el["crt-live"].textContent = movie.title + " added to the collection.";
  });

  /* ---------- Add Snack ------------------------------------------------------------ */

  var dlgAddSnack = document.getElementById("dlg-add-snack");
  var formAddSnack = document.getElementById("form-add-snack");
  var addSnackError = document.getElementById("add-snack-error");

  function openAddSnack() {
    formAddSnack.reset();
    addSnackError.hidden = true;
    openDialog(dlgAddSnack);
  }

  formAddSnack.addEventListener("submit", function (event) {
    event.preventDefault();

    var snack = {
      name: document.getElementById("f-snack").value.trim(),
      prep: document.getElementById("f-prep").value.trim(),
      note: document.getElementById("f-note").value.trim(),
      custom: true
    };

    if (!snack.name) {
      addSnackError.textContent = "A snack needs a name.";
      addSnackError.hidden = false;
      sfxError();
      return;
    }

    var clash = snacks.some(function (s) {
      return s.name.toLowerCase() === snack.name.toLowerCase();
    });
    if (clash) {
      addSnackError.textContent = "That snack is already in the pantry.";
      addSnackError.hidden = false;
      sfxError();
      return;
    }

    customSnacks.push(snack);
    saveCustomSnacks();
    rebuildSnacks();
    updateControls();
    closeDialog();
    sfxDing();
    el["crt-live"].textContent = snack.name + " added to the pantry.";
  });

  /* ---------- Pantry ---------------------------------------------------------------- */

  var dlgPantry = document.getElementById("dlg-pantry");

  function renderPantry() {
    el["pantry-list"].textContent = "";

    snacks.forEach(function (snack) {
      var row = text("div", "pantry-row");

      var main = text("div", "pantry-main");
      var name = text("span", "pantry-name", snack.name);
      if (snack.custom) name.appendChild(text("span", "row-badge", "★"));
      main.appendChild(name);
      if (snack.prep) main.appendChild(text("span", "pantry-prep", snack.prep));
      row.appendChild(main);

      if (snack.note) row.appendChild(text("p", "pantry-note", snack.note));

      if (snack.custom) {
        var del = text("button", "row-del pantry-del", "×");
        del.type = "button";
        del.setAttribute("aria-label", "Remove " + snack.name);
        del.addEventListener("click", function () {
          customSnacks = customSnacks.filter(function (s) { return s.name !== snack.name; });
          saveCustomSnacks();
          rebuildSnacks();
          renderPantry();
          updateControls();
        });
        row.appendChild(del);
      }

      el["pantry-list"].appendChild(row);
    });
  }

  function openPantry() {
    renderPantry();
    openDialog(dlgPantry);
  }

  /* ---------- Hidden titles ------------------------------------------------------- */

  var dlgHidden = document.getElementById("dlg-hidden");

  function renderHidden() {
    var list = hiddenTitles();
    var container = document.getElementById("hidden-list");
    container.textContent = "";

    document.getElementById("hidden-intro").textContent = list.length
      ? "These baseline titles are hidden in this browser. movies.json was never touched."
      : "Nothing is hidden right now.";
    document.getElementById("restore-all").disabled = !list.length;

    list.forEach(function (movie) {
      var row = text("div", "pantry-row");

      var main = text("div", "pantry-main");
      main.appendChild(text("span", "pantry-name", movie.title));
      main.appendChild(text("span", "pantry-prep", movie.year + " · " + movie.rating));
      row.appendChild(main);

      var restore = text("button", "btn restore-btn", "Restore");
      restore.type = "button";
      restore.setAttribute("aria-label", "Restore " + movie.title);
      restore.addEventListener("click", function () {
        restoreMovie(movie);
        renderHidden();
      });
      row.appendChild(restore);

      container.appendChild(row);
    });
  }

  function openHidden() {
    renderHidden();
    openDialog(dlgHidden);
  }

  document.getElementById("restore-all").addEventListener("click", function () {
    restoreAll();
    renderHidden();
  });

  /* ---------- Filters ---------------------------------------------------------------- */

  var dlgFilters = document.getElementById("dlg-filters");
  var formFilters = document.getElementById("form-filters");

  function buildRatingChecks() {
    el["rating-checks"].textContent = "";
    RATINGS.forEach(function (rating) {
      var label = text("label", "check-inline");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.value = rating;
      box.className = "rating-check";
      label.appendChild(box);
      label.appendChild(text("span", null, rating));
      el["rating-checks"].appendChild(label);
    });
  }

  function openFilters() {
    var boxes = el["rating-checks"].querySelectorAll(".rating-check");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = settings.ratings.indexOf(boxes[i].value) >= 0;
    }
    el["f-maxrun"].value = settings.maxRuntime;
    el["maxrun-out"].textContent = settings.maxRuntime >= RUNTIME_MAX ? "any" : settings.maxRuntime;
    openDialog(dlgFilters);
  }

  el["f-maxrun"].addEventListener("input", function () {
    var value = parseInt(el["f-maxrun"].value, 10);
    el["maxrun-out"].textContent = value >= RUNTIME_MAX ? "any" : value;
  });

  formFilters.addEventListener("submit", function (event) {
    event.preventDefault();

    var chosen = [];
    var boxes = el["rating-checks"].querySelectorAll(".rating-check");
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) chosen.push(boxes[i].value);
    }

    if (!chosen.length) {
      sfxError();
      message("No Ratings Selected",
        "Leaving every rating unchecked would filter out the entire collection.\n\nPick at least one.");
      return;
    }

    settings.ratings = chosen;
    settings.maxRuntime = parseInt(el["f-maxrun"].value, 10);
    saveSettings();
    updateStatus();
    closeDialog();
  });

  document.getElementById("filters-clear").addEventListener("click", function () {
    settings.ratings = RATINGS.slice();
    settings.maxRuntime = RUNTIME_MAX;
    saveSettings();
    updateStatus();
    openFilters();
  });

  /* ---------- Export / Import -------------------------------------------------------- */

  function exportCollection() {
    var payload = {
      app: "MovieMatic 98",
      version: 1,
      customMovies: customMovies,
      customSnacks: customSnacks,
      hidden: Object.keys(hidden),
      watched: Object.keys(watched)
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "moviematic98-collection.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

    message("Export Complete",
      "Saved moviematic98-collection.json with " + plural(customMovies.length, "custom title") +
      ", " + plural(customSnacks.length, "custom snack") + ", and " +
      plural(Object.keys(watched).length, "watched mark") + ".");
  }

  function importCollection(data) {
    if (!data || typeof data !== "object") throw new Error("not an object");

    var addedMovies = 0;
    var addedSnacks = 0;

    if (Array.isArray(data.customMovies)) {
      data.customMovies.forEach(function (m) {
        if (!m || !m.title || !isFinite(m.year) || !isFinite(m.runtime)) return;
        var candidate = {
          title: String(m.title),
          year: parseInt(m.year, 10),
          rating: RATINGS.indexOf(m.rating) >= 0 ? m.rating : "NR",
          runtime: parseInt(m.runtime, 10),
          hook: m.hook ? String(m.hook) : "Imported without a description.",
          custom: true
        };
        var key = keyOf(candidate);
        if (movies.some(function (x) { return keyOf(x) === key; })) return;
        customMovies.push(candidate);
        rebuildMovies();
        addedMovies++;
      });
    }

    if (Array.isArray(data.customSnacks)) {
      data.customSnacks.forEach(function (s) {
        if (!s || !s.name) return;
        var name = String(s.name);
        if (snacks.some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })) return;
        customSnacks.push({
          name: name,
          prep: s.prep ? String(s.prep) : "",
          note: s.note ? String(s.note) : "",
          custom: true
        });
        rebuildSnacks();
        addedSnacks++;
      });
    }

    if (Array.isArray(data.watched)) {
      data.watched.forEach(function (k) {
        if (typeof k === "string") watched[k] = true;
      });
    }

    if (Array.isArray(data.hidden)) {
      data.hidden.forEach(function (k) {
        if (typeof k === "string") hidden[k] = true;
      });
    }

    saveCustomMovies();
    saveCustomSnacks();
    saveHidden();
    saveWatched();
    rebuildMovies();
    rebuildSnacks();
    renderList();
    updateStatus();
    updateControls();

    message("Import Complete",
      "Added " + plural(addedMovies, "title") + " and " + plural(addedSnacks, "snack") +
      ".\n\nDuplicates were skipped.");
  }

  el["import-file"].addEventListener("change", function () {
    var file = el["import-file"].files && el["import-file"].files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
      try {
        importCollection(JSON.parse(reader.result));
      } catch (err) {
        sfxError();
        message("Import Failed", "That file is not a MovieMatic 98 collection, or the JSON is malformed.");
      }
      el["import-file"].value = "";
    };
    reader.onerror = function () {
      sfxError();
      message("Import Failed", "The file could not be read.");
      el["import-file"].value = "";
    };
    reader.readAsText(file);
  });

  /* ---------- Help content ------------------------------------------------------------ */

  var EXCUSE_OPENERS = [
    "We can't watch tonight because",
    "Movie night is postponed because",
    "Regrettably,",
    "According to the household bylaws,",
    "The projector union says"
  ];

  var EXCUSE_MIDDLES = [
    "the remote has achieved sentience and",
    "somebody started a load of laundry and",
    "the dog looked at the couch in a way that suggested",
    "there is exactly one blanket left and",
    "the popcorn situation is unresolved, so",
    "a group chat is happening and"
  ];

  var EXCUSE_ENDINGS = [
    "we are legally required to scroll for another 40 minutes.",
    "everyone must first re-read the plot summary out loud.",
    "the volume has to be set to an even number and it refuses.",
    "someone has already fallen asleep in protest.",
    "we are now watching the trailer for a different movie instead.",
    "the couch has been claimed and will not be relinquished."
  ];

  function showExcuse() {
    var excuse = randomOf(EXCUSE_OPENERS) + " " + randomOf(EXCUSE_MIDDLES) + " " +
      randomOf(EXCUSE_ENDINGS);

    var nodes = paragraphs(excuse);
    openDialog(buildDialog("Excuse Generator", nodes, [
      { label: "Another", primary: true, onClick: showExcuse },
      { label: "Fine" }
    ]));
  }

  function showAbout() {
    var body = text("div", "about");
    body.appendChild(text("p", "about-title", "MovieMatic 98"));
    body.appendChild(text("p", "dialog-text", "Version 1.1 · Family Movie Night Edition"));
    body.appendChild(text("hr", "about-rule"));

    var rows = [
      ["Titles installed", String(movies.length)],
      ["Custom titles", String(customMovies.length)],
      ["Hidden titles", String(hiddenTitles().length)],
      ["Snacks in pantry", String(snacks.length)],
      ["Watched", String(Object.keys(watched).length)],
      ["Vetoed tonight", String(Object.keys(vetoed).length)],
      ["Physical memory", "640K (ought to be enough)"],
      ["Arguments avoided", "Countless"]
    ];

    var table = text("div", "about-grid");
    rows.forEach(function (pair) {
      table.appendChild(text("span", "about-key", pair[0] + ":"));
      table.appendChild(text("span", "about-val", pair[1]));
    });
    body.appendChild(table);

    openDialog(buildDialog("About MovieMatic 98", [body], [{ label: "OK", primary: true }]));
  }

  function showShortcuts() {
    var list = text("div", "about-grid");
    [
      ["P or Space", "Pick a movie"],
      ["D", "Double feature"],
      ["S", "Roll a snack"],
      ["W", "Mark selected watched"],
      ["V", "Veto selected"],
      ["Arrow keys", "Move through the list"],
      ["Esc", "Close a dialog or menu"]
    ].forEach(function (pair) {
      list.appendChild(text("span", "about-key", pair[0]));
      list.appendChild(text("span", "about-val", pair[1]));
    });

    openDialog(buildDialog("Keyboard Shortcuts", [list], [{ label: "OK", primary: true }]));
  }

  /* ---------- Easter eggs -------------------------------------------------------------- */

  function shutDown() {
    closeMenu();
    el.shutdown.hidden = false;
    tone(392, 300, 0.05);
  }

  el.shutdown.addEventListener("click", function () {
    el.shutdown.hidden = true;
    sfxBoot();
  });

  function blueScreen() {
    el.bsod.hidden = false;
    sfxError();
  }

  function dismissBsod() {
    if (el.bsod.hidden) return;
    el.bsod.hidden = true;
    sfxBoot();
  }

  el.bsod.addEventListener("click", dismissBsod);

  el["tb-close"].addEventListener("click", blueScreen);

  el["tb-min"].addEventListener("click", function () {
    el.window.classList.toggle("is-minimized");
    tone(330, 60, 0.03);
  });

  el["tb-max"].addEventListener("click", function () {
    el.window.classList.toggle("is-maximized");
    tone(440, 60, 0.03);
  });

  /* ---------- action router ------------------------------------------------------------- */

  function runAction(action, node) {
    switch (action) {
      case "add-title":        closeMenu(); openAddTitle(); break;
      case "add-snack":        closeMenu(); openAddSnack(); break;
      case "restore-hidden":   closeMenu(); openHidden(); break;
      case "export":           closeMenu(); exportCollection(); break;
      case "import":           closeMenu(); el["import-file"].click(); break;
      case "shutdown":         shutDown(); break;
      case "theme":
        settings.theme = node.dataset.theme;
        saveSettings();
        applyTheme();
        closeMenu();
        break;
      case "toggle-scanlines":
        settings.scanlines = !settings.scanlines;
        saveSettings();
        applyScanlines();
        closeMenu();
        break;
      case "toggle-sound":
        settings.sound = !settings.sound;
        saveSettings();
        syncMenuChecks();
        closeMenu();
        if (settings.sound) sfxBoot();
        break;
      case "filters":          closeMenu(); openFilters(); break;
      case "roll-snack":       closeMenu(); rollSnack(); break;
      case "pantry":           closeMenu(); openPantry(); break;
      case "shortcuts":        closeMenu(); showShortcuts(); break;
      case "excuse":           closeMenu(); showExcuse(); break;
      case "about":            closeMenu(); showAbout(); break;
      default: break;
    }
  }

  document.addEventListener("click", function (event) {
    var node = event.target.closest("[data-action]");
    if (!node) return;
    if (node.closest(".modal-layer")) return; /* handled by the modal listener */
    runAction(node.dataset.action, node);
  });

  /* ---------- wiring ------------------------------------------------------------ */

  el["btn-pick"].addEventListener("click", pick);
  el["btn-double"].addEventListener("click", doubleFeature);
  el["btn-snack"].addEventListener("click", rollSnack);
  el["btn-reset"].addEventListener("click", reset);
  el["btn-veto"].addEventListener("click", vetoSelected);
  el["skip-watched"].addEventListener("change", updateStatus);

  el["btn-watched"].addEventListener("click", function () {
    if (spinning || selectedIndex < 0) return;
    setWatched(selectedIndex, true);
    el["crt-live"].textContent = movies[selectedIndex].title + " marked as watched.";
  });

  document.addEventListener("keydown", function (event) {
    if (!el.bsod.hidden) {
      event.preventDefault();
      dismissBsod();
      return;
    }
    if (!el.shutdown.hidden) {
      event.preventDefault();
      el.shutdown.hidden = true;
      sfxBoot();
      return;
    }

    if (event.key === "Escape") {
      if (!el["modal-layer"].hidden) closeDialog();
      else closeMenu();
      return;
    }

    /* Single-key shortcuts stay out of the way of typing and dialogs. */
    if (!el["modal-layer"].hidden) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    var tag = event.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    var key = event.key.toLowerCase();
    if (key === "p" || (event.key === " " && event.target === document.body)) {
      event.preventDefault();
      pick();
    } else if (key === "d") {
      doubleFeature();
    } else if (key === "s") {
      rollSnack();
    } else if (key === "w") {
      el["btn-watched"].click();
    } else if (key === "v") {
      vetoSelected();
    }
  });

  /* ---------- boot ---------------------------------------------------------------- */

  function disableAll() {
    el["btn-pick"].disabled = true;
    el["btn-double"].disabled = true;
    el["btn-snack"].disabled = true;
    el["btn-watched"].disabled = true;
    el["btn-veto"].disabled = true;
    el["btn-reset"].disabled = true;
    el["skip-watched"].disabled = true;
  }

  function failToLoad() {
    el.listbox.textContent = "";
    el.listbox.appendChild(text("p", "listbox-error", "Could not load movies.json"));

    showError("Could not load movies.json", "Check that the file exists and is valid JSON.");
    el["status-titles"].textContent = "0 titles";
    el["status-watched"].textContent = "0 watched";
    el["status-pool"].textContent = "0 in pool";
    disableAll();
  }

  async function loadJSON(path) {
    var response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    var data = await response.json();
    if (!Array.isArray(data) || !data.length) throw new Error(path + " is empty");
    return data;
  }

  async function init() {
    watched = loadWatched();
    hidden = loadHidden();
    loadSettings();
    applyTheme();
    applyScanlines();
    buildRatingChecks();
    showIdle();
    disableAll();

    customMovies = readJSON(STORAGE.movies, []);
    if (!Array.isArray(customMovies)) customMovies = [];
    customMovies.forEach(function (m) { m.custom = true; });

    customSnacks = readJSON(STORAGE.snacks, []);
    if (!Array.isArray(customSnacks)) customSnacks = [];
    customSnacks.forEach(function (s) { s.custom = true; });

    try {
      baseMovies = await loadJSON("movies.json");
    } catch (err) {
      failToLoad();
      return;
    }

    try {
      baseSnacks = await loadJSON("snacks.json");
    } catch (err) {
      /* Snacks are a bonus feature; the picker still works without them. */
      baseSnacks = [];
      el["snack-text"].textContent = "Pantry unavailable — add your own under Snacks.";
    }

    rebuildMovies();
    rebuildSnacks();
    renderList();
    updateStatus();
    updateControls();
  }

  init();
})();
