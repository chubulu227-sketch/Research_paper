/**
 * ============================================================
 * IoT Research Paper Dashboard - Client Logic
 * ============================================================
 *
 * Communication:
 *
 * Browser
 *    ↓
 * WebSocket
 *    ↓
 * Node-RED
 *    ↓
 * MQTT / HiveMQ
 *    ↓
 * ESP32
 *
 * Relay status:
 *
 * ESP32
 *    ↓
 * MQTT / HiveMQ
 *    ↓
 * Node-RED Status Function
 *    ↓
 * WebSocket
 *    ↓
 * Browser
 *
 * Latency:
 *
 * Browser calculates:
 *
 * End-to-End Latency =
 * Status Received Time - Command Sent Time
 *
 * Then browser sends the calculated latency to:
 *
 * smart/home/latency/report
 *
 * ============================================================
 */


/* ============================================================
   GLOBAL VARIABLES
   ============================================================ */

let socket = null;

let reconnectTimer = null;

const RECONNECT_DELAY_MS = 3000;

const COMMAND_TIMEOUT_MS = 10000;


/*
 * Stores commands that are waiting for
 * the matching relay_status response.
 *
 * command_id -> {
 *     relay,
 *     command,
 *     startTime,
 *     requestedState
 * }
 */
const pendingCommands = new Map();


/*
 * Stores completed latency measurements.
 */
let latencySamples = [];


/*
 * Maximum number of latency records
 * stored in browser localStorage.
 */
const MAX_LATENCY_SAMPLES = 1000;


/* ============================================================
   NODE-RED WEBSOCKET URL
   ============================================================ */

function getWebSocketUrl() {

    return 'wss://headed-spooky-snowstorm.ngrok-free.dev/home/dashboard';

}


/* ============================================================
   CONNECTION STATUS
   ============================================================ */

function updateConnectionStatus(status) {

    const statusEl =
        document.getElementById(
            'connection-status'
        );


    if (!statusEl) {
        return;
    }


    statusEl.textContent = status;


    if (status === 'Connected') {

        statusEl.classList.add(
            'connected'
        );

    } else {

        statusEl.classList.remove(
            'connected'
        );

    }

}


/* ============================================================
   GENERATE UNIQUE COMMAND ID
   ============================================================ */

function generateCommandId() {

    /*
     * Preferred method.
     */
    if (
        window.crypto &&
        typeof window.crypto.randomUUID === 'function'
    ) {

        return window.crypto.randomUUID();

    }


    /*
     * Fallback method.
     */
    return (
        Date.now().toString(36) +
        '-' +
        Math.random()
            .toString(36)
            .substring(2, 10)
    );

}


/* ============================================================
   UPDATE TEMPERATURE / HUMIDITY / GAS / FLAME
   ============================================================ */

function updateSensorData(data) {

    if (
        !data ||
        typeof data !== 'object'
    ) {

        return;

    }


    /* --------------------------------------------------------
       Temperature
       -------------------------------------------------------- */

    if (
        data.temperature !== undefined &&
        data.temperature !== null
    ) {

        const tempEl =
            document.getElementById(
                'temperature-val'
            );


        if (tempEl) {

            tempEl.textContent =
                `${data.temperature} °C`;

        }

    }


    /* --------------------------------------------------------
       Humidity
       -------------------------------------------------------- */

    if (
        data.humidity !== undefined &&
        data.humidity !== null
    ) {

        const humEl =
            document.getElementById(
                'humidity-val'
            );


        if (humEl) {

            humEl.textContent =
                `${data.humidity} %`;

        }

    }


    /* --------------------------------------------------------
       Gas
       -------------------------------------------------------- */

    if (
        data.gas !== undefined &&
        data.gas !== null
    ) {

        const gasEl =
            document.getElementById(
                'gas-val'
            );


        if (gasEl) {

            gasEl.textContent =
                `${data.gas}`;

        }

    }


    /* --------------------------------------------------------
       Flame
       -------------------------------------------------------- */

    if (
        data.flame !== undefined &&
        data.flame !== null
    ) {

        const flameEl =
            document.getElementById(
                'flame-val'
            );


        if (flameEl) {

            flameEl.textContent =
                data.flame
                    ? 'FLAME DETECTED'
                    : 'NO FLAME';

        }

    }

}


