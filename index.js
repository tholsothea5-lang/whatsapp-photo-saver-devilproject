'use strict';

const { logger } = require('./src/logger');
const { loadConfig } = require('./src/config');
const { Monitor } = require('./src/monitor');
const { createServer } = require('./src/server');

async function main() {
    const config = loadConfig();
    logger.info(`Starting WhatsApp Photo Saver`);
    logger.info(`Download folder: ${config.downloadDir}`);

    const monitor = new Monitor(config);
    const app = createServer(monitor);

    const server = app.listen(config.port, config.listenHost || '127.0.0.1', () => {
        logger.ok(`Web UI running at http://localhost:${config.port}`);
    });

    server.on('error', (err) => {
        logger.error(`HTTP server error: ${err.message}`);
    });

    const shutdown = async (signal) => {
        logger.info(`Received ${signal}, shutting down…`);
        server.close();
        await monitor.stop();
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
        logger.error(`Uncaught exception: ${err.stack || err.message}`);
    });
    process.on('unhandledRejection', (reason) => {
        logger.error(`Unhandled rejection: ${reason}`);
    });

    try {
        await monitor.start();
    } catch (err) {
        logger.error(`Could not start WhatsApp client: ${err.message}`);
        logger.error(err.stack);
        server.close();
        process.exit(1);
    }
}

main();
