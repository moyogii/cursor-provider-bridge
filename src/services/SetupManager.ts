import * as vscode from 'vscode';
import { getLogger } from '../utils/logger';
import { SetupData } from '../types';

export class SetupManager implements vscode.Disposable {
    private readonly logger = getLogger();
    private setupPanel: vscode.WebviewPanel | undefined;
    private readonly context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public isSetupCompleted(): boolean {
        return this.context.globalState.get('setupCompleted', false);
    }

    public isSetupSkipped(): boolean {
        return this.context.globalState.get('setupSkipped', false);
    }

    public shouldShowSetup(): boolean {
        const hasRunBefore = this.context.globalState.get('hasRunBefore', false);
        const setupCompleted = this.isSetupCompleted();
        const setupSkipped = this.isSetupSkipped();
        
        this.logger.info(`Setup check: hasRunBefore=${hasRunBefore}, setupCompleted=${setupCompleted}, setupSkipped=${setupSkipped}`);
        
        if (!hasRunBefore) {
            this.context.globalState.update('hasRunBefore', true);
            this.logger.info('First-time extension run detected, showing setup');
            return true;
        }
        
        const shouldShow = !setupCompleted && !setupSkipped;
        this.logger.info(`Should show setup: ${shouldShow}`);
        return shouldShow;
    }

    public async showSetupWizard(): Promise<{ completed: boolean; autoStart: boolean }> {
        if (this.setupPanel) {
            this.setupPanel.reveal();
            return { completed: false, autoStart: false };
        }

        return new Promise((resolve) => {
            let resolved = false;
            
            const safeResolve = (value: { completed: boolean; autoStart: boolean }) => {
                if (!resolved) {
                    resolved = true;
                    resolve(value);
                }
            };

            this.setupPanel = vscode.window.createWebviewPanel(
                'cursorProviderBridgeSetup',
                'Cursor Provider Bridge - Setup',
                vscode.ViewColumn.One,
                { enableScripts: true, localResourceRoots: [] }
            );

            this.setupPanel.webview.html = this.getWebviewContent();
            this.setupPanel.webview.onDidReceiveMessage(async (message) => {
                try {
                    switch (message.command) {
                        case 'setupComplete':
                            try {
                                await this.completeSetup(message.data);
                                this.setupPanel?.dispose();
                                safeResolve({ completed: true, autoStart: message.data.autoStart });
                            } catch (error) {
                                this.logger.error('Setup completion failed', error);
                                vscode.window.showErrorMessage(
                                    `Setup failed: ${error instanceof Error ? error.message : String(error)}`
                                );
                                safeResolve({ completed: false, autoStart: false });
                            }
                            break;
                        case 'setupCancel':
                            try {
                                await this.skipSetup();
                                this.setupPanel?.dispose();
                                safeResolve({ completed: false, autoStart: false });
                            } catch (error) {
                                this.logger.error('Setup skip failed', error);
                                safeResolve({ completed: false, autoStart: false });
                            }
                            break;
                        case 'openAuthUrl':
                            vscode.env.openExternal(vscode.Uri.parse('https://dashboard.ngrok.com/get-started/your-authtoken'));
                            break;
                        case 'openCursorSettings':
                            vscode.commands.executeCommand('aiSettings.action.open');
                            break;
                    }
                } catch (error) {
                    this.logger.error('Setup message handling failed', error);
                    safeResolve({ completed: false, autoStart: false });
                }
            });

            this.setupPanel.onDidDispose(() => {
                this.setupPanel = undefined;
                safeResolve({ completed: false, autoStart: false });
            });
        });
    }

    private async completeSetup(data: SetupData): Promise<void> {
        if (data.authToken.trim() && !this.context.secrets) {
            this.logger.error('SecretStorage unavailable - cannot securely store authentication token');
            throw new Error('SecretStorage is required for secure token storage but is unavailable. Please ensure your Cursor installation supports SecretStorage.');
        }

        const config = vscode.workspace.getConfiguration('cursor-provider-bridge');
        
        const updates = this.buildConfigurationUpdates(data, config);
        await Promise.all(updates);
        
        this.logger.info('Setup completed successfully');
    }

