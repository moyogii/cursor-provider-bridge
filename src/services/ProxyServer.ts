import * as http from 'http';
import * as url from 'url';
import * as net from 'net';
import fetch from 'node-fetch';
import {
    IConfigurationManager,
    IModelProvider,
    ChatCompletionRequest,
    ModelInfo,
    ModelError,
    BridgeError
} from '../types';
import { getLogger } from '../utils/logger';

export class ProxyServer {
    private static readonly SERVER_PORT = 8082;

    private server: http.Server | null = null;
    private readonly logger = getLogger();
    private isRunning = false;

    constructor(
        private readonly configManager: IConfigurationManager,
        private readonly modelProvider: IModelProvider
    ) {}

    async start(): Promise<number> {
        if (this.isRunning) {
            throw new BridgeError('Proxy server is already running', 'SERVER_ALREADY_RUNNING');
        }

        const portStatus = await this.checkPortStatus(ProxyServer.SERVER_PORT);
        if (portStatus.inUse) {
            throw new BridgeError(
                `Port ${ProxyServer.SERVER_PORT} is already in use. Please stop any other applications using this port or restart VS Code.`,
                'PORT_IN_USE'
            );
        }

        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(error => {
                    this.logger.error('Request handling error', error);
                    this.sendErrorResponse(res, 500, 'Internal Server Error');
                });
            });

            this.server.on('error', (error: any) => {
                this.logger.error('Proxy server error', error);
                this.isRunning = false;
                if (error.code === 'EADDRINUSE') {
                    reject(new BridgeError(`Port ${ProxyServer.SERVER_PORT} is already in use`, 'PORT_IN_USE', error));
                } else {
                    reject(new BridgeError('Failed to start proxy server', 'SERVER_START_ERROR', error));
                }
            });

            this.server.listen(ProxyServer.SERVER_PORT, 'localhost', () => {
                this.isRunning = true;
                resolve(ProxyServer.SERVER_PORT);
            });
        });
    }

    async stop(): Promise<void> {
        if (!this.server || !this.isRunning) {
            return;
        }

        return new Promise((resolve, reject) => {
            this.server!.close((error) => {
                this.isRunning = false;
                this.server = null;

                if (error) {
                    this.logger.error('Error stopping proxy server', error);
                    reject(new BridgeError('Failed to stop proxy server', 'SERVER_STOP_ERROR', error));
                } else {
                    resolve();
                }
            });
        });
    }

    getPort(): number {
        return ProxyServer.SERVER_PORT;
    }

    isServerRunning(): boolean {
        return this.isRunning;
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const startTime = Date.now();
        const method = req.method || 'GET';
        const requestUrl = req.url || '/';
        let responseHandled = false;
        
        this.logger.debug(`${method} ${requestUrl}`);

        this.setCorsHeaders(res);
        if (method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            const parsedUrl = url.parse(requestUrl, true);
            const pathname = parsedUrl.pathname || '/';
            
            if ((pathname === '/chat/completions' || pathname === '/v1/chat/completions') && method === 'POST') {
                await this.handleChatCompletions(req, res);
                responseHandled = true;
            } else {
                await this.forwardRequest(req, res);
                responseHandled = true;
            }

            const duration = Date.now() - startTime;
            this.logger.debug(`${method} ${requestUrl} completed in ${duration}ms`);

        } catch (error) {
            this.logger.error(`Error handling ${method} ${requestUrl}`, error);
            
            if (!responseHandled && !res.headersSent) {
                this.sendErrorResponse(res, 500, 'Internal Server Error');
            } else {
                this.safeEndResponse(res);
            }
        }
    }

    private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (res.headersSent) {
            return;
        }

        const body = await this.readRequestBody(req);
        
        let requestData: ChatCompletionRequest;
        try {
            requestData = JSON.parse(body);
        } catch (error) {
            if (!res.headersSent) {
                this.sendErrorResponse(res, 400, 'Invalid JSON in request body');
            }
            return;
        }

        if (!requestData.model) {
            if (!res.headersSent) {
                this.sendErrorResponse(res, 400, 'Model field is required');
            }
            return;
        }

        if (!requestData.messages || !Array.isArray(requestData.messages) || requestData.messages.length === 0) {
            if (!res.headersSent) {
                this.sendErrorResponse(res, 400, 'Messages field is required and must be a non-empty array');
            }
            return;
        }

        try {
            if (res.headersSent) {
                return;
            }

            if (this.isTestPrompt(requestData)) {
                await this.handleTestPrompt(req, res, requestData);
            } else {
                await this.forwardChatCompletionRequest(req, res, body);
            }

        } catch (error) {
            this.logger.error('Error in chat completions handler', error);
            const errorMessage = error instanceof ModelError ? error.message : 'Internal server error';
            if (!res.headersSent) {
                this.sendErrorResponse(res, 500, errorMessage);
            }
        }
    }



    private async forwardChatCompletionRequest(
        req: http.IncomingMessage, 
        res: http.ServerResponse, 
        body: string
    ): Promise<void> {
        const config = this.configManager.getConfiguration();
        const baseUrl = config.providerUrl.endsWith('/') ? config.providerUrl.slice(0, -1) : config.providerUrl;
        const targetUrl = `${baseUrl}/v1/chat/completions`;

        await this.forwardRequestToTarget(req, res, targetUrl, body);
    }

    private async forwardRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const config = this.configManager.getConfiguration();
        const requestUrl = req.url || '/';
        
        const baseUrl = config.providerUrl.endsWith('/') ? config.providerUrl.slice(0, -1) : config.providerUrl;
        
        let path = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`;
        if (!path.startsWith('/v1') && this.isApiEndpoint(path)) {
            path = `/v1${path}`;
        }
        
        const targetUrl = `${baseUrl}${path}`;
        
        const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' 
            ? await this.readRequestBody(req) 
            : undefined;

        await this.forwardRequestToTarget(req, res, targetUrl, body);
    }

    private isApiEndpoint(path: string): boolean {
        const apiEndpoints = ['/chat/completions', '/models', '/completions', '/embeddings'];
        return apiEndpoints.some(endpoint => path === endpoint || path.startsWith(`${endpoint}?`));
    }

    private isTestPrompt(requestData: ChatCompletionRequest): boolean {
        const messages = requestData.messages;
        return messages.length > 1 && messages[1].content === 'Test prompt using gpt-3.5-turbo';
    }

    private async handleTestPrompt(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        requestData: ChatCompletionRequest
    ): Promise<void> {
        const models = await this.modelProvider.getModels();
        const availableModel = this.selectNonEmbeddingModel(models);
        
        if (!availableModel) {
            this.sendErrorResponse(res, 503, 'No suitable models available from provider');
            return;
        }

        const modifiedRequest = { ...requestData, model: availableModel.id };
        await this.forwardChatCompletionRequest(req, res, JSON.stringify(modifiedRequest));
    }

    private selectNonEmbeddingModel(models: ReadonlyArray<ModelInfo>): ModelInfo | undefined {
        return models.find(model => 
            !model.id.toLowerCase().includes('embed') && 
            !model.id.toLowerCase().includes('text-embedding')
        );
    }

    private async forwardRequestToTarget(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        targetUrl: string,
        body?: string
    ): Promise<void> {
        if (res.headersSent) {
            return;
        }

        try {
            const headers: Record<string, string> = {};
            
            if (req.headers['content-type']) {
                headers['Content-Type'] = req.headers['content-type'] as string;
            }
            if (req.headers['authorization']) {
                headers['Authorization'] = req.headers['authorization'] as string;
            }
            if (req.headers['user-agent']) {
                headers['User-Agent'] = req.headers['user-agent'] as string;
            }

            const fetchOptions: any = {
                method: req.method,
                headers
            };

            if (body) {
                fetchOptions.body = body;
            }

            const response = await fetch(targetUrl, fetchOptions);

            if (res.headersSent) {
                return;
            }

            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of response.headers.entries()) {
                if (key.toLowerCase() !== 'transfer-encoding') {
                    responseHeaders[key] = value;
                }
            }

            res.writeHead(response.status, response.statusText, responseHeaders);
            if (response.body) {
                response.body.pipe(res);
            } else {
                res.end();
            }

        } catch (error) {
            this.logger.error('Error forwarding request', error);
            if (!res.headersSent) {
                this.sendErrorResponse(res, 502, 'Bad Gateway - Unable to reach provider');
            } else {
                this.safeEndResponse(res);
            }
        }
    }

    private async readRequestBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            
            req.on('data', (chunk) => {
                body += chunk.toString();
            });

            req.on('end', () => {
                resolve(body);
            });

            req.on('error', (error) => {
                reject(error);
            });
        });
    }

    private setCorsHeaders(res: http.ServerResponse): void {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
    }

    private safeEndResponse(res: http.ServerResponse): void {
        if (!res.headersSent) {
            try {
                res.end();
            } catch (error) {
                this.logger.error('Error ending response', error);
            }
        }
    }

    private sendErrorResponse(res: http.ServerResponse, statusCode: number, message: string): void {
        if (res.headersSent) {
            return;
        }

        try {
            const errorResponse = {
                error: {
                    message,
                    type: 'proxy_error',
                    code: statusCode
                }
            };

            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorResponse, null, 2));
        } catch (error) {
            this.logger.error('Error sending error response', error);
            if (!res.headersSent) {
                try {
                    res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
                    res.end(message);
                } catch (fallbackError) {
                    this.logger.error('Error in fallback error response', fallbackError);
                    this.safeEndResponse(res);
                }
            }
        }
    }

    dispose(): void {
        if (this.isRunning) {
            this.stop().catch(error => {
                this.logger.error('Error during proxy server disposal', error);
            });
        }
    }

    /**
     * Check if a port is currently in use
     */
    private async checkPortStatus(port: number): Promise<{ inUse: boolean; error?: Error }> {
        return new Promise((resolve) => {
            const server = net.createServer();
            
            server.listen(port, 'localhost', () => {
                server.close(() => {
                    resolve({ inUse: false });
                });
            });
            
            server.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    resolve({ inUse: true, error });
                } else {
                    resolve({ inUse: false, error });
                }
            });
        });
    }

}