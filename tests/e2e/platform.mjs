// What the end-to-end tests need to do differently on Linux, where they also run, than on macOS.
export const isMac = process.platform === 'darwin';

// Playwright starts Electron with --password-store=basic and --use-mock-keychain. On macOS the mock
// keychain stores secrets; on Linux there is then no safe storage, so the app uses an in-memory key.
export const testKeychainEnv = isMac ? {} : { HATSTAND_TEST_KEYCHAIN: '1' };

// The app's shortcuts are Command+key on macOS and Ctrl+Shift+key elsewhere.
export const shortcut = (key) => (isMac ? `Meta+${key}` : `Control+Shift+${key}`);
