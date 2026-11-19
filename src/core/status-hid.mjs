/** Controller bits from the CivSwitch SDK HID exports.
 * Adapted from civ7-boot-selector/app/src/fasthack-card-hid.js
 * at dadcbde820141356da2a349e1029096dc151f20a.
 * Requires the loader ambient memory and ROP primitives.
 */
export function createCardButtons() {
    if (typeof sdk_base === "undefined" || typeof call_rop !== "function")
        throw Error("CivSwitch controller primitives are unavailable.");

    const module = sdk_base + read32(sdk_base + 4n);
    if (read32(module) !== 0x30444f4dn) throw Error("Unsupported SDK module.");
    const dynamic = module + BigInt.asIntN(32, read32(module + 4n));
    const tags = {};
    for (let index = 0; index < 128; index++) {
        const tag = Number(read64(dynamic + BigInt(index * 16)));
        if (!tag) break;
        const value = read64(dynamic + BigInt(index * 16 + 8));
        tags[tag] = value < sdk_base ? sdk_base + value : value;
    }
    const table = tags[4], strings = tags[5], symbols = tags[6];
    if (!table || !strings || !symbols) throw Error("SDK export table missing.");
    const buckets = Number(read32(table)), count = Number(read32(table + 4n));
    if (buckets < 1 || buckets > 1000000 || count < 1 || count > 1000000)
        throw Error("Invalid SDK export bounds.");

    function resolve(name) {
        let hash = 0;
        for (let index = 0; index < name.length; index++) {
            hash = ((hash << 4) + name.charCodeAt(index)) >>> 0;
            const high = hash & 0xf0000000;
            if (high) hash ^= high >>> 24;
            hash = (hash & ~high) >>> 0;
        }
        let index = Number(read32(table + 8n + BigInt((hash % buckets) * 4)));
        for (let step = 0; index && step < count; step++) {
            if (index >= count) throw Error("Invalid SDK symbol chain.");
            const symbol = symbols + BigInt(index * 24);
            const address = strings + read32(symbol);
            let candidate = "";
            for (let char = 0; char < 512; char++) {
                const value = Number(read8(address + BigInt(char)));
                if (!value) break;
                candidate += String.fromCharCode(value);
            }
            if (candidate === name) {
                const offset = read64(symbol + 8n);
                if (offset) return sdk_base + offset;
                break;
            }
            index = Number(read32(table + 8n + BigInt((buckets + index) * 4)));
        }
        throw Error("Missing SDK export: " + name);
    }

    const prefix = "_ZN2nn3hid6detail";
    const styleGetter = resolve(prefix +
        "15GetNpadStyleSetEPNS_4util10BitFlagSetILi32ENS0_12NpadStyleTagEEERKj");
    const stateGetters = [
        {bit: 2, name: "17NpadHandheldState"},
        {bit: 1, name: "16NpadFullKeyState"},
        {bit: 4, name: "16NpadJoyDualState"}
    ].map(entry => ({bit: entry.bit, address: resolve(prefix +
        "13GetNpadStatesEPiPNS0_" + entry.name + "EiRKj")}));
    const owned = [];
    let closed = false, selected = null, nextScan = 0;
    function take(bytes) {
        const address = malloc(bytes);
        if (!address) throw Error("Native controller allocation failed.");
        owned.push(address);
        return address;
    }
    function close() {
        if (closed) return;
        closed = true;
        owned.reverse().forEach(free);
        owned.length = 0;
    }
    let id, style, resultCount, sample;
    try {
        id = take(8);
        style = take(8);
        resultCount = take(8);
        sample = take(64);
    } catch (error) {
        close();
        throw error;
    }
    function readButtons(controller, getter) {
        write32(id, BigInt(controller));
        write32(resultCount, 0n);
        if (Number(call_rop(getter.address, resultCount, sample, 1n, id) & 0x3fffffn))
            throw Error("Controller state failed.");
        if (read32(resultCount) !== 1n || !(read32(sample + 32n) & 1n))
            return null;
        return read64(sample + 8n);
    }
    return {
        poll() {
            if (closed) return null;
            if (selected) {
                const value = readButtons(selected.id, selected.getter);
                if (value !== null) return value;
                selected = null;
                nextScan = 0;
            }
            if (Date.now() < nextScan) return null;
            nextScan = Date.now() + 500;
            for (const controller of [32, 0, 1, 2, 3, 4, 5, 6, 7]) {
                write32(id, BigInt(controller));
                write32(style, 0n);
                if (Number(call_rop(styleGetter, style, id) & 0x3fffffn))
                    throw Error("Controller style failed.");
                const bits = Number(read32(style));
                for (const getter of stateGetters) {
                    if (!(bits & getter.bit)) continue;
                    const value = readButtons(controller, getter);
                    if (value !== null) {
                        selected = {id: controller, getter};
                        return value;
                    }
                }
            }
            return null;
        },
        close
    };
}
