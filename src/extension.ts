import * as vscode from 'vscode';
import { ServiceManager } from './services/ServiceManager';
import { SetupManager } from './services/SetupManager';
import { getLogger } from './utils/logger';
import { Logger } from './types';

let serviceManager: ServiceManager;
let setupManager: SetupManager;

export function activate(context: vscode.ExtensionContext): void {
    const logger = getLogger();
    logger.info('Activating Cursor Provider Bridge extension');

    setupManager = new SetupManager(context);
    context.subscriptions.push(setupManager);
    registerCommands(context);

    setTimeout(async () => {
        try {
            if (setupManager.shouldShowSetup()) {
                await handleFirstTimeSetup(context, logger);
            } else {
                initializeServices(context);
            }
        } catch (error) {
            logger.error('Setup initialization failed', error);
            initializeServices(context);
        }
    }, 1000);

    logger.info('Cursor Provider Bridge extension activated successfully');
}

async function handleFirstTimeSetup(context: vscode.ExtensionContext, logger: Logger): Promise<void> {
    logger.info('First-time setup required');
    
    const result = await vscode.window.showInformationMessage(
        'Welcome to Cursor Provider Bridge! Let\'s set up your connection to local AI providers.',
        { modal: false },
        'Start Setup',
        'Skip for Now'
    );
    
    if (result === 'Start Setup') {
        const completed = await setupManager.showSetupWizard().catch((error) => {
            logger.error('Setup wizard failed', error);
            vscode.window.showErrorMessage(
                `Setup failed: ${error instanceof Error ? error.message : String(error)}`
            );
            return false;
        });

        if (completed) {
            initializeServices(context);
        } else if (setupManager.isSetupSkipped()) {
            showSetupSkippedMessage();
        }
    } else if (result === 'Skip for Now') {
        await setupManager.skipSetup();
        vscode.window.showInformationMessage(
            'Setup skipped. You can run setup anytime using "Cursor Provider Bridge: Run Setup" from the Command Palette.'
        );
    }
}

function showSetupSkippedMessage(): void {
    vscode.window.showWarningMessage(
        'Setup was skipped. The extension will have limited functionality until setup is complete.',
        'Run Setup'
    ).then((selection) => {
        if (selection === 'Run Setup') {
            vscode.commands.executeCommand('cursor-provider-bridge.runSetup');
        }
    });
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

function registerCommands(context: vscode.ExtensionContext): void {
    const requiresSetup = () => {
        if (!setupManager.isSetupCompleted()) {
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
            
            if (!serviceManager) {
                initializeServices(context);
            }
            
            try {
                await serviceManager.startBridge();
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
            
            if (!serviceManager) {
                initializeServices(context);
            }
            
            try {
                await serviceManager.stopBridge();
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
            
            if (!serviceManager) {
                initializeServices(context);
            }
            
            try {
                await serviceManager.restartBridge();
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
            
            if (!serviceManager) {
                initializeServices(context);
            }
            
            try {
                await serviceManager.showConfiguration();
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
            
            if (!serviceManager) {
                initializeServices(context);
            }
            
            try {
                await serviceManager.showQuickMenu();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to show menu: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.runSetup', async () => {
            try {
                const completed = await setupManager.showSetupWizard();
                if (completed && !serviceManager) {
                    initializeServices(context);
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Setup failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }),

        vscode.commands.registerCommand('cursor-provider-bridge.resetSetup', async () => {
            try {
                await setupManager.resetSetupState();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to reset setup state: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        })
    ];

    commands.forEach(command => context.subscriptions.push(command));
}