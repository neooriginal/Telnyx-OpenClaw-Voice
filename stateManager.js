/**
 * In-memory store for call contexts
 * In production this should be a DB like Redis
 */

const sessions = {};

function initSession(callControlId) {
    sessions[callControlId] = {
        messages: []
    };
}

function addMessage(callControlId, message) {
    if (!sessions[callControlId]) {
        initSession(callControlId);
    }
    sessions[callControlId].messages.push(message);

    // Keep context window manageable
    if (sessions[callControlId].messages.length > 20) {
        sessions[callControlId].messages = sessions[callControlId].messages.slice(-20);
    }
}

function getMessages(callControlId) {
    if (!sessions[callControlId]) {
        return [];
    }
    return sessions[callControlId].messages;
}

function endSession(callControlId) {
    if (sessions[callControlId]) {
        delete sessions[callControlId];
    }
}

module.exports = {
    initSession,
    addMessage,
    getMessages,
    endSession
};