    private buildConfigurationUpdates(data: SetupData, config: vscode.WorkspaceConfiguration): Promise<void>[] {
        const updates: Promise<void>[] = [
            Promise.resolve(config.update('autoStart', data.autoStart, vscode.ConfigurationTarget.Global)),
            Promise.resolve(this.context.globalState.update('setupCompleted', true))
        ];

        if (data.authToken.trim()) {
            updates.push(Promise.resolve(this.context.secrets.store('ngrokAuthToken', data.authToken.trim())));
        }
        
        if (data.customDomain.trim()) {
            updates.push(Promise.resolve(config.update('ngrokDomain', data.customDomain.trim(), vscode.ConfigurationTarget.Global)));
        }
        
        if (data.providerUrl.trim()) {
            updates.push(Promise.resolve(config.update('providerUrl', data.providerUrl.trim(), vscode.ConfigurationTarget.Global)));
        }

        return updates;
    }

    public async skipSetup(): Promise<void> {
        await this.context.globalState.update('setupSkipped', true);
        this.logger.info('Setup skipped by user');
        
        vscode.window.showInformationMessage(
            'Setup skipped. Run "Cursor Provider Bridge: Run Setup" from Command Palette to configure later.',
            'Open Commands'
        ).then(selection => {
            if (selection === 'Open Commands') {
                vscode.commands.executeCommand('workbench.action.showCommands');
            }
        });
    }

