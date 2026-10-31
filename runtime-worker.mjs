import * as lib from './lib.mjs';

// Exit hooks in Playwright synchronously kill a browser even if launch has not resolved yet.
// Register before launch so cancellation cannot strand a detached browser during startup.
process.on('SIGTERM', () => process.exit(143));
process.on('SIGINT', () => process.exit(130));

const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
process.once('message', async ({ operation, args, configSnapshot, runtime }) => {
  try {
    lib.installConfigSnapshot(configSnapshot);
    let result;
    if (operation === 'ihc-engine') {
      result = await lib.runIhcEngine({ ...args, onEvent: event => process.send({ type: 'event', event }) });
    } else if (operation === 'wb') result = lib.runWb({ ...args, runtime });
    else if (operation === 'pcr') result = lib.runPcr({ ...args, runtime });
    else if (operation === 'pcr-preview') result = lib.previewPcr({ ...args, runtime });
    else if (operation === 'verify-pcr') result = lib.runVerifyPcr(args.dir);
    else throw new Error(`Unknown analysis operation: ${operation}`);
    await send({ type: 'result', result });
  } catch (error) {
    await send({ type: 'error', error: { message: error.message, code: error.code, provenance: error.provenance } });
  } finally {
    process.disconnect();
  }
});
