import ngrok from '@ngrok/ngrok';
import {
    ITunnelManager,
    IConfigurationManager,
    IModelProvider,
    TunnelStatus,
    TunnelError,
    BridgeConfiguration
} from '../types';
import { getLogger } from '../utils/logger';
import { safeAsync, retry, withTimeout } from '../utils/async';
import { ProxyServer } from './ProxyServer';

export class NgrokTunnelManager implements ITunnelManager {
    private static readonly START_TIMEOUT = 30000;
    private static readonly STOP_TIMEOUT = 10000;

    private tunnel: any = null;
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

        if (this.proxyServer?.isServerRunning()) {
            await this.proxyServer.stop().catch(error => {
                this.logger.error('Error stopping existing proxy server', error);
            });
        }

        const config = this.configManager.getConfiguration();
        this.logger.info('Starting proxy server and ngrok tunnel', {
            providerUrl: config.providerUrl,
            region: config.ngrokRegion,
            hasDomain: !!config.ngrokDomain,
            hasAuthToken: !!config.ngrokAuthToken
        });

        const result = await safeAsync(async () => {
            return await withTimeout(
                retry(async () => {
                    const proxyPort = await this.proxyServer!.start();
                    return await this.createTunnel(config, proxyPort);
                }, 2),
                NgrokTunnelManager.START_TIMEOUT
            );
        });

        if (!result.success) {
            if (this.proxyServer?.isServerRunning()) {
                await this.proxyServer.stop().catch(cleanupError => {
                    this.logger.error('Error stopping proxy server during cleanup', cleanupError);
                });
            }

            const error = result.error;
            this.status = { 
                isRunning: false, 
                error: error?.message || 'Unknown error' 
            };
            
            if (error?.message?.includes('PORT_IN_USE')) {
                this.logger.error('Port conflict detected', error);
                throw new TunnelError(
                    'Port 8082 is already in use. Please stop any other applications using this port or restart VS Code.',
                    error
                );
            }
            
            this.logger.error('Failed to start tunnel', error);
            throw new TunnelError('Failed to start ngrok tunnel', error);
        }

        this.tunnel = result.data?.tunnel;
        this.status = { 
            isRunning: true, 
            url: result.data?.url || '' 
        };

        this.logger.info('Tunnel started successfully', {
            url: this.status.url,
            proxyPort: result.data?.proxyPort || 0,
            forwarding: config.providerUrl
        });
    }

    async stop(): Promise<void> {
        const hasActiveTunnel = this.tunnel && this.status.isRunning;
        const hasActiveProxy = this.proxyServer?.isServerRunning();
        
        if (!hasActiveTunnel && !hasActiveProxy) {
            return;
        }

        let tunnelResult: { success: boolean; error?: Error } = { success: true };
        let proxyResult: { success: boolean; error?: Error } = { success: true };

        if (hasActiveTunnel) {
            tunnelResult = await safeAsync(async () => {
                return await withTimeout(
                    this.tunnel!.close(),
                    NgrokTunnelManager.STOP_TIMEOUT
                );
            });
        }

        if (hasActiveProxy) {
            proxyResult = await safeAsync(async () => {
                await this.proxyServer!.stop();
            });
        }

        this.tunnel = null;
        this.status = { isRunning: false };

        if (!tunnelResult.success) {
            this.logger.error('Error stopping tunnel', tunnelResult.error);
            throw new TunnelError('Failed to stop ngrok tunnel cleanly', tunnelResult.error);
        }

        if (!proxyResult.success) {
            this.logger.error('Error stopping proxy server', proxyResult.error);
        }
    }

    async restart(): Promise<void> {
        try {
            await this.stop();
            await this.start();
        } catch (error) {
            this.logger.error('Failed to restart tunnel', error);
            throw error instanceof TunnelError 
                ? error 
                : new TunnelError('Failed to restart tunnel', error);
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
        this.status = { isRunning: false };
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

    private async createTunnel(config: BridgeConfiguration, proxyPort: number): Promise<{ tunnel: any; url: string; proxyPort: number }> {
        const proxyUrl = `http://localhost:${proxyPort}`;
        const ngrokOptions = this.buildNgrokOptions(config, proxyUrl);

        this.logger.debug('Creating tunnel with options', {
            ...ngrokOptions,
            authtoken: ngrokOptions.authtoken ? '[REDACTED]' : undefined,
            proxyPort
        });

        const tunnel = await ngrok.forward(ngrokOptions);
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

    private parseUrl(urlString: string): URL {
        try {
            return new URL(urlString);
        } catch (error) {
            throw new TunnelError(`Invalid Provider URL: ${urlString}`, error);
        }
    }

    private buildNgrokOptions(config: BridgeConfiguration, proxyUrl: string): Record<string, unknown> {
        const options: Record<string, unknown> = {
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