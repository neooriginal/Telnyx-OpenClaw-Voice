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
                let greeting = "";
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

                const filename = `greeting_${callControlId}.mp3`;
                const audioPath = path.join(audioDir, filename);
                await openaiService.generateTTS(greeting, audioPath);

                const audioUrl = `${baseUrl}/audio/${filename}`;
                await telnyxService.playAudio(callControlId, audioUrl);
                break;
            }

            case "call.playback.ended":
            case "call.speak.ended":
                await telnyxService.recordAudio(callControlId);
                break;

            case "call.recording.saved": {
                const recordingUrl = payload.recording_urls.mp3;
                const localPath = path.join(audioDir, `user_${callControlId}_${Date.now()}.mp3`);

                console.log(`[STT] Processing recording: ${recordingUrl}`);
                await telnyxService.downloadRecording(recordingUrl, localPath);

                // Play looping thinking sound while processing
                await telnyxService.playAudio(callControlId, `${baseUrl}${THINK_SOUND_URL}`, true);

                const transcript = await openaiService.transcribeAudio(localPath);
                if (!transcript?.trim()) {
                    console.log(`[STT] Empty transcript for ${callControlId}`);
                    await telnyxService.recordAudio(callControlId);
                    return;
                }

                console.log(`[Chat] User: ${transcript}`);
                stateManager.addMessage(callControlId, { role: "user", content: transcript });

                const aiResponse = await openaiService.getChatCompletion(stateManager.getMessages(callControlId));
                console.log(`[Chat] AI: ${aiResponse}`);
                stateManager.addMessage(callControlId, { role: "assistant", content: aiResponse });

                const ttsFilename = `res_${callControlId}_${Date.now()}.mp3`;
                const ttsPath = path.join(audioDir, ttsFilename);
                await openaiService.generateTTS(aiResponse, ttsPath);

                // Stop the looping thinking sound before playing the response
                await telnyxService.stopAudio(callControlId);

                await telnyxService.playAudio(callControlId, `${baseUrl}/audio/${ttsFilename}`);
                break;
            }

            case "call.hangup":
                stateManager.endSession(callControlId);
                break;

            case "call.transcription":
            case "call.speak.started":
            case "call.playback.started":
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
