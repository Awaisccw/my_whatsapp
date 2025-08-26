const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

// --- IMPORTANT: PASTE YOUR N8N WEBHOOK URL HERE ---
const N8N_WEBHOOK_URL = 'https://n8n-n8n.xapfvn.easypanel.host/webhook/custom_wa_bot'; // Replace this with the URL from your n8n Webhook node

// --- Initialize Express, HTTP Server, and Socket.IO ---
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow connections from any origin for simplicity
        methods: ["GET", "POST"]
    }
});

// --- Initialize WhatsApp Client with LocalAuth for session saving ---
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '.' // Save session data in the root directory
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for running in server environments
    }
});

let qrCodeData = null;

// --- Socket.IO handles real-time connection to your website ---
io.on('connection', (socket) => {
    console.log('A user connected to the webpage.');
    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }
});

// --- WhatsApp Client Events ---
client.on('qr', (qr) => {
    console.log('QR code generated.');
    qrCodeData = qr;
    io.emit('qr', qr); // Send QR code to the connected webpage
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready!');
    qrCodeData = null;
    io.emit('ready', 'Client is ready and connected!');
});

// --- THIS IS THE MAIN LOGIC ---
client.on('message', async (message) => {
    // Ignore messages from groups, status updates, etc.
    if (!message.from.endsWith('@c.us')) {
        return;
    }
    
    console.log(`Message from ${message.from}: ${message.body}`);

    try {
        // 1. Send the message to your n8n workflow
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msg: message.body,
                from: message.from
            }),
        });

        if (!response.ok) {
            throw new Error(`n8n workflow returned an error: ${response.statusText}`);
        }

        // 2. Get the AI's response from n8n
        const n8nResponse = await response.json();

        // The AI Agent node in n8n typically returns its result in a property called 'output'.
        // If your AI node returns the text differently, you may need to adjust n8nResponse.output
        const replyText = n8nResponse.output;

        // 3. Send the AI's response back to the user on WhatsApp
        if (replyText) {
            client.sendMessage(message.from, replyText);
            console.log(`Sent reply to ${message.from}: ${replyText}`);
        } else {
             console.error('Received empty or invalid response from n8n:', n8nResponse);
        }

    } catch (error) {
        console.error('Error processing message:', error);
    }
});


client.initialize();

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});