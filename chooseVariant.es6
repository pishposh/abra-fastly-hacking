/**
 *  chooseVariant: hashes testName to choose a variant config from an array
 */

import crypto from "crypto";
import statsd from "./utils/statsdClient";

const sha1hash32 = (str) => crypto.createHash("sha1").update(str, "utf8").digest().readUInt32BE(0);

function chooseVariant(key, testname, testConfig) {
    let dart, i = 0, ptr = 0, variant, weight, matches;

    chooseVariant.n++;
    statsd.increment("chooseVariant", 1, 0.01);

    if (key) {

        // optimization to short-circuit hashing:
        if (testConfig.length === 1 && testConfig[0].ubx32 === 0x100000000) {
            return { value: testConfig[0].value, report: testConfig[0].report };
        }

        dart = sha1hash32(key + " " + testname);
        // dart = agentId ? sha1hash32(agentId + " " + testname)
        //                : crypto.randomBytes(4).readUInt32BE(0);

        while ((variant = testConfig[i++])) {
            if (dart < variant.ubx32) { // upper bound, exclusive
                return { value: variant.value, report: variant.report };
            }
        }
    }

    return { value: null, report: false };
}

chooseVariant.n = 0;

export default chooseVariant;
