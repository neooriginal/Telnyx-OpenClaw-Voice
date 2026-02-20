require("dotenv").config();
const telnyx = require("telnyx")(process.env.TELNYX_API_KEY);
const https = require("https");
const fs = require("fs");

function downloadRecording(url, dest) {
    return new Promise(function (resolve, reject) {
        const file = fs.createWriteStream(dest);
        https.get(url, function (response) {
            if (response.statusCode !== 200) {
                return reject(new Error(`Download failed: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on("finish", function () {
                file.close(resolve);
            });
        }).on("error", function (err) {
            fs.unlink(dest, function () { reject(err); });
        });
    });
}

async function answerCall(callControlId) {
    try {
        await telnyx.calls.actions.answer(callControlId);
    } catch (err) {
        console.error(`[telnyxService] Error answering call ${callControlId}:`, err.message || err);
        throw err;
    }
}

async function playAudio(callControlId, audioUrl, loop = false) {
    try {
        await telnyx.calls.actions.startPlayback(callControlId, {
            audio_url: audioUrl,
            loop: loop ? "infinity" : 1
        });
    } catch (err) {
        console.error(`[telnyxService] Error playing audio ${audioUrl} for ${callControlId}:`, err.message || err);
        throw err;
    }
}

async function stopAudio(callControlId) {
    try {
        await telnyx.calls.actions.playbackStop(callControlId);
    } catch (err) {
        console.error(`[telnyxService] Error stopping audio for ${callControlId}:`, err.message || err);
        // Don't throw here as it might be already stopped
    }
}

async function recordAudio(callControlId) {
    try {
        await telnyx.calls.actions.startRecording(callControlId, {
            format: "mp3",
            channels: "single",
            play_beep: false,
            timeout_secs: 2,
            maximum_length: 120,
        });
    } catch (err) {
        console.error(`[telnyxService] Error starting recording for ${callControlId}:`, err.message || err);
        throw err;
    }
}

module.exports = {
    answerCall,
    playAudio,
    stopAudio,
    recordAudio,
    downloadRecording
};
