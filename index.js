require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const telnyxService = require("./telnyxService");
const stateManager = require("./stateManager");
const openaiService = require("./openaiService");
const ngrok = require("@ngrok/ngrok");

const app = express();
const port = process.env.PORT || 3023;
let baseUrl = process.env.BASE_URL;

const THINK_SOUND_URL = "/audio-templates/thinking.mp3";
const INBOUND_GREETING_URL = "/audio-templates/greeting.mp3";

let lastOutboundCallAt = 0;
const OUTBOUND_RATE_LIMIT_MS = 60 * 1000;

function isNumberAllowed(number) {
    const whitelist = process.env.ALLOWED_NUMBERS;
    if (!whitelist || !whitelist.trim()) return true;
    return whitelist.split(",").map(n => n.trim()).includes(number);
}

app.use(express.json());
app.use("/audio", express.static(path.join(__dirname, "audio")));
app.use("/audio-templates", express.static(path.join(__dirname, "audioTemplates")));

app.get("/health", function (req, res) {
    res.status(200).json({ status: "ok" });
});

app.post("/call", async function (req, res) {
    const { task, to } = req.body;
    const toPhoneNumber = to || process.env.DEFAULT_TO_NUMBER;

    if (!task) {
        return res.status(400).json({ error: "Task is required" });
    }
    if (!toPhoneNumber) {
        return res.status(400).json({ error: "To phone number is required" });
    }

    if (!isNumberAllowed(toPhoneNumber)) {
        console.warn(`[index] Rejected call to unlisted number: ${toPhoneNumber}`);
        return res.status(403).json({ error: "Number not in allowed list" });
    }

    const now = Date.now();
    if (now - lastOutboundCallAt < OUTBOUND_RATE_LIMIT_MS) {
        const retryAfter = Math.ceil((OUTBOUND_RATE_LIMIT_MS - (now - lastOutboundCallAt)) / 1000);
        console.warn(`[index] Rate limit hit, retry in ${retryAfter}s`);
        return res.status(429).json({ error: "Rate limit: 1 outbound call per minute", retry_after_secs: retryAfter });
    }
    lastOutboundCallAt = now;

    try {
        console.log(`[index] Initiating call to ${toPhoneNumber} with task: ${task}`);
        const introMessage = await openaiService.getTaskIntro(task);

        const webhookUrl = `${baseUrl}/voice/webhook`;
        const call = await telnyxService.createCall(
            toPhoneNumber,
            process.env.TELNYX_PHONE_NUMBER,
            webhookUrl,
            process.env.TELNYX_CONNECTION_ID
        );

        const callControlId = call.data.call_control_id;
        stateManager.initSession(callControlId);
        stateManager.addMessage(callControlId, { role: "assistant", content: introMessage });

        res.status(200).json({
            status: "Call initiated",
            call_control_id: callControlId,
            intro: introMessage
        });
    } catch (err) {
        console.error("Error initiating call:", err);
        res.status(500).json({ error: "Failed to initiate call" });
    }
});

const audioDir = path.join(__dirname, "audio");
if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir);
}

