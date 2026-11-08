export const isDevCopy = (): boolean => Boolean(process.env.HATSTAND_DEV_COPY);

export const DEV_COPY_MESSAGE = 'The development copy does not change your real repositories or git settings. Do this in the installed app.';
