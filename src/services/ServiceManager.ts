import * as vscode from 'vscode';
import { 
    IConfigurationManager,
    IModelProvider,
    ITunnelManager,
    BridgeConfiguration
} from '../types';
import { ConfigurationManager } from './ConfigurationManager';
import { LLMModelProvider } from './ModelProvider';
import { createTunnelManager } from './TunnelManager';
import { StatusBarManager } from './StatusBarManager';
import { getLogger, disposeLogger } from '../utils/logger';

export class ServiceManager implements vscode.Disposable {
    private readonly logger = getLogger();
    private readonly disposables: vscode.Disposable[] = [];

    public readonly configManager: IConfigurationManager;
    public readonly modelProvider: IModelProvider;
    public readonly tunnelManager: ITunnelManager;
    public readonly statusBarManager: StatusBarManager;

    constructor(context: vscode.ExtensionContext) {
        this.configManager = new ConfigurationManager();
        this.modelProvider = new LLMModelProvider(this.configManager);
        this.tunnelManager = createTunnelManager(this.configManager, this.modelProvider);
        this.statusBarManager = new StatusBarManager(
            this.configManager,
            this.modelProvider,
            this.tunnelManager
        );

        this.disposables.push(
            this.tunnelManager,
            this.statusBarManager,
            this.configManager as vscode.Disposable
        );

        this.setupConfigurationHandling();
        this.initializeStatusBar();
        this.handleAutoStart();
    }

    getConfiguration(): BridgeConfiguration {
        return this.configManager.getConfiguration();
    }

    async startBridge(): Promise<void> {
        await this.tunnelManager.start();
    }

    async stopBridge(): Promise<void> {
        await this.tunnelManager.stop();
    }

    async restartBridge(): Promise<void> {
        await this.tunnelManager.restart();
    }

    async showConfiguration(): Promise<void> {
        await this.configManager.showConfigurationQuickPick();
    }

    async showQuickMenu(): Promise<void> {
        await this.statusBarManager.showQuickMenu();
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch (error) {
                this.logger.error('Error disposing service', error);
            }
        }

        this.disposables.length = 0;
        disposeLogger();
    }

    private setupConfigurationHandling(): void {
        const configDisposable = this.configManager.onConfigurationChanged((config: BridgeConfiguration) => {
            this.statusBarManager.updateVisibility(config.showStatusBar);
        });
        this.disposables.push(configDisposable);
    }

    private initializeStatusBar(): void {
        const config = this.configManager.getConfiguration();
        this.statusBarManager.updateVisibility(config.showStatusBar);
    }

    private async handleAutoStart(): Promise<void> {
        const config = this.configManager.getConfiguration();
        
        if (!config.autoStart) {return;}

        if (!config.ngrokAuthToken) {
            this.showAutoStartConfigError();
            return;
        }

        try {
            await this.startBridge();
            vscode.window.showInformationMessage('Cursor Provider Bridge started automatically');
        } catch (error) {
            this.handleAutoStartError(error);
        }
    }

    private showAutoStartConfigError(): void {
        vscode.window.showWarningMessage(
            'Auto-start enabled but ngrok token not configured. Complete setup first.',
            'Run Setup',
            'Disable Auto-start'
        ).then(selection => {
            if (selection === 'Run Setup') {
                vscode.commands.executeCommand('cursor-provider-bridge.runSetup');
            } else if (selection === 'Disable Auto-start') {
                vscode.workspace.getConfiguration().update('cursor-provider-bridge.autoStart', false, true);
            }
        });
    }

    private handleAutoStartError(error: unknown): void {
        this.logger.error('Auto-start failed', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        const isPortError = errorMessage.includes('Port 8082 is already in use');
        const message = isPortError 
            ? 'Auto-start failed: Port 8082 is already in use. Stop other applications using this port or disable auto-start.'
            : `Auto-start failed: ${errorMessage}`;

        const actions = isPortError ? ['Disable Auto-start', 'Try Again'] : ['Retry'];

        vscode.window.showWarningMessage(message, ...actions).then(selection => {
            if (selection === 'Disable Auto-start') {
                vscode.workspace.getConfiguration().update('cursor-provider-bridge.autoStart', false, true);
            } else if (selection === 'Try Again' || selection === 'Retry') {
                this.startBridge().catch(retryError => {
                    this.logger.error('Retry failed', retryError);
                });
            }
        });
    }
}