app.post("/voice/webhook", async function (req, res) {
    res.status(200).send("OK");

    const event = req.body;
    if (!event?.data?.event_type) return;

    const { event_type: eventType, payload } = event.data;
    const { call_control_id: callControlId } = payload;

    console.log(`[${eventType}] ${callControlId}`);

    if (!stateManager.sessionExists(callControlId) &&
        eventType !== "call.initiated" &&
        eventType !== "call.answered") {
        console.log(`[index] No active session for ${callControlId}, ignoring ${eventType}`);
        return;
    }

    if (eventType === "call.initiated" && payload.direction === "outbound") return;

    try {
        switch (eventType) {
            case "call.initiated":
                if (payload.direction === "incoming") {
                    await telnyxService.answerCall(callControlId);
                    stateManager.initSession(callControlId);
                }
                break;

            case "call.answered": {
                const existingMessages = stateManager.getMessages(callControlId);
                stateManager.setProcessing(callControlId, true);
                stateManager.setAwaitingUserInput(callControlId, true);

                const lastMessage = existingMessages.at(-1);
                if (lastMessage?.role === "assistant") {
                    const filename = `greeting_${callControlId}_${Date.now()}.mp3`;
                    const audioPath = path.join(audioDir, filename);
                    await openaiService.generateTTS(lastMessage.content, audioPath);
                    await telnyxService.playAudio(callControlId, `${baseUrl}/audio/${filename}`);
                    setTimeout(() => fs.unlink(audioPath, () => { }), 60000);
                } else {
                    stateManager.addMessage(callControlId, { role: "assistant", content: "[greeting]" });
                    await telnyxService.playAudio(callControlId, `${baseUrl}${INBOUND_GREETING_URL}`);
                }
                break;
            }

            case "call.playback.started":
                stateManager.setProcessing(callControlId, true);
                break;

            case "call.playback.ended":
            case "call.speak.ended":
                if (!stateManager.sessionExists(callControlId)) break;
                stateManager.setProcessing(callControlId, false);
                if (!stateManager.isAwaitingUserInput(callControlId)) break;
                stateManager.setAwaitingUserInput(callControlId, false);
                setTimeout(async () => {
                    try {
                        await telnyxService.recordAudio(callControlId);
                    } catch (e) {
                        console.error(`[index] Failed to start recording for ${callControlId}:`, e.message || e);
                    }
                }, 500);
                break;

            case "call.dtmf.received": {
                console.log(`[DTMF] Received digit: ${payload.digit} for ${callControlId}`);
                await telnyxService.stopRecording(callControlId);
                break;
            }

            case "call.recording.saved": {
                if (!stateManager.sessionExists(callControlId)) {
                    console.log(`[index] Session ended, ignoring recording for ${callControlId}`);
                    return;
                }

                if (stateManager.isProcessing(callControlId)) {
                    console.log(`[index] AI is speaking, ignoring recording for ${callControlId}`);
                    return;
                }

                const recordingUrl = payload.recording_urls.mp3;

                if (stateManager.hasProcessedRecording(callControlId, recordingUrl)) {
                    console.log(`[index] Duplicate recording event, ignoring for ${callControlId}`);
                    return;
                }
                stateManager.markRecordingProcessed(callControlId, recordingUrl);

                const localPath = path.join(audioDir, `user_${callControlId}_${Date.now()}.mp3`);

                console.log(`[STT] Processing recording: ${recordingUrl}`);
                stateManager.setProcessing(callControlId, true);
                stateManager.setAwaitingUserInput(callControlId, false);
                await telnyxService.downloadRecording(recordingUrl, localPath);

                await telnyxService.playAudio(callControlId, `${baseUrl}${THINK_SOUND_URL}`, true);

                const transcript = await openaiService.transcribeAudio(localPath);
                fs.unlink(localPath, () => { });

                if (!transcript?.trim()) {
                    console.log(`[STT] Empty transcript for ${callControlId}`);
                    await telnyxService.stopAudio(callControlId);
                    stateManager.setAwaitingUserInput(callControlId, true);
                    stateManager.setProcessing(callControlId, false);
                    await telnyxService.recordAudio(callControlId);
                    return;
                }

                console.log(`[Chat] User: ${transcript}`);
                stateManager.addMessage(callControlId, { role: "user", content: transcript });

                let aiResponse = await openaiService.getChatCompletion(stateManager.getMessages(callControlId));
                if (aiResponse === "HEARTBEAT_OK") {
                    aiResponse = await openaiService.getChatCompletion(stateManager.getMessages(callControlId));
                }

                console.log(`[Chat] AI: ${aiResponse}`);
                stateManager.addMessage(callControlId, { role: "assistant", content: aiResponse });

                const ttsFilename = `res_${callControlId}_${Date.now()}.mp3`;
                const ttsPath = path.join(audioDir, ttsFilename);
                await openaiService.generateTTS(aiResponse, ttsPath);

                await telnyxService.stopAudio(callControlId);

                stateManager.setAwaitingUserInput(callControlId, true);
                console.log(`[index] Playing AI response for call ${callControlId}`);
                await telnyxService.playAudio(callControlId, `${baseUrl}/audio/${ttsFilename}`);

                setTimeout(() => fs.unlink(ttsPath, () => { }), 60000);
                break;
            }

            case "call.hangup":
                stateManager.endSession(callControlId);
                break;

            default:
                console.log(`Unhandled event type: ${eventType}`);
        }
    } catch (err) {
        console.error("Webhook processing error:", err);
    }
});

app.listen(port, "0.0.0.0", async () => {
    console.log(`Server listening on port ${port} (0.0.0.0)`);

    if (process.env.NGROK_AUTHTOKEN) {
        try {
            const tunnel = await ngrok.forward({
                addr: `127.0.0.1:${port}`,
                authtoken: process.env.NGROK_AUTHTOKEN,
                domain: process.env.NGROK_DOMAIN,
                metadata: "Telnyx Voice AI App"
            });

            console.log(`ngrok tunnel established at: ${tunnel.url()}`);
            baseUrl = tunnel.url();
            console.log(`Base URL updated to: ${baseUrl}`);
        } catch (err) {
            console.error("Error starting ngrok tunnel:", err);
        }
    } else {
        console.log(`Base URL: ${baseUrl}`);
    }
});
