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
    await telnyx.calls.actions.answer(callControlId);
}

async function playAudio(callControlId, audioUrl, loop = false) {
    await telnyx.calls.actions.startPlayback(callControlId, {
        audio_url: audioUrl,
        loop: loop ? "infinite" : 1
    });
}

async function stopAudio(callControlId) {
    await telnyx.calls.actions.playbackStop(callControlId);
}

async function recordAudio(callControlId) {
    await telnyx.calls.actions.startRecording(callControlId, {
        format: "mp3",
        channels: "single",
        play_beep: false,
        timeout_secs: 2,
        maximum_length: 120,
    });
}

module.exports = {
    answerCall,
    playAudio,
    stopAudio,
    recordAudio,
    downloadRecording
};
