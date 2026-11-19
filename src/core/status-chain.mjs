// Presentation-only bridge between the existing payload logs and the status UI.
import {createCardButtons} from "./status-hid.mjs";
import {createLocalHackUI} from "./status-ui.mjs";
import {setStatusObserver} from "./visuals.mjs";

const MAX_LOG_MESSAGES = 64;
const MAX_LOG_MESSAGE_LENGTH = 2048;
const MAX_LOG_ROWS = 34;
const LOG_COLUMNS = 146;
const ATTEMPT_HEADER = /^======== ATTEMPT ([1-9][0-9]*) ========$/;
const EXHAUSTED = /^Stopped after [1-9][0-9]* attempts; user storage access was not verified\./;
const CLEANUP_RECEIPTS = new Set([
    "Cleanup complete.", "Cleanup is sufficient for another attempt."
]);
const CHAIN_ENDED = "CHAIN: promotion did not retain a session";
const RESTART_GAME = /Restart the game before another run\./;
const FS_ERROR = /^(?:PAYLOAD ERROR:|Unexpected error\.|Workflow error:|Attempt failed:|Attempt ended after an error|Cleanup failed; another attempt is unsafe\.|Could not start an attempt\. Stopping\.)/;

function recordPresentationError(error) {
    globalThis.__CIVSWITCHFS_STATUS_ERROR__ = String(error?.message || error);
}

function safePresentation(action) {
    try { action(); }
    catch (error) { recordPresentationError(error); }
}

export function classifyChainStatus({session, exhausted, complete}) {
    if (complete === true) return {kind: "success"};
    if (session === false && exhausted === true)
        return {kind: "failure", code: "access-not-established"};
    return {kind: "unconfirmed"};
}

/**
 * Create the screen once, then observe only existing stage boundaries.
 * The optional factory lets the controller bridge be exercised without native SDK calls.
 */
export function createChainStatus(buttonReaderFactory = createCardButtons) {
    let ui;
    try { ui = createLocalHackUI(); }
    catch (error) {
        recordPresentationError(error);
        ui = null;
    }
    // A missing DOM keeps the established automatic payload entry usable.
    if (!ui?.available) return {
        available: false,
        waitForStart: () => Promise.resolve(),
        beginRun() {}, phase() {},
        finish: () => ({kind: "unconfirmed"}),
        waitForRetry: () => Promise.resolve(false),
        recordError() {},
        holdTerminal: () => Promise.resolve()
    };

    const messages = [];
    let completionAtStart = globalThis.__KH?.stages?.complete;
    let exhausted = false;
    let fsCleanupReceipt = false;
    let fsChainEnded = false;
    let lastAttempt = 0;
    let restartGame = false;
    let fsError = false;
    let currentPhase = "loading";
    let finishedVerdict = null;
    let retryEligible = false;
    let retryPromise = null;
    function recentRows() {
        const rows = [];
        for (const message of messages) {
            for (const line of message.split("\n")) {
                const text = line || " ";
                for (let at = 0; at < text.length; at += LOG_COLUMNS)
                    rows.push(text.slice(at, at + LOG_COLUMNS));
            }
        }
        return rows.slice(-MAX_LOG_ROWS);
    }
    function observe(message) {
        messages.push(message.slice(0, MAX_LOG_MESSAGE_LENGTH));
        if (messages.length > MAX_LOG_MESSAGES) messages.shift();
        const attempt = ATTEMPT_HEADER.exec(message);
        if (attempt) {
            const number = Number(attempt[1]);
            if (Number.isSafeInteger(number) && number > lastAttempt) {
                lastAttempt = number;
                fsCleanupReceipt = false;
                ui.attempt(number);
            }
        }
        if (currentPhase === "fs") {
            if (CLEANUP_RECEIPTS.has(message)) fsCleanupReceipt = true;
            if (message.startsWith(CHAIN_ENDED)) fsChainEnded = true;
            if (EXHAUSTED.test(message)) {
                exhausted = true;
                if (RESTART_GAME.test(message)) restartGame = true;
            }
            if (FS_ERROR.test(message)) fsError = true;
        }
        if (message.startsWith("CHAIN: promotion retained a session"))
            ui.milestone("hen-prep");
        if (message.startsWith("KH: SD manifest present:"))
            ui.milestone("files-verified");
        if (message.startsWith("KH: --- stage: endpoint")) {
            currentPhase = "hen";
            ui.phase("hen");
        }
        if (message.startsWith("KH: handoff verified: loader session idle"))
            ui.milestone("handoff");
        if (attempt || message.startsWith("KH: SD manifest present:") ||
                message.startsWith("KH: --- stage: endpoint") ||
                message.startsWith("KH: handoff verified:"))
            ui.refreshLogs();
    }

    safePresentation(() => ui.enableLogToggle(recentRows, buttonReaderFactory));
    setStatusObserver(observe);
    return {
        available: true,
        waitForStart: () => typeof ui.waitForStart === "function"
            ? ui.waitForStart() : Promise.reject(Error("Start input unavailable")),
        beginRun(number) {
            messages.length = 0;
            completionAtStart = globalThis.__KH?.stages?.complete;
            exhausted = false;
            fsCleanupReceipt = false;
            fsChainEnded = false;
            lastAttempt = 0;
            restartGame = false;
            fsError = false;
            currentPhase = "loading";
            finishedVerdict = null;
            retryEligible = false;
            retryPromise = null;
            safePresentation(() => ui.beginRun(number));
        },
        phase(name) {
            if (name === "fs" || name === "files" || name === "hen")
                currentPhase = name;
            safePresentation(() => ui.phase(name));
        },
        finish() {
            if (finishedVerdict) return finishedVerdict;
            const completion = globalThis.__KH?.stages?.complete;
            const session = Boolean(globalThis.fsKaihen?.domainSession);
            finishedVerdict = classifyChainStatus({
                session,
                exhausted,
                complete: completion !== completionAtStart &&
                    completion?.proof?.ok === true
            });
            // The HEN launch can consume a boot before its stage proof is saved.
            const henState = globalThis.__KH;
            retryEligible = finishedVerdict.kind === "failure" &&
                currentPhase === "fs" && fsCleanupReceipt && fsChainEnded &&
                !restartGame && !fsError &&
                !session && !globalThis.__KH_TRACKED &&
                !henState?.launchProof &&
                Object.keys(henState?.stages || {}).length === 0;
            safePresentation(() => {
                ui.finish(finishedVerdict.kind, finishedVerdict.code);
                ui.refreshLogs();
            });
            return finishedVerdict;
        },
        waitForRetry() {
            if (!retryEligible || typeof ui.offerRetry !== "function")
                return Promise.resolve(false);
            if (retryPromise) return retryPromise;
            retryPromise = new Promise(resolve => {
                try {
                    if (!ui.offerRetry(accepted => resolve(accepted !== false)))
                        resolve(false);
                } catch (error) {
                    recordPresentationError(error);
                    resolve(false);
                }
            });
            return retryPromise;
        },
        recordError(error) {
            safePresentation(() => {
                observe("PAYLOAD ERROR: " + String(error?.message || error));
                if (error?.stack)
                    observe(String(error.stack).split("\n").slice(0, 3).join(" | "));
                ui.refreshLogs();
            });
        },
        holdTerminal() {
            // Gobanos keeps its eval pending to retain terminal input. The
            // loader may otherwise leave a visible DOM with inactive HID polling.
            return new Promise(() => {});
        }
    };
}
