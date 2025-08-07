import ngrok from '@ngrok/ngrok';
import {
    ITunnelManager,
    IConfigurationManager,
    IModelProvider,
    TunnelStatus,
    TunnelError,
    BridgeConfiguration,
    NgrokTunnel,
    NgrokOptions,
    TunnelStartResult
} from '../types';
import { getLogger } from '../utils/logger';
import { safeAsync, retry, withTimeout } from '../utils/async';
import { ProxyServer } from './ProxyServer';

export class NgrokTunnelManager implements ITunnelManager {
    private static readonly START_TIMEOUT = 30000;
    private static readonly STOP_TIMEOUT = 10000;

    private tunnel: NgrokTunnel | null = null;
    private proxyServer: ProxyServer | null = null;
    private status: TunnelStatus = { isRunning: false };
    private readonly logger = getLogger();

    constructor(
        private readonly configManager: IConfigurationManager,
        private readonly modelProvider: IModelProvider
    ) {
        this.proxyServer = new ProxyServer(configManager, modelProvider);
    }

    async start(): Promise<void> {
        if (this.status.isRunning) {
            this.logger.warn('Attempted to start tunnel when already running');
            return;
        }

        if (this.status.isStarting) {
            this.logger.warn('Attempted to start tunnel while start is already in progress');
            return;
        }

        this.status = { ...this.status, isStarting: true };

        try {
            await this.cleanupExistingProxy();
            const config = this.configManager.getConfiguration();

            const result = await this.startTunnelWithRetry(config);
            
            if (!result.success) {
                await this.handleStartupFailure(result.error);
                return;
            }

            this.updateSuccessfulStartStatus(result.data!, config);
        } finally {
            this.status = { ...this.status, isStarting: false };
        }
    }

    private async cleanupExistingProxy(): Promise<void> {
        if (this.proxyServer?.isServerRunning()) {
            await this.proxyServer.stop().catch(error => {
                this.logger.error('Error stopping existing proxy server', error);
            });
        }
    }

    private logStartupInfo(config: BridgeConfiguration): void {
        this.logger.info('Starting proxy server and ngrok tunnel', {
            providerUrl: config.providerUrl,
            region: config.ngrokRegion,
            hasDomain: !!config.ngrokDomain,
            hasAuthToken: !!config.ngrokAuthToken
        });
    }

    private async startTunnelWithRetry(config: BridgeConfiguration): Promise<{ success: boolean; data?: TunnelStartResult; error?: Error }> {
        this.logStartupInfo(config);
        
        return await safeAsync(async () => {
            return await withTimeout(
                retry(async () => {
                    const proxyPort = await this.proxyServer!.start();
                    return await this.createTunnel(config, proxyPort);
                }, 2),
                NgrokTunnelManager.START_TIMEOUT
            );
        });
    }

    private async handleStartupFailure(error?: Error): Promise<void> {
        await this.cleanupExistingProxy();
        
        this.status = { 
            isRunning: false,
            isStarting: false,
            error: error?.message || 'Unknown error' 
        };
        
        if (error?.message?.includes('PORT_IN_USE')) {
            this.logger.error('Port conflict detected', error);
            throw new TunnelError(
                'Port 8082 is already in use. Please stop any other applications using this port or restart Cursor.',
                error
            );
        }
        
        this.logger.error('Failed to start tunnel', error);
        throw new TunnelError('Failed to start ngrok tunnel', error);
    }

    private updateSuccessfulStartStatus(data: TunnelStartResult, config: BridgeConfiguration): void {
        this.tunnel = data.tunnel;
        this.status = { 
            isRunning: true, 
            url: data.url || '' 
        };

        this.logger.info('Tunnel started successfully', {
            url: this.status.url,
            proxyPort: data.proxyPort || 0,
            forwarding: config.providerUrl
        });
    }

    async stop(): Promise<void> {
        const hasActiveTunnel = this.tunnel && this.status.isRunning;
        const hasActiveProxy = this.proxyServer?.isServerRunning();
        
        if (!hasActiveTunnel && !hasActiveProxy) {return;}

        const [tunnelResult, proxyResult] = await Promise.all([
            this.stopTunnel(!!hasActiveTunnel),
            this.stopProxy(!!hasActiveProxy)
        ]);

        this.tunnel = null;
        this.status = { isRunning: false, isStarting: false };

        if (!tunnelResult.success) {
            this.logger.error('Error stopping tunnel', tunnelResult.error);
            throw new TunnelError('Failed to stop ngrok tunnel cleanly', tunnelResult.error);
        }

        if (!proxyResult.success) {
            this.logger.error('Error stopping proxy server', proxyResult.error);
        }
    }

    private async stopTunnel(hasActiveTunnel: boolean): Promise<{ success: boolean; error?: Error }> {
        if (!hasActiveTunnel) {return { success: true };}
        
        return await safeAsync(async () => {
            return await withTimeout(
                this.tunnel!.close(),
                NgrokTunnelManager.STOP_TIMEOUT
            );
        });
    }