/* ============================================================
   UPDATE SINGLE RELAY UI
   ============================================================ */

function updateRelayUI(
    relayNumber,
    state
) {

    const stateText =
        document.getElementById(
            `relay-${relayNumber}-text`
        );


    const toggle =
        document.getElementById(
            `relay-${relayNumber}`
        );


    /* --------------------------------------------------------
       Update relay text
       -------------------------------------------------------- */

    if (stateText) {

        stateText.textContent = state;


        if (state === 'ON') {

            stateText.classList.add(
                'on'
            );

        } else {

            stateText.classList.remove(
                'on'
            );

        }

    }


    /* --------------------------------------------------------
       Update switch
       -------------------------------------------------------- */

    if (toggle) {

        toggle.checked =
            state === 'ON';

    }

}


/* ============================================================
   UPDATE ALL RELAY STATES
   ============================================================ */

function updateRelayStatusUI(data) {

    if (!data) {
        return;
    }


    for (
        let i = 1;
        i <= 4;
        i++
    ) {

        const key =
            `relay${i}`;


        if (
            data[key] === 'ON' ||
            data[key] === 'OFF'
        ) {

            updateRelayUI(
                i,
                data[key]
            );

        }

    }

}


/* ============================================================
   SEND LATENCY REPORT TO NODE-RED
   ============================================================ */

function sendLatencyReport(measurement) {

    /*
     * The latency report is sent using the same
     * WebSocket connection to Node-RED.
     *
     * Node-RED latency Function will forward it to:
     *
     * smart/home/latency/report
     *
     * with MQTT QoS 1.
     */

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {

        console.warn(
            'Latency report could not be sent: ' +
            'WebSocket is not connected.'
        );

        return;

    }


    const latencyReport = {

        type:
            'latency_report',

        command_id:
            measurement.commandId,

        latency_ms:
            Number(
                measurement.latencyMs.toFixed(2)
            ),

        relay:
            measurement.relay,

        command:
            measurement.command,

        measured_at:
            new Date().toISOString()

    };


    try {

        socket.send(
            JSON.stringify(
                latencyReport
            )
        );


        console.log(
            'Latency report sent to Node-RED:',
            latencyReport
        );

    } catch (error) {

        console.error(
            'Failed to send latency report:',
            error
        );

    }

}


/* ============================================================
   HANDLE RELAY STATUS
   ============================================================ */

