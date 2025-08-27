
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const N8N_WEBHOOK_URL = 'https://n8n-n8n.xapfvn.easypanel.host/webhook/custom_wa_bot'; // Keep your existing URL here

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/data' }),
    puppeteer: {
        headless: true,
        args: [ '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu' ]
    }
});

// --- State Variables ---
let qrCodeData = null;
let isReady = false;
let authenticatedUser = null;

// --- Socket.IO handles the real-time connection to the webpage ---
io.on('connection', (socket) => {
    console.log('A user connected to the QR code webpage.');

    // Immediately send the current status to the new visitor
    if (isReady && authenticatedUser) {
        socket.emit('authenticated', authenticatedUser);
    } else if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }

    // Listen for a logout command from the webpage button
    socket.on('logout', async () => {
        if (isReady) {
            console.log('[LOGOUT] Received logout command from web interface.');
            await client.logout();
        }
    });
});


// --- WhatsApp Client Event Handlers ---

// Fired when a QR code is generated
client.on('qr', (qr) => {
    console.log('QR code generated. Sending to webpage...');
    isReady = false;
    qrCodeData = qr;
    io.emit('qr', qr); // Send to all connected web clients
});

// Fired when the client is authenticated, but not yet ready
client.on('authenticated', () => {
    console.log('Client is authenticated!');
    authenticatedUser = client.info.wid.user; // Store the user's phone number
});

// Fired when the client is ready
client.on('ready', () => {
    console.log('SUCCESS: WhatsApp Client is ready!');
    isReady = true;
    qrCodeData = null;
    io.emit('authenticated', authenticatedUser); // Notify webpage that we are fully connected
});

// Fired on an incoming message
client.on('message', async (message) => {
    if (!message.from.endsWith('@c.us')) return;
    
    console.log(`[MESSAGE] From: ${message.from}, Body: "${message.body}"`);

    try {
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: message.body, from: message.from }),
        });

        if (!response.ok) throw new Error(`n8n workflow error: ${response.statusText}`);

        const n8nResponse = await response.json();
        const replyText = n8nResponse.output;

        if (replyText) {
            await client.sendMessage(message.from, replyText);
            console.log(`[REPLY] To: ${message.from}, Body: "${replyText}"`);
        } else {
             console.error('[ERROR] Empty or invalid response from n8n:', n8nResponse);
        }
    } catch (error) {
        console.error('[ERROR] Failed to process message:', error);
    }
});

// Fired when the client disconnects (e.g., user logs out from their phone or via the web button)
client.on('disconnected', (reason) => {
    console.log('Client was logged out.', reason);
    isReady = false;
    authenticatedUser = null;
    qrCodeData = null; // Clear old QR data
    io.emit('disconnected'); // Notify the webpage to reset to the QR scan state
});

// --- Start the bot and the web server ---
console.log("Initializing WhatsApp client...");
client.initialize();

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is listening for QR code page connections on port ${PORT}`);
});
