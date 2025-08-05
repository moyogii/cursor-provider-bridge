import * as vscode from 'vscode';
import { ServiceManager } from './services/ServiceManager';
import { SetupManager } from './services/SetupManager';
import { getLogger } from './utils/logger';

let serviceManager: ServiceManager;
let setupManager: SetupManager;

export function activate(context: vscode.ExtensionContext): void {
    const logger = getLogger();
    logger.info('Activating Cursor Provider Bridge extension');

    try {
        setupManager = new SetupManager(context);
        context.subscriptions.push(setupManager);

        if (setupManager.shouldShowSetup()) {
            logger.info('First-time setup required');
            
            registerCommands(context, undefined);
            
            setupManager.showSetupWizard().then((completed) => {
                if (completed) {
                    initializeServices(context);
                } else {
                    logger.info('Setup was skipped or cancelled');
                    vscode.window.showWarningMessage(
                        'Cursor Provider Bridge setup was not completed. The extension will have limited functionality until setup is complete.',
                        'Run Setup'
                    ).then((selection) => {
                        if (selection === 'Run Setup') {
                            vscode.commands.executeCommand('cursor-provider-bridge.runSetup');
                        }
                    });
                }
            }).catch((error) => {
                logger.error('Setup wizard failed', error);
                vscode.window.showErrorMessage(
                    `Setup failed: ${error instanceof Error ? error.message : String(error)}`
                );
            });
        } else {
            initializeServices(context);
            registerCommands(context, serviceManager);
        }

        logger.info('Cursor Provider Bridge extension activated successfully');
    } catch (error) {
        logger.error('Failed to activate extension', error);
        vscode.window.showErrorMessage(
            `Failed to activate Cursor Provider Bridge: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

function initializeServices(context: vscode.ExtensionContext): void {
    const logger = getLogger();
    
    try {
        serviceManager = new ServiceManager(context);
        context.subscriptions.push(serviceManager);
        
        logger.info('Services initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize services', error);
        throw error;
    }
}

export function deactivate(): void {
    const logger = getLogger();
    logger.info('Deactivating Cursor Provider Bridge extension');

    if (serviceManager) {
        serviceManager.dispose();
    }

    if (setupManager) {
        setupManager.dispose();
    }

    logger.info('Cursor Provider Bridge extension deactivated');
}

function registerCommands(context: vscode.ExtensionContext, services: ServiceManager | undefined): void {
    const requiresSetup = () => {
        if (!services || !setupManager.isSetupCompleted()) {
            vscode.window.showWarningMessage(
                'Please complete the first-time setup before using this feature.',
                'Run Setup'
            ).then((selection) => {
                if (selection === 'Run Setup') {
                    vscode.commands.executeCommand('cursor-provider-bridge.runSetup');
                }
            });
            return true;
        }
        return false;
    };

    const commands = [
        vscode.commands.registerCommand('cursor-provider-bridge.start', async () => {
            if (requiresSetup()) {
                return;
            }
            
            try {
                await services!.startBridge();
                vscode.window.showInformationMessage('Cursor Provider Bridge started successfully');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to start Cursor Provider Bridge: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.stop', async () => {
            if (requiresSetup()) {
                return;
            }
            
            try {
                await services!.stopBridge();
                vscode.window.showInformationMessage('Cursor Provider Bridge stopped');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to stop Cursor Provider Bridge: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.restart', async () => {
            if (requiresSetup()) {
                return;
            }
            
            try {
                await services!.restartBridge();
                vscode.window.showInformationMessage('Cursor Provider Bridge restarted');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to restart Cursor Provider Bridge: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.configure', async () => {
            if (requiresSetup()) {
                return;
            }
            
            try {
                await services!.showConfiguration();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to open configuration: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.showQuickMenu', async () => {
            if (requiresSetup()) {
                return;
            }
            
            try {
                await services!.showQuickMenu();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to show menu: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.runSetup', async () => {
            try {
                const completed = await setupManager.showSetupWizard();
                if (completed && !services) {
                    initializeServices(context);
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Setup failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        })
    ];

    commands.forEach(command => context.subscriptions.push(command));
}