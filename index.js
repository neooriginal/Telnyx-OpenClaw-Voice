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

const THINK_SOUND_FILE = "thinking.mp3";
const THINK_SOUND_URL = `/audio-templates/${THINK_SOUND_FILE}`;

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
                let greeting = "";

                if (existingMessages.length > 0 && existingMessages[existingMessages.length - 1].role === "assistant") {
                    greeting = existingMessages[existingMessages.length - 1].content;
                    console.log(`[index] Using pre-defined intro for call ${callControlId}: ${greeting}`);
                } else {
                    let timeOfDay = new Date().getHours();
                    if (timeOfDay < 12) {
                        greeting = "Guten Morgen";
                    } else if (timeOfDay < 18) {
                        greeting = "Guten Tag";
                    } else {
                        greeting = "Guten Abend";
                    }
                    greeting += ", " + process.env.NAME + ".";
                    stateManager.addMessage(callControlId, { role: "assistant", content: greeting });
                    console.log(`[index] Using default greeting for call ${callControlId}`);
                }

                const filename = `greeting_${callControlId}_${Date.now()}.mp3`;
                const audioPath = path.join(audioDir, filename);
                await openaiService.generateTTS(greeting, audioPath);

                const audioUrl = `${baseUrl}/audio/${filename}`;
                await telnyxService.playAudio(callControlId, audioUrl);
                break;
            }

            case "call.playback.ended":
            case "call.speak.ended":
                if (stateManager.isProcessing(callControlId)) {
                    console.log(`[index] Ignoring playback.ended for ${callControlId} since we are still processing.`);
                    return;
                }

                await telnyxService.stopTranscription(callControlId);
                await telnyxService.recordAudio(callControlId);
                break;

            case "call.dtmf.received": {
                console.log(`[DTMF] Received digit: ${payload.digit} for ${callControlId}`);
                await telnyxService.stopRecording(callControlId);
                break;
            }

            case "call.recording.saved": {
                const recordingUrl = payload.recording_urls.mp3;
                const localPath = path.join(audioDir, `user_${callControlId}_${Date.now()}.mp3`);

                console.log(`[STT] Processing recording: ${recordingUrl}`);
                stateManager.setProcessing(callControlId, true);
                await telnyxService.downloadRecording(recordingUrl, localPath);

                await telnyxService.playAudio(callControlId, `${baseUrl}${THINK_SOUND_URL}`, true);

                const transcript = await openaiService.transcribeAudio(localPath);
                if (!transcript?.trim()) {
                    console.log(`[STT] Empty transcript for ${callControlId}`);
                    await telnyxService.recordAudio(callControlId);
                    return;
                }

                console.log(`[Chat] User: ${transcript}`);
                stateManager.addMessage(callControlId, { role: "user", content: transcript });

                let aiResponse = await openaiService.getChatCompletion(stateManager.getMessages(callControlId));

                // Filter out technical heartbeat messages
                if (aiResponse === "HEARTBEAT_OK") {
                    console.log(`[Chat] AI returned HEARTBEAT_OK, retrying...`);
                    aiResponse = await openaiService.getChatCompletion(stateManager.getMessages(callControlId));
                }

                console.log(`[Chat] AI: ${aiResponse}`);
                stateManager.addMessage(callControlId, { role: "assistant", content: aiResponse });

                const ttsFilename = `res_${callControlId}_${Date.now()}.mp3`;
                const ttsPath = path.join(audioDir, ttsFilename);
                await openaiService.generateTTS(aiResponse, ttsPath);

                await telnyxService.stopAudio(callControlId);

                console.log(`[index] Playing AI response for call ${callControlId}`);
                await telnyxService.playAudio(callControlId, `${baseUrl}/audio/${ttsFilename}`);
                break;
            }

            case "call.hangup":
                stateManager.endSession(callControlId);
                break;

            case "call.playback.started":
                stateManager.setProcessing(callControlId, false);
                break;

            case "call.transcription":
            case "call.speak.started":
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

    // Optional ngrok tunneling
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
