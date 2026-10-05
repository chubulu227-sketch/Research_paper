/**
 * IoT Research Paper Dashboard - Client Logic
 * Plain JavaScript (ES6+), zero external dependencies.
 */

let socket = null;
let reconnectTimer = null;

const RECONNECT_DELAY_MS = 3000;

const pendingCommands = new Map();

const COMMAND_TIMEOUT_MS = 10000;

function generateCommandId() {

    if (
        window.crypto &&
        typeof window.crypto.randomUUID === 'function'
    ) {
        return window.crypto.randomUUID();
    }

    return (
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).substring(2, 10)
    );
}


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
        document.getElementById('connection-status');

    if (!statusEl) return;

    statusEl.textContent = status;

    if (status === 'Connected') {

        statusEl.classList.add('connected');

    } else {

        statusEl.classList.remove('connected');
    }
}


/* ============================================================
   SENSOR DATA UPDATE
   ============================================================ */

function updateSensorData(data) {

    if (!data || typeof data !== 'object') {
        return;
    }


    /* TEMPERATURE */

    if (
        data.temperature !== undefined &&
        data.temperature !== null
    ) {

        const tempEl =
            document.getElementById('temperature-val');

        if (tempEl) {

            tempEl.textContent =
                `${data.temperature} °C`;
        }
    }


    /* HUMIDITY */

    if (
        data.humidity !== undefined &&
        data.humidity !== null
    ) {

        const humEl =
            document.getElementById('humidity-val');

        if (humEl) {

            humEl.textContent =
                `${data.humidity} %`;
        }
    }


    /* GAS */

    if (
        data.gas !== undefined &&
        data.gas !== null
    ) {

        const gasEl =
            document.getElementById('gas-val');

        if (gasEl) {

            gasEl.textContent =
                `${data.gas}`;
        }
    }


    /* FLAME */

    if (
        data.flame !== undefined &&
        data.flame !== null
    ) {

        const flameEl =
            document.getElementById('flame-val');

        if (flameEl) {

            flameEl.textContent =
                data.flame
                    ? 'FLAME DETECTED'
                    : 'NO FLAME';
        }
    }
}


/* ============================================================
   RELAY STATUS UI
   ============================================================ */

