/**
 * Static status display for the local fs-kaihen card.
 *
 * The runner calls phase() between payload invocations and attempt() at the
 * beginning of each filesystem attempt, before its race wave starts.
 * Rendering has no timer, animation, or per-log path during a race.
 */
const UI_BUILD_VERSION = "0.0.4";

export function createLocalHackUI(uiVersion, uiBuildId) {
    "use strict";

    if (typeof document === "undefined" || !document.body) {
        const noop = function () {};
        return {available: false, error: "document.body unavailable",
            waitForStart: function () { return Promise.reject(Error("Status screen unavailable")); },
            beginRun: noop, offerRetry: function () { return false; },
            phase: noop, milestone: noop,
            attempt: noop, finish: noop, enableLogToggle: noop, refreshLogs: noop,
            logsOpen: function () { return false; }, dispose: noop};
    }

    const VIEW = {width: 1280, height: 720};
    const INPUT_POLL_MS = 40;
    const GAMEPAD_BUTTON = {a: 1, x: 3, minus: 8};
    const HID_BUTTON = {a: 0x1n, x: 0x4n, minus: 0x800n};
    const states = {
        intro: {label: "LOCAL START", title: "Start kaiHEN",
            detail: "Filesystem access, SD checks, then kaiHEN.",
            instruction: "Start when ready."},
        loading: {index: 0, label: "STARTING", title: "Loading kaiHEN",
            detail: "Preparing filesystem access.", instruction: "Please wait."},
        fs: {index: 1, label: "FILESYSTEM ACCESS", title: "Establishing access",
            detail: "This step can take several minutes.",
            instruction: "The attempt number changes before each retry."},
        files: {index: 2, label: "PREPARATION", title: "Checking startup files",
            detail: "Required SD files are being checked.", instruction: "Please wait."},
        hen: {index: 3, label: "KAIHEN START", title: "Starting kaiHEN",
            detail: "The final stage is running.", instruction: "Please wait."},
        success: {label: "SUCCESS", title: "kaiHEN is active",
            detail: "Fully close Civilization VII now.",
            instruction: "Leave the console powered on."},
        failure: {label: "START ENDED", title: "Start failed",
            detail: "Start could not be completed.",
            instruction: "Fully restart the console before trying again."},
        unconfirmed: {label: "RESULT UNCONFIRMED", title: "Start not confirmed",
            detail: "No clear completion record is available.",
            instruction: "Fully restart the console."}
    };
    const milestones = {
        "hen-prep": {order: 1, label: "KAIHEN START", title: "Preparing kaiHEN",
            detail: "Filesystem session retained.", instruction: "Please wait."},
        "files-verified": {order: 2, label: "PREPARATION",
            title: "Startup files verified", detail: "Continuing local startup.",
            instruction: "Please wait."},
        handoff: {order: 3, label: "KAIHEN START", title: "Finalizing kaiHEN",
            detail: "Launch handoff verified.", instruction: "Please wait."}
    };

    const root = document.createElement("section");
    root.id = "fs-kaihen-status";
    root.setAttribute("lang", "en");
    root.setAttribute("aria-label", "kaiHEN startup status");
    root.setAttribute("data-reached", "intro");
    root.setAttribute("data-result", "idle");
    root.setAttribute("data-view", "status");
    root.setAttribute("data-mode", "intro");
    for (const name of ["fs", "files", "hen"])
        root.setAttribute("data-step-" + name, "pending");

    const style = document.createElement("style");
    style.textContent = `
        #fs-kaihen-status {
            all: initial; position: fixed !important; display: block !important;
            top: 0 !important; right: 0 !important;
            bottom: 0 !important; left: 0 !important;
            z-index: 2147483647 !important; overflow: hidden !important;
            pointer-events: none !important; background: #111418 !important;
            color: #ece9e2 !important;
        }
        #fs-kaihen-status * {
            box-sizing: border-box !important; margin: 0 !important;
            padding: 0 !important;
            font-family: BodyFont, BodyFont-JP, Arial, sans-serif !important;
            font-style: normal !important; text-shadow: none !important;
        }
        #fs-kaihen-status .kh-screen {
            position: absolute !important; width: 1280px !important;
            height: 720px !important; overflow: hidden !important;
            background: radial-gradient(ellipse at 50% 46%,
                #171b20 0%, #111418 69%, #0e1115 100%) !important;
        }
        #fs-kaihen-status .kh-wordmark {
            position: absolute !important; left: 50px !important;
            top: 25px !important; color: #ebe8e1 !important;
            font-size: 31px !important; line-height: 38px !important;
            font-family: BodyFont, BodyFont-JP, Arial, sans-serif !important;
            font-weight: 700 !important; letter-spacing: .3px !important;
        }
        #fs-kaihen-status .kh-build {
            position: absolute !important; right: 50px !important;
            top: 31px !important; color: #90989b !important;
            font-size: 17px !important; line-height: 26px !important;
            font-family: monospace !important;
        }
        #fs-kaihen-status .kh-rail {
            position: absolute !important; left: 170px !important;
            right: 170px !important; top: 150px !important;
            display: flex !important; justify-content: space-between !important;
            color: #697176 !important; font-size: 18px !important;
            line-height: 28px !important; letter-spacing: 1px !important;
        }
        #fs-kaihen-status .kh-step {
            width: 260px !important; text-align: center !important;
            border-bottom: 2px solid #697176 !important;
            padding-bottom: 8px !important;
        }
        #fs-kaihen-status[data-step-fs="running"] .kh-step-fs,
        #fs-kaihen-status[data-step-files="running"] .kh-step-files,
        #fs-kaihen-status[data-step-hen="running"] .kh-step-hen {
            color: #ece9e2 !important; border-color: #ece9e2 !important;
        }
        #fs-kaihen-status[data-step-fs="verified"] .kh-step-fs,
        #fs-kaihen-status[data-step-files="verified"] .kh-step-files,
        #fs-kaihen-status[data-step-hen="verified"] .kh-step-hen {
            color: #c7e6a2 !important; border-color: #c7e6a2 !important;
        }
        #fs-kaihen-status[data-step-fs="failure"] .kh-step-fs,
        #fs-kaihen-status[data-step-files="failure"] .kh-step-files,
        #fs-kaihen-status[data-step-hen="failure"] .kh-step-hen,
        #fs-kaihen-status[data-step-fs="unconfirmed"] .kh-step-fs,
        #fs-kaihen-status[data-step-files="unconfirmed"] .kh-step-files,
        #fs-kaihen-status[data-step-hen="unconfirmed"] .kh-step-hen {
            color: #d7a650 !important; border-color: #d7a650 !important;
        }
        #fs-kaihen-status .kh-top-rule,
        #fs-kaihen-status .kh-bottom-rule {
            position: absolute !important; left: 45px !important;
            right: 45px !important; height: 1px !important;
            background: #697176 !important; opacity: .75 !important;
        }
        #fs-kaihen-status .kh-top-rule { top: 76px !important; }
        #fs-kaihen-status .kh-bottom-rule { top: 635px !important; }
        #fs-kaihen-status .kh-ring {
            position: absolute !important; left: 328px !important;
            top: 291px !important; width: 130px !important;
            height: 130px !important; border-radius: 50% !important;
            border: 3px solid #6d767a !important;
            border-top-color: #d4ed9a !important;
        }
        #fs-kaihen-status .kh-count {
            position: absolute !important; left: 0 !important;
            top: 0 !important; width: 100% !important; height: 100% !important;
            color: #c8c4be !important; text-align: center !important;
            font-family: BodyFont, BodyFont-JP, Arial, sans-serif !important;
            font-size: 34px !important; line-height: 124px !important;
            font-weight: 400 !important;
        }
        #fs-kaihen-status[data-mode="intro"] .kh-count { display: none !important; }
        #fs-kaihen-status .kh-symbol {
            display: none !important; position: absolute !important;
            top: 0 !important; right: 0 !important;
            bottom: 0 !important; left: 0 !important;
            align-items: center !important;
            justify-content: center !important; font-size: 58px !important;
            line-height: 1 !important; font-weight: 700 !important;
            font-family: BodyFont, BodyFont-JP, Arial, sans-serif !important;
        }
        #fs-kaihen-status[data-result="success"] .kh-ring,
        #fs-kaihen-status[data-result="failure"] .kh-ring,
        #fs-kaihen-status[data-result="unconfirmed"] .kh-ring {
            border-color: currentColor !important;
        }
        #fs-kaihen-status[data-result="success"] .kh-ring { color: #c7e6a2 !important; }
        #fs-kaihen-status[data-result="failure"] .kh-ring,
        #fs-kaihen-status[data-result="unconfirmed"] .kh-ring { color: #d7a650 !important; }
        #fs-kaihen-status[data-result="success"] .kh-symbol,
        #fs-kaihen-status[data-result="failure"] .kh-symbol,
        #fs-kaihen-status[data-result="unconfirmed"] .kh-symbol { display: flex !important; }
        #fs-kaihen-status[data-result="success"] .kh-symbol {
            display: block !important; top: 34px !important;
            left: 46px !important; right: auto !important;
            bottom: auto !important; width: 30px !important;
            height: 50px !important;
            border-right: 6px solid currentColor !important;
            border-bottom: 6px solid currentColor !important;
            transform: rotate(45deg) !important;
        }
        #fs-kaihen-status[data-result="success"] .kh-count,
        #fs-kaihen-status[data-result="failure"] .kh-count,
        #fs-kaihen-status[data-result="unconfirmed"] .kh-count { display: none !important; }
        #fs-kaihen-status .kh-message {
            position: absolute !important; left: 500px !important;
            top: 283px !important; width: 735px !important;
        }
        #fs-kaihen-status .kh-label {
            color: #e7e4dc !important; font-family: Georgia, serif !important;
            font-size: 19px !important; line-height: 30px !important;
            letter-spacing: 1px !important;
        }
        #fs-kaihen-status .kh-title {
            margin-top: 12px !important; color: #ece9e2 !important;
            font-size: 46px !important; line-height: 60px !important;
            font-weight: 400 !important; letter-spacing: .2px !important;
            white-space: nowrap !important;
        }
        #fs-kaihen-status .kh-detail {
            margin-top: 2px !important; color: #90989b !important;
            font-size: 28px !important; line-height: 40px !important;
            font-weight: 400 !important; white-space: nowrap !important;
        }
        #fs-kaihen-status .kh-instruction {
            position: absolute !important; left: 50px !important;
            top: 654px !important; color: #c8c4be !important;
            font-size: 22px !important; line-height: 34px !important;
        }
        #fs-kaihen-status .kh-view-hint {
            position: absolute !important; right: 50px !important;
            top: 654px !important; color: #90989b !important;
            display: flex !important; align-items: center !important;
            font-size: 20px !important;
            line-height: 34px !important;
        }
        #fs-kaihen-status .kh-keycap {
            display: inline-flex !important; align-items: center !important;
            justify-content: center !important; flex: 0 0 32px !important;
            width: 32px !important; height: 32px !important;
            border: 2px solid currentColor !important;
            border-radius: 50% !important; font-size: 18px !important;
            line-height: 1 !important; font-weight: 600 !important;
        }
        #fs-kaihen-status .kh-keycap-minus {
            font-size: 22px !important;
        }
        #fs-kaihen-status .kh-keycap-minus .kh-keycap-mark {
            position: relative !important; top: 2px !important;
        }
        #fs-kaihen-status .kh-key-label {
            margin-left: 10px !important;
        }
        #fs-kaihen-status .kh-start,
        #fs-kaihen-status .kh-retry {
            display: none !important; position: absolute !important;
            top: 556px !important; width: 300px !important; height: 54px !important;
            padding: 0 20px !important; border: 1px solid #d7a650 !important;
            background: #20252a !important; color: #ece9e2 !important;
            border-radius: 4px !important; text-align: center !important;
            align-items: center !important; justify-content: center !important;
            font-size: 21px !important;
            line-height: 52px !important;
            pointer-events: auto !important; left: 500px !important;
        }
        #fs-kaihen-status[data-mode="intro"] .kh-start,
        #fs-kaihen-status[data-retry="available"] .kh-retry,
        #fs-kaihen-status[data-retry="armed"] .kh-retry {
            display: flex !important;
        }
        #fs-kaihen-status[data-retry="armed"] .kh-retry {
            border-color: #ece9e2 !important;
        }
        #fs-kaihen-status[data-retry="requested"] .kh-retry {
            opacity: .6 !important; pointer-events: none !important;
        }
        #fs-kaihen-status .kh-guide {
            display: none !important; position: absolute !important;
            left: 500px !important; top: 440px !important;
            width: 680px !important; color: #b8bfc0 !important;
            font-size: 20px !important; line-height: 28px !important;
        }
        #fs-kaihen-status[data-mode="intro"] .kh-guide { display: block !important; }
        #fs-kaihen-status .kh-log-view {
            display: none !important; position: absolute !important;
            top: 0 !important; left: 0 !important;
            width: 1280px !important; height: 720px !important;
            background: #050607 !important; color: #f0f0ed !important;
        }
        #fs-kaihen-status[data-view="logs"] .kh-log-view {
            display: block !important;
        }
        #fs-kaihen-status .kh-log-title {
            position: absolute !important; top: 20px !important;
            left: 24px !important; font-size: 20px !important;
            line-height: 28px !important;
        }
        #fs-kaihen-status .kh-log-content {
            position: absolute !important; top: 58px !important;
            left: 24px !important; width: 1232px !important;
            height: 608px !important; overflow: hidden !important;
            font-family: monospace !important; font-size: 14px !important;
            line-height: 18px !important; white-space: pre !important;
        }
        #fs-kaihen-status .kh-log-hint {
            position: absolute !important; top: 676px !important;
            left: 24px !important; display: flex !important;
            align-items: center !important;
            font-size: 18px !important;
        }
        #fs-kaihen-status .kh-log-action {
            display: inline-flex !important; align-items: center !important;
        }
        #fs-kaihen-status .kh-log-divider {
            margin: 0 14px !important;
        }
        #fs-kaihen-status:not([data-mode="intro"]) .kh-log-start,
        #fs-kaihen-status:not([data-mode="intro"]) .kh-log-divider {
            display: none !important;
        }
    `;
    root.appendChild(style);

    function add(parent, className, value) {
        const element = document.createElement("div");
        element.className = className;
        if (value !== undefined) element.textContent = value;
        parent.appendChild(element);
        return element;
    }

    /** Render the same outlined key glyph for every visible control hint. */
    function addKeyLabel(parent, key, label) {
        const glyph = document.createElement("span");
        glyph.className = "kh-keycap" + (key === "−" ? " kh-keycap-minus" : "");
        const mark = document.createElement("span");
        mark.className = "kh-keycap-mark";
        mark.textContent = key;
        glyph.appendChild(mark);
        parent.appendChild(glyph);
        const caption = document.createElement("span");
        caption.className = "kh-key-label";
        caption.textContent = label;
        parent.appendChild(caption);
    }

    const screen = add(root, "kh-screen");
    const viewportWidth = Number(globalThis.innerWidth) || VIEW.width;
    const viewportHeight = Number(globalThis.innerHeight) || VIEW.height;
    const scale = Math.min(viewportWidth / VIEW.width, viewportHeight / VIEW.height);
    screen.style.left = (viewportWidth - VIEW.width * scale) / 2 + "px";
    screen.style.top = (viewportHeight - VIEW.height * scale) / 2 + "px";
    screen.style.transformOrigin = "top left";
    screen.style.transform = "scale(" + scale + ")";

    add(screen, "kh-wordmark", "CivSwitchFS-kaiHEN");
    add(screen, "kh-build", "UI build v" + String(uiVersion || UI_BUILD_VERSION) +
        (uiBuildId ? " / " + String(uiBuildId) : ""));
    add(screen, "kh-top-rule");
    const rail = add(screen, "kh-rail");
    add(rail, "kh-step kh-step-fs", "FILESYSTEM");
    add(rail, "kh-step kh-step-files", "SD FILES");
    add(rail, "kh-step kh-step-hen", "KAIHEN");
    const ring = add(screen, "kh-ring");
    const count = add(ring, "kh-count", "00");
    const symbol = add(ring, "kh-symbol");
    const message = add(screen, "kh-message");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    const label = add(message, "kh-label", states.intro.label);
    const title = add(message, "kh-title", states.intro.title);
    const detail = add(message, "kh-detail", states.intro.detail);
    add(screen, "kh-guide", "This runs locally and may take several minutes. " +
        "Frequent view switching may affect timing; this has not been confirmed. " +
        "Check the result before closing the game.");
    add(screen, "kh-bottom-rule");
    const instruction = add(screen, "kh-instruction", states.intro.instruction);
    const viewHint = add(screen, "kh-view-hint");
    addKeyLabel(viewHint, "−", "Logs");
    const startButton = document.createElement("button");
    startButton.className = "kh-start";
    addKeyLabel(startButton, "A", "Start");
    startButton.setAttribute("type", "button");
    startButton.setAttribute("aria-label", "A: Start kaiHEN");
    screen.appendChild(startButton);
    const retryButton = document.createElement("button");
    retryButton.className = "kh-retry";
    addKeyLabel(retryButton, "X", "Try again");
    retryButton.setAttribute("type", "button");
    retryButton.setAttribute("aria-label", "X: Try again");
    screen.appendChild(retryButton);
    const logView = add(screen, "kh-log-view");
    add(logView, "kh-log-title", "FS-kaiHEN / LOG");
    const logContent = document.createElement("pre");
    logContent.className = "kh-log-content";
    logView.appendChild(logContent);
    const logHint = add(logView, "kh-log-hint");
    const logStart = add(logHint, "kh-log-action kh-log-start");
    addKeyLabel(logStart, "A", "Start");
    add(logHint, "kh-log-divider", "|");
    const logStatus = add(logHint, "kh-log-action kh-log-status");
    addKeyLabel(logStatus, "−", "Status");
    document.body.appendChild(root);

    let reached = 0;
    let milestoneOrder = 0;
    let lastAttempt = 0;
    let finished = false;
    let logSource = null;
    let minusHeld = false;
    let aHeld = false;
    let xHeld = false;
    let gamepadAArmed = false;
    let gamepadXArmed = false;
    let inputError = null;
    let inputTimer = null;
    let buttonReader = null;
    let buttonTimer = null;
    let nativeAArmed = false;
    let nativeXArmed = false;
    let subscription = null;
    let subscribed = false;
    let disposed = false;
    let started = false;
    let startPromise = null;
    let startResolve = null;
    let startReject = null;
    let retryAction = null;
    let retryReady = false;
    let retryPressed = false;
    function stopGamepadPolling() {
        if (inputTimer !== null) {
            clearInterval(inputTimer);
            inputTimer = null;
        }
    }
    function requestStart() {
        if (disposed || started || root.getAttribute("data-mode") !== "intro")
            return false;
        started = true;
        stopGamepadPolling();
        root.setAttribute("data-mode", "running");
        root.setAttribute("data-reached", "loading");
        root.setAttribute("data-result", "running");
        show(states.loading);
        if (startResolve) startResolve();
        startResolve = null;
        startReject = null;
        return true;
    }
    function activeGamepad() {
        const navigator = gamepadNavigator();
        if (typeof navigator?.getGamepads !== "function") return null;
        let pads;
        try { pads = navigator.getGamepads(); }
        catch (error) { inputError = String(error?.message || error); return null; }
        let pad = null;
        for (const candidate of pads || []) {
            if (!candidate || candidate.connected === false ||
                candidate.buttons?.length < 4) continue;
            if (!pad || candidate.mapping === "standard") pad = candidate;
            if (candidate.mapping === "standard") break;
        }
        return pad;
    }
    function armRetry() {
        if (disposed || !finished || !retryReady ||
            root.getAttribute("data-view") !== "status") return false;
        retryPressed = true;
        root.setAttribute("data-retry", "armed");
        return true;
    }
    function completeRetry() {
        if (!retryPressed || !retryReady || disposed) return false;
        // A fresh run must not inherit X held in the core's Gamepad reader.
        if (xHeld || (!buttonReader &&
            activeGamepad()?.buttons[GAMEPAD_BUTTON.x]?.pressed))
            return false;
        retryPressed = false;
        retryReady = false;
        stopGamepadPolling();
        root.setAttribute("data-retry", "requested");
        const action = retryAction;
        retryAction = null;
        action();
        return true;
    }
    function retryClick() {
        if (!retryPressed && !armRetry()) return;
        if (!xHeld) completeRetry();
    }
    startButton.addEventListener("click", requestStart);
    retryButton.addEventListener("pointerdown", armRetry);
    retryButton.addEventListener("pointerup", completeRetry);
    retryButton.addEventListener("pointercancel", function () {
        retryPressed = false;
        if (retryReady) root.setAttribute("data-retry", "available");
    });
    // A DOM click follows pointer release; it also covers keyboard activation.
    retryButton.addEventListener("click", retryClick);
    function refreshLogs() {
        if (root.getAttribute("data-view") !== "logs" || !logSource) return;
        const lines = logSource();
        logContent.textContent = lines.length ? lines.join("\n") : "No log entries yet.";
    }
    function toggleLogs() {
        const next = root.getAttribute("data-view") === "logs" ? "status" : "logs";
        root.setAttribute("data-view", next);
        if (next === "logs") refreshLogs();
    }
    function minusAction(name, status) {
        if (name !== "minus" && name !== "terminal") return false;
        const phase = Number(status);
        if (phase === 1) minusHeld = false;
        else if (phase === 0 && !minusHeld) {
            minusHeld = true;
            toggleLogs();
        }
        return true;
    }
    function inputAction(name, status) {
        if (disposed || buttonReader) return false;
        const action = String(name || "").toLowerCase();
        if (action === "minus" || action === "terminal")
            return minusAction(action, status);
        const phase = Number(status);
        if (action === "a" || action === "button-a" || action === "gamepad-a") {
            if (phase === 1) aHeld = false;
            else if (phase === 0 && !aHeld) {
                aHeld = true;
                return requestStart();
            }
            return root.getAttribute("data-mode") === "intro";
        }
        if (action === "x" || action === "button-x" || action === "gamepad-x") {
            if (phase === 1) {
                xHeld = false;
                const wasArmed = retryPressed;
                completeRetry();
                return wasArmed;
            }
            else if (phase === 0 && !xHeld) {
                xHeld = true;
                return armRetry();
            }
            return retryPressed;
        }
        return false;
    }
    function onGameInput(event) {
        const data = event.detail || {};
        if (!inputAction(data.name, data.status)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    function onKeyDown(event) {
        const key = String(event.key || "").toLowerCase();
        const action = key === "-" || key === "subtract" ? "minus" : key;
        if (!inputAction(action, event.repeat ? 3 : 0)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    function onKeyUp(event) {
        const key = String(event.key || "").toLowerCase();
        const action = key === "-" || key === "subtract" ? "minus" : key;
        if (!inputAction(action, 1)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    function gamepadNavigator() {
        return typeof globalThis.window?.navigator?.getGamepads === "function"
            ? globalThis.window.navigator : globalThis.navigator;
    }
    function pollGamepad() {
        const pad = activeGamepad();
        if (!pad) {
            gamepadAArmed = false;
            gamepadXArmed = false;
            aHeld = false;
            xHeld = false;
            minusAction("minus", 1);
            return;
        }
        const pressed = index => Boolean(pad.buttons[index]?.pressed);
        const a = pressed(GAMEPAD_BUTTON.a);
        const x = pressed(GAMEPAD_BUTTON.x);
        const minus = pressed(GAMEPAD_BUTTON.minus);
        minusAction("minus", minus ? 0 : 1);
        if (!a) { aHeld = false; gamepadAArmed = true; }
        else if (!aHeld) {
            aHeld = true;
            if (gamepadAArmed && !x) requestStart();
        }
        if (!x) {
            xHeld = false;
            gamepadXArmed = true;
            if (retryPressed) completeRetry();
        }
        else if (!xHeld) {
            xHeld = true;
            if (gamepadXArmed && !a) armRetry();
        }
    }
    function startGamepadPolling() {
        if (inputTimer !== null || buttonReader || disposed ||
            (root.getAttribute("data-mode") !== "intro" &&
                root.getAttribute("data-mode") !== "terminal")) return;
        const navigator = gamepadNavigator();
        if (typeof navigator?.getGamepads === "function")
            inputTimer = setInterval(pollGamepad, INPUT_POLL_MS);
    }
    function show(state) {
        label.textContent = state.label;
        title.textContent = state.title;
        detail.textContent = state.detail;
        instruction.textContent = state.instruction;
    }
    function stopButtonReader() {
        if (buttonTimer !== null) {
            clearInterval(buttonTimer);
            buttonTimer = null;
        }
        const reader = buttonReader;
        buttonReader = null;
        if (reader) {
            try {
                if (typeof reader.close === "function") reader.close();
            } catch (error) {
                if (!inputError) inputError = String(error?.message || error);
            }
        }
    }
    /** Use the same native HID button bits as the working Gobanos card. */
    function startButtonReader(createButtons) {
        if (typeof createButtons !== "function") return;
        try {
            buttonReader = createButtons();
            if (!buttonReader || typeof buttonReader.poll !== "function" ||
                typeof buttonReader.close !== "function")
                throw Error("Controller reader is incomplete");
            stopGamepadPolling();
            buttonTimer = setInterval(() => {
                try {
                    const sample = buttonReader.poll();
                    if (sample === null) return;
                    const buttons = BigInt(sample);
                    const pressedA = Boolean(buttons & HID_BUTTON.a);
                    const pressedX = Boolean(buttons & HID_BUTTON.x);
                    minusAction("minus", buttons & HID_BUTTON.minus ? 0 : 1);
                    if (!pressedA) {
                        aHeld = false;
                        nativeAArmed = true;
                    } else if (!aHeld) {
                        aHeld = true;
                        if (nativeAArmed && !pressedX) requestStart();
                    }
                    if (!pressedX) {
                        xHeld = false;
                        nativeXArmed = true;
                        if (retryPressed) completeRetry();
                    } else if (!xHeld) {
                        xHeld = true;
                        if (nativeXArmed && !pressedA) armRetry();
                    }
                } catch (error) {
                    inputError = String(error?.message || error);
                    stopButtonReader();
                    startGamepadPolling();
                }
            }, INPUT_POLL_MS);
        } catch (error) {
            inputError = String(error?.message || error);
            stopButtonReader();
            startGamepadPolling();
        }
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        stopGamepadPolling();
        stopButtonReader();
        if (startReject) startReject(Error("Status screen disposed"));
        startResolve = null;
        startReject = null;
        if (typeof globalThis.removeEventListener === "function") {
            for (const [name, listener] of [
                ["engine-input", onGameInput], ["navigate-input", onGameInput],
                ["keydown", onKeyDown], ["keyup", onKeyUp]
            ]) globalThis.removeEventListener(name, listener, true);
        }
        if (subscription && typeof subscription.clear === "function")
            subscription.clear();
        else if (subscribed && typeof globalThis.engine?.off === "function")
            globalThis.engine.off("InputAction", inputAction,
                {owner: "fs-kaihen-log-toggle"});
        if (root.parentNode) root.parentNode.removeChild(root);
    }
    return {
        available: true,
        waitForStart: function () {
            if (disposed) return Promise.reject(Error("Status screen disposed"));
            if (started) return Promise.resolve();
            if (!startPromise)
                startPromise = new Promise((resolve, reject) => {
                    startResolve = resolve;
                    startReject = reject;
                });
            startGamepadPolling();
            return startPromise;
        },
        beginRun: function (number) {
            if (disposed || !Number.isSafeInteger(number) || number < 1) return;
            stopGamepadPolling();
            started = true;
            reached = 0;
            milestoneOrder = 0;
            lastAttempt = 0;
            finished = false;
            retryReady = false;
            retryAction = null;
            retryPressed = false;
            aHeld = false;
            xHeld = false;
            gamepadAArmed = false;
            gamepadXArmed = false;
            nativeAArmed = false;
            nativeXArmed = false;
            count.textContent = "00";
            symbol.textContent = "";
            root.removeAttribute("data-retry");
            root.removeAttribute("data-milestone");
            root.removeAttribute("data-fs-attempt");
            root.setAttribute("data-run", String(number));
            root.setAttribute("data-reached", "loading");
            root.setAttribute("data-result", "running");
            root.setAttribute("data-mode", "running");
            for (const name of ["fs", "files", "hen"])
                root.setAttribute("data-step-" + name, "pending");
            show(states.loading);
        },
        offerRetry: function (action) {
            if (disposed || !finished || typeof action !== "function" ||
                root.getAttribute("data-result") !== "failure" ||
                root.getAttribute("data-retry")) return false;
            retryAction = action;
            retryReady = true;
            nativeXArmed = false;
            root.setAttribute("data-retry", "available");
            instruction.textContent = "Try again is available below.";
            startGamepadPolling();
            return true;
        },
        enableLogToggle: function (source, createButtons) {
            if (typeof source !== "function" || logSource) return;
            logSource = source;
            startButtonReader(createButtons);
            if (typeof globalThis.addEventListener === "function") {
                globalThis.addEventListener("engine-input", onGameInput, true);
                globalThis.addEventListener("navigate-input", onGameInput, true);
                globalThis.addEventListener("keydown", onKeyDown, true);
                globalThis.addEventListener("keyup", onKeyUp, true);
            }
            if (globalThis.engine && typeof globalThis.engine.on === "function") {
                try {
                    subscription = globalThis.engine.on("InputAction", inputAction,
                        {owner: "fs-kaihen-log-toggle"});
                    subscribed = true;
                } catch (error) {
                    inputError = String(error && error.message || error);
                }
            }
            startGamepadPolling();
        },
        refreshLogs: refreshLogs,
        logsOpen: function () { return root.getAttribute("data-view") === "logs"; },
        inputError: function () { return inputError; },
        dispose: dispose,
        phase: function (name, _detail) {
            const next = states[name];
            if (finished || !next || next.index === undefined || next.index <= reached) return;
            stopGamepadPolling();
            // Advance the rail only when the chain enters the next verified stage.
            if (next.index >= states.files.index)
                root.setAttribute("data-step-fs", "verified");
            if (next.index >= states.hen.index)
                root.setAttribute("data-step-files", "verified");
            root.setAttribute("data-step-" + name, "running");
            root.setAttribute("data-mode", "running");
            reached = next.index;
            milestoneOrder = 0;
            root.setAttribute("data-reached", name);
            show(next);
        },
        milestone: function (name) {
            const next = milestones[name];
            if (finished || reached === 0 || !next || next.order <= milestoneOrder) return;
            milestoneOrder = next.order;
            root.setAttribute("data-milestone", name);
            show(next);
        },
        attempt: function (number) {
            if (finished || reached < states.fs.index ||
                !Number.isSafeInteger(number) || number <= lastAttempt) return;
            if (reached > states.fs.index) {
                // A later attempt means filesystem access restarted in this run.
                reached = states.fs.index;
                milestoneOrder = 0;
                root.setAttribute("data-reached", "fs");
                root.setAttribute("data-step-fs", "running");
                root.setAttribute("data-step-files", "pending");
                root.setAttribute("data-step-hen", "pending");
                root.removeAttribute("data-milestone");
                show(states.fs);
            }
            lastAttempt = number;
            root.setAttribute("data-fs-attempt", String(number));
            count.textContent = String(number).padStart(2, "0");
            detail.textContent = "Filesystem attempt " + number + " is running.";
        },
        finish: function (kind, code) {
            if (finished) return;
            finished = true;
            const result = states[kind] ? kind : "unconfirmed";
            root.setAttribute("data-result", result);
            root.setAttribute("data-mode", "terminal");
            if (result === "success") {
                root.setAttribute("data-reached", "complete");
                for (const name of ["fs", "files", "hen"])
                    root.setAttribute("data-step-" + name, "verified");
            } else {
                // A missing completion record marks the reached stage, not success.
                const current = reached === states.fs.index ? "fs" :
                    reached === states.files.index ? "files" :
                        reached === states.hen.index ? "hen" : null;
                if (current) root.setAttribute("data-step-" + current, result);
            }
            symbol.textContent = result === "success" ? "" : result === "failure" ? "!" : "?";
            show(states[result]);
            if (code === "access-not-established")
                detail.textContent = "Filesystem access was not established.";
            else if (code === "files-unavailable")
                detail.textContent = "Required startup files are unavailable.";
            else if (code === "fs-error")
                detail.textContent = "The filesystem stage ended unexpectedly.";
            startGamepadPolling();
        }
    };
}
