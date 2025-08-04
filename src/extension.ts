import * as vscode from 'vscode';
import { ServiceManager } from './services/ServiceManager';
import { getLogger } from './utils/logger';

let serviceManager: ServiceManager;

export function activate(context: vscode.ExtensionContext): void {
    const logger = getLogger();
    logger.info('Activating Cursor Model Bridge extension');

    try {
        // Initialize the service manager
        serviceManager = new ServiceManager(context);
        context.subscriptions.push(serviceManager);

        // Register extension commands
        registerCommands(context, serviceManager);

        logger.info('Cursor Model Bridge extension activated successfully');
    } catch (error) {
        logger.error('Failed to activate extension', error);
        vscode.window.showErrorMessage(
            `Failed to activate Cursor Model Bridge: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

export function deactivate(): void {
    const logger = getLogger();
    logger.info('Deactivating Cursor Model Bridge extension');

    if (serviceManager) {
        serviceManager.dispose();
    }

    logger.info('Cursor Model Bridge extension deactivated');
}

function registerCommands(context: vscode.ExtensionContext, services: ServiceManager): void {
    const commands = [
        vscode.commands.registerCommand('cursor-model-bridge.start', async () => {
            try {
                await services.startBridge();
                vscode.window.showInformationMessage('Cursor Model Bridge started successfully');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to start Cursor Model Bridge: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-model-bridge.stop', async () => {
            try {
                await services.stopBridge();
                vscode.window.showInformationMessage('Cursor Model Bridge stopped');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to stop Cursor Model Bridge: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-model-bridge.restart', async () => {
            try {
                await services.restartBridge();
                vscode.window.showInformationMessage('Cursor Model Bridge restarted');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to restart Cursor Model Bridge: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-model-bridge.configure', async () => {
            try {
                await services.showConfiguration();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to open configuration: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-model-bridge.showQuickMenu', async () => {
            try {
                await services.showQuickMenu();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to show menu: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-model-bridge.testConnection', async () => {
            try {
                const isConnected = await services.testConnection();
                
                if (isConnected) {
                    vscode.window.showInformationMessage('Connection to AI provider successful');
                } else {
                    vscode.window.showWarningMessage('Failed to connect to AI provider. Check your configuration.');
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Connection test failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        })
    ];

    // Register all commands
    commands.forEach(command => context.subscriptions.push(command));
}