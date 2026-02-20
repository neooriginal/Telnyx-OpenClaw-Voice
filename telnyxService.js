require("dotenv").config();
const telnyx = require("telnyx")(process.env.TELNYX_API_KEY);
const https = require("https");
const fs = require("fs");

function isCallEndedError(err) {
    const errorBody = err.raw || err.error || (err.response && err.response.data);
    if (!errorBody || !errorBody.errors) return false;
    return errorBody.errors.some(e => ["90018", "90053", "90055"].includes(e.code));
}

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
        if (isCallEndedError(err)) {
            console.log(`[telnyxService] Call ${callControlId} already ended during answer attempt.`);
            return;
        }
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
        if (isCallEndedError(err)) {
            console.log(`[telnyxService] Call ${callControlId} already ended during playback attempt.`);
            return;
        }
        console.error(`[telnyxService] Error playing audio ${audioUrl} for ${callControlId}:`, err.message || err);
        throw err;
    }
}

async function stopAudio(callControlId) {
    try {
        await telnyx.calls.actions.stopPlayback(callControlId, {});
    } catch (err) {
        if (isCallEndedError(err)) {
            console.log(`[telnyxService] Call ${callControlId} already ended during stop audio attempt.`);
            return;
        }
        console.error(`[telnyxService] Error stopping audio for ${callControlId}:`, err.message || err);
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
        if (isCallEndedError(err)) {
            console.log(`[telnyxService] Call ${callControlId} already ended during record attempt.`);
            return;
        }
        console.error(`[telnyxService] Error starting recording for ${callControlId}:`, err.message || err);
        throw err;
    }
}

async function stopRecording(callControlId) {
    try {
        await telnyx.calls.actions.stopRecording(callControlId, {});
    } catch (err) {
        if (isCallEndedError(err)) {
            console.log(`[telnyxService] Call ${callControlId} already ended during stop recording attempt.`);
            return;
        }
        console.error(`[telnyxService] Error stopping recording for ${callControlId}:`, err.message || err);
    }
}

async function stopTranscription(callControlId) {
    try {
        await telnyx.calls.actions.stopTranscription(callControlId, {});
    } catch (err) {
        if (isCallEndedError(err)) return;
        console.error(`[telnyxService] Error stopping transcription for ${callControlId}:`, err.message || err);
    }
}

async function createCall(to, from, webhookUrl, connectionId) {
    try {
        const call = await telnyx.calls.create({
            to,
            from,
            connection_id: connectionId,
            webhook_url: webhookUrl
        });
        return call;
    } catch (err) {
        console.error(`[telnyxService] Error creating call to ${to}:`, err.message || err);
        throw err;
    }
}

module.exports = {
    answerCall,
    playAudio,
    stopAudio,
    recordAudio,
    downloadRecording,
    createCall,
    stopRecording,
    stopTranscription
};
