var NYTD = NYTD || {};
NYTD.Abra = (function(window, allocs, etUrl) {
    "use strict";

    var dataAttrs = [], testname, variant, etSendData = "", etSendThrottle, etSendCallbacks = [];

    for (testname in allocs) {
        variant = allocs[testname];
        if (variant[0]) {
            dataAttrs.push(testname + "=" + variant[0]);
        }
        if (variant[1]) {
            sendEvent("ab-alloc", testname, variant[0]);
        }
    }

    if (dataAttrs.length) {
        window.document.documentElement.setAttribute("data-nyt-ab", dataAttrs.join(" "));
    }

    Abra.reportExposure = reportExposure;
    return Abra;

    /**
     *  reportExposure(testname)
     *
     *  Reports the exposure to ET, then calls the provided callback.
     */
    function reportExposure(testname, cb) {
        var variant = allocs[testname] || {};
        if (variant[1]) {
            sendEvent("ab-expose", testname, variant[0], cb);
        } else {
            if (cb) {
                window.setTimeout(function () { cb(null) }, 0);
            }
        }
    }

    /**
     *  Abra(testname)
     *
     *  Returns the variant value, synchronously.
     *  TODO: go through MWR code and change Abra() to Abra.expose(); search video code
     */
    function Abra(testname) {
        var variant = allocs[testname] || {};
        return variant[0] || null;
    }

    function sendEvent(subject, testname, variant, cb) {
        etSendData += (
            "subject=" + subject +
            "&test=" + encodeURIComponent(testname) +
            "&variant=" + encodeURIComponent(variant || 0) +  // null/undefined/empty string becomes "0" for Josh
            "&url=" + encodeURIComponent(window.location.href) +
            "&instant=1&skipAugment=true\n"
        );

        if (cb) {
            etSendCallbacks.push(cb);
        }
        if (!etSendThrottle) {
            etSendThrottle = window.setTimeout(etSend, 0); // let rest of page load first
        }
    }

    /**
     *  etSend: report allocations to Event Tracker
     */

    function etSend() {
        var xhr = new window.XMLHttpRequest(), cbs = etSendCallbacks;
        xhr.withCredentials = true; // make sure to include agent-id cookie
        xhr.open("POST", etUrl);
        xhr.onreadystatechange = function () {
            var err, cb;
            if (xhr.readyState == 4) {
                if (xhr.status == 200) {
                    err = null;
                } else {
                    err = new Error(xhr.statusText);
                }
                while (cb = cbs.shift()) {
                    cb(err);
                }
            }
        }
        xhr.send(etSendData);
        etSendData = "";
        etSendCallbacks = [];
        etSendThrottle = null;
    }

})(this, __allocs__, __etUrl__);