function handleRelayStatus(data) {

    if (
        !data ||
        typeof data !== 'object'
    ) {

        return;

    }


    /*
     * --------------------------------------------------------
     * IMPORTANT
     *
     * This matches your Node-RED Status Function:
     *
     * command_id:
     *     data.command_id || null
     *
     * --------------------------------------------------------
     */

    console.log(
        'Relay status received:',
        data
    );


    /* --------------------------------------------------------
       Update relay UI
       -------------------------------------------------------- */

    updateRelayStatusUI(
        data
    );


    /* --------------------------------------------------------
       Check command_id
       -------------------------------------------------------- */

    if (
        !data.command_id
    ) {

        /*
         * This can happen for the initial relay status
         * sent by ESP32 after MQTT connection.
         *
         * It cannot be used for E2E latency.
         */

        console.log(
            'Relay status has no command_id. ' +
            'Skipping latency calculation.'
        );

        return;

    }


    /* --------------------------------------------------------
       Find matching command
       -------------------------------------------------------- */

    const pending =
        pendingCommands.get(
            data.command_id
        );


    if (!pending) {

        console.warn(
            'No pending command found for command_id:',
            data.command_id
        );

        console.warn(
            'Currently pending command IDs:',
            Array.from(pendingCommands.keys())
        );

        return;

    }


    /* --------------------------------------------------------
       STOP LATENCY TIMER
       -------------------------------------------------------- */

    const endTime =
        performance.now();


    /*
     * End-to-end latency:
     *
     * browser receives relay_status
     *          -
     * browser sends relay_command
     */

    const latencyMs =
        endTime -
        pending.startTime;


    /* --------------------------------------------------------
       Remove command from pending list
       -------------------------------------------------------- */

    pendingCommands.delete(
        data.command_id
    );


    /* --------------------------------------------------------
       Create latency record
       -------------------------------------------------------- */

    const measurement = {

        commandId:
            data.command_id,

        relay:
            pending.relay,

        command:
            pending.command,

        latencyMs:
            latencyMs,

        measuredAt:
            new Date().toISOString()

    };


    /* --------------------------------------------------------
       Store latency
       -------------------------------------------------------- */

    recordLatency(
        measurement
    );


    /* --------------------------------------------------------
       Send measured latency back to Node-RED
       -------------------------------------------------------- */

    sendLatencyReport(
        measurement
    );


    /* --------------------------------------------------------
       Print latency in browser console
       -------------------------------------------------------- */

    console.log('');

    console.log(
        '========== END-TO-END LATENCY =========='
    );


    console.log(
        'Command ID:',
        data.command_id
    );


    console.log(
        'Command:',
        pending.command
    );


    console.log(
        'Relay:',
        pending.relay
    );


    console.log(
        'Latency:',
        latencyMs.toFixed(2),
        'ms'
    );


    console.log(
        'Latency:',
        (
            latencyMs / 1000
        ).toFixed(4),
        'seconds'
    );


    console.log(
        '========================================'
    );


    /* --------------------------------------------------------
       Update optional latency display
       -------------------------------------------------------- */

    const latencyEl =
        document.getElementById(
            'latency-val'
        );


    if (latencyEl) {

        latencyEl.textContent =
            `${latencyMs.toFixed(2)} ms`;

    }


    /* --------------------------------------------------------
       Update sample count
       -------------------------------------------------------- */

    const sampleEl =
        document.getElementById(
            'latency-samples'
        );


    if (sampleEl) {

        sampleEl.textContent =
            latencySamples.length;

    }


    /* --------------------------------------------------------
       Update average latency
       -------------------------------------------------------- */

    const averageEl =
        document.getElementById(
            'latency-average'
        );


    if (averageEl) {

        const stats =
            getLatencyStatistics();


        if (stats) {

            averageEl.textContent =
                `${stats.average.toFixed(2)} ms`;

        }

    }


    /* --------------------------------------------------------
       Print statistics
       -------------------------------------------------------- */

    printLatencyStatistics();

}


/* ============================================================
   SEND RELAY COMMAND
   ============================================================ */

