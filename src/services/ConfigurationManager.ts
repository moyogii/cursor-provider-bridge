import * as vscode from 'vscode';
import {
    BridgeConfiguration,
    ConfigurationKey,
    IConfigurationManager,
    DEFAULT_CONFIGURATION,
    NGROK_REGIONS,
    ConfigurationError
} from '../types';
import { getLogger } from '../utils/logger';

export class ConfigurationManager implements IConfigurationManager {
    private static readonly EXTENSION_ID = 'cursor-provider-bridge';
    private static readonly SECRET_KEY = 'ngrokAuthToken';
    private readonly logger = getLogger();
    private configuration: BridgeConfiguration;
    private readonly changeListeners = new Set<(config: BridgeConfiguration) => void>();
    private readonly secretStorage: vscode.SecretStorage | undefined;
    private isInitialized = false;
    private initializationPromise: Promise<void> | null = null;

    constructor(secretStorage?: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
        this.configuration = DEFAULT_CONFIGURATION;
        this.setupConfigurationWatcher();
        
        this.initializationPromise = this.initializeConfiguration().then(() => {
            this.isInitialized = true;
            this.logger.debug('Configuration manager initialized successfully');
        }).catch(error => {
            this.logger.error('Failed to initialize configuration, using defaults', error);
            this.isInitialized = true;
            throw error;
        });
    }

    private async initializeConfiguration(): Promise<void> {
        try {
            this.configuration = await this.loadConfiguration();
            this.logger.debug('Configuration loaded successfully from VSCode settings');
        } catch (error) {
            this.logger.error('Failed to load configuration, using defaults', error);
            this.configuration = DEFAULT_CONFIGURATION;
        }
    }

    getConfiguration(): BridgeConfiguration {
        if (!this.isInitialized) {
            this.logger.debug('Configuration not yet initialized, returning defaults');
            return { ...DEFAULT_CONFIGURATION };
        }

        if (!this.secretStorage && this.configuration.ngrokAuthToken) {
            throw new ConfigurationError('SecretStorage is required for secure token storage but is unavailable');
        }
        return { ...this.configuration };
    }

    async waitForInitialization(): Promise<void> {
        if (this.initializationPromise) {
            await this.initializationPromise;
        }
    }

    async getConfigurationAsync(): Promise<BridgeConfiguration> {
        await this.waitForInitialization();
        return this.getConfiguration();
    }

    async updateConfiguration<K extends ConfigurationKey>(
        key: K,
        value: BridgeConfiguration[K]
    ): Promise<void> {
        try {
            if (key === 'ngrokAuthToken') {
                await this.setSecureToken(value as string);
            } else {
                const config = vscode.workspace.getConfiguration(ConfigurationManager.EXTENSION_ID);
                await config.update(key, value, vscode.ConfigurationTarget.Global);
            }
        } catch (error) {
            const configError = new ConfigurationError(
                `Failed to update configuration key '${key}'`,
                error instanceof Error ? error : new Error(String(error))
            );
            this.logger.error('Configuration update failed', configError);
            throw configError;
        }

        await this.reload();
        this.logger.info(`Configuration updated: ${key} = ${key === 'ngrokAuthToken' ? '[REDACTED]' : String(value)}`);
    }

    async reload(): Promise<void> {
        const oldConfig = this.configuration;
        this.configuration = await this.loadConfiguration();

        if (this.hasConfigChanged(oldConfig, this.configuration)) {
            this.notifyChangeListeners();
            this.logger.debug('Configuration reloaded', this.configuration);
        }
    }