    private async stopProxy(hasActiveProxy: boolean): Promise<{ success: boolean; error?: Error }> {
        if (!hasActiveProxy) {return { success: true };}
        
        return await safeAsync(async () => {
            await this.proxyServer!.stop();
        });
    }

    async restart(): Promise<void> {
        this.logger.info('Restarting tunnel gracefully...');
        
        try {
            await this.gracefulStop();
            
            // Brief pause to allow cleanup
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await this.start();
            this.logger.info('Tunnel restarted successfully');
        } catch (error) {
            this.logger.error('Failed to restart tunnel', error);
            throw error instanceof TunnelError 
                ? error 
                : new TunnelError('Failed to restart tunnel', error);
        }
    }

    private async gracefulStop(): Promise<void> {
        const hasActiveTunnel = this.tunnel && this.status.isRunning;
        const hasActiveProxy = this.proxyServer?.isServerRunning();
        
        if (!hasActiveTunnel && !hasActiveProxy) {
            this.logger.debug('No active services to stop');
            return;
        }

        this.logger.info('Gracefully stopping tunnel and proxy services...');

        try {
            const [tunnelResult, proxyResult] = await Promise.allSettled([
                hasActiveTunnel ? this.stopTunnel(true) : Promise.resolve({ success: true }),
                hasActiveProxy ? this.stopProxy(true) : Promise.resolve({ success: true })
            ]);

            this.tunnel = null;
            this.status = { isRunning: false, isStarting: false };

            if (tunnelResult.status === 'rejected') {
                this.logger.warn('Tunnel stop had issues during graceful restart', tunnelResult.reason);
            }
            
            if (proxyResult.status === 'rejected') {
                this.logger.warn('Proxy stop had issues during graceful restart', proxyResult.reason);
            }

            if (tunnelResult.status === 'rejected' && proxyResult.status === 'rejected') {
                throw new TunnelError('Failed to stop both tunnel and proxy during restart');
            }
            
        } catch (error) {
            this.logger.error('Error during graceful stop, attempting force cleanup', error);
            await this.forceCleanup();
        }
    }

    getStatus(): TunnelStatus {
        return { ...this.status };
    }

    async forceCleanup(): Promise<void> {
        if (this.proxyServer?.isServerRunning()) {
            try {
                await this.proxyServer.stop();
            } catch (error) {
                this.logger.error('Error during force proxy cleanup', error);
            }
        }
        
        if (this.tunnel) {
            try {
                await this.tunnel.close();
            } catch (error) {
                this.logger.error('Error during force tunnel cleanup', error);
            }
        }
        
        this.tunnel = null;
        this.status = { isRunning: false, isStarting: false };
    }

    dispose(): void {
        if (this.status.isRunning || this.proxyServer?.isServerRunning()) {
            this.stop().catch(error => {
                this.logger.error('Error during tunnel disposal', error);
                this.forceCleanup().catch(cleanupError => {
                    this.logger.error('Error during force cleanup', cleanupError);
                });
            });
        }

        if (this.proxyServer) {
            this.proxyServer.dispose();
            this.proxyServer = null;
        }
    }

    private async createTunnel(config: BridgeConfiguration, proxyPort: number): Promise<TunnelStartResult> {
        const proxyUrl = `http://localhost:${proxyPort}`;
        const ngrokOptions = this.buildNgrokOptions(config, proxyUrl);

        this.logger.debug('Creating tunnel with options', {
            ...ngrokOptions,
            authtoken: ngrokOptions.authtoken ? '[REDACTED]' : undefined,
            proxyPort
        });

        const tunnel = await ngrok.forward(ngrokOptions) as NgrokTunnel;
        const url = tunnel.url();

        if (!url) {
            throw new TunnelError('Ngrok tunnel created but no URL received');
        }

        this.logger.debug('Tunnel created successfully', {
            url,
            forwardingTo: proxyUrl,
            ultimateTarget: config.providerUrl,
            proxyPort
        });

        return { tunnel, url, proxyPort };
    }


    private buildNgrokOptions(config: BridgeConfiguration, proxyUrl: string): NgrokOptions {
        const options: NgrokOptions = {
            addr: proxyUrl,
            region: config.ngrokRegion
        };

        if (config.ngrokAuthToken?.trim()) {
            options.authtoken = config.ngrokAuthToken;
        }

        if (config.ngrokDomain?.trim()) {
            options.domain = config.ngrokDomain;
        }

        return options;
    }
}

export function createTunnelManager(
    configManager: IConfigurationManager,
    modelProvider: IModelProvider
): ITunnelManager {
    try {
        return new NgrokTunnelManager(configManager, modelProvider);
    } catch (error) {
        throw new TunnelError('Failed to create tunnel manager', error);
    }
}