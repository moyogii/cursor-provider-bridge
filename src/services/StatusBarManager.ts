import * as vscode from 'vscode';
import {
    IConfigurationManager,
    IModelProvider,
    ITunnelManager,
    TunnelStatus,
    BridgeConfiguration,
    QuickPickOption
} from '../types';
import { getLogger } from '../utils/logger';

/**
 * Modern status bar manager with improved architecture and error handling
 */
export class ModernStatusBarManager implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly logger = getLogger();
    private updateInterval: NodeJS.Timeout | null = null;
    private updateTimeout: NodeJS.Timeout | null = null;

    constructor(
        private readonly configManager: IConfigurationManager,
        private readonly modelProvider: IModelProvider,
        private readonly tunnelManager: ITunnelManager
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        // Simple debounced update implementation

        this.initialize();
        this.logger.debug('Status bar manager initialized');
    }

    async showQuickMenu(): Promise<void> {
        const items = await this.createQuickPickItems();
        
        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'Cursor Model Bridge Options',
            title: this.getQuickPickTitle()
        });

        if (selection) {
            await this.handleQuickPickSelection(selection);
        }
    }

    updateVisibility(show: boolean): void {
        if (show) {
            this.statusBarItem.show();
            this.logger.debug('Status bar shown');
        } else {
            this.statusBarItem.hide();
            this.logger.debug('Status bar hidden');
        }
    }

    dispose(): void {
        this.stopPeriodicUpdate();
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }
        this.statusBarItem.dispose();
        this.logger.debug('Status bar manager disposed');
    }

    private initialize(): void {
        this.setupStatusBar();
        this.startPeriodicUpdate();
        
        // Set initial visibility based on configuration
        const config = this.configManager.getConfiguration();
        this.updateVisibility(config.showStatusBar);
    }

    private setupStatusBar(): void {
        this.statusBarItem.command = 'cursor-model-bridge.showQuickMenu';
        this.statusBarItem.tooltip = 'Cursor Model Bridge - Click for options';
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        const status = this.tunnelManager.getStatus();
        const config = this.configManager.getConfiguration();

        this.statusBarItem.text = this.getStatusBarText(status);
        this.statusBarItem.tooltip = this.getStatusBarTooltip(status, config);
        this.setStatusBarStyling(status);
    }

    private getStatusBarText(status: TunnelStatus): string {
        return 'Cursor Model Bridge';
    }

    private getStatusBarTooltip(status: TunnelStatus, config: BridgeConfiguration): string {
        const statusEmoji = status.isRunning ? '✅' : '❌';
        const baseInfo = `Status: ${statusEmoji}`;
        
        if (status.isRunning && status.url) {
            return `${baseInfo}\nURL: ${status.url}\nClick for options`;
        } else {
            const errorInfo = status.error ? `\nError: ${status.error}` : '';
            return `${baseInfo}${errorInfo}\nClick for options`;
        }
    }

    private setStatusBarStyling(status: TunnelStatus): void {
        if (status.isRunning) {
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.color = undefined;
        } else {
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        }
    }

    private startPeriodicUpdate(): void {
        // Update status every 5 seconds
        this.updateInterval = setInterval(() => {
            this.scheduleUpdate();
        }, 5000);
    }

    private stopPeriodicUpdate(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    private scheduleUpdate(): void {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(() => this.updateStatusBar(), 250);
    }

    private async createQuickPickItems(): Promise<QuickPickOption[]> {
        const status = this.tunnelManager.getStatus();
        const config = this.configManager.getConfiguration();
        const items: QuickPickOption[] = [];

        if (!status.isRunning) {
            items.push({
                label: 'Start Bridge',
                description: 'Start an ngrok tunnel to your model provider',
                detail: `Will tunnel to: ${config.providerUrl}`
            });
        }

        if (status.isRunning && status.url) {
            items.push({
                label: 'Copy Bridge URL',
                description: 'Copy the tunnel URL to clipboard'
            });
        }
        
        items.push({
            label: 'Configure',
            description: 'Open extension settings',
            detail: 'Modify model provider URL, ngrok settings, etc.'
        });

        if (status.isRunning) {
            items.push({
                label: 'Stop Bridge',
                description: 'Close the ngrok tunnel to your model provider',
                detail: `Currently running at: ${status.url}`
            });
        }

        return items;
    }

    private getQuickPickTitle(): string {
        const status = this.tunnelManager.getStatus();
        return `Cursor Model Bridge ${status.isRunning ? '(Active)' : '(Offline)'}`;
    }

    private async handleQuickPickSelection(selection: QuickPickOption): Promise<void> {
        try {
            switch (selection.label) {
                case 'Start Bridge':
                    await this.startBridge();
                    break;
                case 'Stop Bridge':
                    await this.stopBridge();
                    break;
                case 'Copy Bridge URL':
                    await this.copyBridgeUrl();
                    break;
                case 'Configure':
                    await this.openConfiguration();
                    break;
                default:
                    this.logger.warn(`Unhandled menu selection: ${selection.label}`);
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(`Error handling menu selection "${selection.label}"`, err);
            vscode.window.showErrorMessage(`Failed to ${selection.label.toLowerCase()}: ${err.message}`);
        }
    }

    private async startBridge(): Promise<void> {
        await this.tunnelManager.start();
        vscode.window.showInformationMessage('Cursor Model Bridge started');
        this.updateStatusBar();
    }

    private async stopBridge(): Promise<void> {
        await this.tunnelManager.stop();
        vscode.window.showInformationMessage('Cursor Model Bridge stopped');
        this.updateStatusBar();
    }

    private async restartBridge(): Promise<void> {
        await this.tunnelManager.restart();
        vscode.window.showInformationMessage('Cursor Model Bridge restarted');
        this.updateStatusBar();
    }

    private async copyBridgeUrl(): Promise<void> {
        const status = this.tunnelManager.getStatus();
        
        if (!status.isRunning || !status.url) {
            vscode.window.showWarningMessage('No Bridge URL available to copy');
            return;
        }

        await vscode.env.clipboard.writeText(status.url);
        vscode.window.showInformationMessage(`Bridge URL copied to clipboard: ${status.url}`);
    }


    private async openConfiguration(): Promise<void> {
        await this.configManager.showConfigurationQuickPick();
    }
}