const cooldowns = new Map();
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Checks if a command is on cooldown for a specific chat.
 * @param {string} commandName - Name of the command.
 * @param {string} chatId - JID of the chat/user.
 * @returns {number|null} - Remaining seconds if on cooldown, otherwise null.
 */
export function checkCooldown(commandName, chatId) {
    const key = `${commandName}:${chatId}`;
    const now = Date.now();
    const lastUsed = cooldowns.get(key);

    if (lastUsed) {
        const elapsed = now - lastUsed;
        if (elapsed < DEFAULT_COOLDOWN_MS) {
            return Math.ceil((DEFAULT_COOLDOWN_MS - elapsed) / 1000);
        }
    }

    return null;
}

/**
 * Updates the last used timestamp for a command in a specific chat.
 * @param {string} commandName - Name of the command.
 * @param {string} chatId - JID of the chat/user.
 */
export function updateCooldown(commandName, chatId) {
    const key = `${commandName}:${chatId}`;
    cooldowns.set(key, Date.now());
}
