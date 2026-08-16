/* ==========================================================================
   MovieMatic 98 - movie night picker
   Vanilla JS, no dependencies. Data lives in movies.json.
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "moviematic98:watched:v1";

  /* Slot machine timing. The winner is decided before any of this runs. */
  var SPIN_START_DELAY = 55;   // ms between title flips at full speed
  var SPIN_HOLD_MS = 1200;     // hold full speed this long before slowing
  var SPIN_FACTOR = 1.28;      // delay multiplier once slowing begins
  var SPIN_MAX_DELAY = 340;    // once the delay passes this, land on the winner

  var movies = [];
  var watched = Object.create(null);
  var selectedIndex = -1;
  var spinning = false;
  var spinTimer = null;

  var el = {
    listbox: document.getElementById("listbox"),
    crt: document.getElementById("crt"),
    kicker: document.getElementById("crt-kicker"),
    title: document.getElementById("crt-title"),
    meta: document.getElementById("crt-meta"),
    hook: document.getElementById("crt-hook"),
    live: document.getElementById("crt-live"),
    skip: document.getElementById("skip-watched"),
    pick: document.getElementById("btn-pick"),
    markWatched: document.getElementById("btn-watched"),
    reset: document.getElementById("btn-reset"),
    statusTitles: document.getElementById("status-titles"),
    statusWatched: document.getElementById("status-watched")
  };

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

  /* ---------- persistence ------------------------------------------------- */

  function loadWatched() {
    var store = Object.create(null);
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return store;
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(function (k) {
          if (typeof k === "string") store[k] = true;
        });
      }
    } catch (err) {
      /* Corrupt or unavailable storage just means we start fresh. */
    }
    return store;
  }

  function saveWatched() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.keys(watched)));
    } catch (err) {
      /* Private mode / full quota: the app still works for this session. */
    }
  }

  /* ---------- CRT rendering ------------------------------------------------ */

  function showIdle() {
    el.crt.classList.remove("is-error");
    el.kicker.textContent = "SELECTION";
    el.title.textContent = "READY";
    if (!prefersReducedMotion()) {
      var caret = document.createElement("span");
      caret.className = "caret";
      caret.textContent = "_";
      el.title.appendChild(caret);
    } else {
      el.title.textContent = "READY_";
    }
    el.meta.textContent = "";
    el.hook.textContent = "";
  }

  function showMovie(movie, kicker, announce) {
    el.crt.classList.remove("is-error");
    el.kicker.textContent = kicker || "SELECTION";
    el.title.textContent = movie.title;
    el.meta.textContent = movie.year + "  •  " + movie.rating + "  •  " + movie.runtime + " MIN";
    el.hook.textContent = movie.hook;
    if (announce) {
      el.live.textContent = movie.title + ", " + movie.year + ", rated " + movie.rating +
        ", " + movie.runtime + " minutes. " + movie.hook;
    }
  }

  function showError(message) {
    el.crt.classList.add("is-error");
    el.kicker.textContent = "ERROR";
    el.title.textContent = message;
    el.meta.textContent = "";
    el.hook.textContent = "Check that the file exists and is valid JSON.";
    el.live.textContent = message;
  }

  /* ---------- list rendering ------------------------------------------------ */

  function renderList() {
    el.listbox.textContent = "";

    movies.forEach(function (movie, index) {
      var row = document.createElement("div");
      row.className = "row";
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "0");
      row.dataset.index = String(index);

      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "row-check";
      check.checked = !!watched[keyOf(movie)];
      check.setAttribute("aria-label", "Watched: " + movie.title);

      var title = document.createElement("span");
      title.className = "row-title";
      title.textContent = movie.title;

      var year = document.createElement("span");
      year.className = "row-year";
      year.textContent = movie.year;

      row.appendChild(check);
      row.appendChild(title);
      row.appendChild(year);
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
      var isSelected = i === selectedIndex;

      rows[i].classList.toggle("is-watched", isWatched);
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
    el.statusTitles.textContent = plural(movies.length, "title");
    el.statusWatched.textContent = count + " watched";
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
    el.pick.disabled = spinning || !hasMovies;
    el.markWatched.disabled = spinning || selectedIndex < 0;
    el.reset.disabled = spinning || !hasMovies;
    el.skip.disabled = spinning || !hasMovies;
  }

  /* ---------- picking --------------------------------------------------------- */

  function buildPool() {
    if (!el.skip.checked) return movies.slice();
    var unwatched = movies.filter(function (m) {
      return !watched[keyOf(m)];
    });
    /* Never dead-end: if everything is watched, fall back to the full list. */
    return unwatched.length ? unwatched : movies.slice();
  }

  function land(winner) {
    spinning = false;
    spinTimer = null;
    selectedIndex = movies.indexOf(winner);
    syncRows();
    showMovie(winner, "TONIGHT'S PICK", true);
    updateControls();

    var row = el.listbox.querySelector('.row[data-index="' + selectedIndex + '"]');
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function pick() {
    if (spinning || !movies.length) return;

    var pool = buildPool();
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

  function reset() {
    if (spinning) return;
    watched = Object.create(null);
    saveWatched();
    selectedIndex = -1;
    syncRows();
    updateStatus();
    showIdle();
    el.live.textContent = "Watched list cleared.";
    updateControls();
  }

  /* ---------- wiring ------------------------------------------------------------ */

  el.pick.addEventListener("click", pick);

  el.markWatched.addEventListener("click", function () {
    if (spinning || selectedIndex < 0) return;
    setWatched(selectedIndex, true);
    el.live.textContent = movies[selectedIndex].title + " marked as watched.";
  });

  el.reset.addEventListener("click", reset);

  /* ---------- boot ---------------------------------------------------------------- */

  function disableAll() {
    el.pick.disabled = true;
    el.markWatched.disabled = true;
    el.reset.disabled = true;
    el.skip.disabled = true;
  }

  function failToLoad() {
    el.listbox.textContent = "";
    var msg = document.createElement("p");
    msg.className = "listbox-error";
    msg.textContent = "Could not load movies.json";
    el.listbox.appendChild(msg);

    showError("Could not load movies.json");
    el.statusTitles.textContent = "0 titles";
    el.statusWatched.textContent = "0 watched";
    disableAll();
  }

  async function init() {
    watched = loadWatched();
    showIdle();
    disableAll();

    try {
      var response = await fetch("movies.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("HTTP " + response.status);

      var data = await response.json();
      if (!Array.isArray(data) || !data.length) throw new Error("movies.json is empty");

      movies = data;
      renderList();
      updateStatus();
      updateControls();
    } catch (err) {
      failToLoad();
    }
  }

  init();
})();
