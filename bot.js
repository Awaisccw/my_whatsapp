// --- Import necessary libraries ---
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

// ===================================================================================
// --- IMPORTANT: PASTE YOUR N8N PRODUCTION WEBHOOK URL HERE ---
// ===================================================================================
const N8N_WEBHOOK_URL = 'https://n8n-n8n.xapfvn.easypanel.host/webhook-test/custom_wa_bot'; 
// ===================================================================================


// --- Initialize Express, HTTP Server, and Socket.IO for the QR code webpage ---
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow connections from any website for simplicity
        methods: ["GET", "POST"]
    }
});

// --- Initialize the WhatsApp Client ---
const client = new Client({
    // Use LocalAuth to save the session, so you don't have to scan the QR code every time
    authStrategy: new LocalAuth({
        dataPath: '/data' // IMPORTANT: This path is for Railway's persistent volume
    }),
    // Puppeteer options are required for running in a server environment like Railway
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
            '--disable-gpu'
        ]
    }
});

// To store the QR code data
let qrCodeData = null;

// --- Socket.IO handles the real-time connection to your cPanel website ---
io.on('connection', (socket) => {
    console.log('A user connected to the QR code webpage.');
    // If a QR code is already generated, send it immediately to the new user
    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }
});


// --- WhatsApp Client Event Handlers ---

// Fired when a QR code is generated
client.on('qr', (qr) => {
    console.log('QR code generated. Sending to webpage...');
    qrCodeData = qr;
    io.emit('qr', qr); // Send QR code to all connected web clients
});

// Fired when the client is authenticated and ready
client.on('ready', () => {
    console.log('SUCCESS: WhatsApp Client is ready!');
    qrCodeData = null; // Clear the QR code data once ready
    io.emit('ready', 'Client is ready and connected!'); // Notify the webpage
});

// Fired on an incoming message
client.on('message', async (message) => {
    // IMPORTANT: Ignore messages from groups or non-user chats to prevent chaos
    if (!message.from.endsWith('@c.us')) {
        return;
    }
    
    console.log(`[MESSAGE] From: ${message.from}, Body: "${message.body}"`);

    try {
        // 1. Send the incoming message to your n8n workflow
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msg: message.body,
                from: message.from
            }),
        });

        // Check if the request to n8n was successful
        if (!response.ok) {
            throw new Error(`n8n workflow returned an error: ${response.status} ${response.statusText}`);
        }

        // 2. Get the AI's response from the n8n workflow
        const n8nResponse = await response.json();
        
        // The AI Agent node in n8n returns its text result in a property called 'output'.
        const replyText = n8nResponse.output;

        // 3. Send the AI's response back to the user on WhatsApp
        if (replyText) {
            await client.sendMessage(message.from, replyText);
            console.log(`[REPLY] To: ${message.from}, Body: "${replyText}"`);
        } else {
             console.error('[ERROR] Received an empty or invalid response from n8n:', n8nResponse);
        }

    } catch (error) {
        console.error('[ERROR] Failed to process message:', error);
    }
});

// Fired when the client disconnects
client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    // You might want to add logic here to alert you that the bot is down
});


// --- Start the bot and the web server ---
console.log("Initializing WhatsApp client...");
client.initialize();

const PORT = process.env.PORT || 3000; // Railway provides the PORT environment variable
httpServer.listen(PORT, () => {
    console.log(`Server is listening for QR code page connections on port ${PORT}`);
});