    async showConfigurationQuickPick(): Promise<void> {
        const config = this.getConfiguration();
        const items = this.createConfigurationQuickPickItems(config);

        const selectedItem = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select configuration to modify',
            title: 'Cursor Provider Bridge Configuration'
        });

        if (selectedItem) {
            await this.promptForConfigurationValue(selectedItem.key);
        }
    }

    onConfigurationChanged(listener: (config: BridgeConfiguration) => void): vscode.Disposable {
        this.changeListeners.add(listener);
        return new vscode.Disposable(() => {
            this.changeListeners.delete(listener);
        });
    }

    async validateConfiguration(): Promise<ReadonlyArray<string>> {
        const errors: string[] = [];
        const config = this.getConfiguration();

        if (!this.isValidUrl(config.providerUrl)) {
            errors.push('Invalid Provider URL format');
        }

        if (!NGROK_REGIONS.includes(config.ngrokRegion)) {
            errors.push('Invalid ngrok region');
        }

        return errors;
    }

    dispose(): void {
        this.changeListeners.clear();
        this.logger.debug('Configuration manager disposed');
    }

    private async loadConfiguration(): Promise<BridgeConfiguration> {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.EXTENSION_ID);
        
        return {
            providerUrl: config.get('providerUrl', DEFAULT_CONFIGURATION.providerUrl),
            autoStart: config.get('autoStart', DEFAULT_CONFIGURATION.autoStart),
            showStatusBar: config.get('showStatusBar', DEFAULT_CONFIGURATION.showStatusBar),
            ngrokAuthToken: await this.getSecureToken(),
            ngrokDomain: config.get('ngrokDomain', DEFAULT_CONFIGURATION.ngrokDomain),
            ngrokRegion: config.get('ngrokRegion', DEFAULT_CONFIGURATION.ngrokRegion)
        };
    }

    private setupConfigurationWatcher(): void {
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(ConfigurationManager.EXTENSION_ID)) {
                this.reload().catch(error => {
                    this.logger.error('Failed to reload configuration after change', error);
                });
            }
        });
    }

    private hasConfigChanged(oldConfig: BridgeConfiguration, newConfig: BridgeConfiguration): boolean {
        return JSON.stringify(oldConfig) !== JSON.stringify(newConfig);
    }

    private notifyChangeListeners(): void {
        for (const listener of this.changeListeners) {
            try {
                listener(this.configuration);
            } catch (error) {
                this.logger.error('Error in configuration change listener', error);
            }
        }
    }

    private createConfigurationQuickPickItems(config: BridgeConfiguration) {
        return [
            {
                label: '$(server) Provider URL',
                description: config.providerUrl,
                key: 'providerUrl' as ConfigurationKey
            },
            {
                label: '$(play) Auto Start',
                description: config.autoStart ? 'Enabled' : 'Disabled',
                key: 'autoStart' as ConfigurationKey
            },
            {
                label: '$(info) Show Status Bar',
                description: config.showStatusBar ? 'Enabled' : 'Disabled',
                key: 'showStatusBar' as ConfigurationKey
            },
            {
                label: '$(key) Ngrok Auth Token',
                description: config.ngrokAuthToken ? 'Set' : 'Not set',
                key: 'ngrokAuthToken' as ConfigurationKey
            },
            {
                label: '$(link) Ngrok Domain',
                description: config.ngrokDomain || 'Not set',
                key: 'ngrokDomain' as ConfigurationKey
            },
            {
                label: '$(globe) Ngrok Region',
                description: config.ngrokRegion,
                key: 'ngrokRegion' as ConfigurationKey
            }
        ];
    }

    private async promptForConfigurationValue(key: ConfigurationKey): Promise<void> {
        const config = this.getConfiguration();
        const currentValue = config[key];
        let newValue: unknown;

        switch (key) {
            case 'providerUrl':
                newValue = await this.promptForUrl(currentValue as string);
                break;
            case 'ngrokAuthToken':
                newValue = await this.promptForAuthToken(currentValue as string);
                break;
            case 'ngrokDomain':
                newValue = await this.promptForDomain(currentValue as string);
                break;
            case 'ngrokRegion':
                newValue = await this.promptForRegion(currentValue as string);
                break;
            case 'autoStart':
            case 'showStatusBar':
                newValue = await this.promptForBoolean(key, currentValue as boolean);
                break;
            default:
                this.logger.warn(`Unhandled configuration key: ${key}`);
                return;
        }

        if (newValue !== undefined && newValue !== currentValue) {
            try {
                await this.updateConfiguration(key as ConfigurationKey, newValue as BridgeConfiguration[ConfigurationKey]);
                vscode.window.showInformationMessage(`${key} updated successfully`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update ${key}: ${error}`);
            }
        }
    }

    private async promptForUrl(currentValue: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter Provider server URL',
            value: currentValue,
            validateInput: (value) => this.isValidUrl(value) ? null : 'Please enter a valid URL'
        });
    }

    private async promptForAuthToken(currentValue: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter your ngrok authentication token',
            value: currentValue,
            password: true,
            placeHolder: 'Leave empty if not using ngrok pro features'
        });
    }

    private async promptForDomain(currentValue: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt: 'Enter custom ngrok domain (requires pro account)',
            value: currentValue,
            placeHolder: 'e.g., myapp.ngrok.io'
        });
    }

    private async promptForRegion(currentValue: string): Promise<string | undefined> {
        return vscode.window.showQuickPick([...NGROK_REGIONS], {
            placeHolder: `Select ngrok region - Currently: ${currentValue}`
        });
    }

    private async promptForBoolean(key: string, currentValue: boolean): Promise<boolean | undefined> {
        const options = ['Enable', 'Disable'];
        let keyDisplayName: string;

        switch (key) {
            case 'autoStart':
                keyDisplayName = 'Auto Start';
                break;
            case 'showStatusBar':
                keyDisplayName = 'Show Status Bar';
                break;
            default:
                keyDisplayName = key;
        }

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `${keyDisplayName} - Currently ${currentValue ? 'Enabled' : 'Disabled'}`
        });

        return selected ? selected === 'Enable' : undefined;
    }

    private isValidUrl(url: string): boolean {
        try {
            const parsedUrl = new URL(url);
            return ['http:', 'https:'].includes(parsedUrl.protocol);
        } catch {
            return false;
        }
    }

    private async getSecureToken(): Promise<string> {
        if (!this.secretStorage) {
            this.logger.error('SecretStorage unavailable - secure token storage is required for authentication tokens');
            throw new ConfigurationError('SecretStorage is required for secure token storage but is unavailable');
        }

        try {
            const token = await this.secretStorage.get(ConfigurationManager.SECRET_KEY) || '';
            if (token) {
                this.logger.debug('Retrieved auth token from secure storage');
                await this.clearTokenFromConfig();
                return token;
            }
        } catch (error) {
            this.logger.error('Failed to retrieve token from secure storage', error);
            throw new ConfigurationError('Failed to retrieve authentication token from secure storage', error);
        }

        const config = vscode.workspace.getConfiguration(ConfigurationManager.EXTENSION_ID);
        const configToken = config.get('ngrokAuthToken', DEFAULT_CONFIGURATION.ngrokAuthToken);

        if (configToken) {
            this.logger.info('Migrating auth token from config to secure storage');
            try {
                await this.secretStorage.store(ConfigurationManager.SECRET_KEY, configToken);
                await this.clearTokenFromConfig();
                return configToken;
            } catch (error) {
                this.logger.error('Failed to migrate token to secure storage', error);
                throw new ConfigurationError('Failed to migrate token to secure storage', error);
            }
        }

        return '';
    }

    private async setSecureToken(token: string): Promise<void> {
        if (!this.secretStorage) {
            this.logger.error('SecretStorage unavailable - secure token storage is required for authentication tokens');
            throw new ConfigurationError('SecretStorage is required for secure token storage but is unavailable');
        }

        if (!token) {
            try {
                await this.secretStorage.delete(ConfigurationManager.SECRET_KEY);
                await this.clearTokenFromConfig();
                return;
            } catch (error) {
                this.logger.error('Failed to delete token from secure storage', error);
                throw new ConfigurationError('Failed to delete authentication token from secure storage', error);
            }
        }

        try {
            await this.secretStorage.store(ConfigurationManager.SECRET_KEY, token);
            await this.clearTokenFromConfig();
            this.logger.debug('Auth token stored securely');
        } catch (error) {
            this.logger.error('Failed to store token in secure storage', error);
            throw new ConfigurationError('Failed to store authentication token in secure storage', error);
        }
    }

    private async clearTokenFromConfig(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration(ConfigurationManager.EXTENSION_ID);
            await config.update('ngrokAuthToken', '', vscode.ConfigurationTarget.Global);
            this.logger.debug('Cleared token from configuration');
        } catch (error) {
            this.logger.warn('Failed to clear token from configuration', error);
        }
    }
}
