require("dotenv").config();
const telnyx = require("telnyx")(process.env.TELNYX_API_KEY);
const axios = require("axios"); // using axios or standard https, we'll use https since axios isn't installed, let's just write a helper
const https = require("https");
const fs = require("fs");

/**
 * Download a remote file to a local path
 */
function downloadRecording(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download, status: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on("finish", () => {
                file.close(resolve);
            });
        }).on("error", (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

/**
 * Answer an incoming call
 */
async function answerCall(callControlId) {
    await telnyx.calls.actions.answer(callControlId);
}

/**
 * Play an audio file to the caller
 */
async function playAudio(callControlId, audioUrl) {
    await telnyx.calls.actions.startPlayback(callControlId, { audio_url: audioUrl });
}

/**
 * Record audio from the caller
 * We will use silence detection to stop the recording when the user stops speaking.
 */
async function recordAudio(callControlId) {
    await telnyx.calls.actions.startRecording(callControlId, {
        format: "mp3",
        channels: "single",
        play_beep: true,
        timeout_secs: 2, // stop recording after 2 seconds of silence
        maximum_length: 120, // 2 minutes max
    });
}

module.exports = {
    answerCall,
    playAudio,
    recordAudio,
    downloadRecording
};