function sendRelayCommand(
    relayNumber,
    isTurnedOn
) {

    /* --------------------------------------------------------
       Create command
       -------------------------------------------------------- */

    const command =
        `RELAY${relayNumber}_${
            isTurnedOn
                ? 'ON'
                : 'OFF'
        }`;


    /* --------------------------------------------------------
       Check WebSocket
       -------------------------------------------------------- */

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {

        console.warn(
            `WebSocket is not open. ` +
            `Command '${command}' was not sent.`
        );


        /*
         * Restore switch because command
         * was not actually sent.
         */

        const toggle =
            document.getElementById(
                `relay-${relayNumber}`
            );


        if (toggle) {

            toggle.checked =
                !isTurnedOn;

        }


        return;

    }


    /* --------------------------------------------------------
       Generate command ID
       -------------------------------------------------------- */

    const commandId =
        generateCommandId();


    /* --------------------------------------------------------
       START LATENCY TIMER
       -------------------------------------------------------- */

    /*
     * performance.now() is used for measuring elapsed time.
     *
     * We DO NOT use:
     *
     * Date.now() - Date.now()
     *
     * because performance.now() is designed for
     * accurate elapsed-time measurement.
     */

    const startTime =
        performance.now();


    /* --------------------------------------------------------
       Create JSON command
       -------------------------------------------------------- */

    const packet = {

        type:
            'relay_command',

        command_id:
            commandId,

        command:
            command,

        relay:
            relayNumber,

        requested_state:
            isTurnedOn
                ? 'ON'
                : 'OFF',

        user_command_timestamp:
            new Date().toISOString()

    };


    /* --------------------------------------------------------
       Save pending command
       -------------------------------------------------------- */

    pendingCommands.set(
        commandId,
        {

            relay:
                relayNumber,

            command:
                command,

            requestedState:
                isTurnedOn
                    ? 'ON'
                    : 'OFF',

            startTime:
                startTime

        }
    );


    /* --------------------------------------------------------
       Send JSON through WebSocket
       -------------------------------------------------------- */

    try {

        socket.send(
            JSON.stringify(
                packet
            )
        );


        console.log(
            'Relay command sent:',
            packet
        );

    } catch (error) {

        console.error(
            'Failed to send relay command:',
            error
        );


        pendingCommands.delete(
            commandId
        );


        /*
         * Restore switch
         */

        const toggle =
            document.getElementById(
                `relay-${relayNumber}`
            );


        if (toggle) {

            toggle.checked =
                !isTurnedOn;

        }


        return;

    }


    /* --------------------------------------------------------
       Temporary UI update
       -------------------------------------------------------- */

    const stateText =
        document.getElementById(
            `relay-${relayNumber}-text`
        );


    if (stateText) {

        stateText.textContent =
            isTurnedOn
                ? 'ON'
                : 'OFF';


        if (isTurnedOn) {

            stateText.classList.add(
                'on'
            );

        } else {

            stateText.classList.remove(
                'on'
            );

        }

    }


    /* --------------------------------------------------------
       Timeout
       -------------------------------------------------------- */

    setTimeout(
        () => {

            /*
             * If the matching relay status has not
             * arrived within 10 seconds, remove it.
             */

            if (
                pendingCommands.has(
                    commandId
                )
            ) {

                pendingCommands.delete(
                    commandId
                );


                console.warn(
                    'Relay response timeout.'
                );


                console.warn(
                    'Command ID:',
                    commandId
                );


                console.warn(
                    'Command:',
                    command
                );


                /*
                 * Optional UI indication.
                 */

                const toggle =
                    document.getElementById(
                        `relay-${relayNumber}`
                    );


                if (toggle) {

                    toggle.checked =
                        !isTurnedOn;

                }

            }

        },
        COMMAND_TIMEOUT_MS
    );

}


/* ============================================================
   RECORD LATENCY SAMPLE
   ============================================================ */

function recordLatency(
    measurement
) {

    if (
        !measurement ||
        !Number.isFinite(
            measurement.latencyMs
        )
    ) {

        return;

    }


    latencySamples.push(
        measurement
    );


    /* --------------------------------------------------------
       Keep maximum number of records
       -------------------------------------------------------- */

    if (
        latencySamples.length >
        MAX_LATENCY_SAMPLES
    ) {

        latencySamples.shift();

    }


    /* --------------------------------------------------------
       Save records
       -------------------------------------------------------- */

    try {

        localStorage.setItem(
            'smart_home_latency_samples',
            JSON.stringify(
                latencySamples
            )
        );

    } catch (error) {

        console.warn(
            'Could not save latency samples:',
            error
        );

    }

}


/* ============================================================
   LOAD SAVED LATENCY DATA
   ============================================================ */

