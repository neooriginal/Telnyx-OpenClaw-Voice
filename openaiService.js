require("dotenv").config();
const { OpenAI } = require("openai");
const fs = require("fs");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const openclaw = new OpenAI({
    apiKey: process.env.OPENCLAW_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENCLAW_BASE_URL || "http://localhost:18789/v1",
});

/**
 * Transcribe an audio file using Whisper
 */
async function transcribeAudio(filePath) {
    try {
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
        });
        return transcription.text;
    } catch (error) {
        console.error("Error transcribing audio:", error);
        return "";
    }
}

/**
 * Get response from GPT model
 */
async function getChatCompletion(messages) {
    try {
        // We prepend a system prompt 
        const systemPrompt = {
            role: "system",
            content: "You are a helpful and concise phone assistant. Keep your answers brief and conversational as they will be spoken over the phone. Do not use markdown."
        };

        const response = await openclaw.chat.completions.create({
            model: "minimax-portal/MiniMax-M2.5",
            messages: [systemPrompt, ...messages],
            max_tokens: 150,
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error getting chat completion:", error);
        return "I'm sorry, I encountered an error.";
    }
}

/**
 * Generate Text-to-Speech audio and save to disk
 */
async function generateTTS(text, destPath) {
    try {
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy", // alloy, echo, fable, onyx, nova, shimmer
            input: text,
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        await fs.promises.writeFile(destPath, buffer);
    } catch (error) {
        console.error("Error generating TTS:", error);
    }
}

module.exports = {
    transcribeAudio,
    getChatCompletion,
    generateTTS
};
