const { OpenAI } = require("openai");
const fs = require("fs");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const openclaw = new OpenAI({
    apiKey: process.env.OPENCLAW_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENCLAW_BASE_URL || "http://localhost:18789/v1",
});

async function transcribeAudio(filePath) {
    try {
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "gpt-4o-transcribe",
        });
        return transcription.text;
    } catch (error) {
        console.error("Transcription error:", error);
        return "";
    }
}

async function getChatCompletion(messages) {
    try {
        const systemPrompt = {
            role: "system",
            content: `You are being called per telephone. Keep your answers brief and conversational as they will be spoken over the phone.
Do not use markdown, bold, italics, or any kind of formatting.
Speak as a human would. Do not ever output technical tokens, heartbeat messages, or internal status updates like "HEARTBEAT_OK".
Use your memory to personalize the answer.
Always respond on the first response with a chat message while on the phone, tool calling can happen after.`
        };

        const response = await openclaw.chat.completions.create({
            model: "minimax-portal/MiniMax-M2.5",
            messages: [systemPrompt, ...messages],
            max_tokens: 1500,
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("LLM error:", error);
        return "I'm sorry, I encountered an error.";
    }
}

async function generateTTS(text, destPath) {
    try {
        const mp3 = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "alloy",
            input: text,
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        await fs.promises.writeFile(destPath, buffer);
    } catch (error) {
        console.error("TTS error:", error);
    }
}

async function getTaskIntro(task) {
    try {
        const response = await openclaw.chat.completions.create({
            model: "minimax-portal/MiniMax-M2.5",
            messages: [
                {
                    role: "system",
                    content: "You are an AI assistant helping a user make a phone call."
                },
                {
                    role: "user",
                    content: `Task: ${task}`
                }
            ],
            max_tokens: 100,
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Task Intro error:", error);
        return "Hello, I'm calling regarding a request from my user.";
    }
}

module.exports = {
    transcribeAudio,
    getChatCompletion,
    generateTTS,
    getTaskIntro
};