function loadLatencySamples() {

    try {

        const saved =
            localStorage.getItem(
                'smart_home_latency_samples'
            );


        if (!saved) {

            return;

        }


        const parsed =
            JSON.parse(
                saved
            );


        if (
            Array.isArray(
                parsed
            )
        ) {

            latencySamples =
                parsed;

        }

    } catch (error) {

        console.warn(
            'Could not load latency samples:',
            error
        );

    }

}


/* ============================================================
   LATENCY STATISTICS
   ============================================================ */

function getLatencyStatistics() {

    if (
        latencySamples.length === 0
    ) {

        return null;

    }


    const values =
        latencySamples
            .map(
                sample =>
                    Number(
                        sample.latencyMs
                    )
            )
            .filter(
                value =>
                    Number.isFinite(
                        value
                    )
            );


    if (
        values.length === 0
    ) {

        return null;

    }


    /* --------------------------------------------------------
       Sort
       -------------------------------------------------------- */

    const sorted =
        [...values].sort(
            (a, b) =>
                a - b
        );


    /* --------------------------------------------------------
       Average
       -------------------------------------------------------- */

    const sum =
        values.reduce(
            (total, value) =>
                total + value,
            0
        );


    const average =
        sum /
        values.length;


    /* --------------------------------------------------------
       Minimum
       -------------------------------------------------------- */

    const minimum =
        sorted[0];


    /* --------------------------------------------------------
       Maximum
       -------------------------------------------------------- */

    const maximum =
        sorted[
            sorted.length - 1
        ];


    /* --------------------------------------------------------
       P95
       -------------------------------------------------------- */

    const p95Index =
        Math.ceil(
            0.95 *
            sorted.length
        ) - 1;


    const p95 =
        sorted[
            Math.max(
                0,
                p95Index
            )
        ];


    /* --------------------------------------------------------
       Standard deviation
       -------------------------------------------------------- */

    const variance =
        values.reduce(
            (sum, value) => {

                const difference =
                    value -
                    average;

                return (
                    sum +
                    (
                        difference *
                        difference
                    )
                );

            },
            0
        ) /
        values.length;


    const standardDeviation =
        Math.sqrt(
            variance
        );


    return {

        samples:
            values.length,

        average:
            average,

        minimum:
            minimum,

        maximum:
            maximum,

        p95:
            p95,

        standardDeviation:
            standardDeviation

    };

}


/* ============================================================
   PRINT LATENCY STATISTICS
   ============================================================ */

function printLatencyStatistics() {

    const stats =
        getLatencyStatistics();


    if (!stats) {

        return;

    }


    console.log('');

    console.log(
        '========== LATENCY STATISTICS =========='
    );


    console.log(
        'Samples:',
        stats.samples
    );


    console.log(
        'Average:',
        stats.average.toFixed(2),
        'ms'
    );


    console.log(
        'Minimum:',
        stats.minimum.toFixed(2),
        'ms'
    );


    console.log(
        'Maximum:',
        stats.maximum.toFixed(2),
        'ms'
    );


    console.log(
        'P95:',
        stats.p95.toFixed(2),
        'ms'
    );


    console.log(
        'Standard Deviation:',
        stats.standardDeviation.toFixed(2),
        'ms'
    );


    console.log(
        '========================================'
    );

}


/* ============================================================
   HANDLE INCOMING WEBSOCKET MESSAGE
   ============================================================ */

function handleWebSocketMessage(event) {

    if (
        !event ||
        !event.data
    ) {

        return;

    }


    let payload;


    /* --------------------------------------------------------
       Parse JSON
       -------------------------------------------------------- */

    try {

        payload =
            JSON.parse(
                event.data
            );

    } catch (error) {

        /*
         * Ignore raw / non-JSON messages.
         */

        console.warn(
            'Received non-JSON WebSocket message:',
            event.data
        );

        return;

    }


    if (
        !payload ||
        typeof payload !== 'object'
    ) {

        return;

    }


    /* ========================================================
       RELAY STATUS
       ======================================================== */

    if (
        payload.type ===
        'relay_status'
    ) {

        handleRelayStatus(
            payload
        );

        return;

    }


    /* ========================================================
       SENSOR DATA
       ======================================================== */

    if (
        payload.type ===
            'industrial_sensor_data' ||
        payload.type ===
            'smart_home_sensor_data'
    ) {

        updateSensorData(
            payload
        );

        return;

    }


    /*
     * Unknown message type
     */

    console.log(
        'Ignored WebSocket message type:',
        payload.type
    );

}


