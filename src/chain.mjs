// CivSwitchFS + kaiHEN combined payload — promotion, then the kaiHEN
// chain, in one eval. Step 1 of the persistent chain: with this entry no
// PC orchestration sits between the two halves, so the same sequence can
// later run from the persisted save image.
//
// tools/kaihen.mjs normally sets __KH_MODE / __KH_SKIP / __KH_MANIFEST
// through prelude evals before sending src/kaihen.js. This entry sets
// them itself: default skips (dx, probes — their doomed sends close the
// loader session copy per the SessionClosed verdict), and the
// version-pinned SD manifest from kaihen/state.mjs. The ship files must
// already be staged on the card (run the kaiHEN launcher once, or copy
// /kaihen/bin, /hbmenu.nro and /switch/ounceshell.nro manually).

import coreRuntime from "./core/runtime.mjs";
import {run as runPromotion} from "./core.js";
import {run as runKaihen} from "./kaihen.js";
import {SD_MANIFEST} from "./kaihen/state.mjs";
import {createChainStatus} from "./core/status-chain.mjs";

const {log} = coreRuntime;

export async function run() {
    const status = createChainStatus();
    await status.waitForStart();
    let runNumber = 0;
    // A fresh FS run is possible only after the UI verifies an eligible retry.
    while (true) {
        status.beginRun(++runNumber);
        status.phase("fs");
        let failed = false;
        let failure;
        try {
            await runPromotion();

            // Never enter HEN without the session retained by this FS run.
            const state = globalThis.fsKaihen;
            if (!state || !state.domainSession) {
                await log("CHAIN: promotion did not retain a session — " +
                    "kaiHEN not started; restart the game to retry");
            } else {
                status.phase("files");
                await log("CHAIN: promotion retained a session — starting kaiHEN");
                globalThis.__KH_MODE = "run";
                globalThis.__KH_SKIP = ["dx", "probes"];
                globalThis.__KH_MANIFEST = SD_MANIFEST;
                await runKaihen();
            }
        } catch (error) {
            failed = true;
            failure = error;
            status.recordError(error);
        } finally {
            status.finish();
        }

        if (failed) {
            // Keep the native input reader alive with the terminal screen.
            await status.holdTerminal();
            throw failure;
        }

        // The next iteration requires a deliberate X release after a clean FS exit.
        if (!await status.waitForRetry()) {
            await status.holdTerminal();
            return;
        }
    }
}
