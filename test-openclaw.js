require("dotenv").config();
const openaiService = require("./openaiService");

async function testOpenClaw() {
    console.log("=== Testing OpenClaw Integration ===");
    console.log(`Base URL: ${process.env.OPENCLAW_BASE_URL || "http://localhost:18789/v1"}`);

    const messages = [
        { role: "user", content: "Hallo! Wer bist du?" }
    ];

    console.log("Sending request to OpenClaw...");
    try {
        const response = await openaiService.getChatCompletion(messages);
        console.log("\n--- OpenClaw Response ---");
        console.log(response);
        console.log("-------------------------\n");
    } catch (error) {
        console.error("Test failed:", error);
    }
}

testOpenClaw();
