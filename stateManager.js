const sessions = {};

function initSession(callControlId) {
    sessions[callControlId] = {
        messages: [],
        isProcessing: false
    };
}

function addMessage(callControlId, message) {
    if (!sessions[callControlId]) {
        initSession(callControlId);
    }
    sessions[callControlId].messages.push(message);

    if (sessions[callControlId].messages.length > 20) {
        sessions[callControlId].messages = sessions[callControlId].messages.slice(-20);
    }
}

function getMessages(callControlId) {
    return sessions[callControlId]?.messages || [];
}

function endSession(callControlId) {
    delete sessions[callControlId];
}

function setProcessing(callControlId, value) {
    if (sessions[callControlId]) {
        sessions[callControlId].isProcessing = value;
    }
}

function isProcessing(callControlId) {
    return sessions[callControlId]?.isProcessing || false;
}

function sessionExists(callControlId) {
    return !!sessions[callControlId];
}

module.exports = {
    initSession,
    addMessage,
    getMessages,
    endSession,
    setProcessing,
    isProcessing,
    sessionExists
};
