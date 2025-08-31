// Helper function to get current UTC datetime in 'YYYY-MM-DD HH:MM:SS' format
function getFormattedUtcDatetime(addHours = 0) {
    const now = new Date();
    if (addHours > 0) {
        now.setTime(now.getTime() + addHours * 60 * 60 * 1000);
    }
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Helper function to get current local datetime (UTC+8) in 'YYYY-MM-DD HH:MM:SS' format
function getFormattedLocalDatetime() {
    const now = new Date();
    // Create a new Date object for UTC+8 by adding 8 hours (in milliseconds) to the current UTC time
    const localNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);

    const year = localNow.getUTCFullYear();
    const month = String(localNow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localNow.getUTCDate()).padStart(2, '0');
    const hours = String(localNow.getUTCHours()).padStart(2, '0');
    const minutes = String(localNow.getUTCMinutes()).padStart(2, '0');
    const seconds = String(localNow.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

module.exports = {
    getFormattedUtcDatetime,
    getFormattedLocalDatetime
};
