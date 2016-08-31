/* jshint browser:true, quotmark:false, unused:true, eqnull:true, strict:false, newcap: false */
/* global msCrypto */

/* istanbul ignore next */
var NYTD = NYTD || {};
NYTD.ABTest = (function (window) {
    'use strict';

    var bucketingId, config, chosenVariants;

    function ABTest(testName, peek) {
        var value, testConfig, variantConfig;

        // setup config and check sanity:
        if (!(config && (testConfig = config[testName])))
            return null;

        if (testName in chosenVariants)
            return chosenVariants[testName];

        if ((variantConfig = chooseVariant(testName, testConfig.variants || [])))
            value = variantConfig.value;
        if (value == null) // this seems to gzip better than '=== undefined'
            value = null;

        if (!peek) {
            chosenVariants[testName] = value;

            // record allocation in CIG's adx-ab-allocation table:
            if (variantConfig && variantConfig.cigId != null) {

                // don't send duplicate events (MWR-6036) -- this is a temporary
                // solution because localStorage will eventually fill up (probably
                // not for many years, but still):
                var reportedTreatments;
                try { reportedTreatments = JSON.parse(window.localStorage["nyt.wp.ab.et"]); } catch (e) {}
                reportedTreatments = reportedTreatments || {};

                if (reportedTreatments[testName + '.' + bucketingId] !== variantConfig.cigId) {
                    (NYTD.etw = NYTD.etw || []).push({
                        subject:    'adx-ab-allocation',
                        testName:   testConfig.cigName || testName,
                        module:     testConfig.cigModule,
                        treatment:  variantConfig.cigId,
                        'nyt.wp.ab': bucketingId // send our bucketingId to help CIG track, since agent id is unreliable
                    });

                    reportedTreatments[testName + '.' + bucketingId] = variantConfig.cigId;
                    try { window.localStorage["nyt.wp.ab.et"] = JSON.stringify(reportedTreatments); } catch (e) {}
                }
            }
        }

        return value;
    }

    ABTest.init = function (newConfig) {
        var ui8a, ts, variant, testName, i = 16;

        // // Set up bucketing based on RMID:
        // if (!((m = window.document.cookie.match(/(^|;)\s*RMID=([^;]*)/)) && (bucketingId = m[2]))) return;

        // Set up bucketing based on nyt.wp.ab cookie:
        if (!(bucketingId = (window.document.cookie.match(/(^|;)\s*nyt\.wp\.ab=([^;]*)/) || [])[2])) {
            ui8a = new Uint8Array(16); // IE10+
            try {
                (window.crypto || msCrypto).getRandomValues(ui8a); // IE11+
            } catch (err) {
                while (i) {
                    if (i % 8) ts /= 256; else ts = (+new Date());  // Leo insists he's seen Math.random() collide,
                    ui8a[--i] = (Math.random() * 256) ^ ts;         // so munge in timestamp and keep fingers crossed
                }
            }
            // use base64 to represent 128 bits in 22 cookie-safe chars:
            bucketingId = btoa(
                String.fromCharCode.apply(0, [].slice.call(ui8a))
                // iOS 6+: apply can accept arraylikes, not just Arrays, so can dispense with [].slice.call
            ).slice(0,-2); // chop '==' padding
        }

        // cookie our bucketingId to help CIG track, since agent id is unreliable:
        window.document.cookie =
            "nyt.wp.ab=" + bucketingId + ";path=/;domain=nytimes.com;expires=" +
            (new Date((+new Date()) + 365 * 24 * 60 * 60 * 1000)).toUTCString(); // expire in 1 year

        // if (bucketingId != (window.document.cookie.match(/(^|;)\s*nyt\.wp\.ab=([^;]*)/) || [])[2]) return;

        chosenVariants = JSON.parse(window.localStorage['nyt.wp.ab'] || '{}'); // apply overrides
        if (!(config = newConfig)) return;

        // set classes on <html> element:
        for (testName in config) {
            if (!config[testName].setHTMLClass) continue;
            if (!(variant = ABTest(testName))) continue; // only set class for this test if variant is truthy

            window.document.documentElement.className += (
                ' ab-' +
                testName.replace(/\W/g, '_') + '-' +
                ('' + variant).replace(/\W/g, '_')
            );
        }
    };


    /**
     *  chooseVariant: hashes testName to choose a variant config from an array
     */

    function chooseVariant(testName, variants) {
        // bucketingId is guaranteed by initConfig(), if variants exist

        // throw dart and see which variant it hit:
        var dart = sha1hash32(testName + '.' + bucketingId), i = 0, currentPos = 0,
            variantConfig, weight, matches;

        while ((variantConfig = variants[i++])) {
            weight = variantConfig.weight;

            // normalize weights like "50%" or "1/2" to 0.5:
            if (weight.match) { // make sure it's a string
                if ((matches = weight.match(/(.*)[%/](.*)/))) {
                    weight = matches[1] / (matches[2] || 100);
                }
            }

            currentPos += 0x100000000 * weight; // scale up to max unsigned 32-bit value + 1

            if (dart < currentPos)
                return variantConfig;
        }
    }

    /**
     *  sha1hash32
     *
     *  Hash input string to a number in the range [0, 2^32-1]. Based on jbt's
     *  implementation of SHA-1 <https://github.com/jbt/js-crypto>.
     *
     *  We need our hash function to generate values that look random and
     *  uniformly distributed, even when given closely correlated inputs; we
     *  don't care about speed (much) or crypto security. Importantly, if
     *  "[A][K1]" and "[B][K1]" hash to the same value, this must imply
     *  nothing about whether "[A][K2]" and "[B][K2]" also hash to the same
     *  value. For example, MurmurHash3 fails this criterion because
     *  mmh3("RtgqS7NC[K]") == mmh3("j79QR5zh[K]"), for all "[K]".
     *
     *  If there's another hash out there with these characteristics and a
     *  smaller implementation, let's use it!
     *
     *  Tools to test quality of hash functions and allocation methods:
     *   -  SMHasher suite <https://code.google.com/p/smhasher/wiki/SMHasher>
     *      (patched from r152: ./tools/smhasher-patch.diff)
     *   -  dieharder <http://www.phy.duke.edu/~rgb/General/dieharder.php>
     *      (with inputs from ./tools/dieharder-stdin-raw/)
     *   -  ./tools/hashplot/hashplot.js
     *   -  ./tools/simallocations.js
     */
    function sha1hash32(s) {
        for (
            var blockstart = 0,
                i = 0,
                W = [],
                A, B, C, D, F, G,
                H = [A=0x67452301, B=0xEFCDAB89, ~A, ~B, 0xC3D2E1F0],
                word_array = [],
                temp2,
                // s = unescape(encodeURI(str1)),
                str_len = s.length;

            i <= str_len;
        ){
            // word_array[i >> 2] |= (s.charCodeAt(i)||128) << (8 * (3 - i++ % 4));
            word_array[i >> 2] |= (i < str_len ? s.charCodeAt(i) : 128) << (8 * (3 - i++ % 4)); // helps v8 optimizer
        }
        word_array[temp2 = ((str_len + 8) >> 6 << 4) + 15] = str_len << 3;

        for (; blockstart <= temp2; blockstart += 16) {
            A = H; i = 0;

            for (; i < 80;
                A = [[
                    (G = ((s = A[0]) << 5 | s >>> 27) + A[4] + (W[i] = (i<16) ? ~~word_array[blockstart + i] : G << 1 | G >>> 31) + 1518500249) + ((B = A[1]) & (C = A[2]) | ~B & (D = A[3])),
                    F = G + (B ^ C ^ D) + 341275144,
                    G + (B & C | B & D | C & D) + 882459459,
                    F + 1535694389
                ][0|((i++) / 20)] | 0, s, B << 30 | B >>> 2, C, D]
            ) {
                G = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
            }

            for(i = 5; i; ) H[--i] = H[i] + A[i] | 0;
        }

        // for(str1 = ''; i < 40; )str1 += (H[i >> 3] >> (7 - i++ % 8) * 4 & 15).toString(16);
        // return str1;
        return H[0] >>> 0;
    }


    // expose things for testing:
    /* istanbul ignore next */
    if (typeof __DIST_BUILD__ === 'undefined') {
        ABTest._internals = {
            reset: function (mockWindow) {
                window = mockWindow;
                bucketingId = config = chosenVariants = undefined;
            },
            chooseVariant: chooseVariant,
            sha1hash32: sha1hash32
        };
    }

    return ABTest;

})(this);