function updateRelayStatusUI(data) {

    if (!data || typeof data !== 'object') {
        return;
    }

    for (let i = 1; i <= 4; i++) {

        const relayKey =
            `relay${i}`;

        if (
            data[relayKey] === undefined ||
            data[relayKey] === null
        ) {
            continue;
        }

        const state =
            String(data[relayKey]).toUpperCase();

        const isOn =
            state === 'ON';

        const toggle =
            document.getElementById(
                `relay-${i}`
            );

        if (toggle) {
            toggle.checked = isOn;
        }

        const stateText =
            document.getElementById(
                `relay-${i}-text`
            );

        if (stateText) {

            stateText.textContent =
                isOn ? 'ON' : 'OFF';

            if (isOn) {

                stateText.classList.add('on');

            } else {

                stateText.classList.remove('on');
            }
        }
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


    console.log(
        'Processing relay status:',
        data
    );


    /* --------------------------------------------------------
       Update actual relay UI
       -------------------------------------------------------- */

    updateRelayStatusUI(data);


    /* --------------------------------------------------------
       Check command ID
       -------------------------------------------------------- */

    if (!data.command_id) {

        console.log(
            'Relay status received without command_id.'
        );

        return;
    }


    /* --------------------------------------------------------
       Find matching pending command
       -------------------------------------------------------- */

    const pending =
        pendingCommands.get(
            data.command_id
        );


    if (!pending) {

        console.log(
            'No pending command found for command_id:',
            data.command_id
        );

        return;
    }


    /* --------------------------------------------------------
       Calculate response time
       -------------------------------------------------------- */

    const endTime =
        performance.now();

    const responseTime =
        endTime -
        pending.startTime;


    /* --------------------------------------------------------
       Remove completed command
       -------------------------------------------------------- */

    pendingCommands.delete(
        data.command_id
    );


    /* --------------------------------------------------------
       Console result
       -------------------------------------------------------- */

    console.log(
        'Relay command confirmed:',
        pending.command
    );

    console.log(
        'Command ID:',
        data.command_id
    );

    console.log(
        'Relay:',
        pending.relay
    );

    console.log(
        'Response time:',
        responseTime.toFixed(2),
        'ms'
    );
}


/* ============================================================
   SEND RELAY COMMAND
   ============================================================ */

function sendRelayCommand(
    relayNumber,
    isTurnedOn
) {

    const command =
        `RELAY${relayNumber}_${isTurnedOn ? 'ON' : 'OFF'}`;


    /* --------------------------------------------------------
       Check WebSocket
       -------------------------------------------------------- */

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {

        console.warn(
            `WebSocket is not open. Command '${command}' was not sent.`
        );

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
       CREATE COMMAND ID
       -------------------------------------------------------- */

    const commandId =
        generateCommandId();


    /* --------------------------------------------------------
       START RESPONSE TIMER
       -------------------------------------------------------- */

    const startTime =
        performance.now();


    /* --------------------------------------------------------
       CREATE JSON COMMAND
       -------------------------------------------------------- */

    const packet = {

        type: "relay_command",

        command_id: commandId,

        command: command,

        relay: relayNumber,

        requested_state:
            isTurnedOn
                ? "ON"
                : "OFF",

        user_command_timestamp:
            new Date().toISOString()
    };


    /* --------------------------------------------------------
       SAVE COMMAND
       -------------------------------------------------------- */

    pendingCommands.set(
        commandId,
        {
            relay: relayNumber,
            command: command,
            startTime: startTime
        }
    );


    /* --------------------------------------------------------
       SEND JSON TO NODE-RED
       -------------------------------------------------------- */

    try {

        socket.send(
            JSON.stringify(packet)
        );

        console.log(
            "Relay command sent:",
            packet
        );

    } catch (error) {

        console.error(
            "Failed to send relay command:",
            error
        );

        pendingCommands.delete(
            commandId
        );

        return;
    }


    /* --------------------------------------------------------
       UPDATE UI TEMPORARILY
       -------------------------------------------------------- */

    const stateText =
        document.getElementById(
            `relay-${relayNumber}-text`
        );

    if (stateText) {

        stateText.textContent =
            isTurnedOn ? "ON" : "OFF";

        if (isTurnedOn) {

            stateText.classList.add("on");

        } else {

            stateText.classList.remove("on");
        }
    }


    /* --------------------------------------------------------
       RESPONSE TIMEOUT
       -------------------------------------------------------- */

    setTimeout(() => {

        if (
            pendingCommands.has(commandId)
        ) {

            pendingCommands.delete(
                commandId
            );

            console.warn(
                "Relay status timeout. Command ID:",
                commandId
            );
        }

    }, COMMAND_TIMEOUT_MS);
}


/* ============================================================
   HANDLE WEBSOCKET MESSAGE
   ============================================================ */

function handleWebSocketMessage(event) {

    // console.log(
    //     "RAW WEBSOCKET MESSAGE:",
    //     event.data
    // );

    if (!event || !event.data) {
        return;
    }

    let payload;

    try {

        payload =
            JSON.parse(event.data);

    } catch (error) {

        console.warn(
            "WebSocket JSON parse error:",
            event.data
        );

        return;
    }

    // console.log(
    //     "PARSED WEBSOCKET MESSAGE:",
    //     payload
    // );

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
        payload.type === 'relay_status'
    ) {

        console.log(
            "RELAY STATUS RECEIVED BY BROWSER:",
            payload
        );

        handleRelayStatus(
            payload
        );

        return;
    }


    /* ========================================================
       SENSOR DATA
       ======================================================== */

    if (
        payload.type === 'industrial_sensor_data' ||
        payload.type === 'smart_home_sensor_data'
    ) {

        updateSensorData(
            payload
        );

        return;
    }
}


/* ============================================================
   CONNECT WEBSOCKET
   ============================================================ */

function connectWebSocket() {

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

    try {

        socket =
            new WebSocket(url);

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


    /* WebSocket OPEN */

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


    /* WebSocket MESSAGE */

    socket.onmessage =
        handleWebSocketMessage;


    /* WebSocket ERROR */

    socket.onerror =
        function (error) {

            console.warn(
                'WebSocket encountered an error:',
                error
            );
        };


    /* WebSocket CLOSE */

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
   RECONNECT
   ============================================================ */

function scheduleReconnect() {

    if (reconnectTimer) {
        return;
    }

    reconnectTimer =
        setTimeout(
            () => {

                reconnectTimer = null;

                connectWebSocket();

            },
            RECONNECT_DELAY_MS
        );
}


/* ============================================================
   DOM READY
   ============================================================ */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        /* Setup four relay switches */

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


        /* Connect to Node-RED */

        connectWebSocket();

    }
);