    public async resetSetupState(): Promise<void> {
        await Promise.all([
            this.context.globalState.update('hasRunBefore', undefined),
            this.context.globalState.update('setupCompleted', undefined),
            this.context.globalState.update('setupSkipped', undefined)
        ]);
        this.logger.info('Setup state has been reset');
        
        vscode.window.showInformationMessage(
            'Setup state has been reset. The first-time setup will appear when you restart Cursor or reload the window.',
            'Reload Window'
        ).then(selection => {
            if (selection === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self';">
    <title>Setup</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #151415;
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1.5;
        }
        
        .container {
            max-width: 480px;
            width: 90%;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 32px;
            backdrop-filter: blur(10px);
        }
        
        h1 {
            text-align: center;
            font-size: 24px;
            margin-bottom: 8px;
            background: linear-gradient(135deg, #fff, #ccc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .subtitle {
            text-align: center;
            color: #aaa;
            margin-bottom: 32px;
            font-size: 14px;
        }
        
        .section {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
        }
        
        .step-num {
            background: linear-gradient(135deg, #fff, #ccc);
            color: black;
            width: 24px;
            height: 24px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            margin-right: 12px;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            font-size: 13px;
        }
        
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            background: rgba(255,255,255,0.05);
            color: white;
            font-size: 14px;
        }
        
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: rgba(255,255,255,0.4);
            background: rgba(255,255,255,0.08);
        }
        
        input[type="text"]::placeholder, input[type="password"]::placeholder { color: #777; }
        
        .help { font-size: 11px; color: #999; margin-top: 4px; }
        
        .checkbox-row {
            display: flex;
            align-items: center;
            padding: 12px;
            background: rgba(255,255,255,0.02);
            border-radius: 8px;
            margin-bottom: 16px;
        }
        
        input[type="checkbox"] {
            width: 16px;
            height: 16px;
            margin-right: 12px;
            accent-color: white;
        }
        
        .checkbox-text .title {
            font-weight: 500;
            font-size: 14px;
        }
        
        .checkbox-text .desc {
            font-size: 12px;
            color: #bbb;
        }
        
        .note {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 12px;
            font-size: 12px;
            color: #ccc;
            margin-bottom: 16px;
        }
        
        .actions {
            text-align: center;
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        
        .btn {
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 500;
            cursor: pointer;
            margin: 0 6px;
            font-size: 14px;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #fff, #ddd);
            color: black;
            border: none;
        }
        
        .btn-primary:hover { transform: translateY(-1px); }
        
        .btn-secondary {
            background: transparent;
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn-secondary:hover { background: rgba(255,255,255,0.1); }
        
        .get-token {
            background: rgba(255,255,255,0.08);
            color: white;
            border: 1px solid rgba(255,255,255,0.15);
            padding: 8px 16px;
            border-radius: 6px;
            text-decoration: none;
            display: inline-block;
            font-size: 12px;
            margin: 8px 0;
        }
        
        .get-token:hover { background: rgba(255,255,255,0.12); }
        
        .alert {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            padding: 12px 20px;
            color: white;
            font-size: 13px;
            z-index: 1000;
            backdrop-filter: blur(10px);
        }
        
        .skip-info {
            text-align: center;
            font-size: 12px;
            color: #999;
            margin: 16px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Cursor Provider Bridge</h1>
        <p class="subtitle">Connect Cursor to your local AI provider</p>
        
        <div class="section">
            <div class="section-title">
                <span class="step-num">1</span>
                Get Ngrok Auth Token
            </div>
            <p style="color: #ccc; margin-bottom: 12px;">Get a free auth token to create secure tunnels.</p>
            <a href="#" class="get-token" onclick="openAuthUrl()">🔑 Get Auth Token</a>
            <div class="help">Opens ngrok dashboard. Registration takes under a minute.</div>
        </div>
        
        <div class="section">
            <div class="section-title">
                <span class="step-num">2</span>
                Configure Tunnel
            </div>
            
            <div class="form-group">
                <label for="authToken">Ngrok Auth Token</label>
                <input type="password" id="authToken" placeholder="Paste your ngrok auth token here" />
                <div class="help">Required for creating secure tunnels</div>
            </div>
            
            <div class="form-group">
                <label for="customDomain">Custom Domain (Optional)</label>
                <input type="text" id="customDomain" placeholder="e.g., my-app.ngrok-free.app" />
                <div class="help">Leave empty to use auto-generated domain</div>
            </div>
            
            <div class="checkbox-row">
                <input type="checkbox" id="autoStart" checked />
                <label for="autoStart" class="checkbox-text">
                    <div class="title">Auto-start on Cursor startup</div>
                    <div class="desc">Automatically start bridge when Cursor launches</div>
                </label>
            </div>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="step-num">3</span>
                Local AI Provider
            </div>
            
            <div class="form-group">
                <label for="providerUrl">Provider URL</label>
                <input type="text" id="providerUrl" placeholder="http://localhost:1234" value="http://localhost:1234" />
                <div class="help">URL of your local AI provider (LM Studio, Ollama, etc.)</div>
            </div>
            
            <div class="note">
                <strong>Note:</strong> You can modify these settings anytime in preferences.
            </div>
        </div>

        <div class="section">
            <div class="section-title">
                <span class="step-num">4</span>
                Configure Cursor Settings
            </div>
            <p style="color: #ccc; margin-bottom: 12px;">Set up Cursor to use your secure tunnel URL for chat requests.</p>
            
            <div class="note" style="margin-bottom: 12px;">
                <strong>After completing setup:</strong><br>
                1. Open Cursor Settings<br>
                2. Navigate to: Models > API Keys<br>
                3. Replace "Override OpenAI Base URL" with your tunnel url (you'll receive this after setup)<br>
                4. Enter your provider's auth token (if necessary) and click "Verify"<br>
                5. Add custom models by clicking the "Add Custom Model" button under the "View All Models" section<br>
            </div>
            
            <button class="get-token" onclick="openCursorSettings()" style="background: rgba(100,150,255,0.2); border: 1px solid rgba(100,150,255,0.4);">
                ⚙️ Open Cursor Settings
            </button>
        </div>

        <div class="skip-info">
            You can skip setup and configure these settings later via command palette.
        </div>
        
        <div class="actions">
            <button class="btn btn-primary" onclick="completeSetup()">Complete Setup</button>
            <button class="btn btn-secondary" onclick="skipSetup()">Skip for Now</button>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function openAuthUrl() {
            vscode.postMessage({ command: 'openAuthUrl' });
        }
        
        function openCursorSettings() {
            vscode.postMessage({ command: 'openCursorSettings' });
        }
        
        function completeSetup() {
            const authToken = document.getElementById('authToken').value.trim();
            const customDomain = document.getElementById('customDomain').value.trim();
            const providerUrl = document.getElementById('providerUrl').value.trim();
            const autoStart = document.getElementById('autoStart').checked;
            
            if (!authToken) {
                showAlert('Please enter your ngrok auth token to continue.');
                document.getElementById('authToken').focus();
                return;
            }
            
            if (!providerUrl) {
                showAlert('Please enter your local AI provider URL.');
                document.getElementById('providerUrl').focus();
                return;
            }
            
            vscode.postMessage({
                command: 'setupComplete',
                data: { authToken, customDomain, providerUrl, autoStart }
            });
        }
        
        function skipSetup() {
            vscode.postMessage({ command: 'setupCancel' });
        }

        function showAlert(message) {
            const existing = document.querySelector('.alert');
            if (existing) existing.remove();
            
            const alert = document.createElement('div');
            alert.className = 'alert';
            alert.textContent = message;
            document.body.appendChild(alert);
            
            setTimeout(() => alert.remove(), 3000);
        }
        
        document.getElementById('authToken').focus();
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this.setupPanel?.dispose();
    }
}