/* ============================================================
   CONNECT WEBSOCKET
   ============================================================ */

function connectWebSocket() {

    /* --------------------------------------------------------
       Clear previous reconnect timer
       -------------------------------------------------------- */

    if (reconnectTimer) {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer = null;

    }


    const url =
        getWebSocketUrl();


    console.log(
        `Connecting to WebSocket: ${url}`
    );


    /* --------------------------------------------------------
       Create WebSocket
       -------------------------------------------------------- */

    try {

        socket =
            new WebSocket(
                url
            );

    } catch (error) {

        console.error(
            'WebSocket initialization error:',
            error
        );


        updateConnectionStatus(
            'Disconnected'
        );


        scheduleReconnect();

        return;

    }


    /* --------------------------------------------------------
       OPEN
       -------------------------------------------------------- */

    socket.onopen =
        function () {

            console.log(
                'WebSocket connected.'
            );


            updateConnectionStatus(
                'Connected'
            );


            if (reconnectTimer) {

                clearTimeout(
                    reconnectTimer
                );

                reconnectTimer = null;

            }

        };


    /* --------------------------------------------------------
       MESSAGE
       -------------------------------------------------------- */

    socket.onmessage =
        handleWebSocketMessage;


    /* --------------------------------------------------------
       ERROR
       -------------------------------------------------------- */

    socket.onerror =
        function (error) {

            console.warn(
                'WebSocket encountered an error:',
                error
            );

        };


    /* --------------------------------------------------------
       CLOSE
       -------------------------------------------------------- */

    socket.onclose =
        function () {

            console.log(
                'WebSocket connection closed.'
            );


            updateConnectionStatus(
                'Disconnected'
            );


            scheduleReconnect();

        };

}


/* ============================================================
   SCHEDULE RECONNECT
   ============================================================ */

function scheduleReconnect() {

    if (reconnectTimer) {

        return;

    }


    reconnectTimer =
        setTimeout(
            () => {

                reconnectTimer =
                    null;


                connectWebSocket();

            },
            RECONNECT_DELAY_MS
        );

}


/* ============================================================
   MOBILE / TAB RETURN RECONNECT
   ============================================================ */

document.addEventListener(
    'visibilitychange',
    () => {

        if (
            document.visibilityState ===
            'visible'
        ) {

            if (
                !socket ||
                socket.readyState !==
                    WebSocket.OPEN
            ) {

                console.log(
                    'Page became visible. Reconnecting WebSocket...'
                );

                connectWebSocket();

            }

        }

    }
);


/* ============================================================
   DOM READY
   ============================================================ */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        /* ----------------------------------------------------
           Load saved latency measurements
           ---------------------------------------------------- */

        loadLatencySamples();


        /* ----------------------------------------------------
           Setup four relay switches
           ---------------------------------------------------- */

        for (
            let i = 1;
            i <= 4;
            i++
        ) {

            const toggle =
                document.getElementById(
                    `relay-${i}`
                );


            if (!toggle) {

                continue;

            }


            toggle.addEventListener(
                'change',
                (event) => {

                    sendRelayCommand(
                        i,
                        event.target.checked
                    );

                }
            );

        }


        /* ----------------------------------------------------
           Initial WebSocket connection
           ---------------------------------------------------- */

        connectWebSocket();


        /* ----------------------------------------------------
           Print saved statistics
           ---------------------------------------------------- */

        printLatencyStatistics();

    }
);