import * as http from 'http';
import * as url from 'url';
import * as net from 'net';
import { httpRequest } from '../utils/httpClient';
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
                `Port ${ProxyServer.SERVER_PORT} is already in use. Please stop any other applications using this port or restart Cursor.`,
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

            this.server.on('error', (error: NodeJS.ErrnoException) => {
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
        
        this.logger.debug(`${method} ${requestUrl}`);

        this.setCorsHeaders(res, req);
        if (method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            await this.routeRequest(req, res, requestUrl, method);
            this.logger.debug(`${method} ${requestUrl} completed in ${Date.now() - startTime}ms`);
        } catch (error) {
            this.handleRequestError(error, method, requestUrl, res);
        }
    }

    private async routeRequest(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: string, method: string): Promise<void> {
        const pathname = url.parse(requestUrl, true).pathname || '/';
        const isChatEndpoint = (pathname === '/chat/completions' || pathname === '/v1/chat/completions') && method === 'POST';
        
        if (isChatEndpoint) {
            await this.handleChatCompletions(req, res);
        } else {
            await this.forwardRequest(req, res);
        }
    }

    private handleRequestError(error: unknown, method: string, requestUrl: string, res: http.ServerResponse): void {
        this.logger.error(`Error handling ${method} ${requestUrl}`, error);
        
        if (!res.headersSent) {
            this.sendErrorResponse(res, 500, 'Internal Server Error');
        } else {
            this.safeEndResponse(res);
        }
    }

    private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (res.headersSent) {return;}

        const body = await this.readRequestBody(req);
        const requestData = this.parseAndValidateRequest(body, res);
        
        if (!requestData || res.headersSent) {return;}

        try {
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

    private parseAndValidateRequest(body: string, res: http.ServerResponse): ChatCompletionRequest | null {
        let requestData: ChatCompletionRequest;
        
        try {
            requestData = JSON.parse(body);
        } catch {
            this.sendErrorResponse(res, 400, 'Invalid JSON in request body');
            return null;
        }

        if (!requestData.model) {
            this.sendErrorResponse(res, 400, 'Model field is required');
            return null;
        }

        if (!requestData.messages || !Array.isArray(requestData.messages) || requestData.messages.length === 0) {
            this.sendErrorResponse(res, 400, 'Messages field is required and must be a non-empty array');
            return null;
        }

        return requestData;
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
        if (res.headersSent) {return;}

        try {
            const headers = this.extractRequestHeaders(req);
            const httpOptions = { method: req.method, headers, body, stream: true };
            const response = await httpRequest(targetUrl, httpOptions);

            if (res.headersSent) {return;}

            const responseHeaders = this.filterResponseHeaders(response.headers);
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

    private extractRequestHeaders(req: http.IncomingMessage): Record<string, string> {
        const headers: Record<string, string> = {};
        const relevantHeaders = ['content-type', 'authorization', 'user-agent'];
        
        for (const header of relevantHeaders) {
            if (req.headers[header]) {
                headers[header.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('-')] = req.headers[header] as string;
            }
        }
        
        return headers;
    }

    private filterResponseHeaders(headers: Map<string, string>): Record<string, string> {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of headers.entries()) {
            if (key.toLowerCase() !== 'transfer-encoding') {
                responseHeaders[key] = value;
            }
        }
        return responseHeaders;
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

    private setCorsHeaders(res: http.ServerResponse, req?: http.IncomingMessage): void {
        const allowedOrigins = [
            'vscode-webview://',
            'https://api2.cursor.sh',
            'https://api3.cursor.sh', 
            'https://repo42.cursor.sh',
            'https://api4.cursor.sh',
            'https://us-asia.gcpp.cursor.sh',
            'https://us-eu.gcpp.cursor.sh',
            'https://us-only.gcpp.cursor.sh'
        ];

        const origin = req?.headers.origin;
        let allowedOrigin = 'null';

        if (origin) {
            const isAllowed = allowedOrigins.some(allowed => {
                if (allowed.startsWith('vscode-webview://')) {
                    return origin.startsWith('vscode-webview://');
                }
                return origin === allowed;
            });

            if (isAllowed) {
                allowedOrigin = origin;
            } else {
                this.logger.warn(`Blocked CORS request from unauthorized origin: ${origin}`);
            }
        }

        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
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

    private async checkPortStatus(port: number): Promise<{ inUse: boolean; error?: Error }> {
        return new Promise((resolve) => {
            const server = net.createServer();
            
            server.listen(port, 'localhost', () => {
                server.close(() => {
                    resolve({ inUse: false });
                });
            });
            
            server.on('error', (error: NodeJS.ErrnoException) => {
                if (error.code === 'EADDRINUSE') {
                    resolve({ inUse: true, error });
                } else {
                    resolve({ inUse: false, error });
                }
            });
        });
    }

}